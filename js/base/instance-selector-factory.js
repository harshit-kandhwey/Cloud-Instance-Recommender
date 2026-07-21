// Instance Selector Factory - Creates appropriate provider-specific selectors
// Provides unified interface and integration functions

class InstanceSelectorFactory {
  static createSelector(provider) {
    switch (provider.toLowerCase()) {
      case "aws":
        return new AWSInstanceSelector();
      case "azure":
        return new AzureInstanceSelector();
      case "gcp":
        return new GCPInstanceSelector();
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  static getSupportedProviders() {
    return ["aws", "azure", "gcp"];
  }

  static getProviderRegionColumn(provider) {
    const columnMappings = {
      aws: "AWS Region",
      azure: "Azure Region",
      gcp: "GCP Region",
    };
    return columnMappings[provider.toLowerCase()];
  }

  // A MinGen value is native to one cloud (AWS family number, Azure v-number,
  // GCP family name), so a multi-cloud sheet gives each provider its own column
  // rather than one value that would have to be translated between them.
  static getProviderMinGenColumn(provider) {
    const columnMappings = {
      aws: "AWS Min Gen",
      azure: "Azure Min Gen",
      gcp: "GCP Min Gen",
    };
    return columnMappings[provider.toLowerCase()];
  }

  // The per-provider page-default option key that pairs with the column above.
  static getProviderMinGenOption(provider) {
    const optionKeys = {
      aws: "ruleDefaultMinGenAws",
      azure: "ruleDefaultMinGenAzure",
      gcp: "ruleDefaultMinGenGcp",
    };
    return optionKeys[provider.toLowerCase()];
  }

  static getProviderDefaultRegion(provider) {
    const defaultRegions = {
      aws: "us-east-1",
      azure: "East US",
      gcp: "us-central1-a",
    };
    return defaultRegions[provider.toLowerCase()];
  }
}

// Formats a selector's nearestMiss object for the "Nearest Miss" column:
// "m7i.large (2 vCPU / 8 GB) — relax: current-generation only".
function formatNearestMiss(nm) {
  if (!nm || !nm.instanceType) return "";
  const base = `${nm.instanceType} (${nm.vCpus} vCPU / ${nm.memory} GB)`;
  return nm.blockedBy && nm.blockedBy.length
    ? `${base} — relax: ${nm.blockedBy.join(", ")}`
    : base;
}

// One alternative-strategy pick as a compact cell: "instanceType (vCPU/GiB)",
// or "" when the strategy has no pick (empty pool, or Workload Based with no
// workload). Never carries price — pricing stays internal.
function formatAlternative(a) {
  return a ? `${a.instanceType} (${a.vCpus}/${a.memory})` : "";
}

// Enhanced integration function with multi-provider support.
// Optional hooks = { onProgress(done, total), yieldEvery } — when provided,
// the row loop reports progress and yields to the event loop every
// `yieldEvery` rows (used by the worker and the main-thread fallback).
window.getInstanceRecommendationWithSelector = async function (
  csvData,
  selectedProviders,
  options,
  hooks,
) {
  console.log("Starting recommendation generation with multi-provider support");
  console.log("Selected providers:", selectedProviders);
  console.log("Applied options:", options);

  // Extract recommendation type preferences
  const generateLikeToLike = options.generateLikeToLike !== false; // Default to true
  const generateOptimized = options.generateOptimized === true; // Default to false

  console.log("Recommendation types:", {
    likeToLike: generateLikeToLike,
    optimized: generateOptimized,
  });

  // Create selectors for each provider
  const selectors = {};
  const initPromises = [];

  for (const provider of selectedProviders) {
    try {
      console.log(`Creating ${provider.toUpperCase()} selector`);
      // Reuse a pre-warmed selector if available — all regions already parsed in background
      const selector =
        (window._prewarmedSelectors && window._prewarmedSelectors[provider]) ||
        InstanceSelectorFactory.createSelector(provider);

      // Extract regions for this provider
      const regionColumn =
        InstanceSelectorFactory.getProviderRegionColumn(provider);
      const regions = extractUniqueRegions(csvData, regionColumn, provider);

      console.log(`${provider.toUpperCase()} regions:`, Array.from(regions));

      // Initialize selector
      initPromises.push(
        selector.initialize(csvData, regions).then(() => {
          selectors[provider] = selector;

          // Log provider-specific statistics
          if (selector.getFilteringStatistics) {
            const stats = selector.getFilteringStatistics();
            console.log(`${provider.toUpperCase()} Statistics:`, {
              total: stats.totalInstances,
              currentGen: `${stats.currentGeneration} (${stats.currentGenerationPercentage}%)`,
              processors: Object.keys(stats.processorBreakdown),
              families: Object.keys(stats.familyNameBreakdown).length,
            });
          }
        }),
      );
    } catch (error) {
      console.error(`Failed to create selector for ${provider}:`, error);
    }
  }

  // Wait for all selectors to initialize
  await Promise.all(initPromises);

  console.log("All selectors initialized. Processing CSV data...");

  const onProgress =
    hooks && typeof hooks.onProgress === "function" ? hooks.onProgress : null;
  const yieldEvery = (hooks && hooks.yieldEvery) || 25;

  // Process each row with all providers
  const results = [];
  for (let index = 0; index < csvData.length; index++) {
    const row = csvData[index];
    const result = { ...row };

    // Utilization is a property of the VM, not of any provider, so it is
    // resolved once per row and shared by every provider's optimized pass.
    const util = resolveUtilization(row, options.utilizationStatistic);
    if (generateOptimized) {
      // Which statistic actually sized the row. Recorded on every row so a
      // recommendation that looks small can be traced to its basis instead of
      // reading as arbitrary — especially where a row fell back, or where CPU
      // and memory were sized on different statistics.
      result["Sized On"] = describeSizedOn(util);
    }

    selectedProviders.forEach((provider) => {
      const selector = selectors[provider];
      if (!selector) {
        console.warn(`No selector available for ${provider}`);
        return;
      }

      const cpu = parseInt(row["CPU Count"]) || 0;
      const memory = parseFloat(row["Memory (GB)"]) || 0;
      const cpuUtil = util.cpu;
      const memoryUtil = util.memory;
      const regionColumn =
        InstanceSelectorFactory.getProviderRegionColumn(provider);
      const region = row[regionColumn] || "";

      // Per-row rule engine inputs: CSV column → UI page default → built-in default
      const rowEnv = (
        row["ENV"] ||
        row["Environment"] ||
        options.ruleDefaultEnv ||
        ""
      ).trim();
      const rowOS = (
        row["OS"] ||
        row["Operating System"] ||
        options.ruleDefaultOS ||
        ""
      ).trim();
      const rowWorkload = resolveRowWorkload(row, options);
      const rowCompliance = (
        row["Compliance"] ||
        options.ruleDefaultCompliance ||
        ""
      ).trim();
      // MinGen is resolved per PROVIDER, most specific first: this cloud's own
      // CSV column, then this cloud's page default, then the shared column and
      // shared default that a single-provider page supplies. Each value is
      // native to the cloud it lands on, so nothing is ever translated.
      const rowMinGen = (
        row[InstanceSelectorFactory.getProviderMinGenColumn(provider)] ||
        options[InstanceSelectorFactory.getProviderMinGenOption(provider)] ||
        row["Min Gen"] ||
        row["MinGen"] ||
        options.ruleDefaultMinGen ||
        ""
      ).trim();

      const providerUpper = provider.toUpperCase();

      // Always initialize shared columns so schema is consistent across all rows
      result[`${providerUpper} Rules Applied`] = "";
      result[`${providerUpper} No Match Reason`] = "";
      result[`${providerUpper} Nearest Miss`] = "";

      // Per-row Exclude: merge CSV "Exclude" column with page-level excludeTypes
      const rowExcludeRaw = (row["Exclude"] || "").trim();
      const rowExcludeExtra = rowExcludeRaw
        ? rowExcludeRaw
            .split(",")
            .map((t) => ({ provider, type: t.trim() }))
            .filter((e) => e.type)
        : [];
      const rowOptions = {
        ...options,
        rowEnv,
        rowOS,
        rowWorkload,
        rowCompliance,
        rowMinGen,
        // The row's resolved utilization, so the rule engine can tell a busy
        // Dev box from an idle one. Resolved once above, and the SAME figures
        // that drive the N/2 rules — a rule keyed on "low utilization" and a
        // sizing pass keyed on it must not disagree about what the row read.
        rowCpuUtil: util.cpu,
        rowMemoryUtil: util.memory,
        excludeTypes: rowExcludeExtra.length
          ? [...(options.excludeTypes || []), ...rowExcludeExtra]
          : options.excludeTypes,
      };

      if (!region || cpu === 0 || memory === 0) {
        const noMatchReason = !region
          ? `No ${providerUpper} region specified in CSV`
          : cpu === 0
            ? "CPU Count is 0 or missing"
            : "Memory (GB) is 0 or missing";
        console.warn(
          `Missing data for ${provider} in row ${index + 1}: ${noMatchReason}`,
        );
        result[`${providerUpper} No Match Reason`] = noMatchReason;

        if (generateLikeToLike) {
          result[`${providerUpper} Like-to-Like Instance`] = "Missing data";
          result[`${providerUpper} Like-to-Like Family`] = "N/A";
          result[`${providerUpper} Like-to-Like vCPUs`] = "N/A";
          result[`${providerUpper} Like-to-Like Memory (GiB)`] = "N/A";
        }

        if (generateOptimized) {
          result[`${providerUpper} Optimized Instance`] = "Missing data";
          result[`${providerUpper} Optimized Family`] = "N/A";
          result[`${providerUpper} Optimized vCPUs`] = "N/A";
          result[`${providerUpper} Optimized Memory (GiB)`] = "N/A";
        }
        // Alternative-strategy columns carry the same shape on every row.
        result[`${providerUpper} Most Cost Optimized`] = "";
        result[`${providerUpper} Workload Based`] = "";
        result[`${providerUpper} Newest Generation`] = "";
        return;
      }

      try {
        // Where the alternative-strategy picks come from: the like-to-like
        // result (computed against the requested size) when present, else the
        // optimized result (against its target) on an optimized-only run.
        let altSource = null;
        if (generateLikeToLike) {
          const likeToLike = selector.getLikeToLikeInstance(
            region,
            cpu,
            memory,
            rowOptions,
          );
          // Only when it actually matched. A no-match like-to-like carries no
          // alternatives, and pinning altSource to it would suppress the ones
          // the optimized fallback below can still supply on a "both" run.
          altSource =
            likeToLike.instanceType === "No data available" ? null : likeToLike;
          result[`${providerUpper} Like-to-Like Instance`] =
            likeToLike.instanceType;
          // The provider's own family category ("General purpose", "Compute
          // optimized"): taken from the region data, never parsed back out of
          // the instance name — Azure's family is not a function of its name
          // (b2ms→bs drops the size letters, d16lsv6→dlsv6 keeps them).
          result[`${providerUpper} Like-to-Like Family`] =
            likeToLike.familyName;
          result[`${providerUpper} Like-to-Like vCPUs`] = likeToLike.vCpus;
          result[`${providerUpper} Like-to-Like Memory (GiB)`] =
            likeToLike.memory;
          result[`${providerUpper} Rules Applied`] =
            likeToLike.rulesApplied || "";
          if (
            likeToLike.instanceType === "No data available" &&
            likeToLike.reason
          ) {
            result[`${providerUpper} No Match Reason`] = likeToLike.reason;
            result[`${providerUpper} Nearest Miss`] = formatNearestMiss(
              likeToLike.nearestMiss,
            );
          }
        }

        if (generateOptimized) {
          if (cpuUtil > 0 || memoryUtil > 0) {
            const optimized = selector.getOptimizedInstance(
              region,
              cpu,
              memory,
              cpuUtil,
              memoryUtil,
              rowOptions,
            );
            if (!altSource) altSource = optimized;
            result[`${providerUpper} Optimized Instance`] =
              optimized.instanceType;
            result[`${providerUpper} Optimized Family`] = optimized.familyName;
            result[`${providerUpper} Optimized vCPUs`] = optimized.vCpus;
            result[`${providerUpper} Optimized Memory (GiB)`] =
              optimized.memory;
            if (!generateLikeToLike) {
              result[`${providerUpper} Rules Applied`] =
                optimized.rulesApplied || "";
              if (
                optimized.instanceType === "No data available" &&
                optimized.reason
              ) {
                result[`${providerUpper} No Match Reason`] = optimized.reason;
                result[`${providerUpper} Nearest Miss`] = formatNearestMiss(
                  optimized.nearestMiss,
                );
              }
            }
          } else {
            result[`${providerUpper} Optimized Instance`] =
              "No utilization data";
            result[`${providerUpper} Optimized Family`] = "N/A";
            result[`${providerUpper} Optimized vCPUs`] = "N/A";
            result[`${providerUpper} Optimized Memory (GiB)`] = "N/A";
            if (!generateLikeToLike) {
              result[`${providerUpper} No Match Reason`] =
                "No CPU/Memory utilization data in CSV";
            }
          }
        }

        // Alternative-strategy picks (Most Cost Optimized / Workload Based /
        // Newest Generation), from the valid pool the primary pick came from.
        const alt = (altSource && altSource.alternatives) || {};
        result[`${providerUpper} Most Cost Optimized`] = formatAlternative(
          alt.cost,
        );
        result[`${providerUpper} Workload Based`] = formatAlternative(
          alt.workload,
        );
        result[`${providerUpper} Newest Generation`] = formatAlternative(
          alt.newestGen,
        );
      } catch (error) {
        console.error(
          `Error processing ${provider} for row ${index + 1}:`,
          error,
        );
        result[`${providerUpper} No Match Reason`] = `Error: ${error.message}`;

        if (generateLikeToLike) {
          result[`${providerUpper} Like-to-Like Instance`] = "Error";
          result[`${providerUpper} Like-to-Like Family`] = "Error";
          result[`${providerUpper} Like-to-Like vCPUs`] = "Error";
          result[`${providerUpper} Like-to-Like Memory (GiB)`] = "Error";
        }

        if (generateOptimized) {
          result[`${providerUpper} Optimized Instance`] = "Error";
          result[`${providerUpper} Optimized Family`] = "Error";
          result[`${providerUpper} Optimized vCPUs`] = "Error";
          result[`${providerUpper} Optimized Memory (GiB)`] = "Error";
        }
        result[`${providerUpper} Most Cost Optimized`] = "Error";
        result[`${providerUpper} Workload Based`] = "Error";
        result[`${providerUpper} Newest Generation`] = "Error";
      }
    });

    results.push(result);

    if (
      onProgress &&
      ((index + 1) % yieldEvery === 0 || index + 1 === csvData.length)
    ) {
      onProgress(index + 1, csvData.length);
      // Yield so the environment can paint / deliver messages
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  console.log("Recommendation generation completed successfully");
  return results;
};

// The utilization statistic a run sizes against. "avg" is the default and the
// historical behaviour; p95/peak are opt-in and only do anything when the CSV
// carries those columns.
//
// Defined HERE rather than in app-core.js for the same reason safeMapGet is:
// this is the one shared-scope module loaded in BOTH the worker and the main
// thread, and app-core.js is not in the worker's importScripts list.
const UTILIZATION_STATISTICS = {
  avg: {
    label: "Average",
    cpu: "CPU Utilization",
    memory: "Memory Utilization",
  },
  p95: {
    label: "p95",
    cpu: "CPU Utilization p95",
    memory: "Memory Utilization p95",
  },
  peak: {
    label: "Peak",
    cpu: "CPU Utilization Peak",
    memory: "Memory Utilization Peak",
  },
};

// Fallback order once the requested statistic is missing for a row. Resolution
// is per ROW, not per run: a fleet export often carries p95 for the monitored
// VMs and only an average for the rest, and dropping those rows to "No
// utilization data" would be worse than sizing them on what they do have.
// Preferring the HIGHER statistic first is deliberate — sizing against a number
// lower than the one asked for under-provisions, which is the failure that hurts.
const UTILIZATION_FALLBACK = {
  avg: ["avg", "p95", "peak"],
  p95: ["p95", "peak", "avg"],
  peak: ["peak", "p95", "avg"],
};

// Reads one dimension (cpu or memory) for a row, walking its OWN fallback chain
// from the requested statistic. `dim` is "cpu" or "memory". Returns
// { value, statistic, fellBack } — `statistic` is the one actually used for
// THIS dimension. Values come from untrusted CSV cells, hence the
// finite/positive test rather than a bare parseFloat.
function resolveDimension(row, want, dim) {
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  for (const key of UTILIZATION_FALLBACK[want]) {
    const value = num(row[UTILIZATION_STATISTICS[key][dim]]);
    if (value > 0) return { value, statistic: key, fellBack: key !== want };
  }
  return { value: 0, statistic: want, fellBack: false };
}

// Resolves utilization for a row under the requested statistic. CPU and memory
// are resolved INDEPENDENTLY, each through its own fallback chain: a fleet
// export often carries an average for one dimension and only a p95 for the
// other, and pinning both to whichever statistic the CPU column happened to
// satisfy would silently discard the memory reading the file actually has —
// under-sizing the memory-based pass. Returns
// { cpu, memory, cpuStatistic, memoryStatistic, cpuFellBack, memoryFellBack }.
function resolveUtilization(row, requested) {
  const want = Object.prototype.hasOwnProperty.call(
    UTILIZATION_STATISTICS,
    requested,
  )
    ? requested
    : "avg";
  const cpu = resolveDimension(row, want, "cpu");
  const memory = resolveDimension(row, want, "memory");
  return {
    cpu: cpu.value,
    memory: memory.value,
    cpuStatistic: cpu.statistic,
    memoryStatistic: memory.statistic,
    cpuFellBack: cpu.fellBack,
    memoryFellBack: memory.fellBack,
  };
}

// The "Sized On" label for a row. When both dimensions used the same statistic
// (the common case — a file with only averages, or a full p95 run) it reads as
// one clean word: "Average", "p95", "Peak", with " (fallback)" when the
// requested statistic was absent. When the two dimensions diverge, or only one
// carries a reading, it names each so a recommendation is never traceable to a
// basis it did not use: "CPU: Average, Mem: p95". Empty when the row carries no
// utilization at all.
function describeSizedOn(util) {
  const hasCpu = util.cpu > 0;
  const hasMem = util.memory > 0;
  if (!hasCpu && !hasMem) return "";
  const part = (stat, fellBack) =>
    UTILIZATION_STATISTICS[stat].label + (fellBack ? " (fallback)" : "");
  if (
    hasCpu &&
    hasMem &&
    util.cpuStatistic === util.memoryStatistic &&
    util.cpuFellBack === util.memoryFellBack
  ) {
    return part(util.cpuStatistic, util.cpuFellBack);
  }
  const bits = [];
  if (hasCpu) bits.push(`CPU: ${part(util.cpuStatistic, util.cpuFellBack)}`);
  if (hasMem)
    bits.push(`Mem: ${part(util.memoryStatistic, util.memoryFellBack)}`);
  return bits.join(", ");
}

// Own-property-only map lookup. Keys here come from untrusted CSV data; a plain
// object literal / JSON.parse result inherits Object.prototype, so a key like
// "constructor" or "toString" would otherwise resolve to an inherited function
// (truthy → wins the || chains → .trim() throws). Defined here because it's the
// one shared-scope module loaded in BOTH the worker and the main thread, so
// ingest.js can reuse the same guard.
function safeMapGet(map, key) {
  return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : "";
}

// Effective workload for a row, in precedence order: the row's own Workload
// cell → an app→workload map entry (matched on the App Name column) → the page
// default → the built-in "General". options.appWorkloadMap is a plain object
// keyed by lowercased app name, so it survives the postMessage into the worker.
function resolveRowWorkload(row, options) {
  const appName = (row["App Name"] || "").trim().toLowerCase();
  const fromApp = appName ? safeMapGet(options.appWorkloadMap, appName) : "";
  return (
    row["Workload"] ||
    fromApp ||
    options.ruleDefaultWorkload ||
    "General"
  ).trim();
}

// Helper function to extract unique regions for a provider
function extractUniqueRegions(csvData, regionColumn, provider) {
  const regions = new Set();

  csvData.forEach((row) => {
    const region = row[regionColumn];
    if (region && region.trim()) {
      regions.add(region.trim());
    }
  });

  // Add default region if none found
  if (regions.size === 0) {
    const defaultRegion =
      InstanceSelectorFactory.getProviderDefaultRegion(provider);
    regions.add(defaultRegion);
    console.log(
      `No regions found for ${provider}, using default: ${defaultRegion}`,
    );
  }

  return regions;
}

// Enhanced utility functions for provider-specific operations
window.getProviderStatistics = function (provider) {
  try {
    const selector = InstanceSelectorFactory.createSelector(provider);
    if (selector.getFilteringStatistics) {
      return selector.getFilteringStatistics();
    }
    return null;
  } catch (error) {
    console.error(`Error getting statistics for ${provider}:`, error);
    return null;
  }
};

window.getAvailableInstanceFamilies = function (provider) {
  try {
    const selector = InstanceSelectorFactory.createSelector(provider);
    return selector.getAvailableFamilies();
  } catch (error) {
    console.error(`Error getting families for ${provider}:`, error);
    return [];
  }
};

window.validateProviderSupport = function (providers) {
  const supported = InstanceSelectorFactory.getSupportedProviders();
  const unsupported = providers.filter(
    (p) => !supported.includes(p.toLowerCase()),
  );

  if (unsupported.length > 0) {
    console.warn(`Unsupported providers: ${unsupported.join(", ")}`);
    console.log(`Supported providers: ${supported.join(", ")}`);
  }

  return unsupported.length === 0;
};

// Export factory class
window.InstanceSelectorFactory = InstanceSelectorFactory;

console.log(
  "Instance Selector Factory initialized with multi-provider support",
);
console.log(
  "Supported providers:",
  InstanceSelectorFactory.getSupportedProviders(),
);

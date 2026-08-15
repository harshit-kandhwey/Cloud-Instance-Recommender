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

// Cloud-to-cloud sizing: infer a type name's provider from its separator alone —
// AWS uses a dot (m5.xlarge), Azure an underscore (Standard_D4s_v5), GCP a hyphen
// (n2-standard-4), disjoint so no data lookup is needed. Returns "aws"|"azure"|"gcp"
// or "" (an unknown type is a No-Match, never a guessed size). Checked dot →
// underscore → hyphen; a real type carries exactly one.
function inferInstanceTypeProvider(type) {
  const t = String(type == null ? "" : type).trim();
  if (!t) return "";
  if (t.includes(".")) return "aws";
  if (/^standard_/i.test(t) || t.includes("_")) return "azure";
  if (t.includes("-")) return "gcp";
  return "";
}
window.inferInstanceTypeProvider = inferInstanceTypeProvider;

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

  // User-defined rules are normalised ONCE for the whole run; the per-row matcher
  // (_matchUserRules) trusts canonical rules. Falls back to the raw list if the
  // normaliser is unavailable (older load order); _matchUserRules is null-tolerant.
  const userRulesNorm =
    options.userRules && options.userRules.length
      ? typeof normalizeUserRules === "function"
        ? normalizeUserRules(options.userRules)
        : options.userRules
      : [];

  // Process each row with all providers
  const results = [];
  for (let index = 0; index < csvData.length; index++) {
    const row = csvData[index];
    const result = { ...row };

    // Utilization is a property of the VM, not of any provider, so it is
    // resolved once per row and shared by every provider's optimized pass.
    const util = resolveUtilization(row, options.utilizationStatistic);
    if (generateOptimized) {
      // Which statistic sized the row. Recorded on every row so a small-looking
      // recommendation can be traced to its basis — especially a fallback, or CPU
      // and memory sized on different statistics.
      result["Sized On"] = describeSizedOn(util);
    }

    // Per-row rule inputs: CSV column → UI page default → built-in default. These
    // four dimensions don't depend on the provider, so they (and the user-rule match
    // reading them) are resolved ONCE per row here, not per provider. Only rowMinGen
    // (native to each cloud) and the exclude-token provider mapping stay in the loop.
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
    const rowUserRules =
      userRulesNorm.length && typeof _matchUserRules === "function"
        ? _matchUserRules(
            {
              env: rowEnv,
              os: rowOS,
              workload: rowWorkload,
              compliance: rowCompliance,
            },
            userRulesNorm,
          )
        : { excludeTokens: [], includeOnlyTokens: [], fired: [] };

    // Effective size for this row. Normally the provisioned CPU Count / Memory (GB).
    // In cloud-to-cloud mode, when BOTH are blank and the row names a Current Instance
    // Type whose specs were resolved on the main thread (options.derivedSpecs, keyed by
    // lowercased type), the size is DERIVED from that type. Explicit CPU/Memory ALWAYS
    // win: derivation only fills a row carrying neither, so a normal upload is
    // untouched. Resolved once per row — the derived size is a property of the VM.
    let cpu = parseInt(row["CPU Count"]) || 0;
    let memory = parseFloat(row["Memory (GB)"]) || 0;
    let sizedFrom = "";
    let c2cUnresolvedType = "";
    if (options.cloudToCloud && cpu === 0 && memory === 0) {
      const currentType = String(row["Current Instance Type"] || "").trim();
      const derived =
        currentType && options.derivedSpecs
          ? safeMapGet(options.derivedSpecs, currentType.toLowerCase())
          : "";
      if (derived && derived.cpu > 0 && derived.memory > 0) {
        cpu = derived.cpu;
        memory = derived.memory;
        sizedFrom = currentType;
      } else if (currentType) {
        // A named source type we couldn't resolve to specs — recorded so the
        // No-Match reason names it, not the generic "CPU Count is 0".
        c2cUnresolvedType = currentType;
      }
    }

    selectedProviders.forEach((provider) => {
      const selector = selectors[provider];
      if (!selector) {
        console.warn(`No selector available for ${provider}`);
        return;
      }

      // cpu / memory are resolved once per row above the provider loop (they do
      // not vary by provider, and in cloud-to-cloud mode may be derived there).
      const cpuUtil = util.cpu;
      const memoryUtil = util.memory;
      const regionColumn =
        InstanceSelectorFactory.getProviderRegionColumn(provider);
      const region = row[regionColumn] || "";

      // rowEnv/rowOS/rowWorkload/rowCompliance are resolved once per row above (they
      // don't vary by provider). MinGen is resolved per PROVIDER, most specific first:
      // this cloud's CSV column, then its page default, then the shared column/default
      // a single-provider page supplies. Each value is native to its cloud, never
      // translated.
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
      // GCP-only: a tighter custom-machine-type suggestion when the standard pick
      // over-provisions. Empty on every GCP row for column consistency; filled below
      // when warranted.
      if (provider === "gcp") result["GCP Custom Fit"] = "";

      // Per-row Exclude: merge CSV "Exclude" column with page-level excludeTypes
      const rowExcludeRaw = (row["Exclude"] || "").trim();
      const rowExcludeExtra = rowExcludeRaw
        ? rowExcludeRaw
            .split(",")
            .map((t) => ({ provider, type: t.trim() }))
            .filter((e) => e.type)
        : [];
      // Per-row Include Only: the symmetric twin of Exclude — an allow-list of
      // families/types this VM may land on, applied as an intersection with run-level
      // filters (see applyFilters). Row-level only for now, so plain token strings
      // scoped to the provider being filtered.
      const rowIncludeRaw = (row["Include Only"] || "").trim();
      const rowIncludeOnly = rowIncludeRaw
        ? rowIncludeRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      // User-defined rules: conditionals the user authored ("if ENV=production,
      // exclude t3"). Each matching rule contributes tokens to the row's Exclude /
      // Include Only (same machinery the CSV columns feed) and its label to Rules
      // Applied. Include Only tokens JOIN the column's allow-list (union); Exclude
      // tokens add to what's dropped. Match is hoisted above the loop; only exclude
      // tokens are re-scoped to this provider (a merged Exclude entry carries
      // { provider, type }).
      const userRuleLabels = rowUserRules.fired;
      const userExcludeExtra = rowUserRules.excludeTokens.map((t) => ({
        provider,
        type: t,
      }));
      const userIncludeOnly = rowUserRules.includeOnlyTokens;
      const mergedExclude = [
        ...(options.excludeTypes || []),
        ...rowExcludeExtra,
        ...userExcludeExtra,
      ];
      const mergedIncludeOnly = [...rowIncludeOnly, ...userIncludeOnly];
      const rowOptions = {
        ...options,
        rowEnv,
        rowOS,
        rowWorkload,
        rowCompliance,
        rowMinGen,
        // The row's resolved utilization, so the rule engine can tell a busy Dev box
        // from an idle one. Same figures that drive the N/2 rules — a rule keyed on
        // "low utilization" and the sizing pass must not disagree on what the row read.
        rowCpuUtil: util.cpu,
        rowMemoryUtil: util.memory,
        excludeTypes: mergedExclude.length
          ? mergedExclude
          : options.excludeTypes,
        includeOnlyTypes: mergedIncludeOnly.length
          ? mergedIncludeOnly
          : options.includeOnlyTypes,
      };

      if (!region || cpu === 0 || memory === 0) {
        const noMatchReason = !region
          ? `No ${providerUpper} region specified in CSV`
          : c2cUnresolvedType
            ? `Current Instance Type "${c2cUnresolvedType}" not recognised — provide CPU Count / Memory (GB)`
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
          // alternatives, and pinning altSource to it would suppress the ones the
          // optimized fallback can supply on a "both" run.
          altSource =
            likeToLike.instanceType === "No data available" ? null : likeToLike;
          result[`${providerUpper} Like-to-Like Instance`] =
            likeToLike.instanceType;
          // The provider's own family category, from the region data — never parsed
          // back out of the instance name (Azure's family isn't a function of its
          // name: b2ms→bs, d16lsv6→dlsv6).
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

        // User-defined rules that fired for this row are named in Rules Applied
        // alongside the built-in rules. Prepended once here so it covers both the
        // like-to-like and optimized-only assignments above.
        if (userRuleLabels.length) {
          const key = `${providerUpper} Rules Applied`;
          result[key] = [userRuleLabels.join(" | "), result[key] || ""]
            .filter(Boolean)
            .join(" | ");
        }

        // GCP custom-machine-type suggestion: when the standard pick (altSource)
        // over-provisions past the threshold and the run doesn't exclude Custom, name
        // the tighter custom shape. No pricing (D8) — the judgement is vCPU/RAM headroom.
        if (
          provider === "gcp" &&
          typeof selector.customFitSuggestion === "function"
        ) {
          result["GCP Custom Fit"] = selector.customFitSuggestion(
            altSource,
            cpu,
            memory,
            rowOptions,
          );
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

    // Family Equivalence: one summary column, multi-cloud runs only — reads each
    // provider's chosen family class and says whether the clouds agree on the KIND of
    // machine. Named in preview.js's allow-list too, or it wouldn't render.
    if (selectedProviders.length > 1) {
      result["Family Equivalence"] = describeFamilyEquivalence(
        result,
        selectedProviders,
      );
    }

    // Cloud-to-cloud transparency: name the source instance type a row's size was
    // derived from (empty for a row sized on its own CPU/Memory). Added for every row
    // only when the mode is on, so the column is absent from a normal upload.
    if (options.cloudToCloud) {
      result["Sized From"] = sizedFrom;
    }

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

// The utilization statistic a run sizes against. "avg" is the default; p95/peak are
// opt-in and only do anything when the CSV carries those columns. Defined HERE, not
// app-core.js (like safeMapGet): this is the one shared module loaded in BOTH the
// worker and main thread, and app-core.js isn't in the worker's importScripts.
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

// Fallback order once the requested statistic is missing for a row. Per ROW, not per
// run: a fleet export often has p95 for monitored VMs and only an average for the
// rest, and dropping those to "No utilization data" is worse than sizing on what they
// have. Preferring the HIGHER statistic first is deliberate — sizing lower under-provisions.
const UTILIZATION_FALLBACK = {
  avg: ["avg", "p95", "peak"],
  p95: ["p95", "peak", "avg"],
  peak: ["peak", "p95", "avg"],
};

// Reads one dimension (cpu/memory) for a row, walking its OWN fallback chain from the
// requested statistic. Returns { value, statistic, fellBack } — statistic is the one
// actually used. Values are untrusted CSV cells, hence the finite/positive test.
function resolveDimension(row, want, dim) {
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  for (const key of UTILIZATION_FALLBACK[want]) {
    const column = UTILIZATION_STATISTICS[key][dim];
    // Own properties only. Every row is asked for the same six column names, so an
    // INHERITED property of one would be returned for every VM — a single polluted
    // prototype re-sizing a whole fleet off a reading in nobody's upload.
    const value = Object.prototype.hasOwnProperty.call(row, column)
      ? num(row[column])
      : 0;
    if (value > 0) return { value, statistic: key, fellBack: key !== want };
  }
  return { value: 0, statistic: want, fellBack: false };
}

// Resolves utilization for a row under the requested statistic. CPU and memory are
// resolved INDEPENDENTLY, each through its own fallback chain: a fleet export often
// carries an average for one dimension and a p95 for the other, and pinning both to
// whichever the CPU column satisfied would discard the memory reading — under-sizing
// the memory pass. Returns
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

// The "Sized On" label for a row. When both dimensions used the same statistic (the
// common case) it reads as one word: "Average"/"p95"/"Peak", plus " (fallback)" when
// the requested statistic was absent. When they diverge, or only one has a reading,
// it names each ("CPU: Average, Mem: p95"). Empty when the row carries no utilization.
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

// Fold a provider's own family-class name to a shared class, so a multi-cloud row
// reads as "did the clouds land on the same KIND of machine?". The three clouds write
// "General purpose"/"Compute optimized"/"Memory optimized"/"Storage optimized"
// verbatim (pass through unchanged); only the accelerator class has three names (AWS
// "GPU instance"/"…ASIC…"/"FPGA…", Azure "GPU", GCP "Accelerator optimized"), folded
// to one. Anything unrecognised passes through unmapped. The test mirrors
// RuleEngine.isAccelerator — `\basic\b`, not "basic", so "Basic tier" isn't swept in.
function normalizeFamilyClass(familyName) {
  const n = String(familyName || "").trim();
  if (!n) return "";
  if (/\bgpu\b|accelerat|\basic\b|\bfpga\b|\btpu\b/i.test(n))
    return "Accelerator";
  return n;
}

// The "Family Equivalence" cell for a multi-cloud row: each provider's chosen family
// class, folded and compared. Reads the like-to-like family when present, else the
// optimized — ONE column. "General purpose on AWS, AZURE, GCP" when they agree, else
// "Differs — AWS General purpose, GCP Memory optimized". Empty when none to compare.
function describeFamilyEquivalence(result, providers) {
  const usable = (v) => v && v !== "N/A" && v !== "Error";
  const entries = [];
  for (const provider of providers) {
    const P = provider.toUpperCase();
    const l2l = result[`${P} Like-to-Like Family`];
    const opt = result[`${P} Optimized Family`];
    const chosen = usable(l2l) ? l2l : usable(opt) ? opt : "";
    const cls = normalizeFamilyClass(chosen);
    if (cls) entries.push([P, cls]);
  }
  if (!entries.length) return "";
  const classes = entries.map(([, cls]) => cls);
  const allSame = classes.every((c) => c === classes[0]);
  return allSame
    ? `${classes[0]} on ${entries.map(([P]) => P).join(", ")}`
    : `Differs — ${entries.map(([P, cls]) => `${P} ${cls}`).join(", ")}`;
}

// Own-property-only map lookup. Keys come from untrusted CSV data; a plain object /
// JSON.parse result inherits Object.prototype, so a key like "constructor" would
// resolve to an inherited function (truthy → wins the || chains → .trim() throws).
// Defined here (shared by worker and main thread) so ingest.js reuses the same guard.
function safeMapGet(map, key) {
  return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : "";
}

// Effective workload for a row, in precedence order: the row's own Workload cell →
// an app→workload map entry (matched on App Name) → the page default → "General".
// options.appWorkloadMap is a plain object keyed by lowercased app name.
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

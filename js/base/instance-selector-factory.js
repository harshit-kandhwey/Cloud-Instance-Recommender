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

  static getProviderDefaultRegion(provider) {
    const defaultRegions = {
      aws: "us-east-1",
      azure: "East US",
      gcp: "us-central1-a",
    };
    return defaultRegions[provider.toLowerCase()];
  }
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

    selectedProviders.forEach((provider) => {
      const selector = selectors[provider];
      if (!selector) {
        console.warn(`No selector available for ${provider}`);
        return;
      }

      const cpu = parseInt(row["CPU Count"]) || 0;
      const memory = parseFloat(row["Memory (GB)"]) || 0;
      const cpuUtil = parseFloat(row["CPU Utilization"]) || 0;
      const memoryUtil = parseFloat(row["Memory Utilization"]) || 0;
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
      const rowMinGen = (
        row["Min Gen"] ||
        row["MinGen"] ||
        options.ruleDefaultMinGen ||
        ""
      ).trim();

      const providerUpper = provider.toUpperCase();

      // Always initialize shared columns so schema is consistent across all rows
      result[`${providerUpper} Rules Applied`] = "";
      result[`${providerUpper} No Match Reason`] = "";

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
          result[`${providerUpper} Like-to-Like vCPUs`] = "N/A";
          result[`${providerUpper} Like-to-Like Memory (GiB)`] = "N/A";
        }

        if (generateOptimized) {
          result[`${providerUpper} Optimized Instance`] = "Missing data";
          result[`${providerUpper} Optimized vCPUs`] = "N/A";
          result[`${providerUpper} Optimized Memory (GiB)`] = "N/A";
        }
        return;
      }

      try {
        if (generateLikeToLike) {
          const likeToLike = selector.getLikeToLikeInstance(
            region,
            cpu,
            memory,
            rowOptions,
          );
          result[`${providerUpper} Like-to-Like Instance`] =
            likeToLike.instanceType;
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
            result[`${providerUpper} Optimized Instance`] =
              optimized.instanceType;
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
              }
            }
          } else {
            result[`${providerUpper} Optimized Instance`] =
              "No utilization data";
            result[`${providerUpper} Optimized vCPUs`] = "N/A";
            result[`${providerUpper} Optimized Memory (GiB)`] = "N/A";
            if (!generateLikeToLike) {
              result[`${providerUpper} No Match Reason`] =
                "No CPU/Memory utilization data in CSV";
            }
          }
        }
      } catch (error) {
        console.error(
          `Error processing ${provider} for row ${index + 1}:`,
          error,
        );
        result[`${providerUpper} No Match Reason`] = `Error: ${error.message}`;

        if (generateLikeToLike) {
          result[`${providerUpper} Like-to-Like Instance`] = "Error";
          result[`${providerUpper} Like-to-Like vCPUs`] = "Error";
          result[`${providerUpper} Like-to-Like Memory (GiB)`] = "Error";
        }

        if (generateOptimized) {
          result[`${providerUpper} Optimized Instance`] = "Error";
          result[`${providerUpper} Optimized vCPUs`] = "Error";
          result[`${providerUpper} Optimized Memory (GiB)`] = "Error";
        }
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

// Effective workload for a row, in precedence order: the row's own Workload
// cell → an app→workload map entry (matched on the App Name column) → the page
// default → the built-in "General". options.appWorkloadMap is a plain object
// keyed by lowercased app name, so it survives the postMessage into the worker.
function resolveRowWorkload(row, options) {
  const appName = (row["App Name"] || "").trim().toLowerCase();
  // hasOwnProperty guard: appName is untrusted CSV data. Without it, an app
  // named "constructor"/"toString"/etc. resolves to an inherited Object.prototype
  // function — truthy, so it wins the || chain, and .trim() then throws.
  const fromApp =
    appName &&
    options.appWorkloadMap &&
    Object.prototype.hasOwnProperty.call(options.appWorkloadMap, appName)
      ? options.appWorkloadMap[appName]
      : "";
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

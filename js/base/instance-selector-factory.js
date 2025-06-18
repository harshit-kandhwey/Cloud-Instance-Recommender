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

// Enhanced integration function with multi-provider support
window.getInstanceRecommendationWithSelector = async function (
  csvData,
  selectedProviders,
  options
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
      const selector = InstanceSelectorFactory.createSelector(provider);

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
        })
      );
    } catch (error) {
      console.error(`Failed to create selector for ${provider}:`, error);
    }
  }

  // Wait for all selectors to initialize
  await Promise.all(initPromises);

  console.log("All selectors initialized. Processing CSV data...");

  // Process each row with all providers
  const results = csvData.map((row, index) => {
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

      const providerUpper = provider.toUpperCase();

      if (!region || cpu === 0 || memory === 0) {
        console.warn(`Missing data for ${provider} in row ${index + 1}`);

        if (generateLikeToLike) {
          result[`${providerUpper} Like-to-Like Instance`] = "Missing data";
          result[`${providerUpper} Like-to-Like Price`] = "N/A";
          result[`${providerUpper} Like-to-Like vCPUs`] = "N/A";
          result[`${providerUpper} Like-to-Like Memory`] = "N/A";
        }

        if (generateOptimized) {
          result[`${providerUpper} Optimized Instance`] = "Missing data";
          result[`${providerUpper} Optimized Price`] = "N/A";
          result[`${providerUpper} Optimized vCPUs`] = "N/A";
          result[`${providerUpper} Optimized Memory`] = "N/A";
        }
        return;
      }

      try {
        // Get like-to-like recommendation only if requested
        if (generateLikeToLike) {
          const likeToLike = selector.getLikeToLikeInstance(
            region,
            cpu,
            memory,
            options
          );
          result[`${providerUpper} Like-to-Like Instance`] =
            likeToLike.instanceType;
          result[`${providerUpper} Like-to-Like Price`] =
            likeToLike.hourlyPrice;
          result[`${providerUpper} Like-to-Like vCPUs`] = likeToLike.vCpus;
          result[`${providerUpper} Like-to-Like Memory`] = likeToLike.memory;
        }

        // Get optimized recommendation only if requested and utilization data available
        if (generateOptimized) {
          if (cpuUtil > 0 || memoryUtil > 0) {
            const optimized = selector.getOptimizedInstance(
              region,
              cpu,
              memory,
              cpuUtil,
              memoryUtil,
              options
            );
            result[`${providerUpper} Optimized Instance`] =
              optimized.instanceType;
            result[`${providerUpper} Optimized Price`] = optimized.hourlyPrice;
            result[`${providerUpper} Optimized vCPUs`] = optimized.vCpus;
            result[`${providerUpper} Optimized Memory`] = optimized.memory;
          } else {
            result[`${providerUpper} Optimized Instance`] =
              "No utilization data";
            result[`${providerUpper} Optimized Price`] = "N/A";
            result[`${providerUpper} Optimized vCPUs`] = "N/A";
            result[`${providerUpper} Optimized Memory`] = "N/A";
          }
        }
      } catch (error) {
        console.error(
          `Error processing ${provider} for row ${index + 1}:`,
          error
        );

        if (generateLikeToLike) {
          result[`${providerUpper} Like-to-Like Instance`] = "Error";
          result[`${providerUpper} Like-to-Like Price`] = "Error";
          result[`${providerUpper} Like-to-Like vCPUs`] = "Error";
          result[`${providerUpper} Like-to-Like Memory`] = "Error";
        }

        if (generateOptimized) {
          result[`${providerUpper} Optimized Instance`] = "Error";
          result[`${providerUpper} Optimized Price`] = "Error";
          result[`${providerUpper} Optimized vCPUs`] = "Error";
          result[`${providerUpper} Optimized Memory`] = "Error";
        }
      }
    });

    return result;
  });

  console.log("Recommendation generation completed successfully");
  return results;
};

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
      `No regions found for ${provider}, using default: ${defaultRegion}`
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
    (p) => !supported.includes(p.toLowerCase())
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
  "Instance Selector Factory initialized with multi-provider support"
);
console.log(
  "Supported providers:",
  InstanceSelectorFactory.getSupportedProviders()
);

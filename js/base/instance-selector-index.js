/*
 * Cloud Instance Selector - Modular Multi-Provider Architecture
 *
 * This is the main index file that demonstrates how to use the modular
 * instance selector system. The system has been split into:
 *
 * 1. base-instance-selector.js - Common functionality for all providers
 * 2. aws-instance-selector.js - AWS-specific implementation
 * 3. azure-instance-selector.js - Azure-specific implementation
 * 4. gcp-instance-selector.js - GCP-specific implementation
 * 5. instance-selector-factory.js - Factory and integration functions
 *
 * USAGE INSTRUCTIONS:
 * ==================
 *
 * 1. Include all files in your HTML in this order:
 *    <script src="base-instance-selector.js"></script>
 *    <script src="aws-instance-selector.js"></script>
 *    <script src="azure-instance-selector.js"></script>
 *    <script src="gcp-instance-selector.js"></script>
 *    <script src="instance-selector-factory.js"></script>
 *
 * 2. Use the main integration function:
 *    const results = await getInstanceRecommendationWithSelector(
 *      csvData,
 *      ['aws', 'azure', 'gcp'],
 *      options
 *    );
 *
 * 3. Or create individual selectors:
 *    const awsSelector = InstanceSelectorFactory.createSelector('aws');
 *    await awsSelector.initialize(csvData, regions);
 *    const recommendation = awsSelector.getLikeToLikeInstance(region, cpu, memory, options);
 */

// Example usage demonstration
async function demonstrateInstanceSelector() {
  console.log("=== Cloud Instance Selector Demo ===");

  // Example CSV data structure
  const sampleCsvData = [
    {
      "Server Name": "web-server-01",
      "CPU Count": 2,
      "Memory (GB)": 8,
      "CPU Utilization": 45,
      "Memory Utilization": 60,
      "AWS Region": "us-east-1",
      "Azure Region": "East US",
      "GCP Region": "us-central1-a",
    },
    {
      "Server Name": "db-server-01",
      "CPU Count": 4,
      "Memory (GB)": 16,
      "CPU Utilization": 75,
      "Memory Utilization": 80,
      "AWS Region": "us-west-2",
      "Azure Region": "West US 2",
      "GCP Region": "us-west1-a",
    },
  ];

  // Example filtering options
  const options = {
    // Control which recommendation types to generate
    generateLikeToLike: true, // Generate like-to-like recommendations (default: true)
    generateOptimized: false, // Generate optimized recommendations (default: false)

    // AWS-specific filters
    currentGenerationOnly: true,
    restrictInstanceFamilyNames: false,
    selectedInstanceFamilyNames: ["General purpose", "Compute optimized"],
    restrictProcessorManufacturers: false,
    selectedProcessorManufacturers: ["Intel", "AWS"],
    excludeGraviton: false,

    // Multi-provider filters
    restrictMainFamilies: false,
    selectedMainFamilies: ["m", "c", "r"],
    excludeTypes: [],

    // Optimization strategy parameters (N/2, N, N+1) - only used if generateOptimized: true
    cpuBased: true,
    memoryBased: true,
    cpuDownsizeMax: 30, // Downsize if CPU utilization <= 30%
    cpuUpsizeMin: 80, // Upsize if CPU utilization > 80%
    memoryDownsizeMax: 40, // Downsize if Memory utilization <= 40%
    memoryUpsizeMin: 85, // Upsize if Memory utilization > 85%
  };

  try {
    // Validate provider support
    const selectedProviders = ["aws", "azure", "gcp"];
    const isValid = validateProviderSupport(selectedProviders);

    if (!isValid) {
      console.error("Some providers are not supported");
      return;
    }

    console.log("Providers validated successfully");

    // Generate recommendations for all providers
    console.log("Generating recommendations...");
    const results = await getInstanceRecommendationWithSelector(
      sampleCsvData,
      selectedProviders,
      options
    );

    // Display results
    console.log("=== RESULTS ===");
    results.forEach((result, index) => {
      console.log(`\nServer ${index + 1}: ${result["Server Name"]}`);
      console.log(
        `Original: ${result["CPU Count"]}vCPU, ${result["Memory (GB)"]}GB`
      );
      console.log(
        `Utilization: CPU ${result["CPU Utilization"]}%, Memory ${result["Memory Utilization"]}%`
      );

      selectedProviders.forEach((provider) => {
        const providerUpper = provider.toUpperCase();
        console.log(`\n${providerUpper}:`);
        console.log(
          `  Like-to-Like: ${
            result[`${providerUpper} Like-to-Like Instance`]
          } - $${result[`${providerUpper} Like-to-Like Price`]}/month`
        );
        console.log(
          `  Optimized: ${result[`${providerUpper} Optimized Instance`]} - $${
            result[`${providerUpper} Optimized Price`]
          }/month`
        );
      });
    });

    // Get provider statistics
    console.log("\n=== PROVIDER STATISTICS ===");
    selectedProviders.forEach((provider) => {
      const stats = getProviderStatistics(provider);
      if (stats) {
        console.log(`\n${provider.toUpperCase()} Statistics:`);
        console.log(`  Total Instances: ${stats.totalInstances}`);
        console.log(
          `  Current Generation: ${stats.currentGeneration} (${stats.currentGenerationPercentage}%)`
        );
        console.log(
          `  Processor Types:`,
          Object.keys(stats.processorBreakdown)
        );
        console.log(
          `  Instance Families: ${
            Object.keys(stats.familyNameBreakdown).length
          }`
        );
      }
    });
  } catch (error) {
    console.error("Demo failed:", error);
  }
}

// Individual provider usage examples
async function demonstrateAWSSelector() {
  console.log("\n=== AWS Selector Demo ===");

  try {
    // Create AWS-specific selector
    const awsSelector = InstanceSelectorFactory.createSelector("aws");

    // Initialize with regions
    await awsSelector.initialize([], new Set(["us-east-1", "us-west-2"]));

    // Get recommendation with AWS-specific filtering
    const awsOptions = {
      currentGenerationOnly: true,
      restrictProcessorManufacturers: true,
      selectedProcessorManufacturers: ["Intel", "AWS"], // Include Graviton
      excludeGraviton: false, // Allow Graviton instances
    };

    const recommendation = awsSelector.getLikeToLikeInstance(
      "us-east-1",
      2, // 2 vCPUs
      8, // 8GB RAM
      awsOptions
    );

    console.log("AWS Recommendation:", recommendation);

    // Get AWS-specific statistics
    const stats = awsSelector.getFilteringStatistics();
    console.log("AWS Graviton instances available:", stats.gravitonInstances);
    console.log("AWS Nitro instances available:", stats.nitroInstances);
  } catch (error) {
    console.error("AWS demo failed:", error);
  }
}

// Example usage scenarios for different recommendation types
async function demonstrateRecommendationTypes() {
  console.log("\n=== Recommendation Types Demo ===");

  const sampleData = [
    {
      "Server Name": "web-server-01",
      "CPU Count": 2,
      "Memory (GB)": 8,
      "CPU Utilization": 45,
      "Memory Utilization": 60,
      "AWS Region": "us-east-1",
      "Azure Region": "East US",
      "GCP Region": "us-central1-a",
    },
  ];

  // Scenario 1: Only Like-to-Like recommendations
  console.log("\n--- Scenario 1: Like-to-Like Only ---");
  const likeToLikeOnly = await getInstanceRecommendationWithSelector(
    sampleData,
    ["aws"],
    {
      generateLikeToLike: true, // Generate like-to-like
      generateOptimized: false, // Skip optimized
      currentGenerationOnly: true,
    }
  );

  console.log("Like-to-like only result:");
  console.log(
    `AWS Like-to-Like: ${likeToLikeOnly[0]["AWS Like-to-Like Instance"]}`
  );
  console.log(
    `AWS Optimized: ${
      likeToLikeOnly[0]["AWS Optimized Instance"] || "Not generated"
    }`
  );

  // Scenario 2: Only Optimized recommendations
  console.log("\n--- Scenario 2: Optimized Only ---");
  const optimizedOnly = await getInstanceRecommendationWithSelector(
    sampleData,
    ["aws"],
    {
      generateLikeToLike: false, // Skip like-to-like
      generateOptimized: true, // Generate optimized
      cpuBased: true,
      memoryBased: true,
      cpuDownsizeMax: 30,
      cpuUpsizeMin: 80,
      memoryDownsizeMax: 40,
      memoryUpsizeMin: 85,
    }
  );

  console.log("Optimized only result:");
  console.log(
    `AWS Like-to-Like: ${
      optimizedOnly[0]["AWS Like-to-Like Instance"] || "Not generated"
    }`
  );
  console.log(`AWS Optimized: ${optimizedOnly[0]["AWS Optimized Instance"]}`);

  // Scenario 3: Both recommendations
  console.log("\n--- Scenario 3: Both Recommendations ---");
  const bothRecommendations = await getInstanceRecommendationWithSelector(
    sampleData,
    ["aws"],
    {
      generateLikeToLike: true, // Generate like-to-like
      generateOptimized: true, // Generate optimized
      currentGenerationOnly: true,
      cpuBased: true,
      memoryBased: true,
    }
  );

  console.log("Both recommendations result:");
  console.log(
    `AWS Like-to-Like: ${bothRecommendations[0]["AWS Like-to-Like Instance"]}`
  );
  console.log(
    `AWS Optimized: ${bothRecommendations[0]["AWS Optimized Instance"]}`
  );
}
async function demonstrateOptimizationStrategy() {
  console.log("\n=== N/2, N, N+1 Optimization Strategy Demo ===");

  const awsSelector = InstanceSelectorFactory.createSelector("aws");
  await awsSelector.initialize([], new Set(["us-east-1"]));

  // Test different utilization scenarios
  const scenarios = [
    {
      name: "Low Utilization",
      cpu: 4,
      memory: 16,
      cpuUtil: 25,
      memoryUtil: 30,
    },
    {
      name: "Optimal Utilization",
      cpu: 4,
      memory: 16,
      cpuUtil: 55,
      memoryUtil: 65,
    },
    {
      name: "High Utilization",
      cpu: 4,
      memory: 16,
      cpuUtil: 85,
      memoryUtil: 90,
    },
  ];

  const optimizationOptions = {
    cpuBased: true,
    memoryBased: true,
    cpuDownsizeMax: 30,
    cpuUpsizeMin: 80,
    memoryDownsizeMax: 40,
    memoryUpsizeMin: 85,
  };

  scenarios.forEach((scenario) => {
    console.log(`\n${scenario.name}:`);
    console.log(`  Current: ${scenario.cpu}vCPU, ${scenario.memory}GB`);
    console.log(
      `  Utilization: ${scenario.cpuUtil}% CPU, ${scenario.memoryUtil}% Memory`
    );

    const optimized = awsSelector.getOptimizedInstance(
      "us-east-1",
      scenario.cpu,
      scenario.memory,
      scenario.cpuUtil,
      scenario.memoryUtil,
      optimizationOptions
    );

    console.log(
      `  Recommendation: ${optimized.instanceType} (${optimized.vCpus}vCPU, ${optimized.memory}GB)`
    );
    console.log(`  Strategy: ${optimized.reason}`);
  });
}

// Export demo functions for manual testing
window.demonstrateInstanceSelector = demonstrateInstanceSelector;
window.demonstrateAWSSelector = demonstrateAWSSelector;
window.demonstrateRecommendationTypes = demonstrateRecommendationTypes;
window.demonstrateOptimizationStrategy = demonstrateOptimizationStrategy;

// Auto-run demo if this is loaded in browser
if (typeof window !== "undefined") {
  console.log("Instance Selector system loaded successfully!");
  console.log("Available demo functions:");
  console.log("- demonstrateInstanceSelector()");
  console.log("- demonstrateAWSSelector()");
  console.log("- demonstrateRecommendationTypes()");
  console.log("- demonstrateOptimizationStrategy()");
  console.log("\nRun any of these functions to see the system in action.");
}

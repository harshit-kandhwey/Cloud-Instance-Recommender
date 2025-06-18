// Base Instance Selector - Common functionality for all cloud providers
// Provides shared methods and the foundation for provider-specific implementations

class BaseInstanceSelector {
  constructor() {
    this.instanceData = {};
    this.loadedRegions = new Set();
    this.isInitialized = false;
  }

  // Common initialization logic
  async initialize(csvData, regions) {
    this.isInitialized = false;
    console.log(`Initializing ${this.getProviderName()} InstanceSelector`);

    await this.loadInstanceData(regions);
    this.isInitialized = true;
    console.log(`${this.getProviderName()} InstanceSelector initialized`);
  }

  // Abstract methods to be implemented by provider-specific classes
  getProviderName() {
    throw new Error("getProviderName must be implemented by provider class");
  }

  getFieldMappings() {
    throw new Error("getFieldMappings must be implemented by provider class");
  }

  getSampleData() {
    throw new Error("getSampleData must be implemented by provider class");
  }

  normalizeRegionForJS(region) {
    throw new Error(
      "normalizeRegionForJS must be implemented by provider class"
    );
  }

  // Common region extraction logic
  extractUniqueRegions(csvData, regionColumn) {
    const regions = new Set();

    csvData.forEach((row) => {
      const region = row[regionColumn];
      if (region && region.trim()) {
        regions.add(region.trim());
      }
    });

    return regions;
  }

  // Common data loading orchestration
  async loadInstanceData(regions) {
    console.log(`Loading instance data for ${this.getProviderName()}`);

    const loadPromises = [];
    regions.forEach((region) => {
      const regionKey = `${this.getProviderName().toLowerCase()}-${region}`;
      if (!this.loadedRegions.has(regionKey)) {
        loadPromises.push(this.loadRegionData(region));
      }
    });

    await Promise.all(loadPromises);
  }

  // Load data for specific region
  async loadRegionData(region) {
    try {
      console.log(`Loading data for ${this.getProviderName()} ${region}`);

      const normalizedRegion = this.normalizeRegionForJS(region);
      let regionData;

      try {
        regionData = this.getRegionDataFromGlobal(normalizedRegion);
        console.log(
          `Successfully retrieved ${normalizedRegion} data from global object`
        );
      } catch (fetchError) {
        console.warn(
          `Failed to get ${normalizedRegion} data from global object, using fallback:`,
          fetchError
        );
        regionData = this.getFallbackData();
      }

      const instances = this.parseData(regionData, region);
      this.instanceData[region] = instances;
      this.loadedRegions.add(
        `${this.getProviderName().toLowerCase()}-${region}`
      );

      this.logLoadingStatistics(instances, region);
    } catch (error) {
      console.error(
        `Failed to load data for ${this.getProviderName()} ${region}:`,
        error
      );
      this.instanceData[region] = this.getFallbackInstances(region);
    }
  }

  // Get region data from global window object
  getRegionDataFromGlobal(normalizedRegion) {
    const regionData = window[normalizedRegion];
    if (!regionData) {
      throw new Error(`Global variable ${normalizedRegion} not found`);
    }
    return regionData;
  }

  // Parse data into standardized format
  parseData(regionData, region) {
    if (!regionData || typeof regionData !== "object") {
      console.warn(`Invalid data for ${this.getProviderName()} ${region}`);
      return [];
    }

    const mapping = this.getFieldMappings();
    const instances = [];

    Object.entries(regionData).forEach(([instanceType, instanceDetails]) => {
      try {
        const standardized = this.createStandardizedInstance(
          instanceType,
          instanceDetails,
          region,
          mapping
        );

        if (this.isValidInstance(standardized)) {
          instances.push(standardized);
        }
      } catch (error) {
        console.warn(
          `Error parsing instance ${instanceType} for ${this.getProviderName()} ${region}:`,
          error
        );
      }
    });

    instances.sort((a, b) => a.price - b.price);
    console.log(`Parsed ${instances.length} valid instances`);
    return instances;
  }

  // Create standardized instance object
  createStandardizedInstance(instanceType, instanceDetails, region, mapping) {
    return {
      instanceType: instanceType,
      vCpus: parseInt(instanceDetails[mapping.vCpus]) || 0,
      memory: parseFloat(instanceDetails[mapping.memory]) || 0,
      price: parseFloat(instanceDetails[mapping.price]) || 0,
      family: instanceDetails[mapping.family] || "",
      familyName: instanceDetails[mapping.familyName] || "",
      location: region,
      processor: instanceDetails[mapping.processor] || "Intel",
      generation: parseFloat(instanceDetails[mapping.generation]) || 0,
      isGraviton: parseFloat(instanceDetails[mapping.isGraviton]) || 0,
      originalData: instanceDetails,
    };
  }

  // Validate instance data
  isValidInstance(instance) {
    return (
      instance.instanceType &&
      instance.vCpus > 0 &&
      instance.memory > 0 &&
      instance.price > 0
    );
  }

  // Get fallback data
  getFallbackData() {
    const sampleData = this.getSampleData();
    const jsData = {};
    const mapping = this.getFieldMappings();

    sampleData.forEach((instance) => {
      jsData[instance.instanceType] = this.createJSDataFromSample(
        instance,
        mapping
      );
    });

    return jsData;
  }

  // Create JS data structure from sample
  createJSDataFromSample(instance, mapping) {
    const jsInstance = {};
    Object.entries(mapping).forEach(([key, field]) => {
      jsInstance[field] = instance[key];
    });
    return jsInstance;
  }

  // Get fallback instances
  getFallbackInstances(region) {
    return this.getSampleData().map((instance) => ({
      ...instance,
      location: region,
      originalData: instance,
    }));
  }

  // Log loading statistics
  logLoadingStatistics(instances, region) {
    const currentGenCount = instances.filter(
      (i) => i.generation === 1.0 || i.generation === "1.0"
    ).length;
    const familyTypes = new Set(instances.map((i) => i.familyName)).size;

    console.log(
      `Loaded ${
        instances.length
      } instances for ${this.getProviderName()} ${region}`
    );
    console.log(`  - Current Generation: ${currentGenCount} instances`);
    console.log(`  - Family Types: ${familyTypes} categories`);
  }

  // Common like-to-like instance selection
  getLikeToLikeInstance(region, currentCpu, currentMemory, options = {}) {
    console.log(
      `Getting like-to-like for ${this.getProviderName()} ${region}: ${currentCpu}vCPU, ${currentMemory}GB`
    );

    const regionData = this.instanceData[region];
    if (!regionData?.length) {
      console.warn(`No data available for ${this.getProviderName()} ${region}`);
      return this.createEmptyResult("Region data not loaded");
    }

    const filteredInstances = this.applyFilters(
      regionData,
      currentCpu,
      currentMemory,
      options
    );

    if (!filteredInstances.length) {
      console.warn(
        `No instances meet filtering criteria for ${this.getProviderName()} ${region}`
      );
      return this.createEmptyResult("No instances meet filtering requirements");
    }

    const bestInstance = filteredInstances.reduce((cheapest, current) => {
      return current.price < cheapest.price ? current : cheapest;
    });

    console.log(
      `Selected ${
        bestInstance.instanceType
      } for ${this.getProviderName()} ${region}`
    );

    return this.createInstanceResult(bestInstance, currentCpu, currentMemory);
  }

  // Apply common filters
  applyFilters(instances, currentCpu, currentMemory, options) {
    return instances.filter((instance) => {
      // Must meet or exceed CPU and Memory requirements
      if (instance.vCpus < currentCpu || instance.memory < currentMemory) {
        return false;
      }

      // Current Generation Filter
      if (
        options.currentGenerationOnly &&
        instance.generation !== 1.0 &&
        instance.generation !== "1.0"
      ) {
        return false;
      }

      // Instance Family Name Filter
      if (
        options.restrictInstanceFamilyNames &&
        options.selectedInstanceFamilyNames?.length > 0
      ) {
        if (
          !options.selectedInstanceFamilyNames.includes(instance.familyName)
        ) {
          return false;
        }
      }

      // Processor Manufacturer Filter
      if (
        options.restrictProcessorManufacturers &&
        options.selectedProcessorManufacturers?.length > 0
      ) {
        if (
          !options.selectedProcessorManufacturers.includes(instance.processor)
        ) {
          return false;
        }
      }

      // Exclude types
      if (options.excludeTypes?.length > 0) {
        if (
          options.excludeTypes.some((excludeItem) => {
            if (typeof excludeItem === "string") {
              return instance.instanceType
                .toLowerCase()
                .includes(excludeItem.toLowerCase());
            }
            return false;
          })
        ) {
          return false;
        }
      }

      return true;
    });
  }

  // N/2, N, N+1 optimization strategy
  getOptimizedInstance(
    region,
    currentCpu,
    currentMemory,
    cpuUtil,
    memoryUtil,
    options = {}
  ) {
    console.log(
      `Getting optimized for ${this.getProviderName()} ${region}: ${currentCpu}vCPU, ${currentMemory}GB, CPU:${cpuUtil}%, Mem:${memoryUtil}%`
    );
    console.log("Using N/2, N, N+1 optimization strategy");

    let targetCpu = currentCpu;
    let targetMemory = currentMemory;

    // Apply N/2, N, N+1 strategy
    if (options.cpuBased && cpuUtil > 0) {
      if (cpuUtil <= options.cpuDownsizeMax) {
        targetCpu = Math.max(1, Math.ceil(currentCpu / 2));
        console.log(
          `CPU Downsizing (N/2): ${currentCpu} -> ${targetCpu} vCPUs`
        );
      } else if (cpuUtil > options.cpuUpsizeMin) {
        targetCpu = currentCpu + 1;
        console.log(`CPU Upsizing (N+1): ${currentCpu} -> ${targetCpu} vCPUs`);
      }
    }

    if (options.memoryBased && memoryUtil > 0) {
      if (memoryUtil <= options.memoryDownsizeMax) {
        targetMemory = Math.max(1, Math.ceil(currentMemory / 2));
        console.log(
          `Memory Downsizing (N/2): ${currentMemory} -> ${targetMemory} GB`
        );
      } else if (memoryUtil > options.memoryUpsizeMin) {
        targetMemory = currentMemory + 1;
        console.log(
          `Memory Upsizing (N+1): ${currentMemory} -> ${targetMemory} GB`
        );
      }
    }

    const result = this.getLikeToLikeInstance(
      region,
      targetCpu,
      targetMemory,
      options
    );
    result.reason = `N/2, N, N+1 Strategy optimization from ${currentCpu}vCPU/${currentMemory}GB to ${targetCpu}vCPU/${targetMemory}GB based on utilization (CPU:${cpuUtil}%, Mem:${memoryUtil}%)`;

    return result;
  }

  // Create empty result
  createEmptyResult(reason) {
    return {
      instanceType: "No data available",
      vCpus: 0,
      memory: 0,
      price: 0,
      hourlyPrice: "0.00",
      reason: reason,
    };
  }

  // Create instance result
  createInstanceResult(instance, currentCpu, currentMemory) {
    return {
      instanceType: instance.instanceType,
      vCpus: instance.vCpus,
      memory: instance.memory,
      price: instance.price,
      hourlyPrice: instance.price.toFixed(4),
      processor: instance.processor,
      familyName: instance.familyName,
      generation: instance.generation,
      reason: `Selected based on >=${currentCpu}vCPU and >=${currentMemory}GB - cheapest match`,
    };
  }

  // Get instance family from instance type
  getInstanceFamily(instanceType) {
    const match = instanceType.match(/^([a-z]+\d+[a-z]*)/i);
    return match ? match[1] : "";
  }

  // Get main instance family (simplified)
  getMainInstanceFamily(instanceType) {
    const match = instanceType.match(/^([a-z]+)/i);
    return match ? match[1].toLowerCase() : "";
  }

  // Get available families
  getAvailableFamilies() {
    const families = new Set();

    Object.values(this.instanceData).forEach((regionData) => {
      regionData.forEach((instance) => {
        if (instance.family) {
          families.add(instance.family);
        }
      });
    });

    if (families.size === 0) {
      this.getSampleData().forEach((instance) => {
        if (instance.family) {
          families.add(instance.family);
        }
      });
    }

    return Array.from(families).sort();
  }
}

// Export base class
window.BaseInstanceSelector = BaseInstanceSelector;

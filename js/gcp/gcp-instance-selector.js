// GCP Instance Selector - GCP-specific implementation
// Extends BaseInstanceSelector with GCP-specific functionality

class GCPInstanceSelector extends BaseInstanceSelector {
  constructor() {
    super();

    // GCP regions and zones
    this.gcpRegions = [
      "us-central1-a",
      "us-central1-b",
      "us-central1-c",
      "us-central1-f",
      "us-east1-a",
      "us-east1-b",
      "us-east1-c",
      "us-east1-d",
      "us-east4-a",
      "us-east4-b",
      "us-east4-c",
      "us-west1-a",
      "us-west1-b",
      "us-west1-c",
      "us-west2-a",
      "us-west2-b",
      "us-west2-c",
      "us-west3-a",
      "us-west3-b",
      "us-west3-c",
      "us-west4-a",
      "us-west4-b",
      "us-west4-c",
      "europe-central2-a",
      "europe-central2-b",
      "europe-central2-c",
      "europe-north1-a",
      "europe-north1-b",
      "europe-north1-c",
      "europe-west1-a",
      "europe-west1-b",
      "europe-west1-c",
      "europe-west1-d",
      "europe-west2-a",
      "europe-west2-b",
      "europe-west2-c",
      "europe-west3-a",
      "europe-west3-b",
      "europe-west3-c",
      "europe-west4-a",
      "europe-west4-b",
      "europe-west4-c",
      "europe-west6-a",
      "europe-west6-b",
      "europe-west6-c",
      "asia-east1-a",
      "asia-east1-b",
      "asia-east1-c",
      "asia-east2-a",
      "asia-east2-b",
      "asia-east2-c",
      "asia-northeast1-a",
      "asia-northeast1-b",
      "asia-northeast1-c",
      "asia-northeast2-a",
      "asia-northeast2-b",
      "asia-northeast2-c",
      "asia-northeast3-a",
      "asia-northeast3-b",
      "asia-northeast3-c",
      "asia-south1-a",
      "asia-south1-b",
      "asia-south1-c",
      "asia-southeast1-a",
      "asia-southeast1-b",
      "asia-southeast1-c",
      "asia-southeast2-a",
      "asia-southeast2-b",
      "asia-southeast2-c",
      "australia-southeast1-a",
      "australia-southeast1-b",
      "australia-southeast1-c",
    ];
  }

  getProviderName() {
    return "GCP";
  }

  getFieldMappings() {
    return {
      instanceType: "instanceType",
      vCpus: "vCpus",
      memory: "memoryGiB",
      price: "hourlyPrice",
      family: "series",
      familyName: "seriesName",
      processor: "cpuPlatform",
      generation: "generation",
      isGraviton: "isARM",
    };
  }

  getSampleData() {
    return [
      // General purpose instances - N1 series (previous generation)
      {
        instanceType: "n1-standard-1",
        vCpus: 1,
        memory: 3.75,
        price: 0.0475,
        family: "n1",
        processor: "Intel",
        familyName: "General purpose",
        generation: 0.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "n1-standard-2",
        vCpus: 2,
        memory: 7.5,
        price: 0.095,
        family: "n1",
        processor: "Intel",
        familyName: "General purpose",
        generation: 0.0,
        isGraviton: 0.0,
      },
      // General purpose instances - N2 series (current generation)
      {
        instanceType: "n2-standard-2",
        vCpus: 2,
        memory: 8,
        price: 0.097,
        family: "n2",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "n2-standard-4",
        vCpus: 4,
        memory: 16,
        price: 0.194,
        family: "n2",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // Compute optimized instances - C2 series
      {
        instanceType: "c2-standard-4",
        vCpus: 4,
        memory: 16,
        price: 0.168,
        family: "c2",
        processor: "Intel",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "c2-standard-8",
        vCpus: 8,
        memory: 32,
        price: 0.336,
        family: "c2",
        processor: "Intel",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // Memory optimized instances - M1/M2 series
      {
        instanceType: "n1-highmem-2",
        vCpus: 2,
        memory: 13,
        price: 0.118,
        family: "n1",
        processor: "Intel",
        familyName: "Memory optimized",
        generation: 0.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "n2-highmem-2",
        vCpus: 2,
        memory: 16,
        price: 0.13,
        family: "n2",
        processor: "Intel",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // ARM-based instances - T2A series
      {
        instanceType: "t2a-standard-1",
        vCpus: 1,
        memory: 4,
        price: 0.0353,
        family: "t2a",
        processor: "ARM",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
      },
      {
        instanceType: "t2a-standard-2",
        vCpus: 2,
        memory: 8,
        price: 0.0706,
        family: "t2a",
        processor: "ARM",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
      },
      // AMD instances - N2D series
      {
        instanceType: "n2d-standard-2",
        vCpus: 2,
        memory: 8,
        price: 0.087,
        family: "n2d",
        processor: "AMD",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // Burstable instances - E2 series
      {
        instanceType: "e2-micro",
        vCpus: 1,
        memory: 1,
        price: 0.0084,
        family: "e2",
        processor: "Intel",
        familyName: "Shared-core",
        generation: 1.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "e2-small",
        vCpus: 1,
        memory: 2,
        price: 0.0168,
        family: "e2",
        processor: "Intel",
        familyName: "Shared-core",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // GPU instances
      {
        instanceType: "n1-standard-4-k80",
        vCpus: 4,
        memory: 15,
        price: 0.845,
        family: "n1",
        processor: "Intel",
        familyName: "GPU instances",
        generation: 0.0,
        isGraviton: 0.0,
      },
    ];
  }

  normalizeRegionForJS(region) {
    const regionMappings = {
      "us-central1-a": "us_central1",
      "us-central1-b": "us_central1",
      "us-central1-c": "us_central1",
      "us-central1-f": "us_central1",
      "us-east1-a": "us_east1",
      "us-east1-b": "us_east1",
      "us-east1-c": "us_east1",
      "us-east1-d": "us_east1",
      "us-west1-a": "us_west1",
      "us-west1-b": "us_west1",
      "us-west1-c": "us_west1",
      "europe-west1-a": "europe_west1",
      "europe-west1-b": "europe_west1",
      "europe-west1-c": "europe_west1",
      "europe-west1-d": "europe_west1",
      "asia-east1-a": "asia_east1",
      "asia-east1-b": "asia_east1",
      "asia-east1-c": "asia_east1",
    };

    return (
      regionMappings[region] || region.toLowerCase().replace(/[\s-]/g, "_")
    );
  }

  // GCP-specific: Check if instance is ARM-based (Tau T2A)
  isARMInstance(instance) {
    return (
      instance.isGraviton === 1 ||
      instance.isGraviton === "1.0" ||
      instance.isGraviton === true ||
      instance.processor === "ARM" ||
      instance.instanceType.includes("t2a")
    );
  }

  // GCP-specific: Get machine series from instance type
  getMachineSeries(instanceType) {
    // n2-standard-4 -> n2
    // t2a-standard-2 -> t2a
    const match = instanceType.match(/^([a-z]+\d*[a-z]*)/);
    return match ? match[1] : "";
  }

  // GCP-specific: Get machine type category
  getMachineTypeCategory(instanceType) {
    if (instanceType.includes("standard")) return "standard";
    if (instanceType.includes("highmem")) return "highmem";
    if (instanceType.includes("highcpu")) return "highcpu";
    if (instanceType.includes("micro") || instanceType.includes("small"))
      return "shared-core";
    return "standard";
  }

  // GCP-specific: Enhanced instance result
  createInstanceResult(instance, currentCpu, currentMemory) {
    const result = super.createInstanceResult(
      instance,
      currentCpu,
      currentMemory
    );

    // Add GCP-specific enhancements
    result.isARM = this.isARMInstance(instance);
    result.machineSeries = this.getMachineSeries(instance.instanceType);
    result.machineCategory = this.getMachineTypeCategory(instance.instanceType);

    return result;
  }

  // GCP-specific: Apply additional GCP filters
  applyFilters(instances, currentCpu, currentMemory, options) {
    let filteredInstances = super.applyFilters(
      instances,
      currentCpu,
      currentMemory,
      options
    );

    // GCP-specific: ARM filtering
    if (options.excludeARM) {
      filteredInstances = filteredInstances.filter((instance) => {
        if (this.isARMInstance(instance)) {
          console.log(`Excluding ARM: ${instance.instanceType}`);
          return false;
        }
        return true;
      });
    }

    // GCP-specific: Machine Series Filter
    if (
      options.restrictMachineSeries &&
      options.selectedMachineSeries?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) => {
        const machineSeries = this.getMachineSeries(instance.instanceType);
        if (!options.selectedMachineSeries.includes(machineSeries)) {
          console.log(
            `Filtering out machine series: ${instance.instanceType} (series=${machineSeries})`
          );
          return false;
        }
        return true;
      });
    }

    // GCP-specific: Machine Type Category Filter
    if (
      options.restrictMachineCategory &&
      options.selectedMachineCategory?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) => {
        const category = this.getMachineTypeCategory(instance.instanceType);
        if (!options.selectedMachineCategory.includes(category)) {
          console.log(
            `Filtering out machine category: ${instance.instanceType} (category=${category})`
          );
          return false;
        }
        return true;
      });
    }

    return filteredInstances;
  }

  // GCP-specific: Get instance family from GCP instance type
  getInstanceFamily(instanceType) {
    // n2-standard-4 -> n2-standard
    const match = instanceType.match(/^([a-z]+\d*[a-z]*-[a-z]+)/);
    return match ? match[1] : "";
  }

  // GCP-specific: Log enhanced loading statistics
  logLoadingStatistics(instances, region) {
    super.logLoadingStatistics(instances, region);

    const armCount = instances.filter((i) => this.isARMInstance(i)).length;
    const machineSeries = new Set(
      instances.map((i) => this.getMachineSeries(i.instanceType))
    ).size;
    const sharedCoreCount = instances.filter(
      (i) => this.getMachineTypeCategory(i.instanceType) === "shared-core"
    ).length;

    console.log(`  - ARM-based (T2A): ${armCount} instances`);
    console.log(`  - Machine Series: ${machineSeries} different series`);
    console.log(`  - Shared-core: ${sharedCoreCount} instances`);
  }

  // GCP-specific: Get filtering statistics
  getFilteringStatistics() {
    const stats = {
      totalInstances: 0,
      currentGeneration: 0,
      previousGeneration: 0,
      processorBreakdown: {},
      familyNameBreakdown: {},
      machineSeriesBreakdown: {},
      machineCategoryBreakdown: {},
      armInstances: 0,
      sharedCoreInstances: 0,
      filteringCapabilities: {
        currentGenerationFilter: true,
        instanceFamilyNameFilter: true,
        processorPlatformFilter: true,
        armFilter: true,
        machineSeriesFilter: true,
        machineCategoryFilter: true,
      },
    };

    Object.values(this.instanceData).forEach((regionData) => {
      regionData.forEach((instance) => {
        stats.totalInstances++;

        // Generation breakdown
        if (instance.generation === 1.0 || instance.generation === "1.0") {
          stats.currentGeneration++;
        } else {
          stats.previousGeneration++;
        }

        // Processor breakdown
        const processor = instance.processor || "Unknown";
        stats.processorBreakdown[processor] =
          (stats.processorBreakdown[processor] || 0) + 1;

        // Family name breakdown
        const familyName = instance.familyName || "Unknown";
        stats.familyNameBreakdown[familyName] =
          (stats.familyNameBreakdown[familyName] || 0) + 1;

        // Machine Series breakdown
        const machineSeries = this.getMachineSeries(instance.instanceType);
        stats.machineSeriesBreakdown[machineSeries] =
          (stats.machineSeriesBreakdown[machineSeries] || 0) + 1;

        // Machine Category breakdown
        const category = this.getMachineTypeCategory(instance.instanceType);
        stats.machineCategoryBreakdown[category] =
          (stats.machineCategoryBreakdown[category] || 0) + 1;

        // ARM instances
        if (this.isARMInstance(instance)) {
          stats.armInstances++;
        }

        // Shared-core instances
        if (category === "shared-core") {
          stats.sharedCoreInstances++;
        }
      });
    });

    // Calculate percentages
    if (stats.totalInstances > 0) {
      stats.currentGenerationPercentage = (
        (stats.currentGeneration / stats.totalInstances) *
        100
      ).toFixed(1);
      stats.armPercentage = (
        (stats.armInstances / stats.totalInstances) *
        100
      ).toFixed(1);
      stats.sharedCorePercentage = (
        (stats.sharedCoreInstances / stats.totalInstances) *
        100
      ).toFixed(1);
    } else {
      stats.currentGenerationPercentage = 0;
      stats.armPercentage = 0;
      stats.sharedCorePercentage = 0;
    }

    return stats;
  }

  // GCP-specific: Create JS data structure from sample (GCP format)
  createJSDataFromSample(instance, mapping) {
    return {
      series: instance.family,
      seriesName: instance.familyName,
      isARM: instance.isGraviton,
      generation: instance.generation,
      cpuPlatform: instance.processor,
      vCpus: instance.vCpus,
      memoryGiB: instance.memory,
      hourlyPrice: instance.price,
    };
  }

  // GCP-specific: Get available machine series
  getAvailableMachineSeries() {
    const series = new Set();

    Object.values(this.instanceData).forEach((regionData) => {
      regionData.forEach((instance) => {
        const machineSeries = this.getMachineSeries(instance.instanceType);
        if (machineSeries) {
          series.add(machineSeries);
        }
      });
    });

    if (series.size === 0) {
      this.getSampleData().forEach((instance) => {
        const machineSeries = this.getMachineSeries(instance.instanceType);
        if (machineSeries) {
          series.add(machineSeries);
        }
      });
    }

    return Array.from(series).sort();
  }

  // GCP-specific: Get available machine categories
  getAvailableMachineCategories() {
    const categories = new Set();

    Object.values(this.instanceData).forEach((regionData) => {
      regionData.forEach((instance) => {
        const category = this.getMachineTypeCategory(instance.instanceType);
        if (category) {
          categories.add(category);
        }
      });
    });

    if (categories.size === 0) {
      this.getSampleData().forEach((instance) => {
        const category = this.getMachineTypeCategory(instance.instanceType);
        if (category) {
          categories.add(category);
        }
      });
    }

    return Array.from(categories).sort();
  }
}

// Export GCP instance selector
window.GCPInstanceSelector = GCPInstanceSelector;

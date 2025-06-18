// AWS Instance Selector - AWS-specific implementation
// Extends BaseInstanceSelector with AWS-specific functionality

class AWSInstanceSelector extends BaseInstanceSelector {
  constructor() {
    super();

    // Complete AWS region mapping
    this.awsRegions = [
      "af-south-1",
      "ap-east-1",
      "ap-east-2",
      "ap-northeast-1",
      "ap-northeast-2",
      "ap-northeast-3",
      "ap-south-1",
      "ap-south-2",
      "ap-southeast-1",
      "ap-southeast-2",
      "ap-southeast-3",
      "ap-southeast-4",
      "ap-southeast-5",
      "ap-southeast-7",
      "ca-central-1",
      "ca-west-1",
      "eu-central-1",
      "eu-central-2",
      "eu-north-1",
      "eu-south-1",
      "eu-south-2",
      "eu-west-1",
      "eu-west-2",
      "eu-west-3",
      "il-central-1",
      "me-central-1",
      "me-south-1",
      "mx-central-1",
      "sa-east-1",
      "us-east-1",
      "us-east-2",
      "us-gov-east-1",
      "us-gov-west-1",
      "us-west-1",
      "us-west-2",
    ];
  }

  getProviderName() {
    return "AWS";
  }

  getFieldMappings() {
    return {
      instanceType: "instanceType",
      vCpus: "vCpus",
      memory: "memorySizeInGiB",
      price: "onDemandLinuxHr",
      family: "instanceFamily",
      familyName: "instanceFamilyName",
      processor: "processorManufacturer",
      generation: "currentGeneration",
      isGraviton: "isGraviton",
      nitroSupport: "nitroEnclavesSupport",
    };
  }

  getSampleData() {
    return [
      // Current Generation Intel instances
      {
        instanceType: "t3.nano",
        vCpus: 2,
        memory: 0.5,
        price: 0.0052,
        family: "t3",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "t3.micro",
        vCpus: 2,
        memory: 1,
        price: 0.0104,
        family: "t3",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "m5.large",
        vCpus: 2,
        memory: 8,
        price: 0.096,
        family: "m5",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "c5.large",
        vCpus: 2,
        memory: 4,
        price: 0.085,
        family: "c5",
        processor: "Intel",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "r5.large",
        vCpus: 2,
        memory: 16,
        price: 0.126,
        family: "r5",
        processor: "Intel",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      // Current Generation Graviton instances
      {
        instanceType: "t4g.micro",
        vCpus: 2,
        memory: 1,
        price: 0.0084,
        family: "t4g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "m6g.large",
        vCpus: 2,
        memory: 8,
        price: 0.077,
        family: "m6g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "c6g.large",
        vCpus: 2,
        memory: 4,
        price: 0.068,
        family: "c6g",
        processor: "AWS",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      // Previous Generation instances
      {
        instanceType: "t2.micro",
        vCpus: 1,
        memory: 1.0,
        price: 0.0116,
        family: "t2",
        processor: "Intel",
        familyName: "General purpose",
        generation: 0.0,
        isGraviton: 0.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "t1.micro",
        vCpus: 1,
        memory: 0.61,
        price: 0.02,
        family: "t1",
        processor: "Intel",
        familyName: "Micro instances",
        generation: 0.0,
        isGraviton: 0.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "a1.medium",
        vCpus: 1,
        memory: 2.0,
        price: 0.0255,
        family: "a1",
        processor: "AWS",
        familyName: "General purpose",
        generation: 0.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      // AMD instances
      {
        instanceType: "c7a.medium",
        vCpus: 1,
        memory: 2.0,
        price: 0.0513,
        family: "c7a",
        processor: "AMD",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      // Specialized instances
      {
        instanceType: "p3.2xlarge",
        vCpus: 8,
        memory: 61,
        price: 3.06,
        family: "p3",
        processor: "Intel",
        familyName: "GPU instance",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
    ];
  }

  normalizeRegionForJS(region) {
    // Convert dash to underscore for JavaScript variable names
    // us-east-1 -> us_east_1
    return region.replace(/-/g, "_");
  }

  // AWS-specific: Enhanced Graviton detection
  isGravitonInstance(instance) {
    return (
      instance.isGraviton === 1 ||
      instance.isGraviton === "1.0" ||
      instance.isGraviton === true
    );
  }

  // AWS-specific: Create standardized instance with AWS-specific fields
  createStandardizedInstance(instanceType, instanceDetails, region, mapping) {
    const instance = super.createStandardizedInstance(
      instanceType,
      instanceDetails,
      region,
      mapping
    );

    // Add AWS-specific fields
    instance.nitroSupport =
      parseFloat(instanceDetails[mapping.nitroSupport]) || 0;

    return instance;
  }

  // AWS-specific: Enhanced instance result with AWS-specific fields
  createInstanceResult(instance, currentCpu, currentMemory) {
    const result = super.createInstanceResult(
      instance,
      currentCpu,
      currentMemory
    );

    // Add AWS-specific enhancements
    let processorDisplay = instance.processor;
    if (instance.processor === "AWS" && this.isGravitonInstance(instance)) {
      processorDisplay = "Graviton2/3";
    }

    result.processor = processorDisplay;
    result.isGraviton = this.isGravitonInstance(instance);
    result.nitroSupport =
      instance.nitroSupport === 1 || instance.nitroSupport === "1.0";

    return result;
  }

  // AWS-specific: Apply additional AWS filters
  applyFilters(instances, currentCpu, currentMemory, options) {
    let filteredInstances = super.applyFilters(
      instances,
      currentCpu,
      currentMemory,
      options
    );

    // AWS-specific: Legacy Graviton filtering (backwards compatibility)
    if (options.excludeGraviton) {
      filteredInstances = filteredInstances.filter((instance) => {
        if (this.isGravitonInstance(instance)) {
          console.log(`Excluding Graviton: ${instance.instanceType}`);
          return false;
        }
        return true;
      });
    }

    // AWS-specific: Main Families Filter
    if (
      options.restrictMainFamilies &&
      options.selectedMainFamilies?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) => {
        const instanceMainFamily = this.getMainInstanceFamily(
          instance.instanceType
        );
        if (!options.selectedMainFamilies.includes(instanceMainFamily)) {
          console.log(
            `Filtering out main family: ${instance.instanceType} (mainFamily=${instanceMainFamily})`
          );
          return false;
        }
        return true;
      });
    }

    return filteredInstances;
  }

  // AWS-specific: Get instance family from AWS instance type
  getInstanceFamily(instanceType) {
    const match = instanceType.match(/^([a-z]+\d+[a-z]*)/);
    return match ? match[1] : "";
  }

  // AWS-specific: Log enhanced loading statistics
  logLoadingStatistics(instances, region) {
    super.logLoadingStatistics(instances, region);

    const gravitonCount = instances.filter((i) =>
      this.isGravitonInstance(i)
    ).length;
    const nitroCount = instances.filter(
      (i) => i.nitroSupport === 1 || i.nitroSupport === "1.0"
    ).length;

    console.log(`  - Graviton: ${gravitonCount} instances`);
    console.log(`  - Nitro Support: ${nitroCount} instances`);
  }

  // AWS-specific: Get comprehensive filtering statistics
  getFilteringStatistics() {
    const stats = {
      totalInstances: 0,
      currentGeneration: 0,
      previousGeneration: 0,
      processorBreakdown: {},
      familyNameBreakdown: {},
      gravitonInstances: 0,
      nitroInstances: 0,
      filteringCapabilities: {
        currentGenerationFilter: true,
        instanceFamilyNameFilter: true,
        processorManufacturerFilter: true,
        gravitonFilter: true,
        mainFamilyFilter: true,
        nitroFilter: true,
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

        // Graviton instances
        if (this.isGravitonInstance(instance)) {
          stats.gravitonInstances++;
        }

        // Nitro instances
        if (instance.nitroSupport === 1 || instance.nitroSupport === "1.0") {
          stats.nitroInstances++;
        }
      });
    });

    // Calculate percentages
    if (stats.totalInstances > 0) {
      stats.currentGenerationPercentage = (
        (stats.currentGeneration / stats.totalInstances) *
        100
      ).toFixed(1);
      stats.gravitonPercentage = (
        (stats.gravitonInstances / stats.totalInstances) *
        100
      ).toFixed(1);
      stats.nitroPercentage = (
        (stats.nitroInstances / stats.totalInstances) *
        100
      ).toFixed(1);
    } else {
      stats.currentGenerationPercentage = 0;
      stats.gravitonPercentage = 0;
      stats.nitroPercentage = 0;
    }

    return stats;
  }

  // AWS-specific: Create JS data structure from sample (AWS format)
  createJSDataFromSample(instance, mapping) {
    return {
      instanceFamily: instance.family,
      instanceFamilyName: instance.familyName,
      isGraviton: instance.isGraviton,
      currentGeneration: instance.generation,
      processorManufacturer: instance.processor,
      vCpus: instance.vCpus,
      memorySizeInGiB: instance.memory,
      nitroEnclavesSupport: instance.nitroSupport,
      onDemandLinuxHr: instance.price,
    };
  }
}

// Export AWS instance selector
window.AWSInstanceSelector = AWSInstanceSelector;

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
      // ── Graviton (AWS ARM) — cheapest per size tier ───────────────────────
      {
        instanceType: "t4g.nano",
        vCpus: 2,
        memory: 0.5,
        price: 0.0042,
        family: "t4g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
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
        instanceType: "t4g.small",
        vCpus: 2,
        memory: 2,
        price: 0.0168,
        family: "t4g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "t4g.medium",
        vCpus: 2,
        memory: 4,
        price: 0.0336,
        family: "t4g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "t4g.large",
        vCpus: 2,
        memory: 8,
        price: 0.0672,
        family: "t4g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "t4g.xlarge",
        vCpus: 4,
        memory: 16,
        price: 0.1344,
        family: "t4g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "t4g.2xlarge",
        vCpus: 8,
        memory: 32,
        price: 0.2688,
        family: "t4g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 0.0,
      },
      // ── Graviton general purpose (m6g) ────────────────────────────────────
      {
        instanceType: "m6g.medium",
        vCpus: 1,
        memory: 4,
        price: 0.0385,
        family: "m6g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
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
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6g.xlarge",
        vCpus: 4,
        memory: 16,
        price: 0.154,
        family: "m6g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6g.2xlarge",
        vCpus: 8,
        memory: 32,
        price: 0.308,
        family: "m6g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6g.4xlarge",
        vCpus: 16,
        memory: 64,
        price: 0.616,
        family: "m6g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6g.8xlarge",
        vCpus: 32,
        memory: 128,
        price: 1.232,
        family: "m6g",
        processor: "AWS",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      // ── Graviton compute optimized (c6g) ──────────────────────────────────
      {
        instanceType: "c6g.medium",
        vCpus: 1,
        memory: 2,
        price: 0.034,
        family: "c6g",
        processor: "AWS",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
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
        nitroSupport: 1.0,
      },
      {
        instanceType: "c6g.xlarge",
        vCpus: 4,
        memory: 8,
        price: 0.136,
        family: "c6g",
        processor: "AWS",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "c6g.2xlarge",
        vCpus: 8,
        memory: 16,
        price: 0.272,
        family: "c6g",
        processor: "AWS",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "c6g.4xlarge",
        vCpus: 16,
        memory: 32,
        price: 0.544,
        family: "c6g",
        processor: "AWS",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      // ── Graviton memory optimized (r6g) ───────────────────────────────────
      {
        instanceType: "r6g.large",
        vCpus: 2,
        memory: 16,
        price: 0.1008,
        family: "r6g",
        processor: "AWS",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "r6g.xlarge",
        vCpus: 4,
        memory: 32,
        price: 0.2016,
        family: "r6g",
        processor: "AWS",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "r6g.2xlarge",
        vCpus: 8,
        memory: 64,
        price: 0.4032,
        family: "r6g",
        processor: "AWS",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "r6g.4xlarge",
        vCpus: 16,
        memory: 128,
        price: 0.8064,
        family: "r6g",
        processor: "AWS",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 1.0,
        nitroSupport: 1.0,
      },
      // ── Intel general purpose (m6i) ───────────────────────────────────────
      {
        instanceType: "m6i.large",
        vCpus: 2,
        memory: 8,
        price: 0.096,
        family: "m6i",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6i.xlarge",
        vCpus: 4,
        memory: 16,
        price: 0.192,
        family: "m6i",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6i.2xlarge",
        vCpus: 8,
        memory: 32,
        price: 0.384,
        family: "m6i",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6i.4xlarge",
        vCpus: 16,
        memory: 64,
        price: 0.768,
        family: "m6i",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      // ── Intel compute optimized (c6i) ─────────────────────────────────────
      {
        instanceType: "c6i.large",
        vCpus: 2,
        memory: 4,
        price: 0.085,
        family: "c6i",
        processor: "Intel",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "c6i.xlarge",
        vCpus: 4,
        memory: 8,
        price: 0.17,
        family: "c6i",
        processor: "Intel",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "c6i.2xlarge",
        vCpus: 8,
        memory: 16,
        price: 0.34,
        family: "c6i",
        processor: "Intel",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      // ── Intel memory optimized (r6i) ──────────────────────────────────────
      {
        instanceType: "r6i.large",
        vCpus: 2,
        memory: 16,
        price: 0.126,
        family: "r6i",
        processor: "Intel",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "r6i.xlarge",
        vCpus: 4,
        memory: 32,
        price: 0.252,
        family: "r6i",
        processor: "Intel",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "r6i.2xlarge",
        vCpus: 8,
        memory: 64,
        price: 0.504,
        family: "r6i",
        processor: "Intel",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      // ── AMD general purpose (m6a) ─────────────────────────────────────────
      {
        instanceType: "m6a.large",
        vCpus: 2,
        memory: 8,
        price: 0.0864,
        family: "m6a",
        processor: "AMD",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6a.xlarge",
        vCpus: 4,
        memory: 16,
        price: 0.1728,
        family: "m6a",
        processor: "AMD",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m6a.2xlarge",
        vCpus: 8,
        memory: 32,
        price: 0.3456,
        family: "m6a",
        processor: "AMD",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      // ── AMD compute optimized (c7a) ───────────────────────────────────────
      {
        instanceType: "c7a.medium",
        vCpus: 1,
        memory: 2,
        price: 0.0513,
        family: "c7a",
        processor: "AMD",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "c7a.large",
        vCpus: 2,
        memory: 4,
        price: 0.1026,
        family: "c7a",
        processor: "AMD",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "c7a.xlarge",
        vCpus: 4,
        memory: 8,
        price: 0.2051,
        family: "c7a",
        processor: "AMD",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      // ── Burstable Intel (t3) ──────────────────────────────────────────────
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
        instanceType: "t3.small",
        vCpus: 2,
        memory: 2,
        price: 0.0208,
        family: "t3",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "t3.medium",
        vCpus: 2,
        memory: 4,
        price: 0.0416,
        family: "t3",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 0.0,
      },
      {
        instanceType: "t3.large",
        vCpus: 2,
        memory: 8,
        price: 0.0832,
        family: "t3",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
        nitroSupport: 0.0,
      },
      // ── Previous generation ───────────────────────────────────────────────
      {
        instanceType: "t2.micro",
        vCpus: 1,
        memory: 1,
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
        instanceType: "m5.large",
        vCpus: 2,
        memory: 8,
        price: 0.096,
        family: "m5",
        processor: "Intel",
        familyName: "General purpose",
        generation: 0.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m5.xlarge",
        vCpus: 4,
        memory: 16,
        price: 0.192,
        family: "m5",
        processor: "Intel",
        familyName: "General purpose",
        generation: 0.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      {
        instanceType: "m5.2xlarge",
        vCpus: 8,
        memory: 32,
        price: 0.384,
        family: "m5",
        processor: "Intel",
        familyName: "General purpose",
        generation: 0.0,
        isGraviton: 0.0,
        nitroSupport: 1.0,
      },
      // ── GPU / specialized ─────────────────────────────────────────────────
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

  getAllAvailableRegionKeys() {
    if (!window.AWS_DATA_READY) return [];
    if (Array.isArray(window.AWS_REGION_KEYS)) {
      const known = new Set(
        window.AWS_REGION_KEYS.map((k) => k.replace(/_/g, "-")),
      );
      return this.awsRegions.filter((region) => known.has(region));
    }
    return this.awsRegions.filter((region) => {
      const key = this.normalizeRegionForJS(region);
      return typeof window[key] === "object" && window[key] !== null;
    });
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
      mapping,
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
      currentMemory,
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
      options,
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
          instance.instanceType,
        );
        if (!options.selectedMainFamilies.includes(instanceMainFamily)) {
          console.log(
            `Filtering out main family: ${instance.instanceType} (mainFamily=${instanceMainFamily})`,
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
      this.isGravitonInstance(i),
    ).length;
    const nitroCount = instances.filter(
      (i) => i.nitroSupport === 1 || i.nitroSupport === "1.0",
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

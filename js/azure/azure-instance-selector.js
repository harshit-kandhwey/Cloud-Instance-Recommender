// Azure Instance Selector - Azure-specific implementation
// Extends BaseInstanceSelector with Azure-specific functionality

class AzureInstanceSelector extends BaseInstanceSelector {
  constructor() {
    super();

    // Azure region mappings
    this.azureRegions = [
      "East US",
      "East US 2",
      "West US",
      "West US 2",
      "West US 3",
      "Central US",
      "North Central US",
      "South Central US",
      "West Central US",
      "Canada Central",
      "Canada East",
      "Brazil South",
      "North Europe",
      "West Europe",
      "France Central",
      "France South",
      "Germany West Central",
      "Germany North",
      "Norway East",
      "Norway West",
      "Switzerland North",
      "Switzerland West",
      "UK South",
      "UK West",
      "Sweden Central",
      "Sweden South",
      "East Asia",
      "Southeast Asia",
      "Australia Central",
      "Australia Central 2",
      "Australia East",
      "Australia Southeast",
      "Central India",
      "South India",
      "West India",
      "Japan East",
      "Japan West",
      "Korea Central",
      "Korea South",
      "South Africa North",
      "South Africa West",
      "UAE Central",
      "UAE North",
    ];
  }

  getProviderName() {
    return "Azure";
  }

  getFieldMappings() {
    return {
      instanceType: "instanceType",
      vCpus: "vCpus",
      memory: "memoryGiB",
      price: "linuxPrice",
      family: "family",
      familyName: "familyName",
      processor: "processorArchitecture",
      generation: "generation",
      isGraviton: "isARM",
    };
  }

  getSampleData() {
    return [
      // General purpose instances
      {
        instanceType: "Standard_B1s",
        vCpus: 1,
        memory: 1,
        price: 0.0104,
        family: "B",
        processor: "Intel",
        familyName: "Burstable",
        generation: 1.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "Standard_B2s",
        vCpus: 2,
        memory: 4,
        price: 0.0416,
        family: "B",
        processor: "Intel",
        familyName: "Burstable",
        generation: 1.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "Standard_D2s_v3",
        vCpus: 2,
        memory: 8,
        price: 0.096,
        family: "Dsv3",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "Standard_D4s_v3",
        vCpus: 4,
        memory: 16,
        price: 0.192,
        family: "Dsv3",
        processor: "Intel",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // Compute optimized instances
      {
        instanceType: "Standard_F2s_v2",
        vCpus: 2,
        memory: 4,
        price: 0.085,
        family: "Fsv2",
        processor: "Intel",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "Standard_F4s_v2",
        vCpus: 4,
        memory: 8,
        price: 0.169,
        family: "Fsv2",
        processor: "Intel",
        familyName: "Compute optimized",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // Memory optimized instances
      {
        instanceType: "Standard_E2s_v3",
        vCpus: 2,
        memory: 16,
        price: 0.126,
        family: "Esv3",
        processor: "Intel",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 0.0,
      },
      {
        instanceType: "Standard_E4s_v3",
        vCpus: 4,
        memory: 32,
        price: 0.252,
        family: "Esv3",
        processor: "Intel",
        familyName: "Memory optimized",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // ARM-based instances
      {
        instanceType: "Standard_Dpds_v5",
        vCpus: 2,
        memory: 8,
        price: 0.077,
        family: "Dpdsv5",
        processor: "ARM",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 1.0,
      },
      // AMD instances
      {
        instanceType: "Standard_D2as_v4",
        vCpus: 2,
        memory: 8,
        price: 0.086,
        family: "Dasv4",
        processor: "AMD",
        familyName: "General purpose",
        generation: 1.0,
        isGraviton: 0.0,
      },
      // Previous generation
      {
        instanceType: "Standard_A1_v2",
        vCpus: 1,
        memory: 2,
        price: 0.085,
        family: "Av2",
        processor: "Intel",
        familyName: "General purpose",
        generation: 0.0,
        isGraviton: 0.0,
      },
    ];
  }

  normalizeRegionForJS(region) {
    const regionMappings = {
      "East US": "eastus",
      "East US 2": "eastus2",
      "West US": "westus",
      "West US 2": "westus2",
      "West US 3": "westus3",
      "Central US": "centralus",
      "North Central US": "northcentralus",
      "South Central US": "southcentralus",
      "West Central US": "westcentralus",
      "North Europe": "northeurope",
      "West Europe": "westeurope",
      "France Central": "francecentral",
      "Germany West Central": "germanywestcentral",
      "UK South": "uksouth",
      "UK West": "ukwest",
      "East Asia": "eastasia",
      "Southeast Asia": "southeastasia",
      "Australia East": "australiaeast",
      "Australia Southeast": "australiasoutheast",
      "Central India": "centralindia",
      "South India": "southindia",
      "Japan East": "japaneast",
      "Japan West": "japanwest",
      "Korea Central": "koreacentral",
      "Brazil South": "brazilsouth",
    };

    return regionMappings[region] || region.toLowerCase().replace(/[\s-]/g, "");
  }

  // Azure-specific: Check if instance is ARM-based
  isARMInstance(instance) {
    return (
      instance.isGraviton === 1 ||
      instance.isGraviton === "1.0" ||
      instance.isGraviton === true ||
      instance.processor === "ARM"
    );
  }

  // Azure-specific: Get instance family from Azure instance type
  getInstanceFamily(instanceType) {
    // Standard_D2s_v3 -> D2s_v3
    const match = instanceType.match(/^Standard_([A-Z][a-z]*\d*[a-z]*)/);
    return match ? match[1] : "";
  }

  // Azure-specific: Get VM series from instance type
  getVMSeries(instanceType) {
    // Standard_D2s_v3 -> Dsv3
    const match = instanceType.match(/^Standard_([A-Z]+[a-z]*)/);
    return match ? match[1] : "";
  }

  // Azure-specific: Enhanced instance result
  createInstanceResult(instance, currentCpu, currentMemory) {
    const result = super.createInstanceResult(
      instance,
      currentCpu,
      currentMemory
    );

    // Add Azure-specific enhancements
    result.isARM = this.isARMInstance(instance);
    result.vmSeries = this.getVMSeries(instance.instanceType);

    return result;
  }

  // Azure-specific: Apply additional Azure filters
  applyFilters(instances, currentCpu, currentMemory, options) {
    let filteredInstances = super.applyFilters(
      instances,
      currentCpu,
      currentMemory,
      options
    );

    // Azure-specific: ARM filtering
    if (options.excludeARM) {
      filteredInstances = filteredInstances.filter((instance) => {
        if (this.isARMInstance(instance)) {
          console.log(`Excluding ARM: ${instance.instanceType}`);
          return false;
        }
        return true;
      });
    }

    // Azure-specific: VM Series Filter
    if (options.restrictVMSeries && options.selectedVMSeries?.length > 0) {
      filteredInstances = filteredInstances.filter((instance) => {
        const vmSeries = this.getVMSeries(instance.instanceType);
        if (!options.selectedVMSeries.includes(vmSeries)) {
          console.log(
            `Filtering out VM series: ${instance.instanceType} (series=${vmSeries})`
          );
          return false;
        }
        return true;
      });
    }

    return filteredInstances;
  }

  // Azure-specific: Log enhanced loading statistics
  logLoadingStatistics(instances, region) {
    super.logLoadingStatistics(instances, region);

    const armCount = instances.filter((i) => this.isARMInstance(i)).length;
    const vmSeries = new Set(
      instances.map((i) => this.getVMSeries(i.instanceType))
    ).size;

    console.log(`  - ARM-based: ${armCount} instances`);
    console.log(`  - VM Series: ${vmSeries} different series`);
  }

  // Azure-specific: Get filtering statistics
  getFilteringStatistics() {
    const stats = {
      totalInstances: 0,
      currentGeneration: 0,
      previousGeneration: 0,
      processorBreakdown: {},
      familyNameBreakdown: {},
      vmSeriesBreakdown: {},
      armInstances: 0,
      filteringCapabilities: {
        currentGenerationFilter: true,
        instanceFamilyNameFilter: true,
        processorArchitectureFilter: true,
        armFilter: true,
        vmSeriesFilter: true,
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

        // VM Series breakdown
        const vmSeries = this.getVMSeries(instance.instanceType);
        stats.vmSeriesBreakdown[vmSeries] =
          (stats.vmSeriesBreakdown[vmSeries] || 0) + 1;

        // ARM instances
        if (this.isARMInstance(instance)) {
          stats.armInstances++;
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
    } else {
      stats.currentGenerationPercentage = 0;
      stats.armPercentage = 0;
    }

    return stats;
  }

  // Azure-specific: Create JS data structure from sample (Azure format)
  createJSDataFromSample(instance, mapping) {
    return {
      family: instance.family,
      familyName: instance.familyName,
      isARM: instance.isGraviton,
      generation: instance.generation,
      processorArchitecture: instance.processor,
      vCpus: instance.vCpus,
      memoryGiB: instance.memory,
      linuxPrice: instance.price,
    };
  }

  // Azure-specific: Get available VM series
  getAvailableVMSeries() {
    const series = new Set();

    Object.values(this.instanceData).forEach((regionData) => {
      regionData.forEach((instance) => {
        const vmSeries = this.getVMSeries(instance.instanceType);
        if (vmSeries) {
          series.add(vmSeries);
        }
      });
    });

    if (series.size === 0) {
      this.getSampleData().forEach((instance) => {
        const vmSeries = this.getVMSeries(instance.instanceType);
        if (vmSeries) {
          series.add(vmSeries);
        }
      });
    }

    return Array.from(series).sort();
  }
}

// Export Azure instance selector
window.AzureInstanceSelector = AzureInstanceSelector;

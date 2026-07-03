// Azure Instance Selector - Azure-specific implementation
// Extends BaseInstanceSelector with Azure-specific functionality

class AzureInstanceSelector extends BaseInstanceSelector {
  constructor() {
    super();

    // Azure region mappings
    this.azureRegions = [
      // Americas
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
      "Brazil Southeast",
      "Mexico Central",
      "Chile Central",
      // Europe
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
      "Austria East",
      "Belgium Central",
      "Denmark East",
      "Italy North",
      "Poland Central",
      "Spain Central",
      // Asia Pacific
      "East Asia",
      "Southeast Asia",
      "Australia Central",
      "Australia Central 2",
      "Australia East",
      "Australia Southeast",
      "New Zealand North",
      "Central India",
      "South India",
      "West India",
      "Japan East",
      "Japan West",
      "Korea Central",
      "Korea South",
      "Malaysia West",
      "Indonesia Central",
      // Middle East & Africa
      "South Africa North",
      "South Africa West",
      "UAE Central",
      "UAE North",
      "Israel Central",
      "Qatar Central",
      // Government
      "US Gov Arizona",
      "US Gov Texas",
      "US Gov Virginia",
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
      // Americas
      "East US": "eastus",
      "East US 2": "eastus2",
      "West US": "westus",
      "West US 2": "westus2",
      "West US 3": "westus3",
      "Central US": "centralus",
      "North Central US": "northcentralus",
      "South Central US": "southcentralus",
      "West Central US": "westcentralus",
      "Canada Central": "canadacentral",
      "Canada East": "canadaeast",
      "Brazil South": "brazilsouth",
      "Brazil Southeast": "brazilsoutheast",
      "Mexico Central": "mexicocentral",
      "Chile Central": "chilecentral",
      // Europe
      "North Europe": "northeurope",
      "West Europe": "westeurope",
      "France Central": "francecentral",
      "France South": "francesouth",
      "Germany West Central": "germanywestcentral",
      "Germany North": "germanynorth",
      "Norway East": "norwayeast",
      "Norway West": "norwaywest",
      "Switzerland North": "switzerlandnorth",
      "Switzerland West": "switzerlandwest",
      "UK South": "uksouth",
      "UK West": "ukwest",
      "Sweden Central": "swedencentral",
      "Sweden South": "swedensouth",
      "Austria East": "austriaeast",
      "Belgium Central": "belgiumcentral",
      "Denmark East": "denmarkeast",
      "Italy North": "italynorth",
      "Poland Central": "polandcentral",
      "Spain Central": "spaincentral",
      // Asia Pacific
      "East Asia": "eastasia",
      "Southeast Asia": "southeastasia",
      "Australia Central": "australiacentral",
      "Australia Central 2": "australiacentral2",
      "Australia East": "australiaeast",
      "Australia Southeast": "australiasoutheast",
      "New Zealand North": "newzealandnorth",
      "Central India": "centralindia",
      "South India": "southindia",
      "West India": "westindia",
      "Japan East": "japaneast",
      "Japan West": "japanwest",
      "Korea Central": "koreacentral",
      "Korea South": "koreasouth",
      "Malaysia West": "malaysiawest",
      "Indonesia Central": "indonesiacentral",
      // Middle East & Africa
      "South Africa North": "southafricanorth",
      "South Africa West": "southafricawest",
      "UAE Central": "uaecentral",
      "UAE North": "uaenorth",
      "Israel Central": "israelcentral",
      "Qatar Central": "qatarcentral",
      // Government
      "US Gov Arizona": "usgovarizona",
      "US Gov Texas": "usgovtexas",
      "US Gov Virginia": "usgovvirginia",
    };

    return regionMappings[region] || region.toLowerCase().replace(/[\s-]/g, "");
  }

  getAllAvailableRegionKeys() {
    if (!window.AZURE_DATA_READY) return [];
    // Reverse of normalizeRegionForJS — global key → display name
    const reverseMap = {
      eastus: "East US",
      eastus2: "East US 2",
      westus: "West US",
      westus2: "West US 2",
      westus3: "West US 3",
      centralus: "Central US",
      northcentralus: "North Central US",
      southcentralus: "South Central US",
      westcentralus: "West Central US",
      canadacentral: "Canada Central",
      canadaeast: "Canada East",
      brazilsouth: "Brazil South",
      brazilsoutheast: "Brazil Southeast",
      mexicocentral: "Mexico Central",
      chilecentral: "Chile Central",
      northeurope: "North Europe",
      westeurope: "West Europe",
      francecentral: "France Central",
      francesouth: "France South",
      germanywestcentral: "Germany West Central",
      germanynorth: "Germany North",
      norwayeast: "Norway East",
      norwaywest: "Norway West",
      switzerlandnorth: "Switzerland North",
      switzerlandwest: "Switzerland West",
      uksouth: "UK South",
      ukwest: "UK West",
      swedencentral: "Sweden Central",
      swedensouth: "Sweden South",
      austriaeast: "Austria East",
      belgiumcentral: "Belgium Central",
      denmarkeast: "Denmark East",
      italynorth: "Italy North",
      polandcentral: "Poland Central",
      spaincentral: "Spain Central",
      eastasia: "East Asia",
      southeastasia: "Southeast Asia",
      australiacentral: "Australia Central",
      australiacentral2: "Australia Central 2",
      australiaeast: "Australia East",
      australiasoutheast: "Australia Southeast",
      newzealandnorth: "New Zealand North",
      centralindia: "Central India",
      southindia: "South India",
      westindia: "West India",
      japaneast: "Japan East",
      japanwest: "Japan West",
      koreacentral: "Korea Central",
      koreasouth: "Korea South",
      malaysiawest: "Malaysia West",
      indonesiacentral: "Indonesia Central",
      southafricanorth: "South Africa North",
      southafricawest: "South Africa West",
      uaecentral: "UAE Central",
      uaenorth: "UAE North",
      israelcentral: "Israel Central",
      qatarcentral: "Qatar Central",
      usgovarizona: "US Gov Arizona",
      usgovtexas: "US Gov Texas",
      usgovvirginia: "US Gov Virginia",
    };
    if (Array.isArray(window.AZURE_REGION_KEYS)) {
      return window.AZURE_REGION_KEYS.map((k) => reverseMap[k] || k);
    }
    return Object.keys(reverseMap)
      .filter((k) => typeof window[k] === "object" && window[k] !== null)
      .map((k) => reverseMap[k]);
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
      currentMemory,
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
      options,
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
    // getVMSeries("Standard_D2s_v3") → "D"; UI selects "D-series" → compare with suffix
    // Gate: restrictMainFamilies (azure.html and multicloud both use this checkbox)
    if (
      options.restrictMainFamilies &&
      options.selectedAzureSeries?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) => {
        const vmSeries = this.getVMSeries(instance.instanceType);
        const seriesLabel = (vmSeries + "-series").toLowerCase();
        if (
          !options.selectedAzureSeries.some(
            (s) => s.toLowerCase() === seriesLabel,
          )
        ) {
          return false;
        }
        return true;
      });
    }

    // Azure-specific: Processor Architecture Filter
    // UI returns "Intel Xeon"/"AMD EPYC"/"ARM Ampere Altra"; instance.processor stores "Intel"/"AMD"/"ARM"
    if (
      options.restrictProcessorManufacturers &&
      options.selectedAzureProcessors?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) => {
        const instProc = (instance.processor || "").toLowerCase().trim();
        if (!instProc) return true;
        return options.selectedAzureProcessors.some((p) =>
          instProc.startsWith(p.split(" ")[0].toLowerCase()),
        );
      });
    }

    // Azure-specific: VM Family Filter
    // UI returns "Standard_D"/"Standard_B"/etc.; check instance type prefix
    if (
      options.restrictMainFamilies &&
      options.selectedAzureVMFamilies?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) =>
        options.selectedAzureVMFamilies.some((f) =>
          instance.instanceType.startsWith(f),
        ),
      );
    }

    return filteredInstances;
  }

  // Azure-specific: Log enhanced loading statistics
  logLoadingStatistics(instances, region) {
    super.logLoadingStatistics(instances, region);

    const armCount = instances.filter((i) => this.isARMInstance(i)).length;
    const vmSeries = new Set(
      instances.map((i) => this.getVMSeries(i.instanceType)),
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

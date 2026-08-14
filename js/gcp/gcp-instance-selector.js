// GCP Instance Selector - GCP-specific implementation
// Extends BaseInstanceSelector with GCP-specific functionality

class GCPInstanceSelector extends BaseInstanceSelector {
  constructor() {
    super();

    // GCP regions and zones
    this.gcpRegions = [
      // Americas
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
      "us-east5-a",
      "us-east5-b",
      "us-east5-c",
      "us-east7-a",
      "us-east7-b",
      "us-east7-c",
      "us-south1-a",
      "us-south1-b",
      "us-south1-c",
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
      "us-west8-a",
      "us-west8-b",
      "us-west8-c",
      "northamerica-northeast1-a",
      "northamerica-northeast1-b",
      "northamerica-northeast1-c",
      "northamerica-northeast2-a",
      "northamerica-northeast2-b",
      "northamerica-northeast2-c",
      "northamerica-south1-a",
      "northamerica-south1-b",
      "northamerica-south1-c",
      "southamerica-east1-a",
      "southamerica-east1-b",
      "southamerica-east1-c",
      "southamerica-west1-a",
      "southamerica-west1-b",
      "southamerica-west1-c",
      // Europe
      "europe-central2-a",
      "europe-central2-b",
      "europe-central2-c",
      "europe-north1-a",
      "europe-north1-b",
      "europe-north1-c",
      "europe-north2-a",
      "europe-north2-b",
      "europe-north2-c",
      "europe-southwest1-a",
      "europe-southwest1-b",
      "europe-southwest1-c",
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
      "europe-west5-a",
      "europe-west5-b",
      "europe-west5-c",
      "europe-west6-a",
      "europe-west6-b",
      "europe-west6-c",
      "europe-west8-a",
      "europe-west8-b",
      "europe-west8-c",
      "europe-west9-a",
      "europe-west9-b",
      "europe-west9-c",
      "europe-west10-a",
      "europe-west10-b",
      "europe-west10-c",
      "europe-west12-a",
      "europe-west12-b",
      "europe-west12-c",
      // Asia Pacific
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
      "asia-south2-a",
      "asia-south2-b",
      "asia-south2-c",
      "asia-southeast1-a",
      "asia-southeast1-b",
      "asia-southeast1-c",
      "asia-southeast2-a",
      "asia-southeast2-b",
      "asia-southeast2-c",
      "asia-southeast3-a",
      "asia-southeast3-b",
      "asia-southeast3-c",
      "australia-southeast1-a",
      "australia-southeast1-b",
      "australia-southeast1-c",
      "australia-southeast2-a",
      "australia-southeast2-b",
      "australia-southeast2-c",
      // Middle East & Africa
      "africa-south1-a",
      "africa-south1-b",
      "africa-south1-c",
      "me-central1-a",
      "me-central1-b",
      "me-central1-c",
      "me-central2-a",
      "me-central2-b",
      "me-central2-c",
      "me-west1-a",
      "me-west1-b",
      "me-west1-c",
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
    // Strip zone suffix (e.g. "us-central1-a" -> "us-central1", "europe-west1-d" -> "europe-west1")
    // Zone suffixes are single letters at the end; numeric suffixes (e.g. "europe-west10") are part of the region name
    const withoutZone = region.replace(/-[a-f]$/, "");
    return withoutZone.toLowerCase().replace(/[\s-]/g, "_");
  }

  getAllAvailableRegionKeys() {
    if (!window.GCP_DATA_READY) return [];
    if (Array.isArray(window.GCP_REGION_KEYS)) {
      return window.GCP_REGION_KEYS.map((k) => k.replace(/_/g, "-"));
    }
    // GCP globals look like us_central1, europe_west10, africa_south1 — one underscore, ends in digits
    // AWS globals like us_east_1 have two underscores so the pattern below won't match them
    return Object.keys(window)
      .filter(
        (k) =>
          /^[a-z]+_[a-z]+\d+$/.test(k) &&
          typeof window[k] === "object" &&
          window[k] !== null,
      )
      .map((k) => k.replace(/_/g, "-")); // us_central1 → us-central1 (normalizeRegionForJS handles it from there)
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

  // The tightest VALID GCP custom machine type for a required size, or "" when the
  // family cannot be custom or the inputs are unusable. GCP's rules: vCPUs are 1 or
  // an even number; memory is a whole number of 256 MB blocks and, without extended
  // memory, between 0.5 GB and 8 GB per vCPU. The size is rounded UP to satisfy the
  // requirement (never below it) and clamped into the per-vCPU memory band. Result
  // is "<family>-custom-<vCPU>-<memoryMB>", e.g. "n2-custom-4-16384". Only the
  // families that actually offer custom shapes qualify — a custom string for a
  // family GCP does not allow it on would be a value the user cannot deploy.
  buildCustomMachineType(family, cpu, memory) {
    const fam = String(family || "")
      .toLowerCase()
      .trim();
    if (!GCPInstanceSelector.CUSTOM_CAPABLE_FAMILIES.includes(fam)) return "";
    const c = Number(cpu);
    const m = Number(memory);
    if (!Number.isFinite(c) || !Number.isFinite(m) || c <= 0 || m <= 0)
      return "";

    // vCPU: 1, or rounded up to the next even number.
    let vCpu = Math.max(1, Math.ceil(c));
    if (vCpu > 1 && vCpu % 2 !== 0) vCpu += 1;

    // Memory: round the requirement up to a whole 256 MB block, then clamp into
    // the 0.5–8 GB-per-vCPU band (both bounds are whole 256 MB blocks already).
    let memMb = Math.ceil((m * 1024) / 256) * 256;
    const minMb = 0.5 * vCpu * 1024; // 0.5 GB/vCPU (already a whole 256 MB block)
    const maxMb = 8 * vCpu * 1024; // 8 GB/vCPU
    if (memMb < minMb) memMb = minMb;
    if (memMb > maxMb) memMb = maxMb;

    return `${fam}-custom-${vCpu}-${memMb}`;
  }

  // Whether a standard pick wastes enough to be worth a custom suggestion: it
  // provides at least `overhead` MORE vCPU or memory than the row requires, on
  // either axis. Default 25% (a documented, tunable threshold). Guards keep a
  // missing figure from ever reading as wasteful.
  customShapeWorthwhile(stdVCpus, stdMem, reqCpu, reqMem, overhead = 0.25) {
    const sv = Number(stdVCpus);
    const sm = Number(stdMem);
    const rc = Number(reqCpu);
    const rm = Number(reqMem);
    if (![sv, sm, rc, rm].every((n) => Number.isFinite(n) && n > 0))
      return false;
    return sv >= rc * (1 + overhead) || sm >= rm * (1 + overhead);
  }

  // Whether this run excludes GCP custom shapes — the "Custom" classifier in the
  // GCP exclude list. Read through the same token vocabulary the pool filters use,
  // so a { provider: "gcp", type: "Custom" } run-level token and a plain per-row
  // "custom" both count, and a token tagged for another provider does not.
  isCustomExcluded(options) {
    const list = (options && options.excludeTypes) || [];
    const provider = this.getProviderName().toLowerCase();
    return list.some(
      (item) =>
        this._typeTokenName(item) === "custom" &&
        this._typeTokenAppliesTo(item, provider),
    );
  }

  // The "GCP Custom Fit" cell for one row: a tighter custom machine type when the
  // chosen standard pick over-provisions the requirement past the threshold, or ""
  // otherwise. Returns "" for a no-match/absent pick, when Custom is excluded, when
  // the waste is under the threshold, or when the pick's family cannot be custom
  // (buildCustomMachineType decides that last one). Requirement is the row's own
  // vCPU/memory. Pure — no pricing (D8), only headroom.
  customFitSuggestion(chosen, reqCpu, reqMem, options) {
    if (
      !chosen ||
      !chosen.instanceType ||
      chosen.instanceType === "No data available"
    )
      return "";
    if (this.isCustomExcluded(options)) return "";
    if (
      !this.customShapeWorthwhile(chosen.vCpus, chosen.memory, reqCpu, reqMem)
    )
      return "";
    return this.buildCustomMachineType(
      this.getMachineSeries(chosen.instanceType),
      reqCpu,
      reqMem,
    );
  }

  // GCP-specific: Enhanced instance result
  createInstanceResult(instance, currentCpu, currentMemory) {
    const result = super.createInstanceResult(
      instance,
      currentCpu,
      currentMemory,
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
      options,
    );

    // NOTE: any provider-specific soft filter added below must get a matching
    // probe group in base-instance-selector.js `_nearestMissProbes`, or the
    // "Nearest Miss" column will under-report why an instance was excluded.

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
    // getMachineSeries("n2-standard-4") → "n2"; UI selects "N2" → case-insensitive compare
    // Gate: restrictMainFamilies (gcp.html and multicloud both use this checkbox)
    if (
      options.restrictMainFamilies &&
      options.selectedGCPFamilies?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) => {
        const machineSeries = this.getMachineSeries(instance.instanceType);
        return options.selectedGCPFamilies.some(
          (f) => f.toLowerCase() === machineSeries.toLowerCase(),
        );
      });
    }

    // GCP-specific: Machine Type Category Filter
    if (
      options.restrictMainFamilies &&
      options.selectedGCPMachineTypes?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) => {
        const category = this.getMachineTypeCategory(instance.instanceType);
        return options.selectedGCPMachineTypes.includes(category);
      });
    }

    // GCP-specific: Processor Platform Filter
    // UI returns "Intel Skylake"/"AMD Rome"/"ARM Ampere Altra"; instance.processor stores "Intel"/"AMD"/"ARM"
    if (
      options.restrictProcessorManufacturers &&
      options.selectedGCPProcessors?.length > 0
    ) {
      filteredInstances = filteredInstances.filter((instance) => {
        const instProc = (instance.processor || "").toLowerCase().trim();
        if (!instProc) return true;
        return options.selectedGCPProcessors.some((p) =>
          instProc.startsWith(p.split(" ")[0].toLowerCase()),
        );
      });
    }

    return filteredInstances;
  }

  // GCP-specific: Log enhanced loading statistics
  logLoadingStatistics(instances, region) {
    super.logLoadingStatistics(instances, region);

    const armCount = instances.filter((i) => this.isARMInstance(i)).length;
    const machineSeries = new Set(
      instances.map((i) => this.getMachineSeries(i.instanceType)),
    ).size;
    const sharedCoreCount = instances.filter(
      (i) => this.getMachineTypeCategory(i.instanceType) === "shared-core",
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

// The GCP machine families that offer custom vCPU/RAM shapes. Compute-optimized
// (C2/C3), memory-optimized (M*), accelerator (A*/G*), HPC (H3), storage (Z3) and
// the Tau/shared-core families do NOT, so a custom suggestion is never made for
// them — the general-purpose families are the ones GCP lets you tailor.
GCPInstanceSelector.CUSTOM_CAPABLE_FAMILIES = [
  "e2",
  "n1",
  "n2",
  "n2d",
  "n4",
  "n4d",
];

// Export GCP instance selector
window.GCPInstanceSelector = GCPInstanceSelector;

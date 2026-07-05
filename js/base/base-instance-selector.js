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

  // Returns all region name strings (CSV-format) available in window globals.
  // Override in each provider subclass.
  getAllAvailableRegionKeys() {
    return [];
  }

  // Pre-warms ALL regions from the data file in the background.
  async preloadAllRegions() {
    const regions = this.getAllAvailableRegionKeys();
    if (!regions.length) return;
    console.log(
      `[PreWarm] ${this.getProviderName()}: loading ${regions.length} regions in background`,
    );
    await this.loadInstanceData(regions);
    console.log(`[PreWarm] ${this.getProviderName()}: complete`);
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
      "normalizeRegionForJS must be implemented by provider class",
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

      let usedFallback = false;
      try {
        regionData = this.getRegionDataFromGlobal(normalizedRegion);
        console.log(
          `Successfully retrieved ${normalizedRegion} data from global object`,
        );
      } catch {
        try {
          const manifestKey =
            this._resolveManifestKey(normalizedRegion) || normalizedRegion;
          if (manifestKey !== normalizedRegion) {
            console.warn(
              `[FuzzyRegion] '${region}' resolved to manifest key '${manifestKey}'`,
            );
          }
          await this._injectRegionScript(manifestKey);
          regionData = this.getRegionDataFromGlobal(manifestKey);
          console.log(`Lazily loaded ${manifestKey} data via region script`);
        } catch {
          console.warn(
            `${this.getProviderName()} ${normalizedRegion} not in global scope yet — using fallback`,
          );
          regionData = this.getFallbackData();
          usedFallback = true;
        }
      }

      const instances = this.parseData(regionData, region);
      this.instanceData[region] = instances;
      if (!usedFallback) {
        this.loadedRegions.add(
          `${this.getProviderName().toLowerCase()}-${region}`,
        );
      }
      this.logLoadingStatistics(instances, region);
    } catch (error) {
      console.error(
        `Failed to load data for ${this.getProviderName()} ${region}:`,
        error,
      );
      this.instanceData[region] = this.getFallbackInstances(region);
    }
  }

  // Resolves a normalized region against the manifest key list. Exact hit
  // wins; otherwise a unique prefix match (e.g. AZ-suffixed "us_east_1a" →
  // "us_east_1"). Ambiguous or absent → null. Input may only ever match a
  // key it EXTENDS — a shorter input never expands to a longer key, so
  // "eastus" can never grab "eastus2".
  _resolveManifestKey(normalizedRegion) {
    const keys = window[`${this.getProviderName().toUpperCase()}_REGION_KEYS`];
    if (!Array.isArray(keys)) return null;
    if (keys.includes(normalizedRegion)) return normalizedRegion;
    const strip = (s) =>
      String(s)
        .toLowerCase()
        .replace(/[\s\-_]/g, "");
    const target = strip(normalizedRegion);
    const matches = keys.filter((k) => {
      const nk = strip(k);
      return nk === target || target.startsWith(nk);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  // Public wrappers — the stable surface for callers outside the selector
  // classes (main-script region validation / worker data collection)
  resolveManifestKey(normalizedRegion) {
    return this._resolveManifestKey(normalizedRegion);
  }

  ensureRegionScriptLoaded(normalizedRegion) {
    return this._injectRegionScript(normalizedRegion);
  }

  // Lazily loads js/{provider}/regions/{key}.js via a same-origin <script>
  // tag (CSP forbids fetch/XHR). Only active once the provider's data file
  // is a manifest ({P}_REGION_KEYS present); with a monolithic data file it
  // throws immediately so behavior is unchanged.
  async _injectRegionScript(normalizedRegion) {
    if (window[normalizedRegion]) return;

    if (typeof document === "undefined") {
      throw new Error(
        "Region scripts cannot be injected outside the main thread",
      );
    }

    const provider = this.getProviderName().toLowerCase();
    const manifestKeys =
      window[`${this.getProviderName().toUpperCase()}_REGION_KEYS`];
    if (!Array.isArray(manifestKeys)) {
      throw new Error(
        `No region manifest for ${this.getProviderName()} — nothing to lazy-load`,
      );
    }
    if (!manifestKeys.includes(normalizedRegion)) {
      throw new Error(
        `${normalizedRegion} is not in the ${this.getProviderName()} region manifest`,
      );
    }

    window._regionScriptPromises = window._regionScriptPromises || {};
    const cacheKey = `${provider}:${normalizedRegion}`;
    if (!window._regionScriptPromises[cacheKey]) {
      window._regionScriptPromises[cacheKey] = new Promise(
        (resolve, reject) => {
          const script = document.createElement("script");
          script.src = `js/${provider}/regions/${normalizedRegion}.js`;
          script.onload = () => resolve();
          script.onerror = () => {
            delete window._regionScriptPromises[cacheKey];
            reject(new Error(`Failed to load region script: ${script.src}`));
          };
          document.head.appendChild(script);
        },
      );
    }
    await window._regionScriptPromises[cacheKey];
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
          mapping,
        );

        if (this.isValidInstance(standardized)) {
          instances.push(standardized);
        }
      } catch (error) {
        console.warn(
          `Error parsing instance ${instanceType} for ${this.getProviderName()} ${region}:`,
          error,
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
        mapping,
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
      (i) => i.generation === 1.0 || i.generation === "1.0",
    ).length;
    const familyTypes = new Set(instances.map((i) => i.familyName)).size;

    console.log(
      `Loaded ${
        instances.length
      } instances for ${this.getProviderName()} ${region}`,
    );
    console.log(`  - Current Generation: ${currentGenCount} instances`);
    console.log(`  - Family Types: ${familyTypes} categories`);
  }

  // Common like-to-like instance selection
  getLikeToLikeInstance(region, currentCpu, currentMemory, options = {}) {
    console.log(
      `Getting like-to-like for ${this.getProviderName()} ${region}: ${currentCpu}vCPU, ${currentMemory}GB`,
    );

    this._lastRulesApplied = [];

    const hasExactRegion = Object.prototype.hasOwnProperty.call(
      this.instanceData,
      region,
    );
    let regionData = this.instanceData[region];
    let usedRegion = region;
    if (!hasExactRegion) {
      const fuzzy = this._findFuzzyRegion(region);
      if (fuzzy) {
        regionData = this.instanceData[fuzzy];
        usedRegion = fuzzy;
        console.warn(
          `[FuzzyRegion] '${region}' not found — using '${fuzzy}' instead`,
        );
      }
    }
    if (!regionData?.length) {
      console.warn(`No data available for ${this.getProviderName()} ${region}`);
      return this.createEmptyResult(
        hasExactRegion
          ? `No instance data is available for region '${region}'`
          : `Region '${region}' not found — check spelling or use a supported region name`,
      );
    }

    const filteredInstances = this.applyFilters(
      regionData,
      currentCpu,
      currentMemory,
      options,
    );

    if (!filteredInstances.length) {
      console.warn(
        `No instances meet filtering criteria for ${this.getProviderName()} ${region}`,
      );
      const empty = this.createEmptyResult(
        "No instances meet filtering requirements",
      );
      const nearestMiss = this.computeNearestMiss(
        regionData,
        currentCpu,
        currentMemory,
        options,
      );
      if (nearestMiss) empty.nearestMiss = nearestMiss;
      return empty;
    }

    // filteredInstances[0] is cheapest (price-sorted by parseData)
    // or cheapest-within-preferred-workload-family when rule engine re-sorted
    const bestInstance = filteredInstances[0];

    console.log(
      `Selected ${bestInstance.instanceType} for ${this.getProviderName()} ${region}`,
    );

    const result = this.createInstanceResult(
      bestInstance,
      currentCpu,
      currentMemory,
    );
    result.rulesApplied = (this._lastRulesApplied || []).join(" | ");
    return result;
  }

  // Apply common filters
  applyFilters(instances, currentCpu, currentMemory, options) {
    let filtered = instances.filter((instance) => {
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
        const providerName = this.getProviderName().toLowerCase();
        if (
          options.excludeTypes.some((excludeItem) => {
            if (excludeItem == null) return false;
            const typeName = (
              typeof excludeItem === "string"
                ? excludeItem
                : excludeItem.type || ""
            )
              .toLowerCase()
              .trim();
            if (!typeName) return false;
            const itemProvider =
              typeof excludeItem === "object"
                ? (excludeItem.provider || "").toLowerCase()
                : "";
            if (itemProvider && itemProvider !== providerName) return false;

            const fam = (instance.family || "").toLowerCase();
            const instType = (instance.instanceType || "").toLowerCase();
            const familyName = (instance.familyName || "").toLowerCase();

            switch (typeName) {
              case "burstable":
                return typeof RuleEngine !== "undefined"
                  ? RuleEngine.isBurstable(instance, providerName)
                  : fam.startsWith("t");
              case "graviton":
              case "arm":
                return typeof RuleEngine !== "undefined"
                  ? RuleEngine.isARM(instance)
                  : instance.isGraviton === 1 || instance.isGraviton === 1.0;
              case "gpu":
                return (
                  familyName.includes("gpu") ||
                  familyName.includes("accelerated") ||
                  ["p", "g", "inf", "trn", "dl", "vt"].some((f) =>
                    fam.startsWith(f),
                  ) ||
                  fam.startsWith("nc") ||
                  fam.startsWith("nd") ||
                  fam.startsWith("nv")
                );
              case "fpga":
                return fam.startsWith("f") && providerName === "aws";
              case "mac":
                return fam.startsWith("mac");
              case "previous generation":
                return typeof RuleEngine !== "undefined"
                  ? !RuleEngine.isCurrentGen(instance)
                  : instance.generation !== 1 && instance.generation !== "1.0";
              default:
                return instType.includes(typeName);
            }
          })
        ) {
          return false;
        }
      }

      return true;
    });

    // Apply rule engine (ENV / OS / Workload / Compliance rules)
    if (typeof RuleEngine !== "undefined" && filtered.length > 0) {
      const ruleResult = RuleEngine.apply(
        filtered,
        options,
        this.getProviderName().toLowerCase(),
      );
      this._lastRulesApplied = ruleResult.rules;
      if (ruleResult.instances.length > 0) {
        filtered = ruleResult.instances;
      }
      // If rule engine empties the list, keep original filtered set and note it
      else if (ruleResult.rules.length > 0) {
        this._lastRulesApplied = [
          ...ruleResult.rules,
          "⚠ No matches after rules — fallback to unrestricted",
        ];
      }
    }

    return filtered;
  }

  // When no instance passes the active filters, find the cheapest instance that
  // still meets the size requirement and identify which soft-filter group(s)
  // removed it. Runs through the real (provider) filter pipeline, so it stays
  // correct for provider-specific filters too. Returns null when nothing even
  // meets the size — that shortfall isn't a filter problem, so there's no
  // "nearest miss" to relax toward.
  computeNearestMiss(instances, currentCpu, currentMemory, options) {
    if (!instances || !instances.length) return null;
    // Size-only pass (no soft filters): instances are price-sorted, so [0] is
    // the cheapest instance that would fit.
    const sizingOnly = this.applyFilters(
      instances,
      currentCpu,
      currentMemory,
      {},
    );
    if (!sizingOnly.length) return null;
    const nearest = sizingOnly[0];
    const blockedBy = [];
    for (const probe of this._nearestMissProbes(options)) {
      // If the nearest instance is removed when only this group is active,
      // that group is (part of) why nothing matched.
      const survives = this.applyFilters(
        [nearest],
        currentCpu,
        currentMemory,
        probe.opts,
      ).length;
      if (!survives) blockedBy.push(probe.label);
    }
    return {
      instanceType: nearest.instanceType,
      vCpus: nearest.vCpus,
      memory: nearest.memory,
      blockedBy,
    };
  }

  // One probe per soft-filter group, each carrying only that group's option
  // keys (union across providers — a provider ignores keys it doesn't use), so
  // running it alone reveals whether that group blocks a given instance.
  _nearestMissProbes(options) {
    const pick = (keys) => {
      const o = {};
      keys.forEach((k) => {
        if (options[k] !== undefined) o[k] = options[k];
      });
      return o;
    };
    return [
      {
        label: "current-generation only",
        opts: pick(["currentGenerationOnly"]),
      },
      {
        label: "instance-family name",
        opts: pick([
          "restrictInstanceFamilyNames",
          "selectedInstanceFamilyNames",
        ]),
      },
      {
        label: "processor manufacturer",
        opts: pick([
          "restrictProcessorManufacturers",
          "selectedProcessorManufacturers",
          "selectedAzureProcessors",
          "selectedGCPProcessors",
        ]),
      },
      {
        label: "instance family/series",
        opts: pick([
          "restrictMainFamilies",
          "selectedMainFamilies",
          "selectedAzureSeries",
          "selectedAzureVMFamilies",
          "selectedGCPFamilies",
          "selectedGCPMachineTypes",
        ]),
      },
      {
        label: "exclude types",
        opts: pick(["excludeTypes", "excludeGraviton", "excludeARM"]),
      },
    ];
  }

  // N/2, N, N+1 optimization strategy
  getOptimizedInstance(
    region,
    currentCpu,
    currentMemory,
    cpuUtil,
    memoryUtil,
    options = {},
  ) {
    console.log(
      `Getting optimized for ${this.getProviderName()} ${region}: ${currentCpu}vCPU, ${currentMemory}GB, CPU:${cpuUtil}%, Mem:${memoryUtil}%`,
    );
    console.log("Using N/2, N, N+1 optimization strategy");

    let targetCpu = currentCpu;
    let targetMemory = currentMemory;

    // Apply N/2, N, N+1 strategy
    if (options.cpuBased && cpuUtil > 0) {
      if (cpuUtil <= options.cpuDownsizeMax) {
        targetCpu = Math.max(1, Math.ceil(currentCpu / 2));
        console.log(
          `CPU Downsizing (N/2): ${currentCpu} -> ${targetCpu} vCPUs`,
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
          `Memory Downsizing (N/2): ${currentMemory} -> ${targetMemory} GB`,
        );
      } else if (memoryUtil > options.memoryUpsizeMin) {
        targetMemory = currentMemory + 1;
        console.log(
          `Memory Upsizing (N+1): ${currentMemory} -> ${targetMemory} GB`,
        );
      }
    }

    const result = this.getLikeToLikeInstance(
      region,
      targetCpu,
      targetMemory,
      options,
    );
    result.reason = `N/2, N, N+1 Strategy optimization from ${currentCpu}vCPU/${currentMemory}GB to ${targetCpu}vCPU/${targetMemory}GB based on utilization (CPU:${cpuUtil}%, Mem:${memoryUtil}%)`;

    return result;
  }

  // Fuzzy region match: normalize both sides and try prefix / contains matching
  _findFuzzyRegion(region) {
    const normalize = (s) =>
      String(s)
        .toLowerCase()
        .replace(/[\s\-_]/g, "");
    const target = normalize(region);
    const candidates = Object.keys(this.instanceData).filter(
      (k) => this.instanceData[k]?.length,
    );
    // Exact normalized match
    const exact = candidates.find((k) => normalize(k) === target);
    if (exact) return exact;

    // Provider-normalized alias match, e.g. GCP zone "us-central1-a" → region "us-central1"
    try {
      const providerTarget = this.normalizeRegionForJS(region);
      const providerExact = candidates.find(
        (k) => this.normalizeRegionForJS(k) === providerTarget,
      );
      if (providerExact) return providerExact;
    } catch {
      // normalizeRegionForJS is abstract; skip if not callable in this context
    }

    // Prefix match: only allow candidate-starts-with-input (not the reverse)
    // Prevents "East US" matching when "East US 2" was requested
    const prefixMatches = candidates.filter((k) =>
      normalize(k).startsWith(target),
    );
    return prefixMatches.length === 1 ? prefixMatches[0] : null;
  }

  // Create empty result
  createEmptyResult(reason) {
    return {
      instanceType: "No data available",
      vCpus: 0,
      memory: 0,
      price: 0,
      hourlyPrice: "0.00",
      rulesApplied: (this._lastRulesApplied || []).join(" | "),
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

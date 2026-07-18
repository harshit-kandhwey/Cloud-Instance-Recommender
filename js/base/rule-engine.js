// Rule Engine - ENV, OS, Workload, Compliance, and MinGen rules applied before instance selection
//
// CSV input columns (also settable via UI Rule Engine defaults):
//   ENV        : Production | Staging | Dev | Test  (blank = no rules)
//   OS         : Linux | Windows | macOS             (blank = Linux)
//   Workload   : General | Database | Web Server | Cache | ML/AI | Batch | HPC  (blank = General)
//   Compliance : PCI | HIPAA | SOC2 | FIPS           (blank = none)
//   Min Gen    : AWS gen number (5/6/7), Azure v-number (3/4/5), GCP family (n2/n4)
//
// Rule reference:
//   1a  Burstable exclusion  — Production/Staging block t-family (AWS), B-series (Azure), f1/g1/e2-shared (GCP)
//   1b  Generation + Compliance — Production + Compliance: current-gen only; PCI/HIPAA (AWS): Nitro required
//   1c  Size floor — Production/Staging: no nano/micro (AWS), ≥2 vCPUs (Azure/GCP)
//   1d  Network preference — Production + DB/Web: prefer ≥4 vCPU instances (higher network bandwidth tier)
//   OS  Windows: exclude ARM/Graviton; macOS (AWS): mac1/mac2 families only
//   MG  MinGen: exclude instances older than the specified generation (m5<m6<m7 / Dsv3<Dsv4<Dsv5 / N1<N2<N4)
//   WL  Workload preference: sort results so workload-appropriate families appear first
// @ts-check

/**
 * A candidate instance as produced by the provider selectors.
 * @typedef {Object} Instance
 * @property {string} instanceType
 * @property {number} vCpus
 * @property {number} price
 * @property {string} [family]
 * @property {number|string} [generation]
 * @property {number|string} [isGraviton]
 * @property {string} [processor]
 * @property {{ nitroEnclavesSupport?: number|string }} [originalData]
 */

/**
 * Per-row rule inputs (resolved from CSV columns / UI defaults upstream).
 * @typedef {Object} RuleOptions
 * @property {string} [rowEnv]
 * @property {string} [rowOS]
 * @property {string} [rowWorkload]
 * @property {string} [rowCompliance]
 * @property {string} [rowMinGen]
 * @property {number} [reqCpu] required vCPUs — bounds workload over-provisioning
 * @property {number} [reqMemory] required memory (GB) — bounds the same
 */

/** @typedef {"aws"|"azure"|"gcp"} Provider */

const RuleEngine = (() => {
  const AWS_BURSTABLE_FAMILIES = ["t1", "t2", "t3", "t3a", "t4g"];
  const GCP_BURSTABLE_SERIES = ["f1", "g1"];

  // Workload → preferred instance family prefixes per provider
  const WORKLOAD_FAMILIES = {
    aws: {
      general: ["m"],
      database: ["r", "x", "z"],
      "web server": ["m", "c"],
      web: ["m", "c"],
      cache: ["r", "x"],
      "ml/ai": ["p", "g", "trn", "inf"],
      ml: ["p", "g", "trn", "inf"],
      ai: ["p", "g", "trn", "inf"],
      batch: ["c", "m"],
      hpc: ["hpc", "c"],
      sap: ["x1", "x2", "r", "u-"],
    },
    azure: {
      general: ["d"],
      database: ["e", "m"],
      "web server": ["d", "f"],
      web: ["d", "f"],
      cache: ["e", "m"],
      "ml/ai": ["nc", "nd", "nv"],
      ml: ["nc", "nd", "nv"],
      ai: ["nc", "nd", "nv"],
      batch: ["f", "d"],
      hpc: ["hb", "hc"],
      sap: ["mv2", "msv2", "m"],
    },
    gcp: {
      general: ["n2", "e2"],
      database: ["m1", "m2", "m3", "m4"],
      "web server": ["n2", "e2", "n4"],
      web: ["n2", "e2", "n4"],
      cache: ["m1", "m2", "m3"],
      "ml/ai": ["a2", "a3", "g2"],
      ml: ["a2", "a3", "g2"],
      ai: ["a2", "a3", "g2"],
      batch: ["c2", "c2d", "c3", "c3d"],
      hpc: ["h3", "c2"],
      sap: ["m1", "m2", "m3", "m4"],
    },
  };

  // AWS instance type size rank — used for size floor (Rule 1c)
  const AWS_SIZE_RANK = { nano: 0, micro: 1, small: 2, medium: 3, large: 4 };

  /** @param {string} instanceType */
  function awsSizeRank(instanceType) {
    const size = (instanceType.split(".")[1] || "").toLowerCase();
    return size in AWS_SIZE_RANK ? AWS_SIZE_RANK[size] : 99;
  }

  /**
   * @param {Instance} inst
   * @param {Provider} provider
   */
  function isBurstable(inst, provider) {
    const fam = (inst.family || "").toLowerCase();
    if (provider === "aws") return AWS_BURSTABLE_FAMILIES.includes(fam);
    if (provider === "azure") return fam.startsWith("b"); // B-series: bsv2, bsv3, bpsv2, …
    if (provider === "gcp") {
      if (GCP_BURSTABLE_SERIES.includes(fam)) return true;
      // e2 shared-core: only micro/small/medium (not full e2 standard/highmem/highcpu)
      if (fam === "e2") {
        const type = (inst.instanceType || "").toLowerCase();
        return /(^|-)e2-(micro|small|medium)(-|$)/.test(type);
      }
    }
    return false;
  }

  /** @param {Instance} inst */
  function isCurrentGen(inst) {
    const g = inst.generation;
    return g === 1 || g === 1.0 || g === "1" || g === "1.0";
  }

  /** @param {Instance} inst */
  function isARM(inst) {
    const g = inst.isGraviton;
    if (g === 1 || g === 1.0 || g === "1" || g === "1.0") return true;
    const processor = (inst.processor || "").toLowerCase();
    const family = (inst.family || "").toLowerCase();
    const type = (inst.instanceType || "").toLowerCase();
    return (
      processor.includes("arm") ||
      processor.includes("graviton") ||
      processor.includes("ampere") ||
      family.startsWith("t2a") ||
      type.startsWith("t2a-")
    );
  }

  /** @param {Instance} inst */
  function isNitroCapable(inst) {
    const raw = inst.originalData || {};
    const v = raw.nitroEnclavesSupport;
    return v === 1 || v === 1.0 || v === "1" || v === "1.0";
  }

  // GCP generation order map (higher = newer)
  const GCP_GEN_ORDER = {
    f1: 0,
    g1: 0,
    n1: 1,
    e2: 1,
    n2: 2,
    n2d: 2,
    c2: 2,
    c2d: 2,
    t2a: 2,
    t2d: 2,
    a2: 3,
    g2: 3,
    c3: 3,
    c3d: 3,
    n4: 4,
    c4: 4,
  };

  /**
   * @param {Instance} inst
   * @param {string} minGen
   * @param {Provider} provider
   */
  function meetsMinGeneration(inst, minGen, provider) {
    if (!minGen) return true;
    const type = (inst.instanceType || "").toLowerCase();
    const family = (inst.family || "").toLowerCase();

    if (provider === "aws") {
      // m5.xlarge→5, m6i.xlarge→6, r7a.large→7, t3.micro→3
      const m = type.match(/^[a-z]+(\d+)/);
      if (!m) return true;
      return parseInt(m[1]) >= parseInt(minGen);
    }

    if (provider === "azure") {
      // Standard_Dsv3→v3, Standard_D4s_v3→v3, Standard_Esv5→v5
      // Azure page uses values 3/4/5 (direct v-number)
      // Multi-cloud page uses values 5/6/7 (AWS-centric: subtract 2 to get v-number)
      const minNum = parseInt(minGen) || 0;
      const azureMin = minNum > 4 ? minNum - 2 : minNum;
      const m = type.match(/v(\d+)/i);
      if (!m) return azureMin <= 2; // no v-suffix = original old-style, exclude if min≥3
      return parseInt(m[1]) >= azureMin;
    }

    if (provider === "gcp") {
      // GCP page uses family-name values ("n2","n4"); multi-cloud uses numbers (5,6,7→2,3,4)
      const minNum = parseInt(minGen) || 0;
      let gcpMin;
      if (GCP_GEN_ORDER.hasOwnProperty(minGen)) {
        gcpMin = GCP_GEN_ORDER[minGen];
      } else {
        // AWS-centric number: 5→2, 6→3, 7→4
        gcpMin = Math.max(0, minNum - 3);
      }
      const fam = family.split("-")[0];
      const instGen = GCP_GEN_ORDER[fam] ?? 1;
      return instGen >= gcpMin;
    }

    return true;
  }

  /**
   * @param {string} workload
   * @param {Provider} provider
   * @returns {string[]}
   */
  function getPreferredFamilies(workload, provider) {
    const wl = (workload || "general").toLowerCase().trim();
    return (
      (WORKLOAD_FAMILIES[provider] || {})[wl] ||
      (WORKLOAD_FAMILIES[provider] || {})["general"] ||
      []
    );
  }

  // A workload preference is a nudge toward an APPROPRIATE FAMILY, never a licence
  // to over-provision. A like-to-like match may use at most double the requested
  // vCPUs and quadruple the requested memory to honour the preference; beyond
  // that the "preferred" instance is not a like-to-like match at all and the
  // preference is dropped, leaving the normal cheapest-adequate pick.
  //
  // Without this bound the preference silently defeated size fit: GCP's
  // memory-optimized m-series starts at 32 vCPU / 976 GiB, so a 2 vCPU / 4 GB
  // Cache VM landed on m3-ultramem-32 (32 vCPU / 976 GiB) — 16× the cores it
  // asked for. AWS/Azure have small memory-optimized instances (r6g.large,
  // e2psv6), so their preference still applies; GCP simply has no close-fit
  // member for a small workload, so it correctly falls back.
  const WORKLOAD_MAX_CPU_FACTOR = 2;
  const WORKLOAD_MAX_MEM_FACTOR = 4;

  // Is this instance a close-enough like-to-like fit to be worth preferring?
  // With no requirement to bound against, everything is eligible (preserves the
  // prior behaviour for any caller that doesn't pass the requirement).
  function isWorkloadFit(instance, reqCpu, reqMemory) {
    if (!reqCpu && !reqMemory) return true;
    const cpuOk = !reqCpu || instance.vCpus <= reqCpu * WORKLOAD_MAX_CPU_FACTOR;
    const memOk =
      !reqMemory || instance.memory <= reqMemory * WORKLOAD_MAX_MEM_FACTOR;
    return cpuOk && memOk;
  }

  // True when at least one preferred-family instance is a close-enough fit — so
  // the preference can actually be honoured without over-provisioning.
  function hasPreferredFit(instances, workload, provider, reqCpu, reqMemory) {
    const preferred = getPreferredFamilies(workload, provider);
    if (!preferred.length) return false;
    return instances.some(
      (inst) =>
        preferred.some((f) =>
          (inst.family || "").toLowerCase().startsWith(f),
        ) && isWorkloadFit(inst, reqCpu, reqMemory),
    );
  }

  // Sort the close-fitting preferred families first, cheapest within each tier.
  // A preferred-family instance that over-provisions past the fit bound is NOT
  // treated as preferred, so it can't jump ahead of the cheapest-adequate pick.
  /**
   * @param {Instance[]} instances
   * @param {string} workload
   * @param {Provider} provider
   * @param {number} [reqCpu]
   * @param {number} [reqMemory]
   */
  function sortByWorkload(instances, workload, provider, reqCpu, reqMemory) {
    const preferred = getPreferredFamilies(workload, provider);
    if (!preferred.length) return instances;
    const isPreferred = (inst) =>
      preferred.some((f) => (inst.family || "").toLowerCase().startsWith(f)) &&
      isWorkloadFit(inst, reqCpu, reqMemory);
    return [...instances].sort((a, b) => {
      const as = isPreferred(a) ? 0 : 1;
      const bs = isPreferred(b) ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.price - b.price;
    });
  }

  // ─── Main entry point ─────────────────────────────────────────────────────
  // options keys used:  rowEnv, rowOS, rowWorkload, rowCompliance, rowMinGen
  // provider:           "aws" | "azure" | "gcp"
  // Returns:            { instances: [...], rules: [string, ...] }
  /**
   * @param {Instance[]} instances
   * @param {RuleOptions} options
   * @param {Provider} provider
   * @returns {{ instances: Instance[], rules: string[] }}
   */
  function apply(instances, options, provider) {
    const env = (options.rowEnv || "").toLowerCase().trim();
    const os = (options.rowOS || "linux").toLowerCase().trim();
    const workload = (options.rowWorkload || "general").toLowerCase().trim();
    const compliance = (options.rowCompliance || "").toLowerCase().trim();
    const minGen = (options.rowMinGen || "").toLowerCase().trim();

    let filtered = [...instances];
    const rules = [];

    const isProd = env === "production" || env === "prod";
    const isStaging = env === "staging" || env === "stage";
    const isCompliance = ["pci", "hipaa", "soc2", "fips"].includes(compliance);
    const requiresAwsNitro = ["pci", "hipaa"].includes(compliance);

    // ── 1a: Burstable exclusion ─────────────────────────────────────────────
    if (isProd || isStaging) {
      const before = filtered.length;
      filtered = filtered.filter((i) => !isBurstable(i, provider));
      if (filtered.length < before) rules.push("1a: Burstable excluded");
    }

    // ── 1b: Current generation (Production + Compliance) ────────────────────
    if (isProd || isCompliance) {
      const before = filtered.length;
      filtered = filtered.filter(isCurrentGen);
      if (filtered.length < before) rules.push("1b: Prev-gen excluded");
    }

    // ── 1b: Nitro Enclaves required for AWS under PCI/HIPAA ────────────────
    if (requiresAwsNitro && provider === "aws") {
      const nitro = filtered.filter(isNitroCapable);
      if (nitro.length > 0) {
        filtered = nitro;
        rules.push("1b: Nitro required (Compliance)");
      }
    }

    // ── 1c: Minimum size floor ──────────────────────────────────────────────
    if (isProd || isStaging) {
      const before = filtered.length;
      if (provider === "aws") {
        filtered = filtered.filter((i) => awsSizeRank(i.instanceType) >= 2); // ≥ small
      } else {
        filtered = filtered.filter((i) => i.vCpus >= 2); // Azure/GCP: ≥ 2 vCPUs for Prod/Staging
      }
      if (filtered.length < before) rules.push("1c: Size floor applied");
    }

    // ── 1d: Network preference — Production + DB/Web ────────────────────────
    if (
      isProd &&
      (workload === "database" ||
        workload === "web server" ||
        workload === "web")
    ) {
      const net = filtered.filter((i) => i.vCpus >= 4);
      if (net.length > 0) {
        filtered = net;
        rules.push("1d: Network-tier preference (≥4 vCPUs)");
      }
    }

    // ── OS: Windows → exclude ARM/Graviton ─────────────────────────────────
    if (os === "windows" || os === "windows server") {
      const before = filtered.length;
      filtered = filtered.filter((i) => !isARM(i));
      if (filtered.length < before) rules.push("OS: ARM excluded (Windows)");
    }

    // ── OS: macOS → AWS mac1/mac2 only ─────────────────────────────────────
    if ((os === "macos" || os === "mac") && provider === "aws") {
      filtered = filtered.filter((i) =>
        (i.family || "").toLowerCase().startsWith("mac"),
      );
      rules.push("OS: mac1/mac2 only (macOS)");
    }

    // ── Min Generation filter ───────────────────────────────────────────────
    if (minGen) {
      const genFiltered = filtered.filter((i) =>
        meetsMinGeneration(i, minGen, provider),
      );
      if (genFiltered.length > 0) {
        filtered = genFiltered;
        rules.push(`MinGen: ${minGen}+`);
      }
      // If filter empties the pool, keep current set and note it
    }

    // ── Workload preference: sort close-fitting preferred families first ────
    // Only when a preferred-family instance is a close-enough fit — otherwise
    // honouring the preference would force a hugely over-provisioned instance
    // (see WORKLOAD_MAX_*_FACTOR), so the size-based order stands and the row
    // says why the nudge didn't apply.
    if (workload && workload !== "general") {
      const preferred = getPreferredFamilies(workload, provider);
      if (preferred.length) {
        const reqCpu = Number(options.reqCpu) || 0;
        const reqMemory = Number(options.reqMemory) || 0;
        if (hasPreferredFit(filtered, workload, provider, reqCpu, reqMemory)) {
          filtered = sortByWorkload(
            filtered,
            workload,
            provider,
            reqCpu,
            reqMemory,
          );
          rules.push(`Workload: ${workload} preference`);
        } else {
          rules.push(
            `Workload: ${workload} preference not applied (no close-size match)`,
          );
        }
      }
    }

    return { instances: filtered, rules };
  }

  // A comparable "newness" ordinal per provider (higher = newer), for the
  // Newest-Generation alternative. Mirrors the family/version parsing in
  // meetsMinGeneration so the two never disagree on what "newer" means.
  /**
   * @param {Instance} inst
   * @param {Provider} provider
   * @returns {number}
   */
  function generationRank(inst, provider) {
    const type = (inst.instanceType || "").toLowerCase();
    const family = (inst.family || "").toLowerCase();
    if (provider === "aws") {
      const m = type.match(/^[a-z]+(\d+)/); // m7i.large → 7
      return m ? parseInt(m[1]) : 0;
    }
    if (provider === "azure") {
      // The VERSION is the TRAILING v<n> (d4asv7 → 7). Anchor to the end so a
      // size-embedded "v" like nv72adsv5 isn't misread as generation 72.
      const m = type.match(/v(\d+)$/i);
      return m ? parseInt(m[1]) : 2; // no v-suffix = old-style
    }
    if (provider === "gcp") {
      const fam = family.split("-")[0]; // e2-standard → e2
      return GCP_GEN_ORDER[fam] ?? 1;
    }
    return 0;
  }

  return {
    apply,
    getPreferredFamilies,
    isBurstable,
    isCurrentGen,
    isARM,
    meetsMinGeneration,
    // Exposed for the alternative-strategy picks (base-instance-selector):
    isWorkloadFit,
    generationRank,
  };
})();

window.RuleEngine = RuleEngine;
console.log("RuleEngine loaded — ENV/OS/Workload/Compliance rules ready");

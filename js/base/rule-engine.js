// Rule Engine - ENV, OS, Workload, Compliance, and MinGen rules applied before instance selection
//
// CSV input columns (also settable via UI Rule Engine defaults):
//   ENV        : Production | Staging | Dev | Test  (blank = no rules)
//   OS         : Linux | Windows | macOS             (blank = Linux)
//   Workload   : General | Database | SQL Server | Web Server | Cache | ML/AI | Batch | HPC  (blank = General)
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
//   GA  Accelerators: ML/AI requires a GPU/ASIC/FPGA instance; every other
//       workload excludes one, so a GPU box is never recommended by accident
//   BP  Burstable preference — Dev/Test at low utilization prefers burstable
//       families (the inverse of 1a's Production/Staging exclusion)
//   SQL SQL Server: at least 4 vCPUs, because SQL Server is licensed per core
//       with a 4-core minimum per VM — a smaller box is billed for 4 anyway
// @ts-check

/**
 * A candidate instance as produced by the provider selectors.
 * @typedef {Object} Instance
 * @property {string} instanceType
 * @property {number} vCpus
 * @property {number} price
 * @property {string} [family]
 * @property {string} [familyName] the provider's own class ("GPU instance")
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
 * @property {number} [rowCpuUtil] resolved CPU utilization % (0 = unknown)
 * @property {number} [rowMemoryUtil] resolved memory utilization % (0 = unknown)
 * @property {number} [cpuDownsizeMax] the run's "low utilization" threshold
 * @property {number} [memoryDownsizeMax] the same, for memory
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
      "sql server": ["r", "x", "z"],
      sql: ["r", "x", "z"],
      "web server": ["m", "c"],
      web: ["m", "c"],
      cache: ["r", "x"],
      "ml/ai": ["p", "g", "trn", "inf"],
      ml: ["p", "g", "trn", "inf"],
      ai: ["p", "g", "trn", "inf"],
      gpu: ["p", "g", "trn", "inf"],
      batch: ["c", "m"],
      hpc: ["hpc", "c"],
      sap: ["x1", "x2", "r", "u-"],
    },
    azure: {
      general: ["d"],
      database: ["e", "m"],
      "sql server": ["e", "m"],
      sql: ["e", "m"],
      "web server": ["d", "f"],
      web: ["d", "f"],
      cache: ["e", "m"],
      "ml/ai": ["nc", "nd", "nv"],
      ml: ["nc", "nd", "nv"],
      ai: ["nc", "nd", "nv"],
      gpu: ["nc", "nd", "nv"],
      batch: ["f", "d"],
      hpc: ["hb", "hc"],
      sap: ["mv2", "msv2", "m"],
    },
    gcp: {
      general: ["n2", "e2"],
      database: ["m1", "m2", "m3", "m4"],
      "sql server": ["m1", "m2", "m3", "m4"],
      sql: ["m1", "m2", "m3", "m4"],
      "web server": ["n2", "e2", "n4"],
      web: ["n2", "e2", "n4"],
      cache: ["m1", "m2", "m3"],
      "ml/ai": ["a2", "a3", "g2"],
      ml: ["a2", "a3", "g2"],
      ai: ["a2", "a3", "g2"],
      gpu: ["a2", "a3", "g2"],
      batch: ["c2", "c2d", "c3", "c3d"],
      hpc: ["h3", "c2"],
      sap: ["m1", "m2", "m3", "m4"],
    },
  };

  // ─── Accelerator classification ───────────────────────────────────────────
  // familyName is the provider's OWN classification and is the only reliable
  // signal, so it is checked first. The exact strings present in the region
  // files (verified against us-east-1 / eastus / us-central1):
  //   AWS    "GPU instance", "Machine Learning ASIC Instances",
  //          "FPGA Instances", "Media Accelerator Instances"
  //   Azure  "GPU"
  //   GCP    "Accelerator optimized"
  // Matching on substrings of these rather than the whole string, so a renamed
  // or newly-added accelerator class ("GPU instances", "Accelerator-optimized")
  // still classifies.
  const ACCELERATOR_FAMILY_NAME =
    /\bgpu\b|accelerat|\basic\b|\bfpga\b|\btpu\b/i;

  // Fallback ONLY for an instance whose familyName is blank (sample/fallback
  // data). Deliberately anchored per provider: the previous provider-agnostic
  // prefix list classified Azure's Dl-series (General purpose) and G/GS
  // (Memory optimized) as GPUs — 60 instances in eastus — because "dl" and "g"
  // are accelerator prefixes on AWS but not on Azure.
  const ACCELERATOR_FAMILY_PREFIXES = {
    aws: [
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "g2",
      "g3",
      "g4",
      "g5",
      "g6",
      "g7",
      "gr6",
      "inf",
      "trn",
      "dl1",
      "vt",
      "f1",
      "f2",
    ],
    azure: ["nc", "nd", "nv", "np", "nm"],
    gcp: ["a2", "a3", "a4", "g2"],
  };

  /**
   * Is this an accelerator (GPU / ML ASIC / FPGA / media) instance?
   * @param {Instance} inst
   * @param {Provider} provider
   */
  function isAccelerator(inst, provider) {
    const familyName = inst.familyName || "";
    if (familyName) return ACCELERATOR_FAMILY_NAME.test(familyName);
    const fam = (inst.family || "").toLowerCase();
    if (!fam) return false;
    return (ACCELERATOR_FAMILY_PREFIXES[provider] || []).some((f) =>
      fam.startsWith(f),
    );
  }

  // SQL Server is licensed per core with a documented minimum of 4 core
  // licences per VM, so a 1 or 2 vCPU recommendation is billed as 4 regardless
  // — the smaller box saves no licence money and only costs performance. The
  // rule raises the floor rather than the pick: an 8 vCPU SQL box stays 8.
  const SQL_MIN_CORES = 4;
  const SQL_WORKLOADS = ["sql server", "sql", "sqlserver", "mssql"];

  // Falls back to the same 40% the N/2 rules default to, for a run that never
  // set a threshold (a like-to-like-only run carries none).
  const DEFAULT_LOW_UTILIZATION = 40;

  // Workloads that MUST land on an accelerator. Every other workload — general
  // included — must not, so a GPU box is never recommended by accident.
  const ACCELERATOR_WORKLOADS = ["ml/ai", "ml", "ai", "gpu"];

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
   * @returns {number|null}
   */
  // The Azure version of one instance, or null when it carries none (an
  // original-generation box). ONE parser, because two of them is exactly how the
  // MinGen filter and generationRank came to disagree.
  //
  // Read from the FAMILY, not the instance type. The family carries the version
  // and nothing else — "nv" → none, "nvv3" → 3, "dsv5" → 5 — so there is no size
  // digit to mistake for a version. The type cannot be parsed reliably at all:
  // "nv48sv3" needs the TRAILING v3, but "nv24" is a bare NV-series box whose
  // trailing "v24" is its vCPU count, and no suffix rule separates the two.
  // Verified against js/azure/regions/: nv24 → family "nv", nv48sv3 → "nvv3".
  function azureVersion(inst) {
    const family = (inst.family || "").toLowerCase();
    const fm = family.match(/v(\d+)$/);
    if (fm) return parseInt(fm[1]);
    if (family) return null; // family known, carries no version → old-style
    // No family at all (hand-built fixtures): fall back to the type's trailing
    // version, which is correct whenever a real version suffix is present.
    const tm = (inst.instanceType || "").toLowerCase().match(/v(\d+)$/);
    return tm ? parseInt(tm[1]) : null;
  }

  // An Azure instance with no version is an original-generation box, which ranks
  // as 2. Both the MinGen filter and generationRank need that fact; stating it
  // twice — once as `v === null ? num <= 2`, once as `v === null ? 2 : v` — is
  // the same "two encodings of one fact" that let the filter and the rank
  // disagree in the first place, so it lives here once.
  const AZURE_NO_VERSION_RANK = 2;
  /**
   * @param {Instance} inst
   */
  function azureRank(inst) {
    const v = azureVersion(inst);
    return v === null ? AZURE_NO_VERSION_RANK : v;
  }

  // EVERY MinGen value is NATIVE to the provider it is applied to: an AWS value
  // is an AWS family number (7 → m7/c7/r7), an Azure value is a v-number
  // (5 → v5), a GCP value is a family name ("n4"). Each page supplies one value
  // for its own cloud, and the multi-cloud page supplies three — one per
  // provider — so a value never has to be translated between clouds.
  //
  // There used to be a single cross-provider scale that meant different things
  // per cloud (7 = AWS 7 / Azure v5 / GCP N4), sharing one number space with the
  // native values, and the engine guessed between them with
  // `minNum > 4 ? minNum - 2 : minNum`. That guess is why the Azure page's own
  // "v5+ (Dsv5, Esv5…)" option quietly filtered to v3+: its 5 was read as a
  // cross-provider position. The scale is gone; nothing is translated, so
  // nothing can be misread.
  /**
   * @param {Instance} inst
   * @param {string} minGen
   * @param {Provider} provider
   */
  function meetsMinGeneration(inst, minGen, provider) {
    if (!minGen) return true;
    const type = (inst.instanceType || "").toLowerCase();
    const family = (inst.family || "").toLowerCase();
    const raw = String(minGen).trim();
    const num = parseInt(raw) || 0;

    if (provider === "aws") {
      // m5.xlarge→5, m6i.xlarge→6, r7a.large→7, t3.micro→3
      const m = type.match(/^[a-z]+(\d+)/);
      if (!m) return true;
      return parseInt(m[1]) >= num;
    }

    if (provider === "azure") {
      // Standard_Dsv3→v3, Standard_D4s_v3→v3, Standard_Esv5→v5. The value IS the
      // v-number: "5" means v5, not "the fifth position on some other scale".
      // Was /v(\d+)/ on the TYPE, which took the FIRST match — so the "v" in an
      // NV/NC series name was read as the version: nv48sv3 (a v3 box) became
      // generation 48, and nv24 became 24. Both looked absurdly new, so no
      // MinGen filter could exclude them. See azureVersion.
      return azureRank(inst) >= num;
    }

    if (provider === "gcp") {
      // GCP's native value is a FAMILY NAME ("n2", "n4"), which is what every
      // GCP control now sends — GCP has no v-number a user would type.
      //
      // A bare NUMBER only reaches here from a legacy shared "Min Gen" CSV
      // column written against the old cross-provider scale, so it keeps that
      // scale's mapping (5→gen 2, 6→gen 3, 7→gen 4) rather than being read as a
      // GCP ordinal — which would make "7" mean a generation that does not
      // exist and silently match nothing. Per-provider columns avoid this
      // entirely; see the "GCP Min Gen" column.
      let gcpMin;
      if (GCP_GEN_ORDER.hasOwnProperty(raw)) {
        gcpMin = GCP_GEN_ORDER[raw];
      } else {
        gcpMin = Math.max(0, num - 3);
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
    const isDevTest = ["dev", "development", "test", "testing", "qa"].includes(
      env,
    );
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

    // ── GPU: require an accelerator, or keep one out of the result ──────────
    // An accelerator is not a substitute for a general-purpose box of the same
    // shape: it costs far more and carries hardware the workload will not use.
    // Both directions degrade rather than force a no-match — if the filter
    // would empty the pool, the pool stands and the row says the rule did not
    // apply.
    if (ACCELERATOR_WORKLOADS.includes(workload)) {
      const accel = filtered.filter((i) => isAccelerator(i, provider));
      if (accel.length > 0) {
        filtered = accel;
        rules.push("GPU: accelerator required");
      } else {
        rules.push("GPU: no accelerator available (not applied)");
      }
    } else {
      const withoutAccel = filtered.filter((i) => !isAccelerator(i, provider));
      if (withoutAccel.length > 0 && withoutAccel.length < filtered.length) {
        filtered = withoutAccel;
        rules.push("GPU: accelerators excluded (non-GPU workload)");
      }
    }

    // ── SQL: minimum core count for SQL Server licensing ────────────────────
    // A floor, not a target: this only removes candidates below the licence
    // minimum, so a SQL box that genuinely needs 16 vCPUs still gets 16. It
    // runs before the two preference sorts so neither can reorder a candidate
    // the licence floor should have removed. Degrades like every other filter
    // — if nothing clears the floor, the pool stands and the row says so.
    if (SQL_WORKLOADS.includes(workload)) {
      const licensed = filtered.filter((i) => i.vCpus >= SQL_MIN_CORES);
      if (licensed.length > 0) {
        if (licensed.length < filtered.length) {
          rules.push(`SQL: ${SQL_MIN_CORES}-vCPU licence floor`);
        }
        filtered = licensed;
      } else {
        rules.push(
          `SQL: ${SQL_MIN_CORES}-vCPU licence floor not applied (no candidate that large)`,
        );
      }
    }

    // ── BP: Dev/Test at low utilization prefers burstable ───────────────────
    // The inverse of 1a. A Dev box that idles is exactly what a burstable
    // family is for, and 1a already keeps them out of Production/Staging, so
    // the two rules can never both fire on one row.
    //
    // Deliberately placed BEFORE the workload preference: that sort runs last
    // and therefore wins, so an explicit workload (a Dev database asking for
    // memory-optimized) is never silently overridden by this nudge. A general
    // or blank workload does not sort at all, which is the common Dev/Test
    // case and where this rule does its work.
    //
    // "Low" is the run's OWN downsize threshold, not a new number invented
    // here, so the rule and the N/2 sizing agree on what low means.
    if (isDevTest) {
      const cpuUtil = Number(options.rowCpuUtil) || 0;
      const memUtil = Number(options.rowMemoryUtil) || 0;
      const cpuLow = Number(options.cpuDownsizeMax) || DEFAULT_LOW_UTILIZATION;
      const memLow =
        Number(options.memoryDownsizeMax) || DEFAULT_LOW_UTILIZATION;

      // Unknown utilization is not low utilization. Without a reading there is
      // no evidence the box idles, and preferring burstable on no evidence
      // would quietly hand every Dev row a credit-limited instance.
      const known = cpuUtil > 0 || memUtil > 0;
      const isLow =
        known &&
        (cpuUtil === 0 || cpuUtil <= cpuLow) &&
        (memUtil === 0 || memUtil <= memLow);

      if (isLow) {
        const reqCpu = Number(options.reqCpu) || 0;
        const reqMemory = Number(options.reqMemory) || 0;
        const fits = filtered.some(
          (i) =>
            isBurstable(i, provider) && isWorkloadFit(i, reqCpu, reqMemory),
        );
        if (fits) {
          filtered = [...filtered].sort((a, b) => {
            const as =
              isBurstable(a, provider) && isWorkloadFit(a, reqCpu, reqMemory)
                ? 0
                : 1;
            const bs =
              isBurstable(b, provider) && isWorkloadFit(b, reqCpu, reqMemory)
                ? 0
                : 1;
            if (as !== bs) return as - bs;
            return a.price - b.price;
          });
          rules.push("BP: Burstable preferred (Dev/Test, low utilization)");
        }
      }
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
      // Same single parser the MinGen filter uses, so the two cannot drift.
      return azureRank(inst);
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
    isAccelerator,
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

// Rule Engine - ENV, OS, Workload, Compliance, and MinGen rules applied before instance selection
//
// CSV input columns (also settable via UI Rule Engine defaults):
//   ENV        : Production | Staging | Dev | Test  (blank = no rules)
//   OS         : Linux | Windows | macOS             (blank = Linux)
//   Workload   : General | Database | SQL Server | Web Server | Cache | ML/AI | Batch | HPC |
//                SAP | Analytics | File Server | NoSQL | Application Server | Container Host |
//                Build Farm | Domain Controller  (blank = General)
//   Compliance : comma-separated, like Exclude/Include Only — Current-Generation Hardware |
//                AWS Nitro Enclaves | Confidential Computing | Azure Trusted Launch
//                (blank = none; legacy PCI/HIPAA/SOC2/FIPS still work — see COMPLIANCE_ALIASES)
//   Min Gen    : AWS gen number (5/6/7), Azure v-number (3/4/5), GCP family (n2/n4)
//
// Rule reference:
//   1a  Burstable exclusion  — Production/Staging block burstable instances (see isBurstable:
//       AWS/GCP real fields, Azure family-prefix proxy — no better signal exists)
//   1b  Generation + Compliance — Production, or Compliance names Current-Generation Hardware:
//       current-gen only. AWS Nitro Enclaves (AWS): Nitro required. Confidential Computing:
//       AWS Nitro reused, Azure dc*/ec* family match, GCP no signal (not applied). Azure Trusted
//       Launch (Azure): the real trusted_launch field required.
//   1c  Size floor — Production/Staging: no nano/micro (AWS), ≥2 vCPUs (Azure/GCP)
//   1d  Network preference — Production + DB/Web: prefer instances with a higher
//       network tier (AWS/Azure: real published fields; GCP: no better signal exists,
//       kept as a ≥4 vCPU proxy — see hasNetworkTier)
//   OS  Windows: exclude ARM/Graviton; macOS (AWS): mac1/mac2 families only
//   MG  MinGen: exclude instances older than the specified generation (m5<m6<m7 / Dsv3<Dsv4<Dsv5 / N1<N2<N4)
//   WL  Workload preference: sort results so workload-appropriate families appear first
//   GA  Accelerators: ML/AI requires a GPU/ASIC/FPGA instance; every other
//       workload excludes one, so a GPU box is never recommended by accident
//       (isAccelerator: familyName is primary; the real GPU-count field backs
//       the blank-familyName fallback, ahead of the family-prefix list)
//   BP  Burstable preference — Dev/Test at low utilization prefers burstable
//       families (the inverse of 1a's Production/Staging exclusion)
//   SQL SQL Server: at least 4 vCPUs (virtual cores) by default, because SQL
//       Server is licensed per core with a 4-core minimum per VM — a smaller
//       box is billed for 4 anyway. options.sqlPhysicalCoreLicensing switches
//       the floor to physical cores (AWS/Azure only; GCP has no such field
//       and keeps the vCPU floor regardless), for License Mobility/BYOL.
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
 * @property {{ nitroEnclavesSupport?: number|string, baselineBandwidthGbps?: number, acceleratedNetworking?: number|string, cores?: number, vcpusPerCore?: number, burstMinutes?: number, sharedCpu?: number|string, gpuCount?: number, isBareMetal?: number|string, trustedLaunch?: number|string }} [originalData]
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
 * @property {boolean} [sqlPhysicalCoreLicensing] Rule SQL's floor counts
 *   physical cores instead of vCPUs (AWS/Azure only) — see rule-engine.js
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
      sqlserver: ["r", "x", "z"],
      mssql: ["r", "x", "z"],
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
      // R-series is AWS's own documented recommendation for Spark/Hadoop
      // (high memory-per-vCPU for in-memory processing); i3/i4i add NVMe
      // for shuffle-heavy jobs.
      analytics: ["r", "i"],
      spark: ["r", "i"],
      "big data": ["r", "i"],
      // d2/d3 (dense HDD) + i3/i4i (NVMe): cheap high-capacity throughput,
      // what a file/backup target actually needs over compute or memory.
      "file server": ["d", "i"],
      file: ["d", "i"],
      backup: ["d", "i"],
      // i3/i4i is AWS's own recommendation for MongoDB/Cassandra/
      // Elasticsearch (high random IOPS); r as the memory-bound fallback.
      nosql: ["i", "r"],
      search: ["i", "r"],
      "application server": ["m", "c"],
      "app server": ["m", "c"],
      middleware: ["m", "c"],
      "container host": ["m", "c"],
      container: ["m", "c"],
      kubernetes: ["m", "c"],
      "build farm": ["c"],
      build: ["c"],
      "ci/cd": ["c"],
      // Low, steady utilization most of the time — t-family burstable is a
      // genuine cost fit here, not just a Dev-box default. Rule 1a still
      // excludes burstable outright for Production/Staging regardless of
      // this preference, so listing it here is safe for Prod and useful
      // for Dev/Test domain controllers.
      "domain controller": ["t", "m"],
      "jump box": ["t", "m"],
      jumpbox: ["t", "m"],
    },
    azure: {
      general: ["d"],
      database: ["e", "m"],
      "sql server": ["e", "m"],
      sql: ["e", "m"],
      sqlserver: ["e", "m"],
      mssql: ["e", "m"],
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
      // Lsv3 is Microsoft's own documented recommendation for "Big Data,
      // SQL, NoSQL databases, data analytics, and data warehousing" — the
      // same family covers analytics, file/backup, and NoSQL below.
      analytics: ["l"],
      spark: ["l"],
      "big data": ["l"],
      "file server": ["l"],
      file: ["l"],
      backup: ["l"],
      nosql: ["l", "e"],
      search: ["l", "e"],
      "application server": ["d", "f"],
      "app server": ["d", "f"],
      middleware: ["d", "f"],
      "container host": ["d", "f"],
      container: ["d", "f"],
      kubernetes: ["d", "f"],
      "build farm": ["f"],
      build: ["f"],
      "ci/cd": ["f"],
      // See the AWS block's note: burstable B-series is a genuine cost fit
      // for a low-utilization role, not just excluded outright — 1a still
      // excludes it for Production/Staging regardless of this preference.
      "domain controller": ["b", "d"],
      "jump box": ["b", "d"],
      jumpbox: ["b", "d"],
    },
    gcp: {
      general: ["n2", "e2"],
      database: ["m1", "m2", "m3", "m4"],
      "sql server": ["m1", "m2", "m3", "m4"],
      sql: ["m1", "m2", "m3", "m4"],
      sqlserver: ["m1", "m2", "m3", "m4"],
      mssql: ["m1", "m2", "m3", "m4"],
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
      // Z3 is Google's own documented recommendation for "scale-out
      // analytics workloads, flash-optimized databases" — covers analytics,
      // file/backup, and NoSQL below the same way AWS/Azure's storage
      // families do.
      analytics: ["z3", "n2"],
      spark: ["z3", "n2"],
      "big data": ["z3", "n2"],
      "file server": ["z3"],
      file: ["z3"],
      backup: ["z3"],
      nosql: ["z3", "m1", "m2", "m3", "m4"],
      search: ["z3", "m1", "m2", "m3", "m4"],
      "application server": ["n2", "e2", "n4"],
      "app server": ["n2", "e2", "n4"],
      middleware: ["n2", "e2", "n4"],
      "container host": ["n2", "e2"],
      container: ["n2", "e2"],
      kubernetes: ["n2", "e2"],
      "build farm": ["c2", "c2d", "c3", "c3d"],
      build: ["c2", "c2d", "c3", "c3d"],
      "ci/cd": ["c2", "c2d", "c3", "c3d"],
      // See the AWS block's note: e2's shared-core sizes are a genuine cost
      // fit for a low-utilization role — 1a still excludes burstable for
      // Production/Staging regardless of this preference.
      "domain controller": ["e2", "n2"],
      "jump box": ["e2", "n2"],
      jumpbox: ["e2", "n2"],
    },
  };

  // ─── Recognised rule-value vocabularies ───────────────────────────────────
  // The SINGLE source of truth for both apply()'s matching below and the
  // upload-time hygiene check (analyzeInputHygiene in ingest.js), so a value the
  // engine treats as default is NAMED for the user. Every token lowercase, matching
  // apply()'s normalisation. Keep these exactly the vocabularies apply() matches — a
  // listed token no rule reads would report "recognised" while doing nothing.
  const ENV_PRODUCTION = ["production", "prod"];
  const ENV_STAGING = ["staging", "stage"];
  const ENV_DEV_TEST = ["dev", "development", "test", "testing", "qa"];
  // Compliance used to be four regulatory-sounding names (PCI/HIPAA/SOC2/FIPS)
  // that, in the engine, collapsed to exactly two behaviours: "current-gen
  // only" (all four) and, ONLY for PCI/HIPAA on AWS, "Nitro Enclaves
  // required." None of the four are things this tool can certify — PCI-DSS,
  // HIPAA and SOC 2 are account/program-level facts, not instance-type
  // facts — and PCI/HIPAA were literally indistinguishable in code. Renamed
  // 2026-09-05 to what they actually check, as atomic, independently
  // selectable options a CSV cell (or the page) can combine (comma-separated,
  // the same convention Exclude/Include Only already use):
  //   "current-generation hardware"  — exclude previous-generation instances
  //   "aws nitro enclaves"           — require Nitro-capable instances (AWS only)
  //   "confidential computing"       — see isConfidentialCapable below
  //   "azure trusted launch"         — see isTrustedLaunchCapable below
  // The old names still work, expanded through COMPLIANCE_ALIASES below, so
  // no existing CSV or preset breaks.
  const COMPLIANCE_ATOMIC = [
    "current-generation hardware",
    "aws nitro enclaves",
    "confidential computing",
    "azure trusted launch",
  ];
  const COMPLIANCE_ALIASES = {
    pci: ["current-generation hardware", "aws nitro enclaves"],
    hipaa: ["current-generation hardware", "aws nitro enclaves"],
    soc2: ["current-generation hardware"],
    fips: ["current-generation hardware"],
  };
  // Every token a Compliance cell may legitimately carry — the atomic set for
  // the hygiene check, PLUS the legacy names so an old CSV isn't flagged as
  // unrecognised for using them.
  const COMPLIANCE_VALUES = [
    ...COMPLIANCE_ATOMIC,
    ...Object.keys(COMPLIANCE_ALIASES),
  ];

  // A Compliance cell is a comma-separated list, like Exclude/Include Only —
  // multiple real requirements can apply to one row at once. Each token
  // expands through COMPLIANCE_ALIASES if it's a legacy name, or is used
  // as-is if it's already one of the atomic names; unrecognised tokens are
  // dropped silently here (the hygiene check is what names them to the user).
  /** @param {string|undefined} raw */
  function expandComplianceTokens(raw) {
    const tokens = new Set();
    String(raw || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .forEach((t) => {
        (COMPLIANCE_ALIASES[t] || [t]).forEach((a) => tokens.add(a));
      });
    return tokens;
  }
  const OS_WINDOWS = ["windows", "windows server"];
  const OS_MAC = ["macos", "mac"];
  const OS_VALUES = ["linux", ...OS_WINDOWS, ...OS_MAC];

  // THE canonical "is this row Windows" test. OS_WINDOWS above is a fixed
  // vocabulary for display (the template dropdown, RECOGNIZED.os) — this is
  // the predicate every OS-branching DECISION reads. A real inventory export
  // says "Windows Server 2022", not the bare "windows server" OS_WINDOWS
  // lists, so this matches by PREFIX rather than exact string. Two call
  // sites used to keep independent copies of this test — this one with an
  // EXACT match against OS_WINDOWS, base-instance-selector.js's
  // `_poolForOS` with this same prefix regex — and they disagreed on every
  // string except the two bare tokens. On GCP that mattered: its Windows
  // price is COMPOSED, never 0, so the ARM exclusion below is the ONLY
  // "cannot run Windows" signal, and a real-world OS string could satisfy
  // `_poolForOS`'s Windows pricing while skipping this exclusion entirely.
  // `_poolForOS` keeps a same-shaped fallback for the RuleEngine-free test
  // context; this is the one place either reads once RuleEngine is loaded.
  /** @param {string} os */
  function isWindowsOS(os) {
    return /^windows/i.test(String(os || "").trim());
  }

  // The recognised sets, exposed on the public API for the hygiene check. The
  // workload keys are identical across providers, so aws stands for all three.
  const RECOGNIZED = {
    env: [...ENV_PRODUCTION, ...ENV_STAGING, ...ENV_DEV_TEST],
    // os is the true recognised set, but the hygiene check deliberately does NOT
    // scan OS: everything but windows/macos is the Linux default, so a real
    // inventory's distro strings ("Ubuntu Linux (64-bit)") are correct, not lost
    // constraints — flagging them would fire on nearly every row.
    os: OS_VALUES,
    workload: Object.keys(WORKLOAD_FAMILIES.aws),
    compliance: COMPLIANCE_VALUES,
  };

  // ─── Accelerator classification ───────────────────────────────────────────
  // familyName is the provider's OWN classification and is the only reliable
  // signal, so it is checked first. The exact strings present in the region
  // files (verified against us-east-1 / eastus / us-central1):
  //   AWS    "GPU instance", "Machine Learning ASIC Instances",
  //          "FPGA Instances", "Media Accelerator Instances"
  //   Azure  "GPU"
  //   GCP    "Accelerator optimized"
  // Match on substrings so a renamed/new accelerator class ("GPU instances",
  // "Accelerator-optimized") still classifies.
  const ACCELERATOR_FAMILY_NAME =
    /\bgpu\b|accelerat|\basic\b|\bfpga\b|\btpu\b/i;

  // Fallback ONLY for an instance with a blank familyName (sample/fallback data).
  // Anchored per provider: a provider-agnostic prefix list classified Azure's
  // Dl-series and G/GS (60 instances in eastus) as GPUs because "dl"/"g" are
  // accelerator prefixes on AWS but not Azure.
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

  // familyName stays the PRIMARY check, not the real gpuCount field: FPGA
  // (AWS f1/f2), ML ASIC (AWS inf/trn) and media-accelerator instances are
  // accelerators this function must catch but report gpuCount 0 — they have
  // no GPU at all. Probed live 2026-09-04: AWS and GCP's `GPU` field is
  // always a real number; Azure's is free text ("2X K80", "1/2X A10"),
  // parsed to a number by fetch-vantage.js before it reaches here. Used only
  // in the blank-familyName fallback (sample/fallback data, no accelerator
  // classification to read) — ahead of the family-prefix list, which still
  // runs for FPGA/ASIC/media accelerators the count alone can't prove.
  /**
   * Is this an accelerator (GPU / ML ASIC / FPGA / media) instance?
   * @param {Instance} inst
   * @param {Provider} provider
   */
  function isAccelerator(inst, provider) {
    const familyName = inst.familyName || "";
    if (familyName) return ACCELERATOR_FAMILY_NAME.test(familyName);
    const raw = inst.originalData || {};
    const gpus = Number(raw.gpuCount);
    if (Number.isFinite(gpus) && gpus > 0) return true;
    const fam = (inst.family || "").toLowerCase();
    if (!fam) return false;
    return (ACCELERATOR_FAMILY_PREFIXES[provider] || []).some((f) =>
      fam.startsWith(f),
    );
  }

  // Rule 1d's network-tier preference (Production + DB/Web) used to read
  // `vCpus >= 4` as a stand-in for "gets a meaningfully higher network
  // bandwidth tier" on all three providers alike. Probed live 2026-09-04:
  // AWS and Azure each publish a real per-type signal; GCP's feed does not.
  //
  //   AWS   `baseline_bandwidth_gbps` — a real number, present on ~97% of
  //         records (missing mainly on .metal bare-metal types). Floor
  //         chosen to reproduce today's vCpus>=4 outcome closely on ordinary
  //         sizes (m5.xlarge 1.25 Gbps passes, m5.large 0.75 and t3.medium
  //         0.256 do not) while now catching what vCPU count gets wrong in
  //         both directions.
  //   Azure `accelerated_networking` — a boolean (stored 1/0, since
  //         emitValue takes no JS boolean), not a bandwidth number, but the
  //         closest real "gets the fast network path" signal Azure
  //         publishes. -1, not 0, when unreported — same convention as
  //         AWS's bandwidth fields.
  //   GCP   `network_performance` is the string "Variable" for every single
  //         shipped record (checked against ALL of them, not a sample) — it
  //         carries no per-type information at all. There is nothing better
  //         to read, so GCP KEEPS the vCpus>=4 proxy. Not a placeholder for
  //         a future fix — this was checked and is a genuine dead end for
  //         this feed.
  //
  // Both real fields are read via `inst.originalData`, the same pattern
  // `isNitroCapable` above already uses for an engine-only field the general
  // selector does not promote to a named Instance property. Neither field
  // exists yet on any SHIPPED record — both are new to FIELD_ORDER, filled
  // only by the next scheduled refresh — so `undefined` here means "dataset-
  // wide dormant," not "this one record is missing what its siblings have,"
  // and falls back to the exact pre-fix behaviour rather than going inert.
  const AWS_NETWORK_TIER_GBPS = 1;
  /**
   * @param {Instance} inst
   * @param {Provider} provider
   */
  function hasNetworkTier(inst, provider) {
    const raw = inst.originalData || {};
    if (provider === "aws") {
      const b = Number(raw.baselineBandwidthGbps);
      // -1 is fetch-vantage's "not reported" sentinel (never a real value);
      // undefined is the pre-refresh dormant case. Both fall back.
      if (!Number.isFinite(b) || b < 0) return inst.vCpus >= 4;
      return b >= AWS_NETWORK_TIER_GBPS;
    }
    if (provider === "azure") {
      const v = Number(raw.acceleratedNetworking);
      // -1 (not reported) or NaN (dormant) both fall back, same as AWS above.
      if (!Number.isFinite(v) || v < 0) return inst.vCpus >= 4;
      return v === 1;
    }
    return inst.vCpus >= 4; // GCP: see note above — no better signal exists.
  }

  // Physical core count for Rule SQL's optional physical-core licensing mode
  // (options.sqlPhysicalCoreLicensing), read the same `inst.originalData` way
  // as hasNetworkTier above. Returns null — never a guess — when no real
  // count can be derived: GCP publishes no core-count field in this feed at
  // all; AWS's `cores` carries the same -1 "not reported" sentinel and ~3%
  // bare-metal gap as its bandwidth fields; Azure's `vcpusPerCore` uses 0 as
  // ITS OWN "not reported" value (never a real ratio). `Number(undefined)` is
  // `NaN`, so the pre-refresh dormant case (neither field exists on any
  // shipped record yet) collapses into the same null path with no separate
  // check needed.
  /**
   * @param {Instance} inst
   * @param {Provider} provider
   * @returns {number|null}
   */
  function physicalCores(inst, provider) {
    const raw = inst.originalData || {};
    if (provider === "aws") {
      const c = Number(raw.cores);
      return Number.isFinite(c) && c > 0 ? c : null;
    }
    if (provider === "azure") {
      const perCore = Number(raw.vcpusPerCore);
      if (!Number.isFinite(perCore) || perCore <= 0) return null;
      return inst.vCpus / perCore;
    }
    return null; // GCP: no core-count field exists in this feed.
  }

  // SQL Server is licensed per core with a 4-core minimum per VM, so a 1-2 vCPU pick
  // is billed as 4 anyway — the smaller box saves no licence money and only costs
  // performance. Raises the floor, not the pick (an 8 vCPU SQL box stays 8). Source:
  // Microsoft "Licensing SQL Server 2022" (four core licences minimum per VM). If
  // that floor or a customer agreement changes, this constant is the one place to edit.
  //
  // This counts VIRTUAL cores (vCPUs) by default — the licensing path for a VM
  // licensed directly, with no Software Assurance / License Mobility host-based
  // licensing involved, which Microsoft's own guidance also counts by vCPU with
  // the same 4-per-VM minimum. `options.sqlPhysicalCoreLicensing` switches the
  // floor to physical cores instead, for the License Mobility / BYOL path where
  // Microsoft counts the host's physical cores — materially different on the
  // ~2:1 hyperthreaded ratio most AWS/Azure instances carry (an 8-vCPU instance
  // is often only 4 physical cores). Off by default: this is a licensing-model
  // choice, not a data-accuracy fix, and must not silently change anyone's
  // existing recommendations.
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

  // Probed live 2026-09-04: AWS publishes `burst_minutes` (how long a burstable
  // type can sustain full CPU before throttling) but only on 28 of 1428 records —
  // every t2/t3/t3a/t4g type, but NOT t1.micro, an ancient (2010-era) family that
  // IS burstable but that Vantage simply doesn't report this field for. GCP
  // publishes `shared_cpu`, a real boolean present on ALL 535 records with no gap
  // at all. Azure publishes neither — no field of any kind distinguishes B-series
  // from the rest, so it keeps the family-prefix proxy, a genuine dead end like
  // GCP's network-tier and SQL-core fields elsewhere in this file.
  //
  // AWS ORs the real field with the family list rather than replacing it: the
  // list alone is false for every non-burstable type regardless, so running it
  // as a fallback is free, and it is what keeps t1.micro (and the pre-refresh
  // dormant case, where the field doesn't exist on any shipped record yet)
  // classifying exactly as before. A future burstable family Vantage flags with
  // burst_minutes now self-classifies without a code change even before it's
  // added to the list. GCP's field has no such gap once a refresh has run —
  // dormant (undefined) is the only fallback case it needs.
  /**
   * @param {Instance} inst
   * @param {Provider} provider
   */
  function isBurstable(inst, provider) {
    const fam = (inst.family || "").toLowerCase();
    const raw = inst.originalData || {};
    if (provider === "aws") {
      const bm = Number(raw.burstMinutes);
      if (Number.isFinite(bm) && bm >= 0) return true;
      return AWS_BURSTABLE_FAMILIES.includes(fam);
    }
    if (provider === "azure") return fam.startsWith("b"); // B-series: bsv2, bsv3, bpsv2, … — no real field exists
    if (provider === "gcp") {
      if (raw.sharedCpu !== undefined) return isFlagTrue(raw.sharedCpu);
      // Dormant fallback — the exact pre-fix behaviour, for records shipped
      // before sharedCpu existed in FIELD_ORDER.
      if (GCP_BURSTABLE_SERIES.includes(fam)) return true;
      // e2 shared-core: only micro/small/medium (not full e2 standard/highmem/highcpu)
      if (fam === "e2") {
        const type = (inst.instanceType || "").toLowerCase();
        return /(^|-)e2-(micro|small|medium)(-|$)/.test(type);
      }
    }
    return false;
  }

  // One home for "does this raw 1/0-encoded flag read as true" — call sites
  // below used to hand-copy this and had drifted on which forms they
  // accepted. Number(1.0) === Number(1), so "1.0" is the only extra form.
  function isFlagTrue(v) {
    return v === 1 || v === "1" || v === "1.0";
  }

  /** @param {Instance} inst */
  function isCurrentGen(inst) {
    return isFlagTrue(inst.generation);
  }

  /** @param {Instance} inst */
  function isARM(inst) {
    if (isFlagTrue(inst.isGraviton)) return true;
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
    return isFlagTrue(raw.nitroEnclavesSupport);
  }

  // Rule 1b's Compliance="Confidential Computing" option. Cross-checked
  // against each provider's own docs 2026-09-05, not just the Vantage feed:
  //   AWS   reuses isNitroCapable — Nitro Enclaves is AWS's own confidential-
  //         computing-adjacent primitive (isolated enclaves for PII/financial/
  //         healthcare data), already the PCI/HIPAA signal above.
  //   Azure genuinely has a `confidential` field in the Vantage feed, but it
  //         reads FALSE on all 1,319 records checked — broken/unpopulated,
  //         not a real signal. Azure's actual confidential-VM series (DCasv5,
  //         DCesv5, ECasv5, DCadsv5, … — verified against Microsoft's own
  //         docs) all share one naming convention regardless of version: the
  //         family starts with "dc" or "ec". Used instead of the broken field.
  //   GCP   confidential computing is a `--confidential-compute-type` flag
  //         set at VM CREATION, but eligibility still varies by machine
  //         SERIES (re-verified against Google's own docs 2026-09-06, after
  //         an earlier pass wrongly called this a total dead end): AMD SEV
  //         on C2D/N2D/C3D/C4D, AMD SEV-SNP on N2D, Intel TDX (Preview) on
  //         C3. `inst.family` is GCP's bare series token ("c2d", not
  //         "c2d-standard"), so an exact match, same shape as Azure's dc*/
  //         ec* prefix match above.
  /**
   * @param {Instance} inst
   * @param {Provider} provider
   */
  const GCP_CONFIDENTIAL_SERIES = ["c2d", "n2d", "c3d", "c4d", "c3"];
  function isConfidentialCapable(inst, provider) {
    if (provider === "aws") return isNitroCapable(inst);
    if (provider === "azure")
      return /^(dc|ec)/i.test((inst.family || "").toLowerCase());
    if (provider === "gcp")
      return GCP_CONFIDENTIAL_SERIES.includes(
        (inst.family || "").toLowerCase(),
      );
    return false;
  }

  // Rule 1b's Compliance="Azure Trusted Launch" option — Secure Boot + a
  // virtual TPM, protecting boot integrity (distinct from Confidential
  // Computing's memory encryption; a VM can have one, both, or neither).
  // Azure-only: `trusted_launch` is a real boolean in the Vantage feed, true
  // on 130 of 1,319 records checked 2026-09-05 — a genuine, populated
  // signal, unlike the broken `confidential` field above. AWS and GCP
  // publish no equivalent field for Nitro-Secure-Boot / Shielded VM in this
  // feed, and (unlike Confidential Computing above) neither is gated by
  // machine series either, so this option is Azure-only and omitted from
  // the other pages' Compliance controls.
  /** @param {Instance} inst */
  function isTrustedLaunchCapable(inst) {
    const raw = inst.originalData || {};
    return isFlagTrue(raw.trustedLaunch);
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
    c4d: 4, // AMD variant of C4, same generation — see isConfidentialCapable above
  };

  /**
   * @param {Instance} inst
   * @returns {number|null}
   */
  // The Azure version of one instance, or null when it carries none (original-gen).
  // ONE parser — two of them is how the MinGen filter and generationRank came to
  // disagree. Read from the FAMILY, not the type: the family carries the version and
  // nothing else ("nv"→none, "nvv3"→3, "dsv5"→5), no size digit to mistake. The type
  // can't be parsed reliably — "nv48sv3" needs the trailing v3, but "nv24"'s trailing
  // "24" is its vCPU count. Verified: nv24→family "nv", nv48sv3→"nvv3".
  function azureVersion(inst) {
    const family = (inst.family || "").toLowerCase();
    const fm = family.match(/v(\d+)$/);
    if (fm) return parseInt(fm[1]);
    if (family) return null; // family known, carries no version → old-style
    // No family at all (hand-built fixtures): fall back to the type's trailing
    // version.
    const tm = (inst.instanceType || "").toLowerCase().match(/v(\d+)$/);
    return tm ? parseInt(tm[1]) : null;
  }

  // An Azure instance with no version is original-gen, ranked 2. Both the MinGen
  // filter and generationRank need this; encoding it twice is the same "two
  // encodings of one fact" that let them disagree, so it lives here once.
  const AZURE_NO_VERSION_RANK = 2;
  /**
   * @param {Instance} inst
   */
  function azureRank(inst) {
    const v = azureVersion(inst);
    return v === null ? AZURE_NO_VERSION_RANK : v;
  }

  // Live controls send a value NATIVE to its provider: AWS a family number
  // (7→m7/c7/r7), Azure a v-number (5→v5), GCP a family name ("n4"). Each page
  // supplies one value for its own cloud (multi-cloud supplies three), so no
  // cross-cloud translation happens for current input. A prior single cross-provider
  // scale (7 = AWS 7 / Azure v5 / GCP N4), guessed via `minNum > 4 ? minNum-2 :
  // minNum`, is why the Azure page's "v5+" quietly filtered to v3+; that scale is
  // gone. The one residual mapping is the GCP branch below, which still translates a
  // bare NUMBER from a legacy shared column for backward compatibility (see there).
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
      // Standard_Dsv3→v3, Standard_Esv5→v5. The value IS the v-number. Was /v(\d+)/
      // on the TYPE, taking the FIRST match — the "v" in an NV/NC name was read as
      // version (nv48sv3→gen 48, nv24→24), too new for any MinGen filter to exclude.
      // See azureVersion.
      return azureRank(inst) >= num;
    }

    if (provider === "gcp") {
      // GCP's native value is a FAMILY NAME ("n2", "n4") — what every GCP control
      // sends (GCP has no v-number a user would type). A bare NUMBER only reaches
      // here from a legacy shared "Min Gen" column on the old cross-provider scale,
      // so it keeps that mapping (5→gen 2, 6→gen 3, 7→gen 4) rather than being read
      // as a GCP ordinal (which would match nothing). See "GCP Min Gen".
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

  // A workload preference is a nudge toward an APPROPRIATE FAMILY, never a licence to
  // over-provision. A like-to-like match may use at most 2× the requested vCPUs and
  // 4× the memory to honour it; beyond that the "preferred" instance isn't like-to-
  // like and the preference is dropped for the normal cheapest-adequate pick.
  //
  // Without the bound the preference defeated size fit: GCP's memory-optimized
  // m-series starts at 32 vCPU / 976 GiB, so a 2 vCPU / 4 GB Cache VM landed on
  // m3-ultramem-32 (16× the cores). AWS/Azure have small memory-optimized instances
  // so their preference still applies; GCP has no close-fit small member and correctly
  // falls back.
  const WORKLOAD_MAX_CPU_FACTOR = 2;
  const WORKLOAD_MAX_MEM_FACTOR = 4;

  // Is this instance a close-enough like-to-like fit to be worth preferring? With no
  // requirement to bound against, everything is eligible (preserves prior behaviour).
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

  // Sort close-fitting preferred families first, cheapest within each tier. A
  // preferred-family instance that over-provisions past the fit bound is not treated
  // as preferred, so it can't jump ahead of the cheapest-adequate pick.
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
    const complianceTokens = expandComplianceTokens(options.rowCompliance);
    const minGen = (options.rowMinGen || "").toLowerCase().trim();

    let filtered = [...instances];
    const rules = [];

    // A filtering rule records how many candidates it removed, so the Rules
    // Applied column can EXPLAIN a surprising pick ("1a: Burstable excluded — 12
    // removed"), not only name the rule. Reads `filtered` against the count captured
    // before the filter, so call it AFTER the reassignment. Rules that remove nothing
    // (sort/preference, "not applied" notes) keep a plain label.
    const withCount = (label, before) => {
      const n = before - filtered.length;
      return n > 0 ? `${label} — ${n} removed` : label;
    };

    const isProd = ENV_PRODUCTION.includes(env);
    const isStaging = ENV_STAGING.includes(env);
    const isDevTest = ENV_DEV_TEST.includes(env);
    const requiresCurrentGen = complianceTokens.has(
      "current-generation hardware",
    );
    const requiresAwsNitro = complianceTokens.has("aws nitro enclaves");
    const requiresConfidential = complianceTokens.has("confidential computing");
    const requiresTrustedLaunch = complianceTokens.has("azure trusted launch");

    // ── 1a: Burstable exclusion ─────────────────────────────────────────────
    if (isProd || isStaging) {
      const before = filtered.length;
      filtered = filtered.filter((i) => !isBurstable(i, provider));
      if (filtered.length < before)
        rules.push(withCount("1a: Burstable excluded", before));
    }

    // ── 1b: Current generation (Production, or Compliance asks for it) ──────
    if (isProd || requiresCurrentGen) {
      const before = filtered.length;
      filtered = filtered.filter(isCurrentGen);
      if (filtered.length < before)
        rules.push(withCount("1b: Prev-gen excluded", before));
    }

    // ── 1b: AWS Nitro Enclaves required (Compliance) ────────────────────────
    if (requiresAwsNitro && provider === "aws") {
      const before = filtered.length;
      const nitro = filtered.filter(isNitroCapable);
      if (nitro.length > 0) {
        filtered = nitro;
        rules.push(withCount("1b: Nitro required (Compliance)", before));
      }
    }

    // ── 1b: Confidential computing required (all 3 providers) ───────────────
    // GCP used to be skipped here on the assumption its Confidential VM
    // support was a deployment-time flag with no type-level signal — wrong,
    // per a live GCP-docs check 2026-09-06 (see isConfidentialCapable): it
    // varies by machine series, same shape as Azure's family match. All
    // three providers now run the real check uniformly and report "not
    // applied" on the rows where it happens not to find a candidate.
    if (requiresConfidential) {
      const before = filtered.length;
      const confidential = filtered.filter((i) =>
        isConfidentialCapable(i, provider),
      );
      if (confidential.length > 0) {
        filtered = confidential;
        rules.push(withCount("1b: Confidential computing required", before));
      } else {
        rules.push(
          "1b: Confidential computing required (not applied — no candidate)",
        );
      }
    }

    // ── 1b: Azure Trusted Launch required (Compliance) ──────────────────────
    // Azure-only, same shape as the Nitro rule: skipped entirely for AWS/GCP,
    // neither of which publishes an equivalent field in this feed.
    if (requiresTrustedLaunch && provider === "azure") {
      const before = filtered.length;
      const trusted = filtered.filter(isTrustedLaunchCapable);
      if (trusted.length > 0) {
        filtered = trusted;
        rules.push(
          withCount("1b: Trusted Launch required (Compliance)", before),
        );
      } else {
        rules.push("1b: Trusted Launch required (not applied — no candidate)");
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
      if (filtered.length < before)
        rules.push(withCount("1c: Size floor applied", before));
    }

    // ── 1d: Network preference — Production + DB/Web ────────────────────────
    if (
      isProd &&
      (workload === "database" ||
        workload === "web server" ||
        workload === "web")
    ) {
      const before = filtered.length;
      const net = filtered.filter((i) => hasNetworkTier(i, provider));
      if (net.length > 0) {
        filtered = net;
        rules.push(withCount("1d: Network-tier preference", before));

        // AWS only — burst bandwidth has no Azure/GCP equivalent. Scoped to
        // NETWORK-TIER SURVIVORS ONLY: sorting the unfiltered pool when none
        // cleared the tier would silently reorder AWS's price-tie outcome
        // even though this rule reported "not applied." The eventual pick is
        // always the cheapest survivor (base-instance-selector takes
        // filtered[0], already price-sorted from parse time; every rule
        // above only filters, never reorders), so this only ever breaks an
        // EXACT price tie — checked live 2026-09-06: 97% of AWS types carry
        // both fields, but 55% show zero burst headroom (burst == baseline),
        // so a tie candidate with none loses nothing by this resort.
        if (provider === "aws") {
          const burstOf = (i) => {
            const v = Number(i.originalData?.burstBandwidthGbps);
            return Number.isFinite(v) && v > 0 ? v : 0;
          };
          filtered = [...filtered].sort(
            (a, b) => a.price - b.price || burstOf(b) - burstOf(a),
          );
        }
      }
    }

    // ── OS: Windows → exclude ARM/Graviton ─────────────────────────────────
    if (isWindowsOS(os)) {
      const before = filtered.length;
      filtered = filtered.filter((i) => !isARM(i));
      if (filtered.length < before)
        rules.push(withCount("OS: ARM excluded (Windows)", before));
    }

    // ── OS: macOS → AWS mac1/mac2 only ─────────────────────────────────────
    if (OS_MAC.includes(os) && provider === "aws") {
      const before = filtered.length;
      filtered = filtered.filter((i) =>
        (i.family || "").toLowerCase().startsWith("mac"),
      );
      rules.push(withCount("OS: mac1/mac2 only (macOS)", before));
    }

    // ── Min Generation filter ───────────────────────────────────────────────
    if (minGen) {
      const before = filtered.length;
      const genFiltered = filtered.filter((i) =>
        meetsMinGeneration(i, minGen, provider),
      );
      if (genFiltered.length > 0) {
        filtered = genFiltered;
        rules.push(withCount(`MinGen: ${minGen}+`, before));
      }
      // If filter empties the pool, keep current set and note it
    }

    // ── GPU: require an accelerator, or keep one out of the result ──────────
    // An accelerator is not a substitute for a general-purpose box of the same shape:
    // it costs far more and carries hardware the workload won't use. Neither branch
    // forces a no-match — if a filter would empty the pool, the pool stands. An
    // accelerator-required workload that finds none records "not applied"; the non-GPU
    // branch simply adds no rule entry when it changes nothing.
    if (ACCELERATOR_WORKLOADS.includes(workload)) {
      const before = filtered.length;
      const accel = filtered.filter((i) => isAccelerator(i, provider));
      if (accel.length > 0) {
        filtered = accel;
        rules.push(withCount("GPU: accelerator required", before));
      } else {
        rules.push("GPU: no accelerator available (not applied)");
      }
    } else {
      const before = filtered.length;
      const withoutAccel = filtered.filter((i) => !isAccelerator(i, provider));
      if (withoutAccel.length > 0 && withoutAccel.length < before) {
        filtered = withoutAccel;
        rules.push(
          withCount("GPU: accelerators excluded (non-GPU workload)", before),
        );
      }
    }

    // ── SQL: minimum core count for SQL Server licensing ────────────────────
    // A floor, not a target: removes only candidates below the licence minimum, so a
    // SQL box that needs 16 vCPUs still gets 16. Runs before the two preference sorts
    // so neither can reorder a candidate the floor should have removed. Degrades like
    // every filter — if nothing clears the floor, the pool stands and the row says so.
    if (SQL_WORKLOADS.includes(workload)) {
      // GCP never honours the toggle (no comparable field); AWS/Azure only do
      // once physicalCores() finds a real count, which the dormant pre-refresh
      // window means it may not. anyRealCores makes the label reflect what the
      // pool's evaluation actually used, not just what the toggle requested.
      const physicalRequested =
        !!options.sqlPhysicalCoreLicensing && provider !== "gcp";
      let anyRealCores = false;
      const meetsFloor = (i) => {
        const cores = physicalRequested ? physicalCores(i, provider) : null;
        if (cores !== null) anyRealCores = true;
        return (cores ?? i.vCpus) >= SQL_MIN_CORES;
      };
      const before = filtered.length;
      const licensed = filtered.filter(meetsFloor);
      const unit = physicalRequested && anyRealCores ? "physical-core" : "vCPU";
      if (licensed.length > 0) {
        filtered = licensed;
        if (filtered.length < before) {
          rules.push(
            withCount(`SQL: ${SQL_MIN_CORES}-${unit} licence floor`, before),
          );
        }
      } else {
        rules.push(
          `SQL: ${SQL_MIN_CORES}-${unit} licence floor not applied (no candidate that large)`,
        );
      }
    }

    // ── BP: Dev/Test at low utilization prefers burstable ───────────────────
    // The inverse of 1a. A Dev box that idles is what a burstable family is for, and
    // 1a keeps them out of Production/Staging, so the two never both fire on one row.
    // Placed BEFORE the workload preference (which runs last and wins), so an explicit
    // workload (a Dev database wanting memory-optimized) isn't overridden by this
    // nudge; a general/blank workload doesn't sort, the common Dev/Test case. "Low" is
    // the run's OWN downsize threshold, so this rule and the N/2 sizing agree on it.
    if (isDevTest) {
      const cpuUtil = Number(options.rowCpuUtil) || 0;
      const memUtil = Number(options.rowMemoryUtil) || 0;
      const cpuLow = Number(options.cpuDownsizeMax) || DEFAULT_LOW_UTILIZATION;
      const memLow =
        Number(options.memoryDownsizeMax) || DEFAULT_LOW_UTILIZATION;

      // Unknown utilization is not low utilization. Burstable is CPU-credit-limited,
      // so the CPU axis must be confirmed idle: an UNMEASURED CPU is "no evidence it
      // idles", not "low", and preferring burstable on it would hand a possibly-hot
      // box a credit-limited instance. So CPU must be measured AND low. Memory (not
      // throttled by burstable) may be unknown, but a KNOWN-high memory means the box
      // is working. (A low memory reading alone once fired this while CPU was
      // unmeasured — a review caught it.)
      const isLow =
        cpuUtil > 0 &&
        cpuUtil <= cpuLow &&
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
    // honouring the preference would force a hugely over-provisioned instance (see
    // WORKLOAD_MAX_*_FACTOR), so the size-based order stands and the row says why.
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
    // Exposed for base-instance-selector's bare-metal check, so it isn't a 4th hand-copy.
    isFlagTrue,
    isWindowsOS,
    hasNetworkTier,
    physicalCores,
    meetsMinGeneration,
    // Exposed for the alternative-strategy picks (base-instance-selector):
    isWorkloadFit,
    generationRank,
    // Recognised rule-value vocabularies, for the upload-time hygiene check:
    RECOGNIZED,
    // Exposed so a test can assert the three providers' workload vocabularies
    // move together — a key added to one and not the others would make
    // RECOGNIZED.workload (derived from aws alone) claim a value is
    // recognised while azure/gcp silently fall back to "general".
    WORKLOAD_FAMILIES,
  };
})();

window.RuleEngine = RuleEngine;
console.log("RuleEngine loaded — ENV/OS/Workload/Compliance rules ready");

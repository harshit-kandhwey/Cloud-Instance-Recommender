// Rule Engine - ENV, OS, and Workload rules applied before instance selection
//
// CSV input columns consumed here:
//   ENV        : Production | Staging | Dev | Test  (blank = no rules)
//   OS         : Linux | Windows | macOS             (blank = Linux)
//   Workload   : General | Database | Web Server | Cache | ML/AI | Batch | HPC  (blank = General)
//   Compliance : PCI | HIPAA | FIPS                  (blank = none)
//
// Rule reference:
//   1a  Burstable exclusion  — Production/Staging block t-family (AWS), B-series (Azure), f1/g1/e2-shared (GCP)
//   1b  Generation + Compliance — Production + Compliance: current-gen only; PCI/HIPAA (AWS): Nitro required
//   1c  Size floor — Production/Staging: no nano/micro (AWS), ≥2 vCPUs (Azure/GCP)
//   1d  Network preference — Production + DB/Web: prefer ≥4 vCPU instances (higher network bandwidth tier)
//   OS  Windows: exclude ARM/Graviton; macOS (AWS): mac1/mac2 families only
//   WL  Workload preference: sort results so workload-appropriate families appear first

const RuleEngine = (() => {
  const AWS_BURSTABLE_FAMILIES = ["t1", "t2", "t3", "t3a", "t4g"];
  const GCP_BURSTABLE_SERIES   = ["f1", "g1"];

  // Workload → preferred instance family prefixes per provider
  const WORKLOAD_FAMILIES = {
    aws: {
      general:      ["m"],
      database:     ["r", "x", "z"],
      "web server": ["m", "c"],
      web:          ["m", "c"],
      cache:        ["r", "x"],
      "ml/ai":      ["p", "g", "trn", "inf"],
      ml:           ["p", "g", "trn", "inf"],
      ai:           ["p", "g", "trn", "inf"],
      batch:        ["c", "m"],
      hpc:          ["hpc", "c"],
    },
    azure: {
      general:      ["d"],
      database:     ["e", "m"],
      "web server": ["d", "f"],
      web:          ["d", "f"],
      cache:        ["e", "m"],
      "ml/ai":      ["nc", "nd", "nv"],
      ml:           ["nc", "nd", "nv"],
      ai:           ["nc", "nd", "nv"],
      batch:        ["f", "d"],
      hpc:          ["hb", "hc"],
    },
    gcp: {
      general:      ["n2", "e2"],
      database:     ["m1", "m2", "m3", "m4"],
      "web server": ["n2", "e2", "n4"],
      web:          ["n2", "e2", "n4"],
      cache:        ["m1", "m2", "m3"],
      "ml/ai":      ["a2", "a3", "g2"],
      ml:           ["a2", "a3", "g2"],
      ai:           ["a2", "a3", "g2"],
      batch:        ["c2", "c2d", "c3", "c3d"],
      hpc:          ["h3", "c2"],
    },
  };

  // AWS instance type size rank — used for size floor (Rule 1c)
  const AWS_SIZE_RANK = { nano: 0, micro: 1, small: 2, medium: 3, large: 4 };

  function awsSizeRank(instanceType) {
    const size = (instanceType.split(".")[1] || "").toLowerCase();
    return size in AWS_SIZE_RANK ? AWS_SIZE_RANK[size] : 99;
  }

  function isBurstable(inst, provider) {
    const fam = (inst.family || "").toLowerCase();
    if (provider === "aws")   return AWS_BURSTABLE_FAMILIES.includes(fam);
    if (provider === "azure") return fam.startsWith("b"); // B-series: bsv2, bsv3, bpsv2, …
    if (provider === "gcp") {
      if (GCP_BURSTABLE_SERIES.includes(fam)) return true;
      // e2 shared-core (micro/small/medium): 2 vCPUs, ≤4 GiB
      if (fam === "e2" && inst.vCpus <= 2 && inst.memory <= 4) return true;
    }
    return false;
  }

  function isCurrentGen(inst) {
    const g = inst.generation;
    return g === 1 || g === 1.0 || g === "1" || g === "1.0";
  }

  function isARM(inst) {
    const g = inst.isGraviton;
    return g === 1 || g === 1.0 || g === "1" || g === "1.0";
  }

  function isNitroCapable(inst) {
    const raw = inst.originalData || {};
    const v = raw.nitroEnclavesSupport;
    return v === 1 || v === 1.0 || v === "1" || v === "1.0";
  }

  function getPreferredFamilies(workload, provider) {
    const wl = (workload || "general").toLowerCase().trim();
    return (WORKLOAD_FAMILIES[provider] || {})[wl]
      || (WORKLOAD_FAMILIES[provider] || {})["general"]
      || [];
  }

  // Sort preferred workload families first, cheapest within each tier
  function sortByWorkload(instances, workload, provider) {
    const preferred = getPreferredFamilies(workload, provider);
    if (!preferred.length) return instances;
    return [...instances].sort((a, b) => {
      const af = (a.family || "").toLowerCase();
      const bf = (b.family || "").toLowerCase();
      const as = preferred.some((f) => af.startsWith(f)) ? 0 : 1;
      const bs = preferred.some((f) => bf.startsWith(f)) ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.price - b.price;
    });
  }

  // ─── Main entry point ─────────────────────────────────────────────────────
  // options keys used:  rowEnv, rowOS, rowWorkload, rowCompliance
  // provider:           "aws" | "azure" | "gcp"
  // Returns:            { instances: [...], rules: [string, ...] }
  function apply(instances, options, provider) {
    const env        = (options.rowEnv        || "").toLowerCase().trim();
    const os         = (options.rowOS         || "linux").toLowerCase().trim();
    const workload   = (options.rowWorkload   || "general").toLowerCase().trim();
    const compliance = (options.rowCompliance || "").toLowerCase().trim();

    let filtered = [...instances];
    const rules  = [];

    const isProd       = env === "production" || env === "prod";
    const isStaging    = env === "staging"    || env === "stage";
    const isCompliance = compliance === "pci" || compliance === "hipaa" || compliance === "fips";

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
    if (isCompliance && provider === "aws") {
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
      } else if (isProd) {
        filtered = filtered.filter((i) => i.vCpus >= 2); // Azure/GCP: ≥ 2 vCPUs for Prod
      }
      if (filtered.length < before) rules.push("1c: Size floor applied");
    }

    // ── 1d: Network preference — Production + DB/Web ────────────────────────
    if (isProd && (workload === "database" || workload === "web server" || workload === "web")) {
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
      const mac = filtered.filter((i) => (i.family || "").toLowerCase().startsWith("mac"));
      if (mac.length > 0) filtered = mac;
      rules.push("OS: mac1/mac2 only (macOS)");
    }

    // ── Workload preference: sort preferred families first ──────────────────
    if (workload && workload !== "general") {
      const preferred = getPreferredFamilies(workload, provider);
      if (preferred.length) {
        filtered = sortByWorkload(filtered, workload, provider);
        rules.push(`Workload: ${workload} preference`);
      }
    }

    return { instances: filtered, rules };
  }

  return { apply, getPreferredFamilies, isBurstable, isCurrentGen, isARM };
})();

window.RuleEngine = RuleEngine;
console.log("RuleEngine loaded — ENV/OS/Workload/Compliance rules ready");

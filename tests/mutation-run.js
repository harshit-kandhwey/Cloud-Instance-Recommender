// Mutation oracle for the StrykerJS gate (depth gate D) — a SINGLE-process,
// dependency-light killer scoped to the two mutated files (js/base/rule-engine.js
// and js/base/instance-selector-factory.js).
//
// Why not just spawn the existing suites: Stryker's command runner reruns the
// whole command once per mutant, and the engine suites load code into a `vm`
// sandbox. Two problems that combo creates, both solved here:
//   1. PROPAGATION. Stryker's mutation switching reads the active mutant off
//      `globalThis` + `process.env.__STRYKER_ACTIVE_MUTANT__`; a bare vm sandbox
//      has no `process`, so every mutant silently ran the original code and
//      "survived" (a false ~0% score). buildEngineContext now exposes `process`
//      into the sandbox WHEN under Stryker (see harness.js), which fixes it for
//      this oracle and the property gate alike.
//   2. SPEED. Spawning ~19 nested node processes per mutant × 6 concurrent =
//      ~108 processes thrashing the cores → a 50-minute run. This oracle runs in
//      ONE process with no child spawns, so a mutant is scored in ~1s.
//
// It calls the two files' functions DIRECTLY with hand-built fixtures and asserts
// their specific behaviour (the property gate, required at the end, adds the
// invariant angle). Together they are the killer set; run-all.js stays the real
// full-suite gate. Every assertion here must match clean behaviour exactly — a
// wrong one fails Stryker's baseline dry run, not a mutant.
const path = require("path");
const { buildEngineContext, makeChecker } = require("./suites/harness");

const { check, state } = makeChecker();
const { ctx, run, load } = buildEngineContext({
  scripts: [
    "js/base/base-instance-selector.js",
    "js/base/rule-engine.js",
    "js/aws/aws-instance-selector.js",
    "js/azure/azure-instance-selector.js",
    "js/gcp/gcp-instance-selector.js",
    "js/base/instance-selector-factory.js",
  ],
  label: "mutation-oracle",
});

// Call any in-context function by path with JSON-marshalled args, so every object
// the engine touches is native to the vm realm (no cross-realm surprises). The
// raw return value is read back in this realm (primitives / arrays / Sets / plain
// objects all read fine by property + method access).
run(`
  __call = function (fnPath, argsJson) {
    var args = JSON.parse(argsJson);
    var fn = fnPath.split(".").reduce(function (o, k) { return o[k]; }, globalThis);
    return fn.apply(null, args);
  };
  true;
`);
const dispatch = run("__call");
const call = (fnPath, args = []) => dispatch(fnPath, JSON.stringify(args));

const eqArr = (a, b) =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

// A minimal instance fixture; overrides fill in what a given rule keys on.
const inst = (o) => ({
  instanceType: "m5.large",
  family: "m5",
  familyName: "General purpose",
  vCpus: 2,
  memory: 8,
  price: 0.1,
  generation: 1,
  isGraviton: 0,
  processor: "Intel",
  ...o,
});

const apply = (pool, opts, provider = "aws") =>
  call("RuleEngine.apply", [pool, opts, provider]);

// ─────────────────────────────────────────────────────────────────────────────
// rule-engine.js — RuleEngine.apply branches
// ─────────────────────────────────────────────────────────────────────────────

// 1a Burstable excluded in Production
{
  const r = apply(
    [inst({ instanceType: "t3.large", family: "t3" }), inst({})],
    { rowEnv: "production" },
  );
  check(
    "1a burstable excluded (prod): t3 removed",
    r.instances.every((i) => i.family !== "t3"),
    JSON.stringify(r.instances.map((i) => i.family)),
  );
  check(
    "1a burstable excluded (prod): rule reported",
    r.rules.some((s) => s.startsWith("1a: Burstable excluded")),
    r.rules.join(" | "),
  );
}

// 1b Previous generation excluded in Production
{
  const r = apply(
    [inst({}), inst({ instanceType: "m4.large", family: "m4", generation: 0 })],
    { rowEnv: "production" },
  );
  check(
    "1b prev-gen excluded (prod): gen0 removed",
    r.instances.every((i) => i.generation === 1),
    r.rules.join(" | "),
  );
  check(
    "1b prev-gen excluded (prod): rule reported",
    r.rules.some((s) => s.startsWith("1b: Prev-gen excluded")),
    r.rules.join(" | "),
  );
}

// 1c Size floor in Production (AWS: no nano/micro)
{
  const r = apply(
    [inst({ instanceType: "m5.nano" }), inst({ instanceType: "m5.large" })],
    { rowEnv: "production" },
  );
  check(
    "1c size floor (prod): nano removed",
    r.instances.every((i) => i.instanceType !== "m5.nano"),
    JSON.stringify(r.instances.map((i) => i.instanceType)),
  );
  check(
    "1c size floor (prod): rule reported",
    r.rules.some((s) => s.startsWith("1c: Size floor applied")),
    r.rules.join(" | "),
  );
}

// 1d Network-tier preference (Production + database → prefer ≥4 vCPU)
{
  const r = apply(
    [
      inst({ instanceType: "m5.large", vCpus: 2 }),
      inst({ instanceType: "m5.xlarge", vCpus: 4 }),
    ],
    { rowEnv: "production", rowWorkload: "database" },
  );
  check(
    "1d network tier: only ≥4 vCPU kept",
    r.instances.every((i) => i.vCpus >= 4),
    JSON.stringify(r.instances.map((i) => i.vCpus)),
  );
  check(
    "1d network tier: rule reported",
    r.rules.some((s) => s.startsWith("1d: Network-tier preference (≥4 vCPUs)")),
    r.rules.join(" | "),
  );
}

// OS Windows → exclude ARM/Graviton
{
  const r = apply(
    [
      inst({ instanceType: "m6g.large", family: "m6g", isGraviton: 1 }),
      inst({}),
    ],
    { rowOS: "windows" },
  );
  check(
    "OS windows: ARM removed",
    r.instances.every((i) => i.isGraviton !== 1),
    JSON.stringify(r.instances.map((i) => i.family)),
  );
  check(
    "OS windows: rule reported",
    r.rules.some((s) => s.startsWith("OS: ARM excluded (Windows)")),
    r.rules.join(" | "),
  );
}

// Min Generation filter (AWS numeric)
{
  const r = apply(
    [
      inst({ instanceType: "m5.large" }),
      inst({ instanceType: "m7i.large", family: "m7i" }),
    ],
    { rowMinGen: "6" },
  );
  check(
    "MinGen 6+ (aws): m5 removed, m7i kept",
    r.instances.length === 1 && r.instances[0].instanceType === "m7i.large",
    JSON.stringify(r.instances.map((i) => i.instanceType)),
  );
  check(
    "MinGen 6+ (aws): rule reported",
    r.rules.some((x) => x.startsWith("MinGen:")),
    r.rules.join(" | "),
  );
}

// GPU workload requires an accelerator; every other workload excludes one
{
  const pool = () => [
    inst({
      instanceType: "p3.2xlarge",
      family: "p3",
      familyName: "GPU instance",
    }),
    inst({}),
  ];
  const req = apply(pool(), { rowWorkload: "ml/ai" });
  check(
    "GPU workload: keeps only the accelerator",
    req.instances.length === 1 && req.instances[0].family === "p3",
    JSON.stringify(req.instances.map((i) => i.family)),
  );
  check(
    "GPU workload: rule reported",
    req.rules.some((s) => s.startsWith("GPU: accelerator required")),
    req.rules.join(" | "),
  );
  const non = apply(pool(), { rowWorkload: "general" });
  check(
    "non-GPU workload: accelerator excluded",
    non.instances.every((i) => i.family !== "p3"),
    JSON.stringify(non.instances.map((i) => i.family)),
  );
  check(
    "non-GPU workload: rule reported",
    non.rules.some((s) =>
      s.startsWith("GPU: accelerators excluded (non-GPU workload)"),
    ),
    non.rules.join(" | "),
  );
}

// SQL Server licence floor (≥4 vCPU)
{
  const r = apply(
    [
      inst({ instanceType: "m5.large", vCpus: 2 }),
      inst({ instanceType: "m5.xlarge", vCpus: 4 }),
      inst({ instanceType: "r5.large", family: "r5", vCpus: 2 }),
    ],
    { rowWorkload: "sql server" },
  );
  check(
    "SQL floor: sub-4-vCPU removed",
    r.instances.every((i) => i.vCpus >= 4),
    JSON.stringify(r.instances.map((i) => i.vCpus)),
  );
  check(
    "SQL floor: rule reported",
    r.rules.some(
      (x) => x.includes("licence floor") && !x.includes("not applied"),
    ),
    r.rules.join(" | "),
  );
}

// Burstable PREFERENCE for Dev/Test at low utilization (inverse of 1a)
{
  const r = apply(
    [
      inst({ instanceType: "m5.large", family: "m5", memory: 8 }),
      inst({ instanceType: "t3.large", family: "t3", memory: 8 }),
    ],
    {
      rowEnv: "dev",
      rowCpuUtil: 10,
      rowMemoryUtil: 10,
      reqCpu: 2,
      reqMemory: 4,
    },
  );
  check(
    "BP burstable preferred (dev, low util): t3 sorted first",
    r.instances[0].family === "t3",
    JSON.stringify(r.instances.map((i) => i.family)),
  );
  check(
    "BP burstable preferred: rule reported",
    r.rules.some((s) =>
      s.startsWith("BP: Burstable preferred (Dev/Test, low utilization)"),
    ),
    r.rules.join(" | "),
  );
}

// Workload preference sort (database → memory-optimized r-family first, close fit)
{
  const r = apply(
    [
      inst({ instanceType: "m5.xlarge", family: "m5", vCpus: 4, memory: 16 }),
      inst({ instanceType: "r5.xlarge", family: "r5", vCpus: 4, memory: 16 }),
    ],
    { rowWorkload: "database", reqCpu: 4, reqMemory: 16 },
  );
  check(
    "Workload preference: preferred family sorted first",
    r.instances[0].family === "r5",
    JSON.stringify(r.instances.map((i) => i.family)),
  );
  check(
    "Workload preference: rule reported",
    r.rules.some((s) => s.startsWith("Workload: database preference")),
    r.rules.join(" | "),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// rule-engine.js — exposed classifiers
// ─────────────────────────────────────────────────────────────────────────────

check(
  "getPreferredFamilies database/aws",
  eqArr(call("RuleEngine.getPreferredFamilies", ["database", "aws"]), [
    "r",
    "x",
    "z",
  ]),
);
check(
  "getPreferredFamilies general/azure",
  eqArr(call("RuleEngine.getPreferredFamilies", ["general", "azure"]), ["d"]),
);
check(
  "getPreferredFamilies hpc/gcp",
  eqArr(call("RuleEngine.getPreferredFamilies", ["hpc", "gcp"]), ["h3", "c2"]),
);

// Full workload→family map, mirrored from rule-engine's WORKLOAD_FAMILIES so a
// mutated family list (a dropped or emptied preference string) is caught for
// EVERY workload/provider pair, not just the three spot-checks above.
{
  const EXPECTED = {
    aws: {
      general: ["m"],
      database: ["r", "x", "z"],
      "sql server": ["r", "x", "z"],
      "web server": ["m", "c"],
      cache: ["r", "x"],
      "ml/ai": ["p", "g", "trn", "inf"],
      batch: ["c", "m"],
      hpc: ["hpc", "c"],
      sap: ["x1", "x2", "r", "u-"],
    },
    azure: {
      general: ["d"],
      database: ["e", "m"],
      "sql server": ["e", "m"],
      "web server": ["d", "f"],
      cache: ["e", "m"],
      "ml/ai": ["nc", "nd", "nv"],
      batch: ["f", "d"],
      hpc: ["hb", "hc"],
      sap: ["mv2", "msv2", "m"],
    },
    gcp: {
      general: ["n2", "e2"],
      database: ["m1", "m2", "m3", "m4"],
      "sql server": ["m1", "m2", "m3", "m4"],
      "web server": ["n2", "e2", "n4"],
      cache: ["m1", "m2", "m3"],
      "ml/ai": ["a2", "a3", "g2"],
      batch: ["c2", "c2d", "c3", "c3d"],
      hpc: ["h3", "c2"],
      sap: ["m1", "m2", "m3", "m4"],
    },
  };
  for (const provider of Object.keys(EXPECTED)) {
    for (const workload of Object.keys(EXPECTED[provider])) {
      check(
        `getPreferredFamilies ${workload}/${provider}`,
        eqArr(
          call("RuleEngine.getPreferredFamilies", [workload, provider]),
          EXPECTED[provider][workload],
        ),
        JSON.stringify(
          call("RuleEngine.getPreferredFamilies", [workload, provider]),
        ),
      );
    }
  }
}

check(
  "isBurstable aws t3",
  call("RuleEngine.isBurstable", [{ family: "t3" }, "aws"]) === true,
);
check(
  "isBurstable aws m5 (no)",
  call("RuleEngine.isBurstable", [{ family: "m5" }, "aws"]) === false,
);
check(
  "isBurstable azure b-series",
  call("RuleEngine.isBurstable", [{ family: "bsv2" }, "azure"]) === true,
);
check(
  "isBurstable gcp e2-micro",
  call("RuleEngine.isBurstable", [
    { family: "e2", instanceType: "e2-micro" },
    "gcp",
  ]) === true,
);
check(
  "isBurstable gcp e2-standard (no)",
  call("RuleEngine.isBurstable", [
    { family: "e2", instanceType: "e2-standard-4" },
    "gcp",
  ]) === false,
);

check(
  "isCurrentGen 1",
  call("RuleEngine.isCurrentGen", [{ generation: 1 }]) === true,
);
check(
  'isCurrentGen "1.0"',
  call("RuleEngine.isCurrentGen", [{ generation: "1.0" }]) === true,
);
check(
  "isCurrentGen 0 (no)",
  call("RuleEngine.isCurrentGen", [{ generation: 0 }]) === false,
);

check(
  "isARM graviton flag",
  call("RuleEngine.isARM", [{ isGraviton: 1 }]) === true,
);
check(
  "isARM graviton processor",
  call("RuleEngine.isARM", [{ processor: "AWS Graviton3" }]) === true,
);
check(
  "isARM t2a family",
  call("RuleEngine.isARM", [{ family: "t2a" }]) === true,
);
check(
  "isARM intel (no)",
  call("RuleEngine.isARM", [
    { family: "m5", processor: "Intel", isGraviton: 0 },
  ]) === false,
);

check(
  "isAccelerator familyName GPU",
  call("RuleEngine.isAccelerator", [{ familyName: "GPU instance" }, "aws"]) ===
    true,
);
check(
  "isAccelerator general (no)",
  call("RuleEngine.isAccelerator", [
    { familyName: "General purpose" },
    "aws",
  ]) === false,
);
check(
  "isAccelerator aws prefix fallback (p3)",
  call("RuleEngine.isAccelerator", [
    { family: "p3", familyName: "" },
    "aws",
  ]) === true,
);
check(
  "isAccelerator azure prefix fallback (nc)",
  call("RuleEngine.isAccelerator", [
    { family: "nc6", familyName: "" },
    "azure",
  ]) === true,
);

check(
  "meetsMinGeneration aws m5 < 6 (no)",
  call("RuleEngine.meetsMinGeneration", [
    { instanceType: "m5.large" },
    "6",
    "aws",
  ]) === false,
);
check(
  "meetsMinGeneration aws m7i ≥ 6",
  call("RuleEngine.meetsMinGeneration", [
    { instanceType: "m7i.large" },
    "6",
    "aws",
  ]) === true,
);
check(
  "meetsMinGeneration azure dsv5 ≥ 5",
  call("RuleEngine.meetsMinGeneration", [{ family: "dsv5" }, "5", "azure"]) ===
    true,
);
check(
  "meetsMinGeneration azure dsv3 < 5 (no)",
  call("RuleEngine.meetsMinGeneration", [{ family: "dsv3" }, "5", "azure"]) ===
    false,
);
check(
  "meetsMinGeneration gcp n4 ≥ n2",
  call("RuleEngine.meetsMinGeneration", [{ family: "n4" }, "n2", "gcp"]) ===
    true,
);
check(
  "meetsMinGeneration gcp e2 < n2 (no)",
  call("RuleEngine.meetsMinGeneration", [{ family: "e2" }, "n2", "gcp"]) ===
    false,
);

check(
  "isWorkloadFit within bounds",
  call("RuleEngine.isWorkloadFit", [{ vCpus: 4, memory: 16 }, 2, 4]) === true,
);
check(
  "isWorkloadFit over vCPU bound (no)",
  call("RuleEngine.isWorkloadFit", [{ vCpus: 8, memory: 16 }, 2, 4]) === false,
);

check(
  "generationRank aws m7i = 7",
  call("RuleEngine.generationRank", [{ instanceType: "m7i.large" }, "aws"]) ===
    7,
);
check(
  "generationRank aws m5 = 5",
  call("RuleEngine.generationRank", [{ instanceType: "m5.large" }, "aws"]) ===
    5,
);
check(
  "generationRank azure dsv5 = 5",
  call("RuleEngine.generationRank", [{ family: "dsv5" }, "azure"]) === 5,
);
check(
  "generationRank azure no-version = 2",
  call("RuleEngine.generationRank", [{ family: "nv" }, "azure"]) === 2,
);
check(
  "generationRank gcp n4 = 4",
  call("RuleEngine.generationRank", [{ family: "n4" }, "gcp"]) === 4,
);
check(
  "generationRank gcp e2 = 1",
  call("RuleEngine.generationRank", [{ family: "e2" }, "gcp"]) === 1,
);

// ─────────────────────────────────────────────────────────────────────────────
// instance-selector-factory.js — statics + helpers
// ─────────────────────────────────────────────────────────────────────────────

check(
  "factory region column aws",
  call("InstanceSelectorFactory.getProviderRegionColumn", ["aws"]) ===
    "AWS Region",
);
check(
  "factory region column gcp",
  call("InstanceSelectorFactory.getProviderRegionColumn", ["gcp"]) ===
    "GCP Region",
);
check(
  "factory min-gen column aws",
  call("InstanceSelectorFactory.getProviderMinGenColumn", ["aws"]) ===
    "AWS Min Gen",
);
check(
  "factory min-gen option azure",
  call("InstanceSelectorFactory.getProviderMinGenOption", ["azure"]) ===
    "ruleDefaultMinGenAzure",
);
check(
  "factory default region aws",
  call("InstanceSelectorFactory.getProviderDefaultRegion", ["aws"]) ===
    "us-east-1",
);
check(
  "factory default region gcp",
  call("InstanceSelectorFactory.getProviderDefaultRegion", ["gcp"]) ===
    "us-central1-a",
);
check(
  "factory supported providers",
  eqArr(call("InstanceSelectorFactory.getSupportedProviders", []), [
    "aws",
    "azure",
    "gcp",
  ]),
);
check(
  "factory createSelector aws → AWS",
  run(`InstanceSelectorFactory.createSelector("aws").getProviderName()`) ===
    "AWS",
);
check(
  "factory createSelector bad → throws",
  (() => {
    try {
      run(`InstanceSelectorFactory.createSelector("nope")`);
      return false;
    } catch {
      return true;
    }
  })(),
);

check(
  "formatNearestMiss with relax list",
  call("formatNearestMiss", [
    {
      instanceType: "m7i.large",
      vCpus: 2,
      memory: 8,
      blockedBy: ["current-generation only"],
    },
  ]) === "m7i.large (2 vCPU / 8 GB) — relax: current-generation only",
);
check(
  "formatNearestMiss without relax list",
  call("formatNearestMiss", [
    { instanceType: "m7i.large", vCpus: 2, memory: 8, blockedBy: [] },
  ]) === "m7i.large (2 vCPU / 8 GB)",
);
check(
  "formatNearestMiss null → empty",
  call("formatNearestMiss", [null]) === "",
);

check(
  "formatAlternative object",
  call("formatAlternative", [
    { instanceType: "m5.large", vCpus: 2, memory: 8 },
  ]) === "m5.large (2/8)",
);
check(
  "formatAlternative null → empty",
  call("formatAlternative", [null]) === "",
);

// resolveUtilization — fallback chains, independent axes
{
  const u = call("resolveUtilization", [
    { "CPU Utilization p95": 50, "Memory Utilization p95": 60 },
    "avg",
  ]);
  check(
    "resolveUtilization falls back avg→p95 (cpu)",
    u.cpu === 50 && u.cpuStatistic === "p95" && u.cpuFellBack === true,
    JSON.stringify(u),
  );
  const u2 = call("resolveUtilization", [
    { "CPU Utilization": 30, "Memory Utilization p95": 60 },
    "avg",
  ]);
  check(
    "resolveUtilization independent axes (cpu avg, mem p95)",
    u2.cpuStatistic === "avg" &&
      u2.cpuFellBack === false &&
      u2.memoryStatistic === "p95" &&
      u2.memoryFellBack === true,
    JSON.stringify(u2),
  );
  const u3 = call("resolveUtilization", [{}, "avg"]);
  check(
    "resolveUtilization absent columns → 0",
    u3.cpu === 0 && u3.memory === 0,
    JSON.stringify(u3),
  );
}

// describeSizedOn — same-stat label, fallback tag, divergent axes, empty
check(
  "describeSizedOn same stat → single label",
  call("describeSizedOn", [
    {
      cpu: 50,
      memory: 60,
      cpuStatistic: "p95",
      memoryStatistic: "p95",
      cpuFellBack: false,
      memoryFellBack: false,
    },
  ]) === "p95",
);
check(
  "describeSizedOn same stat + fallback",
  call("describeSizedOn", [
    {
      cpu: 50,
      memory: 60,
      cpuStatistic: "p95",
      memoryStatistic: "p95",
      cpuFellBack: true,
      memoryFellBack: true,
    },
  ]) === "p95 (fallback)",
);
check(
  "describeSizedOn divergent axes",
  call("describeSizedOn", [
    {
      cpu: 30,
      memory: 60,
      cpuStatistic: "avg",
      memoryStatistic: "p95",
      cpuFellBack: false,
      memoryFellBack: true,
    },
  ]) === "CPU: Average, Mem: p95 (fallback)",
);
check(
  "describeSizedOn empty",
  call("describeSizedOn", [{ cpu: 0, memory: 0 }]) === "",
);

// normalizeFamilyClass — accelerator folding, passthrough, empty
check(
  'normalizeFamilyClass "GPU instance" → Accelerator',
  call("normalizeFamilyClass", ["GPU instance"]) === "Accelerator",
);
check(
  'normalizeFamilyClass "Accelerator optimized" → Accelerator',
  call("normalizeFamilyClass", ["Accelerator optimized"]) === "Accelerator",
);
check(
  'normalizeFamilyClass "General purpose" passthrough',
  call("normalizeFamilyClass", ["General purpose"]) === "General purpose",
);
check("normalizeFamilyClass empty", call("normalizeFamilyClass", [""]) === "");

// describeFamilyEquivalence — agree / differ / empty
check(
  "describeFamilyEquivalence agree",
  call("describeFamilyEquivalence", [
    {
      "AWS Like-to-Like Family": "General purpose",
      "AZURE Like-to-Like Family": "General purpose",
    },
    ["aws", "azure"],
  ]) === "General purpose on AWS, AZURE",
);
check(
  "describeFamilyEquivalence differ",
  call("describeFamilyEquivalence", [
    {
      "AWS Like-to-Like Family": "General purpose",
      "GCP Like-to-Like Family": "Memory optimized",
    },
    ["aws", "gcp"],
  ]) === "Differs — AWS General purpose, GCP Memory optimized",
);
check(
  "describeFamilyEquivalence none usable → empty",
  call("describeFamilyEquivalence", [
    { "AWS Like-to-Like Family": "N/A" },
    ["aws"],
  ]) === "",
);

// resolveRowWorkload — precedence row → appMap → default → General
check(
  "resolveRowWorkload row wins",
  call("resolveRowWorkload", [{ Workload: "Database" }, {}]) === "Database",
);
check(
  "resolveRowWorkload appMap",
  call("resolveRowWorkload", [
    { "App Name": "myapp" },
    { appWorkloadMap: { myapp: "Cache" } },
  ]) === "Cache",
);
check(
  "resolveRowWorkload page default",
  call("resolveRowWorkload", [{}, { ruleDefaultWorkload: "Batch" }]) ===
    "Batch",
);
check(
  "resolveRowWorkload builtin General",
  call("resolveRowWorkload", [{}, {}]) === "General",
);

// safeMapGet — own-property guard
check("safeMapGet own key", call("safeMapGet", [{ a: "x" }, "a"]) === "x");
check(
  "safeMapGet inherited key → empty",
  call("safeMapGet", [{}, "toString"]) === "",
);
check("safeMapGet null map → empty", call("safeMapGet", [null, "a"]) === "");

// extractUniqueRegions — dedupe + default fallback
{
  const s = call("extractUniqueRegions", [
    [
      { "AWS Region": "us-east-1" },
      { "AWS Region": "us-east-1" },
      { "AWS Region": "eu-west-1" },
    ],
    "AWS Region",
    "aws",
  ]);
  check(
    "extractUniqueRegions dedupes",
    s.size === 2 && s.has("us-east-1") && s.has("eu-west-1"),
  );
  const d = call("extractUniqueRegions", [[], "AWS Region", "aws"]);
  check(
    "extractUniqueRegions empty → default region",
    d.size === 1 && d.has("us-east-1"),
  );
}

// Void the unused import lint (path kept for parity with sibling runners).
void path;

// ─────────────────────────────────────────────────────────────────────────────
// instance-selector-factory.js — the full recommendation loop
// getInstanceRecommendationWithSelector is half the file and the direct-helper
// checks above never enter it, so its ~340 mutants all survived a helper-only
// oracle. Drive it end to end here against real region data. Assertions are
// deliberately STABLE (a real instance was chosen, it meets the request, the
// no-match branch fires, the multi-cloud family column is written) rather than
// pinning exact instance names — the goldens already lock exact output.
// ─────────────────────────────────────────────────────────────────────────────
for (const rel of [
  "js/aws/regions/us_east_1.js",
  "js/azure/regions/eastus.js",
  "js/gcp/regions/us_central1.js",
]) {
  load(rel);
}

const REC_OPTIONS = {
  generateLikeToLike: true,
  generateOptimized: true,
  cpuBased: true,
  memoryBased: true,
  cpuDownsizeMax: 40,
  cpuUpsizeMin: 80,
  memoryDownsizeMax: 40,
  memoryUpsizeMin: 80,
  utilizationStatistic: "avg",
  excludeTypes: [],
};

const REC_CSV = [
  {
    "VM Name": "vm1",
    "CPU Count": "4",
    "Memory (GB)": "16",
    "CPU Utilization": "20",
    "Memory Utilization": "30",
    "AWS Region": "us-east-1",
    "Azure Region": "East US",
    "GCP Region": "us-central1",
    Workload: "General",
  },
  {
    // Missing AWS region → the no-match branch.
    "VM Name": "vm2",
    "CPU Count": "2",
    "Memory (GB)": "8",
    "AWS Region": "",
    "Azure Region": "East US",
    "GCP Region": "us-central1",
  },
  {
    // Over-provisioned on GCP: 2 vCPU / 5 GB, whose cheapest standard fit
    // (e2-standard-2, 2/8) carries more memory than needed — exercises the GCP
    // Custom Fit suggestion branch, which offers the tighter e2-custom-2-5120.
    "VM Name": "vm3",
    "CPU Count": "2",
    "Memory (GB)": "5",
    "GCP Region": "us-central1",
    Workload: "General",
  },
];

const realInstance = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  ![
    "Missing data",
    "No data available",
    "Error",
    "No utilization data",
  ].includes(v);

(async () => {
  ctx.__recCsv = REC_CSV;
  ctx.__recProviders = ["aws", "azure", "gcp"];
  ctx.__recOpts = REC_OPTIONS;
  const results = await run(
    "getInstanceRecommendationWithSelector(__recCsv, __recProviders, __recOpts)",
  );

  check(
    "rec: one result row per input row",
    results.length === 3,
    String(results.length),
  );

  const r0 = results[0];
  check(
    "rec: AWS like-to-like is a real instance",
    realInstance(r0["AWS Like-to-Like Instance"]),
    r0["AWS Like-to-Like Instance"],
  );
  // r0 requests 4 vCPU / 16 GiB. Like-to-like must MEET that on every provider
  // (the soundness invariant), so assert both axes for all three — not just AWS
  // vCPU. A mutant that under-sizes memory, or Azure/GCP, would otherwise survive
  // because the bare realInstance check only proves a name is present. (Optimized
  // is intentionally not asserted against the raw request: it sizes to
  // utilization — here 20%/30% — so a correct optimized pick can be smaller.)
  check(
    "rec: AWS like-to-like meets requested vCPU (≥4)",
    Number(r0["AWS Like-to-Like vCPUs"]) >= 4,
    String(r0["AWS Like-to-Like vCPUs"]),
  );
  check(
    "rec: AWS like-to-like meets requested memory (≥16 GiB)",
    Number(r0["AWS Like-to-Like Memory (GiB)"]) >= 16,
    String(r0["AWS Like-to-Like Memory (GiB)"]),
  );
  check(
    "rec: Azure like-to-like is a real instance",
    realInstance(r0["AZURE Like-to-Like Instance"]),
    r0["AZURE Like-to-Like Instance"],
  );
  check(
    "rec: Azure like-to-like meets requested vCPU (≥4) and memory (≥16 GiB)",
    Number(r0["AZURE Like-to-Like vCPUs"]) >= 4 &&
      Number(r0["AZURE Like-to-Like Memory (GiB)"]) >= 16,
    `${r0["AZURE Like-to-Like vCPUs"]} vCPU / ${r0["AZURE Like-to-Like Memory (GiB)"]} GiB`,
  );
  check(
    "rec: GCP like-to-like is a real instance",
    realInstance(r0["GCP Like-to-Like Instance"]),
    r0["GCP Like-to-Like Instance"],
  );
  check(
    "rec: GCP like-to-like meets requested vCPU (≥4) and memory (≥16 GiB)",
    Number(r0["GCP Like-to-Like vCPUs"]) >= 4 &&
      Number(r0["GCP Like-to-Like Memory (GiB)"]) >= 16,
    `${r0["GCP Like-to-Like vCPUs"]} vCPU / ${r0["GCP Like-to-Like Memory (GiB)"]} GiB`,
  );
  check(
    "rec: optimized instance produced when utilization present",
    realInstance(r0["AWS Optimized Instance"]),
    r0["AWS Optimized Instance"],
  );
  check(
    'rec: "Sized On" recorded for an optimized row',
    typeof r0["Sized On"] === "string" && r0["Sized On"].length > 0,
    r0["Sized On"],
  );
  check(
    "rec: multi-cloud Family Equivalence column written",
    typeof r0["Family Equivalence"] === "string" &&
      r0["Family Equivalence"].length > 0,
    r0["Family Equivalence"],
  );
  check(
    "rec: alternative-strategy column present (Most Cost Optimized)",
    typeof r0["AWS Most Cost Optimized"] === "string" &&
      r0["AWS Most Cost Optimized"].length > 0,
    r0["AWS Most Cost Optimized"],
  );

  const r1 = results[1];
  check(
    "rec: missing-region row reports a no-match reason naming the region",
    /region/i.test(r1["AWS No Match Reason"] || ""),
    r1["AWS No Match Reason"],
  );
  check(
    'rec: missing-region row marks the instance "Missing data"',
    r1["AWS Like-to-Like Instance"] === "Missing data",
    r1["AWS Like-to-Like Instance"],
  );

  // GCP Custom Fit: the over-provisioned GCP row (vm3) gets a tighter custom shape;
  // the exact-fit row (vm1, 4 vCPU / 16 GB) gets none. These pin the factory's GCP
  // suggestion branch — a mutant that drops it, mis-scopes the provider check, or
  // swaps the requirement arguments changes one of these.
  const r2 = results[2];
  check(
    "rec: an over-provisioned GCP row gets a custom-fit suggestion",
    r2["GCP Custom Fit"] === "e2-custom-2-5120",
    r2["GCP Custom Fit"],
  );
  check(
    "rec: an exact-fit GCP row gets no custom-fit suggestion",
    r0["GCP Custom Fit"] === "",
    r0["GCP Custom Fit"],
  );

  const oracleFailed = state.failures > 0;
  if (oracleFailed) {
    console.error(`\nmutation-oracle: ${state.failures} check(s) FAILED`);
  }

  // Add the property gate's invariant kills. It sets process.exitCode itself;
  // fold its result in so a mutant either side detects counts as killed.
  require("./property/engine-invariants.property.js");
  // Any nonzero code means the property gate failed — not just the literal 1.
  // (The module runs its fc.assert synchronously and sets process.exitCode at
  // top level, so it is already set by the time require() returns.)
  const propertyFailed = Number(process.exitCode || 0) !== 0;

  process.exitCode = oracleFailed || propertyFailed ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

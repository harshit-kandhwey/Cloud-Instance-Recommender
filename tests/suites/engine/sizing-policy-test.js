// Sizing policy (3.21 phase 7, E6): which statistic a row sizes on, from its ENV,
// Criticality and Workload, with ENV as the dominant, capping axis. Nothing is wired
// into a run yet, so this suite pins the schema, the validation, the resolver and
// the per-page storage on their own.
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx, storage } = buildContext();
const run = (expr) => vm.runInContext(expr, ctx);
const resolve = (row, policy) => {
  ctx.__row = row;
  ctx.__policy = policy;
  return run("resolvePolicyStatistic(__row, __policy)");
};
const normalize = (raw) => {
  ctx.__raw = raw;
  return run("normalizeSizingPolicy(__raw)");
};

console.log("[the shipped defaults, ENV x Criticality x Workload]");
const pick = (env, criticality, workload) =>
  resolve({ env, criticality, workload }).cpu;
check(
  "Production + Critical sizes on p99, High on p95, Low on p90",
  pick("Production", "Critical") === "p99" &&
    pick("Production", "High") === "p95" &&
    pick("Production", "Low") === "p90",
);
check(
  "Dev, Test and QA size on the average whatever the criticality",
  ["Dev", "Test", "QA"].every(
    (e) => pick(e, "Critical") === "avg" && pick(e, "Low") === "avg",
  ),
);
check(
  "a Production database takes p95; a Dev database stays capped at the average",
  pick("Production", "Low", "Database") === "p95" &&
    pick("Dev", "Low", "Database") === "avg",
);
check(
  "Batch pulls toward Peak, and Production's ceiling lets it through",
  pick("Production", "Low", "Batch") === "peak",
);
check(
  "Staging is capped at p95 even for a Critical Batch VM",
  pick("Staging", "Critical", "Batch") === "p95",
);
check(
  "the ENV aliases map to their class: prod, stage, qa",
  pick("prod", "Critical") === "p99" &&
    pick("stage", "Critical") === "p95" &&
    pick("qa", "Critical") === "avg",
);

console.log("[CPU and memory carry different defaults]");
check(
  "memory is held at p95 or below while CPU goes to p99 or Peak",
  (() => {
    const r = resolve({
      env: "Production",
      criticality: "Critical",
      workload: "Batch",
    });
    return r.cpu === "peak" && r.memory === "p95";
  })(),
);
check(
  "memory never exceeds the CPU statistic",
  resolve({ env: "Dev", criticality: "Critical" }).memory === "avg",
);

console.log("[when unsure, size on the higher figure]");
{
  const r = resolve({ env: "", criticality: "Critical" });
  check(
    "a blank ENV is capped like Production, and the reason says so",
    r.cpu === "p99" && r.reason.includes("ENV not recognised"),
    r.reason,
  );
  const typo = resolve({ env: "Prd", criticality: "Critical" });
  check(
    "an unrecognised ENV is not silently treated as Dev",
    typo.cpu === "p99",
    typo.reason,
  );
  const blankCrit = resolve({ env: "Production", criticality: "" });
  check(
    "a blank Criticality counts as medium, and the reason says so",
    blankCrit.cpu === "p90" && blankCrit.reason.includes("treated as medium"),
    blankCrit.reason,
  );
  check(
    "the reason names the cap when ENV lowered the statistic",
    /capped by dev to avg/.test(
      resolve({ env: "Dev", criticality: "Critical" }).reason,
    ),
    resolve({ env: "Dev", criticality: "Critical" }).reason,
  );
}

console.log("[a changed policy changes the answer]");
{
  const custom = normalize({
    v: 1,
    criticality: { critical: "p99", high: "p95", medium: "p95", low: "avg" },
    envCeiling: { production: "p99", staging: "p95", dev: "p90" },
    memoryCeiling: "p99",
  }).policy;
  const at = (row) => resolve(row, custom);
  check(
    "a blank Criticality uses the policy's own medium, not a hard-coded one",
    at({ env: "Production", criticality: "" }).cpu === "p95",
    at({ env: "Production", criticality: "" }).reason,
  );
  check(
    "the ceilings come from the policy: Production now stops at p99, Dev at p90",
    at({ env: "Production", criticality: "Critical", workload: "Batch" })
      .cpu === "p99" &&
      at({ env: "Dev", criticality: "Critical" }).cpu === "p90",
  );
  check(
    "the memory ceiling comes from the policy too",
    at({ env: "Production", criticality: "Critical" }).memory === "p99",
  );
}
console.log("[validation never reinterprets a bad cell]");
{
  check(
    "a non-object, an array and null all become the default",
    [null, undefined, [], "x", 5].every((raw) => {
      const r = normalize(raw);
      return r.policy.criticality.critical === "p99" && r.policy.v === 1;
    }),
  );
  const wrongVersion = normalize({ v: 2, criticality: { critical: "avg" } });
  check(
    "another version is dropped for the default, with a problem named",
    wrongVersion.policy.criticality.critical === "p99" &&
      wrongVersion.problems.length === 1,
    JSON.stringify(wrongVersion),
  );
  const bad = normalize({
    v: 1,
    criticality: { critical: "p97", bogus: "p95", high: "avg" },
    envCeiling: { production: "peak", moon: "avg" },
    memoryCeiling: "nope",
  });
  check(
    "a bad statistic keeps that cell's default; a good cell in the same map is kept",
    bad.policy.criticality.critical === "p99" &&
      bad.policy.criticality.high === "avg",
    JSON.stringify(bad.policy.criticality),
  );
  check(
    "an unknown key is not stored and is named",
    !("bogus" in bad.policy.criticality) &&
      bad.problems.some((p) => p.includes('"bogus"')) &&
      bad.problems.some((p) => p.includes('"moon"')),
    JSON.stringify(bad.problems),
  );
  check(
    "a bad memory ceiling keeps the default and is named",
    bad.policy.memoryCeiling === "p95" &&
      bad.problems.some((p) => p.includes("memoryCeiling")),
  );
  const proto = normalize(
    JSON.parse('{"v":1,"criticality":{"__proto__":"avg","constructor":"avg"}}'),
  );
  check(
    "__proto__ and constructor are not recognised keys and change nothing",
    proto.problems.length >= 1 &&
      Object.keys(proto.policy.criticality).join() ===
        "critical,high,medium,low" &&
      proto.policy.criticality.critical === "p99",
    JSON.stringify(proto.problems),
  );
  check(
    "a vocabulary the engine does not know cannot enter a policy",
    normalize({ v: 1, workload: { "made up": "peak" } }).problems.length === 1,
  );
}

console.log("[the defaults are not shared or mutable]");
{
  const a = normalize(null).policy;
  a.criticality.critical = "avg";
  check(
    "changing a returned policy does not change the defaults",
    normalize(null).policy.criticality.critical === "p99" &&
      run("DEFAULT_SIZING_POLICY.criticality.critical") === "p99",
  );
  check(
    "the default policy is frozen",
    run("Object.isFrozen(DEFAULT_SIZING_POLICY)") &&
      run("Object.isFrozen(DEFAULT_SIZING_POLICY.criticality)"),
  );
}

console.log("[storage: per page, versioned, tamper-safe]");
{
  check(
    "nothing stored loads as the default",
    run("loadSizingPolicy()").criticality.high === "p95",
  );
  const saved = run("saveSizingPolicy({ v: 1, criticality: { high: 'avg' } })");
  check("a valid policy saves", saved.ok === true, JSON.stringify(saved));
  check(
    "and loads back with its change and the rest defaulted",
    run("loadSizingPolicy().criticality.high") === "avg" &&
      run("loadSizingPolicy().criticality.critical") === "p99",
  );
  const stored = JSON.parse(storage["cloudInstanceRecommenderSizingPolicies"]);
  check(
    "it is stored under the registry key, keyed by page",
    Object.keys(stored).length === 1 && stored[Object.keys(stored)[0]].v === 1,
    JSON.stringify(stored),
  );
  const refused = run("saveSizingPolicy({ v: 1, memoryCeiling: 'zzz' })");
  check(
    "an invalid policy is refused, with what to fix, and nothing is written",
    refused.ok === false &&
      refused.reason === "invalid" &&
      refused.problems.length === 1 &&
      run("loadSizingPolicy().memoryCeiling") === "p95",
    JSON.stringify(refused),
  );
  storage["cloudInstanceRecommenderSizingPolicies"] = "{not json";
  check(
    "a corrupted store loads as the default instead of throwing",
    run("loadSizingPolicy().criticality.critical") === "p99",
  );
  const page = run("sizingPolicyPageKey()");
  storage["cloudInstanceRecommenderSizingPolicies"] = JSON.stringify({
    [page]: { v: 99, criticality: { critical: "avg" } },
  });
  check(
    "an entry from another version is dropped, not replayed",
    run("loadSizingPolicy().criticality.critical") === "p99",
  );
}

process.exitCode = state.failures ? 1 : 0;

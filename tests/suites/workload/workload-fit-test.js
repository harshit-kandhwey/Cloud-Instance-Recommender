// Workload preference must never defeat size fit (rule-engine.js).
//
// The bug this pins: the workload preference re-sorted the preferred families to
// the FRONT with no size bound, so a tiny workload landed on a huge instance —
// on GCP a 2 vCPU / 4 GB Cache VM got m3-ultramem-32 (32 vCPU / 976 GiB),
// because GCP's memory-optimized m-series has no small member. The fix bounds a
// preferred pick to <=2x vCPU and <=4x memory of the requirement; past that the
// preference is dropped and the cheapest-adequate pick stands.
const { buildEngineContext } = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: ["js/base/rule-engine.js"],
  label: "workload-fit",
});

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
};

// The top candidate, safely. A regression that returns no instances must let the
// checks below report a named failure ("picked undefined") rather than crash on
// `res.instances[0].instanceType` — including in the eagerly-built detail string.
const top = (res) => (res && res.instances && res.instances[0]) || {};

// A GCP Cache VM (2 vCPU / 4 GB): a right-sized general instance and the huge
// memory-optimized one that "fits" only because it exceeds the requirement on
// every axis. The general one is listed first (cheapest), as the real pipeline
// hands it over price-sorted.
ctx.gcpCache = [
  {
    instanceType: "e2-standard-2",
    family: "e2",
    familyName: "General purpose",
    vCpus: 2,
    memory: 8,
    price: 0.06,
  },
  {
    instanceType: "m3-ultramem-32",
    family: "m3",
    familyName: "Memory optimized",
    vCpus: 32,
    memory: 976,
    price: 5.0,
  },
];

console.log(
  "[a tiny workload is never over-provisioned to honour a preference]",
);
{
  const res = run(
    "RuleEngine.apply(gcpCache, { rowWorkload: 'cache', reqCpu: 2, reqMemory: 4 }, 'gcp')",
  );
  check(
    "the cheapest-adequate instance is chosen, NOT the huge preferred one",
    top(res).instanceType === "e2-standard-2",
    `picked ${top(res).instanceType} (${top(res).vCpus}/${top(res).memory})`,
  );
  check(
    "the huge memory-optimized instance did not jump to the front",
    top(res).instanceType !== "m3-ultramem-32",
  );
  check(
    "the row explains the preference was not applied",
    res.rules.some((r) => /cache preference not applied/i.test(r)),
    JSON.stringify(res.rules),
  );
}

// A GCP Database VM (8/32): the memory-optimized m4-hypermem-16 (16/248) is
// 2x cpu but ~7.75x memory — past the memory bound, so it is not preferred.
ctx.gcpDb = [
  {
    instanceType: "e2-standard-8",
    family: "e2",
    familyName: "General purpose",
    vCpus: 8,
    memory: 32,
    price: 0.24,
  },
  {
    instanceType: "m4-hypermem-16",
    family: "m4",
    familyName: "Memory optimized",
    vCpus: 16,
    memory: 248,
    price: 4.0,
  },
];
console.log("[memory over-provisioning past 4x also drops the preference]");
{
  const res = run(
    "RuleEngine.apply(gcpDb, { rowWorkload: 'database', reqCpu: 8, reqMemory: 32 }, 'gcp')",
  );
  check(
    "the exact-fit instance wins over the hyper-memory one",
    top(res).instanceType === "e2-standard-8",
    `picked ${top(res).instanceType}`,
  );
}

// A close-fit preferred family IS still honoured: an AWS Database VM (8/32) with
// r5.2xlarge (8/64) — 1x cpu, 2x memory, within bounds — must be preferred over
// the cheaper general instance.
ctx.awsDb = [
  {
    instanceType: "m5.2xlarge",
    family: "m5",
    familyName: "General purpose",
    vCpus: 8,
    memory: 32,
    price: 0.38,
  },
  {
    instanceType: "r5.2xlarge",
    family: "r5",
    familyName: "Memory optimized",
    vCpus: 8,
    memory: 64,
    price: 0.5,
  },
];
console.log("[a close-fit preferred family is still honoured]");
{
  const res = run(
    "RuleEngine.apply(awsDb, { rowWorkload: 'database', reqCpu: 8, reqMemory: 32 }, 'aws')",
  );
  check(
    "the preferred memory-optimized instance is chosen when it fits",
    top(res).instanceType === "r5.2xlarge",
    `picked ${top(res).instanceType}`,
  );
  check(
    "the preference is reported as applied (not skipped)",
    res.rules.some((r) => /database preference\b/i.test(r)) &&
      !res.rules.some((r) => /database preference not applied/i.test(r)),
    JSON.stringify(res.rules),
  );
}

// The memory bound is inclusive at exactly 4x: an AWS Cache VM (2/4) with
// r6g.large (2/16) — exactly 4x memory — is still preferred.
ctx.awsCache = [
  {
    instanceType: "m6g.large",
    family: "m6g",
    familyName: "General purpose",
    vCpus: 2,
    memory: 8,
    price: 0.077,
  },
  {
    instanceType: "r6g.large",
    family: "r6g",
    familyName: "Memory optimized",
    vCpus: 2,
    memory: 16,
    price: 0.1,
  },
];
console.log("[the fit bound is inclusive at exactly 4x memory]");
{
  const res = run(
    "RuleEngine.apply(awsCache, { rowWorkload: 'cache', reqCpu: 2, reqMemory: 4 }, 'aws')",
  );
  check(
    "a preferred instance at exactly 4x memory is still chosen",
    top(res).instanceType === "r6g.large",
    `picked ${top(res).instanceType} (${top(res).memory} GiB)`,
  );
}

// The CPU bound, ISOLATED. The cases above either breach both axes at once or
// only the memory one, so a regression that dropped the vCPU check alone would
// leave this whole suite green — verified by planting exactly that.
//
// Cache VM 2 vCPU / 16 GB → caps are 4 vCPU (2x) and 64 GB (4x). r6g.2xlarge is
// preferred (cache → r/x) and sits at EXACTLY the memory cap, so only its vCPU
// count can disqualify it.
ctx.awsCacheCpuOnly = [
  {
    instanceType: "m6g.xlarge",
    family: "m6g",
    familyName: "General purpose",
    vCpus: 4,
    memory: 16,
    price: 0.154,
  },
  {
    instanceType: "r6g.2xlarge",
    family: "r6g",
    familyName: "Memory optimized",
    vCpus: 8, // 4x the requirement — over the 2x cap
    memory: 64, // exactly 4x — within the memory cap
    price: 0.4,
  },
];
console.log("[the vCPU bound alone can disqualify a preferred instance]");
{
  // Direct: memory is inside its bound, so a false here is the CPU check firing.
  check(
    "isWorkloadFit rejects it on vCPUs while memory is within bounds",
    run("RuleEngine.isWorkloadFit(awsCacheCpuOnly[1], 2, 16)") === false,
    "the 2x vCPU bound did not reject an 8-vCPU instance for a 2-vCPU VM",
  );
  check(
    "and the same instance passes once the vCPU requirement allows it",
    run("RuleEngine.isWorkloadFit(awsCacheCpuOnly[1], 4, 16)") === true,
    "raising reqCpu to 4 (cap 8) should admit it",
  );

  // And through the real pipeline: the preference must be dropped.
  const res = run(
    "RuleEngine.apply(awsCacheCpuOnly, { rowWorkload: 'cache', reqCpu: 2, reqMemory: 16 }, 'aws')",
  );
  check(
    "the general instance wins; the vCPU-heavy preferred one does not",
    top(res).instanceType === "m6g.xlarge",
    `picked ${top(res).instanceType} (${top(res).vCpus}/${top(res).memory})`,
  );
  check(
    "the row explains the preference was not applied",
    res.rules.some((r) => /cache preference not applied/i.test(r)),
    JSON.stringify(res.rules),
  );
}

// Without a requirement (e.g. a caller that doesn't pass one), behaviour is
// unchanged — the preference applies as before, so nothing regresses for callers
// that predate the bound.
console.log("[no requirement → preference applies as before]");
{
  const res = run(
    "RuleEngine.apply(gcpCache, { rowWorkload: 'cache' }, 'gcp')",
  );
  check(
    "with no reqCpu/reqMemory the preferred family still sorts first",
    top(res).instanceType === "m3-ultramem-32",
    `picked ${top(res).instanceType}`,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("workload-fit-test: all checks passed");
}

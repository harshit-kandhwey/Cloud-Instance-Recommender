// Rule 1d's network-tier preference (rule-engine.js) used to read `vCpus >= 4`
// as a stand-in for "gets a meaningfully higher network bandwidth tier" on all
// three providers. Probed live against the real Vantage feed 2026-09-04: AWS
// and Azure each publish a real per-type signal (baseline/burst Gbps; a boolean
// accelerated-networking flag), GCP's `network_performance` is the literal
// string "Variable" for every single shipped record and carries no
// information — a genuine dead end for this feed, not an oversight.
//
// Neither AWS's nor Azure's new field exists on any SHIPPED record yet — both
// are new to FIELD_ORDER, filled only by the next scheduled refresh — so this
// suite pins the FALLBACK path (dataset-wide absence → the exact pre-fix
// vCpus>=4 behaviour) as carefully as the real-field path, since the fallback
// is what every shipped record actually exercises today.
const { buildEngineContext } = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: ["js/base/rule-engine.js"],
  label: "network-tier",
});

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
};

const inst = (o) => ({
  instanceType: "x",
  family: "x",
  familyName: "General purpose",
  vCpus: 2,
  memory: 8,
  price: 0.1,
  generation: 1,
  isGraviton: 0,
  ...o,
});

console.log("[AWS: the real baseline_bandwidth_gbps field, once present]");
{
  ctx.above = inst({
    vCpus: 2, // below the OLD proxy's floor — the real field alone must decide
    originalData: { baselineBandwidthGbps: 1.25, burstBandwidthGbps: 10 },
  });
  ctx.below = inst({
    vCpus: 8, // above the OLD proxy's floor — the real field alone must decide
    originalData: { baselineBandwidthGbps: 0.5, burstBandwidthGbps: 5 },
  });
  check(
    "a low-vCPU type with real bandwidth ≥ 1 Gbps counts (vCPU count would have said no)",
    run("RuleEngine.hasNetworkTier(above, 'aws')") === true,
  );
  check(
    "a high-vCPU type with real bandwidth < 1 Gbps does NOT count (vCPU count would have said yes)",
    run("RuleEngine.hasNetworkTier(below, 'aws')") === false,
  );
}

console.log(
  "[AWS: -1 sentinel and dataset-wide absence both fall back to vCpus>=4]",
);
{
  ctx.sentinelLow = inst({
    vCpus: 2,
    originalData: { baselineBandwidthGbps: -1, burstBandwidthGbps: -1 },
  });
  ctx.sentinelHigh = inst({
    vCpus: 8,
    originalData: { baselineBandwidthGbps: -1, burstBandwidthGbps: -1 },
  });
  ctx.absentLow = inst({ vCpus: 2, originalData: {} });
  ctx.absentHigh = inst({ vCpus: 8, originalData: {} });
  ctx.noOriginalData = inst({ vCpus: 8 });
  check(
    "the -1 'not reported' sentinel (e.g. bare-metal) falls back — low vCPU excluded",
    run("RuleEngine.hasNetworkTier(sentinelLow, 'aws')") === false,
  );
  check(
    "the -1 sentinel falls back — high vCPU included",
    run("RuleEngine.hasNetworkTier(sentinelHigh, 'aws')") === true,
  );
  check(
    "the field simply absent (today's shipped data) falls back — low vCPU excluded",
    run("RuleEngine.hasNetworkTier(absentLow, 'aws')") === false,
  );
  check(
    "the field simply absent falls back — high vCPU included",
    run("RuleEngine.hasNetworkTier(absentHigh, 'aws')") === true,
  );
  check(
    "no originalData at all (hand-built fixture) still falls back safely",
    run("RuleEngine.hasNetworkTier(noOriginalData, 'aws')") === true,
  );
}

console.log("[Azure: the real accelerated_networking boolean, once present]");
{
  ctx.azTrue = inst({
    vCpus: 2, // below the OLD proxy's floor — the real field alone must decide
    originalData: { acceleratedNetworking: 1 },
  });
  ctx.azFalse = inst({
    vCpus: 8, // above the OLD proxy's floor — the real field alone must decide
    originalData: { acceleratedNetworking: 0 },
  });
  check(
    "a low-vCPU type with accelerated networking counts",
    run("RuleEngine.hasNetworkTier(azTrue, 'azure')") === true,
  );
  check(
    "a high-vCPU type WITHOUT accelerated networking does not count",
    run("RuleEngine.hasNetworkTier(azFalse, 'azure')") === false,
  );
}

console.log("[Azure: dataset-wide absence falls back to vCpus>=4]");
{
  ctx.azAbsentLow = inst({ vCpus: 2, originalData: {} });
  ctx.azAbsentHigh = inst({ vCpus: 8, originalData: {} });
  check(
    "field absent (today's shipped data) falls back — low vCPU excluded",
    run("RuleEngine.hasNetworkTier(azAbsentLow, 'azure')") === false,
  );
  check(
    "field absent falls back — high vCPU included",
    run("RuleEngine.hasNetworkTier(azAbsentHigh, 'azure')") === true,
  );
}

console.log(
  "[GCP: no usable field exists in this feed — vCpus>=4 is not a fallback, it is the only signal]",
);
{
  // Even a GCP record carrying a real-looking baselineBandwidthGbps (which GCP
  // never actually populates — checked against every shipped GCP record) must
  // NOT be read; GCP always decides on vCpus alone.
  ctx.gcpLow = inst({
    vCpus: 2,
    originalData: { baselineBandwidthGbps: 999, acceleratedNetworking: 1 },
  });
  ctx.gcpHigh = inst({ vCpus: 8, originalData: {} });
  check(
    "GCP ignores any bandwidth-shaped field and excludes on low vCPU",
    run("RuleEngine.hasNetworkTier(gcpLow, 'gcp')") === false,
  );
  check(
    "GCP includes on high vCPU alone",
    run("RuleEngine.hasNetworkTier(gcpHigh, 'gcp')") === true,
  );
}

console.log("[Rule 1d end to end: fires and reports without a count]");
{
  ctx.pool = [
    inst({ instanceType: "small", vCpus: 2 }),
    inst({ instanceType: "big", vCpus: 8 }),
  ];
  const res = run(
    "RuleEngine.apply(pool, { rowEnv: 'production', rowWorkload: 'database' }, 'aws')",
  );
  check(
    "1d excludes the low-vCPU instance (falls back, no bandwidth data present)",
    res.instances.length === 1 && res.instances[0].instanceType === "big",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
  check(
    "the rule label carries no stale '(≥4 vCPUs)' wording",
    res.rules.some((r) => r === "1d: Network-tier preference — 1 removed"),
    JSON.stringify(res.rules),
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("network-tier-test: all checks passed");
}

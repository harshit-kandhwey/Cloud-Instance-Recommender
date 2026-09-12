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
  scripts: ["src/core/rules/rule-engine.js"],
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
  "[Azure: -1 'not reported for this record' sentinel falls back, distinct from an explicit false]",
);
{
  // -1 (unreported) used to collapse into 0 (explicit false) before this fix.
  ctx.azSentinelLow = inst({
    vCpus: 2,
    originalData: { acceleratedNetworking: -1 },
  });
  ctx.azSentinelHigh = inst({
    vCpus: 8,
    originalData: { acceleratedNetworking: -1 },
  });
  check(
    "the -1 sentinel falls back — low vCPU excluded",
    run("RuleEngine.hasNetworkTier(azSentinelLow, 'azure')") === false,
  );
  check(
    "the -1 sentinel falls back — high vCPU included",
    run("RuleEngine.hasNetworkTier(azSentinelHigh, 'azure')") === true,
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

console.log(
  "[Rule 1d, AWS: an exact price tie prefers more burst headroom, v3.16.18]",
);
{
  // Both pass the network-tier floor (real baseline ≥ 1 Gbps) and are priced
  // identically — the only thing that should decide the winner.
  ctx.tiedLowBurst = inst({
    instanceType: "tied-low-burst",
    price: 0.5,
    originalData: { baselineBandwidthGbps: 2, burstBandwidthGbps: 2 },
  });
  ctx.tiedHighBurst = inst({
    instanceType: "tied-high-burst",
    price: 0.5,
    originalData: { baselineBandwidthGbps: 2, burstBandwidthGbps: 10 },
  });
  ctx.tiePool = [ctx.tiedLowBurst, ctx.tiedHighBurst];
  const res = run(
    "RuleEngine.apply(tiePool, { rowEnv: 'production', rowWorkload: 'database' }, 'aws')",
  );
  check(
    "the higher-burst instance wins an exact price tie",
    res.instances[0].instanceType === "tied-high-burst",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
}

console.log(
  "[Rule 1d, AWS: a real price difference is never overridden by burst, v3.16.18]",
);
{
  ctx.cheapLowBurst = inst({
    instanceType: "cheap-low-burst",
    price: 0.4,
    originalData: { baselineBandwidthGbps: 2, burstBandwidthGbps: 2 },
  });
  ctx.pricierHighBurst = inst({
    instanceType: "pricier-high-burst",
    price: 0.5,
    originalData: { baselineBandwidthGbps: 2, burstBandwidthGbps: 10 },
  });
  ctx.pricedPool = [ctx.cheapLowBurst, ctx.pricierHighBurst];
  const res = run(
    "RuleEngine.apply(pricedPool, { rowEnv: 'production', rowWorkload: 'database' }, 'aws')",
  );
  check(
    "price still decides first — burst never promotes a pricier instance",
    res.instances[0].instanceType === "cheap-low-burst",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
}

console.log(
  "[Rule 1d, Azure: no burst concept — an exact price tie stays in its original order, v3.16.18]",
);
{
  // Azure has no burst_bandwidth_gbps equivalent; the tie-break must not
  // apply there (or crash reading an AWS-only field off an Azure instance).
  ctx.azTied1 = inst({
    instanceType: "az-tied-1",
    price: 0.5,
    originalData: { acceleratedNetworking: 1 },
  });
  ctx.azTied2 = inst({
    instanceType: "az-tied-2",
    price: 0.5,
    originalData: { acceleratedNetworking: 1 },
  });
  ctx.azTiePool = [ctx.azTied1, ctx.azTied2];
  const res = run(
    "RuleEngine.apply(azTiePool, { rowEnv: 'production', rowWorkload: 'database' }, 'azure')",
  );
  check(
    "Azure's price-tied pool survives unresorted (stable order, first stays first)",
    res.instances[0].instanceType === "az-tied-1" &&
      res.instances[1].instanceType === "az-tied-2",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
}

console.log(
  "[Rule 1d, AWS: when NOTHING clears the network-tier floor, burst never resorts the pool]",
);
{
  // Found by CodeRabbit (3.16 tail round 3): the burst sort used to run
  // unconditionally on `filtered` whenever provider === "aws", even when
  // `net.length === 0` left `filtered` as the untouched, floor-missing pool —
  // silently reordering a price tie on a rule that reported nothing (no "1d:
  // Network-tier preference" line at all). Both instances are BELOW the
  // network-tier floor (baseline < 1 Gbps) — 1d does not apply.
  ctx.belowFloorLowBurst = inst({
    instanceType: "below-floor-low-burst",
    price: 0.3,
    originalData: { baselineBandwidthGbps: 0.5, burstBandwidthGbps: 2 },
  });
  ctx.belowFloorHighBurst = inst({
    instanceType: "below-floor-high-burst",
    price: 0.3,
    originalData: { baselineBandwidthGbps: 0.5, burstBandwidthGbps: 10 },
  });
  ctx.belowFloorPool = [ctx.belowFloorLowBurst, ctx.belowFloorHighBurst];
  const res = run(
    "RuleEngine.apply(belowFloorPool, { rowEnv: 'production', rowWorkload: 'database' }, 'aws')",
  );
  check(
    "1d did not apply (no rule line) — pool order is untouched, not resorted by burst",
    !res.rules.some((r) => r.includes("Network-tier")) &&
      res.instances[0].instanceType === "below-floor-low-burst" &&
      res.instances[1].instanceType === "below-floor-high-burst",
    JSON.stringify({
      rules: res.rules,
      order: res.instances.map((i) => i.instanceType),
    }),
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("network-tier-test: all checks passed");
}

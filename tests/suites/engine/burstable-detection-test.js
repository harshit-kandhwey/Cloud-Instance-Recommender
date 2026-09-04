// Burstable-family detection (rule-engine.js isBurstable) used to be a hardcoded
// family list on all three providers. Probed live against the real Vantage feed
// 2026-09-04: AWS publishes `burst_minutes`, but only on 28 of 1428 records —
// every t2/t3/t3a/t4g type, but NOT t1.micro, an ancient family that IS
// burstable and that Vantage simply doesn't report this field for. GCP
// publishes `shared_cpu`, a real boolean present on every record with no gap.
// Azure publishes neither — no field of any kind distinguishes B-series from
// the rest, a genuine dead end like GCP's network-tier/SQL-core fields
// elsewhere in this suite's siblings.
//
// AWS ORs the real field with the family list rather than replacing it (the
// list is false for every non-burstable type regardless, so it's a free
// fallback that also covers t1.micro and the pre-refresh dormant case). GCP's
// field has no such gap once populated, so dormant (undefined) is its only
// fallback case. Neither new field exists on any SHIPPED record yet — both are
// new to FIELD_ORDER, filled only by the next scheduled refresh — so this
// suite pins the fallback path as carefully as the real-field path, since the
// fallback is what every shipped record actually exercises today.
const { buildEngineContext } = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: ["js/base/rule-engine.js"],
  label: "burstable-detection",
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

console.log("[AWS: the real burst_minutes field, once present]");
{
  ctx.m5 = inst({ family: "m5", originalData: { burstMinutes: 144 } });
  ctx.t3 = inst({ family: "t3", originalData: { burstMinutes: 144 } });
  check(
    "a non-T family reporting real burst minutes counts as burstable (the field alone decides)",
    run("RuleEngine.isBurstable(m5, 'aws')") === true,
    "a future family Vantage flags this way must self-classify without a code change",
  );
  check(
    "a T family with real burst minutes counts",
    run("RuleEngine.isBurstable(t3, 'aws')") === true,
  );
}

console.log(
  "[AWS: -1 sentinel and dataset-wide absence both fall back to the family list]",
);
{
  ctx.m5Sentinel = inst({
    family: "m5",
    originalData: { burstMinutes: -1 },
  });
  ctx.t3Sentinel = inst({
    family: "t3",
    originalData: { burstMinutes: -1 },
  });
  ctx.m5Absent = inst({ family: "m5", originalData: {} });
  ctx.t3Absent = inst({ family: "t3", originalData: {} });
  ctx.noOriginalData = inst({ family: "t3" });
  check(
    "the -1 sentinel falls back — non-burstable family excluded",
    run("RuleEngine.isBurstable(m5Sentinel, 'aws')") === false,
  );
  check(
    "the -1 sentinel falls back — burstable family (t3) still included",
    run("RuleEngine.isBurstable(t3Sentinel, 'aws')") === true,
  );
  check(
    "the field simply absent falls back — non-burstable family excluded",
    run("RuleEngine.isBurstable(m5Absent, 'aws')") === false,
  );
  check(
    "the field simply absent falls back — burstable family still included",
    run("RuleEngine.isBurstable(t3Absent, 'aws')") === true,
  );
  check(
    "no originalData at all (hand-built fixture) still falls back safely",
    run("RuleEngine.isBurstable(noOriginalData, 'aws')") === true,
  );
}

console.log(
  "[AWS: t1 — the one family the real field never covers, dormant or not]",
);
{
  ctx.t1Absent = inst({ family: "t1", originalData: {} });
  ctx.t1NoField = inst({
    family: "t1",
    originalData: { burstMinutes: -1 },
  });
  check(
    "t1.micro (Vantage reports no burst_minutes for it at all) still classifies burstable via the family-list fallback",
    run("RuleEngine.isBurstable(t1Absent, 'aws')") === true,
  );
  check(
    "t1 with the explicit -1 sentinel still classifies burstable",
    run("RuleEngine.isBurstable(t1NoField, 'aws')") === true,
  );
}

console.log("[GCP: the real shared_cpu boolean, once present]");
{
  ctx.n2True = inst({ family: "n2", originalData: { sharedCpu: 1 } });
  ctx.e2False = inst({ family: "e2", originalData: { sharedCpu: 0 } });
  check(
    "a non-shared-core family flagged true by the real field counts (the field alone decides)",
    run("RuleEngine.isBurstable(n2True, 'gcp')") === true,
    "a future GCP family must self-classify without a code change",
  );
  check(
    "an e2 family flagged false by the real field does NOT count, even though e2 can be shared-core",
    run("RuleEngine.isBurstable(e2False, 'gcp')") === false,
  );
}

console.log(
  "[GCP: dataset-wide absence falls back to the old family/regex check]",
);
{
  ctx.e2MicroAbsent = inst({
    family: "e2",
    instanceType: "e2-micro",
    originalData: {},
  });
  ctx.e2StandardAbsent = inst({
    family: "e2",
    instanceType: "e2-standard-4",
    originalData: {},
  });
  ctx.f1Absent = inst({ family: "f1", originalData: {} });
  ctx.n2Absent = inst({ family: "n2", originalData: {} });
  check(
    "field absent — e2-micro still classifies burstable via the old regex fallback",
    run("RuleEngine.isBurstable(e2MicroAbsent, 'gcp')") === true,
  );
  check(
    "field absent — e2-standard-4 still excluded via the old regex fallback",
    run("RuleEngine.isBurstable(e2StandardAbsent, 'gcp')") === false,
  );
  check(
    "field absent — legacy f1 series still classifies burstable via the old list fallback",
    run("RuleEngine.isBurstable(f1Absent, 'gcp')") === true,
  );
  check(
    "field absent — n2 still excluded",
    run("RuleEngine.isBurstable(n2Absent, 'gcp')") === false,
  );
}

console.log(
  "[Azure: unchanged — no real field exists, family prefix is the only signal]",
);
{
  ctx.bSeries = inst({ family: "bsv2" });
  ctx.dSeries = inst({ family: "dsv5" });
  check(
    "B-series still classifies burstable",
    run("RuleEngine.isBurstable(bSeries, 'azure')") === true,
  );
  check(
    "a non-B family does not",
    run("RuleEngine.isBurstable(dSeries, 'azure')") === false,
  );
}

console.log(
  "[Rule 1a end to end: fires the same way regardless of which path decided]",
);
{
  ctx.pool = [
    inst({ instanceType: "t3.small", family: "t3" }),
    inst({ instanceType: "m5.large", family: "m5" }),
  ];
  const res = run("RuleEngine.apply(pool, { rowEnv: 'production' }, 'aws')");
  check(
    "1a excludes the burstable instance (dormant fallback, no field data present)",
    res.instances.length === 1 && res.instances[0].instanceType === "m5.large",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("burstable-detection-test: all checks passed");
}

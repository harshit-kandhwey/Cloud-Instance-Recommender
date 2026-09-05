// Two of item B's "instance attribute filters" (ROADMAP's "3.16 — Attribute
// filters & rule fidelity"): a numeric GPU count backing isAccelerator's
// blank-familyName fallback, and a new "bare metal" exclude-type token.
//
// GPU count — probed live 2026-09-05: AWS and GCP's `GPU` field is always a
// real number; Azure's is free text, parsed to a number by fetch-vantage.js.
// familyName stays PRIMARY (FPGA/ML-ASIC instances report gpuCount 0 despite
// being accelerators), so this only changes the blank-familyName fallback —
// exercised here with familyName deliberately blank throughout.
//
// Bare metal — AWS has a real `is_bare_metal` boolean; GCP has no dedicated
// field but every bare-metal type's own name ends in "-metal" (checked
// against every shipped type); Azure publishes zero bare-metal instance
// types at all (checked live), so the token always returns false there.
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx, run } = buildEngineContext({
  scripts: [
    "js/base/rule-engine.js",
    "js/base/base-instance-selector.js",
    "js/base/instance-selector-factory.js",
  ],
  label: "gpu-baremetal",
});
run(`
  __sel = new BaseInstanceSelector();
  __sel.getProviderName = function () { return "AWS"; };
  __sel.getSampleData = function () { return []; };
`);

const box = (instanceType, family, price, originalData) => ({
  instanceType,
  vCpus: 2,
  memory: 8,
  price,
  family,
  familyName: "", // blank throughout: the fallback path this suite targets
  processor: "Intel",
  generation: 1,
  isGraviton: 0,
  originalData,
});

console.log(
  "[GPU count: the real field backs the blank-familyName fallback, ahead of the prefix list]",
);
{
  ctx.pool = [
    box("p9.large", "p9", 0.5, { gpuCount: 8 }), // NOT in ACCELERATOR_FAMILY_PREFIXES.aws
    box("m5.large", "m5", 0.1, { gpuCount: 0 }),
  ];
  run(`__sel.instanceData = { r: pool };`);
  const pick = (opts) =>
    run(`__sel.getLikeToLikeInstance("r", 2, 8, ${JSON.stringify(opts)})`);
  check(
    "a future family (p9, not in the prefix list) self-classifies as GPU via the real field alone",
    pick({ excludeTypes: ["gpu"] }).instanceType === "m5.large",
    JSON.stringify(pick({ excludeTypes: ["gpu"] })),
  );
  check(
    "Include Only gpu keeps only the real-field-flagged instance",
    pick({ includeOnlyTypes: ["gpu"] }).instanceType === "p9.large",
    JSON.stringify(pick({ includeOnlyTypes: ["gpu"] })),
  );
}

console.log(
  "[GPU count: FPGA/ASIC families still classify via the prefix list despite gpuCount 0]",
);
{
  ctx.pool = [
    box("f1.large", "f1", 0.5, { gpuCount: 0 }), // AWS FPGA — no GPU at all
    box("m5.large", "m5", 0.1, { gpuCount: 0 }),
  ];
  run(`__sel.instanceData = { r: pool };`);
  const pick = (opts) =>
    run(`__sel.getLikeToLikeInstance("r", 2, 8, ${JSON.stringify(opts)})`);
  check(
    "f1 (FPGA, gpuCount 0) still excluded by 'gpu' via the family-prefix list",
    pick({ excludeTypes: ["gpu"] }).instanceType === "m5.large",
    JSON.stringify(pick({ excludeTypes: ["gpu"] })),
  );
}

console.log(
  "[GPU count: dormant field (no originalData at all) falls back to the prefix list exactly as before]",
);
{
  ctx.pool = [
    box("g4.large", "g4", 0.5, undefined), // in the prefix list
    box("m5.large", "m5", 0.1, undefined),
  ];
  run(`__sel.instanceData = { r: pool };`);
  const pick = (opts) =>
    run(`__sel.getLikeToLikeInstance("r", 2, 8, ${JSON.stringify(opts)})`);
  check(
    "no originalData at all still classifies g4 as GPU via the prefix list",
    pick({ excludeTypes: ["gpu"] }).instanceType === "m5.large",
    JSON.stringify(pick({ excludeTypes: ["gpu"] })),
  );
}

console.log("[Bare metal: AWS's real is_bare_metal field]");
{
  ctx.pool = [
    box("c5.metal", "c5", 0.5, { isBareMetal: 1 }),
    box("m5.large", "m5", 0.1, { isBareMetal: 0 }),
  ];
  run(`__sel.instanceData = { r: pool };`);
  const pick = (opts) =>
    run(`__sel.getLikeToLikeInstance("r", 2, 8, ${JSON.stringify(opts)})`);
  check(
    "Exclude 'bare metal' drops c5.metal on AWS",
    pick({ excludeTypes: ["bare metal"] }).instanceType === "m5.large",
    JSON.stringify(pick({ excludeTypes: ["bare metal"] })),
  );
  check(
    "Include Only 'bare metal' keeps only c5.metal on AWS",
    pick({ includeOnlyTypes: ["bare metal"] }).instanceType === "c5.metal",
    JSON.stringify(pick({ includeOnlyTypes: ["bare metal"] })),
  );
}

console.log(
  "[Bare metal: string-serialized forms of the flag are also honoured (RuleEngine.isFlagTrue)]",
);
{
  // This check exists because the AWS branch used to hand-copy its own
  // 3-form equality check (1 / "1" / the number 1.0 -- never the STRING
  // "1.0") instead of sharing RuleEngine.isFlagTrue. A value round-tripped
  // through CSV/JSON as the string "1.0" is exactly the shape that drift
  // silently stopped matching, so each case here is priced to be the
  // CHEAPEST candidate -- a wrong classification would win the pick,
  // not just survive alongside the right answer.
  ctx.pool = [
    box("c5.metal", "c5", 0.05, { isBareMetal: "1" }),
    box("m5.large", "m5", 0.1, { isBareMetal: 0 }),
  ];
  run(`__sel.instanceData = { r: pool };`);
  const pick = (opts) =>
    run(`__sel.getLikeToLikeInstance("r", 2, 8, ${JSON.stringify(opts)})`);
  check(
    "Exclude 'bare metal' drops a string \"1\"-flagged type even though it's cheapest",
    pick({ excludeTypes: ["bare metal"] }).instanceType === "m5.large",
    JSON.stringify(pick({ excludeTypes: ["bare metal"] })),
  );

  ctx.pool = [
    box("c5n.metal", "c5n", 0.05, { isBareMetal: "1.0" }),
    box("m5.large", "m5", 0.1, { isBareMetal: 0 }),
  ];
  run(`__sel.instanceData = { r: pool };`);
  check(
    "Exclude 'bare metal' drops a string \"1.0\"-flagged type even though it's cheapest",
    pick({ excludeTypes: ["bare metal"] }).instanceType === "m5.large",
    JSON.stringify(pick({ excludeTypes: ["bare metal"] })),
  );
}

console.log("[Bare metal: GCP's name-suffix pattern, no field needed]");
{
  run(`
    __selGcp = new BaseInstanceSelector();
    __selGcp.getProviderName = function () { return "GCP"; };
    __selGcp.getSampleData = function () { return []; };
  `);
  ctx.poolGcp = [
    box("c3-standard-192-metal", "c3", 0.5, {}),
    box("n2-standard-4", "n2", 0.1, {}),
  ];
  run(`__selGcp.instanceData = { r: poolGcp };`);
  const pickGcp = (opts) =>
    run(`__selGcp.getLikeToLikeInstance("r", 2, 8, ${JSON.stringify(opts)})`);
  check(
    "Exclude 'bare metal' drops the -metal type on GCP via its own name, no field",
    pickGcp({ excludeTypes: ["bare metal"] }).instanceType === "n2-standard-4",
    JSON.stringify(pickGcp({ excludeTypes: ["bare metal"] })),
  );
}

console.log(
  "[Bare metal: Azure publishes none — the token always resolves false there]",
);
{
  run(`
    __selAz = new BaseInstanceSelector();
    __selAz.getProviderName = function () { return "AZURE"; };
    __selAz.getSampleData = function () { return []; };
  `);
  ctx.poolAz = [
    box("Standard_D2s_v5", "Dsv5", 0.1, {}),
    box("Standard_D4s_v5", "Dsv5", 0.2, {}),
  ];
  run(`__selAz.instanceData = { r: poolAz };`);
  const pickAz = (opts) =>
    run(`__selAz.getLikeToLikeInstance("r", 2, 8, ${JSON.stringify(opts)})`);
  check(
    "Exclude 'bare metal' removes nothing on Azure (no bare-metal types exist)",
    pickAz({ excludeTypes: ["bare metal"] }).instanceType === "Standard_D2s_v5",
    JSON.stringify(pickAz({ excludeTypes: ["bare metal"] })),
  );
}

if (state.failures) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("gpu-baremetal-test: all checks passed");
}

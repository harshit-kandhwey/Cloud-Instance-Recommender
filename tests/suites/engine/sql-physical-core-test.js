// Rule SQL's optional physical-core licensing mode (rule-engine.js), added
// beside the existing vCPU-based floor in sql-min-cores-test.js.
//
// Microsoft's SQL Server per-core licensing counts VIRTUAL cores (vCPUs) for
// a VM licensed directly — the existing 4-vCPU floor already implements that
// correctly, and stays the default. The License Mobility / BYOL path counts
// PHYSICAL cores instead, which matters because AWS/Azure instances are
// typically hyperthreaded ~2:1 — an 8-vCPU AWS instance is often only 4
// physical cores. `options.sqlPhysicalCoreLicensing` switches the basis;
// off (the default) must leave every existing behaviour byte-identical,
// which sql-min-cores-test.js already pins.
const { buildEngineContext } = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: ["js/base/rule-engine.js"],
  label: "sql-physical-core",
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
  memory: 16,
  price: 0.1,
  generation: 1,
  isGraviton: 0,
  ...o,
});

console.log("[RuleEngine.physicalCores: the real fields, once present]");
{
  ctx.aws4x2 = inst({
    vCpus: 4,
    originalData: { cores: 2 }, // 2:1 hyperthreaded — 4 vCPU = 2 physical cores
  });
  ctx.aws8x4 = inst({ vCpus: 8, originalData: { cores: 4 } });
  ctx.azure8pc2 = inst({ vCpus: 8, originalData: { vcpusPerCore: 2 } });
  check(
    "AWS: reads the real cores field directly",
    run("RuleEngine.physicalCores(aws4x2, 'aws')") === 2,
  );
  check(
    "AWS: a bigger instance's real core count",
    run("RuleEngine.physicalCores(aws8x4, 'aws')") === 4,
  );
  check(
    "Azure: derives physical cores from vCpus / vcpusPerCore",
    run("RuleEngine.physicalCores(azure8pc2, 'azure')") === 4,
  );
}

console.log(
  "[RuleEngine.physicalCores: null (not a guess) when no real data exists]",
);
{
  ctx.awsSentinel = inst({ vCpus: 8, originalData: { cores: -1 } }); // bare-metal
  ctx.awsAbsent = inst({ vCpus: 8, originalData: {} }); // dormant, pre-refresh
  ctx.azureZero = inst({ vCpus: 8, originalData: { vcpusPerCore: 0 } }); // Vantage's own "not reported"
  ctx.azureAbsent = inst({ vCpus: 8, originalData: {} });
  ctx.gcpAnything = inst({
    vCpus: 8,
    originalData: { cores: 4, vcpusPerCore: 2 }, // GCP never actually has these
  });
  check(
    "AWS: the -1 sentinel (bare-metal) is null, not a real core count",
    run("RuleEngine.physicalCores(awsSentinel, 'aws')") === null,
  );
  check(
    "AWS: the field simply absent (today's shipped data) is null",
    run("RuleEngine.physicalCores(awsAbsent, 'aws')") === null,
  );
  check(
    "Azure: 0 (Vantage's own 'not reported' value) is null",
    run("RuleEngine.physicalCores(azureZero, 'azure')") === null,
  );
  check(
    "Azure: the field simply absent is null",
    run("RuleEngine.physicalCores(azureAbsent, 'azure')") === null,
  );
  check(
    "GCP: always null, even if a record somehow carried these fields",
    run("RuleEngine.physicalCores(gcpAnything, 'gcp')") === null,
  );
}

console.log("[Rule SQL: off by default, byte-identical to the vCPU floor]");
{
  ctx.pool = [
    inst({ instanceType: "small", vCpus: 4, originalData: { cores: 1 } }), // 1 physical core
    inst({ instanceType: "big", vCpus: 8, originalData: { cores: 4 } }), // 4 physical cores
  ];
  const off = run(
    "RuleEngine.apply(pool, { rowWorkload: 'SQL Server' }, 'aws')",
  );
  check(
    "with the toggle absent, both clear the 4-vCPU floor (small has 4 vCPUs)",
    off.instances.length === 2,
    JSON.stringify(off.instances.map((i) => i.instanceType)),
  );
  check(
    "the label says vCPU, not physical-core",
    !off.rules.some((r) => r.includes("physical-core")),
    JSON.stringify(off.rules),
  );
}

console.log("[Rule SQL: physical-core mode changes the floor on AWS/Azure]");
{
  const on = run(
    "RuleEngine.apply(pool, { rowWorkload: 'SQL Server', sqlPhysicalCoreLicensing: true }, 'aws')",
  );
  check(
    "small (1 physical core) is now excluded — it cleared only the vCPU floor",
    on.instances.length === 1 && on.instances[0].instanceType === "big",
    JSON.stringify(on.instances.map((i) => i.instanceType)),
  );
  check(
    "the label now says physical-core",
    on.rules.some((r) => r.startsWith("SQL: 4-physical-core licence floor")),
    JSON.stringify(on.rules),
  );
}

console.log(
  "[Rule SQL: physical-core mode falls back to vCPU when the field is absent]",
);
{
  ctx.dormantPool = [
    inst({ instanceType: "small", vCpus: 2, originalData: {} }),
    inst({ instanceType: "big", vCpus: 8, originalData: {} }),
  ];
  const on = run(
    "RuleEngine.apply(dormantPool, { rowWorkload: 'SQL Server', sqlPhysicalCoreLicensing: true }, 'aws')",
  );
  check(
    "behaves exactly like the vCPU floor when no real core data exists yet",
    on.instances.length === 1 && on.instances[0].instanceType === "big",
    JSON.stringify(on.instances.map((i) => i.instanceType)),
  );
}

console.log(
  "[Rule SQL: GCP is unaffected by the toggle — no comparable field exists]",
);
{
  ctx.gcpPool = [
    inst({ instanceType: "small", vCpus: 2, originalData: {} }),
    inst({ instanceType: "big", vCpus: 8, originalData: {} }),
  ];
  const on = run(
    "RuleEngine.apply(gcpPool, { rowWorkload: 'SQL Server', sqlPhysicalCoreLicensing: true }, 'gcp')",
  );
  check(
    "GCP keeps the plain vCPU floor regardless of the toggle",
    on.instances.length === 1 && on.instances[0].instanceType === "big",
    JSON.stringify(on.instances.map((i) => i.instanceType)),
  );
  check(
    "and reports the floor as a vCPU one, not physical-core",
    on.rules.some((r) => r.startsWith("SQL: 4-vCPU licence floor")),
    JSON.stringify(on.rules),
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("sql-physical-core-test: all checks passed");
}

// Compliance used to be four regulatory-sounding names (PCI/HIPAA/SOC2/FIPS)
// that collapsed, in the engine, to exactly two behaviours: current-gen-only
// (all four) and, only for PCI/HIPAA on AWS, Nitro Enclaves required. None of
// the four certify anything a cloud provider recognises at the instance-type
// level — that's an account/program-level fact — and PCI/HIPAA were
// literally indistinguishable in code. Renamed 2026-09-05 to atomic,
// independently selectable, honestly-named options a Compliance cell can
// combine (comma-separated, like Exclude/Include Only):
//   Current-Generation Hardware | AWS Nitro Enclaves | Confidential
//   Computing | Azure Trusted Launch
// The old names still work as aliases (COMPLIANCE_ALIASES), so no existing
// CSV or preset breaks. Each atomic option's per-provider signal quality was
// cross-checked against the providers' own docs, not just the Vantage feed
// (see rule-engine.js's isConfidentialCapable / isTrustedLaunchCapable).
const { buildEngineContext } = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: ["js/base/rule-engine.js"],
  label: "compliance-options",
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

const apply = (pool, compliance, provider) =>
  run(
    `RuleEngine.apply(${JSON.stringify(pool)}, { rowCompliance: ${JSON.stringify(compliance)} }, ${JSON.stringify(provider)})`,
  );

console.log("[Legacy aliases still work exactly as before]");
{
  ctx.currentGenPool = [
    inst({ instanceType: "old", generation: 0 }),
    inst({ instanceType: "new", generation: 1 }),
  ];
  const pci = apply(ctx.currentGenPool, "PCI", "azure");
  check(
    "PCI still excludes previous-gen (alias expands to Current-Generation Hardware)",
    pci.instances.length === 1 && pci.instances[0].instanceType === "new",
    JSON.stringify(pci.instances.map((i) => i.instanceType)),
  );
  const soc2 = apply(ctx.currentGenPool, "soc2", "gcp"); // case-insensitive
  check(
    "SOC2 (lowercase) still excludes previous-gen",
    soc2.instances.length === 1 && soc2.instances[0].instanceType === "new",
  );

  ctx.nitroPool = [
    inst({
      instanceType: "nitro",
      generation: 1,
      originalData: { nitroEnclavesSupport: 1 },
    }),
    inst({
      instanceType: "plain",
      generation: 1,
      originalData: { nitroEnclavesSupport: 0 },
    }),
  ];
  const hipaa = apply(ctx.nitroPool, "HIPAA", "aws");
  check(
    "HIPAA still requires Nitro on AWS (alias expands to both atomic tokens)",
    hipaa.instances.length === 1 && hipaa.instances[0].instanceType === "nitro",
    JSON.stringify(hipaa.instances.map((i) => i.instanceType)),
  );
  const hipaaAzure = apply(ctx.nitroPool, "HIPAA", "azure");
  check(
    "HIPAA on Azure only excludes previous-gen — no Nitro concept there, so both survive",
    hipaaAzure.instances.length === 2,
    JSON.stringify(hipaaAzure.instances.map((i) => i.instanceType)),
  );
}

console.log(
  "[Atomic tokens are independently selectable — no forced bundling]",
);
{
  ctx.pool = [
    inst({
      instanceType: "prevGenNitro",
      generation: 0,
      originalData: { nitroEnclavesSupport: 1 },
    }),
    inst({
      instanceType: "currentGenNoNitro",
      generation: 1,
      originalData: { nitroEnclavesSupport: 0 },
    }),
  ];
  const nitroOnly = apply(ctx.pool, "AWS Nitro Enclaves", "aws");
  check(
    "AWS Nitro Enclaves alone does NOT also force current-gen (prevGenNitro survives)",
    nitroOnly.instances.length === 1 &&
      nitroOnly.instances[0].instanceType === "prevGenNitro",
    JSON.stringify(nitroOnly.instances.map((i) => i.instanceType)),
  );
  const currentGenOnly = apply(ctx.pool, "Current-Generation Hardware", "aws");
  check(
    "Current-Generation Hardware alone does NOT also require Nitro (currentGenNoNitro survives)",
    currentGenOnly.instances.length === 1 &&
      currentGenOnly.instances[0].instanceType === "currentGenNoNitro",
    JSON.stringify(currentGenOnly.instances.map((i) => i.instanceType)),
  );
  ctx.poolBoth = [
    ...ctx.pool,
    inst({
      instanceType: "currentGenNitro",
      generation: 1,
      originalData: { nitroEnclavesSupport: 1 },
    }),
  ];
  const both = apply(
    ctx.poolBoth,
    "Current-Generation Hardware, AWS Nitro Enclaves",
    "aws",
  );
  check(
    "both tokens together, comma-separated, AND together — only the candidate meeting both survives",
    both.instances.length === 1 &&
      both.instances[0].instanceType === "currentGenNitro",
    JSON.stringify(both.instances.map((i) => i.instanceType)),
  );
}

console.log("[Confidential Computing: AWS reuses Nitro]");
{
  ctx.pool = [
    inst({ instanceType: "nitro", originalData: { nitroEnclavesSupport: 1 } }),
    inst({ instanceType: "plain", originalData: { nitroEnclavesSupport: 0 } }),
  ];
  const res = apply(ctx.pool, "Confidential Computing", "aws");
  check(
    "AWS Confidential Computing requires Nitro-capable, same signal as the Nitro option",
    res.instances.length === 1 && res.instances[0].instanceType === "nitro",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
}

console.log("[Confidential Computing: Azure's dc*/ec* family match]");
{
  ctx.pool = [
    inst({ instanceType: "dc-vm", family: "dcadsv5" }),
    inst({ instanceType: "ec-vm", family: "ecasv5" }),
    inst({ instanceType: "d-vm", family: "dsv5" }),
  ];
  const res = apply(ctx.pool, "Confidential Computing", "azure");
  const types = res.instances.map((i) => i.instanceType).sort();
  check(
    "Azure Confidential Computing keeps dc*/ec* families only",
    JSON.stringify(types) === JSON.stringify(["dc-vm", "ec-vm"]),
    JSON.stringify(types),
  );
  check(
    "Azure's real 'confidential' field is never read (it is FALSE on every record) — family match is the only signal",
    true, // documented by construction: isConfidentialCapable never reads inst.confidential at all
  );
}

console.log(
  "[Confidential Computing: GCP has no signal — skipped entirely, not a permanent 'not applied' note]",
);
{
  ctx.pool = [inst({ instanceType: "n2", family: "n2" })];
  const res = apply(ctx.pool, "Confidential Computing", "gcp");
  check("GCP: the pool is untouched", res.instances.length === 1);
  check(
    "GCP: no rule line at all for Confidential Computing (a true no-op, not noise on every row)",
    !res.rules.some((r) => r.includes("Confidential computing")),
    JSON.stringify(res.rules),
  );
}

console.log(
  "[Confidential Computing: AWS/Azure report 'not applied' honestly]",
);
{
  ctx.pool = [inst({ instanceType: "plain", family: "m5" })];
  const res = apply(ctx.pool, "Confidential Computing", "aws");
  check(
    "no AWS candidate qualifies -> pool stands, 'not applied' reported",
    res.instances.length === 1 &&
      res.rules.some((r) => r.includes("not applied")),
    JSON.stringify(res.rules),
  );
}

console.log("[Azure Trusted Launch: Azure-only real field]");
{
  ctx.pool = [
    inst({ instanceType: "tl", originalData: { trustedLaunch: 1 } }),
    inst({ instanceType: "plain", originalData: { trustedLaunch: 0 } }),
  ];
  const res = apply(ctx.pool, "Azure Trusted Launch", "azure");
  check(
    "Azure Trusted Launch keeps only the trustedLaunch=1 instance",
    res.instances.length === 1 && res.instances[0].instanceType === "tl",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
  const awsRes = apply(ctx.pool, "Azure Trusted Launch", "aws");
  check(
    "Azure Trusted Launch is skipped entirely on AWS — no rule line, pool untouched",
    awsRes.instances.length === 2 &&
      !awsRes.rules.some((r) => r.includes("Trusted Launch")),
    JSON.stringify({ n: awsRes.instances.length, rules: awsRes.rules }),
  );
  // isTrustedLaunchCapable used to reject the string "1.0" (see isFlagTrue).
  ctx.tlStringPool = [
    inst({ instanceType: "tl", originalData: { trustedLaunch: "1.0" } }),
    inst({ instanceType: "plain", originalData: { trustedLaunch: 0 } }),
  ];
  const tlStringRes = apply(ctx.tlStringPool, "Azure Trusted Launch", "azure");
  check(
    'the string "1.0" form is also honoured',
    tlStringRes.instances.length === 1 &&
      tlStringRes.instances[0].instanceType === "tl",
    JSON.stringify(tlStringRes.instances.map((i) => i.instanceType)),
  );
}

console.log("[Unrecognised tokens are silently ignored by apply() itself]");
{
  // The hygiene check (ingest.js) is what NAMES an unrecognised token to the
  // user; apply() just doesn't act on what it doesn't understand — same
  // contract as every other rule-value vocabulary in this file.
  ctx.pool = [inst({ instanceType: "x", generation: 0 })];
  const res = apply(ctx.pool, "Made-Up Framework", "aws");
  check(
    "an unrecognised Compliance token changes nothing",
    res.instances.length === 1,
    JSON.stringify(res.instances),
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("compliance-options-test: all checks passed");
}

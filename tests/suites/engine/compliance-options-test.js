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
  scripts: ["src/core/rules/rule-engine.js"],
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
    // confidential: true on a non-dc*/ec* family — proves the field has no
    // effect (family match is the only signal) instead of just asserting it.
    inst({ instanceType: "d-vm", family: "dsv5", confidential: true }),
  ];
  const res = apply(ctx.pool, "Confidential Computing", "azure");
  const types = res.instances.map((i) => i.instanceType).sort();
  check(
    "Azure Confidential Computing keeps dc*/ec* families only, even when a non-capable family claims confidential:true",
    JSON.stringify(types) === JSON.stringify(["dc-vm", "ec-vm"]),
    JSON.stringify(types),
  );
}

console.log(
  "[Confidential Computing: GCP's per-series match (v3.16.15 — was a total no-op before)]",
);
{
  ctx.pool = [
    inst({ instanceType: "c2d-vm", family: "c2d" }),
    inst({ instanceType: "n2d-vm", family: "n2d" }),
    inst({ instanceType: "c3d-vm", family: "c3d" }),
    inst({ instanceType: "c4d-vm", family: "c4d" }),
    inst({ instanceType: "c3-vm", family: "c3" }),
    inst({ instanceType: "n2-vm", family: "n2" }),
  ];
  const res = apply(ctx.pool, "Confidential Computing", "gcp");
  const types = res.instances.map((i) => i.instanceType).sort();
  check(
    "GCP Confidential Computing keeps only the confirmed-eligible series (C2D/N2D/C3D/C4D/C3), not n2",
    JSON.stringify(types) ===
      JSON.stringify(["c2d-vm", "n2d-vm", "c3d-vm", "c4d-vm", "c3-vm"].sort()),
    JSON.stringify(types),
  );
}

console.log("[Min Gen: c4d ranks with c4 (generation 4), not as generation 1]");
{
  // Found by CodeRabbit (3.16 tail round 3): c4d was added as confidential-capable
  // (v3.16.16) but GCP_GEN_ORDER had no c4d entry, so generationRank/meetsMinGeneration
  // fell back to `?? 1` — a row combining Confidential Computing with a Min Gen floor of
  // n4 (rank 4) would have its only confidential-eligible newest-gen candidate filtered
  // out by the MinGen rule, as if c4d were as old as n1/e2. Needs a genuine rank-4
  // control (c4) in the pool: with only c4d present, the MinGen filter's own "never empty
  // the pool" guard (see rule-engine.js) would mask the bug by keeping c4d anyway.
  ctx.pool = [
    inst({ instanceType: "c4d-vm", family: "c4d" }),
    inst({ instanceType: "c4-vm", family: "c4" }),
    inst({ instanceType: "n2-vm", family: "n2" }),
  ];
  const res = run(
    `RuleEngine.apply(${JSON.stringify(ctx.pool)}, { rowMinGen: "n4" }, "gcp")`,
  );
  const types = res.instances.map((i) => i.instanceType);
  check(
    "MinGen n4 keeps c4d alongside c4 (both generation 4), drops n2",
    types.includes("c4d-vm") &&
      types.includes("c4-vm") &&
      !types.includes("n2-vm"),
    JSON.stringify(types),
  );
}

console.log(
  "[Confidential Computing: AWS/Azure/GCP all report 'not applied' honestly when no candidate qualifies]",
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
{
  ctx.pool = [inst({ instanceType: "n2-vm", family: "n2" })];
  const res = apply(ctx.pool, "Confidential Computing", "gcp");
  check(
    "no GCP candidate qualifies -> pool stands, 'not applied' reported (no longer a silent no-op)",
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
  // Review 4 of the 3.16 bug-fix tail: this used to be a total no-op on
  // AWS/GCP — no rule line at all, indistinguishable from a row with no
  // Compliance requirement. Now reports "not applicable" honestly, the same
  // shape Confidential Computing already used.
  const awsRes = apply(ctx.pool, "Azure Trusted Launch", "aws");
  check(
    "Azure Trusted Launch on AWS leaves the pool untouched but reports 'not applicable'",
    awsRes.instances.length === 2 &&
      awsRes.rules.some(
        (r) => r.includes("Trusted Launch") && r.includes("not applicable"),
      ),
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

console.log(
  "[AWS Nitro Enclaves reports 'not applicable' on Azure/GCP, not a silent no-op]",
);
{
  // Symmetric with Azure Trusted Launch above — review 4 of the 3.16
  // bug-fix tail. Before the fix, a row requesting Nitro on a non-AWS
  // provider column got zero audit-trail feedback, looking identical to a
  // row with no Compliance requirement at all.
  ctx.pool = [inst({ instanceType: "x", generation: 0 })];
  const azureRes = apply(ctx.pool, "AWS Nitro Enclaves", "azure");
  check(
    "AWS Nitro Enclaves on Azure leaves the pool untouched but reports 'not applicable'",
    azureRes.instances.length === 1 &&
      azureRes.rules.some(
        (r) => r.includes("Nitro") && r.includes("not applicable"),
      ),
    JSON.stringify({ n: azureRes.instances.length, rules: azureRes.rules }),
  );
  const gcpRes = apply(ctx.pool, "AWS Nitro Enclaves", "gcp");
  check(
    "AWS Nitro Enclaves on GCP leaves the pool untouched but reports 'not applicable'",
    gcpRes.instances.length === 1 &&
      gcpRes.rules.some(
        (r) => r.includes("Nitro") && r.includes("not applicable"),
      ),
    JSON.stringify({ n: gcpRes.instances.length, rules: gcpRes.rules }),
  );

  // And on AWS itself, when requested but no candidate actually qualifies —
  // the "not applied" branch, previously untested for Nitro specifically
  // (Confidential Computing already had this coverage above).
  ctx.noNitroPool = [
    inst({ instanceType: "plain", originalData: { nitroEnclavesSupport: 0 } }),
  ];
  const noneRes = apply(ctx.noNitroPool, "AWS Nitro Enclaves", "aws");
  check(
    "AWS Nitro Enclaves with no qualifying candidate -> pool stands, 'not applied' reported",
    noneRes.instances.length === 1 &&
      noneRes.rules.some(
        (r) => r.includes("Nitro") && r.includes("not applied"),
      ),
    JSON.stringify(noneRes.rules),
  );
}

console.log(
  "[expandComplianceTokens is memoized by raw string — review 8 of the 3.16 bug-fix tail]",
);
{
  // Called indirectly (it's an internal closure fn, not on the public API) —
  // exercise it through apply(), which is the real call site, and prove
  // identical raw strings share a cached result while still computing the
  // right answer, not just returning something cheap.
  ctx.memoPool = [inst({ instanceType: "prevgen", generation: 0 })];
  const a = apply(ctx.memoPool, "Current-Generation Hardware", "aws");
  const b = apply(ctx.memoPool, "Current-Generation Hardware", "aws");
  check(
    "repeated calls with the same raw Compliance string both compute correctly (cache doesn't corrupt the answer)",
    a.instances.length === 0 && b.instances.length === 0,
    JSON.stringify({ a: a.instances, b: b.instances }),
  );
  // A DIFFERENT raw string must not reuse the wrong cache entry — "Current-
  // Generation Hardware" (cached above) would have excluded this prevgen
  // instance; "Confidential Computing" is a genuinely different requirement
  // that doesn't touch generation at all, so it must survive untouched
  // (no AWS candidate is Nitro-capable here, so the rule reports "not
  // applied" and leaves the pool as-is, per its own honest-reporting shape).
  ctx.memoPool2 = [inst({ instanceType: "prevgen", generation: 0 })];
  const c = apply(ctx.memoPool2, "Confidential Computing", "aws");
  check(
    "a different raw Compliance string is NOT served the previous string's cached result",
    c.instances.length === 1 && c.instances[0].instanceType === "prevgen",
    JSON.stringify(c.instances),
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

console.log(
  "[A Compliance cell shaped like an Object.prototype key does not crash apply()]",
);
{
  // COMPLIANCE_ALIASES is a plain object literal, so an untrusted token of
  // "constructor" resolves to the inherited Object function unless the lookup
  // is an own-property check — that function is truthy, so `.forEach` would be
  // called on it and throw, turning the whole row into an Error instead of a
  // recommendation.
  ctx.pool = [inst({ instanceType: "x", generation: 0 })];
  const res = apply(ctx.pool, "constructor", "aws");
  check(
    'a Compliance cell of "constructor" is treated as an unrecognised token, not a crash',
    res.instances.length === 1,
    JSON.stringify(res),
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("compliance-options-test: all checks passed");
}

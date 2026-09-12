// The recognised-value list (RuleEngine.RECOGNIZED.workload, read by the
// upload-time hygiene check) is derived from ONE provider's table — aws,
// arbitrarily, since the workload keys are meant to be identical across
// providers. A key added to aws's WORKLOAD_FAMILIES and not azure/gcp's would
// make the hygiene check tell a user their Workload value is "recognised"
// while getPreferredFamilies silently falls through to that provider's
// "general" list for it — a lost preference with no warning, exactly the
// failure mode ROADMAP's item C calls out. This suite is the direct check:
// all three providers' key sets must be identical, every time a workload is
// added or renamed.
const { buildEngineContext } = require("../harness");

const { run } = buildEngineContext({
  scripts: ["src/core/rules/rule-engine.js"],
  label: "workload-vocabulary-parity",
});

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
};

console.log("[all three providers recognise exactly the same workload keys]");
{
  const keys = (p) =>
    run(`Object.keys(RuleEngine.WORKLOAD_FAMILIES.${p}).sort()`);
  const aws = keys("aws");
  const azure = keys("azure");
  const gcp = keys("gcp");

  check(
    "the scan found a realistic number of workload keys (guards against a broken lookup)",
    aws.length > 20,
    `only ${aws.length} aws keys found — RuleEngine.WORKLOAD_FAMILIES may not be exposed`,
  );
  check(
    "azure carries exactly the same keys as aws",
    JSON.stringify(azure) === JSON.stringify(aws),
    `aws-only: [${aws.filter((k) => !azure.includes(k))}] azure-only: [${azure.filter((k) => !aws.includes(k))}]`,
  );
  check(
    "gcp carries exactly the same keys as aws",
    JSON.stringify(gcp) === JSON.stringify(aws),
    `aws-only: [${aws.filter((k) => !gcp.includes(k))}] gcp-only: [${gcp.filter((k) => !aws.includes(k))}]`,
  );
}

console.log(
  "[RECOGNIZED.workload (the hygiene check's vocabulary) matches the actual table]",
);
{
  const recognized = run("RuleEngine.RECOGNIZED.workload.slice().sort()");
  const aws = run("Object.keys(RuleEngine.WORKLOAD_FAMILIES.aws).sort()");
  check(
    "RECOGNIZED.workload is exactly aws's key set — no drift between the two",
    JSON.stringify(recognized) === JSON.stringify(aws),
    `recognized-only: [${recognized.filter((k) => !aws.includes(k))}] table-only: [${aws.filter((k) => !recognized.includes(k))}]`,
  );
}

console.log(
  "[every new workload concept is a DIRECT key, not a coincidental cross-provider typo]",
);
{
  // The parity check above only proves the three providers agree with EACH
  // OTHER — a key misspelled identically on all three (e.g. "domain-
  // controller" with a hyphen) would still "match" while never matching what
  // the HTML dropdown's option value actually sends. This checks each new
  // concept is a real OWN property of the table, not inherited/coincidental,
  // on every provider — the exact string the dropdowns and CSV column use.
  const NEW_CONCEPTS = [
    "analytics",
    "spark",
    "big data",
    "file server",
    "file",
    "backup",
    "nosql",
    "search",
    "application server",
    "app server",
    "middleware",
    "container host",
    "container",
    "kubernetes",
    "build farm",
    "build",
    "ci/cd",
    "domain controller",
    "jump box",
    "jumpbox",
  ];
  for (const provider of ["aws", "azure", "gcp"]) {
    for (const concept of NEW_CONCEPTS) {
      const isOwn = run(
        `Object.prototype.hasOwnProperty.call(RuleEngine.WORKLOAD_FAMILIES.${provider}, ${JSON.stringify(concept)})`,
      );
      check(
        `${provider}: "${concept}" is a direct key in WORKLOAD_FAMILIES`,
        isOwn === true,
      );
    }
  }
}

console.log(
  "[Rule WL end to end: a new concept actually reorders the results]",
);
{
  const box = (instanceType, family, price) => ({
    instanceType,
    vCpus: 2,
    memory: 8,
    price,
    family,
    familyName: "General purpose",
    generation: 1,
    isGraviton: 0,
  });
  const pool = [
    box("c5.large", "c5", 0.1), // compute — matches "build farm"
    box("m5.large", "m5", 0.12), // general
  ];
  const res = run(
    `RuleEngine.apply(${JSON.stringify(pool)}, { rowWorkload: "Build Farm" }, "aws")`,
  );
  check(
    "Build Farm sorts the compute-family instance first",
    res.instances[0].instanceType === "c5.large",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
  check(
    "the rule names the workload it matched",
    res.rules.some((r) => /^Workload: build farm/.test(r)),
    JSON.stringify(res.rules),
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("workload-vocabulary-parity-test: all checks passed");
}

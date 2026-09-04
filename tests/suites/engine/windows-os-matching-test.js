// Windows-row detection was decided twice, by two different tests, and they
// disagreed. rule-engine.js's ARM exclusion matched `rowOS` EXACTLY against
// ["windows", "windows server"]; base-instance-selector.js's `_poolForOS`
// matched with a `/^windows/` PREFIX. A real-world value like "Windows Server
// 2022" satisfies the prefix but not the exact match, so the ARM exclusion
// silently failed to fire on exactly the strings _poolForOS was built to
// accept. On GCP this is not cosmetic: its Windows price is COMPOSED, never
// 0, so the ARM exclusion is the ONLY signal that a machine cannot run
// Windows — an ARM type could reach a Windows row that named its OS with any
// real-world Windows string other than the two bare tokens.
//
// Fixed by a single canonical `RuleEngine.isWindowsOS`, exposed on the public
// API and used at both call sites, so "what counts as Windows" is decided in
// exactly one place. `os-aware-pricing-test.js` loads rule-engine.js-free by
// design, so `_poolForOS` keeps a same-shaped fallback for that context —
// this suite pins the two call sites agree, not that either stops working
// standalone.
const { buildEngineContext } = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: ["js/base/rule-engine.js"],
  label: "windows-os-matching",
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
  instanceType: "m5.large",
  family: "m5",
  familyName: "General purpose",
  vCpus: 4,
  memory: 16,
  price: 0.1,
  generation: 1,
  isGraviton: 0,
  ...o,
});

console.log(
  "[RuleEngine.isWindowsOS accepts the same strings _poolForOS always has]",
);
{
  const WINDOWS_STRINGS = [
    "Windows",
    "windows",
    "WINDOWS",
    "windows server",
    "Windows Server",
    "Windows Server 2022",
    "Windows Server 2019",
    "windows 11",
  ];
  for (const s of WINDOWS_STRINGS) {
    ctx.probe = s;
    check(
      `isWindowsOS(${JSON.stringify(s)}) === true`,
      run("RuleEngine.isWindowsOS(probe)") === true,
    );
  }
  const NON_WINDOWS_STRINGS = ["Linux", "linux", "", "macOS", "mac", "RHEL"];
  for (const s of NON_WINDOWS_STRINGS) {
    ctx.probe = s;
    check(
      `isWindowsOS(${JSON.stringify(s)}) === false`,
      run("RuleEngine.isWindowsOS(probe)") === false,
    );
  }
}

console.log(
  "[the ARM exclusion fires on a real-world Windows string, not just the two bare tokens]",
);
{
  // Only "windows" and "windows server" pass an EXACT match — the bug this
  // suite exists to catch is that every other real-world Windows string used
  // to slip past the ARM exclusion entirely.
  ctx.pool = [
    inst({ instanceType: "t4g.large", family: "t4g", isGraviton: 1 }), // ARM: cannot run Windows
    inst({ instanceType: "m5.large", family: "m5", isGraviton: 0 }),
  ];
  const res = run(
    "RuleEngine.apply(pool, { rowOS: 'Windows Server 2022' }, 'aws')",
  );
  check(
    "an ARM type is excluded even though the OS string is not one of the two bare tokens",
    res.instances.length === 1 && res.instances[0].instanceType === "m5.large",
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
  check(
    "the rule is recorded as fired",
    res.rules.some((r) => r.startsWith("OS: ARM excluded (Windows)")),
    JSON.stringify(res.rules),
  );

  // The two bare tokens the old exact match already covered must keep working.
  const bare = run(
    "RuleEngine.apply(pool, { rowOS: 'windows server' }, 'aws')",
  );
  check(
    "the two originally-recognised tokens still exclude ARM",
    bare.instances.length === 1 &&
      bare.instances[0].instanceType === "m5.large",
    JSON.stringify(bare.instances.map((i) => i.instanceType)),
  );

  // A non-Windows OS must not trip the exclusion at all.
  const lin = run("RuleEngine.apply(pool, { rowOS: 'Linux' }, 'aws')");
  check(
    "Linux does not exclude the ARM type",
    lin.instances.length === 2,
    JSON.stringify(lin.instances.map((i) => i.instanceType)),
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("windows-os-matching-test: all checks passed");
}

// The rule engine's published API boundary (docs/data/RULE-ENGINE-API.md, 3.20)
// is a hand-written document describing RuleEngine's returned object — exactly
// the kind of second copy of a fact CANONICAL-SOURCES.md exists to catch when it
// drifts. This suite is what keeps the doc honest: every key RuleEngine actually
// returns must be mentioned in the doc (backtick-wrapped, not just anywhere in
// prose), and the version the doc's changelog claims as current must match what
// the module reports at runtime.
const fs = require("fs");
const path = require("path");
const { REPO, buildEngineContext, makeChecker } = require("../harness");

const { run } = buildEngineContext({
  scripts: ["src/core/rules/rule-engine.js"],
  label: "rule-engine-api-spec",
});

const { check, state } = makeChecker();

const specPath = path.join(REPO, "docs", "data", "RULE-ENGINE-API.md");
const spec = fs.readFileSync(specPath, "utf8");

// Matches the name as a whole word inside SOME backtick-delimited code span —
// a bare `` `name` ``, a function heading `` `name(...)` ``, or a qualified
// reference `` `RuleEngine.name` `` — not a bare mention in running prose,
// which would let a removed export's old text description count as "still
// documented."
function isBacktickDocumented(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("`[^`]*\\b" + escaped + "\\b[^`]*`");
  return re.test(spec);
}

console.log("[every key RuleEngine actually returns is documented]");
{
  const keys = run("Object.keys(RuleEngine).sort()");
  check(
    "the scan found a realistic number of exported keys (guards against a broken load)",
    keys.length > 10,
    `only ${keys.length} keys found — RuleEngine may not be exposed`,
  );
  for (const key of keys) {
    check(
      `"${key}" is documented in RULE-ENGINE-API.md`,
      isBacktickDocumented(key),
    );
  }
}

console.log("[the doc's changelog claims the version the module reports]");
{
  const runtimeVersion = run("RuleEngine.apiVersion");
  const rows = [...spec.matchAll(/^\|\s*(\d+\.\d+\.\d+)\s*\|/gm)];
  check(
    "the changelog table has at least one version row",
    rows.length > 0,
    "no `| X.Y.Z |` row found in the API changelog table",
  );
  const docVersions = rows.map((m) => m[1]);
  check(
    `the doc's newest changelog row (${docVersions[0]}) matches RuleEngine.apiVersion (${runtimeVersion})`,
    docVersions[0] === runtimeVersion,
  );
  check(
    "RuleEngine.apiVersion is a plain SemVer string",
    /^\d+\.\d+\.\d+$/.test(String(runtimeVersion)),
    `got ${JSON.stringify(runtimeVersion)}`,
  );
}

if (state.failures) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("rule-engine-api-spec-test: all checks passed");
}

// The rule engine's published API boundary (docs/data/RULE-ENGINE-API.md, 3.20)
// is a hand-written document describing RuleEngine's returned object — exactly
// the kind of second copy of a fact CANONICAL-SOURCES.md exists to catch when it
// drifts. This suite is what keeps the doc honest: every key RuleEngine actually
// returns must be backtick-documented within the doc's Stable/Internal surface
// sections specifically (not just mentioned anywhere in the file — see the
// surfaceText scoping below), and the version the doc's changelog claims as
// current must match what the module reports at runtime.
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

// Scoped to ONLY each member's own listing — a "### `name...`" heading (every
// Stable-surface member is one of these) or the Internal-surface's own
// comma-separated list line — not the surface sections' full prose. Matching
// the WHOLE document let a removed member still "pass" via an unrelated
// mention elsewhere (e.g. Data-shapes prose) — CodeRabbit caught this:
// removing the `RECOGNIZED` entry still passed because "Data shapes"
// mentions `RECOGNIZED.workload`. Scoping to just the two surface SECTIONS
// closes that, but not a narrower case one level in: `RECOGNIZED` is also
// name-dropped inside `WORKLOAD_FAMILIES`'s own paragraph, so scoping to
// "somewhere in the Stable surface section" alone would still miss removing
// `RECOGNIZED`'s own heading. Requiring the name to appear in a HEADING (or
// the internal list) closes that too — a sibling entry mentioning another
// member in passing no longer counts as documenting it.
const surfaceStart = spec.indexOf("## Stable surface");
const internalStart = spec.indexOf("## Internal surface");
const dataShapesStart = spec.indexOf("## Data shapes");
if (surfaceStart === -1 || internalStart === -1 || dataShapesStart === -1) {
  throw new Error(
    "rule-engine-api-spec-test: could not locate the Stable/Internal surface section boundaries in RULE-ENGINE-API.md — has a heading been renamed?",
  );
}
const stableSection = spec.slice(surfaceStart, internalStart);
const internalSection = spec.slice(internalStart, dataShapesStart);
const stableHeadings = [...stableSection.matchAll(/^###\s+(.+)$/gm)]
  .map((m) => m[1])
  .join("\n");
// The internal list is the one line in its section that OPENS with a
// backtick name (as opposed to the section's prose paragraphs).
const internalListLine =
  internalSection.split("\n").find((line) => /^`[^`]+`/.test(line)) || "";
const documentedText = stableHeadings + "\n" + internalListLine;

// Matches the name as a whole word inside SOME backtick-delimited code span
// within documentedText — a bare `` `name` ``, a function heading
// `` `name(...)` ``, or a qualified reference `` `RuleEngine.name` `` — not a
// bare mention in running prose, which would let a removed export's old text
// description count as "still documented."
function isBacktickDocumented(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("`[^`]*\\b" + escaped + "\\b[^`]*`");
  return re.test(documentedText);
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

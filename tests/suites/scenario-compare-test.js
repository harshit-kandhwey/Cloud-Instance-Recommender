// Scenario comparison verification (js/base/scenario-compare.js):
//   - diffScenarios pairs rows by VM Name (order-independent), falling back to
//     index when names are absent/duplicated
//   - detects changed recommendation cells and counts newly-matched /
//     newly-unmatched using the shared isNoMatchValue
//   - compares only the recommendation columns common to both runs
//   - notes differing row counts
// Uses the pure diff; the pin/render UI is thin DOM glue.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  document: { getElementById: () => null, addEventListener: () => {} },
};
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
const run = (expr) =>
  vm.runInContext(expr, ctx, { filename: "scenario-compare-test" });

load("js/base/app-core.js");
load("js/base/scenario-compare.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
}
const AWS = "AWS Like-to-Like Instance";
const AZ = "AZURE Like-to-Like Instance";

// ── Basic diff: one changed rec, one newly matched ─────────────────────────────
sandbox.A1 = {
  results: [
    { "VM Name": "web1", [AWS]: "m5.large" },
    { "VM Name": "db1", [AWS]: "No data available" },
  ],
};
sandbox.B1 = {
  results: [
    { "VM Name": "web1", [AWS]: "m6i.large" }, // changed
    { "VM Name": "db1", [AWS]: "r5.large" }, // newly matched
  ],
};
const d1 = run("diffScenarios(A1, B1)");
check(
  "compares the shared recommendation column",
  JSON.stringify(d1.cols) === JSON.stringify([AWS]),
  JSON.stringify(d1.cols),
);
check(
  "both rows report as changed",
  d1.summary.changedRows === 2,
  JSON.stringify(d1.summary),
);
check("newly-matched counted (db1)", d1.summary.newlyMatched === 1);
check("no newly-unmatched", d1.summary.newlyUnmatched === 0);
check(
  "match rate A→B (50% → 100%)",
  d1.summary.matchRateA === 50 && d1.summary.matchRateB === 100,
  `${d1.summary.matchRateA} ${d1.summary.matchRateB}`,
);
check(
  "changed cell carries both old and new values",
  d1.changedRows[0].key === "web1" &&
    d1.changedRows[0].cells[0].a === "m5.large" &&
    d1.changedRows[0].cells[0].b === "m6i.large" &&
    d1.changedRows[0].cells[0].changed === true,
  JSON.stringify(d1.changedRows[0]),
);

// ── Pairs by VM Name regardless of row order ───────────────────────────────────
sandbox.A2 = {
  results: [
    { "VM Name": "a", [AWS]: "m5.large" },
    { "VM Name": "b", [AWS]: "c5.large" },
  ],
};
sandbox.B2 = {
  results: [
    { "VM Name": "b", [AWS]: "c5.large" }, // same (reversed order)
    { "VM Name": "a", [AWS]: "m6i.large" }, // changed
  ],
};
const d2 = run("diffScenarios(A2, B2)");
check(
  "name-pairing is order-independent (only 'a' changed)",
  d2.summary.changedRows === 1 && d2.changedRows[0].key === "a",
  JSON.stringify(d2.changedRows.map((r) => r.key)),
);

// ── Falls back to index pairing when VM Names are absent ───────────────────────
sandbox.A3 = { results: [{ [AWS]: "m5.large" }, { [AWS]: "c5.large" }] };
sandbox.B3 = { results: [{ [AWS]: "m5.large" }, { [AWS]: "c6i.large" }] };
const d3 = run("diffScenarios(A3, B3)");
check(
  "index pairing works without VM Name (row 2 changed)",
  d3.summary.changedRows === 1 && d3.changedRows[0].key === "Row 2",
  JSON.stringify(d3.changedRows.map((r) => r.key)),
);

// ── Falls back to index pairing when VM Names are duplicated ───────────────────
sandbox.A3b = {
  results: [
    { "VM Name": "dup", [AWS]: "m5.large" },
    { "VM Name": "dup", [AWS]: "c5.large" },
  ],
};
sandbox.B3b = {
  results: [
    { "VM Name": "dup", [AWS]: "m5.large" },
    { "VM Name": "dup", [AWS]: "c6i.large" },
  ],
};
const d3b = run("diffScenarios(A3b, B3b)");
check(
  "duplicate VM Names fall back to index pairing (only row 2 changed)",
  d3b.summary.changedRows === 1 && d3b.pairedRows === 2,
  JSON.stringify(d3b.summary),
);

// ── Differing row counts → note + compares the overlap ─────────────────────────
sandbox.A4 = {
  results: [
    { "VM Name": "x", [AWS]: "m5.large" },
    { "VM Name": "y", [AWS]: "c5.large" },
  ],
};
sandbox.B4 = { results: [{ "VM Name": "x", [AWS]: "m5.large" }] };
const d4 = run("diffScenarios(A4, B4)");
check(
  "differing row counts noted and only overlap compared",
  /only one run|different row counts/i.test(d4.note) && d4.pairedRows === 1,
  `note="${d4.note}" paired=${d4.pairedRows}`,
);

// ── No changes → empty changed list, equal match rates ─────────────────────────
sandbox.A5 = { results: [{ "VM Name": "x", [AWS]: "m5.large" }] };
sandbox.B5 = { results: [{ "VM Name": "x", [AWS]: "m5.large" }] };
const d5 = run("diffScenarios(A5, B5)");
check(
  "identical runs report no changes",
  d5.summary.changedRows === 0 &&
    d5.summary.newlyMatched === 0 &&
    d5.summary.newlyUnmatched === 0,
  JSON.stringify(d5.summary),
);

// ── Only columns common to both runs are compared ──────────────────────────────
sandbox.A6 = {
  results: [{ "VM Name": "x", [AWS]: "m5.large", [AZ]: "D2s_v5" }],
};
sandbox.B6 = { results: [{ "VM Name": "x", [AWS]: "m6i.large" }] };
const d6 = run("diffScenarios(A6, B6)");
check(
  "intersects recommendation columns (AWS only)",
  JSON.stringify(d6.cols) === JSON.stringify([AWS]),
  JSON.stringify(d6.cols),
);

// ── newly-unmatched counted when B regresses ───────────────────────────────────
sandbox.A7 = { results: [{ "VM Name": "x", [AWS]: "m5.large" }] };
sandbox.B7 = { results: [{ "VM Name": "x", [AWS]: "No data available" }] };
const d7 = run("diffScenarios(A7, B7)");
check(
  "newly-unmatched counted when a match regresses",
  d7.summary.newlyUnmatched === 1 && d7.summary.newlyMatched === 0,
  JSON.stringify(d7.summary),
);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("scenario-compare-test: all checks passed");

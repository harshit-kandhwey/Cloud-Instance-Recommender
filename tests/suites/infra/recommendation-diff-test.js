// recommendation-diff suite: pins tools/recommendation-diff.js's pure comparison —
// which result columns count as a "pick" (identity, not its spec consequences), that a
// changed pick between old and new engine runs is reported as a flip while a changed
// spec column is NOT, VM appear/disappear, and the FLIPS/NONE sentinel. The engine-run
// and disk loaders are impure and exercised live (they reproduce the goldens from
// injected data); here the diff over result-row shapes is unit-tested. Inputs are result
// rows shaped like the golden CSV columns, built inline.
const fs = require("fs");
const path = require("path");
const { makeChecker } = require("../harness");
const {
  recommendationColumns,
  diffScenario,
  renderReport,
  selectScenarios,
  SINGLE_PROVIDERS,
} = require("../../../tools/recommendation-diff");
const { SCENARIOS } = require("../../golden/golden-run");

const { check, state } = makeChecker();

// ── recommendationColumns: pick-identity columns only ────────────────────────────
{
  const cols = recommendationColumns([
    "VM Name",
    "AWS Like-to-Like Instance",
    "AWS Like-to-Like vCPUs",
    "AWS Like-to-Like Memory (GiB)",
    "AWS Optimized Instance",
    "AWS Most Cost Optimized",
    "AWS Workload Based",
    "AWS Newest Generation",
    "GCP Custom Fit",
  ]).sort();
  check(
    "pick columns are the instance/summary picks, not spec or input columns",
    cols.join("|") ===
      [
        "AWS Like-to-Like Instance",
        "AWS Most Cost Optimized",
        "AWS Newest Generation",
        "AWS Optimized Instance",
        "AWS Workload Based",
        "GCP Custom Fit",
      ].join("|"),
    cols.join("|"),
  );
}

// ── diffScenario: a changed pick is a flip; a changed spec column is NOT ───────────
{
  const oldR = [
    {
      "VM Name": "web-01",
      "AWS Like-to-Like Instance": "m6g.large",
      "AWS Like-to-Like vCPUs": 2,
      "AWS Most Cost Optimized": "m6g.large (2/8)",
    },
    {
      "VM Name": "gone-02",
      "AWS Like-to-Like Instance": "t3.small",
      "AWS Most Cost Optimized": "t3.small (2/2)",
    },
  ];
  const newR = [
    {
      "VM Name": "web-01",
      "AWS Like-to-Like Instance": "m6g.large", // unchanged pick
      "AWS Like-to-Like vCPUs": 4, // spec moved — must NOT count as a flip
      "AWS Most Cost Optimized": "m7g.large (2/8)", // cost pick flipped
    },
    // gone-02 absent on the new side
  ];
  const flips = diffScenario(oldR, newR);

  // Guard A (plant-RED: compare ALL columns, or skip the pick compare): exactly the
  // cost-optimized pick flipped for web-01, and the vCPUs spec move did NOT register.
  const webFlips = flips.filter((f) => f.vm === "web-01");
  check(
    "a changed pick is a flip; a changed spec column is not",
    webFlips.length === 1 &&
      webFlips[0].column === "AWS Most Cost Optimized" &&
      webFlips[0].from === "m6g.large (2/8)" &&
      webFlips[0].to === "m7g.large (2/8)",
    JSON.stringify(webFlips),
  );
  check(
    "a VM present on only one side is reported as appear/disappear",
    flips.some(
      (f) => f.vm === "gone-02" && f.column === "(row)" && f.to === "(absent)",
    ),
    JSON.stringify(flips),
  );
}

// ── diffScenario: identical runs produce no flips ────────────────────────────────
{
  const rows = [
    {
      "VM Name": "a",
      "AWS Like-to-Like Instance": "m6g.large",
      "AWS Most Cost Optimized": "m6g.large (2/8)",
    },
  ];
  check(
    "identical old/new runs flip nothing",
    diffScenario(rows, JSON.parse(JSON.stringify(rows))).length === 0,
  );
}

// ── renderReport: FLIPS/NONE sentinel ────────────────────────────────────────────
{
  const none = renderReport([{ file: "aws-l2l.csv", flips: [] }]);
  const flipped = renderReport([
    {
      file: "aws-l2l.csv",
      flips: [
        {
          vm: "web-01",
          column: "AWS Most Cost Optimized",
          from: "m6g.large (2/8)",
          to: "m7g.large (2/8)",
        },
      ],
    },
  ]);
  // Guard B (plant-RED: hardcode one sentinel, or invert the test): NONE with no flips,
  // FLIPS when a pick moved, and the flipped report names the VM and both picks.
  check(
    "sentinel: NONE when nothing flipped, FLIPS when a pick moved",
    none.startsWith("<!-- rec-flips: NONE -->") &&
      flipped.startsWith("<!-- rec-flips: FLIPS -->") &&
      flipped.includes("web-01") &&
      flipped.includes("m6g.large (2/8) → m7g.large (2/8)"),
    JSON.stringify({
      none: none.split("\n")[0],
      flipped: flipped.split("\n")[0],
    }),
  );
}

// ── selectScenarios: --provider never silently selects nothing ───────────────────
{
  check(
    "no --provider runs every golden scenario",
    SCENARIOS.length > 0 &&
      selectScenarios(undefined).length === SCENARIOS.length,
    `${selectScenarios(undefined).length}/${SCENARIOS.length}`,
  );

  const aws = selectScenarios("aws");
  check(
    "--provider aws selects only the single-provider aws scenarios",
    aws.length > 0 &&
      aws.every((s) => s.providers.length === 1 && s.providers[0] === "aws"),
    JSON.stringify(aws.map((s) => s.file)),
  );

  // Guard C (plant-RED: drop the throw so the filter returns []): an unrecognised
  // provider must fail loudly. An empty scenario list runs no comparison at all yet
  // renders the NONE sentinel at exit 0 — the workflow then reads "this refresh
  // flipped no recommendation" for a check that never happened.
  let msg = "";
  try {
    selectScenarios("awss");
  } catch (e) {
    msg = e.message;
  }
  check(
    "an unknown --provider throws instead of reporting a false NONE",
    msg.includes("unknown --provider awss") &&
      SINGLE_PROVIDERS.every((p) => msg.includes(p)),
    msg || "(did not throw)",
  );

  // A multi-provider scenario's name is not a --provider value: the flag selects
  // single-provider runs only, so the accepted set must match what those name.
  const expected = [
    ...new Set(
      SCENARIOS.filter((s) => s.providers.length === 1).map(
        (s) => s.providers[0],
      ),
    ),
  ].sort();
  check(
    "SINGLE_PROVIDERS is exactly what the single-provider scenarios name",
    SINGLE_PROVIDERS.join(",") === expected.join(","),
    SINGLE_PROVIDERS.join(","),
  );
}

// ── The old side comes from the shared loader, never a private copy ─────────────
// Structural, because the defect was structural: this tool carried its own
// regions-directory loader that nobody kept in step with data-diff's, so the
// missing-assignment guard added to one never reached the other. Sharing the loader
// is the fix; a second readdirSync here would be the drift coming back.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "tools", "recommendation-diff.js"),
    "utf8",
  );
  // Strip line comments first: a check that matches prose reports on documentation,
  // not on code. Match the CALL.
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  check(
    "recommendation-diff reads the old side through the shared loader",
    // Match the CALL, not the symbol: an `includes` passes on the leftover require
    // line alone, so deleting the call while keeping the import — the exact shape a
    // private-loader regression takes — would slip straight through this guard.
    /loadCommittedRegions\s*\(/.test(code) && !/readdirSync\s*\(/.test(code),
    // Detail prints only on failure, so the else-branch is not "all good" — it is
    // the other way this check can fail: the shared loader is gone entirely.
    /readdirSync\s*\(/.test(code)
      ? "has its own readdirSync"
      : "no loadCommittedRegions call",
  );
}

if (state.failures) {
  console.error(`\nrecommendation-diff: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nrecommendation-diff: all checks passed");
  process.exitCode = 0;
}

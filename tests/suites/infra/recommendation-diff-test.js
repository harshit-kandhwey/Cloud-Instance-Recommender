// recommendation-diff suite: pins tools/recommendation-diff.js's pure comparison —
// which result columns count as a "pick" (identity, not its spec consequences), that a
// changed pick between old and new engine runs is reported as a flip while a changed
// spec column is NOT, VM appear/disappear, and the FLIPS/NONE sentinel. The engine-run
// and disk loaders are impure and exercised live (they reproduce the goldens from
// injected data); here the diff over result-row shapes is unit-tested. Inputs are result
// rows shaped like the golden CSV columns, built inline.
const { makeChecker } = require("../harness");
const {
  recommendationColumns,
  diffScenario,
  renderReport,
} = require("../../../tools/recommendation-diff");

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

if (state.failures) {
  console.error(`\nrecommendation-diff: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nrecommendation-diff: all checks passed");
  process.exitCode = 0;
}

// report-text suite: strings a vendor feed supplies are text in a pull-request body.
// The refresh reports interpolated instance types, families, regions and spec values
// straight into Markdown that becomes the body of an automated PR, so a feed entry
// carrying a line break could forge a heading or a list item, `@name` notified a
// person, `#123` linked an issue, `[x](url)` made a link a reviewer might click, and
// a long value pushed the real content out of the body's size budget. Covered: the
// helper's table, that ordinary names are untouched, and each of the three renderers
// with a hostile value in every field it prints.
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { reportText } = require(path.join(REPO, "scripts/lib/build-env.js"));
const { renderProvider, renderUnpriced } = require(
  path.join(REPO, "scripts/data/data-diff.js"),
);
const { renderProviderReport } = require(
  path.join(REPO, "scripts/data/reconcile-data.js"),
);
const { renderReport: renderFlips } = require(
  path.join(REPO, "scripts/data/recommendation-diff.js"),
);

const ZW = "​";

// ── the helper ───────────────────────────────────────────────────────────────────
for (const plain of [
  "m5.large",
  "Standard_D2s_v5",
  "us-east-1",
  "General purpose",
  "0.0416",
  "n2-standard-4",
  "us_east_1",
  "m5.large@us_east1.vCpus",
  "a#b",
]) {
  check(`an ordinary name is unchanged: ${plain}`, reportText(plain) === plain);
}
check(
  "a number is its digits",
  reportText(0.0416) === "0.0416" && reportText(5) === "5",
);
check(
  "a missing value is empty",
  reportText(null) === "" && reportText(undefined) === "",
);
check(
  "runs of spaces, including non-breaking ones, collapse to one",
  reportText("a \u00a0  b") === "a b",
  JSON.stringify(reportText("a \u00a0  b")),
);
check(
  "line breaks cannot start a new line of the report",
  !/[\n\r]/.test(reportText("a\n## Heading\r\n- item")) &&
    reportText("a\n## Heading") === "a ## Heading",
  JSON.stringify(reportText("a\n## Heading")),
);
check(
  "a mention is broken, so nobody is notified",
  !/@\w/.test(reportText("hello @octocat and @org/team")),
  JSON.stringify(reportText("hello @octocat")),
);
check(
  "an issue reference is broken, so nothing is linked",
  !/#\w/.test(reportText("fixes #123")),
  JSON.stringify(reportText("fixes #123")),
);
check(
  "link and table delimiters are escaped",
  reportText("[x](y)") === "\\[x\\](y)" && reportText("a|b") === "a\\|b",
  `${reportText("[x](y)")} ${reportText("a|b")}`,
);
check(
  "a bare URL is not auto-linked",
  !reportText("see https://evil.example/x").includes("://") &&
    reportText("see https://evil.example/x").includes(`:${ZW}//`),
);
check(
  "HTML is inert and a backtick cannot close a code span",
  reportText("<img src=x onerror=1>") === "&lt;img src=x onerror=1&gt;" &&
    !reportText("a`b").includes("`"),
);
check(
  "length is capped, with an ellipsis",
  reportText("x".repeat(500)).length === 120 &&
    reportText("x".repeat(500)).endsWith("…"),
);

// ── the three renderers ──────────────────────────────────────────────────────────
const HOSTILE = "evil\n## Forged @octocat #1 [a](https://x.example) <b>";
const clean = (text) =>
  !text.includes("\n## Forged") &&
  !text.includes("[a](") &&
  !text.includes("<b>") &&
  !/@octocat/.test(text) &&
  !/#1\b/.test(text) &&
  !text.includes("https://");

{
  const d = {
    provider: "aws",
    totalRegions: 3,
    regionsAdded: [HOSTILE],
    regionsRemoved: [HOSTILE],
    familiesAdded: [HOSTILE],
    familiesRemoved: [HOSTILE],
    typesAdded: [{ type: HOSTILE, family: HOSTILE, regions: 1 }],
    typesRemoved: [{ type: HOSTILE, family: HOSTILE, regions: 1 }],
    specChanges: [
      { type: HOSTILE, field: HOSTILE, old: HOSTILE, new: HOSTILE },
    ],
    priceChanges: [
      {
        type: HOSTILE,
        field: HOSTILE,
        regionsChanged: 1,
        minPct: 1,
        maxPct: 2,
        sample: { region: HOSTILE, old: HOSTILE, new: HOSTILE, pct: 1 },
      },
    ],
    unpriced: [],
  };
  const out = renderProvider(d);
  check(
    "the diff renderer prints hostile values from every field safely",
    clean(out) && out.includes("evil"),
    out.slice(0, 300),
  );
  const un = renderUnpriced([
    {
      provider: "aws",
      unpriced: [
        { type: HOSTILE, family: HOSTILE, regions: [HOSTILE], pricedIn: 1 },
      ],
    },
  ]);
  check(
    "the unpriced section prints them safely too",
    un !== null && clean(un) && un.includes("evil"),
    String(un).slice(0, 300),
  );
  check(
    "the report keeps its own line structure",
    out.split("\n").filter((l) => /^### /.test(l)).length === 1,
    out
      .split("\n")
      .filter((l) => /^### /.test(l))
      .join(" | "),
  );
}

{
  const out = renderProviderReport({
    provider: "aws",
    typesVerified: 1,
    priceFieldsUpdated: 0,
    specsUnverified: false,
    specFieldsUpdated: 0,
    specConflicts: [
      { type: HOSTILE, field: HOSTILE, vantage: HOSTILE, official: HOSTILE },
    ],
    unverifiedPrices: [HOSTILE],
    nonFiniteOfficialSpecs: [HOSTILE],
  });
  check(
    "the reconcile report prints hostile values safely",
    clean(out) && out.includes("evil"),
    out.slice(0, 300),
  );
}

{
  const out = renderFlips([
    {
      file: "aws-l2l.csv",
      flips: [{ vm: HOSTILE, column: HOSTILE, from: HOSTILE, to: HOSTILE }],
    },
  ]);
  check(
    "the recommendation-flip report prints hostile values safely",
    clean(out) && out.includes("evil"),
    out.slice(0, 300),
  );
  check(
    "and its machine-readable sentinel is intact",
    out.startsWith("<!-- rec-flips: FLIPS -->"),
  );
}

if (state.failures) {
  console.error(`\nreport-text: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nreport-text: all checks passed");
  process.exitCode = 0;
}

// The stats bar's relative-only price line (CLAUDE.md rule 7, reversed
// 2026-09-14). `results.priceSavings` is set by the engine on the ARRAY, so
// this reads it straight off a synthetic `rows` array — no data/selector
// setup needed, unlike the engine-level computation test
// (tests/suites/engine/price-savings-test.js).
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const row = () => ({
  "VM Name": "a",
  "CPU Count": "4",
  "Memory (GB)": "16",
  "AWS Like-to-Like Instance": "m5.xlarge",
  "AWS Optimized Instance": "t3.large",
});

console.log("[a downsize shows a 'lower' line with the row count]");
{
  const { ctx } = buildContext();
  const rows = [row()];
  rows.priceSavings = { AWS: { pct: 18, rows: 1 } };
  const html = ctx._buildStatsHtml(rows);
  check(
    "shows the percentage and direction",
    /AWS Optimized ranks <strong>~18% lower than<\/strong> Like-to-Like/.test(
      html,
    ),
    html,
  );
  check("shows the row count it covers", /\(1 row\)/.test(html), html);
  check(
    "carries the disclaimer as a title attribute, not just implied",
    /not a quote/.test(html),
    html,
  );
}

console.log("[an upsize shows a 'higher' line]");
{
  const { ctx } = buildContext();
  const rows = [row()];
  rows.priceSavings = { AWS: { pct: -7, rows: 3 } };
  const html = ctx._buildStatsHtml(rows);
  check(
    "shows the magnitude with 'higher', not a bare negative number",
    /AWS Optimized ranks <strong>~7% higher than<\/strong> Like-to-Like/.test(
      html,
    ),
    html,
  );
  check("plural row count", /\(3 rows\)/.test(html), html);
}

console.log("[an identical result reports 'the same', not '0% lower']");
{
  const { ctx } = buildContext();
  const rows = [row()];
  rows.priceSavings = { AWS: { pct: 0, rows: 2 } };
  const html = ctx._buildStatsHtml(rows);
  check(
    "shows 'the same' rather than a fabricated 0% saving",
    /AWS Optimized ranks <strong>the same as<\/strong> Like-to-Like/.test(html),
    html,
  );
}

console.log("[no priceSavings on the array -> no price line at all]");
{
  const { ctx } = buildContext();
  const rows = [row()]; // no .priceSavings attached
  const html = ctx._buildStatsHtml(rows);
  check(
    "the price line is absent, not fabricated as 0%",
    !/Optimized ranks/.test(html),
    html,
  );
}

process.exitCode = state.failures ? 1 : 0;

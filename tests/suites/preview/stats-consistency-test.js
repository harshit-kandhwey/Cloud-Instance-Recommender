// The stats bar and the no-match-only view describe the SAME rows, so their
// accounting of "no match" must agree — one shared predicate, not two guesses.
// The case that separates them is a result set with NO recommendation columns:
// the no-match view (rowIsAllNoMatch) treats none of those rows as unmatched, so
// the stats bar must not turn around and count every one of them as "no match".
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const matched = (name) => ({
  "VM Name": name,
  "CPU Count": "4",
  "Memory (GB)": "16",
  "AWS Like-to-Like Instance": "m5.xlarge",
  "AWS Optimized Instance": "t3.large",
});
const noMatch = (name) => ({
  "VM Name": name,
  "CPU Count": "999",
  "Memory (GB)": "9999",
  "AWS Like-to-Like Instance": "No Match",
  "AWS Optimized Instance": "No Match",
});
// A result set with only input columns — no recommendation columns at all.
const noRecCols = (name) => ({
  "VM Name": name,
  "CPU Count": "4",
  "Memory (GB)": "16",
});

const statNoMatch = (html) =>
  Number(html.match(/✗ <strong>(\d+)<\/strong> no match/)?.[1] ?? 0);
const statMatched = (html) =>
  Number(html.match(/✓ <strong>(\d+)<\/strong> matched/)?.[1] ?? -1);
// How many rows the no-match-only view would keep, via the shared predicate.
const noMatchViewCount = (ctx, rows) => {
  const cols = ctx.getInstanceColumns(rows);
  return rows.filter((r) => ctx.rowIsAllNoMatch(r, cols)).length;
};

console.log("[with recommendation columns, the two agree]");
{
  const { ctx } = buildContext();
  const rows = [
    matched("web-01"),
    noMatch("huge-01"),
    matched("web-02"),
    noMatch("huge-02"),
  ];
  const html = ctx._buildStatsHtml(rows);
  check(
    "stats 'no match' count equals the no-match view's count",
    statNoMatch(html) === noMatchViewCount(ctx, rows) &&
      statNoMatch(html) === 2,
    `stats=${statNoMatch(html)} view=${noMatchViewCount(ctx, rows)}`,
  );
  check("and matched is the remainder", statMatched(html) === 2, html);
}

console.log("[with NO recommendation columns, neither counts a no-match]");
{
  const { ctx } = buildContext();
  const rows = [noRecCols("a"), noRecCols("b"), noRecCols("c")];
  const html = ctx._buildStatsHtml(rows);
  // The no-match view shows none of these — so the stats bar must not claim any.
  check(
    "the no-match view keeps none of them",
    noMatchViewCount(ctx, rows) === 0,
  );
  check(
    "the stats bar does not report them as no-match",
    statNoMatch(html) === 0,
    `stats reported ${statNoMatch(html)} no-match (view says 0)`,
  );
  check(
    "and it does not falsely report them all as matched either",
    // Reject ANY positive matched count, not just the exact "3": a neutral state
    // that leaked "1"/"2 matched" would slip past a hardcoded-3 check.
    !/✓ <strong>[1-9]\d*<\/strong> matched/.test(html),
    html,
  );
  check(
    "it shows a neutral 'no recommendation columns' state instead",
    /No recommendation columns/i.test(html),
    html,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

// "Current Instance Type": the size a VM runs on today. It is recognised, it
// survives untouched into the results and exports, and it lands beside the
// recommendation so the two can be read against each other.
//
// It must NOT change sizing: CPU Count and Memory (GB) still drive that. The day
// it does is 4.0 (cloud-to-cloud), and it should be a deliberate change, not a
// drift.
const vm = require("vm");
const { buildContext, makeChecker, rowsOf, parse } = require("../harness");

const CURRENT = "Current Instance Type";
const { check, state } = makeChecker();
const ingest = parse;
const rows = rowsOf;

console.log("[the column is recognised, however it is spelled]");
{
  const { ctx } = buildContext();
  const mapped = (header) =>
    vm.runInContext(
      `autoMatchHeaders(["VM Name","CPU Count","Memory (GB)",${JSON.stringify(header)}]).mapping[${JSON.stringify(header)}]`,
      ctx,
    );
  for (const header of [
    "Current Instance Type",
    "Instance Type",
    "VM Size",
    "Machine Type",
    "Current Size",
  ]) {
    check(
      `"${header}" maps to ${CURRENT}`,
      mapped(header) === CURRENT,
      mapped(header),
    );
  }
  // Deliberately not claimed: these mean too many things in a real export.
  for (const header of ["Size", "Type", "SKU"]) {
    check(
      `"${header}" is NOT claimed — too ambiguous to guess`,
      mapped(header) === undefined,
      mapped(header),
    );
  }
}

console.log("[it survives into the results untouched]");
{
  const { ctx } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),Instance Type,AWS Region
web-01,4,16,m5.xlarge,us-east-1
db-02,8,32,r5.2xlarge,us-east-1`,
  );
  check(
    "the header is mapped to the canonical name",
    rows(ctx)[0][CURRENT] === "m5.xlarge",
    JSON.stringify(rows(ctx)[0]),
  );
  check(
    "and the value is carried verbatim, not normalised or parsed",
    rows(ctx)[1][CURRENT] === "r5.2xlarge",
    JSON.stringify(rows(ctx)[1]),
  );
}

console.log("[the preview puts it next to the recommendation]");
{
  const builtElements = buildContext();
  const { ctx } = builtElements;
  // ENV/OS/Workload/Compliance must be present, or the adjacency claim is
  // untestable: with nothing to sit between, the column is adjacent wherever it
  // is listed, and the check passes without checking anything.
  const results = [
    {
      "VM Name": "web-01",
      "CPU Count": "4",
      "Memory (GB)": "16",
      ENV: "Production",
      OS: "Linux",
      Workload: "Web Server",
      Compliance: "PCI",
      [CURRENT]: "m5.xlarge",
      "AWS Like-to-Like Instance": "m5.xlarge",
      "AWS Optimized Instance": "t3.large",
    },
  ];
  // Drive the real entry point, so the column order under test is the one the
  // page actually renders — not one an internal signature happened to accept.
  const { elements } = builtElements;
  ctx.showResultsPreview(results);
  const shown = elements.resultsPreviewSection.innerHTML;

  // Read the header row back as a list. A "does it appear before" check would
  // pass with any number of columns wedged in between, which is not the claim.
  const headers = [...shown.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, "").trim())
    .filter(Boolean);
  const iCurrent = headers.findIndex((h) => h.startsWith(CURRENT));
  const iFirstInstance = headers.findIndex((h) =>
    h.startsWith("AWS Like-to-Like Instance"),
  );

  check("the column is shown at all", iCurrent !== -1, headers.join(" | "));
  check(
    "and IMMEDIATELY left of the recommended instances, nothing between",
    iCurrent !== -1 && iFirstInstance === iCurrent + 1,
    headers.join(" | "),
  );
  check("with its value in the row", shown.includes("m5.xlarge"));
}

console.log(
  "[it is an input, not an outcome — the no-match highlight survives]",
);
{
  // The preview marks a row as "no match" when EVERY recommended-instance column
  // is a no-match placeholder. A predicate of "any column containing Instance"
  // also swallows this input column — whose value is a real instance name and so
  // is never a placeholder — which makes "every one is a no match" almost never
  // true, and silently disables the highlight on genuinely unmatched rows.
  const { ctx, elements } = buildContext();
  const NO_MATCH = "No Match";
  const results = [
    {
      "VM Name": "unmatchable",
      "CPU Count": "999",
      "Memory (GB)": "9999",
      [CURRENT]: "m5.xlarge", // a real size — never a placeholder
      "AWS Like-to-Like Instance": NO_MATCH,
      "AWS Optimized Instance": NO_MATCH,
      "AWS No Match Reason": "Nothing that large",
    },
  ];
  ctx.showResultsPreview(results);
  const shown = elements.resultsPreviewSection.innerHTML;

  // The highlight is the danger background on the row.
  check(
    "a row whose every RECOMMENDATION is a no match is still highlighted as one",
    shown.includes("var(--danger-bg-soft)"),
    shown.slice(0, 500),
  );
}

// The central invariant, tested against the ENGINE. Asserting that parseCSV
// leaves CPU and memory alone proves nothing about sizing — only running the
// recommendation and comparing its output can catch this column leaking into
// the decision, which is the exact regression this file exists to guard.
(async () => {
  console.log("[it does not change what is recommended]");

  // Identical CPU and memory; current sizes at opposite extremes of the range.
  const { ctx } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),Current Instance Type,AWS Region
same-a,4,16,t3.nano,us-east-1
same-b,4,16,x1e.32xlarge,us-east-1`,
  );

  const results = await ctx.getInstanceRecommendationWithSelector(
    rows(ctx),
    ["aws"],
    {},
  );
  const [a, b] = results;
  const instanceCols = Object.keys(a || {}).filter(
    (k) =>
      k.includes("Like-to-Like Instance") || k.includes("Optimized Instance"),
  );

  check(
    "the engine ran and produced recommendations to compare",
    results.length === 2 && instanceCols.length > 0,
    JSON.stringify(Object.keys(a || {})),
  );
  check(
    "the two rows really did differ in what they run on today",
    a && b && a[CURRENT] === "t3.nano" && b[CURRENT] === "x1e.32xlarge",
    `${a && a[CURRENT]} / ${b && b[CURRENT]}`,
  );
  check(
    "identical demand gets identical recommendations, whatever it runs on today",
    a &&
      b &&
      instanceCols.length > 0 &&
      instanceCols.every((c) => a[c] === b[c]),
    instanceCols.map((c) => `${c}: ${a && a[c]} vs ${b && b[c]}`).join(" | "),
  );

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

// reserved-columns suite: the engine owns the names of the columns it writes, and an
// uploaded column carrying one of them must not reach the results. Before 3.22 a row
// was copied wholesale into its result, so a re-uploaded earlier export put a stale
// "AWS Like-to-Like vCPUs" next to this run's output and the savings figures were
// computed against it, with no error. Covered: the name predicate, that it covers
// every column the factory source writes (a scan, so a new output column cannot be
// added unreserved), the run itself, the savings figure, and the notice an upload gets.
const fs = require("fs");
const path = require("path");
const {
  REPO,
  buildEngineContext,
  buildContext,
  makeChecker,
} = require("../harness");

const { check, state } = makeChecker();

const ENGINE_SCRIPTS = [
  "src/shared/storage-keys.js",
  "src/core/rules/rule-engine.js",
  "src/core/engine/base-instance-selector.js",
  "src/providers/aws/aws-instance-selector.js",
  "src/core/engine/instance-selector-factory.js",
  "src/shared/app-core.js",
];

// ── the predicate ───────────────────────────────────────────────────────────────
{
  const { run } = buildEngineContext({
    scripts: ENGINE_SCRIPTS,
    label: "reserved-columns",
  });
  const reserved = (name) =>
    run(`isEngineOutputColumn(${JSON.stringify(name)})`);

  for (const name of [
    "AWS Like-to-Like Instance",
    "AZURE Optimized vCPUs",
    "GCP Rules Applied",
    "AWS Nearest Miss",
    "Review Flag",
    "Sized On",
    "Sized From",
    "Family Equivalence",
    "GCP Custom Fit",
  ]) {
    check(`"${name}" is reserved`, reserved(name) === true);
  }
  check(
    "a header that merely contains a name other modules match by substring is reserved",
    reserved("Old AWS Like-to-Like Instance (2024)") === true &&
      reserved("Notes: Rules Applied") === true,
  );
  for (const name of [
    "VM Name",
    "CPU Count",
    "Memory (GB)",
    "Workload",
    "Owner Email",
    "Sized by",
    "AWS Region",
  ]) {
    check(`"${name}" is an ordinary input column`, reserved(name) === false);
  }

  // The scan must see the thing before its verdict means anything.
  const source = fs.readFileSync(
    path.join(REPO, "src/core/engine/instance-selector-factory.js"),
    "utf8",
  );
  const singles = new Set(
    [...source.matchAll(/result\["([^"]+)"\]/g)].map((m) => m[1]),
  );
  const suffixes = new Set(
    [...source.matchAll(/result\[`\$\{providerUpper\} ([^`]+)`\]/g)].map(
      (m) => m[1],
    ),
  );
  check(
    "the scan found the single-name columns the factory writes",
    singles.has("Sized On") &&
      singles.has("Sized From") &&
      singles.has("Review Flag") &&
      singles.has("Family Equivalence") &&
      singles.has("GCP Custom Fit"),
    [...singles].join(" | "),
  );
  check(
    "the scan found the per-provider columns the factory writes",
    suffixes.size >= 15 &&
      suffixes.has("Like-to-Like Instance") &&
      suffixes.has("Best Network"),
    String(suffixes.size),
  );
  const missed = [
    ...[...singles].filter((n) => !reserved(n)),
    ...[...suffixes].flatMap((s) =>
      ["AWS", "AZURE", "GCP"]
        .map((p) => `${p} ${s}`)
        .filter((n) => !reserved(n)),
    ),
  ];
  check(
    "every column the factory writes is reserved",
    missed.length === 0,
    missed.join(" | "),
  );
}

// ── a run does not carry them ───────────────────────────────────────────────────
(async () => {
  const { ctx, run } = buildEngineContext({
    scripts: ENGINE_SCRIPTS,
    label: "reserved-columns-run",
  });
  run(`
    window._prewarmedSelectors = { aws: {
      initialize: async function () {},
      getLikeToLikeInstance: function () { return { instanceType: "m5.large", familyName: "General purpose", vCpus: 2, memory: 8, price: 0.1, alternatives: {}, rulesApplied: "" }; },
      getOptimizedInstance: function () { return { instanceType: "t3.small", familyName: "General purpose", vCpus: 2, memory: 2, price: 0.02, alternatives: {}, rulesApplied: "" }; },
    } };
  `);
  ctx.rows = [
    {
      "VM Name": "vm1",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "CPU Utilization": "10",
      "Memory Utilization": "10",
      "AWS Region": "us-east-1",
      "Owner Email": "keep.me@example.com",
      "AWS Like-to-Like Instance": "r5.24xlarge",
      "AWS Like-to-Like vCPUs": "96",
      "AWS Like-to-Like Memory (GiB)": "768",
      "AZURE Rules Applied": "STALE rule from an Azure run",
      "AZURE No Match Reason": "STALE",
      "Review Flag": "spoofed review flag",
      "Family Equivalence": "spoofed",
      "Sized From": "spoofed",
      "GCP Custom Fit": "spoofed",
      "Old AWS Like-to-Like Instance (2024)": "spoofed",
    },
  ];
  ctx.opts = {
    generateLikeToLike: false,
    generateOptimized: true,
    cpuBased: true,
    memoryBased: true,
    cpuDownsizeMax: 40,
    cpuUpsizeMin: 80,
    memoryDownsizeMax: 40,
    memoryUpsizeMax: 80,
    memoryUpsizeMin: 80,
    utilizationStatistic: "avg",
  };
  const out = await run(
    `window.getInstanceRecommendationWithSelector(rows, ["aws"], opts)`,
  );
  const row = out[0];
  check(
    "an optimized-only run has no Like-to-Like columns from the upload",
    !("AWS Like-to-Like Instance" in row) &&
      !("AWS Like-to-Like vCPUs" in row) &&
      !("AWS Like-to-Like Memory (GiB)" in row),
    JSON.stringify(Object.keys(row)),
  );
  check(
    "an unselected provider's columns are not carried",
    !("AZURE Rules Applied" in row) && !("AZURE No Match Reason" in row),
  );
  check(
    "single-name engine columns are not carried",
    !("Review Flag" in row) &&
      !("Family Equivalence" in row) &&
      !("Sized From" in row) &&
      !("GCP Custom Fit" in row),
  );
  check(
    "a header containing an engine column name is not carried",
    !("Old AWS Like-to-Like Instance (2024)" in row),
  );
  check(
    "an ordinary input column is still carried",
    row["Owner Email"] === "keep.me@example.com" && row["VM Name"] === "vm1",
  );
  check(
    "the run's own outputs are present",
    row["AWS Optimized Instance"] === "t3.small",
    String(row["AWS Optimized Instance"]),
  );
  ctx.out = out;
  const savings = run(`computeSizingSavings(out)`);
  check(
    "no savings figure is computed against an uploaded baseline",
    !JSON.stringify(savings).includes("like-for-like"),
    JSON.stringify(savings),
  );

  // ── the upload is told ────────────────────────────────────────────────────────
  {
    const { run: page, elements } = buildContext();
    const report = page(
      `analyzeInputHygiene([{ "CPU Count": "2", "Memory (GB)": "4", "AWS Like-to-Like Instance": "r5.large", "Owner Email": "a@b.c" }])`,
    );
    check(
      "the hygiene report names the reserved upload columns and only those",
      JSON.stringify(report.reservedColumns) ===
        JSON.stringify(["AWS Like-to-Like Instance"]),
      JSON.stringify(report.reservedColumns),
    );
    const none = page(
      `analyzeInputHygiene([{ "CPU Count": "2", "Memory (GB)": "4" }])`,
    );
    check(
      "an ordinary file reports no reserved columns",
      none.reservedColumns.length === 0,
    );
    page(
      `csvData = [{ "CPU Count": "2", "Memory (GB)": "4", "<img src=x onerror=alert(1)> Rules Applied": "x" }]`,
    );
    page(`reportInputHygiene()`);
    const el = elements.inputHygieneSection;
    const html = el ? el.innerHTML : "";
    check(
      "the notice appears and names the column",
      html.includes("named like this tool") && html.includes("Rules Applied"),
      html.slice(0, 200),
    );
    check("the column name is escaped in the notice", !html.includes("<img"));
  }

  if (state.failures) {
    console.error(`\nreserved-columns: ${state.failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\nreserved-columns: all checks passed");
    process.exitCode = 0;
  }
})();

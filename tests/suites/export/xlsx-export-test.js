// Results .xlsx export verification (js/base/xlsx-export.js):
//   - resultsColToA1 column-letter math
//   - resultsCellType numeric detection (bounded, string fallback)
//   - buildResultsSheetModel: headers/rows/col-widths/autofilter range
//   - write smoke via the vendored styling fork: header style applied,
//     numeric cells typed, and a base64 write→read round-trip preserves data
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  document: {
    createElement: () => ({}),
    head: { appendChild: () => {} },
    getElementById: () => null,
  },
};
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
const run = (expr) =>
  vm.runInContext(expr, ctx, { filename: "xlsx-export-test" });

load("js/base/xlsx-export.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
}

// ── Column-letter math ──────────────────────────────────────────────────────
check(
  "resultsColToA1 A/Z/AA/AB/AZ/BA",
  run('[0,25,26,27,51,52].map(resultsColToA1).join(",")') === "A,Z,AA,AB,AZ,BA",
  run('[0,25,26,27,51,52].map(resultsColToA1).join(",")'),
);

// ── Numeric detection ───────────────────────────────────────────────────────
const ct = (v) => run(`JSON.stringify(resultsCellType(${JSON.stringify(v)}))`);
check("cell type: empty string → text", ct("") === '{"t":"s","v":""}', ct(""));
check(
  "cell type: integer string → number",
  ct("16") === '{"t":"n","v":16}',
  ct("16"),
);
check(
  "cell type: decimal string → number",
  ct("3.5") === '{"t":"n","v":3.5}',
  ct("3.5"),
);
check(
  "cell type: negative → number",
  ct("-4") === '{"t":"n","v":-4}',
  ct("-4"),
);
check(
  "cell type: instance name → text",
  ct("m6g.xlarge") === '{"t":"s","v":"m6g.xlarge"}',
  ct("m6g.xlarge"),
);
check(
  "cell type: 16-digit id stays text (precision guard)",
  ct("1234567890123456") === '{"t":"s","v":"1234567890123456"}',
  ct("1234567890123456"),
);
check("cell type: number value → number", ct(8) === '{"t":"n","v":8}', ct(8));
check(
  "cell type: NaN → text (not an invalid numeric cell)",
  run("JSON.stringify(resultsCellType(NaN))") === '{"t":"s","v":"NaN"}',
  run("JSON.stringify(resultsCellType(NaN))"),
);
check(
  "cell type: Infinity → text",
  run("JSON.stringify(resultsCellType(Infinity))") ===
    '{"t":"s","v":"Infinity"}',
  run("JSON.stringify(resultsCellType(Infinity))"),
);

// ── Sheet model ─────────────────────────────────────────────────────────────
run(
  `__r = [
    { "VM Name": "web-01", CPU: "4", "AWS Instance": "m6g.large" },
    { "VM Name": "db-server-01", CPU: "16", "AWS Instance": "No Match" }
  ];
   __m = buildResultsSheetModel(__r);`,
);
check(
  "model headers preserve input column order",
  run('__m.headers.join("|")') === "VM Name|CPU|AWS Instance",
  run('__m.headers.join("|")'),
);
check(
  "model rows carry values in column order",
  run('__m.rows[1].join("|")') === "db-server-01|16|No Match",
  run('__m.rows[1].join("|")'),
);
check(
  "col widths fit the widest cell (clamped)",
  run("__m.cols[0].wch") === "db-server-01".length + 2 &&
    run("__m.cols[1].wch") === 8,
  run("JSON.stringify(__m.cols)"),
);
check(
  "autofilter spans header + all data rows",
  run("__m.autofilter") === "A1:C3",
  run("__m.autofilter"),
);
check(
  "empty results → no columns, degenerate filter",
  run("buildResultsSheetModel([]).headers.length") === 0 &&
    run("buildResultsSheetModel([]).autofilter") === "A1:A1",
);

// ── Write smoke (styling fork) ──────────────────────────────────────────────
console.log("[xlsx write smoke — vendored styling fork]");
load("js/vendor/xlsx-js-style.min.js");
check(
  "styling fork loaded",
  !!(sandbox.XLSX && sandbox.XLSX.utils) && sandbox.XLSX.style_version != null,
);
run("__wb = buildResultsWorkbook(__m, true, window.XLSX);");
check(
  "single sheet named Recommendations",
  run('__wb.SheetNames.join("|")') === "Recommendations",
  run('__wb.SheetNames.join("|")'),
);
check(
  "header cell A1 carries the fill style",
  run(
    '!!(__wb.Sheets["Recommendations"]["A1"].s && __wb.Sheets["Recommendations"]["A1"].s.fill)',
  ),
);
check(
  "numeric CPU cell is typed as a number",
  run('__wb.Sheets["Recommendations"]["B3"].t') === "n" &&
    run('__wb.Sheets["Recommendations"]["B3"].v') === 16,
);
check(
  "workbook serializes to xlsx bytes",
  run('XLSX.write(__wb, { type: "base64", bookType: "xlsx" }).length') > 1000,
);
run(
  `__b64 = XLSX.write(__wb, { type: "base64", bookType: "xlsx" });
   __back = XLSX.utils.sheet_to_json(
     XLSX.read(__b64, { type: "base64" }).Sheets.Recommendations,
     { header: 1 },
   );`,
);
check(
  "round-trip read preserves the header row",
  run('__back[0].join(",")') === "VM Name,CPU,AWS Instance",
  run('__back[0].join(",")'),
);
check(
  "round-trip read preserves a numeric value as a number",
  run("__back[2][1]") === 16,
  run("JSON.stringify(__back[2])"),
);

// ── Alternative-strategy sheets ─────────────────────────────────────────────
// A run carrying the alternative columns gets one sheet per strategy, each a
// focused view (identity columns + one pick column per provider).
console.log("[per-strategy sheets]");
run(
  `__ra = [
    { "VM Name": "web-01", "CPU Count": "4", "Memory (GB)": "16",
      "AWS Like-to-Like Instance": "m6g.xlarge",
      "AWS Most Cost Optimized": "m6g.xlarge (4/16)",
      "AWS Workload Based": "r6g.xlarge (4/32)",
      "AWS Newest Generation": "m8g.xlarge (4/16)" },
    { "VM Name": "db-01", "CPU Count": "8", "Memory (GB)": "32",
      "AWS Like-to-Like Instance": "No Match",
      "AWS Most Cost Optimized": "",
      "AWS Workload Based": "",
      "AWS Newest Generation": "" }
  ];`,
);
check(
  "buildStrategySheetModel projects identity + the one strategy column",
  run(
    '__sm = buildStrategySheetModel(__ra, "Most Cost Optimized"); __sm.headers.join("|")',
  ) === "VM Name|CPU Count|Memory (GB)|AWS Most Cost Optimized",
  run('__sm.headers.join("|")'),
);
check(
  "the strategy sheet carries the per-row pick",
  run('__sm.rows[0].join("|")') === "web-01|4|16|m6g.xlarge (4/16)",
  run('__sm.rows[0].join("|")'),
);
check(
  "a run with no alternative columns yields no strategy model",
  run(
    'buildStrategySheetModel([{ "VM Name": "x" }], "Most Cost Optimized")',
  ) === null,
);
run(
  `__ex = ["Most Cost Optimized","Workload Based","Newest Generation"]
     .map((name) => ({ name, model: buildStrategySheetModel(__ra, name) }))
     .filter((s) => s.model);
   __wb2 = buildResultsWorkbook(buildResultsSheetModel(__ra), true, window.XLSX, __ex);`,
);
check(
  "the workbook adds one sheet per strategy after Recommendations",
  run('__wb2.SheetNames.join("|")') ===
    "Recommendations|Most Cost Optimized|Workload Based|Newest Generation",
  run('__wb2.SheetNames.join("|")'),
);
check(
  "a strategy sheet holds its pick cell",
  run('__wb2.Sheets["Workload Based"]["D2"].v') === "r6g.xlarge (4/32)",
  run(
    '__wb2.Sheets["Workload Based"]["D2"] && __wb2.Sheets["Workload Based"]["D2"].v',
  ),
);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("xlsx-export-test: all checks passed");

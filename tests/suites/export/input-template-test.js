// Input template (.xlsx) — the ready-to-fill workbook offered beside the sample
// CSV (xlsx-export.js). Three things must hold, or the template teaches the user
// the wrong thing:
//   1. the columns don't drift from the sample CSV (downloadSampleCSV) — same
//      set, plus the new per-row Include Only column;
//   2. the "Allowed values" sheet equals RuleEngine.RECOGNIZED exactly, so the
//      documented vocabulary can never fall out of step with what apply() matches;
//   3. every closed-enum value in the example rows is one the engine recognises —
//      the template must never demonstrate a value it would silently ignore.
// The workbook is then built through the REAL vendored engine and read back, so a
// structural regression (missing sheet, drifted header) fails here too.
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
  vm.runInContext(expr, ctx, { filename: "input-template-test" });

// The engine (for RECOGNIZED), the template builders, then the vendored writer.
load("js/base/rule-engine.js");
load("js/base/xlsx-export.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
}

const columns = run("INPUT_TEMPLATE_COLUMNS");
const examples = run("INPUT_TEMPLATE_EXAMPLES");
const allowed = run("buildInputTemplateAllowedValues()");
const RECOGNIZED = run("RuleEngine.RECOGNIZED");

// ── 1. Columns match the sample CSV, plus Include Only ───────────────────────
console.log("[the template columns stay in step with the sample CSV]");
{
  // Pull downloadSampleCSV's header line straight from the source, so a column
  // added to one and not the other is caught rather than silently diverging.
  const ingestSrc = fs.readFileSync(
    path.join(REPO, "js/base/ingest.js"),
    "utf8",
  );
  const headerLine = (ingestSrc.match(/const csvContent = `([^\n]*)/) || [])[1];
  check(
    "the sample CSV header line was found in ingest.js",
    !!headerLine && headerLine.includes("VM Name"),
    headerLine,
  );
  const sampleCols = (headerLine || "").split(",").map((s) => s.trim());
  const expected = new Set([...sampleCols, "Include Only"]);
  const got = new Set(columns);
  const missing = [...expected].filter((c) => !got.has(c));
  const extra = [...got].filter((c) => !expected.has(c));
  check(
    "the template columns are the sample CSV columns plus Include Only",
    missing.length === 0 && extra.length === 0,
    `missing: [${missing}] extra: [${extra}]`,
  );
  check(
    "the new Include Only column is present",
    columns.includes("Include Only"),
    JSON.stringify(columns),
  );
  check(
    "the three required columns lead the set",
    ["VM Name", "CPU Count", "Memory (GB)"].every((c) => columns.includes(c)),
  );
}

// ── 2. Allowed-values sheet == RECOGNIZED (drift-proof) ──────────────────────
console.log("[the Allowed values are read live from the engine, never copied]");
{
  const byCol = Object.fromEntries(allowed.map((a) => [a.column, a.values]));
  const same = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    JSON.stringify(a) === JSON.stringify(b);
  check(
    "ENV values equal RuleEngine.RECOGNIZED.env",
    same(byCol.ENV, RECOGNIZED.env),
    JSON.stringify(byCol.ENV),
  );
  check(
    "OS values equal RuleEngine.RECOGNIZED.os",
    same(byCol.OS, RECOGNIZED.os),
    JSON.stringify(byCol.OS),
  );
  check(
    "Workload values equal RuleEngine.RECOGNIZED.workload",
    same(byCol.Workload, RECOGNIZED.workload),
    JSON.stringify(byCol.Workload),
  );
  check(
    "Compliance values equal RuleEngine.RECOGNIZED.compliance",
    same(byCol.Compliance, RECOGNIZED.compliance),
    JSON.stringify(byCol.Compliance),
  );
}

// ── 3. Every example closed-enum value is recognised ─────────────────────────
console.log("[the example rows never demonstrate a value the engine ignores]");
{
  const dims = [
    ["ENV", RECOGNIZED.env],
    ["OS", RECOGNIZED.os],
    ["Workload", RECOGNIZED.workload],
    ["Compliance", RECOGNIZED.compliance],
  ];
  let allOk = true;
  const offenders = [];
  examples.forEach((ex, i) => {
    dims.forEach(([col, vocab]) => {
      const raw = String(ex[col] ?? "").trim();
      if (
        raw &&
        !vocab.map((v) => v.toLowerCase()).includes(raw.toLowerCase())
      ) {
        allOk = false;
        offenders.push(`row ${i}: ${col}="${raw}"`);
      }
    });
  });
  check(
    "every example ENV/OS/Workload/Compliance value is recognised",
    allOk,
    offenders.join("; "),
  );
}

// ── 4. Structural round-trip through the real vendored engine ────────────────
console.log("[the workbook builds and reads back with both sheets intact]");
{
  load("js/vendor/xlsx-js-style.min.js");
  const XLSX = run("window.XLSX");
  check("the vendored engine loaded", !!(XLSX && XLSX.utils), "no XLSX.utils");

  run("__wb = buildInputTemplateWorkbook(window.XLSX, true);");
  const sheetNames = run("__wb.SheetNames");
  check(
    "the workbook has an Inventory and an Allowed values sheet",
    JSON.stringify(sheetNames) ===
      JSON.stringify(["Inventory", "Allowed values"]),
    JSON.stringify(sheetNames),
  );

  // Write to a buffer and read it back — proves the file is valid, not just the
  // in-memory model.
  const b64 = run('XLSX.write(__wb, { type: "base64", bookType: "xlsx" })');
  check("the workbook writes a non-trivial file", b64.length > 1000);

  run(`__back = XLSX.read(${JSON.stringify(b64)}, { type: "base64" });`);
  const invRows = run(
    "__back.Sheets.Inventory ? XLSX.utils.sheet_to_json(__back.Sheets.Inventory, { header: 1 }) : []",
  );
  check(
    "the read-back Inventory header row equals INPUT_TEMPLATE_COLUMNS",
    JSON.stringify(invRows[0]) === JSON.stringify(columns),
    JSON.stringify(invRows[0]),
  );
  check(
    "the read-back Inventory carries the example rows",
    invRows.length === examples.length + 1,
    `rows: ${invRows.length}`,
  );

  const docText = run(
    'JSON.stringify(XLSX.utils.sheet_to_json(__back.Sheets["Allowed values"], { header: 1 }))',
  );
  check(
    "the Allowed values sheet documents a recognised ENV value",
    docText.includes("production"),
    docText,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("input-template-test: all checks passed");
}

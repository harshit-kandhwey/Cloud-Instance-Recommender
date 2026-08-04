// Executive Excel export — structural round-trip (§3.10.8).
//
// portfolio-test.js pins the neutral model and confirms writeWorkbook carries
// the sheet names and serializes to bytes. What it never does is READ THE BYTES
// BACK: it asserts the model that goes IN, not the workbook that comes OUT. So a
// regression in the write step itself — a cell placed at the wrong address, a
// dropped !ref / !merges / !autofilter, a numeric KPI written as text — would
// pass portfolio-test untouched.
//
// This suite closes that gap. It builds the workbook, serializes it to xlsx
// bytes, and parses those bytes back with a FRESH read (XLSX.read). Every
// assertion below is against the recovered workbook, so it exercises the full
// write→serialize→read contract the way a downstream reader (Excel) would. It is
// the "structural compare" half of the golden expansion — xlsx bytes are not
// byte-stable (zip ordering + timestamps), so the lock is on the recovered
// structure (sheet skeletons, cell values, cell TYPES), not on the raw bytes.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");

const els = {};
function fakeEl(id) {
  if (!els[id])
    els[id] = {
      id,
      innerHTML: "",
      classes: new Set(),
      classList: {
        add: (c) => els[id].classes.add(c),
        remove: (c) => els[id].classes.delete(c),
        contains: (c) => els[id].classes.has(c),
      },
    };
  return els[id];
}

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  location: { origin: "https://x.test", pathname: "/app-portfolio.html" },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
sandbox.window = sandbox;
sandbox.window.opener = null;
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.document = {
  readyState: "complete",
  documentElement: { dataset: {} },
  getElementById: (id) => fakeEl(id),
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  head: { appendChild() {} },
  body: { appendChild() {} },
};
const ctx = vm.createContext(sandbox);
const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
const run = (expr) => vm.runInContext(expr, ctx);
load("js/base/app-core.js");
load("js/base/portfolio.js");
load("js/vendor/xlsx-js-style.min.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

// Same fixture as portfolio-test.js — its model numbers (estate 4 VMs / 30 vCPUs
// / 120 GB, Billing 2/12/48, one fully-unmatched Analytics VM, one Unassigned)
// are already asserted there, so the values this suite expects to survive the
// round-trip are known-good rather than authored blind.
const payload = {
  version: 1,
  generatedAt: "2026-07-05T00:00:00.000Z",
  sourcePage: "multicloud",
  providers: ["aws", "azure"],
  columnHeaders: ["VM Name", "App Name", "CPU Count", "Memory (GB)"],
  dataDates: { AWS: "2026-06-27", AZURE: "2026-06-27" },
  hasOptimized: true,
  hasLikeToLike: true,
  results: [
    {
      "VM Name": "b1",
      "App Name": "Billing",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "AWS Region": "us-east-1",
      "Azure Region": "East US",
      ENV: "Production",
      OS: "Linux",
      Workload: "Web Server",
      Compliance: "",
      "AWS Like-to-Like Instance": "m6g.xlarge",
      "AWS Optimized Instance": "m5.large",
      "AWS Optimized vCPUs": "2",
      "AWS No Match Reason": "",
      "AZURE Like-to-Like Instance": "d4psv6",
      "AZURE Optimized Instance": "d4psv6",
      "AZURE Optimized vCPUs": "4",
      "AZURE No Match Reason": "",
    },
    {
      "VM Name": "b2",
      "App Name": "Billing",
      "CPU Count": "8",
      "Memory (GB)": "32",
      "AWS Region": "us-west-2",
      "Azure Region": "West US 2",
      ENV: "Production",
      OS: "Windows",
      Workload: "Database",
      Compliance: "PCI",
      "AWS Like-to-Like Instance": "r5a.2xlarge",
      "AWS Optimized Instance": "r5a.2xlarge",
      "AWS Optimized vCPUs": "8",
      "AWS No Match Reason": "",
      "AZURE Like-to-Like Instance": "e8asv5",
      "AZURE Optimized Instance": "e8asv5",
      "AZURE Optimized vCPUs": "8",
      "AZURE No Match Reason": "",
    },
    {
      "VM Name": "an1",
      "App Name": "Analytics",
      "CPU Count": "2",
      "Memory (GB)": "8",
      ENV: "Dev",
      OS: "Linux",
      Workload: "General",
      Compliance: "",
      "AWS Like-to-Like Instance": "No data available",
      "AWS Optimized Instance": "No data available",
      "AWS Optimized vCPUs": "",
      "AWS No Match Reason": "No instances in region",
      "AZURE Like-to-Like Instance": "No data available",
      "AZURE Optimized Instance": "No data available",
      "AZURE Optimized vCPUs": "",
      "AZURE No Match Reason": "No instances in region",
    },
    {
      "VM Name": "u1",
      "App Name": "",
      "CPU Count": "16",
      "Memory (GB)": "64",
      ENV: "Staging",
      OS: "Linux",
      "AWS Like-to-Like Instance": "m6i.4xlarge",
      "AWS Optimized Instance": "m6i.4xlarge",
      "AWS Optimized vCPUs": "16",
      "AWS No Match Reason": "",
      "AZURE Optimized Instance": "No data available",
      "AZURE Optimized vCPUs": "",
      "AZURE No Match Reason": "",
    },
  ],
};
run(`__payload = ${JSON.stringify(payload)};`);
run("__m = buildPortfolioModel(__payload);");

// Build → serialize → read back. Every check below reads __rb (the reparsed
// workbook), never __wb (the in-memory one the writer returned).
run("__wb = writeWorkbook(buildPortfolioWorkbookModel(__m), true);");
run('__bytes = XLSX.write(__wb, { type: "base64", bookType: "xlsx" });');
run('__rb = XLSX.read(__bytes, { type: "base64" });');

console.log("[serialized bytes reparse]");
check(
  "the workbook serializes to a non-trivial xlsx payload",
  run("__bytes.length") > 1000,
);
check(
  "sheet names + order survive the round-trip",
  run("__rb.SheetNames.join('|')") ===
    "Portfolio Summary|Contents|Analytics|Billing|Unassigned|About",
  run("__rb.SheetNames.join('|')"),
);

// Per-sheet skeleton: the used range, the merge count, and the autofilter ref.
// These are the worksheet-level structures writeWorkbook wires onto each sheet
// (!ref from the max row/col it walked, !merges, !autofilter) — none of which
// the model-level test can see, because they are produced by the write step.
console.log("[per-sheet skeleton (ref / merges / autofilter)]");
const skeleton = run(
  `JSON.stringify(__rb.SheetNames.map(function(n){var s=__rb.Sheets[n];return {name:n,ref:s['!ref'],merges:(s['!merges']||[]).length,af:(s['!autofilter']||{}).ref||null};}))`,
);
const expectedSkeleton = JSON.stringify([
  { name: "Portfolio Summary", ref: "A1:M8", merges: 1, af: "A4:M7" },
  { name: "Contents", ref: "A1:B8", merges: 0, af: null },
  { name: "Analytics", ref: "A1:R18", merges: 1, af: "A17:R18" },
  { name: "Billing", ref: "A1:R18", merges: 1, af: "A16:R18" },
  { name: "Unassigned", ref: "A1:R17", merges: 1, af: "A16:R17" },
  { name: "About", ref: "A1:B20", merges: 0, af: null },
]);
check(
  "every sheet's used range, merge count and autofilter ref round-trip exactly",
  skeleton === expectedSkeleton,
  skeleton,
);

// The cell-value checks below are what actually catch an address-placement
// regression: writeWorkbook derives !ref from the loop indices, not from the
// addresses it writes to, so the skeleton ref above can still pass if rows and
// columns are transposed — only reading specific addresses back reveals it.
console.log("[summary sheet cells + types]");
run("__sum = __rb.Sheets['Portfolio Summary'];");
// Null-safe cell reader: a cell missing from its expected address (e.g. an
// address regression in the writer) yields {} rather than throwing, so the
// check reports a clean FAIL naming the address instead of crashing the run.
run("__cell = function (sh, a) { return sh[a] || {}; };");
run("__merge0 = (__sum['!merges'] || [])[0] || { s: {}, e: {} };");
check(
  "the summary title merge spans all 13 columns (end col 12)",
  run("__merge0.e.c") === 12 && run("__merge0.s.c") === 0,
);
check(
  "the summary header row (A4:M4) survives as text",
  run(
    `["A4","B4","C4","D4","E4","F4","G4"].map(function(k){return __cell(__sum,k).v;}).join("|")`,
  ) === "Application|VMs|vCPUs|Memory (GB)|Matched|No-Match|Match %",
  run(
    `["A4","B4","C4","D4","E4","F4","G4"].map(function(k){return __cell(__sum,k).v;}).join("|")`,
  ),
);
// The estate TOTAL row is the reconciliation line — its numbers must not only
// survive but survive AS NUMBERS (t:"n"), because a KPI written as text is a
// silent corruption a reader would sum wrong.
check(
  "the TOTAL (estate) row round-trips with numeric type: 4 VMs / 30 vCPUs / 120 GB",
  run("__cell(__sum,'A8').v") === "TOTAL (estate)" &&
    run("__cell(__sum,'B8').v") === 4 &&
    run("__cell(__sum,'B8').t") === "n" &&
    run("__cell(__sum,'C8').v") === 30 &&
    run("__cell(__sum,'C8').t") === "n" &&
    run("__cell(__sum,'D8').v") === 120 &&
    run("__cell(__sum,'D8').t") === "n",
  run(
    `JSON.stringify(["A8","B8","C8","D8"].map(function(k){return __sum[k];}))`,
  ),
);
check(
  "a per-app numeric KPI is a number and a label is a string (types are not flattened to text)",
  run("__cell(__sum,'C6').v") === 12 &&
    run("__cell(__sum,'C6').t") === "n" &&
    run("__cell(__sum,'A6').v") === "Billing" &&
    run("__cell(__sum,'A6').t") === "s",
);

console.log("[app sheet + internal hyperlinks]");
run("__bil = __rb.Sheets['Billing'];");
check(
  "the Billing app sheet keeps its title and back-to-Contents hyperlink target",
  run("__cell(__bil,'A1').v") === "Billing" &&
    run("(__cell(__bil,'A2').l || {}).Target") === "#'Contents'!A1",
  run(
    "JSON.stringify({title:__cell(__bil,'A1').v, link:(__cell(__bil,'A2').l||{}).Target})",
  ),
);
const contentsLinks = run(
  `JSON.stringify((function(){var s=__rb.Sheets["Contents"];return Object.keys(s).filter(function(k){return k[0]!=="!"&&s[k].l;}).map(function(k){return s[k].l.Target;});})())`,
);
check(
  "the Contents sheet links to every other sheet by internal target",
  contentsLinks ===
    JSON.stringify([
      "#'Portfolio Summary'!A1",
      "#'Analytics'!A1",
      "#'Billing'!A1",
      "#'Unassigned'!A1",
      "#'About'!A1",
    ]),
  contentsLinks,
);
check(
  "the About sheet still records that pricing is intentionally excluded",
  run(
    `(function(){var s=__rb.Sheets["About"];return Object.keys(s).some(function(k){return k[0]!=="!"&&/Intentionally excluded/.test(String(s[k].v||""));});})()`,
  ),
);

process.exitCode = failures ? 1 : 0;

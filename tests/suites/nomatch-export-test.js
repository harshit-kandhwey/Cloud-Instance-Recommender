// No-match remediation export.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

const elements = {};
const downloads = [];
function fakeElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      innerHTML: "",
      className: "",
      style: {},
      value: "",
      textContent: "",
      title: "",
      classes: new Set(["hidden"]),
      classList: {
        add: (c) => elements[id].classes.add(c),
        remove: (c) => elements[id].classes.delete(c),
        toggle: () => {},
        contains: (c) => elements[id].classes.has(c),
      },
      addEventListener: () => {},
      querySelectorAll: () => [],
      focus: () => {},
      setSelectionRange: () => {},
      scrollIntoView: () => {},
      setAttribute: () => {},
    };
  }
  return elements[id];
}
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  alerts: [],
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  Blob: class {
    constructor(parts) {
      this.content = parts.join("");
    }
  },
};
sandbox.alert = (m) => sandbox.alerts.push(m);
sandbox.window = sandbox;
sandbox.URL = {
  createObjectURL: (blob) => {
    downloads.push({ blob });
    return "blob:x";
  },
  revokeObjectURL: () => {},
};
sandbox.document = {
  createElement: (tag) => {
    const el = {
      tag,
      style: {},
      click() {
        if (this.tag === "a")
          downloads[downloads.length - 1].name = this.download;
      },
    };
    return el;
  },
  getElementById: (id) => fakeElement(id),
  querySelector: () => null,
  querySelectorAll: (sel) =>
    sel === "script[src]" ? [{ src: "js/aws/aws-data.js" }] : [],
  addEventListener: () => {},
  removeEventListener: () => {},
  head: { appendChild: () => {} },
  body: { appendChild: () => {}, removeChild: () => {} },
};
const ctx = vm.createContext(sandbox);
const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
load("js/aws/aws-data.js");
for (const f of [
  "js/base/rule-engine.js",
  "js/base/base-instance-selector.js",
  "js/aws/aws-instance-selector.js",
  "js/azure/azure-instance-selector.js",
  "js/gcp/gcp-instance-selector.js",
  "js/base/instance-selector-factory.js",
  "js/base/app-core.js",
  "js/base/ui-shell.js",
  "js/base/ingest.js",
  "js/base/manual-entry.js",
  "js/base/form-controls.js",
  "js/base/generate.js",
  "js/base/preview.js",
  "js/base/downloads.js",
])
  load(f);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

// Engineered results: 2 of 5 rows fully unmatched, 1 partially matched (AWS
// no-match but Azure matched — must NOT export), 2 fully matched
const results = [
  {
    "VM Name": "ok-1",
    "CPU Count": "2",
    "AWS Like-to-Like Instance": "m5.large",
    "AZURE Like-to-Like Instance": "D2s_v5",
    "AWS No Match Reason": "",
    "AZURE No Match Reason": "",
    "AWS Rules Applied": "1a",
    "AZURE Rules Applied": "",
  },
  {
    "VM Name": "bad-1",
    "CPU Count": "=2+2",
    "AWS Like-to-Like Instance": "No data available",
    "AZURE Like-to-Like Instance": "Missing data",
    "AWS No Match Reason": "Region 'narnia' not found",
    "AZURE No Match Reason": "No AZURE region specified in CSV",
    "AWS Rules Applied": "",
    "AZURE Rules Applied": "",
  },
  {
    "VM Name": "partial-1",
    "CPU Count": "4",
    "AWS Like-to-Like Instance": "No data available",
    "AZURE Like-to-Like Instance": "D4s_v5",
    "AWS No Match Reason": "x",
    "AZURE No Match Reason": "",
    "AWS Rules Applied": "",
    "AZURE Rules Applied": "",
  },
  {
    "VM Name": "bad-2",
    "CPU Count": "8",
    "AWS Like-to-Like Instance": "Error",
    "AZURE Like-to-Like Instance": "Error",
    "AWS No Match Reason": "Error: boom",
    "AZURE No Match Reason": "Error: boom",
    "AWS Rules Applied": "",
    "AZURE Rules Applied": "",
  },
  {
    "VM Name": "ok-2",
    "CPU Count": "2",
    "AWS Like-to-Like Instance": "m5.large",
    "AZURE Like-to-Like Instance": "D2s_v5",
    "AWS No Match Reason": "",
    "AZURE No Match Reason": "",
    "AWS Rules Applied": "",
    "AZURE Rules Applied": "",
  },
];

vm.runInContext(
  `
  columnHeaders = ["VM Name", "CPU Count"];
  processedResults = ${JSON.stringify(results)};
`,
  ctx,
);

console.log("[getNoMatchRows]");
const rows = vm.runInContext("getNoMatchRows(processedResults)", ctx);
check(
  "2 of 5 rows qualify",
  rows.length === 2,
  JSON.stringify(rows.map((r) => r["VM Name"])),
);
check(
  "partially-matched row excluded",
  !rows.some((r) => r["VM Name"] === "partial-1"),
);

console.log("[CSV menu state]");
vm.runInContext("renderCsvMenu(processedResults)", ctx);
check(
  "No-Match item listed with count",
  elements.csvMenu.innerHTML.includes("No-Match Rows CSV (2)"),
  elements.csvMenu.innerHTML,
);

vm.runInContext(`renderCsvMenu([${JSON.stringify(results[0])}])`, ctx);
check(
  "No-Match item absent on an all-match run",
  !elements.csvMenu.innerHTML.includes("No-Match Rows CSV"),
  elements.csvMenu.innerHTML,
);

console.log("[download selected CSVs]");
vm.runInContext("renderCsvMenu(processedResults)", ctx);
// Simulate the two checked boxes the browser's ':checked' selector would return.
elements.csvMenu.querySelectorAll = () => [
  { value: "results" },
  { value: "nomatch" },
];
downloads.length = 0;
vm.runInContext("downloadSelectedCsvs()", ctx);
check(
  "exactly the checked exports fire (results + no-match, not app summary)",
  downloads.length === 2 &&
    downloads.some((d) =>
      (d.name || "").includes("instance_recommendations"),
    ) &&
    downloads.some((d) => (d.name || "").includes("no_match_rows")),
  downloads.map((d) => d.name).join(", "),
);
// Nothing checked → a warning, no downloads. Assert BOTH halves: the toast is
// the user-visible half, and checking only downloads.length would pass even if
// the warning quietly stopped firing.
elements.csvMenu.querySelectorAll = () => [];
downloads.length = 0;
const toastStack = ctx.document.getElementById("toastStack");
toastStack.innerHTML = "";
vm.runInContext("downloadSelectedCsvs()", ctx);
check("an empty selection downloads nothing", downloads.length === 0);
check(
  "an empty selection warns the user",
  toastStack.innerHTML.length > 0,
  toastStack.innerHTML,
);

console.log("[export content]");
vm.runInContext("downloadNoMatchRows()", ctx);
check(
  "file named no_match_rows_<date>.csv",
  downloads.length === 1 &&
    /^no_match_rows_\d{4}-\d{2}-\d{2}\.csv$/.test(downloads[0].name),
  JSON.stringify(downloads.map((d) => d.name)),
);
const raw = downloads[0].blob.content;
// Excel needs the BOM to read the file as UTF-8; everything else ignores it
check("CSV starts with a UTF-8 BOM", raw.charCodeAt(0) === 0xfeff);
// ﻿, not a literal BOM: an invisible U+FEFF in the pattern is unreviewable
// in a diff, and any "strip zero-width characters" formatter would turn it into
// /^/ — which strips nothing and makes the header assertion below fail for a
// reason no one could see.
const csv = raw.replace(/^\uFEFF/, "");
const lines = csv.split("\n");
check(
  "header = input cols + diagnostics",
  lines[0] ===
    "VM Name,CPU Count,AWS No Match Reason,AZURE No Match Reason,AWS Rules Applied,AZURE Rules Applied",
  lines[0],
);
check("2 data rows", lines.length === 3);
check(
  "exact rows exported",
  lines[1].startsWith("bad-1") && lines[2].startsWith("bad-2"),
);
check("formula-injection hardened", lines[1].includes("'=2+2"), lines[1]);
check("reasons included", lines[1].includes("Region 'narnia' not found"));

console.log("[all-match export guard]");
vm.runInContext(
  `processedResults = [${JSON.stringify(results[0])}]; downloadNoMatchRows();`,
  ctx,
);
check(
  "toast instead of empty file",
  elements.toastStack.innerHTML.includes("nothing to export"),
  elements.toastStack.innerHTML,
);
check("no second download", downloads.length === 1);

// The sandbox captures alert() so a stray native dialog from a loaded module
// does not vanish silently — but capturing is only worth it if we assert it.
check(
  "no module reached for a native alert()",
  sandbox.alerts.length === 0,
  sandbox.alerts.join(" | "),
);

// process.exitCode, not process.exit(): exit() can truncate buffered stdout when
// it is a pipe — exactly the CI case — losing the FAIL: lines this suite emits.
process.exitCode = failures ? 1 : 0;

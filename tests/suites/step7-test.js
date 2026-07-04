// Step 7 verification: no-match remediation export.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

const elements = {};
const downloads = [];
function fakeElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id, innerHTML: "", className: "", style: {}, value: "", textContent: "", title: "",
      classes: new Set(["hidden"]),
      classList: {
        add: (c) => elements[id].classes.add(c),
        remove: (c) => elements[id].classes.delete(c),
        toggle: () => {}, contains: (c) => elements[id].classes.has(c),
      },
      addEventListener: () => {}, querySelectorAll: () => [],
      focus: () => {}, setSelectionRange: () => {}, scrollIntoView: () => {},
    };
  }
  return elements[id];
}
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alerts: [],
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  Blob: class {
    constructor(parts) { this.content = parts.join(""); }
  },
};
sandbox.alert = (m) => sandbox.alerts.push(m);
sandbox.window = sandbox;
sandbox.URL = {
  createObjectURL: (blob) => { downloads.push({ blob }); return "blob:x"; },
  revokeObjectURL: () => {},
};
sandbox.document = {
  createElement: (tag) => {
    const el = { tag, style: {}, click() { if (this.tag === "a") downloads[downloads.length - 1].name = this.download; } };
    return el;
  },
  getElementById: (id) => fakeElement(id),
  querySelectorAll: (sel) => (sel === "script[src]" ? [{ src: "js/aws/aws-data.js" }] : []),
  addEventListener: () => {},
  head: { appendChild: () => {} },
  body: { appendChild: () => {}, removeChild: () => {} },
};
const ctx = vm.createContext(sandbox);
const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, { filename: rel });
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
]) load(f);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else { failures++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

// Engineered results: 2 of 5 rows fully unmatched, 1 partially matched (AWS
// no-match but Azure matched — must NOT export), 2 fully matched
const results = [
  { "VM Name": "ok-1", "CPU Count": "2", "AWS Like-to-Like Instance": "m5.large", "AZURE Like-to-Like Instance": "D2s_v5", "AWS No Match Reason": "", "AZURE No Match Reason": "", "AWS Rules Applied": "1a", "AZURE Rules Applied": "" },
  { "VM Name": "bad-1", "CPU Count": "=2+2", "AWS Like-to-Like Instance": "No data available", "AZURE Like-to-Like Instance": "Missing data", "AWS No Match Reason": "Region 'narnia' not found", "AZURE No Match Reason": "No AZURE region specified in CSV", "AWS Rules Applied": "", "AZURE Rules Applied": "" },
  { "VM Name": "partial-1", "CPU Count": "4", "AWS Like-to-Like Instance": "No data available", "AZURE Like-to-Like Instance": "D4s_v5", "AWS No Match Reason": "x", "AZURE No Match Reason": "", "AWS Rules Applied": "", "AZURE Rules Applied": "" },
  { "VM Name": "bad-2", "CPU Count": "8", "AWS Like-to-Like Instance": "Error", "AZURE Like-to-Like Instance": "Error", "AWS No Match Reason": "Error: boom", "AZURE No Match Reason": "Error: boom", "AWS Rules Applied": "", "AZURE Rules Applied": "" },
  { "VM Name": "ok-2", "CPU Count": "2", "AWS Like-to-Like Instance": "m5.large", "AZURE Like-to-Like Instance": "D2s_v5", "AWS No Match Reason": "", "AZURE No Match Reason": "", "AWS Rules Applied": "", "AZURE Rules Applied": "" },
];

vm.runInContext(`
  columnHeaders = ["VM Name", "CPU Count"];
  processedResults = ${JSON.stringify(results)};
`, ctx);

console.log("[getNoMatchRows]");
const rows = vm.runInContext("getNoMatchRows(processedResults)", ctx);
check("2 of 5 rows qualify", rows.length === 2, JSON.stringify(rows.map((r) => r["VM Name"])));
check("partially-matched row excluded", !rows.some((r) => r["VM Name"] === "partial-1"));

console.log("[button state]");
vm.runInContext("updateNoMatchButton(processedResults)", ctx);
check("button visible with count", !elements.downloadNoMatchBtn.classes.has("hidden") && elements.downloadNoMatchBtn.textContent.includes("(2)"), elements.downloadNoMatchBtn.textContent);

vm.runInContext(`updateNoMatchButton([${JSON.stringify(results[0])}])`, ctx);
check("button re-hidden on all-match run", elements.downloadNoMatchBtn.classes.has("hidden"));

console.log("[export content]");
vm.runInContext("downloadNoMatchRows()", ctx);
check("file named no-match-rows.csv", downloads.length === 1 && downloads[0].name === "no-match-rows.csv", JSON.stringify(downloads.map((d) => d.name)));
const csv = downloads[0].blob.content;
const lines = csv.split("\n");
check("header = input cols + diagnostics", lines[0] === "VM Name,CPU Count,AWS No Match Reason,AZURE No Match Reason,AWS Rules Applied,AZURE Rules Applied", lines[0]);
check("2 data rows", lines.length === 3);
check("exact rows exported", lines[1].startsWith("bad-1") && lines[2].startsWith("bad-2"));
check("formula-injection hardened", lines[1].includes("'=2+2"), lines[1]);
check("reasons included", lines[1].includes("Region 'narnia' not found"));

console.log("[all-match export guard]");
vm.runInContext(`processedResults = [${JSON.stringify(results[0])}]; downloadNoMatchRows();`, ctx);
check("alert instead of empty file", ctx.alerts.some((a) => a.includes("nothing to export")), JSON.stringify(ctx.alerts));
check("no second download", downloads.length === 1);

process.exit(failures ? 1 : 0);

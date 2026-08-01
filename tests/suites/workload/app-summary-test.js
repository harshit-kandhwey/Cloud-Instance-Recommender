// App summary rollup verification (batch item 4, commit B):
//   - getAppSummary aggregation (VMs, vCPUs, memory, matched/no-match)
//   - blank App Name skipped; no App Name column → []
//   - the App Summary item's presence + count in the CSV menu (renderCsvMenu)
//   - downloadAppSummary CSV content + formula-injection hardening
//   - "N apps" chip in the stats bar
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");

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
  createElement: (tag) => ({
    tag,
    style: {},
    click() {
      if (this.tag === "a")
        downloads[downloads.length - 1].name = this.download;
    },
  }),
  getElementById: (id) => fakeElement(id),
  querySelectorAll: (sel) =>
    sel === "script[src]" ? [{ src: "js/aws/aws-data.js" }] : [],
  addEventListener: () => {},
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

// Storefront (2 VMs, both matched), Billing (1 VM, no match), a blank-app and a
// whitespace-only-app VM (both skipped), and four app names starting with the
// OWASP formula-injection triggers = + - @ (must all be escaped in the CSV).
const results = [
  {
    "VM Name": "a1",
    "App Name": "Storefront",
    "CPU Count": "4",
    "Memory (GB)": "16",
    "AWS Like-to-Like Instance": "m5.xlarge",
  },
  {
    "VM Name": "a2",
    "App Name": "Storefront",
    "CPU Count": "2",
    "Memory (GB)": "8",
    "AWS Like-to-Like Instance": "m5.large",
  },
  {
    "VM Name": "b1",
    "App Name": "Billing",
    "CPU Count": "8",
    "Memory (GB)": "32",
    "AWS Like-to-Like Instance": "No data available",
  },
  {
    "VM Name": "u1",
    "App Name": "",
    "CPU Count": "1",
    "Memory (GB)": "2",
    "AWS Like-to-Like Instance": "t3.micro",
  },
  {
    "VM Name": "w1",
    "App Name": "   ",
    "CPU Count": "1",
    "Memory (GB)": "2",
    "AWS Like-to-Like Instance": "t3.micro",
  },
  {
    "VM Name": "e1",
    "App Name": "=Evil",
    "CPU Count": "2",
    "Memory (GB)": "4",
    "AWS Like-to-Like Instance": "t3.small",
  },
  {
    "VM Name": "e2",
    "App Name": "+Evil",
    "CPU Count": "2",
    "Memory (GB)": "4",
    "AWS Like-to-Like Instance": "t3.small",
  },
  {
    "VM Name": "e3",
    "App Name": "-Evil",
    "CPU Count": "2",
    "Memory (GB)": "4",
    "AWS Like-to-Like Instance": "t3.small",
  },
  {
    "VM Name": "e4",
    "App Name": "@Evil",
    "CPU Count": "2",
    "Memory (GB)": "4",
    "AWS Like-to-Like Instance": "t3.small",
  },
];
vm.runInContext(`processedResults = ${JSON.stringify(results)};`, ctx);

console.log("[getAppSummary]");
const summary = vm.runInContext("getAppSummary(processedResults)", ctx);
check(
  "6 named apps (blank + whitespace-only skipped)",
  summary.length === 6,
  JSON.stringify(summary.map((s) => s.app)),
);
const byApp = Object.fromEntries(summary.map((s) => [s.app, s]));
check(
  "Storefront rolls up 2 VMs / 6 vCPUs / 24 GB / 2 matched",
  byApp.Storefront &&
    byApp.Storefront.vms === 2 &&
    byApp.Storefront.vcpus === 6 &&
    byApp.Storefront.memory === 24 &&
    byApp.Storefront.matched === 2 &&
    byApp.Storefront.noMatch === 0,
  JSON.stringify(byApp.Storefront),
);
check(
  "Billing counts its no-match VM",
  byApp.Billing && byApp.Billing.matched === 0 && byApp.Billing.noMatch === 1,
  JSON.stringify(byApp.Billing),
);
check(
  "blank + whitespace-only app VMs not in any app",
  !summary.some((s) => !s.app.trim()),
  JSON.stringify(summary.map((s) => s.app)),
);

console.log("[no App Name column → empty]");
check(
  "getAppSummary returns [] without App Name",
  vm.runInContext(
    'getAppSummary([{ "VM Name": "x", "CPU Count": "2" }]).length === 0',
    ctx,
  ),
);

console.log("[CSV menu state]");
vm.runInContext("renderCsvMenu(processedResults)", ctx);
check(
  "App Summary item listed with app count",
  elements.csvMenu.innerHTML.includes("App Summary CSV (6)"),
  elements.csvMenu.innerHTML,
);
vm.runInContext('renderCsvMenu([{ "VM Name": "x", "CPU Count": "2" }])', ctx);
check(
  "App Summary item absent when no App Name column",
  !elements.csvMenu.innerHTML.includes("App Summary CSV"),
  elements.csvMenu.innerHTML,
);

console.log("[export content]");
vm.runInContext("downloadAppSummary()", ctx);
check(
  "file named app_summary_<date>.csv",
  downloads.length === 1 &&
    /^app_summary_\d{4}-\d{2}-\d{2}\.csv$/.test(downloads[0].name),
  JSON.stringify(downloads.map((d) => d.name)),
);
const rawCsv = downloads[0].blob.content;
// Excel needs the BOM to read the file as UTF-8; everything else ignores it
check("CSV starts with a UTF-8 BOM", rawCsv.charCodeAt(0) === 0xfeff);
const lines = rawCsv.replace(/^﻿/, "").split("\n");
check(
  "header row",
  lines[0] ===
    "App Name,VMs,Total vCPUs,Total Memory (GB),Matched VMs,No-Match VMs",
  lines[0],
);
check("6 data rows", lines.length === 7, String(lines.length));
check(
  "formula-injection hardened for = + - @ prefixes",
  ["'=Evil", "'+Evil", "'-Evil", "'@Evil"].every((needle) =>
    lines.some((l) => l.startsWith(needle)),
  ),
  downloads[0].blob.content,
);
check(
  "Storefront row present with totals",
  lines.some((l) => l.startsWith("Storefront,2,6,24,2,0")),
  downloads[0].blob.content,
);

console.log("[stats bar chip]");
const statsHtml = vm.runInContext("_buildStatsHtml(processedResults)", ctx);
check(
  '"6 apps" chip rendered',
  statsHtml.includes("<strong>6</strong> apps"),
  statsHtml,
);
const noAppStats = vm.runInContext(
  '_buildStatsHtml([{ "VM Name": "x", "CPU Count": "2", "AWS Like-to-Like Instance": "m5.large" }])',
  ctx,
);
check("no apps chip without App Name column", !noAppStats.includes("apps"));

process.exit(failures ? 1 : 0);

// Input hygiene: bad rows are named, with the row numbers a spreadsheet shows,
// before the run rather than after — and a clean file says nothing at all.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

function buildContext() {
  const elements = {};
  const toasts = [];
  function fakeElement(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        innerHTML: "",
        className: "",
        textContent: "",
        style: {},
        value: "",
        checked: false,
        classes: new Set(["hidden"]),
        classList: {
          add: (c) => elements[id].classes.add(c),
          remove: (c) => elements[id].classes.delete(c),
          toggle: () => {},
          contains: (c) => elements[id].classes.has(c),
        },
        addEventListener: () => {},
        querySelectorAll: () => [],
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
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
  sandbox.window = sandbox;
  sandbox.document = {
    createElement: (tag) => ({ tag, style: {} }),
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
  // Capture toasts rather than rendering them
  ctx.showToast = (message, type) => toasts.push({ message, type });
  return { ctx, elements, toasts };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

// Drive the real entry point, so the report is whatever a CSV upload produces.
const ingest = (ctx, csv) =>
  vm.runInContext(`parseCSV(${JSON.stringify(csv)})`, ctx);
const panel = (elements) => elements.inputHygieneSection;
const rows = (ctx) => vm.runInContext("csvData", ctx);

const CLEAN = `VM Name,CPU Count,Memory (GB),CPU Utilization,AWS Region
web-01,4,16,45,us-east-1
db-02,8,32,70,us-west-2`;

console.log("[a clean file says nothing]");
{
  const { ctx, elements } = buildContext();
  ingest(ctx, CLEAN);
  check(
    "no panel, no noise",
    panel(elements).classes.has("hidden") && panel(elements).innerHTML === "",
    panel(elements).innerHTML,
  );
}

console.log("[rows that cannot size are named, with their row numbers]");
{
  const { ctx, elements } = buildContext();
  // Row 2 is fine. Row 3 has no CPU, row 4 has zero memory, row 5 has a CPU
  // count no provider sells, row 6 reports 140% utilization.
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),CPU Utilization,AWS Region
web-01,4,16,45,us-east-1
no-cpu,,16,50,us-east-1
no-mem,4,0,50,us-east-1
huge,9999,16,50,us-east-1
over,4,16,140,us-east-1`,
  );
  const html = panel(elements).innerHTML;
  check("the panel is shown", !panel(elements).classes.has("hidden"));
  check(
    "missing CPU is reported against row 3",
    /CPU count is missing or zero[^<]*1 row \(3\)/.test(html),
    html,
  );
  check(
    "zero memory is reported against row 4",
    /Memory is missing or zero[^<]*1 row \(4\)/.test(html),
    html,
  );
  check(
    "an impossible CPU count is reported against row 5",
    /CPU count above 512[^<]*1 row \(5\)/.test(html),
    html,
  );
  check(
    "utilization outside 0–100% is reported against row 6",
    /CPU utilization outside 0–100%[^<]*1 row \(6\)/.test(html),
    html,
  );
  // The row numbers are the ones the user sees in their spreadsheet: the header
  // is row 1, so the first data row is 2. Off-by-one here sends them hunting.
  check(
    "the good row is never mentioned",
    !html.includes("(2)") && !/\(2,/.test(html),
    html,
  );
  check(
    "but the file still loads — a report, not a gate",
    rows(ctx).length === 5,
  );
}

console.log("[duplicate names are a question, not a verdict]");
{
  const { ctx, elements, toasts } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1
db-02,8,32,us-east-1
web-01,4,16,us-west-2`,
  );
  const html = panel(elements).innerHTML;
  check(
    "the repeated name and both its rows are named",
    /web-01[^<]*rows 2, 4/.test(html),
    html,
  );
  check(
    "both answers are offered rather than one being taken",
    html.includes("mergeDuplicateVmNames()") &&
      html.includes("keepDuplicateVmNames()"),
  );
  check("nothing is dropped until asked", rows(ctx).length === 3);

  ctx.mergeDuplicateVmNames();
  check(
    "merging keeps the first of each name",
    rows(ctx).length === 2 &&
      rows(ctx)
        .map((r) => r["AWS Region"])
        .join(",") === "us-east-1,us-east-1",
    JSON.stringify(rows(ctx)),
  );
  check(
    "and the panel clears, because the question is answered",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );
  check(
    "the user is told what was removed",
    toasts.some((t) => /Removed 1 duplicate row/.test(t.message)),
    JSON.stringify(toasts),
  );
}

console.log("[keeping duplicates stops the question being re-asked]");
{
  const { ctx, elements } = buildContext();
  const dupes = `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1
web-01,4,16,us-west-2`;
  ingest(ctx, dupes);
  ctx.keepDuplicateVmNames();
  check(
    "the panel clears and every row survives",
    panel(elements).classes.has("hidden") && rows(ctx).length === 2,
  );
  // The report is recomputed from the data, so a dismissal that lived inside it
  // would simply be regenerated on the next render.
  ctx.reportInputHygiene();
  check(
    "and it stays cleared on a re-render",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );

  // But the answer belonged to THAT file. A new upload must ask again.
  ingest(ctx, dupes);
  check(
    "a fresh upload asks again",
    !panel(elements).classes.has("hidden") &&
      panel(elements).innerHTML.includes("keepDuplicateVmNames()"),
    panel(elements).innerHTML,
  );
}

console.log("[a long list of bad rows is summarised, not dumped]");
{
  const { ctx, elements } = buildContext();
  const many = Array.from({ length: 20 }, (_, i) => `vm-${i},0,16,us-east-1`);
  ingest(ctx, ["VM Name,CPU Count,Memory (GB),AWS Region", ...many].join("\n"));
  const html = panel(elements).innerHTML;
  check(
    "all 20 are counted but only the first few listed",
    /20 rows \(2, 3, 4, 5, 6, 7, 8, 9 and 12 more\)/.test(html),
    html,
  );
}

process.exit(failures ? 1 : 0);

// Paste-from-spreadsheet: tab-separated text goes through the same pipeline as
// an upload — same column mapping, same unit sniffing, same hygiene check.
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
        focused: false,
        classes: new Set(["hidden"]),
        classList: {
          add: (c) => elements[id].classes.add(c),
          remove: (c) => elements[id].classes.delete(c),
          toggle: (c) =>
            elements[id].classes.has(c)
              ? elements[id].classes.delete(c)
              : elements[id].classes.add(c),
          contains: (c) => elements[id].classes.has(c),
        },
        focus: () => {
          elements[id].focused = true;
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

const rows = (ctx) => vm.runInContext("csvData", ctx);
const headers = (ctx) => vm.runInContext("columnHeaders", ctx);

// Paste `text` as if typed into the textarea, then press "Use this data".
// The stub only conjures an element once something asks for it by id, and
// renderPasteControl writes innerHTML rather than looking the textarea up — so
// ask for it here, the way a browser would already have it.
const textarea = (ctx) => ctx.document.getElementById("pasteInput");

function paste(ctx, ctxElements, text) {
  ctx.renderPasteControl();
  textarea(ctx).value = text;
  ctx.ingestPastedData();
}

const TAB = "\t";

console.log("[a spreadsheet paste is tab-separated, and is read as such]");
{
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    [
      ["VM Name", "CPU Count", "Memory (GB)", "AWS Region"].join(TAB),
      ["web-01", "4", "16", "us-east-1"].join(TAB),
      ["db-02", "8", "32", "us-west-2"].join(TAB),
    ].join("\n"),
  );
  check("both rows load", rows(ctx).length === 2, JSON.stringify(rows(ctx)));
  check(
    "the columns are split on tabs, not swallowed into one",
    headers(ctx).length === 4 && rows(ctx)[0]["CPU Count"] === "4",
    JSON.stringify(rows(ctx)[0]),
  );
}

console.log("[a comma-separated paste still works]");
{
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1`,
  );
  check(
    "commas are read when there are no tabs",
    rows(ctx).length === 1 && rows(ctx)[0]["VM Name"] === "web-01",
    JSON.stringify(rows(ctx)),
  );
}

console.log("[a quoted field containing the delimiter survives]");
{
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    `VM Name,CPU Count,Memory (GB)
"srv-01, prod",4,16`,
  );
  check(
    "the comma inside quotes does not split the cell",
    rows(ctx)[0]["VM Name"] === "srv-01, prod",
    JSON.stringify(rows(ctx)[0]),
  );
}

console.log("[the paste goes through the SAME pipeline as an upload]");
{
  // Not canonical headers, and memory in MiB with nothing in the name to say so
  // — the mapping, the synonyms and the value-based unit sniffing must all apply
  // to pasted rows exactly as they do to a file.
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    [
      ["Hostname", "vCPUs", "Memory"].join(TAB),
      ["web-01", "4", "16384"].join(TAB),
      ["db-02", "8", "65536"].join(TAB),
    ].join("\n"),
  );
  check(
    "synonyms are mapped (Hostname → VM Name, vCPUs → CPU Count)",
    rows(ctx)[0]["VM Name"] === "web-01" && rows(ctx)[0]["CPU Count"] === "4",
    JSON.stringify(rows(ctx)[0]),
  );
  check(
    "and MiB values are converted, as they would be from a file",
    rows(ctx)
      .map((r) => r["Memory (GB)"])
      .join(",") === "16,64",
    JSON.stringify(rows(ctx).map((r) => r["Memory (GB)"])),
  );
}

console.log("[the hygiene check runs on pasted rows too]");
{
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    [
      ["VM Name", "CPU Count", "Memory (GB)"].join(TAB),
      ["web-01", "4", "16"].join(TAB),
      ["broken", "0", "16"].join(TAB),
    ].join("\n"),
  );
  check(
    "a zero CPU count in a paste is reported, against row 3",
    !elements.inputHygieneSection.classes.has("hidden") &&
      /CPU count is missing or zero[^<]*1 row \(3\)/.test(
        elements.inputHygieneSection.innerHTML,
      ),
    elements.inputHygieneSection.innerHTML,
  );
}

console.log("[the classic paste mistakes are named, not swallowed]");
{
  const { ctx, elements, toasts } = buildContext();
  ctx.renderPasteControl();
  textarea(ctx).value = "   ";
  ctx.ingestPastedData();
  check(
    "an empty paste says so and loads nothing",
    rows(ctx).length === 0 &&
      toasts.some((t) => /Paste some rows first/.test(t.message)),
    JSON.stringify(toasts),
  );
}
{
  const { ctx, elements, toasts } = buildContext();
  // The header row was selected and the data underneath it was not — the single
  // most common way to get this wrong.
  paste(ctx, elements, ["VM Name", "CPU Count", "Memory (GB)"].join(TAB));
  check(
    "a header with no rows under it is called out",
    rows(ctx).length === 0 &&
      toasts.some((t) => /header row with no data under it/.test(t.message)),
    JSON.stringify(toasts),
  );
}

console.log("[a paste replaces the file, and says nothing stale]");
{
  const { ctx, elements } = buildContext();
  ctx.document.getElementById("csvFile").value = "old-inventory.csv";
  paste(
    ctx,
    elements,
    [
      ["VM Name", "CPU Count", "Memory (GB)"].join(TAB),
      ["web-01", "4", "16"].join(TAB),
    ].join("\n"),
  );
  check(
    "the previous file name is cleared, since it no longer describes the data",
    elements.csvFile.value === "",
    elements.csvFile.value,
  );
  check(
    "and the status says the data was pasted",
    /Pasted data loaded/.test(elements.fileStatus.innerHTML),
    elements.fileStatus.innerHTML,
  );
}

process.exit(failures ? 1 : 0);

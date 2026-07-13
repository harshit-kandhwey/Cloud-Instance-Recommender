// The saved-mapping manager: a column mapping confirmed once is reapplied to
// every later file with the same headers, silently. That is the point — and it
// is also why a mistake made once repeats forever. It must be visible, and it
// must be possible to forget.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const KEY = "cloudInstanceRecommenderColumnMaps";

function buildContext() {
  const elements = {};
  const toasts = [];
  const store = new Map();
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
    // A REAL store — the feature is entirely about what survives, so a stub that
    // forgets everything would let every assertion here pass vacuously.
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
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
  return { ctx, elements, toasts, store };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

const ingest = (ctx, csv) =>
  vm.runInContext(`parseCSV(${JSON.stringify(csv)})`, ctx);
const rows = (ctx) => vm.runInContext("csvData", ctx);
const panel = (elements) => elements.savedMappingsSection;
const saved = (store) => JSON.parse(store.get(KEY) || "{}");

// Ambiguous on purpose: "VM" and "Host" are both VM-name synonyms and nothing
// identifies the tool, so the mapping panel opens and an answer must be given.
const AMBIGUOUS = `VM,CPUs,Memory (GB),Host
web-01,4,16,esxi-07
web-02,8,32,esxi-07`;

// Answer the open mapping panel the way a user would: pick the source column for
// each canonical, then confirm. Each select is keyed by the canonical's position
// and carries the source header's INDEX as its value, not its name.
function confirmMapping(ctx, choices) {
  const pending = ctx.window._pendingIngest;
  const canonicals = ctx.pageCanonicals();
  for (const [canonical, source] of Object.entries(choices)) {
    const select = ctx.document.getElementById(
      `colmap_${canonicals.indexOf(canonical)}`,
    );
    select.value = String(pending.headers.indexOf(source));
  }
  ctx.applyColumnMapping();
}

console.log("[nothing remembered, nothing shown]");
{
  const { ctx, elements } = buildContext();
  ctx.renderSavedMappings();
  check(
    "no panel when there is nothing to forget",
    panel(elements).classes.has("hidden") && panel(elements).innerHTML === "",
  );
}

console.log("[an answer is remembered, and reapplied without asking]");
{
  const { ctx, elements, store } = buildContext();
  ingest(ctx, AMBIGUOUS);
  check(
    "the ambiguous file stops to ask",
    !elements.columnMappingSection.classes.has("hidden") &&
      rows(ctx).length === 0,
  );

  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });
  check(
    "confirming applies it",
    rows(ctx).length === 2 && rows(ctx)[0]["VM Name"] === "web-01",
    JSON.stringify(rows(ctx)[0]),
  );
  check(
    "and it is written to storage",
    Object.keys(saved(store)).length === 1,
    store.get(KEY),
  );

  // The whole reason the manager has to exist: this file never asks again.
  const second = buildContextFrom(store);
  ingest(second.ctx, AMBIGUOUS);
  check(
    "a later file with the same headers is mapped silently, without asking",
    second.elements.columnMappingSection.classes.has("hidden") &&
      rows(second.ctx).length === 2 &&
      rows(second.ctx)[0]["VM Name"] === "web-01",
    JSON.stringify(rows(second.ctx)),
  );
}

console.log("[what is remembered is visible]");
{
  const { ctx, elements } = buildContext();
  ingest(ctx, AMBIGUOUS);
  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });

  const html = panel(elements).innerHTML;
  check(
    "the panel appears once something is remembered",
    !panel(elements).classes.has("hidden"),
  );
  check(
    "and names the renames the user actually agreed to",
    /VM → VM Name/.test(html) && /CPUs → CPU Count/.test(html),
    html,
  );
  check("with a way to forget it", /forgetColumnMapping\(/.test(html), html);
}

console.log("[forgetting means the next file asks again]");
{
  const { ctx, elements, store, toasts } = buildContext();
  ingest(ctx, AMBIGUOUS);
  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });
  const signature = Object.keys(saved(store))[0];

  ctx.forgetColumnMapping(signature);
  check("it is gone from storage", Object.keys(saved(store)).length === 0);
  check(
    "the panel goes away with it",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );
  check(
    "and the user is told what that means",
    toasts.some((t) => /ask again/.test(t.message)),
    JSON.stringify(toasts),
  );

  // The point of forgetting: the mistake is not repeated.
  const after = buildContextFrom(store);
  ingest(after.ctx, AMBIGUOUS);
  check(
    "the same file now stops to ask once more",
    !after.elements.columnMappingSection.classes.has("hidden") &&
      rows(after.ctx).length === 0,
  );
}

console.log("[forget-all clears every remembered mapping]");
{
  const { ctx, elements, store } = buildContext();
  ingest(ctx, AMBIGUOUS);
  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });
  // A different header set, also ambiguous ("Server" and "Host" both look like a
  // VM name), so it too has to be answered — and so it too is remembered.
  ingest(
    ctx,
    `Server,Host,vCPUs,RAM
db-01,esxi-09,8,32`,
  );
  confirmMapping(ctx, {
    "VM Name": "Server",
    "CPU Count": "vCPUs",
    "Memory (GB)": "RAM",
  });
  check(
    "two mappings remembered",
    Object.keys(saved(store)).length === 2,
    store.get(KEY),
  );

  ctx.forgetAllColumnMappings();
  check("all cleared", Object.keys(saved(store)).length === 0);
  check("and the panel is gone", panel(elements).classes.has("hidden"));
}

// Rebuild a context that shares an existing store, to model a later visit.
function buildContextFrom(store) {
  const built = buildContext();
  for (const [k, v] of store) built.store.set(k, v);
  return built;
}

process.exit(failures ? 1 : 0);

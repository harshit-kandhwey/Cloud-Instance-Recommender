// Step 6 verification: preview search filter — filtering, counts, sort
// interaction, focus restore, debounce.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

const elements = {};
let focusCalls = 0;
function fakeElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      innerHTML: "",
      className: "",
      style: {},
      value: "",
      selectionStart: null,
      classes: new Set(["hidden"]),
      classList: {
        add: (c) => elements[id].classes.add(c),
        remove: (c) => elements[id].classes.delete(c),
        toggle: () => {},
        contains: (c) => elements[id].classes.has(c),
      },
      addEventListener: () => {},
      querySelectorAll: () => [],
      focus: () => focusCalls++,
      setSelectionRange: (a) => (elements[id]._cursor = a),
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
  alert: () => {},
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
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}
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

(async () => {
  // 25 result rows: web-01..web-20 (m5.large), db-01..db-05 (r6i.xlarge)
  const results = [];
  for (let i = 1; i <= 20; i++) {
    results.push({
      "VM Name": `web-${String(i).padStart(2, "0")}`,
      "CPU Count": "2",
      "Memory (GB)": "8",
      "AWS Rules Applied": "",
      "AWS No Match Reason": "",
      "AWS Like-to-Like Instance": "m5.large",
      "AWS Like-to-Like vCPUs": 2,
      "AWS Like-to-Like Memory (GiB)": 8,
    });
  }
  for (let i = 1; i <= 5; i++) {
    results.push({
      "VM Name": `db-${String(i).padStart(2, "0")}`,
      "CPU Count": "4",
      "Memory (GB)": "32",
      "AWS Rules Applied": "",
      "AWS No Match Reason": "",
      "AWS Like-to-Like Instance": "r6i.xlarge",
      "AWS Like-to-Like vCPUs": 4,
      "AWS Like-to-Like Memory (GiB)": 32,
    });
  }

  vm.runInContext(`showResultsPreview(${JSON.stringify(results)})`, ctx);
  const container = elements.resultsPreviewSection;

  console.log("[initial render]");
  check(
    "search input rendered",
    container.innerHTML.includes('id="previewSearch"'),
  );
  check(
    "unfiltered count",
    container.innerHTML.includes("first 20 of 25 rows"),
  );

  console.log("[filtering]");
  ctx._previewFilterChanged("db-");
  await new Promise((r) => setTimeout(r, 250)); // wait out the 150ms debounce
  check(
    "filtered count line",
    container.innerHTML.includes("first 5 of 5 matching rows (25 total)"),
    container.innerHTML.match(/Results Preview \([^)]*\)/)?.[0],
  );
  check(
    "only db rows shown",
    !container.innerHTML.includes("web-01") &&
      container.innerHTML.includes("db-05"),
  );
  check("input value restored", elements.previewSearch.value === "db-");
  check("focus restored", focusCalls > 0);

  console.log("[debounce coalesces]");
  const renders0 = focusCalls;
  ctx._previewFilterChanged("r");
  ctx._previewFilterChanged("r6");
  ctx._previewFilterChanged("r6i");
  await new Promise((r) => setTimeout(r, 250));
  check(
    "three keystrokes → one re-render",
    focusCalls === renders0 + 1,
    `focusCalls=${focusCalls}`,
  );
  check(
    "value filter matches instance col",
    container.innerHTML.includes("first 5 of 5 matching rows"),
  );

  console.log("[sort while filtered]");
  ctx._sortPreview(0); // sort by VM Name
  check(
    "filter survives sort",
    container.innerHTML.includes("matching rows (25 total)"),
  );
  check(
    "sorted + filtered rows",
    container.innerHTML.indexOf("db-01") < container.innerHTML.indexOf("db-05"),
  );
  check("input value survives sort", elements.previewSearch.value === "r6i");

  console.log("[no matches]");
  ctx._previewFilterChanged("zzz-nothing");
  await new Promise((r) => setTimeout(r, 250));
  check("no-match message", container.innerHTML.includes("No rows match"));
  check(
    "zero count",
    container.innerHTML.includes("first 0 of 0 matching rows (25 total)"),
  );

  console.log("[clear filter]");
  ctx._previewFilterChanged("");
  await new Promise((r) => setTimeout(r, 250));
  check(
    "back to unfiltered",
    container.innerHTML.includes("first 20 of 25 rows"),
  );

  // A download must never silently disagree with the screen: it follows the
  // preview's sort, ignores its filter, and says so while a filter is active.
  console.log("[exports vs preview state]");
  ctx._sortPreview(0); // toggles the existing VM Name ascending sort → descending
  ctx._previewFilterChanged("db-");
  await new Promise((r) => setTimeout(r, 250));

  check(
    "filtered preview discloses the full download size",
    container.innerHTML.includes(
      "Downloads always contain the full 25-row dataset",
    ),
    container.innerHTML.slice(-300),
  );

  const ordered = ctx.resultsInPreviewOrder(results);
  check("export keeps every row despite the filter", ordered.length === 25);
  check(
    "export follows the preview's sort order",
    ordered[0]["VM Name"] === "web-20" &&
      ordered[ordered.length - 1]["VM Name"] === "db-01",
    `${ordered[0]["VM Name"]} … ${ordered[ordered.length - 1]["VM Name"]}`,
  );
  check("source results not mutated", results[0]["VM Name"] === "web-01");

  // Results describe the providers selected when Generate ran; changing the
  // checkboxes afterwards re-runs nothing, so the drift has to be surfaced.
  console.log("[stale results notice]");
  // `processedResults` and `selectedProviders` are `let` bindings in app-core.js,
  // so they must be assigned inside the context — a property on the sandbox
  // object would just sit there, shadowed.
  const setProviders = (list) =>
    vm.runInContext(`selectedProviders = ${JSON.stringify(list)}`, ctx);
  vm.runInContext(`processedResults = ${JSON.stringify(results)}`, ctx);
  setProviders(["aws", "azure"]);
  ctx._resultsProviders = ["aws", "azure"];
  ctx.updateStaleResultsNotice();
  check(
    "selection unchanged → no notice",
    elements.resultsStaleNotice.classes.has("hidden"),
  );

  setProviders(["aws"]);
  ctx.updateStaleResultsNotice();
  check(
    "provider removed after generating → notice shown",
    !elements.resultsStaleNotice.classes.has("hidden") &&
      elements.resultsStaleNotice.innerHTML.includes("AWS, Azure"),
    elements.resultsStaleNotice.innerHTML,
  );

  setProviders(["aws", "azure", "gcp"]);
  ctx.updateStaleResultsNotice();
  check(
    "provider added after generating → notice shown",
    !elements.resultsStaleNotice.classes.has("hidden"),
  );

  setProviders(["azure", "aws"]);
  ctx.updateStaleResultsNotice();
  check(
    "same providers reordered → no notice",
    elements.resultsStaleNotice.classes.has("hidden"),
  );

  vm.runInContext("processedResults = null", ctx);
  setProviders(["gcp"]);
  ctx.updateStaleResultsNotice();
  check(
    "no results yet → no notice",
    elements.resultsStaleNotice.classes.has("hidden"),
  );

  // Toasts replaced window.alert everywhere the app talks to the user.
  console.log("[toasts]");
  // fakeElement() creates on first lookup, so ask for it rather than reaching
  // into the map before anything has rendered
  const stack = ctx.document.getElementById("toastStack");

  const infoId = ctx.showToast("Saved the thing", "success", 0);
  check(
    "toast renders its message and is revealed",
    stack.innerHTML.includes("Saved the thing") && !stack.classes.has("hidden"),
    stack.innerHTML,
  );
  check(
    "success tone uses the theme token, not a hardcoded colour",
    stack.innerHTML.includes("var(--good-strong)"),
    stack.innerHTML,
  );

  ctx.showToast("Something broke", "error", 0);
  check(
    "a second toast stacks rather than replacing the first",
    stack.innerHTML.includes("Saved the thing") &&
      stack.innerHTML.includes("Something broke"),
  );
  check(
    "error tone is announced assertively enough to differ from info",
    stack.innerHTML.includes("var(--red-strong)"),
  );

  ctx.dismissToast(infoId);
  check(
    "dismissing one leaves the other",
    !stack.innerHTML.includes("Saved the thing") &&
      stack.innerHTML.includes("Something broke"),
    stack.innerHTML,
  );

  // A message is user data — a VM named `<img onerror=...>` must not execute
  ctx.showToast('<img src=x onerror="boom">', "info", 0);
  check(
    "message is escaped, not injected",
    !stack.innerHTML.includes("<img src=x") &&
      stack.innerHTML.includes("&lt;img"),
    stack.innerHTML,
  );

  // Auto-dismiss
  const tempId = ctx.showToast("Briefly", "info", 30);
  check("timed toast shown", stack.innerHTML.includes("Briefly"));
  await new Promise((r) => setTimeout(r, 80));
  check(
    "timed toast auto-dismisses",
    !stack.innerHTML.includes("Briefly"),
    stack.innerHTML,
  );
  check(
    "dismissing an already-gone toast is a no-op",
    (() => {
      ctx.dismissToast(tempId);
      return true;
    })(),
  );

  // Every CSV export goes through downloadCsv, which prepends a BOM so Excel
  // reads the file as UTF-8 instead of the local ANSI codepage
  console.log("[csv encoding]");
  {
    // This suite's fake DOM has no URL/Blob and its nodes have no click(),
    // since nothing else here downloads anything
    const captured = [];
    const realCreateElement = ctx.document.createElement;
    ctx.Blob = class {
      constructor(parts) {
        this.content = parts.join("");
        captured.push(this.content);
      }
    };
    ctx.URL = { createObjectURL: () => "blob:x", revokeObjectURL: () => {} };
    ctx.document.createElement = (tag) => ({ tag, style: {}, click() {} });

    ctx.downloadCsv("VM Name\nweb-münchen-01\n日本-db-02", "x.csv");
    const out = captured[0];
    check("BOM is the first character", out.charCodeAt(0) === 0xfeff);
    check(
      "non-ASCII names survive intact",
      out.includes("web-münchen-01") && out.includes("日本-db-02"),
      out,
    );

    ctx.document.createElement = realCreateElement;
  }

  // Guard the migration: alert() blocks the page and ignores the theme
  const productSources = [
    "js/base/app-core.js",
    "js/base/generate.js",
    "js/base/downloads.js",
    "js/base/ingest.js",
    "js/base/manual-entry.js",
    "js/base/preview.js",
    "js/base/presets.js",
    "js/base/xlsx-export.js",
    "js/base/scenario-compare.js",
    "js/base/portfolio.js",
    "js/base/form-controls.js",
  ];
  const offenders = productSources.filter((rel) => {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    // strip line comments so app-core's explanatory prose doesn't count
    return /(^|[^.\w])alert\s*\(/.test(src.replace(/\/\/.*$/gm, ""));
  });
  check(
    "no window.alert left in the product",
    offenders.length === 0,
    `still calling alert(): ${offenders.join(", ")}`,
  );

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

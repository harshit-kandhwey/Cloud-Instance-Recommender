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

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

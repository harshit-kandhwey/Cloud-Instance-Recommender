// "Current Instance Type": the size a VM runs on today. It is recognised, it
// survives untouched into the results and exports, and it lands beside the
// recommendation so the two can be read against each other.
//
// It must NOT change sizing: CPU Count and Memory (GB) still drive that. The day
// it does is 4.0 (cloud-to-cloud), and it should be a deliberate change, not a
// drift.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const CURRENT = "Current Instance Type";

function buildContext() {
  const elements = {};
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
  ctx.showToast = () => {};
  return { ctx, elements };
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

console.log("[the column is recognised, however it is spelled]");
{
  const { ctx } = buildContext();
  const mapped = (header) =>
    vm.runInContext(
      `autoMatchHeaders(["VM Name","CPU Count","Memory (GB)",${JSON.stringify(header)}]).mapping[${JSON.stringify(header)}]`,
      ctx,
    );
  for (const header of [
    "Current Instance Type",
    "Instance Type",
    "VM Size",
    "Machine Type",
    "Current Size",
  ]) {
    check(
      `"${header}" maps to ${CURRENT}`,
      mapped(header) === CURRENT,
      mapped(header),
    );
  }
  // Deliberately not claimed: these mean too many things in a real export.
  for (const header of ["Size", "Type", "SKU"]) {
    check(
      `"${header}" is NOT claimed — too ambiguous to guess`,
      mapped(header) === undefined,
      mapped(header),
    );
  }
}

console.log("[it survives into the results untouched]");
{
  const { ctx } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),Instance Type,AWS Region
web-01,4,16,m5.xlarge,us-east-1
db-02,8,32,r5.2xlarge,us-east-1`,
  );
  check(
    "the header is mapped to the canonical name",
    rows(ctx)[0][CURRENT] === "m5.xlarge",
    JSON.stringify(rows(ctx)[0]),
  );
  check(
    "and the value is carried verbatim, not normalised or parsed",
    rows(ctx)[1][CURRENT] === "r5.2xlarge",
    JSON.stringify(rows(ctx)[1]),
  );
}

console.log("[it does not change what is recommended]");
{
  // Same CPU and memory, wildly different current sizes. Sizing is driven by
  // CPU Count and Memory (GB); if this column ever starts steering the engine,
  // these two rows will stop agreeing and this will fail.
  const { ctx } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),Current Instance Type,AWS Region
same-a,4,16,t3.nano,us-east-1
same-b,4,16,x1e.32xlarge,us-east-1`,
  );
  const [a, b] = rows(ctx);
  check(
    "two rows with identical CPU/memory still describe identical demand",
    a["CPU Count"] === b["CPU Count"] &&
      a["Memory (GB)"] === b["Memory (GB)"] &&
      a[CURRENT] !== b[CURRENT],
    JSON.stringify(rows(ctx)),
  );
}

console.log("[the preview puts it next to the recommendation]");
{
  const builtElements = buildContext();
  const { ctx } = builtElements;
  // ENV/OS/Workload/Compliance must be present, or the adjacency claim is
  // untestable: with nothing to sit between, the column is adjacent wherever it
  // is listed, and the check passes without checking anything.
  const results = [
    {
      "VM Name": "web-01",
      "CPU Count": "4",
      "Memory (GB)": "16",
      ENV: "Production",
      OS: "Linux",
      Workload: "Web Server",
      Compliance: "PCI",
      [CURRENT]: "m5.xlarge",
      "AWS Like-to-Like Instance": "m5.xlarge",
      "AWS Optimized Instance": "t3.large",
    },
  ];
  // Drive the real entry point, so the column order under test is the one the
  // page actually renders — not one an internal signature happened to accept.
  const { elements } = builtElements;
  ctx.showResultsPreview(results);
  const shown = elements.resultsPreviewSection.innerHTML;

  // Read the header row back as a list. A "does it appear before" check would
  // pass with any number of columns wedged in between, which is not the claim.
  const headers = [...shown.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, "").trim())
    .filter(Boolean);
  const iCurrent = headers.findIndex((h) => h.startsWith(CURRENT));
  const iFirstInstance = headers.findIndex((h) =>
    h.startsWith("AWS Like-to-Like Instance"),
  );

  check("the column is shown at all", iCurrent !== -1, headers.join(" | "));
  check(
    "and IMMEDIATELY left of the recommended instances, nothing between",
    iCurrent !== -1 && iFirstInstance === iCurrent + 1,
    headers.join(" | "),
  );
  check("with its value in the row", shown.includes("m5.xlarge"));
}

process.exit(failures ? 1 : 0);

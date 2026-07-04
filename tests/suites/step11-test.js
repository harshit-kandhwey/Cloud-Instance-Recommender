// Manual VM entry verification: form flow, validation, persistence, and
// hand-off into the shared ingest pipeline.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

function buildContext(seedStorage) {
  const elements = {};
  const storage = Object.assign({}, seedStorage || {});
  function fakeElement(id) {
    if (!elements[id]) {
      elements[id] = {
        id, innerHTML: "", className: "", style: {}, value: "",
        classes: new Set(["hidden"]),
        classList: {
          add: (c) => elements[id].classes.add(c),
          remove: (c) => elements[id].classes.delete(c),
          toggle: () => {}, contains: (c) => elements[id].classes.has(c),
        },
        addEventListener: () => {}, querySelectorAll: () => [],
        focus: () => {}, setSelectionRange: () => {}, scrollIntoView: () => {},
        setAttribute: () => {}, getAttribute: () => null,
      };
    }
    return elements[id];
  }
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    alerts: [],
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
  };
  sandbox.alert = (m) => sandbox.alerts.push(m);
  sandbox.confirm = () => true;
  sandbox.window = sandbox;
  sandbox.document = {
    createElement: (tag) => ({ tag, style: {}, setAttribute: () => {} }),
    getElementById: (id) => fakeElement(id),
    querySelectorAll: (sel) => (sel === "script[src]" ? [{ src: "js/aws/aws-data.js" }] : []),
    addEventListener: () => {},
    head: {
      appendChild(script) {
        if (script.tag !== "script") return;
        setTimeout(() => {
          try {
            const code = fs.readFileSync(path.join(REPO, script.src), "utf8");
            vm.runInContext(code, ctx, { filename: script.src });
            script.onload && script.onload();
          } catch (e) {
            script.onerror && script.onerror(e);
          }
        }, 0);
      },
    },
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
    "js/base/main-script.js",
  ]) load(f);
  return { ctx, elements, storage };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else { failures++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

// Field order on an AWS page: VM Name(0), CPU(1), Mem(2), CPU%(3), Mem%(4), AWS Region(5)
function fill(ctx, values) {
  values.forEach((v, i) => {
    ctx.document.getElementById(`manual_${i}`).value = v;
  });
}

(async () => {
  const { ctx, elements, storage } = buildContext();

  console.log("[toggle + form render]");
  ctx.toggleManualEntry();
  const section = elements.manualEntrySection;
  check("section visible", !section.classes.has("hidden"));
  check("form fields rendered", section.innerHTML.includes('id="manual_0"') && section.innerHTML.includes("Add VM"));
  check("region prefilled with default", section.innerHTML.includes('value="us-east-1"'));
  check("region datalist from manifest", section.innerHTML.includes('id="manualRegions_aws"') && section.innerHTML.includes('value="us-west-2"'));
  check("empty list hint", section.innerHTML.includes("No VMs added yet"));

  console.log("[add + validation]");
  fill(ctx, ["web-01", "4", "16", "45", "60", "us-east-1"]);
  ctx.manualAddVM();
  check("first VM added", ctx.manualVMs === undefined ? vm.runInContext("manualVMs.length", ctx) === 1 : true);
  check("list rendered", section.innerHTML.includes("web-01"));
  check("apply button with count", section.innerHTML.includes("Use these 1 VM(s)"));

  fill(ctx, ["bad-vm", "", "8", "", "", "us-east-1"]);
  ctx.manualAddVM();
  check("missing CPU rejected", vm.runInContext("manualVMs.length", ctx) === 1 && ctx.alerts.some((a) => a.includes("greater than 0")));

  fill(ctx, ["", "2", "8", "", "", "eu-west-1"]);
  ctx.manualAddVM();
  check("auto name for blank VM Name", vm.runInContext("manualVMs[1]['VM Name']", ctx) === "vm-2");
  check("sticky region remembered", vm.runInContext("window._manualRegionDefaults['AWS Region']", ctx) === "eu-west-1");
  check("persisted to localStorage", (storage["cloudInstanceRecommenderManualVMs"] || "").includes("web-01"));

  console.log("[remove]");
  ctx.manualRemoveVM(1);
  check("row removed", vm.runInContext("manualVMs.length", ctx) === 1);

  console.log("[apply → shared pipeline]");
  fill(ctx, ["db-01", "8", "32", "70", "80", "us-west-2"]);
  ctx.manualAddVM();
  ctx.manualApplyVMs();
  const data = vm.runInContext("csvData", ctx);
  check("csvData populated via ingestRows", data.length === 2, JSON.stringify(data));
  check("canonical keys", "CPU Count" in data[0] && "Memory (GB)" in data[0] && "AWS Region" in data[0]);
  check("no mapping panel (canonical headers)", elements.columnMappingSection.classes.has("hidden"));
  check("manual label in status", elements.fileStatus.innerHTML.includes("Manual entry applied"), elements.fileStatus.innerHTML);
  check("region validation ran", !!ctx._regionValidation && ctx._regionValidation.aws["us-east-1"].status === "exact");
  check("region chips rendered", !elements.regionValidationSection.classes.has("hidden"));

  console.log("[generate works on manual rows]");
  vm.runInContext("selectedProviders = ['aws']", ctx);
  const results = await ctx.getInstanceRecommendationWithSelector(
    data, ["aws"],
    { generateLikeToLike: true, generateOptimized: false, excludeTypes: [],
      selectedInstanceFamilyNames: [], selectedProcessorManufacturers: [],
      selectedMainFamilies: [], selectedAzureSeries: [], selectedAzureProcessors: [],
      selectedAzureVMFamilies: [], selectedGCPFamilies: [], selectedGCPProcessors: [],
      selectedGCPMachineTypes: [] },
  );
  check("recommendations produced", results.length === 2 && results.every((r) => r["AWS Like-to-Like Instance"] && r["AWS Like-to-Like Instance"] !== "No data available"), JSON.stringify(results.map((r) => r["AWS Like-to-Like Instance"])));

  console.log("[restore from localStorage in a fresh session]");
  {
    const { ctx: c2, elements: e2 } = buildContext({
      cloudInstanceRecommenderManualVMs: storage["cloudInstanceRecommenderManualVMs"],
    });
    c2.toggleManualEntry();
    check("saved VMs restored", vm.runInContext("manualVMs.length", c2) === 2);
    check("restored list rendered", e2.manualEntrySection.innerHTML.includes("web-01") && e2.manualEntrySection.innerHTML.includes("db-01"));
  }

  console.log("[clear all]");
  ctx.manualClearVMs();
  check("cleared", vm.runInContext("manualVMs.length", ctx) === 0);
  check("hint back", section.innerHTML.includes("No VMs added yet"));

  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// Mapping edit + MB→GB conversion verification.
// Scenario: both "Memory" (GB) and "Memory (MB)" present — now ambiguous by
// design; panel offers a unit selector; conversions and persistence checked.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

function buildContext(seedStorage, pageScripts) {
  const scripts = pageScripts || ["js/aws/aws-data.js"];
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
    querySelectorAll: (sel) =>
      sel === "script[src]" ? scripts.map((s) => ({ src: s })) : [],
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
  for (const s of scripts) load(s);
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
  return { ctx, elements, storage };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else { failures++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

// Headers: VM Name(0), vCPU(1), Memory(2), Memory (MB)(3), AWS Region(4)
const CSV = `VM Name,vCPU,Memory,Memory (MB),AWS Region
web-01,4,16,16384,us-east-1`;
const CANONICALS = ["CPU Count", "Memory (GB)", "CPU Utilization", "Memory Utilization", "VM Name", "AWS Region", "Azure Region", "GCP Region"];

function setSelects(ctx, values) {
  // values: { canonical: headerIndexString or "" }, plus optional unit
  CANONICALS.forEach((c, idx) => {
    const el = ctx.document.getElementById(`colmap_${idx}`);
    el.value = values[c] != null ? values[c] : "";
  });
  if (values.__unit != null) {
    ctx.document.getElementById("colmap_unit_mem").value = values.__unit;
  }
}

(async () => {
  const { ctx, elements, storage } = buildContext();

  console.log("[both Memory and Memory (MB) → ambiguous panel]");
  vm.runInContext(`parseCSV(${JSON.stringify(CSV)})`, ctx);
  const panel = elements.columnMappingSection;
  check("panel shown (ambiguous by design)", !panel.classes.has("hidden"));
  check("csvData deferred", vm.runInContext("csvData", ctx).length === 0);
  check("unit selector present", panel.innerHTML.includes('id="colmap_unit_mem"'));
  check("unit defaults to GB when no guess", /<option value="GB" selected>/.test(panel.innerHTML), panel.innerHTML.match(/colmap_unit_mem[\s\S]{0,300}/)?.[0]);
  check("other providers' region rows hidden on AWS page", !panel.innerHTML.includes("Azure Region") && !panel.innerHTML.includes("GCP Region"));
  check("own region row still shown", panel.innerHTML.includes("AWS Region"));

  console.log("[confirm: Memory (MB) source + MB unit → converted]");
  setSelects(ctx, { "CPU Count": "1", "Memory (GB)": "3", "VM Name": "0", "AWS Region": "4", __unit: "MB" });
  vm.runInContext("applyColumnMapping()", ctx);
  let data = vm.runInContext("csvData", ctx);
  check("16384 MB → 16 GB", data[0]["Memory (GB)"] === "16", JSON.stringify(data[0]));
  check("original Memory column kept", data[0]["Memory"] === "16");
  check("conversion note shown", elements.fileStatus.innerHTML.includes("converted from MB to GB"));
  check("units persisted", (storage["cloudInstanceRecommenderColumnMaps"] || "").includes('"units":{"Memory (GB)":"MB"}'), storage["cloudInstanceRecommenderColumnMaps"]);
  check("edit button present", elements.fileStatus.innerHTML.includes("editColumnMapping()"));

  console.log("[edit prefill + cancel]");
  ctx.editColumnMapping();
  check("prefilled source Memory (MB)", /<option value="3" selected>Memory \(MB\)<\/option>/.test(panel.innerHTML));
  check("prefilled unit MB", /<option value="MB" selected>/.test(panel.innerHTML));
  ctx.cancelColumnMapping();
  check("cancel keeps converted data", vm.runInContext("csvData", ctx)[0]["Memory (GB)"] === "16");

  console.log("[edit: switch to GB column]");
  ctx.editColumnMapping();
  setSelects(ctx, { "CPU Count": "1", "Memory (GB)": "2", "VM Name": "0", "AWS Region": "4", __unit: "GB" });
  vm.runInContext("applyColumnMapping()", ctx);
  data = vm.runInContext("csvData", ctx);
  check("GB source applied unconverted", data[0]["Memory (GB)"] === "16");
  check("no conversion note now", !elements.fileStatus.innerHTML.includes("converted from MB"));

  console.log("[replay uses last confirmed mapping]");
  vm.runInContext(`parseCSV(${JSON.stringify(CSV)})`, ctx);
  check("no panel on replay", panel.classes.has("hidden"));
  check("replayed value correct", vm.runInContext("csvData", ctx)[0]["Memory (GB)"] === "16");

  console.log("[legacy flat saved mapping still works + auto-detects MB]");
  {
    const sig = ["vm name", "vcpu", "memory", "memory (mb)", "aws region"].sort().join("|");
    const legacy = { "VM Name": "VM Name", vCPU: "CPU Count", "Memory (MB)": "Memory (GB)", "AWS Region": "AWS Region" };
    const { ctx: c2 } = buildContext({
      cloudInstanceRecommenderColumnMaps: JSON.stringify({ [sig]: legacy }),
    });
    vm.runInContext(`parseCSV(${JSON.stringify(CSV)})`, c2);
    const d2 = vm.runInContext("csvData", c2);
    check("legacy entry applied with MB auto-detect", d2.length === 1 && d2[0]["Memory (GB)"] === "16", JSON.stringify(d2[0]));
  }

  console.log("[MB-only file → silent auto-map + auto-convert]");
  {
    const { ctx: c3, elements: e3 } = buildContext();
    vm.runInContext(`parseCSV("VM Name,vCPU,Memory (MB),AWS Region\\nweb,4,8192,us-east-1")`, c3);
    const d3 = vm.runInContext("csvData", c3);
    check("silent map (single candidate)", e3.columnMappingSection.classes.has("hidden"));
    check("auto-converted 8192 → 8", d3.length === 1 && d3[0]["Memory (GB)"] === "8", JSON.stringify(d3[0]));
    check("note shown", e3.fileStatus.innerHTML.includes("converted from MB to GB"));
  }

  console.log("[non-power-of-2 rounding]");
  {
    const { ctx: c4 } = buildContext();
    vm.runInContext(`parseCSV("VM Name,vCPU,Memory (MB),AWS Region\\nweb,4,3500,us-east-1")`, c4);
    check("3500 MB → 3.42 GB", vm.runInContext("csvData", c4)[0]["Memory (GB)"] === "3.42");
  }

  console.log("[multicloud page shows all region rows]");
  {
    const { ctx: c5, elements: e5 } = buildContext(null, [
      "js/aws/aws-data.js",
      "js/azure/azure-data.js",
      "js/gcp/gcp-data.js",
    ]);
    vm.runInContext(`parseCSV(${JSON.stringify(CSV)})`, c5);
    const p5 = e5.columnMappingSection;
    check("panel shown on multicloud too", !p5.classes.has("hidden"));
    check("all three region rows present", p5.innerHTML.includes("AWS Region") && p5.innerHTML.includes("Azure Region") && p5.innerHTML.includes("GCP Region"));
  }

  console.log("[unit sync helper]");
  {
    const unitSel = ctx.document.getElementById("colmap_unit_mem");
    unitSel.value = "GB";
    ctx._syncMemUnit({ options: [{ text: "Memory (MB)" }], selectedIndex: 0 });
    check("selecting an MB column flips unit", unitSel.value === "MB");
    ctx._syncMemUnit({ options: [{ text: "Memory" }], selectedIndex: 0 });
    check("selecting a GB column flips back", unitSel.value === "GB");
  }

  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

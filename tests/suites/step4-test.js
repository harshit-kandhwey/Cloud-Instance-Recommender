// Step 4 verification: column mapping auto-match, panel flow, persistence.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

function buildContext({ pageScripts, storageThrows } = {}) {
  const elements = {};
  const storage = {};
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
          toggle: (c) => {},
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
    alerts: [],
    localStorage: storageThrows
      ? {
          getItem: () => {
            throw new Error("private mode");
          },
          setItem: () => {
            throw new Error("private mode");
          },
          removeItem: () => {},
        }
      : {
          getItem: (k) => (k in storage ? storage[k] : null),
          setItem: (k, v) => {
            storage[k] = String(v);
          },
          removeItem: (k) => {
            delete storage[k];
          },
        },
  };
  sandbox.alert = (m) => sandbox.alerts.push(m);
  sandbox.window = sandbox;
  sandbox.document = {
    createElement: (tag) => ({ tag, style: {} }),
    getElementById: (id) => fakeElement(id),
    querySelectorAll: (sel) =>
      sel === "script[src]"
        ? (pageScripts || ["js/aws/aws-data.js"]).map((s) => ({ src: s }))
        : [],
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
    vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
      filename: rel,
    });
  for (const s of pageScripts || ["js/aws/aws-data.js"]) load(s);
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
  return { ctx, elements, storage };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

function parse(ctx, csv) {
  vm.runInContext(`parseCSV(${JSON.stringify(csv)})`, ctx);
}
function getCsvData(ctx) {
  return vm.runInContext("csvData", ctx);
}
function getHeaders(ctx) {
  return vm.runInContext("columnHeaders", ctx);
}

(async () => {
  console.log("[1. canonical CSV → no panel, identity]");
  {
    const { ctx, elements } = buildContext();
    parse(ctx, "VM Name,CPU Count,Memory (GB),AWS Region\na,4,16,us-east-1");
    check("csvData populated", getCsvData(ctx).length === 1);
    check(
      "headers unchanged",
      getHeaders(ctx).join(",") === "VM Name,CPU Count,Memory (GB),AWS Region",
    );
    check("panel hidden", elements.columnMappingSection.classes.has("hidden"));
    check(
      "no rename note",
      !elements.fileStatus.innerHTML.includes("Mapped columns"),
    );
  }

  console.log("[2. synonyms CSV → silent auto-map + note]");
  {
    const { ctx, elements } = buildContext();
    parse(ctx, "Hostname,vCPUs,RAM,AWS Region\nsrv1,8,32,us-west-2");
    const data = getCsvData(ctx);
    check("csvData populated", data.length === 1);
    check(
      "keys canonical",
      "CPU Count" in data[0] &&
        "Memory (GB)" in data[0] &&
        "VM Name" in data[0],
      JSON.stringify(Object.keys(data[0])),
    );
    check(
      "values preserved",
      data[0]["CPU Count"] === "8" && data[0]["VM Name"] === "srv1",
    );
    check("headers rewritten", getHeaders(ctx).includes("CPU Count"));
    check("panel hidden", elements.columnMappingSection.classes.has("hidden"));
    check(
      "rename note shown",
      elements.fileStatus.innerHTML.includes("Mapped columns"),
      elements.fileStatus.innerHTML,
    );
    check(
      "success status",
      elements.fileStatus.className.includes("alert-success"),
    );
  }

  console.log("[3. ambiguous (collision) → panel, deferred pipeline]");
  {
    const { ctx, elements } = buildContext();
    parse(ctx, "CPU Count,vCPUs,Memory (GB),VM Name\n4,4,16,a");
    check("csvData EMPTY while pending", getCsvData(ctx).length === 0);
    check("panel shown", !elements.columnMappingSection.classes.has("hidden"));
    check(
      "panel mentions ambiguity",
      elements.columnMappingSection.innerHTML.includes(
        "several columns could match",
      ),
    );
    check(
      "generate blocked with mapping message",
      (() => {
        // selectedProviders default? ensure non-empty to reach csvData gate
        vm.runInContext("selectedProviders = ['aws']", ctx);
        vm.runInContext("generateRecommendations()", ctx);
        return ctx.alerts.some((a) => a.includes("column mapping"));
      })(),
      JSON.stringify(ctx.alerts),
    );

    // Simulate user: CPU Count ← "CPU Count" (index 0), Memory ← index 2, VM Name ← index 3
    const headers = ["CPU Count", "vCPUs", "Memory (GB)", "VM Name"];
    const canonicals = [
      "CPU Count",
      "Memory (GB)",
      "CPU Utilization",
      "Memory Utilization",
      "VM Name",
      "AWS Region",
      "Azure Region",
      "GCP Region",
    ];
    canonicals.forEach((c, idx) => {
      const el = ctx.document.getElementById(`colmap_${idx}`);
      if (c === "CPU Count") el.value = "0";
      else if (c === "Memory (GB)") el.value = "2";
      else if (c === "VM Name") el.value = "3";
      else el.value = "";
    });
    vm.runInContext("applyColumnMapping()", ctx);
    const data = getCsvData(ctx);
    check("after confirm: csvData populated", data.length === 1);
    check("after confirm: vCPUs kept as extra column", "vCPUs" in data[0]);
    check(
      "after confirm: panel hidden again",
      elements.columnMappingSection.classes.has("hidden"),
    );
  }

  console.log("[4. saved mapping replays without panel]");
  {
    const { ctx, elements, storage } = buildContext();
    // Seed storage as if the user confirmed before: same signature as below
    const saved = { Puestos: "CPU Count", Memoria: "Memory (GB)" };
    const sig = ["puestos", "memoria", "vm name"].sort().join("|");
    storage["cloudInstanceRecommenderColumnMaps"] = JSON.stringify({
      [sig]: saved,
    });
    parse(ctx, "Puestos,Memoria,VM Name\n2,8,x");
    check(
      "saved mapping auto-applied",
      getCsvData(ctx).length === 1 && "CPU Count" in getCsvData(ctx)[0],
      JSON.stringify(getCsvData(ctx)),
    );
    check(
      "panel not shown",
      elements.columnMappingSection.classes.has("hidden"),
    );
  }

  console.log("[5. private mode (localStorage throws) survives]");
  {
    const { ctx, elements } = buildContext({ storageThrows: true });
    parse(ctx, "Hostname,vCPUs,RAM\nsrv1,8,32");
    check(
      "silent auto-map still works",
      getCsvData(ctx).length === 1 && "CPU Count" in getCsvData(ctx)[0],
    );
    // Panel path + confirm (saveColumnMapping throws internally, must not break)
    parse(ctx, "CPU Count,vCPUs,Memory (GB)\n4,4,16");
    check("panel shown", !elements.columnMappingSection.classes.has("hidden"));
    const canonicals = [
      "CPU Count",
      "Memory (GB)",
      "CPU Utilization",
      "Memory Utilization",
      "VM Name",
      "AWS Region",
      "Azure Region",
      "GCP Region",
    ];
    canonicals.forEach((c, idx) => {
      const el = ctx.document.getElementById(`colmap_${idx}`);
      if (c === "CPU Count") el.value = "0";
      else if (c === "Memory (GB)") el.value = "2";
      else el.value = "";
    });
    vm.runInContext("applyColumnMapping()", ctx);
    check("confirm works despite storage throw", getCsvData(ctx).length === 1);
  }

  console.log("[6. bare Region column]");
  {
    const { ctx } = buildContext(); // single-provider page (aws)
    parse(ctx, "VM Name,CPU Count,Memory (GB),Region\na,4,16,us-east-1");
    const data = getCsvData(ctx);
    check(
      "single-provider: Region → AWS Region",
      data.length === 1 && data[0]["AWS Region"] === "us-east-1",
      JSON.stringify(data[0]),
    );
  }
  {
    const { ctx, elements } = buildContext({
      pageScripts: [
        "js/aws/aws-data.js",
        "js/azure/azure-data.js",
        "js/gcp/gcp-data.js",
      ],
    });
    parse(ctx, "VM Name,CPU Count,Memory (GB),Region\na,4,16,us-east-1");
    const data = getCsvData(ctx);
    check(
      "multicloud: Region left untouched (no guess)",
      data.length === 1 && data[0]["Region"] === "us-east-1",
      JSON.stringify(data[0]),
    );
    check(
      "multicloud: no panel for optional-only mismatch",
      elements.columnMappingSection.classes.has("hidden"),
    );
  }

  console.log("[7. required column missing entirely → panel]");
  {
    const { ctx, elements } = buildContext();
    parse(ctx, "VM Name,Sockets,Storage\na,2,100");
    check(
      "panel shown for unmatched required",
      !elements.columnMappingSection.classes.has("hidden"),
    );
    check("csvData deferred", getCsvData(ctx).length === 0);
  }

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

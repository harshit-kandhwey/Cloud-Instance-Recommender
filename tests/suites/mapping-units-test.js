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
        id,
        innerHTML: "",
        dataset: {},
        className: "",
        style: {},
        value: "",
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
        setAttribute: () => {},
        getAttribute: () => null,
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
    vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
      filename: rel,
    });
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

// Headers: VM Name(0), vCPU(1), Memory(2), Memory (MB)(3), AWS Region(4)
const CSV = `VM Name,vCPU,Memory,Memory (MB),AWS Region
web-01,4,16,16384,us-east-1`;
const CANONICALS = [
  "CPU Count",
  "Memory (GB)",
  "CPU Utilization",
  "Memory Utilization",
  "VM Name",
  "AWS Region",
  "Azure Region",
  "GCP Region",
];

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
  check(
    "unit selector present",
    panel.innerHTML.includes('id="colmap_unit_mem"'),
  );
  check(
    "unit defaults to GB when no guess",
    /<option value="GB" selected>/.test(panel.innerHTML),
    panel.innerHTML.match(/colmap_unit_mem[\s\S]{0,300}/)?.[0],
  );
  check(
    "other providers' region rows hidden on AWS page",
    !panel.innerHTML.includes("Azure Region") &&
      !panel.innerHTML.includes("GCP Region"),
  );
  check("own region row still shown", panel.innerHTML.includes("AWS Region"));

  console.log("[confirm: Memory (MB) source + MB unit → converted]");
  setSelects(ctx, {
    "CPU Count": "1",
    "Memory (GB)": "3",
    "VM Name": "0",
    "AWS Region": "4",
    __unit: "MB",
  });
  vm.runInContext("applyColumnMapping()", ctx);
  let data = vm.runInContext("csvData", ctx);
  check(
    "16384 MB → 16 GB",
    data[0]["Memory (GB)"] === "16",
    JSON.stringify(data[0]),
  );
  check("original Memory column kept", data[0]["Memory"] === "16");
  check(
    "conversion note shown",
    elements.fileStatus.innerHTML.includes("converted from MB to GB"),
  );
  check(
    "units persisted",
    // Parse and read the value — a substring match on the serialized JSON breaks
    // if the object gains another unit key or the property order shifts, even
    // though the behaviour under test is unchanged.
    Object.values(
      JSON.parse(storage["cloudInstanceRecommenderColumnMaps"] || "{}"),
    ).some((e) => e?.units?.["Memory (GB)"] === "MB"),
    storage["cloudInstanceRecommenderColumnMaps"],
  );
  check(
    "edit button present",
    elements.fileStatus.innerHTML.includes("editColumnMapping()"),
  );

  console.log("[edit prefill + cancel]");
  ctx.editColumnMapping();
  check(
    "prefilled source Memory (MB)",
    /<option value="3" selected>Memory \(MB\)<\/option>/.test(panel.innerHTML),
  );
  check(
    "prefilled unit MB",
    /<option value="MB" selected>/.test(panel.innerHTML),
  );
  ctx.cancelColumnMapping();
  check(
    "cancel keeps converted data",
    vm.runInContext("csvData", ctx)[0]["Memory (GB)"] === "16",
  );

  console.log("[edit: switch to GB column]");
  ctx.editColumnMapping();
  setSelects(ctx, {
    "CPU Count": "1",
    "Memory (GB)": "2",
    "VM Name": "0",
    "AWS Region": "4",
    __unit: "GB",
  });
  vm.runInContext("applyColumnMapping()", ctx);
  data = vm.runInContext("csvData", ctx);
  check("GB source applied unconverted", data[0]["Memory (GB)"] === "16");
  check(
    "no conversion note now",
    !elements.fileStatus.innerHTML.includes("converted from MB"),
  );

  console.log("[replay uses last confirmed mapping]");
  vm.runInContext(`parseCSV(${JSON.stringify(CSV)})`, ctx);
  check("no panel on replay", panel.classes.has("hidden"));
  check(
    "replayed value correct",
    vm.runInContext("csvData", ctx)[0]["Memory (GB)"] === "16",
  );

  console.log(
    "[a saved mapping from an older version is dropped, not replayed]",
  );
  {
    // A saved mapping short-circuits the preset, the synonyms and the unit
    // handling — the user already answered for these headers. So an entry
    // written by a version whose mapping rules have since been FIXED would
    // reapply the old bug forever, past the fix. Unversioned entries are
    // therefore discarded: the file asks again, and gets the current answer.
    const sig = ["vm name", "vcpu", "memory", "memory (mb)", "aws region"]
      .sort()
      .join("|");
    const legacy = {
      "VM Name": "VM Name",
      vCPU: "CPU Count",
      "Memory (MB)": "Memory (GB)",
      "AWS Region": "AWS Region",
    };
    const { ctx: c2, elements: e2 } = buildContext({
      cloudInstanceRecommenderColumnMaps: JSON.stringify({ [sig]: legacy }),
    });
    vm.runInContext(`parseCSV(${JSON.stringify(CSV)})`, c2);
    const d2 = vm.runInContext("csvData", c2);
    // This file has both "Memory" and "Memory (MB)" — genuinely ambiguous. With
    // the stale entry ignored, it does what any unanswered ambiguous file does:
    // it asks, rather than replaying an answer from a version that got it wrong.
    check(
      "the stale answer is not replayed",
      d2.length === 0,
      JSON.stringify(d2),
    );
    check(
      "and the file asks again",
      !e2.columnMappingSection.classes.has("hidden"),
    );
  }

  console.log(
    "[positive control: a current-version entry for the same sig IS replayed]",
  );
  {
    // The negative case above cannot, on its own, tell "stale entry rejected"
    // from "entry never matched": a typo in the sig, or a change to how the app
    // normalizes header keys, would leave BOTH entries unmatched and "not
    // replayed" would pass while testing nothing. Seed the SAME signature with a
    // CURRENT-version entry and assert it replays — that pins the sig format, so
    // the rejection above is provably about the version, not a mismatch. The
    // version is read from the module constant, not hard-coded, so a future bump
    // cannot silently turn this back into a tautology.
    const sig = ["vm name", "vcpu", "memory", "memory (mb)", "aws region"]
      .sort()
      .join("|");
    const { ctx: c6, elements: e6, storage: s6 } = buildContext();
    const V = vm.runInContext("SAVED_MAPPING_VERSION", c6);
    s6["cloudInstanceRecommenderColumnMaps"] = JSON.stringify({
      [sig]: {
        v: V,
        mapping: {
          "VM Name": "VM Name",
          vCPU: "CPU Count",
          Memory: "Memory (GB)",
          "AWS Region": "AWS Region",
        },
      },
    });
    vm.runInContext(`parseCSV(${JSON.stringify(CSV)})`, c6);
    const d6 = vm.runInContext("csvData", c6);
    check(
      "the current-version answer is replayed (no panel)",
      e6.columnMappingSection.classes.has("hidden"),
    );
    check(
      "and the saved mapping is applied",
      d6.length === 1 && d6[0]["Memory (GB)"] === "16",
      JSON.stringify(d6),
    );
  }

  console.log("[MB-only file → silent auto-map + auto-convert]");
  {
    const { ctx: c3, elements: e3 } = buildContext();
    vm.runInContext(
      `parseCSV("VM Name,vCPU,Memory (MB),AWS Region\\nweb,4,8192,us-east-1")`,
      c3,
    );
    const d3 = vm.runInContext("csvData", c3);
    check(
      "silent map (single candidate)",
      e3.columnMappingSection.classes.has("hidden"),
    );
    check(
      "auto-converted 8192 → 8",
      d3.length === 1 && d3[0]["Memory (GB)"] === "8",
      JSON.stringify(d3[0]),
    );
    check(
      "note shown",
      e3.fileStatus.innerHTML.includes("converted from MB to GB"),
    );
  }

  console.log("[non-power-of-2 rounding]");
  {
    const { ctx: c4 } = buildContext();
    vm.runInContext(
      `parseCSV("VM Name,vCPU,Memory (MB),AWS Region\\nweb,4,3500,us-east-1")`,
      c4,
    );
    check(
      "3500 MB → 3.42 GB",
      vm.runInContext("csvData", c4)[0]["Memory (GB)"] === "3.42",
    );
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
    check(
      "all three region rows present",
      p5.innerHTML.includes("AWS Region") &&
        p5.innerHTML.includes("Azure Region") &&
        p5.innerHTML.includes("GCP Region"),
    );
  }

  console.log("[unit sync helper]");
  {
    const unitSel = ctx.document.getElementById("colmap_unit_mem");
    unitSel.value = "GB";
    ctx._syncSizeUnit("colmap_unit_mem", {
      options: [{ text: "Memory (MB)" }],
      selectedIndex: 0,
    });
    check("selecting an MB column flips unit", unitSel.value === "MB");
    ctx._syncSizeUnit("colmap_unit_mem", {
      options: [{ text: "Memory" }],
      selectedIndex: 0,
    });
    check("selecting a GB column flips back", unitSel.value === "GB");
  }

  // Disk carries the same MB→GB path as memory, but the confirm handler used to
  // resolve units for memory only — so a disk in MiB, mapped through the panel,
  // was renamed to "Disk (GB)" and never divided by 1024 (a silent 1024x error,
  // the very corruption the memory unit control exists to prevent). This drives
  // the confirm path with a disk-in-MiB column and asserts it converts and
  // persists like memory does. Indices are resolved from the real panel order,
  // not assumed, so the check cannot drift if the canonical list is reordered.
  console.log("[confirm: a disk column in MiB converts, and persists]");
  {
    const fresh = buildContext();
    const c = fresh.ctx;
    const DISK_CSV = `VM Name,CPU Count,Memory,Memory (MB),Disk MiB,AWS Region
web-01,4,16,16384,102400,us-east-1`;
    vm.runInContext(`parseCSV(${JSON.stringify(DISK_CSV)})`, c);
    // Ambiguous memory forces the panel and a pending ingest to confirm.
    check(
      "panel shown for the disk file",
      !fresh.elements.columnMappingSection.classes.has("hidden"),
    );
    const order = vm.runInContext("pageCanonicals()", c);
    // Fail loudly if a canonical this scenario needs is absent from the panel:
    // indexOf would return -1, setCol would write to colmap_-1 (which fakeElement
    // happily creates), the mapping would never apply, and the 1024x disk
    // regression this guards against would slip through as an opaque assertion
    // failure — or pass by accident if the column also auto-maps.
    const at = (canonical) => {
      const i = order.indexOf(canonical);
      if (i < 0) {
        throw new Error(
          `canonical "${canonical}" missing from panel order: ${order.join(", ")}`,
        );
      }
      return i;
    };
    const setCol = (canonical, headerIdx) => {
      c.document.getElementById(`colmap_${at(canonical)}`).value =
        String(headerIdx);
    };
    setCol("VM Name", 0);
    setCol("CPU Count", 1);
    setCol("Memory (GB)", 3); // the MB column
    setCol("Disk (GB)", 4); // Disk MiB
    setCol("AWS Region", 5);
    c.document.getElementById("colmap_unit_mem").value = "MB";
    c.document.getElementById("colmap_unit_disk").value = "MB";
    vm.runInContext("applyColumnMapping()", c);
    const row = vm.runInContext("csvData", c)[0];
    check(
      "102400 MiB disk → 100 GB",
      row["Disk (GB)"] === "100",
      JSON.stringify(row),
    );
    check(
      "16384 MB memory → 16 GB (unchanged behaviour)",
      row["Memory (GB)"] === "16",
    );
    check(
      "disk unit persisted for replay",
      Object.values(
        JSON.parse(fresh.storage["cloudInstanceRecommenderColumnMaps"] || "{}"),
      ).some((e) => e?.units?.["Disk (GB)"] === "MB"),
      fresh.storage["cloudInstanceRecommenderColumnMaps"],
    );
  }

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

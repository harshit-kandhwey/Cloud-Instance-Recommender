// Column mapping: auto-match, panel flow, persistence.
const vm = require("vm");
const { buildContext } = require("./harness");

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
    // Pair has("hidden") — true for every seeded element — with innerHTML === ""
    // so this tells "panel correctly suppressed" from "panel never rendered".
    check(
      "panel hidden",
      elements.columnMappingSection.classes.has("hidden") &&
        elements.columnMappingSection.innerHTML === "",
    );
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
    check(
      "panel hidden",
      elements.columnMappingSection.classes.has("hidden") &&
        elements.columnMappingSection.innerHTML === "",
    );
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
    const { ctx, elements, toasts } = buildContext();
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
        // The shared harness captures toasts into `toasts`, not #toastStack.
        return toasts.some((t) => /column mapping/.test(t.message));
      })(),
      JSON.stringify(toasts),
    );

    // Simulate user: CPU Count ← "CPU Count" (index 0), Memory ← index 2, VM Name ← index 3.
    // Drive the select ids off the panel's REAL canonical order, not a hard-coded
    // list — a stale list writes to the wrong colmap_${idx} (which fakeElement
    // happily invents), so the mapping applies to nothing and the test passes for
    // the wrong reason, or by accident via auto-mapping.
    ctx.pageCanonicals().forEach((c, idx) => {
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
    // Seed storage as if the user confirmed before: same signature as below.
    // v:2 is required — entries without it were written by a version whose
    // mapping rules have since been fixed, and are dropped rather than replayed.
    const saved = {
      v: 2,
      mapping: { Puestos: "CPU Count", Memoria: "Memory (GB)" },
      units: { "Memory (GB)": "GB" },
    };
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
      elements.columnMappingSection.classes.has("hidden") &&
        elements.columnMappingSection.innerHTML === "",
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
    ctx.pageCanonicals().forEach((c, idx) => {
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
      dataScripts: [
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
      elements.columnMappingSection.classes.has("hidden") &&
        elements.columnMappingSection.innerHTML === "",
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

// Column mapping: auto-match, panel flow, persistence.
const vm = require("vm");
const { buildContext } = require("../harness");

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

  console.log(
    "[8. ENV/OS/Workload/Compliance/Exclude/Include Only: exact literal headers still auto-match silently, v3.16.17]",
  );
  {
    // These 7 fields used to be entirely outside COLUMN_MAPPINGS — a file
    // using the exact literal names already worked (read directly, no
    // rename), and must keep working identically now that they ARE
    // canonicals: no panel, no rename note, for the common case.
    const { ctx, elements } = buildContext();
    parse(
      ctx,
      "VM Name,CPU Count,Memory (GB),ENV,OS,Workload,Compliance,Exclude,Include Only\n" +
        "a,4,16,Production,Linux,Database,Current-Generation Hardware,Burstable,m5",
    );
    const data = getCsvData(ctx);
    check(
      "all 6 literal columns pass through under their own names, unrenamed",
      data.length === 1 &&
        data[0]["ENV"] === "Production" &&
        data[0]["OS"] === "Linux" &&
        data[0]["Workload"] === "Database" &&
        data[0]["Compliance"] === "Current-Generation Hardware" &&
        data[0]["Exclude"] === "Burstable" &&
        data[0]["Include Only"] === "m5",
      JSON.stringify(data[0]),
    );
    check(
      "panel stays hidden — an exact match is not a rename",
      elements.columnMappingSection.classes.has("hidden") &&
        elements.columnMappingSection.innerHTML === "",
    );
    check(
      "no 'Mapped columns' note for an identity match",
      !elements.fileStatus.innerHTML.includes("Mapped columns"),
    );
  }

  console.log(
    "[9. a differently-named ENV column is now discoverable via Edit mapping, v3.16.17]",
  );
  {
    // Before v3.16.17 this column was invisible to the mapping system
    // entirely — not auto-matched (no synonym, by design — see
    // COLUMN_SYNONYMS's comment on why ENV/OS stay exact-match-only) and not
    // offered a manual row either, since ENV wasn't a canonical at all.
    const { ctx, elements } = buildContext();
    parse(ctx, "VM Name,CPU Count,Memory (GB),Env Type\na,4,16,Production");
    check(
      "optional/unrecognized column: no forced panel, file loads",
      elements.columnMappingSection.classes.has("hidden") &&
        getCsvData(ctx).length === 1,
    );
    vm.runInContext("editColumnMapping()", ctx);
    const envIdx = ctx.pageCanonicals().indexOf("ENV");
    check("ENV has its own row in Edit mapping", envIdx !== -1);
    const panelHtml = elements.columnMappingSection.innerHTML;
    const envRow = (panelHtml.match(
      /data-canonical="ENV"[\s\S]*?<\/select>/,
    ) || [""])[0];
    check(
      '"Env Type" is offered as a candidate in the ENV row specifically',
      envRow.includes(">Env Type</option>"),
      panelHtml,
    );
    ctx.pageCanonicals().forEach((c, idx) => {
      const el = ctx.document.getElementById(`colmap_${idx}`);
      if (c === "CPU Count") el.value = "1";
      else if (c === "Memory (GB)") el.value = "2";
      else if (c === "ENV") el.value = "3";
      else el.value = "";
    });
    vm.runInContext("applyColumnMapping()", ctx);
    const data = getCsvData(ctx);
    check(
      'confirmed: "Env Type" → ENV',
      data.length === 1 && data[0]["ENV"] === "Production",
      JSON.stringify(data[0]),
    );
  }

  console.log(
    "[10. Min Gen columns are per-provider mappable, filtered per page like Region, v3.16.17]",
  );
  {
    const { ctx } = buildContext(); // single-provider page (aws)
    const canonicals = ctx.pageCanonicals();
    check(
      "aws page offers only AWS Min Gen, not Azure/GCP Min Gen",
      canonicals.includes("AWS Min Gen") &&
        !canonicals.includes("Azure Min Gen") &&
        !canonicals.includes("GCP Min Gen"),
      JSON.stringify(canonicals),
    );
  }
  {
    const { ctx } = buildContext({
      dataScripts: [
        "js/aws/aws-data.js",
        "js/azure/azure-data.js",
        "js/gcp/gcp-data.js",
      ],
    });
    const canonicals = ctx.pageCanonicals();
    check(
      "multicloud page offers all three Min Gen columns",
      ["AWS Min Gen", "Azure Min Gen", "GCP Min Gen"].every((c) =>
        canonicals.includes(c),
      ),
      JSON.stringify(canonicals),
    );
    parse(
      ctx,
      "VM Name,CPU Count,Memory (GB),AWS Min Gen,Azure Min Gen,GCP Min Gen\n" +
        "a,4,16,6,v5,n4",
    );
    const data = getCsvData(ctx);
    check(
      "each provider's Min Gen column passes through under its own name",
      data.length === 1 &&
        data[0]["AWS Min Gen"] === "6" &&
        data[0]["Azure Min Gen"] === "v5" &&
        data[0]["GCP Min Gen"] === "n4",
      JSON.stringify(data[0]),
    );
  }

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

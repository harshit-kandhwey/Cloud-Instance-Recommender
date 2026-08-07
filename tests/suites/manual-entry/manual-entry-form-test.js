// Manual VM entry verification: form flow, validation, persistence, and
// hand-off into the shared ingest pipeline.
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

// Fill by field KEY, not slot: a positional array silently misassigns if
// manualFieldDefs() gains a canonical or renders differently per page, shifting
// every value one input. Reading d.key ties each value to its field.
function fill(ctx, values) {
  // Clear every field first (ctx is shared across blocks), then set the named
  // ones — matching the old positional fill, which wrote all six slots each call.
  ctx.manualFieldDefs().forEach((d, i) => {
    ctx.document.getElementById(`manual_${i}`).value =
      Object.prototype.hasOwnProperty.call(values, d.key)
        ? String(values[d.key])
        : "";
  });
}

(async () => {
  const { ctx, elements, storage, toasts } = buildContext();

  console.log("[toggle + form render]");
  ctx.toggleManualEntry();
  const section = elements.manualEntrySection;
  check("section visible", !section.classes.has("hidden"));
  check(
    "form fields rendered",
    section.innerHTML.includes('id="manual_0"') &&
      section.innerHTML.includes("Add VM"),
  );
  check(
    "region prefilled with default",
    section.innerHTML.includes('value="us-east-1"'),
  );
  check(
    "region datalist from manifest",
    section.innerHTML.includes('id="manualRegions_aws"') &&
      section.innerHTML.includes('value="us-west-2"'),
  );
  check("empty list hint", section.innerHTML.includes("No VMs added yet"));

  console.log("[add + validation]");
  fill(ctx, {
    "VM Name": "web-01",
    "CPU Count": "4",
    "Memory (GB)": "16",
    "CPU Utilization": "45",
    "Memory Utilization": "60",
    "AWS Region": "us-east-1",
  });
  ctx.manualAddVM();
  check("first VM added", vm.runInContext("manualVMs.length", ctx) === 1);
  check("list rendered", section.innerHTML.includes("web-01"));
  check(
    "apply button with count",
    section.innerHTML.includes("Use these 1 VM(s)"),
  );

  fill(ctx, {
    "VM Name": "bad-vm",
    "Memory (GB)": "8",
    "AWS Region": "us-east-1",
  });
  ctx.manualAddVM();
  check(
    // Toasts are captured by the shared harness into `toasts`, not rendered to
    // #toastStack (which it never creates), so assert against that array.
    "missing CPU rejected",
    vm.runInContext("manualVMs.length", ctx) === 1 &&
      toasts.some((t) => /greater than 0/.test(t.message)),
    JSON.stringify(toasts),
  );

  fill(ctx, {
    "CPU Count": "2",
    "Memory (GB)": "8",
    "AWS Region": "eu-west-1",
  });
  ctx.manualAddVM();
  check(
    "auto name for blank VM Name",
    vm.runInContext("manualVMs[1]['VM Name']", ctx) === "vm-2",
  );
  check(
    "sticky region remembered",
    vm.runInContext("window._manualRegionDefaults['AWS Region']", ctx) ===
      "eu-west-1",
  );
  check(
    "persisted to localStorage",
    (storage["cloudInstanceRecommenderManualVMs"] || "").includes("web-01"),
  );

  console.log("[remove]");
  ctx.manualRemoveVM(1);
  check("row removed", vm.runInContext("manualVMs.length", ctx) === 1);

  console.log("[apply → shared pipeline]");
  fill(ctx, {
    "VM Name": "db-01",
    "CPU Count": "8",
    "Memory (GB)": "32",
    "CPU Utilization": "70",
    "Memory Utilization": "80",
    "AWS Region": "us-west-2",
  });
  ctx.manualAddVM();
  ctx.manualApplyVMs();
  const data = vm.runInContext("csvData", ctx);
  check(
    "csvData populated via ingestRows",
    data.length === 2,
    JSON.stringify(data),
  );
  check(
    "canonical keys",
    "CPU Count" in data[0] &&
      "Memory (GB)" in data[0] &&
      "AWS Region" in data[0],
  );
  check(
    // fakeElement seeds every element with "hidden", so has("hidden") alone
    // passes even if the panel was never rendered or the element never existed.
    // Pair it with innerHTML === "" so this distinguishes "correctly suppressed"
    // from "never touched": undefined short-circuits to a FAIL, and a panel that
    // was rendered then hidden trips the emptiness half.
    "no mapping panel (canonical headers)",
    elements.columnMappingSection?.classes.has("hidden") &&
      elements.columnMappingSection.innerHTML === "",
    elements.columnMappingSection?.innerHTML,
  );
  check(
    "manual label in status",
    elements.fileStatus.innerHTML.includes("Manual entry applied"),
    elements.fileStatus.innerHTML,
  );
  check(
    "region validation ran",
    ctx._regionValidation?.aws?.["us-east-1"]?.status === "exact",
    JSON.stringify(ctx._regionValidation),
  );
  check(
    "region chips rendered",
    !elements.regionValidationSection.classes.has("hidden"),
  );

  console.log("[generate works on manual rows]");
  vm.runInContext("selectedProviders = ['aws']", ctx);
  const results = await ctx.getInstanceRecommendationWithSelector(
    data,
    ["aws"],
    {
      generateLikeToLike: true,
      generateOptimized: false,
      excludeTypes: [],
      selectedInstanceFamilyNames: [],
      selectedProcessorManufacturers: [],
      selectedMainFamilies: [],
      selectedAzureSeries: [],
      selectedAzureProcessors: [],
      selectedAzureVMFamilies: [],
      selectedGCPFamilies: [],
      selectedGCPProcessors: [],
      selectedGCPMachineTypes: [],
    },
  );
  check(
    "recommendations produced",
    results.length === 2 &&
      results.every(
        (r) =>
          r["AWS Like-to-Like Instance"] &&
          r["AWS Like-to-Like Instance"] !== "No data available",
      ),
    JSON.stringify(results.map((r) => r["AWS Like-to-Like Instance"])),
  );

  console.log("[restore from localStorage in a fresh session]");
  {
    const { ctx: c2, elements: e2 } = buildContext({
      seedStorage: {
        cloudInstanceRecommenderManualVMs:
          storage["cloudInstanceRecommenderManualVMs"],
      },
    });
    c2.toggleManualEntry();
    check("saved VMs restored", vm.runInContext("manualVMs.length", c2) === 2);
    check(
      "restored list rendered",
      e2.manualEntrySection.innerHTML.includes("web-01") &&
        e2.manualEntrySection.innerHTML.includes("db-01"),
    );
  }

  console.log("[clear all]");
  ctx.manualClearVMs();
  check("cleared", vm.runInContext("manualVMs.length", ctx) === 0);
  check("hint back", section.innerHTML.includes("No VMs added yet"));

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

// Nearest-miss verification (base-instance-selector.js + instance-selector-factory.js):
//   - computeNearestMiss finds the cheapest size-fitting instance the soft
//     filters removed, and attributes the block to the right filter group(s)
//   - it returns null when nothing even meets the size (not a filter problem)
//   - getLikeToLikeInstance attaches nearestMiss to its no-match result
//   - formatNearestMiss renders the "Nearest Miss" column string
// Uses the base selector directly (its own applyFilters covers the shared
// filters); provider-specific filters ride the same probe mechanism and are
// exercised end-to-end by the golden suites. A source-scan section at the end
// enforces the probe coupling: every `options.<key>` a provider's applyFilters
// reads must have a matching probe group in `_nearestMissProbes`.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
};
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
const run = (expr) =>
  vm.runInContext(expr, ctx, { filename: "nearest-miss-test" });

load("js/base/base-instance-selector.js");
load("js/base/instance-selector-factory.js");

// A bare concrete selector (base filters only) with injected data.
run(`
  __sel = new BaseInstanceSelector();
  __sel.getProviderName = function () { return "AWS"; };
  __sel.getSampleData = function () { return []; };
`);

// Price-sorted instances; both are current-gen 2 and Intel.
sandbox.instA = [
  {
    instanceType: "t3.medium",
    vCpus: 2,
    memory: 4,
    price: 0.04,
    generation: 2,
    familyName: "General purpose",
    processor: "Intel",
    family: "t3",
    isGraviton: 0,
  },
  {
    instanceType: "m5.large",
    vCpus: 2,
    memory: 8,
    price: 0.1,
    generation: 2,
    familyName: "General purpose",
    processor: "Intel",
    family: "m5",
    isGraviton: 0,
  },
];

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
}

// ── current-generation-only removes everything (no gen-1 instances) ────────────
const r1 = run(
  `__sel.computeNearestMiss(instA, 2, 4, { currentGenerationOnly: true })`,
);
check(
  "nearest miss = cheapest size-fitting instance",
  r1 && r1.instanceType === "t3.medium" && r1.vCpus === 2 && r1.memory === 4,
  JSON.stringify(r1),
);
check(
  "attributes the block to current-generation only",
  JSON.stringify(r1.blockedBy) === JSON.stringify(["current-generation only"]),
  JSON.stringify(r1.blockedBy),
);

// ── processor filter removes everything (want AMD, all Intel) ──────────────────
const r2 = run(
  `__sel.computeNearestMiss(instA, 2, 4, { restrictProcessorManufacturers: true, selectedProcessorManufacturers: ["AMD"] })`,
);
check(
  "attributes the block to processor manufacturer",
  JSON.stringify(r2.blockedBy) === JSON.stringify(["processor manufacturer"]),
  JSON.stringify(r2.blockedBy),
);

// ── two filters block the nearest → both named ─────────────────────────────────
const r3 = run(
  `__sel.computeNearestMiss(instA, 2, 4, { currentGenerationOnly: true, restrictProcessorManufacturers: true, selectedProcessorManufacturers: ["AMD"] })`,
);
check(
  "names every blocking filter group",
  JSON.stringify(r3.blockedBy.slice().sort()) ===
    JSON.stringify(["current-generation only", "processor manufacturer"]),
  JSON.stringify(r3.blockedBy),
);

// ── nothing meets the size → null (not a filter problem) ───────────────────────
const r4 = run(
  `__sel.computeNearestMiss(instA, 64, 256, { currentGenerationOnly: true })`,
);
check(
  "returns null when nothing fits the size",
  r4 === null,
  JSON.stringify(r4),
);

// ── getLikeToLikeInstance attaches nearestMiss to its no-match result ──────────
run(`__sel.instanceData = { r1: instA };`);
const lt = run(
  `__sel.getLikeToLikeInstance("r1", 2, 4, { currentGenerationOnly: true })`,
);
check(
  "getLikeToLikeInstance reports no match under the filter",
  lt.instanceType === "No data available",
  lt.instanceType,
);
check(
  "no-match result carries the nearest miss",
  lt.nearestMiss && lt.nearestMiss.instanceType === "t3.medium",
  JSON.stringify(lt.nearestMiss),
);

// ── a genuine match must NOT carry a nearest miss ──────────────────────────────
const okMatch = run(`__sel.getLikeToLikeInstance("r1", 2, 4, {})`);
check(
  "a successful match has no nearestMiss",
  okMatch.instanceType === "t3.medium" && okMatch.nearestMiss === undefined,
  JSON.stringify({ t: okMatch.instanceType, nm: okMatch.nearestMiss }),
);

// ── formatNearestMiss column rendering ─────────────────────────────────────────
check(
  "formatNearestMiss renders instance, size, and relax hint",
  run(
    `formatNearestMiss({ instanceType: "m7i.large", vCpus: 2, memory: 8, blockedBy: ["current-generation only"] })`,
  ) === "m7i.large (2 vCPU / 8 GB) — relax: current-generation only",
);
check(
  "formatNearestMiss omits the hint when nothing to relax",
  run(
    `formatNearestMiss({ instanceType: "m7i.large", vCpus: 2, memory: 8, blockedBy: [] })`,
  ) === "m7i.large (2 vCPU / 8 GB)",
);
check(
  "formatNearestMiss of null → empty string",
  run("formatNearestMiss(null)") === "",
);

// ── instance-family-name filter attribution (base filter) ──────────────────────
const rFam = run(
  `__sel.computeNearestMiss(instA, 2, 4, { restrictInstanceFamilyNames: true, selectedInstanceFamilyNames: ["Compute optimized"] })`,
);
check(
  "attributes the block to instance-family name",
  JSON.stringify(rFam.blockedBy) === JSON.stringify(["instance-family name"]),
  JSON.stringify(rFam.blockedBy),
);

// ── family/series filter runs through a provider applyFilters override ─────────
// Mirrors how AWS/Azure/GCP selectors add main-family filtering on top of super.
run(`
  class __OverrideSel extends BaseInstanceSelector {
    getProviderName() { return "AWS"; }
    getSampleData() { return []; }
    applyFilters(instances, cpu, mem, options) {
      let f = super.applyFilters(instances, cpu, mem, options);
      if (options.restrictMainFamilies && options.selectedMainFamilies && options.selectedMainFamilies.length) {
        f = f.filter((i) => options.selectedMainFamilies.includes(this.getMainInstanceFamily(i.instanceType)));
      }
      return f;
    }
  }
  __ov = new __OverrideSel();
`);
const rSeries = run(
  `__ov.computeNearestMiss(instA, 2, 4, { restrictMainFamilies: true, selectedMainFamilies: ["c"] })`,
);
check(
  "computeNearestMiss honors a provider applyFilters override",
  rSeries && rSeries.instanceType === "t3.medium",
  JSON.stringify(rSeries),
);
check(
  "attributes the block to instance family/series",
  JSON.stringify(rSeries.blockedBy) ===
    JSON.stringify(["instance family/series"]),
  JSON.stringify(rSeries.blockedBy),
);

// ── RuleEngine present but a no-op on the size-only pass ({} → workload general) ─
// Locks the invariant: rules can't skew the nearest-miss candidate or its
// attribution (the real engine also falls back rather than emptying the pool).
run(`
  RuleEngine = {
    apply: function (instances, options) {
      var wl = (options.rowWorkload || "general").toLowerCase();
      return wl === "general"
        ? { instances: instances, rules: [] }
        : { instances: [], rules: ["forced-empty"] };
    }
  };
`);
const rRule = run(
  `__sel.computeNearestMiss(instA, 2, 4, { currentGenerationOnly: true })`,
);
check(
  "RuleEngine no-op on size-only pass leaves the nearest + attribution intact",
  rRule &&
    rRule.instanceType === "t3.medium" &&
    JSON.stringify(rRule.blockedBy) ===
      JSON.stringify(["current-generation only"]),
  JSON.stringify(rRule),
);

// ── probe coupling: every soft-filter option read in applyFilters is probed ────
// Guards the contract stated in each provider selector ("any provider-specific
// soft filter added below must get a matching probe group"): scan the
// applyFilters source for `options.<key>` reads and require every key to show
// up in a `_nearestMissProbes` pick list. Adding a filter without a probe —
// which would make the Nearest Miss column under-report — fails here.
load("js/aws/aws-instance-selector.js");
load("js/azure/azure-instance-selector.js");
load("js/gcp/gcp-instance-selector.js");

const probesSrc = run(
  "BaseInstanceSelector.prototype._nearestMissProbes.toString()",
);

function optionReads(fnSrc) {
  const names = new Set();
  for (const m of fnSrc.matchAll(/options\.([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  return [...names];
}

const filterScans = [
  { name: "Base", cls: "BaseInstanceSelector", sentinel: "excludeTypes" },
  { name: "AWS", cls: "AWSInstanceSelector", sentinel: "excludeGraviton" },
  {
    name: "Azure",
    cls: "AzureInstanceSelector",
    sentinel: "selectedAzureSeries",
  },
  {
    name: "GCP",
    cls: "GCPInstanceSelector",
    sentinel: "selectedGCPMachineTypes",
  },
];

for (const scan of filterScans) {
  const src = run(`${scan.cls}.prototype.applyFilters.toString()`);
  if (scan.name !== "Base") {
    check(
      `${scan.name} applyFilters delegates to super.applyFilters`,
      src.includes("super.applyFilters"),
    );
  }
  const reads = optionReads(src);
  check(
    `${scan.name} scan sees its known filter option (extraction sanity)`,
    reads.includes(scan.sentinel),
    `reads: ${JSON.stringify(reads)}`,
  );
  const unprobed = reads.filter((key) => !probesSrc.includes(`"${key}"`));
  check(
    `${scan.name}: every applyFilters option read has a nearest-miss probe`,
    unprobed.length === 0,
    unprobed.length ? `missing probe for: ${unprobed.join(", ")}` : "",
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("nearest-miss-test: all checks passed");

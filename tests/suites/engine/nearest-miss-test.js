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
// Note: the relax feature is provider-agnostic on purpose. The probe labels are
// shared across providers — each probe's pick() folds the Azure and GCP option
// keys in under the SAME label — so one RELAX_CONTROLS entry serves all three.
const fs = require("fs");
const path = require("path");
const { buildEngineContext, REPO } = require("../harness");

// Base filters live in base-instance-selector; the factory adds the no-match
// wiring. The provider selectors are loaded later (via `load`), for the
// probe-coupling source scan at the end.
const { ctx, load, run } = buildEngineContext({
  scripts: [
    "js/base/base-instance-selector.js",
    "js/base/instance-selector-factory.js",
  ],
  label: "nearest-miss",
});

// A bare concrete selector (base filters only) with injected data.
run(`
  __sel = new BaseInstanceSelector();
  __sel.getProviderName = function () { return "AWS"; };
  __sel.getSampleData = function () { return []; };
`);

// Price-sorted instances; both are current-gen 2 and Intel.
ctx.instA = [
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
  !!r1 &&
    JSON.stringify(r1.blockedBy) ===
      JSON.stringify(["current-generation only"]),
  JSON.stringify(r1 && r1.blockedBy),
);

// ── processor filter removes everything (want AMD, all Intel) ──────────────────
const r2 = run(
  `__sel.computeNearestMiss(instA, 2, 4, { restrictProcessorManufacturers: true, selectedProcessorManufacturers: ["AMD"] })`,
);
check(
  "attributes the block to processor manufacturer",
  !!r2 &&
    JSON.stringify(r2.blockedBy) === JSON.stringify(["processor manufacturer"]),
  JSON.stringify(r2 && r2.blockedBy),
);

// ── two filters block the nearest → both named ─────────────────────────────────
const r3 = run(
  `__sel.computeNearestMiss(instA, 2, 4, { currentGenerationOnly: true, restrictProcessorManufacturers: true, selectedProcessorManufacturers: ["AMD"] })`,
);
check(
  "names every blocking filter group",
  Array.isArray(r3?.blockedBy) &&
    JSON.stringify(r3.blockedBy.slice().sort()) ===
      JSON.stringify(["current-generation only", "processor manufacturer"]),
  JSON.stringify(r3 && r3.blockedBy),
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
  !!lt && lt.instanceType === "No data available",
  lt && lt.instanceType,
);
check(
  "no-match result carries the nearest miss",
  !!lt && lt.nearestMiss && lt.nearestMiss.instanceType === "t3.medium",
  JSON.stringify(lt && lt.nearestMiss),
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
  !!rFam &&
    JSON.stringify(rFam.blockedBy) === JSON.stringify(["instance-family name"]),
  JSON.stringify(rFam && rFam.blockedBy),
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
  !!rSeries &&
    JSON.stringify(rSeries.blockedBy) ===
      JSON.stringify(["instance family/series"]),
  JSON.stringify(rSeries && rSeries.blockedBy),
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
  // Plain and optional-chained dotted reads (`options.foo`, `options?.foo`).
  // Every provider today reads options this way; destructuring is not used and
  // would slip past a static scan, so the contract is: read via dot access.
  for (const m of fnSrc.matchAll(/options\??\.\s*([A-Za-z_$][\w$]*)/g)) {
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

// ─── Relax suggestion is coupled to the probe labels ──────────────────────────
// The one-click relax maps each probe LABEL to the checkbox that turns that
// filter off. Rename a label in _nearestMissProbes and the map silently stops
// matching — computeRelaxSuggestion would just never suggest anything, with no
// error anywhere. The labels are shared across providers (each probe's pick()
// folds the Azure/GCP option keys in under the same label), so this is not an
// AWS-only feature.
console.log("[relax controls cover every probe label]");
{
  const selectorSrc = fs.readFileSync(
    path.join(REPO, "js/base/base-instance-selector.js"),
    "utf8",
  );
  // `label:` appears only inside _nearestMissProbes, so no slicing games
  const probeLabels = [...selectorSrc.matchAll(/^\s+label: "([^"]+)"/gm)].map(
    (m) => m[1],
  );

  const coreSrc = fs.readFileSync(
    path.join(REPO, "js/base/app-core.js"),
    "utf8",
  );
  // Assert both markers were found first — a rename/reorder makes an indexOf
  // return -1, and the slice then goes empty or backwards. The `every` checks
  // below pass vacuously on an empty map, so without this the guard is silent.
  const mapStart = coreSrc.indexOf("const RELAX_CONTROLS");
  const mapEnd = coreSrc.indexOf("function parseRelaxLabels");
  check(
    "the relax map markers still exist in app-core.js",
    mapStart >= 0 && mapEnd > mapStart,
    `start=${mapStart} end=${mapEnd}`,
  );
  const mapSrc = coreSrc.slice(mapStart, mapEnd);

  // Per-row probes are backed by a CSV column, not a run-level control, so they
  // are deliberately NOT one-click relaxable — the user edits the column, there
  // is no checkbox to flip. They still PROBE (the Nearest Miss must name them),
  // so they appear in _nearestMissProbes but carry no RELAX_CONTROLS entry.
  const PER_ROW_PROBES = ["include-only list"];
  check(
    "every run-level probe label has a relax control",
    probeLabels.length > 0 &&
      probeLabels
        .filter((l) => !PER_ROW_PROBES.includes(l))
        .every((l) => mapSrc.includes(`"${l}"`)),
    `labels=${JSON.stringify(probeLabels)}`,
  );
  // The exemption cannot rot into a typo: each name it excuses must actually be a
  // probe label the engine emits.
  check(
    "each exempted per-row probe is a real probe label",
    PER_ROW_PROBES.every((l) => probeLabels.includes(l)),
    `labels=${JSON.stringify(probeLabels)}`,
  );
  // Tolerate any indent depth (a reformat/nesting must not silently drop the
  // regex to zero matches) and assert we actually extracted labels — `every`
  // on an empty set passes vacuously, which would hollow this guard out.
  const relaxKeys = [...mapSrc.matchAll(/^\s+"([^"]+)":/gm)].map((m) => m[1]);
  check(
    "the relax map invents no label the engine never emits",
    relaxKeys.length > 0 &&
      relaxKeys.every((label) => probeLabels.includes(label)),
    `relaxKeys=${JSON.stringify(relaxKeys)}`,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("nearest-miss-test: all checks passed");
}

// Data-integrity / manifest suite (depth gate B). The split-data pipeline
// (tools/split-data.js) turns each monolithic {provider}-data.js into a manifest
// ({P}_REGION_KEYS) plus one js/{p}/regions/{key}.js per region, each defining a
// window global named for its key. Nothing re-checks that the shipped artifacts
// stayed consistent after a data refresh, a hand-edit, or a bad merge — and the
// failure is invisible: a manifest key with no loadable region file, or a file
// whose global drifted from its filename, makes base-instance-selector fall back
// to sample data for THAT region only (loadRegionData's getRegionDataFromGlobal
// throws → getFallbackData), so the app looks fine everywhere except the one
// region nobody happened to test. This suite pins the whole chain.
//
// NOTE on the round-trip the plan sketched (regenerate a couple of regions and
// byte-compare): not applicable to the committed repo. split-data.js is
// idempotent — it SKIPS any file already in manifest form — and the monolithic
// source is a transient input dropped in only during a data update, never
// committed. There is nothing here to re-split, so the integrity end is pinned
// directly against the shipped manifest + region files instead, which is the
// artifact users actually load.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const PROVIDERS = [
  { name: "aws", prefix: "AWS", selector: "AWSInstanceSelector" },
  { name: "azure", prefix: "AZURE", selector: "AzureInstanceSelector" },
  { name: "gcp", prefix: "GCP", selector: "GCPInstanceSelector" },
];

// Read each provider's field mapping LIVE from its selector rather than
// hard-coding it, so the shape check below can never drift from what the engine
// actually reads out of a region record (base-instance-selector's
// createStandardizedInstance keys on exactly these names).
const { run: runSel } = buildEngineContext({
  scripts: [
    "js/base/base-instance-selector.js",
    "js/aws/aws-instance-selector.js",
    "js/azure/azure-instance-selector.js",
    "js/gcp/gcp-instance-selector.js",
  ],
  label: "data-integrity-selectors",
});
const fieldMappings = {};
for (const { name, selector } of PROVIDERS) {
  fieldMappings[name] = runSel(`new ${selector}().getFieldMappings()`);
}

// Load one classic-script data/region file in a FRESH sandbox and return the
// list of window globals it defined (own keys minus the self-referential
// `window`). A region file must add exactly one — its own key.
function globalsDefinedBy(relPath) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(REPO, relPath), "utf8"), sandbox, {
    filename: relPath,
  });
  const defined = Object.keys(sandbox).filter((k) => k !== "window");
  return { sandbox, defined };
}

for (const { name, prefix } of PROVIDERS) {
  const label = prefix;
  const regionsDir = path.join(REPO, "js", name, "regions");
  const manifestRel = `js/${name}/${name}-data.js`;

  // ── Manifest well-formedness ─────────────────────────────────────────────
  const { sandbox: man, defined: manGlobals } = globalsDefinedBy(manifestRel);
  const keys = man[`${prefix}_REGION_KEYS`];
  const dataDate = man[`${prefix}_DATA_DATE`];
  const dataReady = man[`${prefix}_DATA_READY`];

  check(
    `[${label}] manifest defines a non-empty ${prefix}_DATA_DATE string`,
    typeof dataDate === "string" && dataDate.length > 0,
    JSON.stringify(dataDate),
  );
  check(
    `[${label}] manifest defines ${prefix}_DATA_READY === true`,
    dataReady === true,
    JSON.stringify(dataReady),
  );
  check(
    `[${label}] manifest defines ${prefix}_REGION_KEYS as a non-empty string array`,
    Array.isArray(keys) &&
      keys.length > 0 &&
      keys.every((k) => typeof k === "string" && k.length > 0),
    Array.isArray(keys) ? `length ${keys.length}` : typeof keys,
  );
  // The manifest should define ONLY its three declared globals — an extra
  // `window.X =` here would be an accidental leak from a bad edit.
  check(
    `[${label}] manifest defines exactly its three globals (no stray leak)`,
    manGlobals.length === 3 &&
      manGlobals.includes(`${prefix}_DATA_DATE`) &&
      manGlobals.includes(`${prefix}_REGION_KEYS`) &&
      manGlobals.includes(`${prefix}_DATA_READY`),
    manGlobals.join(", "),
  );

  if (!Array.isArray(keys)) continue; // nothing more to check without the list

  // No duplicate keys — a repeat silently maps two entries to one region file.
  const dupSet = new Set();
  const dups = keys.filter((k) =>
    dupSet.has(k) ? true : (dupSet.add(k), false),
  );
  check(
    `[${label}] ${prefix}_REGION_KEYS has no duplicate keys`,
    dups.length === 0,
    dups.length ? `dups: ${[...new Set(dups)].join(", ")}` : "",
  );

  // ── Manifest ↔ region-file bijection ─────────────────────────────────────
  const diskFiles = fs
    .readdirSync(regionsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.replace(/\.js$/, ""));
  const diskSet = new Set(diskFiles);
  const keySet = new Set(keys);

  const missingFiles = keys.filter((k) => !diskSet.has(k));
  check(
    `[${label}] every ${prefix}_REGION_KEYS key has a region file on disk`,
    missingFiles.length === 0,
    missingFiles.length ? `missing: ${missingFiles.join(", ")}` : "",
  );
  const orphans = diskFiles.filter((f) => !keySet.has(f));
  check(
    `[${label}] no orphan region file that the manifest does not list`,
    orphans.length === 0,
    orphans.length ? `orphans: ${orphans.join(", ")}` : "",
  );

  // ── Per-region-file integrity ────────────────────────────────────────────
  // Iterate DISK files (not just manifest keys) so a rogue extra file is loaded
  // and validated too, not silently ignored.
  const map = fieldMappings[name];
  let badGlobal = null; // { file, defined }
  let notLoadable = null; // { file, err }
  let emptyRegion = null; // file with an empty/absent object
  let badShape = null; // { file, instanceType, why }

  for (const file of diskFiles) {
    const rel = `js/${name}/regions/${file}.js`;
    let sandbox, defined;
    try {
      ({ sandbox, defined } = globalsDefinedBy(rel));
    } catch (err) {
      if (!notLoadable) notLoadable = { file, err: String(err.message || err) };
      continue;
    }
    // Exactly one global, named for the file (invariant: filename === global).
    if (defined.length !== 1 || defined[0] !== file) {
      if (!badGlobal)
        badGlobal = { file, defined: defined.join(", ") || "(none)" };
      continue;
    }
    const region = sandbox[file];
    const entries =
      region && typeof region === "object" ? Object.entries(region) : [];
    if (!entries.length) {
      if (!emptyRegion) emptyRegion = file;
      continue;
    }
    // Every instance is a non-null object carrying the vCpus + memory + price
    // fields the engine reads (finite positive numbers), and a family string.
    for (const [instanceType, rec] of entries) {
      if (!rec || typeof rec !== "object") {
        if (!badShape)
          badShape = { file, instanceType, why: "record is not an object" };
        break;
      }
      const vcpu = Number(rec[map.vCpus]);
      const memory = Number(rec[map.memory]);
      const price = Number(rec[map.price]);
      const family = rec[map.family];
      if (!Number.isFinite(vcpu) || vcpu <= 0) {
        if (!badShape)
          badShape = {
            file,
            instanceType,
            why: `${map.vCpus}=${rec[map.vCpus]}`,
          };
        break;
      }
      if (!Number.isFinite(memory) || memory <= 0) {
        if (!badShape)
          badShape = {
            file,
            instanceType,
            why: `${map.memory}=${rec[map.memory]}`,
          };
        break;
      }
      if (!Number.isFinite(price) || price < 0) {
        if (!badShape)
          badShape = {
            file,
            instanceType,
            why: `${map.price}=${rec[map.price]}`,
          };
        break;
      }
      if (typeof family !== "string" || !family.length) {
        if (!badShape)
          badShape = {
            file,
            instanceType,
            why: `${map.family}=${JSON.stringify(rec[map.family])}`,
          };
        break;
      }
    }
    if (badShape) break; // first offender is enough to fail the suite
  }

  check(
    `[${label}] every region file loads without error`,
    notLoadable === null,
    notLoadable ? `${notLoadable.file}: ${notLoadable.err}` : "",
  );
  check(
    `[${label}] every region file defines exactly its filename's global`,
    badGlobal === null,
    badGlobal ? `${badGlobal.file}.js defines [${badGlobal.defined}]` : "",
  );
  check(
    `[${label}] no region file is an empty object (would fall back to samples)`,
    emptyRegion === null,
    emptyRegion ? `${emptyRegion}.js` : "",
  );
  check(
    `[${label}] every instance carries finite vCPU/memory/price + a family (per ${label} field map)`,
    badShape === null,
    badShape
      ? `${badShape.file}.js "${badShape.instanceType}": ${badShape.why}`
      : "",
  );
}

if (state.failures) {
  console.error(`\ndata-integrity: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log(
    "\ndata-integrity: all provider manifests + region files consistent",
  );
  process.exitCode = 0;
}

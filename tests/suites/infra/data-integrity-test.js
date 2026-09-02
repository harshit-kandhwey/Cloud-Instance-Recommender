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
const {
  loadCommittedRegions,
  loadGlobals,
  specFields,
  SERVICE,
} = require("../../../tools/lib/util");

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
  // The manifest should define ONLY its four declared globals — an extra
  // `window.X =` here would be an accidental leak from a bad edit.
  check(
    `[${label}] manifest defines exactly its four globals (no stray leak)`,
    manGlobals.length === 4 &&
      manGlobals.includes(`${prefix}_DATA_DATE`) &&
      manGlobals.includes(`${prefix}_SPECS`) &&
      manGlobals.includes(`${prefix}_REGION_KEYS`) &&
      manGlobals.includes(`${prefix}_DATA_READY`),
    manGlobals.join(", "),
  );
  // DATA_READY must be assigned LAST. A consumer that polls it and then reads
  // {P}_SPECS must never observe the flag true while the specs half is missing —
  // which is the whole window in which a half-loaded manifest looks loaded.
  const manSrc = fs.readFileSync(
    path.join(REPO, "js", name, `${name}-data.js`),
    "utf8",
  );
  check(
    `[${label}] ${prefix}_DATA_READY is assigned after ${prefix}_SPECS`,
    manSrc.indexOf(`window.${prefix}_DATA_READY = `) >
      manSrc.indexOf(`window.${prefix}_SPECS = `),
    `SPECS@${manSrc.indexOf(`window.${prefix}_SPECS = `)}, READY@${manSrc.indexOf(`window.${prefix}_DATA_READY = `)}`,
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
  // Structure is checked per FILE (one global, named for the file, non-empty);
  // record SHAPE is checked on the merged view, because a region file carries
  // prices only and its specs live in the manifest. Reading the raw file for both
  // is the private-walk trap: every vCpus would read undefined.
  const mergedRegions = loadCommittedRegions(name, REPO);
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
    if (!region || typeof region !== "object" || !Object.keys(region).length) {
      if (!emptyRegion) emptyRegion = file;
      continue;
    }
    const entries = Object.entries(mergedRegions[file] || {});
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

// ── The GCP family filter is an ALLOW-LIST, so it must cover the shipped data ────
// With "restrict main families" on, gcp-instance-selector keeps only instances whose
// series is in gcpAdvancedFilterData.machineFamilies. A series the data ships but the
// list omits cannot be checked, so it is excluded even when the user ticks every box
// — it does not merely go unoffered. A refresh that adds a series must add it here,
// which is what this pins. (c4n and m4n arrived in the 2026-08-30 refresh; seven more
// had been missing for longer.)
{
  const { gcpAdvancedFilterData } = require("../../../js/gcp/gcp-specific.js");
  const listed = new Set(
    (gcpAdvancedFilterData.machineFamilies || []).map((f) => f.toLowerCase()),
  );

  const dir = path.join(REPO, "js", "gcp", "regions");
  const shipped = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const sandbox = { window: {} };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(dir, file), "utf8"), sandbox, {
      filename: file,
    });
    const region = sandbox[file.replace(/\.js$/, "")] || {};
    for (const type of Object.keys(region)) shipped.add(type.split("-")[0]);
  }

  const unlistable = [...shipped].filter((s) => !listed.has(s)).sort();
  check(
    "every GCP series in the shipped data can be selected in the family filter",
    unlistable.length === 0,
    unlistable.join(",") || `${shipped.size} series all listed`,
  );

  // The other direction: a listed series the data no longer carries renders a
  // checkbox that silently matches nothing.
  const stale = [...listed].filter((f) => !shipped.has(f)).sort();
  check(
    "the GCP family filter lists no series the data no longer ships",
    stale.length === 0,
    stale.join(",") || "none",
  );
}

// ── The shipped Azure CPU vendor must agree with the classifier that produced it ──
// The Azure feed carries no processor field, so fetch-vantage derives the vendor from
// AZURE_AMD_FAMILIES. The tool's own suite pins that function; this pins the artifact,
// which is where a stale label actually hurts: the 2026-08-30 capture shipped every AMD
// type labelled Intel because the classifier was fixed after the data was fetched, and
// nothing compared the two. Cheap to re-derive (family + isARM live on each record), so
// any future refresh that lands data the current table disagrees with fails here.
{
  const { azureProcessor } = require("../../../tools/fetch-vantage.js");
  // Through the shared loader: `family`, `isARM` and `processorArchitecture` are
  // all SPECS and live in the manifest, so a private walk would compare undefined
  // against undefined and pass while proving nothing.
  let mismatch = null;
  let checked = 0;

  for (const [key, region] of Object.entries(
    loadCommittedRegions("azure", REPO),
  )) {
    for (const [type, rec] of Object.entries(region)) {
      checked++;
      const want = azureProcessor(rec.family, rec.isARM);
      if (rec.processorArchitecture !== want && !mismatch) {
        mismatch = `${key}/${type} (family ${rec.family}): shipped ${rec.processorArchitecture}, classifier says ${want}`;
      }
    }
  }

  check(
    "[AZURE] every shipped record's CPU vendor matches azureProcessor(family, isARM)",
    mismatch === null,
    mismatch || `${checked} records agree`,
  );
}

// The region files read RAW — deliberately NOT through loadCommittedRegions. Every
// other consumer must use the loader; this block is the one place whose subject IS
// the unmerged half, because it asks what the region files do and do not carry.
const rawRegions = {};
for (const { name } of PROVIDERS) {
  const dir = path.join(REPO, "js", name, "regions");
  const out = (rawRegions[name] = {});
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const key = file.replace(/\.js$/, "");
    const sandbox = {};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(dir, file), "utf8"), sandbox, {
      filename: file,
    });
    if (sandbox[key] && typeof sandbox[key] === "object")
      out[key] = sandbox[key];
  }
}

// ── The two halves are actually split, and nothing fell between them ─────────
// This block replaces the pre-3.15 "a type's specs are identical in every region"
// check, which the split made VACUOUS: specs are now stored once, so the merged
// view repeats the same object into every region and the comparison cannot fail.
// A check that cannot fail is worse than no check — it reads as coverage. The
// writer-side guard in split-data.js is what now enforces region-invariance, at
// the moment the duplication is collapsed, where a genuine disagreement can still
// be seen. What remains falsifiable HERE is that the split is clean in both
// directions, which is what these two pin.
{
  for (const { name, prefix } of PROVIDERS) {
    const specNames = new Set(specFields(name));
    const blob =
      (loadGlobals(`js/${name}/${name}-data.js`, REPO)[`${prefix}_SPECS`] ||
        {})[SERVICE] || {};

    // Direction 1: no region file may carry a spec field. One leaking through
    // would be stored per region again — the duplication 3.15 exists to remove,
    // returning silently and only for the field that leaked.
    let leaked = null;
    let priceRecords = 0;
    for (const key of Object.keys(rawRegions[name])) {
      for (const [type, rec] of Object.entries(rawRegions[name][key])) {
        priceRecords++;
        for (const f of Object.keys(rec)) {
          if (specNames.has(f) && !leaked) leaked = `${key}/${type}.${f}`;
        }
      }
    }
    check(
      `[${prefix}] no region file carries a spec field`,
      leaked === null,
      leaked
        ? `${leaked} belongs in ${prefix}_SPECS`
        : `${priceRecords} price-only records`,
    );

    // Direction 2: every type any region prices must have specs to merge. A gap
    // here is the loader's price-but-no-specs failure waiting to happen — the
    // difference being that it fails at BUILD time, for every user at once,
    // rather than in one visitor's browser.
    const orphans = new Set();
    for (const key of Object.keys(rawRegions[name])) {
      for (const type of Object.keys(rawRegions[name][key])) {
        if (!blob[type]) orphans.add(type);
      }
    }
    check(
      `[${prefix}] every priced type has specs in ${prefix}_SPECS.${SERVICE}`,
      orphans.size === 0,
      orphans.size
        ? `${orphans.size} orphaned: ${[...orphans].slice(0, 5).join(", ")}`
        : `${Object.keys(blob).length} types carry specs`,
    );
  }
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

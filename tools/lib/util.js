"use strict";
/*
 * tools/lib/util.js — shared build-tool helpers. Node/CI only; never shipped to the
 * page. The 8-decimal price normalizer is a cross-tool contract: fetch-vantage, the
 * official fetchers, data-diff and reconcile must all round identically, or a
 * re-quote of the same price reads as a spurious move in the diff.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// tools/lib/util.js → repo root.
const ROOT = path.join(__dirname, "..", "..");

// Round to 8 decimals — the deepest precision the shipped data uses. Non-finite
// values pass through unchanged (callers guard those separately).
const round8 = (v) => (Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v);

// Value following a CLI flag in argv, or undefined. argv is injectable for tests.
function argValue(flag, argv = process.argv) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

// Run shipped JS artifacts in one shared window-like sandbox and return its globals.
// Shared, not one context each: region files are read as a set and may reference
// each other's globals exactly as the page would.
function runFiles(relPaths, root = ROOT) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of relPaths) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), sandbox, {
      filename: rel,
    });
  }
  return sandbox;
}

// Run a shipped JS artifact in a window-like sandbox and return its globals.
function loadGlobals(relPath, root = ROOT) {
  return runFiles([relPath], root);
}

// The refresh's scratch monolith. fetch-vantage writes the freshly built fat data
// HERE rather than over js/{name}/{name}-data.js, and reconcile, both diffs and
// split-data read it from here. The shipped tree therefore survives untouched until
// split-data runs, which is what lets the diffs read the OLD specs out of the shipped
// manifest, and what stops a refresh that dies mid-run from leaving a new manifest
// beside old region files. One definition so no tool can invent a second path.
// .refresh-cache/ is gitignored, so the scratch artifact can never reach a PR.
function monolithPath(name, root = ROOT) {
  return path.join(root, ".refresh-cache", `${name}-monolith.js`);
}

// The service level inside {P}_SPECS. Compute is the only one; the level exists so a
// later non-compute service is a new key rather than a second format migration.
const SERVICE = "compute";

// Committed region data — the "old" side for BOTH refresh diffs, and the tools' twin of
// the browser's loadRegionData. Reads js/{name}/regions/ and merges each type's specs
// back in from the shipped manifest's {P}_SPECS, so a caller sees whole records and
// never learns the data is stored in two pieces. The diffs run before split-data touches
// either half, so both still hold the previous refresh's data.
//
// Merge order is specs-then-record: a region file that still carries a fat record (the
// pre-split format, and getFallbackData's synthetic data) overrides the specs it already
// agrees with, so this is a no-op on data that was never split.
//
// Lives here rather than in either diff so the two cannot drift: data-diff carried the
// missing-assignment guard and recommendation-diff did not, which published an undefined
// region into the engine's {PREFIX}_REGION_KEYS instead of failing by name. Every tool
// that reads the shipped region files must come through here for the same reason — a
// private readdirSync loop gets the price half and silently misses the specs.
function loadCommittedRegions(name, root = ROOT) {
  const dir = path.join(root, "js", name, "regions");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const g = runFiles(
    files.map((f) => `js/${name}/regions/${f}`),
    root,
  );
  const specs = readShippedSpecs(name, root);
  const priceNames = priceFields(name);
  const regions = {};
  for (const f of files) {
    const key = f.replace(/\.js$/, "");
    if (!g[key] || typeof g[key] !== "object") {
      throw new Error(`js/${name}/regions/${f} did not assign window.${key}`);
    }
    const merged = {};
    for (const [type, priceRec] of Object.entries(g[key])) {
      const rec = { ...specs[type], ...priceRec };
      // A priced record whose specs did not come back is the split's silent failure
      // mode — a wrong manifest, a missing {P}_SPECS, or a type the blob does not
      // name. Every consumer would read undefined vCPUs and quietly drop the type,
      // so fail here, once, by name.
      //
      // Keyed on vCpus, not on "some spec" and not on "every spec". Every provider
      // declares it and every consumer reads it, so its absence is exactly the
      // failure this guards; "some spec" would wave through a half-merged record,
      // which is dropped downstream just as silently as an unmerged one.
      //
      // NOT "every spec": that conflates a failed merge with a schema addition. A
      // field newly added to FIELD_ORDER is legitimately absent from the shipped
      // manifest until the next refresh writes it, and a guard demanding all of them
      // would break the whole tree in the window between the two.
      const hasPrice = priceNames.some((p) => rec[p] !== undefined);
      if (hasPrice && rec.vCpus === undefined) {
        throw new Error(
          `js/${name}/regions/${f}: ${type} has prices but no vCpus — ` +
            `js/${name}/${name}-data.js carries no usable ` +
            `${name.toUpperCase()}_SPECS.${SERVICE}[${type}] to merge`,
        );
      }
      merged[type] = rec;
    }
    regions[key] = merged;
  }
  return regions;
}

// {P}_SPECS.compute from the shipped manifest, or {} when there is no specs blob to
// read — a manifest that predates the split, or no manifest at all. Neither is an
// error HERE: both describe the pre-split format, whose region files are fat and need
// no merge. The price-but-no-specs guard above is what makes that tolerance safe; it
// fires the moment a price-only record arrives with nothing to pair it with, and its
// message names the manifest that should have carried the specs.
function readShippedSpecs(name, root = ROOT) {
  const rel = `js/${name}/${name}-data.js`;
  if (!fs.existsSync(path.join(root, rel))) return {};
  const blob = loadGlobals(rel, root)[`${name.toUpperCase()}_SPECS`];
  return (blob && blob[SERVICE]) || {};
}

// The {PREFIX}_REGION_KEYS manifest array from js/{name}/{name}-data.js.
function readShippedRegionKeys(name, prefix, root = ROOT) {
  const g = loadGlobals(`js/${name}/${name}-data.js`, root);
  const keys = g[`${prefix}_REGION_KEYS`];
  if (!Array.isArray(keys) || !keys.length) {
    throw new Error(`[${name}] no ${prefix}_REGION_KEYS in shipped manifest`);
  }
  return keys;
}

// --date for a refresh: the value becomes {PREFIX}_DATA_DATE, which the page renders
// verbatim in the "Instance data updated" badge, so whatever is passed here ships to
// users as-is. Must be a real calendar day in YYYY-MM-DD: the round-trip is what
// rejects 2026-02-30, which the pattern admits and Date silently rolls to 2026-03-02.
function resolveDataDate(arg, today = new Date()) {
  if (arg === undefined) return today.toISOString().slice(0, 10);
  const d = new Date(`${arg}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(arg) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== arg
  ) {
    throw new Error(
      `invalid --date ${arg} — expected a real calendar date as YYYY-MM-DD`,
    );
  }
  return arg;
}

// Write through a sibling .tmp and rename. The rename is atomic, so a reader never
// sees a half-written artifact and a write that fails part-way cannot truncate the
// file it was replacing — a clobbered manifest breaks readShippedRegionKeys on the
// next run until git restore. .tmp is gitignored, so a hard kill leaves nothing the
// refresh PR could pick up.
//
// Per FILE, not per run: the pipeline writes several artifacts and each rename is
// its own operation, so a failure between two still leaves a mixed set. Making the
// set all-or-nothing would need a journal this tooling does not have; what this
// buys is that no single artifact is ever torn or truncated.
function writeFileAtomic(target, contents) {
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, contents, "utf8");
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best effort — the write error is the one worth reporting.
    }
    throw err;
  }
}

// ── The shipped record shape ─────────────────────────────────────────────────
// One declared field order per provider, and the partition of it into the two
// halves the data is stored as: SPECS, which every region offering a type repeats
// identically, and PRICES, the only fields that legitimately vary region to region.
//
// Both writers read this list. fetch-vantage serializes the fat monolith from it;
// split-data writes the specs blob and the price-only region files from it. One
// source is the point — a field added to the feed but named in only one of two
// partitions would be written by one tool and dropped by the other, and the loss
// would read as a data change rather than as a bug.
const FIELD_ORDER = {
  aws: [
    "instanceFamily",
    "instanceFamilyName",
    "isGraviton",
    "currentGeneration",
    "processorManufacturer",
    "vCpus",
    "memorySizeInGiB",
    "nitroEnclavesSupport",
    "onDemandLinuxHr",
    "onDemandWindowsHr",
  ],
  azure: [
    "family",
    "familyName",
    "isARM",
    "generation",
    "processorArchitecture",
    "vCpus",
    "memoryGiB",
    "linuxPrice",
    "windowsPrice",
  ],
  gcp: [
    "series",
    "seriesName",
    "generation",
    "vCpus",
    "memoryGiB",
    // Attached local SSD in GiB, 0 when the type has none. A spec: it is a property
    // of the machine type, identical in every region. Needed because GCP prices
    // local SSD as a separate per-GiB SKU, so a type that bundles one cannot be
    // composed from cores and memory alone.
    "localSsdGiB",
    "hourlyPrice",
    "windowsHourlyPrice",
    "cpuPlatform",
    "isARM",
  ],
};

// The Windows rate counts as a price even though no product code reads it — it is
// written by the refresh pipeline and consumed only by build tooling and tests.
// It is also genuinely region-varying (Azure types offered for Windows in some
// regions and not others), so it has to sit on the price side: carrying it in
// specs would publish one region's Windows availability as every region's.
const PRICE_FIELDS = {
  aws: ["onDemandLinuxHr", "onDemandWindowsHr"],
  azure: ["linuxPrice", "windowsPrice"],
  gcp: ["hourlyPrice", "windowsHourlyPrice"],
};

// Derived, never hand-listed: a field added to FIELD_ORDER and not named a price
// becomes a spec automatically, so the two lists cannot disagree about coverage.
// The membership check catches the other direction — a price field renamed in
// FIELD_ORDER but not here would otherwise silently drop out of both halves.
function specFields(name) {
  const order = FIELD_ORDER[name];
  const prices = PRICE_FIELDS[name];
  if (!order || !prices) throw new Error(`unknown provider ${name}`);
  const stray = prices.filter((f) => !order.includes(f));
  if (stray.length) {
    throw new Error(
      `[${name}] PRICE_FIELDS names a field FIELD_ORDER does not have: ${stray.join(", ")}`,
    );
  }
  return order.filter((f) => !prices.includes(f));
}

// Price fields in FIELD_ORDER's order, so a region file's field order matches the
// order those same fields had in the fat record.
function priceFields(name) {
  const specs = new Set(specFields(name));
  return FIELD_ORDER[name].filter((f) => !specs.has(f));
}

// Match the committed region-file style: string values JSON-quoted, numbers bare.
// A non-finite number or undefined would serialize to a "NaN"/"undefined" token and
// silently ship a broken record — fail the build instead.
const emitValue = (v) => {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new Error(`emitValue: non-serializable field value ${String(v)}`);
};

// The named fields in the given order, one per line at the given indent. A missing
// field is NOT skipped — emitValue throws on undefined, which is the tripwire for a
// record that lost a field upstream.
const emitRecordBody = (fields, record, indent = "    ") =>
  fields.map((f) => `${indent}${f}: ${emitValue(record[f])},`).join("\n");

module.exports = {
  ROOT,
  round8,
  argValue,
  resolveDataDate,
  writeFileAtomic,
  loadGlobals,
  loadCommittedRegions,
  readShippedRegionKeys,
  readShippedSpecs,
  monolithPath,
  SERVICE,
  FIELD_ORDER,
  PRICE_FIELDS,
  specFields,
  priceFields,
  emitValue,
  emitRecordBody,
};

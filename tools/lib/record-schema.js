"use strict";
/*
 * tools/lib/record-schema.js — the shipped record's field schema (which fields exist,
 * which half of the split each belongs to, and their canonical order), plus reading
 * that shape back out of committed data. The 8-decimal price normalizer is part of
 * the same cross-tool contract: fetch-vantage, the official fetchers, data-diff and
 * reconcile must all round identically, or a re-quote of the same price reads as a
 * spurious move in the diff. See CANONICAL-SOURCES.md — this file is the registry's
 * entry for per-provider price/spec field membership and order. Split out of the
 * former tools/lib/util.js 2026-09-04, which mixed this with generic Node/CI
 * primitives (now tools/lib/build-env.js) under one catch-all name. Node/CI only;
 * never shipped to the page.
 */

const fs = require("fs");
const path = require("path");
const { ROOT, runFiles, loadGlobals } = require("./build-env");

// Round to 8 decimals — the deepest precision the shipped data uses. Non-finite
// values pass through unchanged (callers guard those separately).
const round8 = (v) => (Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v);

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
  round8,
  SERVICE,
  FIELD_ORDER,
  PRICE_FIELDS,
  specFields,
  priceFields,
  emitValue,
  emitRecordBody,
  loadCommittedRegions,
  readShippedSpecs,
  readShippedRegionKeys,
};

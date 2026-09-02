#!/usr/bin/env node
"use strict";
/*
 * reconcile-data.js — merge the official-API price/spec fetches (Phase D1) into the
 * Vantage-derived monolith (Phase B1), official taking precedence, and re-emit the
 * monolith for tools/split-data.js.
 *
 *   node tools/reconcile-data.js [--provider aws|azure|gcp]
 *
 * Run AFTER tools/fetch-vantage.js writes .refresh-cache/{p}-monolith.js and the
 * official fetchers write .refresh-cache/{p}-pricing.json, and BEFORE
 * tools/split-data.js. Reads and rewrites the scratch monolith in place; the shipped
 * js/ tree is not touched here at all. Node/CI build tool only; never shipped.
 *
 * Precedence (design B0): the official API wins field by field.
 *   - Pricing — always the official value where the official fetch carries it. A type
 *     with no official entry keeps its Vantage price and is reported UNVERIFIED.
 *   - Specs — only AWS's official source (Price List) carries vCPU/memory/family; it
 *     wins, and a disagreement beyond tolerance is recorded as a CONFLICT (both values,
 *     official taken). Azure Retail and GCP Catalog are pricing-only, so their specs
 *     stay from Vantage and are UNVERIFIED by construction (stated once per provider,
 *     not per record).
 *
 * Pricing stays internal ranking data, never printed to a shipped output (D8). The
 * reconciliation report below is an internal maintainer artifact for the refresh PR
 * (Phase C2's reconciliation section), so it MAY show absolute prices.
 *
 * reconcileProvider / renderReport are pure and fixture-tested; the disk loaders are the
 * only part that touches the filesystem. See docs/DATA-SOURCES.md.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { serializeMonolith } = require("./fetch-vantage");
const { ROOT, argValue, writeFileAtomic, monolithPath } = require("./lib/util");

const PROVIDERS = [
  {
    name: "aws",
    prefix: "AWS",
    source: "instances.vantage.sh + AWS Price List",
  },
  {
    name: "azure",
    prefix: "AZURE",
    source: "instances.vantage.sh/azure + Azure Retail Prices",
  },
  {
    name: "gcp",
    prefix: "GCP",
    source: "instances.vantage.sh/gcp + GCP Cloud Billing Catalog",
  },
];

// Which record fields the official fetch supplies per provider. Prices are always taken
// from official when present; specs only where the official API carries them (AWS Price
// List has vCPU/memory/family; Azure Retail and GCP Catalog are pricing-only). Field
// names already match the monolith's, so a match is a direct overwrite.
const OFFICIAL_FIELDS = {
  aws: {
    price: ["onDemandLinuxHr", "onDemandWindowsHr"],
    spec: ["instanceFamily", "instanceFamilyName", "vCpus", "memorySizeInGiB"],
  },
  azure: { price: ["linuxPrice", "windowsPrice"], spec: [] },
  gcp: { price: ["hourlyPrice", "windowsHourlyPrice"], spec: [] },
};

// Memory can differ in the last digit across GiB/GB rounding conventions; 1% is noise,
// beyond that is a real disagreement. vCPU is an integer count and must match exactly.
const MEM_TOLERANCE = 0.01;

// ── Pure reconciliation ─────────────────────────────────────────────────────────

// Whether a Vantage spec value genuinely disagrees with the official one (not just
// float/rounding noise). vCPU exact; memory within MEM_TOLERANCE; strings exact.
function isSpecConflict(field, vantage, official) {
  if (field === "vCpus") return Number(vantage) !== Number(official);
  if (field === "memorySizeInGiB") {
    const a = Number(vantage);
    const b = Number(official);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a !== b;
    return (
      Math.abs(a - b) > MEM_TOLERANCE * Math.max(Math.abs(a), Math.abs(b), 1)
    );
  }
  return String(vantage) !== String(official);
}

/**
 * Merge one provider's official fetch into its Vantage region map, official winning.
 * Mutates `byRegion` in place (prices/specs overwritten) and returns it with a report.
 * @param {"aws"|"azure"|"gcp"} name
 * @param {Object<string,Object<string,object>>} byRegion  { regionKey: { type: record } }
 * @param {Object<string,Object<string,object>>} official  { regionKey: { type: fields } }
 * @returns {{ byRegion: object, report: object }}
 */
function reconcileProvider(name, byRegion, official) {
  const cfg = OFFICIAL_FIELDS[name];
  if (!cfg) throw new Error(`unknown provider ${name}`);
  official = official || {};

  const report = {
    provider: name,
    typesVerified: 0, // type×region that had an official price entry
    priceFieldsUpdated: 0, // official price fields that differed and were taken
    specFieldsUpdated: 0, // official spec fields that differed and were taken
    unverifiedPrices: [], // "type@region" with no official price at all
    specConflicts: [], // { type, region, field, vantage, official }
    specsUnverified: cfg.spec.length === 0, // whole provider: no official spec source
  };

  for (const [rk, types] of Object.entries(byRegion)) {
    const off = official[rk] || {};
    for (const [type, rec] of Object.entries(types)) {
      const o = off[type];
      if (!o) {
        report.unverifiedPrices.push(`${type}@${rk}`);
        continue;
      }
      report.typesVerified++;

      for (const f of cfg.price) {
        if (Number.isFinite(o[f]) && o[f] !== rec[f]) {
          rec[f] = o[f];
          report.priceFieldsUpdated++;
        }
      }
      for (const f of cfg.spec) {
        if (o[f] === undefined || o[f] === null) continue;
        if (isSpecConflict(f, rec[f], o[f])) {
          report.specConflicts.push({
            type,
            region: rk,
            field: f,
            vantage: rec[f],
            official: o[f],
          });
        }
        if (rec[f] !== o[f]) {
          rec[f] = o[f];
          report.specFieldsUpdated++;
        }
      }
    }
  }

  report.unverifiedPrices.sort();
  report.specConflicts.sort(
    (a, b) =>
      (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) ||
      (a.field < b.field ? -1 : 1),
  );
  return { byRegion, report };
}

// ── Report ─────────────────────────────────────────────────────────────────────

const LABEL = { aws: "AWS", azure: "Azure", gcp: "GCP" };

function renderProviderReport(r) {
  const L = [`### ${LABEL[r.provider]}`];
  L.push(
    `- ${r.typesVerified} type×region priced from the official API ` +
      `(${r.priceFieldsUpdated} price field(s) corrected).`,
  );
  if (r.specsUnverified) {
    L.push(
      "- Specs: no official spec source (pricing-only API) — vCPU, memory and family " +
        "stay from Vantage, UNVERIFIED.",
    );
  } else {
    L.push(
      `- Specs: ${r.specFieldsUpdated} field(s) corrected from the official API.`,
    );
  }
  if (r.specConflicts.length) {
    L.push(`- ⚠ Spec conflicts (${r.specConflicts.length}, official taken):`);
    for (const c of r.specConflicts)
      L.push(
        `  - ${c.type} ${c.field}: Vantage ${c.vantage} → official ${c.official}`,
      );
  }
  if (r.unverifiedPrices.length) {
    const n = r.unverifiedPrices.length;
    const sample = r.unverifiedPrices.slice(0, 8).join(", ");
    L.push(
      `- ${n} type×region kept Vantage pricing (no official rate), UNVERIFIED` +
        (n > 8 ? ` — e.g. ${sample}, …` : `: ${sample}`),
    );
  }
  return L.join("\n");
}

// First line is a machine-readable sentinel: CONFLICTS if any provider disagreed on a
// spec (a reviewer must look), else CLEAN.
function renderReport(reports) {
  const anyConflict = reports.some((r) => r.specConflicts.length);
  const L = [
    `<!-- reconcile: ${anyConflict ? "CONFLICTS" : "CLEAN"} -->`,
    "## Official-source reconciliation",
    "",
  ];
  for (const r of reports) L.push(renderProviderReport(r), "");
  return L.join("\n").trimEnd() + "\n";
}

// ── Disk loaders ────────────────────────────────────────────────────────────────

// Run the scratch monolith fetch-vantage just wrote and read back { byRegion,
// dataDate }. Null when it is absent — fetch-vantage did not run this cycle — and the
// caller skips rather than reconciling
// data that is not there. Absence is the whole signal now: this path holds a monolith
// or nothing, so the old "does the source say _REGION_KEYS?" sniff, which existed only
// to tell a monolith from a manifest at one shared path, is gone.
function loadMonolith(name, prefix) {
  const file = monolithPath(name);
  if (!fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: `${name}-monolith.js` });

  const call = source.match(/make\w*RegionsGlobal\(\{([\s\S]*?)\}\)/);
  const keys = call
    ? call[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const byRegion = {};
  for (const k of keys) {
    if (!sandbox[k] || typeof sandbox[k] !== "object") {
      throw new Error(
        `[${name}] monolith names region ${k} but defines no object`,
      );
    }
    byRegion[k] = sandbox[k];
  }
  return { byRegion, dataDate: sandbox[`${prefix}_DATA_DATE`] };
}

// The official fetch for one provider, or null when it was not run this cycle.
function loadOfficial(name) {
  const p = path.join(ROOT, ".refresh-cache", `${name}-pricing.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const only = argValue("--provider");
  const targets = PROVIDERS.filter((p) => !only || p.name === only);
  if (!targets.length) throw new Error(`unknown --provider ${only}`);

  const reports = [];
  for (const { name, prefix, source } of targets) {
    const mono = loadMonolith(name, prefix);
    if (!mono) {
      process.stderr.write(
        `[${name}] no .refresh-cache/${name}-monolith.js — run fetch-vantage first; skipping\n`,
      );
      continue;
    }
    const official = loadOfficial(name);
    if (!official) {
      process.stderr.write(
        `[${name}] no .refresh-cache/${name}-pricing.json — run the official fetcher first; skipping\n`,
      );
      continue;
    }
    const { byRegion, report } = reconcileProvider(
      name,
      mono.byRegion,
      official,
    );
    const { monolith } = serializeMonolith({
      name,
      prefix,
      source,
      dataDate: mono.dataDate,
      byRegion,
    });
    writeFileAtomic(monolithPath(name), monolith);
    reports.push(report);
    process.stderr.write(
      `[${name}] reconciled: ${report.typesVerified} verified, ` +
        `${report.priceFieldsUpdated} price + ${report.specFieldsUpdated} spec field(s) corrected, ` +
        `${report.specConflicts.length} conflict(s), ${report.unverifiedPrices.length} unverified\n`,
    );
  }

  if (!reports.length) {
    throw new Error(
      "no provider could be reconciled — run tools/fetch-vantage.js and the official fetchers first",
    );
  }
  process.stdout.write(renderReport(reports));
}

module.exports = {
  reconcileProvider,
  isSpecConflict,
  renderReport,
  renderProviderReport,
  OFFICIAL_FIELDS,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }
}

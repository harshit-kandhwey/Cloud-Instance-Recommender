#!/usr/bin/env node
"use strict";
/*
 * data-diff.js — diff the committed region data against a freshly generated
 * monolith and render a review report for the data-refresh pull request.
 *
 *   node tools/data-diff.js [--provider aws|azure|gcp]
 *
 * Run AFTER tools/fetch-vantage.js writes js/{provider}/{provider}-data.js and
 * BEFORE tools/split-data.js: the region files still hold the old data, the
 * monolith holds the new. Node/CI build tool only; never shipped to the page.
 *
 * The first output line is a machine-readable sentinel the workflow greps to
 * decide whether to open a PR:
 *   <!-- data-diff: CHANGES -->     at least one provider changed
 *   <!-- data-diff: NO-CHANGES -->  every provider is byte-identical
 *
 * diffProvider/renderReport are pure and unit-tested against fixtures; the disk
 * loaders below are the only part that touches the filesystem.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT, round8, argValue } = require("./lib/util");

const PROVIDERS = [
  { name: "aws", prefix: "AWS" },
  { name: "azure", prefix: "AZURE" },
  { name: "gcp", prefix: "GCP" },
];

// Per-provider field roles: which record field names a family, carries a price
// (compared per region), or is a region-independent spec (compared once per type).
const PROVIDER_CFG = {
  aws: {
    familyField: "instanceFamily",
    priceFields: ["onDemandLinuxHr", "onDemandWindowsHr"],
    specFields: [
      "instanceFamilyName",
      "isGraviton",
      "currentGeneration",
      "processorManufacturer",
      "vCpus",
      "memorySizeInGiB",
      "nitroEnclavesSupport",
    ],
  },
  azure: {
    familyField: "family",
    priceFields: ["linuxPrice", "windowsPrice"],
    specFields: [
      "familyName",
      "isARM",
      "generation",
      "processorArchitecture",
      "vCpus",
      "memoryGiB",
    ],
  },
  gcp: {
    familyField: "series",
    priceFields: ["hourlyPrice", "windowsHourlyPrice"],
    specFields: [
      "seriesName",
      "generation",
      "vCpus",
      "memoryGiB",
      "cpuPlatform",
      "isARM",
    ],
  },
};

// ── Pure diff ──────────────────────────────────────────────────────────────────

// { regionKey: { type: record } } → Map(type -> { record, regions:Set }). The
// record is a representative for spec comparison; regions is where the type prices.
function indexTypes(regions) {
  const types = new Map();
  for (const [rk, recs] of Object.entries(regions)) {
    for (const [type, rec] of Object.entries(recs)) {
      if (!types.has(type))
        types.set(type, { record: rec, regions: new Set() });
      types.get(type).regions.add(rk);
    }
  }
  return types;
}

const byType = (a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0);

/**
 * Diff one provider's old vs new region data.
 * @param {"aws"|"azure"|"gcp"} name
 * @param {object} oldRegions  { regionKey: { type: record } }
 * @param {object} newRegions  same shape
 * @returns structured diff (see fields below); all lists sorted for stable output.
 */
function diffProvider(name, oldRegions, newRegions) {
  const cfg = PROVIDER_CFG[name];
  if (!cfg) throw new Error(`unknown provider ${name}`);

  const oldR = new Set(Object.keys(oldRegions));
  const newR = new Set(Object.keys(newRegions));
  const regionsAdded = [...newR].filter((r) => !oldR.has(r)).sort();
  const regionsRemoved = [...oldR].filter((r) => !newR.has(r)).sort();

  const oldTypes = indexTypes(oldRegions);
  const newTypes = indexTypes(newRegions);

  const familyOf = (info) => info.record[cfg.familyField];

  const typesAdded = [];
  const typesRemoved = [];
  for (const [t, info] of newTypes) {
    if (!oldTypes.has(t))
      typesAdded.push({
        type: t,
        family: familyOf(info),
        regions: info.regions.size,
      });
  }
  for (const [t, info] of oldTypes) {
    if (!newTypes.has(t))
      typesRemoved.push({
        type: t,
        family: familyOf(info),
        regions: info.regions.size,
      });
  }

  const oldFam = new Set([...oldTypes.values()].map(familyOf));
  const newFam = new Set([...newTypes.values()].map(familyOf));
  const familiesAdded = [...newFam].filter((f) => !oldFam.has(f)).sort();
  const familiesRemoved = [...oldFam].filter((f) => !newFam.has(f)).sort();

  const specChanges = [];
  const priceChanges = [];
  for (const [t, ninfo] of newTypes) {
    const oinfo = oldTypes.get(t);
    if (!oinfo) continue;

    for (const f of cfg.specFields) {
      if (oinfo.record[f] !== ninfo.record[f]) {
        specChanges.push({
          type: t,
          field: f,
          old: oinfo.record[f],
          new: ninfo.record[f],
        });
      }
    }

    for (const f of cfg.priceFields) {
      const moves = [];
      for (const rk of ninfo.regions) {
        if (!oinfo.regions.has(rk)) continue;
        const o = round8(oldRegions[rk][t][f]);
        const n = round8(newRegions[rk][t][f]);
        if (o === n) continue; // genuinely unchanged
        // A non-finite side (NaN/undefined from a broken refresh) is an anomaly, not
        // a no-change: record it so hasChanges() is true and the reviewer sees it,
        // instead of silently skipping and dropping the refresh PR.
        const bothFinite = Number.isFinite(o) && Number.isFinite(n);
        const pct = bothFinite && o !== 0 ? ((n - o) / o) * 100 : NaN;
        moves.push({ region: rk, old: o, new: n, pct });
      }
      if (!moves.length) continue;
      const pcts = moves.map((m) => m.pct).filter(Number.isFinite);
      // Sample the largest-magnitude move so the reviewer sees the worst case.
      const sample = moves
        .slice()
        .sort((a, b) => (Math.abs(b.pct) || 0) - (Math.abs(a.pct) || 0))[0];
      priceChanges.push({
        type: t,
        field: f,
        regionsChanged: moves.length,
        minPct: pcts.length ? Math.min(...pcts) : NaN,
        maxPct: pcts.length ? Math.max(...pcts) : NaN,
        sample,
      });
    }
  }

  typesAdded.sort(byType);
  typesRemoved.sort(byType);
  specChanges.sort((a, b) => byType(a, b) || (a.field < b.field ? -1 : 1));
  priceChanges.sort((a, b) => byType(a, b) || (a.field < b.field ? -1 : 1));

  return {
    provider: name,
    totalRegions: newR.size,
    regionsAdded,
    regionsRemoved,
    familiesAdded,
    familiesRemoved,
    typesAdded,
    typesRemoved,
    specChanges,
    priceChanges,
  };
}

function hasChanges(d) {
  return Boolean(
    d.regionsAdded.length ||
    d.regionsRemoved.length ||
    d.familiesAdded.length ||
    d.familiesRemoved.length ||
    d.typesAdded.length ||
    d.typesRemoved.length ||
    d.specChanges.length ||
    d.priceChanges.length,
  );
}

// ── Report ─────────────────────────────────────────────────────────────────────

const LABEL = { aws: "AWS", azure: "Azure", gcp: "GCP" };

const fmtPct = (p) =>
  Number.isFinite(p) ? `${p >= 0 ? "+" : ""}${p.toFixed(1)}%` : "from 0";

// "all N regions" when a type/price change spans the whole provider, else "N regions".
const regionSpan = (n, total) =>
  total && n === total
    ? `all ${n} regions`
    : `${n} region${n === 1 ? "" : "s"}`;

function renderProvider(d) {
  const L = [`### ${LABEL[d.provider]}`];
  if (!hasChanges(d)) {
    L.push("No changes.");
    return L.join("\n");
  }

  if (d.regionsAdded.length)
    L.push(`- Regions added: ${d.regionsAdded.join(", ")}`);
  if (d.regionsRemoved.length)
    L.push(
      `- Regions removed: ${d.regionsRemoved.join(", ")} ` +
        `(⚠ bump CACHE in sw.js so clients drop the stale copies)`,
    );
  if (d.familiesAdded.length)
    L.push(`- Families added: ${d.familiesAdded.join(", ")}`);
  if (d.familiesRemoved.length)
    L.push(`- Families removed: ${d.familiesRemoved.join(", ")}`);

  if (d.typesAdded.length) {
    L.push(`- Instance types added (${d.typesAdded.length}):`);
    for (const t of d.typesAdded)
      L.push(
        `  - ${t.type} [${t.family}] — ${regionSpan(t.regions, d.totalRegions)}`,
      );
  }
  if (d.typesRemoved.length) {
    L.push(`- Instance types retired (${d.typesRemoved.length}):`);
    for (const t of d.typesRemoved)
      L.push(
        `  - ${t.type} [${t.family}] — was in ${regionSpan(t.regions, d.totalRegions)}`,
      );
  }
  if (d.specChanges.length) {
    L.push(`- Spec changes (${d.specChanges.length}):`);
    for (const c of d.specChanges)
      L.push(`  - ${c.type} ${c.field}: ${c.old} → ${c.new}`);
  }
  if (d.priceChanges.length) {
    L.push(`- Price moves (${d.priceChanges.length}):`);
    for (const c of d.priceChanges) {
      const s = c.sample;
      const range =
        Number.isFinite(c.minPct) && Number.isFinite(c.maxPct)
          ? c.minPct === c.maxPct
            ? fmtPct(c.minPct)
            : `${fmtPct(c.minPct)}..${fmtPct(c.maxPct)}`
          : "n/a";
      // A non-finite side prints its raw value with an "unparseable" tag; "from 0"
      // stays reserved for a genuine zero-baseline move (both sides finite).
      const sPct = Number.isFinite(s.pct)
        ? fmtPct(s.pct)
        : Number.isFinite(s.old) && Number.isFinite(s.new)
          ? "from 0"
          : "unparseable";
      L.push(
        `  - ${c.type} ${c.field}: ${regionSpan(c.regionsChanged, d.totalRegions)}, ` +
          `${range} (${s.region} ${s.old} → ${s.new} ${sPct})`,
      );
    }
  }
  return L.join("\n");
}

// Full report string. First line is the CHANGES/NO-CHANGES sentinel.
function renderReport(diffs) {
  const changed = diffs.some(hasChanges);
  const L = [
    `<!-- data-diff: ${changed ? "CHANGES" : "NO-CHANGES"} -->`,
    "## Data refresh diff",
    "",
  ];
  if (!changed) L.push("No data changes detected.");
  else for (const d of diffs) L.push(renderProvider(d), "");
  return L.join("\n").trimEnd() + "\n";
}

// ── Disk loaders ────────────────────────────────────────────────────────────────

function runFiles(relPaths) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of relPaths) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sandbox, {
      filename: rel,
    });
  }
  return sandbox;
}

// Committed region data — the "old" side. Read straight from js/{name}/regions/:
// data-diff runs after fetch-vantage has already overwritten the manifest with the
// new monolith, but before split-data touches the region files, so the directory
// still holds the previous data. Each file is `window.<key> = {...}`.
function loadCommittedRegions(name) {
  const dir = path.join(ROOT, "js", name, "regions");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const g = runFiles(files.map((f) => `js/${name}/regions/${f}`));
  const regions = {};
  for (const f of files) {
    const key = f.replace(/\.js$/, "");
    if (!g[key] || typeof g[key] !== "object") {
      throw new Error(`js/${name}/regions/${f} did not assign window.${key}`);
    }
    regions[key] = g[key];
  }
  return regions;
}

// Extract { regionKey: {type:record} } from a freshly generated monolith by
// running it and reading the keys the make{PREFIX}RegionsGlobal({...}) call lists.
function regionsFromMonolith(source) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "monolith.js" });
  const call = source.match(/make\w*RegionsGlobal\(\{([\s\S]*?)\}\)/);
  const keys = call
    ? call[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const regions = {};
  for (const k of keys) {
    if (!sandbox[k] || typeof sandbox[k] !== "object") {
      throw new Error(
        `monolith lists ${k} in its make-call but never defines it`,
      );
    }
    regions[k] = sandbox[k];
  }
  return regions;
}

// New data: the not-yet-split monolith fetch-vantage just wrote. If it has already
// been split (manifest), there is nothing new to diff against — signal that.
function loadNewRegions(name) {
  const source = fs
    .readFileSync(path.join(ROOT, "js", name, `${name}-data.js`), "utf8")
    .replace(/\r\n/g, "\n");
  if (source.includes("_REGION_KEYS")) return null; // already a manifest
  return regionsFromMonolith(source);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const only = argValue("--provider");
  const targets = PROVIDERS.filter((p) => !only || p.name === only);
  if (!targets.length) throw new Error(`unknown --provider ${only}`);

  const diffs = [];
  let skipped = 0;
  for (const { name } of targets) {
    const newRegions = loadNewRegions(name);
    if (newRegions === null) {
      skipped++;
      process.stderr.write(
        `[${name}] ${name}-data.js is a manifest (already split) — run fetch-vantage first; skipping\n`,
      );
      continue;
    }
    const oldRegions = loadCommittedRegions(name);
    diffs.push(diffProvider(name, oldRegions, newRegions));
  }
  // No provider could be diffed (every target was already split) — never print a
  // NO-CHANGES sentinel here: that is a false negative that makes the workflow skip
  // the PR after a real refresh. Fail loudly instead.
  if (!diffs.length) {
    throw new Error(
      `no provider could be diffed (${skipped}/${targets.length} already split as manifests) — run fetch-vantage before data-diff`,
    );
  }
  process.stdout.write(renderReport(diffs));
}

module.exports = {
  diffProvider,
  hasChanges,
  renderReport,
  renderProvider,
  regionsFromMonolith,
  PROVIDER_CFG,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }
}

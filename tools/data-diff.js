#!/usr/bin/env node
"use strict";
/*
 * data-diff.js — diff the committed region data against a freshly generated
 * monolith and render a review report for the data-refresh pull request.
 *
 *   node tools/data-diff.js [--provider aws|azure|gcp]
 *
 * Run AFTER tools/fetch-vantage.js writes .refresh-cache/{provider}-monolith.js
 * and BEFORE tools/split-data.js: the shipped js/ tree still holds the old data,
 * the scratch monolith holds the new. Node/CI build tool only; never shipped.
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
const vm = require("vm");
const { argValue, monolithPath } = require("./lib/build-env");
const {
  round8,
  loadCommittedRegions,
  specFields,
  priceFields,
} = require("./lib/record-schema");

const PROVIDERS = [
  { name: "aws", prefix: "AWS" },
  { name: "azure", prefix: "AZURE" },
  { name: "gcp", prefix: "GCP" },
];

// Which record field names a family (grouped via familiesAdded/familiesRemoved
// below, never as a per-type spec move — a family value changing on the SAME type
// key would be a data anomaly, not the kind of drift this diff tracks), carries a
// price (compared per region), or is a region-independent spec (compared once per
// type). specFields/priceFields are DERIVED from tools/lib/record-schema.js's FIELD_ORDER,
// never hand-listed here: that module exists precisely because a field named in
// only one of two partitions gets written by one tool and dropped by the other, and
// hand-listing a second copy in THIS file reproduced exactly that failure — GCP's
// localSsdGiB (added in 3.15.7) was never added here, so a refresh that changed only
// a type's local-SSD size would report NO-CHANGES and never reach split-data.
const PROVIDER_CFG = {};
for (const { name } of PROVIDERS) {
  const familyField = { aws: "instanceFamily", azure: "family", gcp: "series" }[
    name
  ];
  PROVIDER_CFG[name] = {
    familyField,
    priceFields: priceFields(name),
    specFields: specFields(name).filter((f) => f !== familyField),
  };
}

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

  // Records the NEW data carries with no price for ANY operating system. The
  // recommender cannot rank what it cannot price, so it drops them — silently,
  // which is the actual defect. A feed states "not offered here" by OMITTING the
  // record, so a record that is PRESENT with every price at zero is a different
  // statement: a gap in the feed rather than a product decision. `pricedIn` is
  // what tells the two apart at review time — a type priced in other regions is
  // a publication lag, not a withdrawal.
  //
  // Deliberately NOT part of hasChanges(): this is a standing property of the
  // incoming data, not a delta. Counting it as a change would open a refresh PR
  // every month for as long as the gap persists upstream, which is forever.
  // A price field that is ABSENT is not a zero, and the two must not be folded
  // together — the same distinction the selector draws. Absent means the record
  // never carried the field (a malformed or half-built record, which the spec
  // machinery surfaces on its own terms); a present zero is the provider stating
  // it does not sell that combination. Only the latter belongs here, or a broken
  // refresh would be misreported as a catalogue of price gaps.
  const statedZero = (rec, f) => {
    const v = Number(rec[f]);
    return rec[f] !== undefined && Number.isFinite(v) && v <= 0;
  };

  const unpriced = [];
  for (const [t, ninfo] of newTypes) {
    const dead = [];
    for (const rk of ninfo.regions) {
      const rec = newRegions[rk][t];
      if (cfg.priceFields.every((f) => statedZero(rec, f))) dead.push(rk);
    }
    if (dead.length)
      unpriced.push({
        type: t,
        family: familyOf(ninfo),
        regions: dead.sort(),
        pricedIn: ninfo.regions.size - dead.length,
      });
  }

  unpriced.sort(byType);
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
    unpriced,
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

const unpricedCount = (d) =>
  (d.unpriced || []).reduce((n, u) => n + u.regions.length, 0);

// Standing data-quality section, rendered whether or not anything changed — the
// gap it reports outlives any single refresh, and a reviewer who only ever sees it
// on a changed run would never learn it was there. Returns null when clean.
function renderUnpriced(diffs) {
  const withAny = diffs.filter((d) => (d.unpriced || []).length);
  if (!withAny.length) return null;
  const total = withAny.reduce((n, d) => n + unpricedCount(d), 0);
  const L = [
    `## ⚠ Records priced for no operating system (${total})`,
    "",
    "Present in the feed but carrying no price for any OS. The recommender cannot rank",
    "what it cannot price, so it drops these — this section is the only place that says",
    "so. Not a diff: it is reported every run and is never on its own a reason to open",
    "a PR.",
    "",
    'A feed states "not offered here" by OMITTING the record, so a record that is',
    "present with every price at zero is a different statement — a gap in the feed, not",
    'a product decision. Read the "priced in" count: a type priced in other regions is',
    "almost certainly a publication lag rather than a withdrawal.",
    "",
  ];
  for (const d of withAny) {
    L.push(
      `### ${LABEL[d.provider]} — ${unpricedCount(d)} record(s) across ` +
        `${d.unpriced.length} type(s)`,
    );
    for (const u of d.unpriced)
      L.push(
        `- ${u.type} [${u.family}] — unpriced in ${u.regions.join(", ")} ` +
          `(priced in ${u.pricedIn} other region${u.pricedIn === 1 ? "" : "s"})`,
      );
    L.push("");
  }
  return L.join("\n").trimEnd();
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
  const un = renderUnpriced(diffs);
  if (un) L.push("", un);
  return L.join("\n").trimEnd() + "\n";
}

// ── Disk loaders ────────────────────────────────────────────────────────────────

// The "old" side — js/{name}/regions/ — is loaded by the shared
// loadCommittedRegions in tools/lib/record-schema.js, which recommendation-diff reads too.

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

// New data: the scratch monolith fetch-vantage just wrote. Absent means there is
// nothing new to diff against — signal that. The path holds a monolith or nothing,
// so absence is the whole test; the old "does it say _REGION_KEYS?" sniff existed
// only because this file and the shipped manifest shared one path.
function loadNewRegions(name) {
  const file = monolithPath(name);
  if (!fs.existsSync(file)) return null;
  return regionsFromMonolith(
    fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
  );
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
        `[${name}] no .refresh-cache/${name}-monolith.js — run fetch-vantage first; skipping\n`,
      );
      continue;
    }
    const oldRegions = loadCommittedRegions(name);
    diffs.push(diffProvider(name, oldRegions, newRegions));
  }
  // No provider could be diffed (no target had a fresh monolith) — never print a
  // NO-CHANGES sentinel here: that is a false negative that makes the workflow skip
  // the PR after a real refresh. Fail loudly instead.
  if (!diffs.length) {
    throw new Error(
      `no provider could be diffed (${skipped}/${targets.length} had no scratch monolith) — run fetch-vantage before data-diff`,
    );
  }
  process.stdout.write(renderReport(diffs));
}

module.exports = {
  diffProvider,
  hasChanges,
  renderReport,
  renderProvider,
  renderUnpriced,
  regionsFromMonolith,
  PROVIDER_CFG,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    // exitCode, not exit(): refresh-local captures this tool's stdout straight into
    // the diff report, so its stdout is always a pipe and exit() can truncate it.
    process.exitCode = 1;
  }
}

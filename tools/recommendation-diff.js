#!/usr/bin/env node
"use strict";
/*
 * recommendation-diff.js — run the REAL recommendation engine over the committed
 * region data and over the freshly generated monolith, for the representative sample
 * inputs, and report every case where a refresh FLIPS a recommended instance.
 *
 *   node tools/recommendation-diff.js [--provider aws|azure|gcp]
 *
 * Run AFTER tools/fetch-vantage.js (+ reconcile) writes the new monolith and BEFORE
 * tools/split-data.js — same window as data-diff: js/{p}/regions/ still holds the old
 * data (the "before" engine input) while .refresh-cache/{p}-monolith.js is the fresh
 * monolith (the "after" input). Node/CI build tool only; never shipped.
 *
 * Why this exists (Phase C2.4): the goldens already fail when a pick moves, forcing a
 * re-baseline, but a byte diff of a wide CSV does not tell a reviewer WHICH pick flipped
 * or from what to what. This renders that plainly for the refresh PR so a price move that
 * reorders a ranking is seen, not just re-baselined. The canary inputs and the engine
 * file list are imported from the golden harness so the flip check and the goldens can
 * never disagree on what a representative run is.
 *
 * Pricing feeds the ranking but is NOT printed here — only instance identifiers move
 * across the arrow — so the no-pricing rule (D8) is unchanged; this is an internal
 * maintainer artifact regardless.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { regionsFromMonolith } = require("./data-diff");
const {
  ROOT,
  argValue,
  loadCommittedRegions,
  monolithPath,
} = require("./lib/util");
const {
  SAMPLE_CSV,
  parseSample,
  SCENARIOS,
  CODE_FILES,
} = require("../tests/golden/golden-run");

// A result column names a chosen instance when it ends in one of these — the
// like-to-like / optimized "… Instance" picks and the four summary picks (cost,
// workload, newest gen, GCP custom fit). The spec columns (vCPUs, Memory) and the
// input columns never end this way, so only pick IDENTITY is compared, not its
// consequences.
const PICK_SUFFIXES = [
  "Instance",
  "Most Cost Optimized",
  "Workload Based",
  "Newest Generation",
  "Custom Fit",
];

// ── Pure diff ────────────────────────────────────────────────────────────────────

function recommendationColumns(keys) {
  return keys.filter((k) => PICK_SUFFIXES.some((s) => k.endsWith(s)));
}

// Flips between two result sets for the same inputs: matched by VM Name, every pick
// column whose value changed becomes { vm, column, from, to }. A VM present on only one
// side (should not happen for identical inputs) is reported as an appear/disappear.
function diffScenario(oldResults, newResults) {
  const byVm = (rows) => new Map(rows.map((r) => [r["VM Name"], r]));
  const oldByVm = byVm(oldResults);
  const newByVm = byVm(newResults);
  const vms = [...new Set([...oldByVm.keys(), ...newByVm.keys()])].sort();

  const cols = recommendationColumns([
    ...new Set([
      ...oldResults.flatMap((r) => Object.keys(r)),
      ...newResults.flatMap((r) => Object.keys(r)),
    ]),
  ]);

  const flips = [];
  for (const vm of vms) {
    const o = oldByVm.get(vm);
    const n = newByVm.get(vm);
    if (!o || !n) {
      flips.push({
        vm,
        column: "(row)",
        from: o ? "present" : "(absent)",
        to: n ? "present" : "(absent)",
      });
      continue;
    }
    for (const c of cols) {
      const from = o[c] ?? "";
      const to = n[c] ?? "";
      if (from !== to) flips.push({ vm, column: c, from, to });
    }
  }
  return flips;
}

// ── Report ─────────────────────────────────────────────────────────────────────

// First line is a machine-readable sentinel: FLIPS if any scenario changed a pick, else
// NONE. The workflow/runbook shows this section in the PR body only when it is FLIPS.
function renderReport(perScenario) {
  const total = perScenario.reduce((n, s) => n + s.flips.length, 0);
  const L = [`<!-- rec-flips: ${total ? "FLIPS" : "NONE"} -->`];
  L.push("## Recommendation flips", "");
  if (!total) {
    L.push("No sample recommendation changed under this refresh.");
    return L.join("\n") + "\n";
  }
  L.push(
    `⚠ ${total} sample recommendation(s) changed — a refresh reordered a ranking. ` +
      "Confirm the new picks are correct before re-baselining the goldens.",
    "",
  );
  for (const { file, flips } of perScenario) {
    if (!flips.length) continue;
    L.push(`### ${file}`);
    for (const f of flips) {
      L.push(`- ${f.vm} — ${f.column}: ${f.from || "—"} → ${f.to || "—"}`);
    }
    L.push("");
  }
  return L.join("\n").trimEnd() + "\n";
}

// ── Data loading (impure) ─────────────────────────────────────────────────────────

// The "old" engine input is js/{name}/regions/ via the shared loadCommittedRegions —
// literally the same loader data-diff uses, so the two diffs can never disagree on
// what the old side is or on which malformed region files they reject.

// Fresh scratch monolith — the "new" engine input. Null when it is absent
// (fetch-vantage did not run this cycle), so the caller skips rather than comparing
// stale. Same signal, and the same loader path, as data-diff's.
function loadNewRegions(name) {
  const file = monolithPath(name);
  if (!fs.existsSync(file)) return null;
  return regionsFromMonolith(
    fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
  );
}

// Build a DOM-free engine context with the given per-provider region maps injected as
// the globals the selectors read (window.<regionKey> + {PREFIX}_REGION_KEYS), then load
// the engine files. Mirrors what executing the real data files would set — verified to
// reproduce the goldens from injected data.
function engineContext(byProvider) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout };
  sb.window = sb;
  vm.createContext(sb);
  for (const [p, byRegion] of Object.entries(byProvider)) {
    for (const k of Object.keys(byRegion)) sb[k] = byRegion[k];
    sb[`${p.toUpperCase()}_REGION_KEYS`] = Object.keys(byRegion);
  }
  for (const f of CODE_FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, {
      filename: f,
    });
  }
  return sb;
}

async function runScenario(scenario, dataBySideProvider) {
  const rows = parseSample();
  const out = {};
  for (const side of ["old", "new"]) {
    const byProvider = {};
    for (const p of scenario.providers)
      byProvider[p] = dataBySideProvider[side][p];
    const ctx = engineContext(byProvider);
    out[side] = await ctx.getInstanceRecommendationWithSelector(
      rows,
      scenario.providers,
      scenario.options,
    );
  }
  return out;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

// The values --provider accepts, derived from the harness rather than listed again
// so a scenario added there is selectable here without a second edit.
const SINGLE_PROVIDERS = [
  ...new Set(
    SCENARIOS.filter((s) => s.providers.length === 1).map(
      (s) => s.providers[0],
    ),
  ),
].sort();

// Scenarios --provider selects. An unrecognised value must NOT quietly select
// nothing: an empty run renders the NONE sentinel and exits 0, so a typo would read
// as "this refresh flipped no recommendation" for a comparison that never ran — the
// same false-negative class as data-diff's all-skipped guard, and the tools it runs
// beside (data-diff, fetch-vantage, reconcile-data) all throw here.
function selectScenarios(only) {
  if (only === undefined) return SCENARIOS;
  const picked = SCENARIOS.filter(
    (s) => s.providers.length === 1 && s.providers[0] === only,
  );
  if (!picked.length) {
    throw new Error(
      `unknown --provider ${only} (expected one of: ${SINGLE_PROVIDERS.join(", ")})`,
    );
  }
  return picked;
}

async function main() {
  const scenarios = selectScenarios(argValue("--provider"));

  // Every provider any selected scenario needs, loaded once per side.
  const providers = [...new Set(scenarios.flatMap((s) => s.providers))];
  const data = { old: {}, new: {} };
  for (const p of providers) {
    const fresh = loadNewRegions(p);
    if (fresh === null) {
      process.stderr.write(
        `[${p}] no .refresh-cache/${p}-monolith.js — run fetch-vantage first; skipping recommendation diff\n`,
      );
      process.stdout.write(
        "<!-- rec-flips: NONE -->\n## Recommendation flips\n\nSkipped: no fresh monolith to compare.\n",
      );
      return;
    }
    data.old[p] = loadCommittedRegions(p);
    data.new[p] = fresh;
  }

  const perScenario = [];
  for (const scenario of scenarios) {
    const { old: oldR, new: newR } = await runScenario(scenario, data);
    perScenario.push({ file: scenario.file, flips: diffScenario(oldR, newR) });
  }

  const report = renderReport(perScenario);
  process.stdout.write(report);
  const total = perScenario.reduce((n, s) => n + s.flips.length, 0);
  process.stderr.write(
    `recommendation-diff: ${total} flip(s) across ${scenarios.length} scenario(s)\n`,
  );
}

module.exports = {
  recommendationColumns,
  diffScenario,
  renderReport,
  selectScenarios,
  PICK_SUFFIXES,
  SINGLE_PROVIDERS,
  SAMPLE_CSV,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    // exitCode, not exit(): refresh-local captures this tool's stdout straight into
    // the flips report, so its stdout is always a pipe and exit() can truncate it.
    process.exitCode = 1;
  });
}

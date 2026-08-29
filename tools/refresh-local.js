#!/usr/bin/env node
"use strict";
/*
 * refresh-local.js — run the data-refresh pipeline locally, in the SAME
 * load-bearing order as .github/workflows/data-refresh.yml, so a maintainer can
 * regenerate the shipped data by hand and open the PR themselves (the "CI + local
 * runbook" model).
 *
 *   npm run refresh                  # specs + pricing (the full cross-verify)
 *   npm run refresh -- --specs-only  # specs only (skip the official fetch + reconcile)
 *   npm run refresh -- --date 2026-08-26
 *
 * ORDER IS LOAD-BEARING (see the workflow header): the official fetchers read the
 * shipped manifest — js/{p}/regions/ + the {P}_REGION_KEYS keys — that fetch-vantage
 * overwrites with a monolith, so they MUST run first:
 *
 *   official fetch (aws,azure,gcp) -> fetch-vantage -> reconcile-data -> data-diff
 *     -> recommendation-diff -> split-data
 *
 * Keys come from the environment; a gitignored .env is loaded first if present
 * (values never printed). This script does NOT touch git: it leaves the regenerated
 * js/ tree, writes the diff + reconcile reports under the gitignored .refresh-cache/,
 * echoes the diff, and then tells you to review, commit with a CHANGELOG row + tag,
 * and open the PR. On a no-op diff it advises `git checkout -- js/` to discard the
 * regenerated monolith. Build tool only; never shipped.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  ROOT,
  argValue,
  resolveDataDate,
  writeFileAtomic,
} = require("./lib/util");

const CACHE = path.join(ROOT, ".refresh-cache");

// ── Pure plan ────────────────────────────────────────────────────────────────

// The ordered pipeline for a run. Split is last (it overwrites js/{p}/regions/,
// which data-diff reads as the OLD side, so the diff must precede it); reconcile
// and the official fetch only exist on a pricing run. Pure so the order — the whole
// point of this tool — is unit-testable without spawning anything.
function planSteps({ pricing, date }) {
  const steps = [];
  if (pricing) {
    for (const p of ["aws", "azure", "gcp"]) {
      steps.push({
        name: `fetch-official-${p}`,
        script: `tools/fetch-official-${p}.js`,
        args: ["--out", path.join(".refresh-cache", `${p}-pricing.json`)],
      });
    }
  }
  steps.push({
    name: "fetch-vantage",
    script: "tools/fetch-vantage.js",
    args: ["--date", date],
  });
  if (pricing) {
    steps.push({
      name: "reconcile-data",
      script: "tools/reconcile-data.js",
      args: [],
      captureTo: path.join(".refresh-cache", "reconcile-report.md"),
    });
  }
  steps.push({
    name: "data-diff",
    script: "tools/data-diff.js",
    args: [],
    captureTo: path.join(".refresh-cache", "diff-report.md"),
    isDiff: true,
  });
  // Recommendation flips: run the engine over old vs new data (reads regions/ as the OLD
  // side, so BEFORE split-data). Only when the diff found changes; its output is echoed.
  steps.push({
    name: "recommendation-diff",
    script: "tools/recommendation-diff.js",
    args: [],
    captureTo: path.join(".refresh-cache", "rec-flips-report.md"),
    onlyIfChanged: true,
    echo: true,
  });
  steps.push({
    name: "split-data",
    script: "tools/split-data.js",
    args: [],
    onlyIfChanged: true,
  });
  return steps;
}

// What a diff-gated step prints when the diff found nothing. MORE THAN ONE step
// carries the gate, so the notice names the step it is actually skipping rather
// than a fixed one — a hardcoded name mislabels every other gated step.
const skipNotice = (step) =>
  `• data-diff reported NO CHANGES — skipping ${step.name}.\n`;

// Parse a KEY=VALUE .env into a map (no dependency, values never logged). Blank
// lines and #-comments skipped; surrounding quotes and a trailing CR stripped.
function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

// Which env keys a run requires, so a missing one fails loud and early rather than
// mid-fetch. Vantage is always needed (specs); the GCP billing key only on pricing.
function missingKeys({ pricing }, env) {
  const need = ["VANTAGE_API_KEY"];
  if (pricing) need.push("GCP_BILLING_API_KEY");
  return need.filter((k) => !env[k]);
}

// ── Side-effecting runner ──────────────────────────────────────────────────────

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  const vals = parseEnv(fs.readFileSync(p, "utf8"));
  for (const [k, v] of Object.entries(vals)) {
    if (process.env[k] === undefined) process.env[k] = v; // real env wins
  }
}

function runStep(step) {
  const scriptPath = path.join(ROOT, step.script);
  if (step.captureTo) {
    const out = execFileSync(process.execPath, [scriptPath, ...step.args], {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileAtomic(path.join(ROOT, step.captureTo), out);
    return out;
  }
  execFileSync(process.execPath, [scriptPath, ...step.args], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  return "";
}

function main() {
  const pricing = !process.argv.includes("--specs-only");
  const date = resolveDataDate(argValue("--date"));

  loadDotEnv();
  const missing = missingKeys({ pricing }, process.env);
  if (missing.length) {
    throw new Error(
      `missing required key(s): ${missing.join(", ")} — set them in .env or the environment`,
    );
  }

  fs.mkdirSync(CACHE, { recursive: true });
  const scope = pricing ? "specs + pricing" : "specs only";
  process.stderr.write(`\n▶ Local data refresh (${scope}), snapshot ${date}\n`);

  const steps = planSteps({ pricing, date });
  let changed = false;
  for (const step of steps) {
    if (step.onlyIfChanged && !changed) {
      process.stderr.write(skipNotice(step));
      continue;
    }
    process.stderr.write(`\n── ${step.name} ─────────────\n`);
    const out = runStep(step);
    if (step.isDiff) {
      const sentinel = out.split(/\r?\n/, 1)[0] || "";
      changed = /data-diff:\s*CHANGES/.test(sentinel);
      process.stdout.write(out);
    } else if (step.echo && out) {
      process.stdout.write(out);
    }
  }

  process.stderr.write("\n" + "─".repeat(60) + "\n");
  if (!changed) {
    process.stderr.write(
      "No data changes vs the committed region files. The working tree still\n" +
        "carries the regenerated monolith form — discard it with:\n\n" +
        "    git checkout -- js/\n\n",
    );
    return;
  }
  process.stderr.write(
    "Refresh complete. Reports written under .refresh-cache/ (gitignored).\n" +
      "Next, BY HAND:\n" +
      "  1. Review the diff above (and .refresh-cache/reconcile-report.md on a pricing run).\n" +
      "  2. Re-baseline any goldens a price move shifted; bump sw.js CACHE if a region was pruned.\n" +
      "  3. git add js/ and commit WITH a CHANGELOG version-map row + annotated tag.\n" +
      "  4. Open the PR against main.\n",
  );
}

module.exports = { planSteps, skipNotice, parseEnv, missingKeys };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }
}

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

// Committed region data — the "old" side for BOTH refresh diffs. Read straight from
// js/{name}/regions/: the diffs run after fetch-vantage has overwritten the manifest
// with the new monolith but before split-data touches the region files, so the
// directory still holds the previous data. Each file is `window.<key> = {...}`.
//
// Lives here rather than in either diff so the two cannot drift: data-diff carried
// the missing-assignment guard and recommendation-diff did not, which published an
// undefined region into the engine's {PREFIX}_REGION_KEYS instead of failing by name.
function loadCommittedRegions(name, root = ROOT) {
  const dir = path.join(root, "js", name, "regions");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const g = runFiles(
    files.map((f) => `js/${name}/regions/${f}`),
    root,
  );
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
// file it was replacing — a clobbered monolith breaks readShippedRegionKeys on the
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

module.exports = {
  ROOT,
  round8,
  argValue,
  resolveDataDate,
  writeFileAtomic,
  loadGlobals,
  loadCommittedRegions,
  readShippedRegionKeys,
};

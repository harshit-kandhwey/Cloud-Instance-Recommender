"use strict";
/*
 * tools/lib/build-env.js — generic Node/CI primitives the refresh/build tools share:
 * locating the repo root, reading CLI flags, running a shipped browser script in a
 * sandboxed VM context, a validated --date, and an atomic file write. None of this
 * knows the shipped record's shape — that lives in tools/lib/record-schema.js, which
 * is built on top of runFiles/loadGlobals/ROOT from here. Split out of the former
 * tools/lib/util.js 2026-09-04: that file mixed these with the record schema under
 * one catch-all name, which CODING_STANDARDS.md's naming rule flags directly. Node/CI
 * only; never shipped to the page.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// tools/lib/build-env.js → repo root.
const ROOT = path.join(__dirname, "..", "..");

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

module.exports = {
  ROOT,
  argValue,
  runFiles,
  loadGlobals,
  monolithPath,
  resolveDataDate,
  writeFileAtomic,
};

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

// Run a shipped JS artifact in a window-like sandbox and return its globals.
function loadGlobals(relPath, root = ROOT) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, relPath), "utf8"), sandbox, {
    filename: relPath,
  });
  return sandbox;
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

module.exports = { ROOT, round8, argValue, loadGlobals, readShippedRegionKeys };

// lib-util suite: pins tools/lib/util.js — the shared build-tool helpers (the
// 8-decimal price contract, CLI flag reader, shipped-manifest reader) that the
// fetchers, data-diff and reconcile all depend on. No network.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeChecker } = require("../harness");
const {
  round8,
  argValue,
  loadCommittedRegions,
  readShippedRegionKeys,
} = require("../../../tools/lib/util");

const { check, state } = makeChecker();

// ── round8: the cross-tool price contract ───────────────────────────────────────
{
  check(
    "round8 strips float noise to 8 decimals but keeps an 8-decimal value",
    round8(0.19423600000000002) === 0.194236 &&
      round8(0.12345678) === 0.12345678,
    String(round8(0.19423600000000002)),
  );
  check(
    "round8 passes non-finite through unchanged",
    Number.isNaN(round8(NaN)) && round8(undefined) === undefined,
  );
}

// ── argValue: CLI flag reader (argv injectable) ─────────────────────────────────
{
  const argv = ["node", "tool.js", "--provider", "aws", "--flag"];
  check(
    "argValue reads the value after a flag",
    argValue("--provider", argv) === "aws",
  );
  check(
    "argValue is undefined for an absent flag",
    argValue("--missing", argv) === undefined,
  );
  check(
    "argValue is undefined for a trailing flag with no value",
    argValue("--flag", argv) === undefined,
  );
}

// ── readShippedRegionKeys: real shipped manifests ───────────────────────────────
{
  for (const [name, prefix] of [
    ["aws", "AWS"],
    ["azure", "AZURE"],
    ["gcp", "GCP"],
  ]) {
    const keys = readShippedRegionKeys(name, prefix);
    check(
      `readShippedRegionKeys(${name}) returns the shipped manifest array`,
      Array.isArray(keys) && keys.length > 0,
      `${keys.length} keys`,
    );
  }
  let threw = false;
  try {
    readShippedRegionKeys("aws", "NOPE");
  } catch {
    threw = true;
  }
  check("readShippedRegionKeys throws on a missing prefix manifest", threw);
}

// ── loadCommittedRegions: the old side both refresh diffs read ──────────────────
// Against a throwaway tree, not js/: the point is the malformed case, which the
// shipped region files must never contain.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cir-regions-"));
  const dir = path.join(root, "js", "aws", "regions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "us_east_1.js"),
    'window.us_east_1 = { "m5.large": { vCpus: 2 } };\n',
  );

  const regions = loadCommittedRegions("aws", root);
  check(
    "loadCommittedRegions keys the region records by file name",
    Object.keys(regions).join(",") === "us_east_1" &&
      regions.us_east_1["m5.large"].vCpus === 2,
    JSON.stringify(regions),
  );

  // Guard (plant-RED: drop the assignment check): a region file that sets no global
  // must fail by name here. recommendation-diff carried its own guardless copy of
  // this loader and published the resulting undefined region into the engine's
  // {PREFIX}_REGION_KEYS, where it surfaced far from the file that caused it.
  fs.writeFileSync(path.join(dir, "ghost.js"), "// assigns no global\n");
  let msg = "";
  try {
    loadCommittedRegions("aws", root);
  } catch (e) {
    msg = e.message;
  }
  check(
    "loadCommittedRegions names the region file that assigned no global",
    msg.includes("js/aws/regions/ghost.js") && msg.includes("window.ghost"),
    msg || "(did not throw)",
  );

  fs.rmSync(root, { recursive: true, force: true });
}

if (state.failures) {
  console.error(`\nlib-util: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nlib-util: all checks passed");
  process.exitCode = 0;
}

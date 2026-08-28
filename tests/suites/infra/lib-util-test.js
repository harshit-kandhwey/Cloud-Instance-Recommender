// lib-util suite: pins tools/lib/util.js — the shared build-tool helpers (the
// 8-decimal price contract, CLI flag reader, shipped-manifest reader) that the
// fetchers, data-diff and reconcile all depend on. No network.
const { makeChecker } = require("../harness");
const {
  round8,
  argValue,
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

if (state.failures) {
  console.error(`\nlib-util: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nlib-util: all checks passed");
  process.exitCode = 0;
}

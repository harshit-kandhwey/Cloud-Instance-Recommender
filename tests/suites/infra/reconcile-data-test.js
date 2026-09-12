// reconcile-data suite: pins tools/reconcile-data.js's pure merge — official pricing and
// (for AWS) specs win field by field, a spec disagreement beyond tolerance is recorded as
// a conflict with the official value taken, a type with no official entry keeps Vantage
// pricing and is reported UNVERIFIED, and pricing-only providers (Azure/GCP) leave specs
// untouched. Inputs are the internal monolith-record / official-fetch shapes, built inline.
const fs = require("fs");
const path = require("path");
const { makeChecker } = require("../harness");
const {
  reconcileProvider,
  isSpecConflict,
  renderReport,
} = require("../../../tools/reconcile-data");

const { check, state } = makeChecker();

// ── AWS: official carries specs → precedence + conflict + unverified ─────────────
{
  const byRegion = {
    us_east1: {
      "m5.large": {
        instanceFamily: "m5",
        vCpus: 2,
        memorySizeInGiB: 8,
        onDemandLinuxHr: 0.096,
        onDemandWindowsHr: 0.188,
      },
      "c6g.medium": {
        instanceFamily: "c6g",
        vCpus: 1,
        memorySizeInGiB: 2,
        onDemandLinuxHr: 0.0272,
        onDemandWindowsHr: 0, // ARM, no Windows offering
      },
      "t9.rare": {
        instanceFamily: "t9",
        vCpus: 1,
        memorySizeInGiB: 1,
        onDemandLinuxHr: 0.01,
        onDemandWindowsHr: 0.02,
      },
    },
  };
  const official = {
    us_east1: {
      "m5.large": {
        instanceFamily: "m5",
        vCpus: 2,
        memorySizeInGiB: 9, // disagrees with Vantage's 8 → conflict, official taken
        onDemandLinuxHr: 0.1,
        onDemandWindowsHr: 0.19,
      },
      "c6g.medium": {
        instanceFamily: "c6g",
        vCpus: 1,
        memorySizeInGiB: 2,
        onDemandLinuxHr: 0.034, // no Windows field → Vantage's 0 is kept
      },
      // t9.rare absent → UNVERIFIED
    },
  };
  const { byRegion: out, report } = reconcileProvider(
    "aws",
    byRegion,
    official,
  );

  check(
    "AWS price precedence: m5.large linux+windows overwritten by official",
    out.us_east1["m5.large"].onDemandLinuxHr === 0.1 &&
      out.us_east1["m5.large"].onDemandWindowsHr === 0.19,
    JSON.stringify(out.us_east1["m5.large"]),
  );
  check(
    "AWS spec conflict recorded, official memory taken",
    report.specConflicts.length === 1 &&
      report.specConflicts[0].field === "memorySizeInGiB" &&
      report.specConflicts[0].vantage === 8 &&
      report.specConflicts[0].official === 9 &&
      out.us_east1["m5.large"].memorySizeInGiB === 9,
    JSON.stringify(report.specConflicts),
  );
  check(
    "missing official Windows rate leaves the Vantage value (c6g stays 0)",
    out.us_east1["c6g.medium"].onDemandWindowsHr === 0 &&
      out.us_east1["c6g.medium"].onDemandLinuxHr === 0.034,
  );
  check(
    "type with no official entry kept Vantage price, reported UNVERIFIED",
    out.us_east1["t9.rare"].onDemandLinuxHr === 0.01 &&
      report.unverifiedPrices.join(",") === "t9.rare@us_east1",
    JSON.stringify(report.unverifiedPrices),
  );
  check(
    "AWS report counts: 2 verified, 3 price + 1 spec field updated",
    report.typesVerified === 2 &&
      report.priceFieldsUpdated === 3 &&
      report.specFieldsUpdated === 1 &&
      report.specsUnverified === false,
    JSON.stringify(report),
  );
}

// ── GCP: pricing-only → prices win, specs untouched + provider-level UNVERIFIED ───
{
  const byRegion = {
    us_east1: {
      "n2-standard-4": {
        series: "n2",
        vCpus: 4,
        memoryGiB: 16,
        hourlyPrice: 0.19,
        windowsHourlyPrice: 0.37,
      },
      "n1-standard-1": {
        series: "n1",
        vCpus: 1,
        memoryGiB: 3.75,
        hourlyPrice: 0.04,
        windowsHourlyPrice: 0.09,
      },
    },
  };
  const official = {
    us_east1: {
      "n2-standard-4": { hourlyPrice: 0.194236, windowsHourlyPrice: 0.378236 },
      // n1 absent (no official GCP SKU)
    },
  };
  const { byRegion: out, report } = reconcileProvider(
    "gcp",
    byRegion,
    official,
  );

  check(
    "GCP price overwritten but series/vCpus (specs) untouched",
    out.us_east1["n2-standard-4"].hourlyPrice === 0.194236 &&
      out.us_east1["n2-standard-4"].series === "n2" &&
      out.us_east1["n2-standard-4"].vCpus === 4,
    JSON.stringify(out.us_east1["n2-standard-4"]),
  );
  check(
    "GCP specs flagged UNVERIFIED (pricing-only source), n1 unverified price",
    report.specsUnverified === true &&
      report.specFieldsUpdated === 0 &&
      report.unverifiedPrices.join(",") === "n1-standard-1@us_east1",
    JSON.stringify(report),
  );
}

// ── isSpecConflict tolerance ─────────────────────────────────────────────────────
{
  check(
    "vCPU exact, memory within 1% is not a conflict, family exact",
    isSpecConflict("vCpus", 2, 4) === true &&
      isSpecConflict("vCpus", 4, 4) === false &&
      isSpecConflict("memorySizeInGiB", 16, 16.1) === false &&
      isSpecConflict("memorySizeInGiB", 16, 20) === true &&
      isSpecConflict("instanceFamily", "m5", "m6i") === true,
  );
}

// ── renderReport sentinel ────────────────────────────────────────────────────────
{
  const clean = renderReport([
    {
      provider: "gcp",
      typesVerified: 1,
      priceFieldsUpdated: 1,
      specFieldsUpdated: 0,
      unverifiedPrices: [],
      specConflicts: [],
      specsUnverified: true,
    },
  ]);
  const conflicted = renderReport([
    {
      provider: "aws",
      typesVerified: 1,
      priceFieldsUpdated: 0,
      specFieldsUpdated: 1,
      unverifiedPrices: [],
      specConflicts: [
        {
          type: "m5.large",
          region: "us_east1",
          field: "memorySizeInGiB",
          vantage: 8,
          official: 9,
        },
      ],
      specsUnverified: false,
    },
  ]);
  check(
    "sentinel: CLEAN with no conflicts, CONFLICTS when a spec disagreed",
    clean.startsWith("<!-- reconcile: CLEAN -->") &&
      conflicted.startsWith("<!-- reconcile: CONFLICTS -->"),
  );
}

// ── Reconcile never touches the shipped js/ tree ─────────────────────────────
// It reads the scratch monolith and rewrites it in place. Structural, because the
// consequence of regressing it is invisible at this tool: writing the reconciled data
// over js/{p}/{p}-data.js would destroy the OLD specs blob that BOTH diffs, which run
// after this step, still need — and they would then report no spec change for any type
// rather than fail. Only split-data may write the shipped tree.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "tools", "reconcile-data.js"),
    "utf8",
  );
  // Strip line comments — the header above says "-data.js" in prose.
  const code = src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  check(
    "reconcile-data addresses the monolith through the shared monolithPath",
    code.includes("monolithPath("),
    "no monolithPath call",
  );
  check(
    "and names no shipped {p}-data.js path of its own",
    !code.includes("-data.js"),
    code.includes("-data.js") ? "still references a -data.js path" : "clean",
  );
}

if (state.failures) {
  console.error(`\nreconcile-data: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nreconcile-data: all checks passed");
  process.exitCode = 0;
}

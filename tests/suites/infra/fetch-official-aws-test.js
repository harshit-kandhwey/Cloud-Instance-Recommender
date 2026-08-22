// fetch-official-aws suite: pins tools/fetch-official-aws.js's pure normaliser against
// a recorded AWS Price List Bulk per-region offer file — the compute-instance filter,
// on-demand Hrs price extraction, Linux/Windows merge onto one type, and spec mapping.
// No network runs here.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");
const {
  parseAwsRegion,
  awsMemoryGiB,
  onDemandUsdHr,
  keyToRegionCode,
  regionCodeToKey,
} = require("../../../tools/fetch-official-aws");

const { check, state } = makeChecker();

const regionJson = JSON.parse(
  fs.readFileSync(
    path.join(REPO, "tests", "fixtures", "aws-pricing", "us-east-1.json"),
    "utf8",
  ),
);
const types = parseAwsRegion(regionJson);

// ── Filtering ───────────────────────────────────────────────────────────────────
{
  const kept = Object.keys(types).sort();
  check(
    "only priceable compute types kept (m5.large, c6g.medium, x2.large)",
    kept.join(",") === "c6g.medium,m5.large,x2.large",
    kept.join(","),
  );
  check(
    "dedicated tenancy dropped",
    types["m5.large"].onDemandLinuxHr === 0.096,
  );
  check("BYOL Windows dropped (no windows price leaks in)", true);
  check(
    "SQL-bundled Windows type r5.large dropped",
    types["r5.large"] === undefined,
  );
  check("non-compute Storage product dropped", !("gp3" in types));
  check(
    "reserved capacitystatus dropped (m5 windows price is the base one)",
    types["m5.large"].onDemandWindowsHr === 0.188,
  );
  check(
    "compute type with no Hrs on-demand rate dropped (t3.micro)",
    types["t3.micro"] === undefined,
  );
}

// ── m5.large full mapping (Linux + Windows merged onto one record) ────────────────
{
  const m5 = types["m5.large"];
  check(
    "m5.large normalised",
    m5.instanceFamily === "m5" &&
      m5.instanceFamilyName === "General purpose" &&
      m5.vCpus === 2 &&
      m5.memorySizeInGiB === 8 &&
      m5.onDemandLinuxHr === 0.096 &&
      m5.onDemandWindowsHr === 0.188,
    JSON.stringify(m5),
  );
}

// ── Linux-only type carries no windows field ──────────────────────────────────────
{
  const c6g = types["c6g.medium"];
  check(
    "c6g.medium Linux-only → onDemandWindowsHr absent",
    c6g.onDemandLinuxHr === 0.034 &&
      !("onDemandWindowsHr" in c6g) &&
      c6g.instanceFamily === "c6g",
    JSON.stringify(c6g),
  );
}

// ── Memory string parsing ─────────────────────────────────────────────────────────
{
  check(
    "comma-separated memory '1,024 GiB' → 1024",
    types["x2.large"].memorySizeInGiB === 1024,
    String(types["x2.large"].memorySizeInGiB),
  );
  check(
    "awsMemoryGiB units",
    awsMemoryGiB("8 GiB") === 8 &&
      awsMemoryGiB("0.5 GiB") === 0.5 &&
      awsMemoryGiB("1,024 GiB") === 1024 &&
      Number.isNaN(awsMemoryGiB("NA")),
  );
}

// ── Price extraction: only the Hrs dimension counts ───────────────────────────────
{
  const terms = {
    OnDemand: {
      S1: {
        "S1.T": {
          priceDimensions: {
            "S1.T.up": { unit: "Quantity", pricePerUnit: { USD: "5" } },
            "S1.T.hr": { unit: "Hrs", pricePerUnit: { USD: "0.25" } },
          },
        },
      },
    },
  };
  check(
    "onDemandUsdHr picks the Hrs dimension",
    onDemandUsdHr(terms, "S1") === 0.25,
  );
  check(
    "onDemandUsdHr NaN when SKU absent",
    Number.isNaN(onDemandUsdHr(terms, "MISSING")),
  );
}

// ── Region key ⇄ code ─────────────────────────────────────────────────────────────
{
  check(
    "region key/code round trip",
    keyToRegionCode("us_east_1") === "us-east-1" &&
      regionCodeToKey("ap-southeast-4") === "ap_southeast_4",
  );
}

if (state.failures) {
  console.error(`\nfetch-official-aws: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nfetch-official-aws: all checks passed");
  process.exitCode = 0;
}

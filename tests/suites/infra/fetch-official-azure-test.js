// fetch-official-azure suite: pins tools/fetch-official-azure.js's pure normaliser
// against a recorded Azure Retail Prices page — the Consumption/VM/hourly filter, the
// Spot and Low Priority exclusions, Linux/Windows split by productName, the armSkuName
// → shipped-type mapping, and per-region keying. No network runs here.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");
const {
  parseAzureItems,
  azureTypeKey,
  isSpotOrLowPriority,
} = require("../../../tools/fetch-official-azure");

const { check, state } = makeChecker();

const page = JSON.parse(
  fs.readFileSync(
    path.join(REPO, "tests", "fixtures", "azure-pricing", "eastus-page.json"),
    "utf8",
  ),
);
const byRegion = parseAzureItems(page.Items);

// ── Region keying ─────────────────────────────────────────────────────────────
{
  const regions = Object.keys(byRegion).sort();
  check(
    "items key themselves by armRegionName (eastus, westeurope)",
    regions.join(",") === "eastus,westeurope",
    regions.join(","),
  );
}

// ── Linux + Windows merged onto one type ──────────────────────────────────────
{
  const d4 = byRegion.eastus.d4sv5;
  check(
    "d4sv5 Linux + Windows merged",
    d4.linuxPrice === 0.192 && d4.windowsPrice === 0.376,
    JSON.stringify(d4),
  );
}

// ── Exclusions ────────────────────────────────────────────────────────────────
{
  check(
    "Spot / Low Priority did not overwrite the pay-as-you-go Linux rate",
    byRegion.eastus.d4sv5.linuxPrice === 0.192,
  );
  check(
    "Reservation + DevTestConsumption dropped (no d2sv5 leaks in)",
    byRegion.eastus.d2sv5 === undefined,
  );
  check(
    "non-VM service dropped (no storage row)",
    Object.values(byRegion.eastus).every((r) => r.linuxPrice !== 0.0184),
  );
  check(
    "non-hourly meter dropped (monthly reserved-capacity row ignored)",
    byRegion.eastus.d4sv5.linuxPrice === 0.192 &&
      byRegion.eastus.d4sv5.windowsPrice === 0.376,
  );
}

// ── Basic tier type mapping ────────────────────────────────────────────────────
{
  const a0 = byRegion.eastus.a0;
  check(
    "Basic_A0 → a0, Linux-only",
    a0 && a0.linuxPrice === 0.02 && !("windowsPrice" in a0),
    JSON.stringify(a0),
  );
}

// ── Per-region price ────────────────────────────────────────────────────────────
{
  check(
    "westeurope d4sv5 Linux price kept separate",
    byRegion.westeurope.d4sv5.linuxPrice === 0.2,
    JSON.stringify(byRegion.westeurope.d4sv5),
  );
}

// ── Exported helpers ──────────────────────────────────────────────────────────
{
  check(
    "azureTypeKey strips tier prefix, lowercases, drops underscores",
    azureTypeKey("Standard_D4s_v5") === "d4sv5" &&
      azureTypeKey("Basic_A0") === "a0" &&
      azureTypeKey("Standard_E4-2s_v5") === "e4-2sv5",
  );
  check(
    "isSpotOrLowPriority flags spot + low priority only",
    isSpotOrLowPriority("D4s v5 Spot") === true &&
      isSpotOrLowPriority("D4s v5 Low Priority") === true &&
      isSpotOrLowPriority("D4s v5") === false,
  );
}

if (state.failures) {
  console.error(`\nfetch-official-azure: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nfetch-official-azure: all checks passed");
  process.exitCode = 0;
}

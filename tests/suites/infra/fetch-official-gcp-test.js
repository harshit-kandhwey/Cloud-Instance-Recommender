// fetch-official-gcp suite: pins tools/fetch-official-gcp.js's pure normalisers against
// a recorded Cloud Billing Catalog page — the Compute/OnDemand Core/Ram filter, the
// exact series-template match (which excludes Sole-Tenancy / Reserved / Custom variants
// and non-OnDemand rates), the Windows per-vCPU licensing rate, and the vCPU×core +
// memGiB×ram composition with the Windows premium. No network runs here.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");
const {
  parseCoreRamSkus,
  windowsPerVCpuHr,
  composePricing,
  classifyCoreRam,
  skuUsd,
} = require("../../../tools/fetch-official-gcp");

const { check, state } = makeChecker();

const page = JSON.parse(
  fs.readFileSync(
    path.join(REPO, "tests", "fixtures", "gcp-pricing", "catalog-page.json"),
    "utf8",
  ),
);
const rates = parseCoreRamSkus(page.skus);

// ── Series template match + exclusions ──────────────────────────────────────────
{
  const series = Object.keys(rates).sort();
  check(
    "only shipped predefined series matched (c2d, n2, t2a); sole-tenancy/reserved/custom excluded",
    series.join(",") === "c2d,n2,t2a",
    series.join(","),
  );
}
{
  const r = rates.n2.us_east1;
  check(
    "n2 us_east1 core + ram rates parsed (units+nanos)",
    r.coreHr === 0.031611 && r.ramHr === 0.004237,
    JSON.stringify(r),
  );
}
{
  check(
    "Commit1Yr N2 core (same description) did not overwrite the OnDemand core rate",
    rates.n2.us_east1.coreHr === 0.031611,
  );
}

// ── classifyCoreRam exact-match ──────────────────────────────────────────────────
{
  check(
    "classifyCoreRam maps a plain predefined Core SKU",
    JSON.stringify(
      classifyCoreRam("N2 Instance Core running in South Carolina"),
    ) === JSON.stringify({ series: "n2", component: "core" }),
  );
  check(
    "classifyCoreRam rejects Sole Tenancy + Custom (exact template only)",
    classifyCoreRam("N2 Sole Tenancy Instance Core running in X") === null &&
      classifyCoreRam("Custom Instance Core running in X") === null,
  );
  check(
    "classifyCoreRam maps the AMD/Arm-suffixed series names",
    classifyCoreRam("C2D AMD Instance Ram running in X").series === "c2d" &&
      classifyCoreRam("T2A Arm Instance Core running in X").series === "t2a",
  );
}

// ── skuUsd ───────────────────────────────────────────────────────────────────────
{
  check(
    "skuUsd composes units + nanos/1e9",
    skuUsd(page.skus[0]) === 0.031611,
    String(skuUsd(page.skus[0])),
  );
}

// ── Windows per-vCPU licensing rate ──────────────────────────────────────────────
{
  const w = windowsPerVCpuHr(page.skus);
  check(
    "windowsPerVCpuHr = 0.046 (Datacenter CPU-cost; BYOL $0 excluded)",
    w === 0.046,
    String(w),
  );
}

// ── Composition for the shipped machines ─────────────────────────────────────────
const shipped = {
  us_east1: {
    "n2-standard-4": { series: "n2", vCpus: 4, memoryGiB: 16 },
    "c2d-standard-2": { series: "c2d", vCpus: 2, memoryGiB: 8 },
    "t2a-standard-1": { series: "t2a", vCpus: 1, memoryGiB: 4 },
    "n1-standard-1": { series: "n1", vCpus: 1, memoryGiB: 3.75 },
  },
};
const { byRegion, unmatched } = composePricing(
  rates,
  windowsPerVCpuHr(page.skus),
  shipped,
);
{
  const m = byRegion.us_east1["n2-standard-4"];
  check(
    "n2-standard-4: hourly = 4×core + 16×ram; windows = hourly + 4×0.046",
    m.hourlyPrice === 0.194236 && m.windowsHourlyPrice === 0.378236,
    JSON.stringify(m),
  );
}
{
  const m = byRegion.us_east1["c2d-standard-2"];
  check(
    "c2d-standard-2 composed",
    m.hourlyPrice === 0.089782 && m.windowsHourlyPrice === 0.181782,
    JSON.stringify(m),
  );
}
{
  const m = byRegion.us_east1["t2a-standard-1"];
  check(
    "t2a-standard-1 composed",
    m.hourlyPrice === 0.0322 && m.windowsHourlyPrice === 0.0782,
    JSON.stringify(m),
  );
}
{
  check(
    "n1 has no official SKU → not composed, reported unmatched",
    byRegion.us_east1["n1-standard-1"] === undefined &&
      unmatched.includes("n1"),
    JSON.stringify(unmatched),
  );
}

if (state.failures) {
  console.error(`\nfetch-official-gcp: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nfetch-official-gcp: all checks passed");
  process.exitCode = 0;
}

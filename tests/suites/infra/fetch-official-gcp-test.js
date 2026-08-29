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
  fetchAllSkus,
  MAX_PAGES,
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
    "only shipped predefined series matched (c2, c2d, n2, t2a); sole-tenancy/reserved/custom excluded",
    series.join(",") === "c2,c2d,n2,t2a",
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
  check(
    "classifyCoreRam maps c2's token-less 'Compute optimized', rejects its hyphenated sole-tenancy form",
    classifyCoreRam("Compute optimized Instance Core running in X").series ===
      "c2" &&
      classifyCoreRam(
        "Compute-optimized Sole Tenancy Instance Core running in X",
      ) === null,
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
    "c2-standard-8": { series: "c2", vCpus: 8, memoryGiB: 32 },
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
  const m = byRegion.us_east1["c2-standard-8"];
  check(
    "c2-standard-8 composed from the token-less 'Compute optimized' rates",
    m.hourlyPrice === 0.41752 && m.windowsHourlyPrice === 0.78552,
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

// ── Pagination: a truncated catalog is an error, never a partial dump ────────────
// The only place a stub stands in for the network: fetch is replaced with a local
// function, so nothing leaves the machine. What is under test is the loop's exit
// conditions, which no recorded fixture can express.
async function paginationChecks() {
  const realFetch = globalThis.fetch;
  const realKey = process.env.GCP_BILLING_API_KEY;
  process.env.GCP_BILLING_API_KEY = "test-key-unused-by-the-stub";

  // Serves pages built by `plan(page)`; every response is a 200 with a skus array.
  const stub = (plan) => {
    let calls = 0;
    globalThis.fetch = async () => {
      const body = plan(calls++);
      return { ok: true, json: async () => body };
    };
    return () => calls;
  };
  const run = async (plan) => {
    const calls = stub(plan);
    try {
      return { skus: await fetchAllSkus(), calls: calls(), error: "" };
    } catch (e) {
      return { skus: null, calls: calls(), error: e.message };
    }
  };

  try {
    const ok = await run((n) =>
      n === 0
        ? { skus: [{ name: "a" }], nextPageToken: "t1" }
        : { skus: [{ name: "b" }] },
    );
    check(
      "fetchAllSkus follows nextPageToken and stops when it is absent",
      ok.error === "" && ok.calls === 2 && ok.skus.length === 2,
      JSON.stringify({ calls: ok.calls, error: ok.error }),
    );

    // Guard (plant-RED: return the collected skus at the cap instead of throwing).
    // A catalog still handing out a token at the cap means the dump is short, and a
    // short dump prices only some series while reconcile treats it as authoritative.
    const capped = await run((n) => ({
      skus: [{ name: `s${n}` }],
      nextPageToken: `t${n}`,
    }));
    check(
      "a live nextPageToken at the page cap throws instead of returning partial",
      capped.skus === null &&
        capped.error.includes(`page cap (${MAX_PAGES}) exceeded`) &&
        capped.calls === MAX_PAGES,
      JSON.stringify({ calls: capped.calls, error: capped.error }),
    );

    // Guard (plant-RED: drop the seen-token check): a token the catalog repeats
    // would otherwise be walked MAX_PAGES times, collecting the same page over and
    // over before failing with the vaguer cap message.
    const looping = await run(() => ({
      skus: [{ name: "same" }],
      nextPageToken: "stuck",
    }));
    check(
      "a repeating nextPageToken fails fast and by name",
      looping.skus === null &&
        looping.error.includes("repeating nextPageToken") &&
        looping.calls === 2,
      JSON.stringify({ calls: looping.calls, error: looping.error }),
    );
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GCP_BILLING_API_KEY;
    else process.env.GCP_BILLING_API_KEY = realKey;
  }
}

// The pagination checks are async, so the verdict is reported after they settle.
paginationChecks()
  .catch((e) => {
    check("pagination checks run to completion", false, e && e.message);
  })
  .then(() => {
    if (state.failures) {
      console.error(`\nfetch-official-gcp: ${state.failures} check(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log("\nfetch-official-gcp: all checks passed");
      process.exitCode = 0;
    }
  });

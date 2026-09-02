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
  assertComposedSomething,
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

// ── A spec-less shipped record must be LOUD, never a quiet empty result ─────────
// composePricing reads series, vCpus and memoryGiB straight off the shipped region
// records. The specs/prices split moves all three out of those records, so this is
// the exact shape this tool will be handed if it is ever pointed at split region
// files without rehydration — and the old guard read `if (series) unmatched.add`,
// which meant the missing-series case skipped every record AND suppressed the one
// log that would have reported it. Empty in, empty out, exit 0, and reconcile
// reads the empty dump as authoritative.
{
  const specLess = {
    us_east1: {
      "n2-standard-4": { hourlyPrice: 0.194236, windowsHourlyPrice: 0.378236 },
      "c2-standard-8": { hourlyPrice: 0.41752, windowsHourlyPrice: 0.78552 },
    },
  };
  const out = composePricing(rates, windowsPerVCpuHr(page.skus), specLess);
  check(
    "records with no series compose nothing",
    Object.keys(out.byRegion).length === 0,
    JSON.stringify(out.byRegion),
  );
  check(
    "and say so, once, instead of returning an empty unmatched list",
    out.unmatched.length === 1 && /no series field/.test(out.unmatched[0]),
    JSON.stringify(out.unmatched),
  );

  // The other half of the same failure: series present, specs gone. Different
  // branch, same silence if it is not reported.
  const noSizes = {
    us_east1: { "n2-standard-4": { series: "n2" } },
  };
  const out2 = composePricing(rates, windowsPerVCpuHr(page.skus), noSizes);
  check(
    "a record with a series but no vCPU/memory composes nothing and is named",
    Object.keys(out2.byRegion).length === 0 && out2.unmatched.includes("n2"),
    JSON.stringify(out2),
  );

  // The floor: an empty composition must never reach disk. Driven directly rather
  // than through main(), which cannot run without the network — and pinned to be
  // CALLED from main() below, because a tested guard nothing invokes is the exact
  // shape of defect this repo shipped in v3.14.32.
  const floorMsg = (byRegion, shippedIn, um) => {
    try {
      assertComposedSomething(byRegion, shippedIn, um);
      return null;
    } catch (e) {
      return String(e.message || e);
    }
  };
  check(
    "an empty composition throws rather than returning a count",
    (floorMsg({}, specLess, out.unmatched) || "").includes("composed 0 prices"),
    floorMsg({}, specLess, out.unmatched) || "did not throw",
  );
  check(
    "the refusal explains what would have consumed the empty dump",
    (floorMsg({}, specLess, out.unmatched) || "").includes("reconcile"),
    floorMsg({}, specLess, out.unmatched) || "",
  );
  check(
    "the refusal carries the unmatched series so the cause is in the message",
    (floorMsg({}, specLess, ["n2", "c2"]) || "").includes("n2, c2"),
    floorMsg({}, specLess, ["n2", "c2"]) || "",
  );
  check(
    "regions present but all empty is still zero, not a pass",
    (floorMsg({ us_east1: {}, eu_west1: {} }, specLess, []) || "").includes(
      "composed 0 prices",
    ),
    floorMsg({ us_east1: {}, eu_west1: {} }, specLess, []) || "did not throw",
  );
  check(
    "a real composition passes the floor and returns its count",
    assertComposedSomething(byRegion, shipped, unmatched) === 4,
    String(assertComposedSomething(byRegion, shipped, unmatched)),
  );
}

// ── main() actually applies the floor ──────────────────────────────────────────
// Scoped to main()'s body, not the file: the definition and the export both
// mention the name, and a whole-file check would pass on either while main()
// wrote the empty dump anyway.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "tools", "fetch-official-gcp.js"),
    "utf8",
  );
  const body = (src.match(/async function main\(\)\s*\{[\s\S]*?\n\}/) || [
    "",
  ])[0];
  check(
    "main() was found to inspect",
    body.length > 100 && body.includes("writeFileAtomic"),
    `${body.length} chars`,
  );
  check(
    "main() runs the floor before it writes",
    body.indexOf("assertComposedSomething") > 0 &&
      body.indexOf("assertComposedSomething") < body.indexOf("writeFileAtomic"),
    `floor at ${body.indexOf("assertComposedSomething")}, write at ${body.indexOf("writeFileAtomic")}`,
  );
}

// ── The shipped records come from the shared loader, never a private walk ─────
// composePricing reads `series`, `vCpus` and `memoryGiB` off these records, and all
// three are SPECS — they live in the manifest, not in the region files. A private walk
// would hand it price-only records, it would skip every one of them for want of a
// series, and the tool would write an empty pricing dump that reconcile reads as
// authoritative. assertComposedSomething is the floor under that; this is what keeps
// the floor from being reached.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "tools", "fetch-official-gcp.js"),
    "utf8",
  );
  // Strip line comments first: a check that matches prose reports on documentation.
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  check(
    "fetch-official-gcp reads the shipped records through loadCommittedRegions",
    code.includes("loadCommittedRegions") && !/readdirSync\s*\(/.test(code),
    /readdirSync\s*\(/.test(code) ? "has its own readdirSync" : "shared",
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

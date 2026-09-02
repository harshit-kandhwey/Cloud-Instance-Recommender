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
  parseLocalSsdSkus,
  localSsdHr,
  SERIES_SKU_NAME,
  LOCAL_SSD_SKU_NAME,
  LOCAL_SSD_GENERIC,
  UNVERIFIED_TYPES,
  HOURS_PER_MONTH,
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
    "only shipped predefined series matched; sole-tenancy/reserved/custom excluded",
    series.join(",") === "c2,c2d,c4,m4,n2,t2a,z3",
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

// ── Local SSD: the third price component ───────────────────────────────────────
// GCP prices attached local SSD as its OWN SKU, per GiB-MONTH, while cores are per
// hour and RAM per GiB-hour. A type that bundles one cannot be composed from cores
// and memory alone — doing so ran 6–33% low, which is why c4/c3d/z3 and friends
// were left UNVERIFIED until this phase.
const ssdRates = parseLocalSsdSkus(page.skus);
{
  const names = Object.keys(ssdRates).sort();
  check(
    "only the plain on-demand local-SSD templates the tables name are parsed",
    names.join(" | ") ===
      "C4 Instance Local SSD | C4A Instance Local SSD | " +
        "H4D Instance Local SSD | SSD backed Local Storage",
    names.join(" | "),
  );
  // Every variant the fixture carries to be REJECTED — the Sole-Tenancy, DWS,
  // Spot and Committed-Use forms, and the generic SKU's spot twin — is priced at
  // $0.90/GiB-month, a rate no accepted SKU has. If a substring test ever replaces
  // the exact match, that rate appears here and this check names it.
  const leaked = [];
  for (const [name, byRegion] of Object.entries(ssdRates)) {
    for (const [rk, v] of Object.entries(byRegion)) {
      if (v === 0.00123288) leaked.push(`${name}/${rk}`);
    }
  }
  check(
    "the sole-tenancy / DWS / spot / committed-use variants are all rejected",
    leaked.length === 0,
    leaked.join(", ") || "none",
  );
  check(
    `GiB-month is converted to GiB-hour at ${HOURS_PER_MONTH}`,
    // $0.08/GiB-month ÷ 730. Unconverted it would be 0.08 — 730× too high, and
    // silently so, because the composed price would still look like a price.
    ssdRates[LOCAL_SSD_GENERIC].us_east1 === 0.00010959 &&
      HOURS_PER_MONTH === 730,
    String(ssdRates[LOCAL_SSD_GENERIC].us_east1),
  );
}

// ── Which SKU a series is priced from is a TABLE, not a rule ───────────────────
// z3 HAS a per-series "Z3 Instance Local SSD" SKU and it is NOT the one z3 is
// priced from: the implied rate solved from Vantage matched the GENERIC SKU in
// 43/43 regions and the per-series one only in the 19 where the two coincide. A
// "use the per-series SKU when one exists" refactor would look principled and
// misprice z3 in 24 regions, so the mapping is pinned here rather than left to
// read as an oversight.
{
  check(
    "z3 is priced from the generic SKU even though a per-series one exists",
    LOCAL_SSD_SKU_NAME.z3 === LOCAL_SSD_GENERIC &&
      ssdRates["Z3 Instance Local SSD"] === undefined,
    `${LOCAL_SSD_SKU_NAME.z3} / parsed=${Object.keys(ssdRates).includes("Z3 Instance Local SSD")}`,
  );
  check(
    "a2, a3, c3 and c3d are generic too; c4, c4a and h4d are the per-series three",
    ["a2", "a3", "c3", "c3d", "z3"].every(
      (s) => LOCAL_SSD_SKU_NAME[s] === LOCAL_SSD_GENERIC,
    ) &&
      ["c4", "c4a", "h4d"].every(
        (s) =>
          LOCAL_SSD_SKU_NAME[s] === `${s.toUpperCase()} Instance Local SSD`,
      ),
    JSON.stringify(LOCAL_SSD_SKU_NAME),
  );
  // c4a's two tokens differ, and that is real, not a typo waiting to be tidied:
  // the core/ram SKU is "C4A Arm Instance Core", the local-SSD one is plain "C4A".
  // Verified 0.0000% across 924 non-SSD type × region comparisons, 2026-09-02.
  check(
    "c4a's core/ram token is 'C4A Arm' while its local-SSD token is plain 'C4A'",
    SERIES_SKU_NAME.c4a === "C4A Arm" &&
      LOCAL_SSD_SKU_NAME.c4a === "C4A Instance Local SSD",
    `${SERIES_SKU_NAME.c4a} / ${LOCAL_SSD_SKU_NAME.c4a}`,
  );
  // c4d is NOT the local-SSD problem: its core/ram composition is 3.29% off across
  // 1518 comparisons that involve no SSD at all. Mapping it once local SSD landed
  // would be the obvious next step and it would be wrong.
  check(
    "c4d stays unmapped — its core/ram is off before local SSD enters",
    SERIES_SKU_NAME.c4d === undefined &&
      LOCAL_SSD_SKU_NAME.c4d === undefined &&
      SERIES_SKU_NAME.h4d === "H4D",
    `c4d core=${SERIES_SKU_NAME.c4d} ssd=${LOCAL_SSD_SKU_NAME.c4d}`,
  );
}

// ── localSsdHr: 0, the named rate, the generic fallback, or null ───────────────
{
  check(
    "a type with no local SSD contributes 0, not null",
    localSsdHr("c4", "us_east1", 0, ssdRates) === 0 &&
      localSsdHr("c4", "us_east1", undefined, ssdRates) === 0,
    String(localSsdHr("c4", "us_east1", 0, ssdRates)),
  );
  check(
    "a named series uses its own rate (750 GiB × $0.10/GiB-mo ÷ 730)",
    localSsdHr("c4", "us_east1", 750, ssdRates) === 0.1027425,
    String(localSsdHr("c4", "us_east1", 750, ssdRates)),
  );
  // 22 of c4's 968 region-pairs have no per-series SKU and are priced from the
  // generic one, so the fallback is load-bearing, not defensive.
  check(
    "a named series falls back to the generic rate where its own SKU is absent",
    localSsdHr("c4", "eu_west1", 750, ssdRates) === 0.0821925,
    String(localSsdHr("c4", "eu_west1", 750, ssdRates)),
  );
  check(
    "z3 resolves through the generic rate, not the per-series SKU in the catalog",
    localSsdHr("z3", "us_east1", 3000, ssdRates) === 0.32877,
    String(localSsdHr("z3", "us_east1", 3000, ssdRates)),
  );
  // The distinction the whole phase turns on: no rate is NOT a zero. Returning 0
  // here would price the SSD as free and hand reconcile a confidently low number.
  check(
    "local SSD present but no rate anywhere returns null, never 0",
    localSsdHr("c4", "asia_south1", 750, ssdRates) === null,
    String(localSsdHr("c4", "asia_south1", 750, ssdRates)),
  );
}

// ── Composition with the SSD term ─────────────────────────────────────────────
{
  const withSsd = {
    us_east1: {
      "c4-standard-8-lssd": {
        series: "c4",
        vCpus: 8,
        memoryGiB: 32,
        localSsdGiB: 750,
      },
      "c4-standard-8": {
        series: "c4",
        vCpus: 8,
        memoryGiB: 32,
        localSsdGiB: 0,
      },
      "z3-highmem-16-lssd": {
        series: "z3",
        vCpus: 16,
        memoryGiB: 128,
        localSsdGiB: 3000,
      },
      "m4-megamem-28": {
        series: "m4",
        vCpus: 28,
        memoryGiB: 372,
        localSsdGiB: 0,
      },
      "m4-ultramem-224": {
        series: "m4",
        vCpus: 224,
        memoryGiB: 5952,
        localSsdGiB: 0,
      },
    },
    // No local-SSD SKU of either kind here, so the type must be skipped.
    asia_south1: {
      "c4-standard-8-lssd": {
        series: "c4",
        vCpus: 8,
        memoryGiB: 32,
        localSsdGiB: 750,
      },
    },
  };
  const ssdOut = composePricing(
    rates,
    windowsPerVCpuHr(page.skus),
    withSsd,
    ssdRates,
  );
  const use1 = ssdOut.byRegion.us_east1;
  // Both operands are already rounded to 8dp; their difference is not, so it is
  // re-rounded rather than compared raw.
  const d8 = (a, b) => Math.round((a - b) * 1e8) / 1e8;
  {
    const m = use1["c4-standard-8-lssd"];
    check(
      "hourly = 8×core + 32×ram + 750 GiB×ssdHr",
      m.hourlyPrice === 0.5827425,
      JSON.stringify(m),
    );
    check(
      "the SSD term is exactly what separates it from the same type without one",
      d8(m.hourlyPrice, use1["c4-standard-8"].hourlyPrice) === 0.1027425,
      String(d8(m.hourlyPrice, use1["c4-standard-8"].hourlyPrice)),
    );
    // Windows licensing is per vCPU only. Composing it off the SSD-inclusive
    // hourly price would make two identically-sized machines pay different
    // licensing because one has a disk.
    check(
      "the Windows premium stays 8×0.046 whether or not the type has local SSD",
      d8(m.windowsHourlyPrice, m.hourlyPrice) === 0.368 &&
        d8(
          use1["c4-standard-8"].windowsHourlyPrice,
          use1["c4-standard-8"].hourlyPrice,
        ) === 0.368,
      String(d8(m.windowsHourlyPrice, m.hourlyPrice)),
    );
  }
  {
    // 2.39091 is what the per-series Z3 SKU in the fixture would produce. Pinning
    // the value makes the wrong table a failing number, not a judgement call.
    const m = use1["z3-highmem-16-lssd"];
    check(
      "z3 composes from the generic rate (1.89677), not the per-series one (2.39091)",
      m.hourlyPrice === 1.89677,
      JSON.stringify(m),
    );
  }
  check(
    "a type with local SSD but no rate is skipped, not priced as though it were free",
    ssdOut.byRegion.asia_south1 === undefined &&
      ssdOut.unmatched.includes("c4 (local SSD rate missing)"),
    JSON.stringify(ssdOut.unmatched),
  );

  // UNVERIFIED_TYPES: m4 IS mapped and prices every other m4 type exactly, so this
  // one type is excluded by name. It composes 24.5% low in all 46 regions, and
  // reconcile PREFERS the official value — so composing it overwrites a correct
  // Vantage price with a wrong one.
  check(
    "m4-ultramem-224 is skipped although its series has rates, and is reported",
    use1["m4-ultramem-224"] === undefined &&
      ssdOut.unmatched.includes("m4-ultramem-224 (deliberately unverified)") &&
      UNVERIFIED_TYPES.has("m4-ultramem-224"),
    JSON.stringify(ssdOut.unmatched),
  );
  check(
    "its siblings in the same series still compose",
    use1["m4-megamem-28"].hourlyPrice === 4.284,
    JSON.stringify(use1["m4-megamem-28"]),
  );
}

// ── main() actually composes WITH the SSD rates ────────────────────────────────
// The whole component is inert unless main() both parses the SSD SKUs and passes
// them to composePricing — and composePricing defaults ssdRates to {}, so omitting
// the argument would not throw. It would price every SSD-bearing type as though
// the disk were free, which is the exact defect this phase exists to end. Scoped
// to main()'s body: the definition, the export and the doc comment all mention
// the names, and a whole-file check would pass while main() dropped the argument.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "tools", "fetch-official-gcp.js"),
    "utf8",
  );
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  const body = (code.match(/async function main\(\)\s*\{[\s\S]*?\n\}/) || [
    "",
  ])[0];
  check(
    "main() parses the local-SSD SKUs from the same catalog pull",
    /const\s+ssdRates\s*=\s*parseLocalSsdSkus\(\s*skus\s*\)/.test(body),
    body.includes("parseLocalSsdSkus") ? "called, but not on skus" : "absent",
  );
  const call = (body.match(/composePricing\([\s\S]*?\)\s*;/) || [""])[0];
  check(
    "and passes them to composePricing rather than letting it default to {}",
    /\bssdRates\b/.test(call),
    call.replace(/\s+/g, " ") || "no composePricing call found",
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

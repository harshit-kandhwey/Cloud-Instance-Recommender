#!/usr/bin/env node
"use strict";
/*
 * fetch-official-gcp.js — GCP on-demand VM pricing from the Cloud Billing Catalog
 * API, composed for the machine types the app already ships.
 *
 *   node tools/fetch-official-gcp.js [--out .refresh-cache/gcp-pricing.json] [--region us_east1]
 *
 * Node/CI build tool only; never shipped, never called by the page. Needs
 * GCP_BILLING_API_KEY (Cloud Billing APIs are free of charge). Phase D2
 * (reconcile-data.js) merges this with the Vantage monolith, official pricing
 * taking precedence.
 *
 * GCP prices differently from AWS/Azure: NOT per machine type, but per CPU
 * core-hour and per RAM GiB-hour, as SEPARATE SKUs ("N2 Instance Core" +
 * "N2 Instance Ram", usageType OnDemand). A machine's hourly price is composed:
 *     hourlyPrice        = vCPUs × coreHr[series][region] + memGiB × ramHr[series][region]
 *     windowsHourlyPrice = hourlyPrice + vCPUs × WINDOWS_PER_VCPU_HR
 * The vCPU/memory/series come from the shipped region records (the Catalog carries
 * no machine specs); only the rates come from the API. So specs stay from Vantage
 * (flagged UNVERIFIED in D2); this file supplies pricing only.
 *
 * Series↔SKU matching (the D1 unknown, resolved empirically 2026-08-24 against the
 * live Compute Engine catalog): the series name is embedded in the SKU description
 * ("N2 Instance Core running in Paris"), and each shipped series maps to an EXACT
 * region-stripped template — see SERIES_SKU_NAME. Exact-match is deliberate: it
 * rejects the Sole-Tenancy / Custom / Reserved / DWS / Committed-Use variants
 * (which carry the same series token but a different template) with no blocklist.
 * n1 has NO dedicated Core/Ram SKU in the catalog, so it is left UNMATCHED and its
 * pricing stays from Vantage (UNVERIFIED) rather than approximated from Custom SKUs.
 *
 * parseCoreRamSkus / windowsPerVCpuHr / composePricing are pure and fixture-tested;
 * the network fetch never runs in the suite. See docs/DATA-SOURCES.md.
 */

const fs = require("fs");
const path = require("path");
const { ROOT, argValue, writeFileAtomic } = require("./lib/build-env");
const {
  round8,
  loadCommittedRegions,
  readShippedRegionKeys,
} = require("./lib/record-schema");

const CATALOG_HOST = "https://cloudbilling.googleapis.com";
// Compute Engine's well-known billing service id (stable; confirmed 2026-08-17).
const COMPUTE_SERVICE = "services/6F81-5844-456A";
const PAGE_SIZE = 5000;
const MAX_PAGES = 20; // ~33k SKUs fit in 7 pages; cap guards a runaway pageToken loop.
const REQUEST_TIMEOUT_MS = 60_000;

// Standard Windows Server per-vCPU-hour licensing premium, in USD. Sourced from the
// Catalog at run time (see windowsPerVCpuHr); this is the fallback if the SKU is
// absent. GCP charges Windows licensing per vCPU with no RAM component.
const WINDOWS_PER_VCPU_HR_FALLBACK = 0.046;

// Shipped series → the EXACT SKU description token before " Instance Core"/" Instance
// Ram" (region stripped). Grounded against the live catalog: the base map 2026-08-24, the
// c2/c4n/n4a additions 2026-08-26 (composed price reproduced fresh Vantage Δ0.00% across
// every priced type × region — c2's token-less "Compute optimized" included).
//
// Deliberately NOT mapped, on evidence (fresh-Vantage cross-check 2026-08-26):
//   - n1        — no dedicated Core/Ram SKU exists in the catalog at all.
//   - m1, m2    — both share the token-less "Memory-optimized" template, so the catalog
//                 cannot tell them apart; mapping either would misprice the other.
//   - c4a, c4d, h4d — their "-lssd" (Local SSD) machine types carry local-SSD cost the
//                 core+ram composition does not add, so composed prices run 6–26% low on
//                 those subtypes. This is the SAME local-SSD/storage-optimized gap that
//                 already affects mapped c4/c3d/z3; adding these families would let
//                 reconcile overwrite the correct Vantage price with a low one for the
//                 -lssd subtypes. They stay UNVERIFIED (Vantage-priced) until composition
//                 accounts for local SSD. See docs/DATA-SOURCES.md.
// All of the above fall through to UNVERIFIED in reconcile (the designed safety net).
const SERIES_SKU_NAME = {
  a2: "A2",
  a3: "A3",
  c2: "Compute optimized",
  c2d: "C2D AMD",
  c3: "C3",
  c3d: "C3D",
  c4: "C4",
  // Verified 2026-09-02 at 0.0000% across 924 type × region comparisons on the c4a
  // types WITHOUT local SSD, so the core/ram token stands on its own evidence. The
  // suffix is real and the two tables are genuinely separate: the core/ram SKU is
  // "C4A Arm Instance Core", the local-SSD SKU is plain "C4A Instance Local SSD".
  c4a: "C4A Arm",
  c4n: "C4N",
  e2: "E2",
  g2: "G2",
  h3: "H3",
  // Verified 2026-09-02 at 0.0000%. Only 2 non-SSD types × 6 regions, so a small
  // sample — but exact, and its local-SSD half is exact across all 6 as well.
  h4d: "H4D",
  m3: "M3 Memory-optimized",
  m4: "M4",
  n2: "N2",
  n2d: "N2D AMD",
  n4: "N4",
  n4a: "N4A",
  n4d: "N4D",
  t2a: "T2A Arm",
  t2d: "T2D AMD",
  z3: "Z3",
};
// Reverse: "N2" → "n2". Built once.
const NAME_TO_SERIES = Object.fromEntries(
  Object.entries(SERIES_SKU_NAME).map(([s, n]) => [n, s]),
);

// ── Local SSD ────────────────────────────────────────────────────────────────
// GCP prices attached local SSD as its OWN SKU, per GiB-MONTH, separate from the
// core and RAM SKUs. A type that bundles one cannot be composed from cores and
// memory alone: doing so ran 6–33% low, which is why c4/c3d/z3 and friends were
// left UNVERIFIED until now.
//
// WHICH SKU a series is priced from is a TABLE, not a rule, and the difference is
// not cosmetic: z3 HAS a per-series "Z3 Instance Local SSD" SKU, and using it is
// WRONG. Solving the implied rate from Vantage's own price across all 43 z3
// regions matched the generic SKU in 43 and the per-series one in only the 19
// where the two happen to be equal. A "use the per-series SKU when one exists"
// rule would therefore misprice z3 in 24 regions while looking principled.
// Verified per series against fresh Vantage prices, type × region, 2026-09-02.
const LOCAL_SSD_GENERIC = "SSD backed Local Storage";
const LOCAL_SSD_SKU_NAME = {
  c4: "C4 Instance Local SSD", // 946/968 exact; the other 22 regions have no
  c4a: "C4A Instance Local SSD", //   per-series SKU and fall through to generic
  h4d: "H4D Instance Local SSD",
  // Priced from the GENERIC SKU, on evidence — a2, a3, c3 and c3d have no
  // per-series SKU at all, and z3 has one that does not reproduce its price.
  a2: LOCAL_SSD_GENERIC,
  a3: LOCAL_SSD_GENERIC,
  c3: LOCAL_SSD_GENERIC,
  c3d: LOCAL_SSD_GENERIC,
  z3: LOCAL_SSD_GENERIC,
};

// Local SSD is quoted per gibibyte-MONTH while cores and RAM are per hour, so the
// two cannot be added without converting. 730 is GCP's own monthly-hours constant.
const HOURS_PER_MONTH = 730;

// The unit that ÷HOURS_PER_MONTH assumes. Asserted against the SKU rather than
// trusted, because the catalogue publishes all three of "GiBy.mo" (local SSD),
// "GiBy.h" (RAM) and "h" (cores), and a name match cannot tell them apart.
const LOCAL_SSD_USAGE_UNIT = "GiBy.mo";

// Types whose composed price does not reproduce the published one, for reasons not
// yet understood — so they are left out of the dump entirely and keep their Vantage
// price, flagged UNVERIFIED by reconcile. This is the same conservatism that keeps
// n1, m1/m2 and c4d unmapped: a composition that is confidently wrong is worse than
// no composition, because reconcile PREFERS the official value and would overwrite
// a correct price with it.
//
// m4-ultramem-224 is the one entry. Its series maps to "M4", which prices every
// other m4 type exactly and prices this one 24.5% low in all 46 regions. It has its
// own "M4Ultramem224 Instance Core"/"Ram" SKUs, and those still leave a flat 6.008%
// gap — 438.91 GiB-equivalent of RAM, matching no listed rate and no extended-memory
// SKU (none exists for M4). Until that is explained it must not be composed.
const UNVERIFIED_TYPES = new Set(["m4-ultramem-224"]);

// ── Pure normalisation ─────────────────────────────────────────────────────────

// A SKU's USD unit price: units + nanos/1e9 from the last (highest-usage) tier. GCP
// splits some SKUs into tiers; the base on-demand rate is the final tier's price.
function skuUsd(sku) {
  const pe = sku && sku.pricingInfo && sku.pricingInfo[0]?.pricingExpression;
  const tiers = (pe && pe.tieredRates) || [];
  const up = tiers.length ? tiers[tiers.length - 1].unitPrice : null;
  if (!up) return NaN;
  const usd = Number(up.units || 0) + (up.nanos || 0) / 1e9;
  return Number.isFinite(usd) ? usd : NaN;
}

// serviceRegions carries hyphens ("us-east1"); the shipped manifest uses underscores
// ("us_east1"). Key on the shipped form.
const regionKeyFromServiceRegion = (r) => String(r || "").replace(/-/g, "_");

// The series + component ("core"|"ram") a Core/Ram SKU describes, or null. Matches the
// region-stripped description against SERIES_SKU_NAME exactly, so only the plain
// predefined on-demand SKU qualifies (Sole Tenancy / Custom / Reserved templates fail).
function classifyCoreRam(description) {
  const stripped = String(description || "")
    .replace(/ running in .*/i, "")
    .trim();
  const m = stripped.match(/^(.*) Instance (Core|Ram)$/);
  if (!m) return null;
  const series = NAME_TO_SERIES[m[1]];
  if (!series) return null;
  return { series, component: m[2].toLowerCase() };
}

/**
 * Compose { series: { regionKey: { coreHr?, ramHr? } } } from a flat SKU list.
 * Keeps only Compute-family OnDemand Core/Ram SKUs whose series template is shipped.
 * @param {object[]} skus  the `skus` array from one or more catalog pages
 */
function parseCoreRamSkus(skus) {
  const rates = {};
  for (const sku of skus || []) {
    if (!sku) continue;
    const c = sku.category || {};
    if (c.resourceFamily !== "Compute") continue;
    if (c.usageType !== "OnDemand") continue;
    if (c.resourceGroup !== "CPU" && c.resourceGroup !== "RAM") continue;
    const hit = classifyCoreRam(sku.description);
    if (!hit) continue;
    const usd = round8(skuUsd(sku));
    if (!Number.isFinite(usd)) continue;
    for (const sr of sku.serviceRegions || []) {
      const rk = regionKeyFromServiceRegion(sr);
      const forSeries = rates[hit.series] || (rates[hit.series] = {});
      const rec = forSeries[rk] || (forSeries[rk] = {});
      if (hit.component === "core") rec.coreHr = usd;
      else rec.ramHr = usd;
    }
  }
  return rates;
}

/**
 * Compose { skuName: { regionKey: usdPerGiBHour } } for every local-SSD SKU the
 * tables above name. Exact-match on the region-stripped description, exactly as
 * classifyCoreRam does, and for the same reason: the catalogue also carries
 * "C4A Sole Tenancy Instance Local SSD", "Spot Preemptible C4 Instance Local SSD",
 * "Commitment v1: Z3 Local SSD" and "DWS Calendar Mode H4D Instance Local SSD" —
 * every one of which would be picked up by a substring test and priced as though it
 * were the plain on-demand rate.
 *
 * Rates are converted from the catalogue's GiB-MONTH to GiB-HOUR here, so callers
 * never mix units by accident.
 * @param {object[]} skus  the `skus` array from one or more catalog pages
 */
function parseLocalSsdSkus(skus) {
  const wanted = new Set([
    ...Object.values(LOCAL_SSD_SKU_NAME),
    LOCAL_SSD_GENERIC,
  ]);
  const rates = {};
  for (const sku of skus || []) {
    if (!sku) continue;
    const c = sku.category || {};
    if (c.usageType !== "OnDemand") continue;
    if (c.resourceGroup !== "LocalSSD") continue;
    const name = String(sku.description || "")
      .replace(/ running in .*/i, "")
      .replace(/ in .*/i, "")
      .trim();
    if (!wanted.has(name)) continue;
    // The ÷730 is only correct for a per-GiB-MONTH rate, and nothing else in this
    // function establishes that the SKU is quoted that way — the name matched, and
    // the name says nothing about units. A local-SSD SKU published per GiBy.h would
    // divide to 1/730th of its real value and still look like a perfectly ordinary
    // price, which is the failure this file's own rule forbids: reconcile PREFERS
    // the official value, so a confidently wrong composition overwrites a correct
    // one. Skip instead, exactly as an SSD with no rate at all is skipped — the type
    // keeps its Vantage price and reconcile flags it UNVERIFIED for a human.
    const unit = sku.pricingInfo?.[0]?.pricingExpression?.usageUnit;
    if (unit !== LOCAL_SSD_USAGE_UNIT) continue;
    const usd = round8(skuUsd(sku) / HOURS_PER_MONTH);
    if (!Number.isFinite(usd)) continue;
    for (const sr of sku.serviceRegions || []) {
      const rk = regionKeyFromServiceRegion(sr);
      (rates[name] || (rates[name] = {}))[rk] = usd;
    }
  }
  return rates;
}

/**
 * The local-SSD rate for one type × region, or 0 when the type has no local SSD.
 * Null means "this type has local SSD but no rate is available here" — the caller
 * must then skip the type rather than price it as though the SSD were free, which
 * is precisely the 6–33%-low composition this phase exists to end.
 */
function localSsdHr(series, regionKey, ssdGiB, ssdRates) {
  if (!(ssdGiB > 0)) return 0;
  const named = LOCAL_SSD_SKU_NAME[series];
  const rate =
    (named && (ssdRates[named] || {})[regionKey]) ??
    (ssdRates[LOCAL_SSD_GENERIC] || {})[regionKey];
  return Number.isFinite(rate) ? rate * ssdGiB : null;
}

/**
 * The standard Windows Server per-vCPU-hour licensing rate from the catalog: the
 * modal non-zero price among "Licensing Fee for Windows Server … Datacenter/Standard
 * Edition (CPU cost)" SKUs (global, hourly). Falls back to the known constant if none
 * are present (e.g. a filtered fixture).
 */
function windowsPerVCpuHr(skus) {
  const counts = new Map();
  for (const sku of skus || []) {
    if (!sku) continue;
    if ((sku.category || {}).resourceFamily !== "License") continue;
    const d = String(sku.description || "");
    if (
      !/Licensing Fee for Windows Server .*(Datacenter|Standard) Edition \(CPU cost\)/i.test(
        d,
      )
    )
      continue;
    const usd = round8(skuUsd(sku));
    if (!Number.isFinite(usd) || usd <= 0) continue;
    counts.set(usd, (counts.get(usd) || 0) + 1);
  }
  if (!counts.size) return WINDOWS_PER_VCPU_HR_FALLBACK;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Compose per-type hourly prices for the shipped machines.
 * @param {object} rates    parseCoreRamSkus output
 * @param {number} winHr    windowsPerVCpuHr output
 * @param {object} shipped  { regionKey: { type: { series, vCpus, memoryGiB } } }
 * @returns {{ byRegion: object, unmatched: string[] }}
 *   byRegion = { regionKey: { type: { hourlyPrice, windowsHourlyPrice } } };
 *   unmatched = sorted "series" tokens with no usable rate (for a loud log).
 */
function composePricing(rates, winHr, shipped, ssdRates = {}) {
  const byRegion = {};
  const unmatched = new Set();
  for (const [rk, types] of Object.entries(shipped || {})) {
    for (const [type, rec] of Object.entries(types || {})) {
      // Deliberately not composed — see UNVERIFIED_TYPES. Reported so the run says
      // out loud which types it declined to price, rather than dropping them mutely.
      if (UNVERIFIED_TYPES.has(type)) {
        unmatched.add(`${type} (deliberately unverified)`);
        continue;
      }
      const series = rec && rec.series;
      const r = series && rates[series] && rates[series][rk];
      if (!r || !Number.isFinite(r.coreHr) || !Number.isFinite(r.ramHr)) {
        // Report the MISSING-series case too. This guard used to read
        // `if (series) unmatched.add(series)`, which meant a record carrying no
        // series at all skipped silently AND suppressed the one log that would
        // have said so — every record taking this branch produced an empty
        // report and exit 0. One sentinel rather than one entry per type: if the
        // field is gone it is gone for all of them, and the log should say that
        // once instead of reprinting the catalogue.
        unmatched.add(series || "(records carried no series field)");
        continue;
      }
      const vcpu = Number(rec.vCpus);
      const mem = Number(rec.memoryGiB);
      if (!Number.isFinite(vcpu) || !Number.isFinite(mem)) {
        unmatched.add(series || type);
        continue;
      }
      // Local SSD is a third component, not a rounding detail: on a z3 it is a
      // third of the price. A type that has one but no rate here is SKIPPED, not
      // priced without it — an under-composed price is worse than none, because
      // reconcile prefers the official value and would overwrite a correct one.
      const ssd = localSsdHr(series, rk, Number(rec.localSsdGiB), ssdRates);
      if (ssd === null) {
        unmatched.add(`${series} (local SSD rate missing)`);
        continue;
      }
      const hourly = round8(vcpu * r.coreHr + mem * r.ramHr + ssd);
      const forRegion = byRegion[rk] || (byRegion[rk] = {});
      forRegion[type] = {
        hourlyPrice: hourly,
        // Windows licensing is charged per vCPU only — never on memory or storage —
        // so it is added to the whole composed price, not recomposed from it.
        windowsHourlyPrice: round8(hourly + vcpu * winHr),
      };
    }
  }
  return { byRegion, unmatched: [...unmatched].sort() };
}

/**
 * The floor on a composition run: composing nothing is never a legitimate result.
 * Returns the type×region count so the caller can report it.
 *
 * Without this the tool wrote {}, logged "0 regions, 0 type×region prices", sent
 * nothing to stderr and exited 0 — and reconcile-data then read that empty dump as
 * the authoritative official side. Every route here is silent: a catalogue that
 * stops matching the shipped series, an empty shipped region set, or shipped
 * records that lost the fields the composition reads (which is exactly what the
 * specs/prices split does to them). The sibling fetchers throw on a short
 * catalogue for the same reason — this is that guard on the other end of the run.
 *
 * Separate and exported so it can be driven directly: main() cannot run without
 * the network, and a guard that only exists inside it is a guard nothing tests.
 * @param {object} byRegion  composePricing output
 * @param {object} shipped   the shipped records it was composed from
 * @param {string[]} unmatched  series with no usable rate, for the message
 * @returns {number} total type×region prices composed
 */
function assertComposedSomething(byRegion, shipped, unmatched = []) {
  const total = Object.values(byRegion || {}).reduce(
    (n, r) => n + Object.keys(r || {}).length,
    0,
  );
  if (total === 0) {
    throw new Error(
      `[gcp] composed 0 prices from ${Object.keys(shipped || {}).length} shipped region(s) — ` +
        `refusing to write an empty dump that reconcile would read as authoritative` +
        (unmatched.length ? ` (unmatched: ${unmatched.join(", ")})` : ""),
    );
  }
  return total;
}

// ── Network ────────────────────────────────────────────────────────────────────

// Every Compute Engine SKU, following nextPageToken to the end. The catalog is not
// filterable server-side, so the Core/Ram/OS refinement happens in the parsers.
//
// The cap and the repeat check both THROW rather than returning what has been
// collected so far: a short catalog composes prices for only some series, and the
// reconcile step would read that partial dump as authoritative and mark the missing
// families UNVERIFIED — a silent quality regression at exit 0. The azure fetcher's
// pagination guards it the same way.
async function fetchAllSkus() {
  const key = process.env.GCP_BILLING_API_KEY;
  if (!key) {
    throw new Error(
      "GCP_BILLING_API_KEY is not set — see .env.example / docs/DATA-SOURCES.md",
    );
  }
  const skus = [];
  const seen = new Set();
  let token = "";
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      throw new Error(
        `[gcp] page cap (${MAX_PAGES}) exceeded with a nextPageToken still pending — ` +
          `refusing to write a partial catalog`,
      );
    }
    if (token && seen.has(token)) {
      throw new Error(
        `[gcp] repeating nextPageToken at catalog page ${page + 1}`,
      );
    }
    if (token) seen.add(token);
    const url =
      `${CATALOG_HOST}/v1/${COMPUTE_SERVICE}/skus?key=${key}` +
      `&pageSize=${PAGE_SIZE}${token ? `&pageToken=${token}` : ""}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "User-Agent": "cloud-instance-recommender-fetch-official-gcp",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(
        `fetch failed: HTTP ${res.status} (catalog page ${page + 1})`,
      );
    }
    const j = await res.json();
    if (Array.isArray(j.skus)) skus.push(...j.skus);
    token = j.nextPageToken || "";
    if (!token) break;
  }
  return skus;
}

// ── Shipped-artifact read + CLI ──────────────────────────────────────────────────

// { regionKey: { type: { series, vCpus, memoryGiB } } } from the shipped region files.
// Each file is `window.<regionKey> = { <type>: {...} }`; run them in a sandbox and read
// the keys the manifest lists.
// MUST go through loadCommittedRegions, never a private walk over regions/.
// composePricing below reads `series`, `vCpus` and `memoryGiB` off these records, and
// all three are SPECS — they live in the manifest's GCP_SPECS, not in the region files.
// A private walk would hand composePricing price-only records, every one of which it
// would skip for want of a series, and it would write an empty pricing dump that
// reconcile then reads as authoritative. assertComposedSomething is the floor under
// that; using the shared loader is what stops it being reached.
function readShippedRecords() {
  const shipped = loadCommittedRegions("gcp");
  const keys = readShippedRegionKeys("gcp", "GCP");
  const out = {};
  for (const rk of keys) if (shipped[rk]) out[rk] = shipped[rk];
  return out;
}

async function main() {
  const out =
    argValue("--out") || path.join(".refresh-cache", "gcp-pricing.json");
  const only = argValue("--region");
  const shipped = readShippedRecords();
  if (only) {
    if (!shipped[only]) {
      throw new Error(`[gcp] --region ${only} is not a shipped region`);
    }
    for (const rk of Object.keys(shipped)) if (rk !== only) delete shipped[rk];
  }

  const skus = await fetchAllSkus();
  const rates = parseCoreRamSkus(skus);
  const ssdRates = parseLocalSsdSkus(skus);
  const winHr = windowsPerVCpuHr(skus);
  const { byRegion, unmatched } = composePricing(
    rates,
    winHr,
    shipped,
    ssdRates,
  );

  const total = assertComposedSomething(byRegion, shipped, unmatched);

  const outPath = path.isAbsolute(out) ? out : path.join(ROOT, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileAtomic(outPath, JSON.stringify(byRegion, null, 2));
  console.log(
    `[gcp] wrote ${out}: ${Object.keys(byRegion).length} regions, ${total} type×region prices ` +
      `(Windows +$${winHr}/vCPU·h)`,
  );
  if (unmatched.length) {
    process.stderr.write(
      `[gcp] no official rate for series: ${unmatched.join(", ")} ` +
        `— those keep Vantage pricing (UNVERIFIED in D2)\n`,
    );
  }
}

module.exports = {
  parseCoreRamSkus,
  fetchAllSkus,
  MAX_PAGES,
  windowsPerVCpuHr,
  composePricing,
  parseLocalSsdSkus,
  localSsdHr,
  assertComposedSomething,
  classifyCoreRam,
  skuUsd,
  SERIES_SKU_NAME,
  LOCAL_SSD_SKU_NAME,
  LOCAL_SSD_GENERIC,
  UNVERIFIED_TYPES,
  HOURS_PER_MONTH,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

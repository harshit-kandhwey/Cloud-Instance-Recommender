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
const { ROOT, round8, argValue, writeFileAtomic } = require("./lib/util");

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
  c4n: "C4N",
  e2: "E2",
  g2: "G2",
  h3: "H3",
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
function composePricing(rates, winHr, shipped) {
  const byRegion = {};
  const unmatched = new Set();
  for (const [rk, types] of Object.entries(shipped || {})) {
    for (const [type, rec] of Object.entries(types || {})) {
      const series = rec && rec.series;
      const r = series && rates[series] && rates[series][rk];
      if (!r || !Number.isFinite(r.coreHr) || !Number.isFinite(r.ramHr)) {
        if (series) unmatched.add(series);
        continue;
      }
      const vcpu = Number(rec.vCpus);
      const mem = Number(rec.memoryGiB);
      if (!Number.isFinite(vcpu) || !Number.isFinite(mem)) {
        unmatched.add(series || type);
        continue;
      }
      const hourly = round8(vcpu * r.coreHr + mem * r.ramHr);
      const forRegion = byRegion[rk] || (byRegion[rk] = {});
      forRegion[type] = {
        hourlyPrice: hourly,
        windowsHourlyPrice: round8(hourly + vcpu * winHr),
      };
    }
  }
  return { byRegion, unmatched: [...unmatched].sort() };
}

// ── Network ────────────────────────────────────────────────────────────────────

// Every Compute Engine SKU, following nextPageToken to the end (capped). The catalog
// is not filterable server-side, so the Core/Ram/OS refinement happens in the parsers.
async function fetchAllSkus() {
  const key = process.env.GCP_BILLING_API_KEY;
  if (!key) {
    throw new Error(
      "GCP_BILLING_API_KEY is not set — see .env.example / docs/DATA-SOURCES.md",
    );
  }
  const skus = [];
  let token = "";
  for (let page = 0; page < MAX_PAGES; page++) {
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
function readShippedRecords() {
  const vm = require("vm");
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "js", "gcp", "gcp-data.js"), "utf8"),
    sandbox,
    { filename: "js/gcp/gcp-data.js" },
  );
  const keys = sandbox.GCP_REGION_KEYS;
  if (!Array.isArray(keys) || !keys.length) {
    throw new Error("[gcp] no GCP_REGION_KEYS in shipped manifest");
  }
  const dir = path.join(ROOT, "js", "gcp", "regions");
  const out = {};
  for (const rk of keys) {
    const file = path.join(dir, `${rk}.js`);
    if (!fs.existsSync(file)) continue;
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, {
      filename: `${rk}.js`,
    });
    const region = sandbox[rk];
    if (region && typeof region === "object") out[rk] = region;
  }
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
  const winHr = windowsPerVCpuHr(skus);
  const { byRegion, unmatched } = composePricing(rates, winHr, shipped);

  const outPath = path.isAbsolute(out) ? out : path.join(ROOT, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileAtomic(outPath, JSON.stringify(byRegion, null, 2));

  const total = Object.values(byRegion).reduce(
    (n, r) => n + Object.keys(r).length,
    0,
  );
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
  windowsPerVCpuHr,
  composePricing,
  classifyCoreRam,
  skuUsd,
  SERIES_SKU_NAME,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

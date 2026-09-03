#!/usr/bin/env node
"use strict";
/*
 * fetch-official-azure.js — Azure on-demand VM pricing from the Azure Retail Prices
 * API, for the regions the app already ships.
 *
 *   node tools/fetch-official-azure.js [--out .refresh-cache/azure-pricing.json] [--region eastus]
 *
 * Node/CI build tool only; never shipped, never called by the page. NO credentials —
 * the Retail Prices API is unauthenticated. Phase D2 (reconcile-data.js) merges this
 * with the Vantage monolith, official pricing taking precedence. The API is pricing
 * only — it carries no vCPU/memory/family, so specs stay from Vantage (flagged
 * UNVERIFIED in the diff). parseAzureItems is pure and fixture-tested; the network
 * fetch never runs in the suite. See docs/DATA-SOURCES.md.
 */

const fs = require("fs");
const path = require("path");
const { ROOT, argValue, writeFileAtomic } = require("./lib/build-env");
const { round8, readShippedRegionKeys } = require("./lib/record-schema");

const RETAIL_PRICES_URL = "https://prices.azure.com/api/retail/prices";

// Price normalizer (the cross-tool 8-decimal contract, see tools/lib/record-schema.js).
const price = round8;

// armSkuName ("Standard_D4s_v5", "Basic_A0") → shipped type key ("d4sv5", "a0"):
// drop the tier prefix, lowercase, strip underscores.
function azureTypeKey(armSkuName) {
  return String(armSkuName || "")
    .replace(/^(Standard|Basic)_/i, "")
    .toLowerCase()
    .replace(/_/g, "");
}

// Spot and Low Priority meters are separate SKUs we never rank on — drop them so
// only the pay-as-you-go rate survives.
const isSpotOrLowPriority = (skuName) =>
  /\b(spot|low priority)\b/i.test(String(skuName || ""));

/**
 * Normalise a flat list of Retail Prices items into { region: { type: record } }.
 * Keeps only pay-as-you-go ("Consumption") Virtual Machines hourly meters; Windows
 * is detected from productName and sets windowsPrice, everything else is the Linux
 * rate. Items carry armRegionName, so a multi-region page keys itself correctly.
 * @param {object[]} items  the `Items` array from one or more API pages
 * @returns {Object<string, Object<string, object>>} region → type → { linuxPrice?, windowsPrice? }
 */
function parseAzureItems(items) {
  const byRegion = {};
  for (const it of items || []) {
    if (!it) continue;
    if (it.serviceName !== "Virtual Machines") continue;
    if (it.type !== "Consumption") continue; // excludes Reservation + DevTestConsumption
    if (it.unitOfMeasure !== "1 Hour") continue;
    if (isSpotOrLowPriority(it.skuName)) continue;

    const region = String(it.armRegionName || "").toLowerCase();
    const type = azureTypeKey(it.armSkuName);
    if (!region || !type) continue;

    const usd = price(Number(it.unitPrice));
    if (!Number.isFinite(usd)) continue;

    const forRegion = byRegion[region] || (byRegion[region] = {});
    const rec = forRegion[type] || (forRegion[type] = {});
    if (/windows/i.test(it.productName || "")) rec.windowsPrice = usd;
    else rec.linuxPrice = usd;
  }
  return byRegion;
}

// OData $filter for one region's consumption VM meters. A single quote in the region
// key is escaped by doubling it ('' per OData), so a crafted --region cannot break the
// query (an unescaped quote otherwise yields HTTP 400).
function azureFilter(regionKey) {
  const safe = String(regionKey).replace(/'/g, "''");
  return (
    "serviceName eq 'Virtual Machines' and priceType eq 'Consumption' and " +
    `armRegionName eq '${safe}'`
  );
}

// ── Network ────────────────────────────────────────────────────────────────────

// A page count far above any real region (~100 items/page; a shipped region is a few
// pages) — bounds the loop against a runaway or repeating NextPageLink.
const MAX_PAGES = 1000;

// One region's consumption VM meters, following NextPageLink to the end. The filter
// is server-side; the OS/Spot/hourly refinements are applied in parseAzureItems.
async function fetchRegionItems(regionKey) {
  let url = `${RETAIL_PRICES_URL}?$filter=${encodeURIComponent(azureFilter(regionKey))}`;
  const items = [];
  const seen = new Set();
  let pages = 0;
  while (url) {
    if (seen.has(url)) {
      throw new Error(`[azure] repeating NextPageLink for region ${regionKey}`);
    }
    seen.add(url);
    if (++pages > MAX_PAGES) {
      throw new Error(
        `[azure] page cap (${MAX_PAGES}) exceeded for region ${regionKey}`,
      );
    }
    const res = await fetch(url, {
      headers: {
        "User-Agent": "cloud-instance-recommender-fetch-official-azure",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      throw new Error(
        `fetch failed: HTTP ${res.status} for region ${regionKey}`,
      );
    }
    const page = await res.json();
    if (Array.isArray(page.Items)) items.push(...page.Items);
    url = page.NextPageLink || null;
  }
  return items;
}

// Fetch + normalise the shipped regions.
async function fetchAzurePricing(shippedKeys) {
  const byRegion = {};
  for (const key of shippedKeys) {
    const items = await fetchRegionItems(key);
    const parsed = parseAzureItems(items);
    const types = parsed[key] || {};
    byRegion[key] = types;
    const n = Object.keys(types).length;
    if (n === 0) {
      // Zero types is indistinguishable downstream from a real gap — a region-key
      // mismatch or empty response would otherwise pass silently. Warn loudly.
      process.stderr.write(
        `[azure] WARNING ${key}: 0 priced VM types from ${items.length} raw items — region-key mismatch or empty response\n`,
      );
    } else {
      console.log(`[azure] ${key}: ${n} priced VM types`);
    }
  }
  return byRegion;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

// Region keys to fetch: all shipped, or a single --region override validated against
// the manifest — a typo would otherwise fetch nothing and write an empty file at exit 0.
// Azure's armRegionName IS the shipped key, so unlike AWS there is no region code to
// translate first; only the membership check carries over.
function resolveRegionKeys(only, shippedKeys) {
  if (!only) return shippedKeys;
  if (!shippedKeys.includes(only)) {
    throw new Error(
      `--region ${only} is not a shipped region (not in AZURE_REGION_KEYS) — a typo would fetch nothing`,
    );
  }
  return [only];
}

async function main() {
  const out =
    argValue("--out") || path.join(".refresh-cache", "azure-pricing.json");
  const only = argValue("--region");
  const shippedKeys = readShippedRegionKeys("azure", "AZURE");
  const keys = resolveRegionKeys(only, shippedKeys);

  const byRegion = await fetchAzurePricing(keys);
  const outPath = path.isAbsolute(out) ? out : path.join(ROOT, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileAtomic(outPath, JSON.stringify(byRegion, null, 2));
  const total = Object.values(byRegion).reduce(
    (n, r) => n + Object.keys(r).length,
    0,
  );
  console.log(
    `[azure] wrote ${out}: ${Object.keys(byRegion).length} regions, ${total} type×region prices`,
  );
}

module.exports = {
  parseAzureItems,
  azureTypeKey,
  isSpotOrLowPriority,
  azureFilter,
  resolveRegionKeys,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

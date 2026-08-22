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

const ROOT = path.join(__dirname, "..");

const RETAIL_PRICES_URL = "https://prices.azure.com/api/retail/prices";

// ── Pure normalisation ─────────────────────────────────────────────────────────

// Round to 8 decimals — the deepest precision the shipped data uses — matching the
// Vantage side so a re-quote of the same price does not read as a move.
const price = (v) => (Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v);

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

// ── Network ────────────────────────────────────────────────────────────────────

// One region's consumption VM meters, following NextPageLink to the end. The filter
// is server-side; the OS/Spot/hourly refinements are applied in parseAzureItems.
async function fetchRegionItems(regionKey) {
  const filter =
    "serviceName eq 'Virtual Machines' and priceType eq 'Consumption' and " +
    `armRegionName eq '${regionKey}'`;
  let url = `${RETAIL_PRICES_URL}?$filter=${encodeURIComponent(filter)}`;
  const items = [];
  while (url) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "cloud-instance-recommender-fetch-official-azure",
        Accept: "application/json",
      },
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
    console.log(`[azure] ${key}: ${Object.keys(types).length} priced VM types`);
  }
  return byRegion;
}

// ── Shipped-artifact read + CLI ──────────────────────────────────────────────────

function readShippedRegionKeys() {
  const vm = require("vm");
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "js", "azure", "azure-data.js"), "utf8"),
    sandbox,
    { filename: "js/azure/azure-data.js" },
  );
  const keys = sandbox.AZURE_REGION_KEYS;
  if (!Array.isArray(keys) || !keys.length) {
    throw new Error("[azure] no AZURE_REGION_KEYS in shipped manifest");
  }
  return keys;
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const out =
    argValue("--out") || path.join(".refresh-cache", "azure-pricing.json");
  const only = argValue("--region");
  const shippedKeys = readShippedRegionKeys();
  const keys = only ? [only] : shippedKeys;

  const byRegion = await fetchAzurePricing(keys);
  const outPath = path.isAbsolute(out) ? out : path.join(ROOT, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(byRegion, null, 2), "utf8");
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
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

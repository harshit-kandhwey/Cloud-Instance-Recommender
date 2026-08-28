#!/usr/bin/env node
"use strict";
/*
 * fetch-official-aws.js — AWS on-demand pricing (+ the specs the bulk records carry)
 * from the AWS Price List Bulk API, for the type × region pairs the app already ships.
 *
 *   node tools/fetch-official-aws.js [--out .refresh-cache/aws-pricing.json] [--region us-east-1]
 *
 * Node/CI build tool only; never shipped, never called by the page. NO credentials —
 * the Bulk API is public HTTPS. Phase D2 (reconcile-data.js) merges this with the
 * Vantage monolith, official pricing taking precedence. parseAwsRegion is pure and
 * fixture-tested; the network fetch never runs in the suite. See docs/DATA-SOURCES.md.
 *
 * The per-region index.json is large (116–480 MB) but filters to a few hundred
 * compute-instance types, so it is fetched one region at a time and discarded.
 */

const fs = require("fs");
const path = require("path");
const { ROOT, round8, argValue, readShippedRegionKeys } = require("./lib/util");

// Price normalizer (the cross-tool 8-decimal contract, see tools/lib/util.js).
const price = round8;

// Public Bulk API. The region index lists each region's current per-region offer
// file; both are served from the same host.
const PRICING_HOST = "https://pricing.us-east-1.amazonaws.com";
const REGION_INDEX_URL = `${PRICING_HOST}/offers/v1.0/aws/AmazonEC2/current/region_index.json`;

// region key (shipped, underscored) ⇄ AWS region code (hyphenated).
const keyToRegionCode = (key) => key.replace(/_/g, "-");
const regionCodeToKey = (code) => code.replace(/-/g, "_");

// ── Pure normalisation ─────────────────────────────────────────────────────────

// "8 GiB" → 8, "1,024 GiB" → 1024, "0.5 GiB" → 0.5. NaN when unparseable
// (Number("") is 0, so an empty/digit-free string must not slip through as 0).
function awsMemoryGiB(raw) {
  const digits = String(raw == null ? "" : raw).replace(/[^0-9.]/g, "");
  if (!digits) return NaN;
  const n = Number(digits);
  return Number.isFinite(n) ? n : NaN;
}

// The on-demand USD/hour for a SKU: the single OnDemand term's Hrs price dimension.
// Returns NaN when the SKU has no on-demand hourly rate.
function onDemandUsdHr(terms, sku) {
  const forSku = terms && terms.OnDemand && terms.OnDemand[sku];
  if (!forSku) return NaN;
  for (const term of Object.values(forSku)) {
    const dims = (term && term.priceDimensions) || {};
    for (const dim of Object.values(dims)) {
      if (
        dim &&
        dim.unit === "Hrs" &&
        dim.pricePerUnit &&
        dim.pricePerUnit.USD
      ) {
        const n = Number(dim.pricePerUnit.USD);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return NaN;
}

/**
 * Normalise one per-region bulk offer file into { type: record }.
 * record carries the two hourly price fields plus the specs the bulk data verifies
 * (vCpus, memorySizeInGiB, instanceFamily prefix, instanceFamilyName category), so
 * D2 can cross-check specs and take official pricing.
 * @param {object} regionJson  a parsed AWS EC2 per-region index.json
 * @returns {Object<string, object>} type → normalised record
 */
function parseAwsRegion(regionJson) {
  const products = (regionJson && regionJson.products) || {};
  const terms = (regionJson && regionJson.terms) || {};
  const byType = {};

  for (const [sku, product] of Object.entries(products)) {
    if (!product || product.productFamily !== "Compute Instance") continue;
    const a = product.attributes || {};
    if (a.tenancy !== "Shared") continue;
    if (a.capacitystatus !== "Used") continue;
    if (a.preInstalledSw !== "NA") continue;
    if (/bring your own license/i.test(a.licenseModel || "")) continue;
    const os = a.operatingSystem;
    if (os !== "Linux" && os !== "Windows") continue;

    const type = a.instanceType;
    if (!type) continue;
    const usd = price(onDemandUsdHr(terms, sku));
    if (!Number.isFinite(usd)) continue;

    const rec =
      byType[type] ||
      (byType[type] = {
        instanceFamily: type.split(".")[0],
        instanceFamilyName: a.instanceFamily || "",
        vCpus: Number.parseInt(a.vcpu, 10),
        memorySizeInGiB: awsMemoryGiB(a.memory),
      });
    if (os === "Linux") rec.onDemandLinuxHr = usd;
    else rec.onDemandWindowsHr = usd;
  }

  return byType;
}

// ── Network ────────────────────────────────────────────────────────────────────

async function getJson(url) {
  // Generous upper bound: a per-region offer file is 116–480 MB, so this caps a
  // stalled download/parse without cutting off a legitimately slow one.
  const res = await fetch(url, {
    headers: {
      "User-Agent": "cloud-instance-recommender-fetch-official-aws",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} for ${url}`);
  return res.json();
}

// Map each wanted region code to its current per-region offer URL.
async function regionOfferUrls(wantedCodes) {
  const index = await getJson(REGION_INDEX_URL);
  const regions = (index && index.regions) || {};
  const out = new Map();
  for (const code of wantedCodes) {
    const entry = regions[code];
    if (entry && entry.currentVersionUrl) {
      out.set(code, PRICING_HOST + entry.currentVersionUrl);
    }
  }
  return out;
}

// Fetch + normalise the shipped regions, one at a time to bound memory.
async function fetchAwsPricing(shippedKeys) {
  const wanted = shippedKeys.map(keyToRegionCode);
  const urls = await regionOfferUrls(wanted);
  const byRegion = {};
  for (const code of wanted) {
    const url = urls.get(code);
    if (!url) {
      process.stderr.write(
        `[aws] no offer file for region ${code} — skipping\n`,
      );
      continue;
    }
    const regionJson = await getJson(url);
    const types = parseAwsRegion(regionJson);
    byRegion[regionCodeToKey(code)] = types;
    console.log(
      `[aws] ${code}: ${Object.keys(types).length} priced compute types`,
    );
  }
  return byRegion;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

// Region keys to fetch: all shipped, or a single --region override validated against
// the manifest — a typo would otherwise fetch nothing and write an empty file at exit 0.
function resolveRegionKeys(only, shippedKeys) {
  if (!only) return shippedKeys;
  const key = regionCodeToKey(only);
  if (!shippedKeys.includes(key)) {
    throw new Error(
      `--region ${only} is not a shipped region (not in AWS_REGION_KEYS) — a typo would fetch nothing`,
    );
  }
  return [key];
}

async function main() {
  const out =
    argValue("--out") || path.join(".refresh-cache", "aws-pricing.json");
  const only = argValue("--region");
  const shippedKeys = readShippedRegionKeys("aws", "AWS");
  const keys = resolveRegionKeys(only, shippedKeys);

  const byRegion = await fetchAwsPricing(keys);
  const outPath = path.isAbsolute(out) ? out : path.join(ROOT, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(byRegion, null, 2), "utf8");
  const total = Object.values(byRegion).reduce(
    (n, r) => n + Object.keys(r).length,
    0,
  );
  console.log(
    `[aws] wrote ${out}: ${Object.keys(byRegion).length} regions, ${total} type×region prices`,
  );
}

module.exports = {
  parseAwsRegion,
  awsMemoryGiB,
  onDemandUsdHr,
  keyToRegionCode,
  regionCodeToKey,
  resolveRegionKeys,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

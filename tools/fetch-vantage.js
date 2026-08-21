#!/usr/bin/env node
"use strict";
/*
 * fetch-vantage.js — regenerate js/{provider}/{provider}-data.js monoliths from the
 * Vantage bulk instance data, in the format tools/split-data.js consumes.
 *
 *   node tools/fetch-vantage.js [--provider aws|azure|gcp] [--date YYYY-MM-DD]
 *
 * Node/CI build tool only; not shipped to the page. Requires VANTAGE_API_KEY (sent
 * as a Bearer token, never printed). Emits only region keys the shipped manifests
 * already carry. buildMonolith is pure and unit-tested against fixtures; the network
 * fetch never runs in the suite. See docs/DATA-SOURCES.md.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

// Bulk static JSON endpoints (ec2 at the root, azure/gcp under their path).
const BULK_URLS = {
  aws: "https://instances.vantage.sh/instances.json",
  azure: "https://instances.vantage.sh/azure/instances.json",
  gcp: "https://instances.vantage.sh/gcp/instances.json",
};

const PROVIDERS = [
  { name: "aws", prefix: "AWS", source: "instances.vantage.sh" },
  { name: "azure", prefix: "AZURE", source: "instances.vantage.sh/azure" },
  { name: "gcp", prefix: "GCP", source: "instances.vantage.sh/gcp" },
];

// ── Field derivations ────────────────────────────────────────────────────────

const num = (v) => (v === undefined || v === null ? NaN : Number(v));

// Strip float-representation noise from a parsed price (e.g. 0.19423600000000002 →
// 0.194236) by rounding to 8 decimal places — the deepest precision the data uses.
const price = (v) => (Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v);

// physical_processor string → manufacturer bucket.
function awsProcessor(physical) {
  const p = String(physical || "");
  if (/graviton|^aws/i.test(p)) return "AWS";
  if (/amd/i.test(p)) return "AMD";
  return "Intel";
}

// Azure category slug → display name; unknown categories title-cased.
const AZURE_CATEGORY_NAMES = {
  generalpurpose: "General purpose",
  computeoptimized: "Compute optimized",
  memoryoptimized: "Memory optimized",
  storageoptimized: "Storage optimized",
  gpu: "GPU",
  highperformancecompute: "High performance compute",
  fpga: "FPGA",
};
function azureFamilyName(category) {
  const c = String(category || "");
  if (AZURE_CATEGORY_NAMES[c]) return AZURE_CATEGORY_NAMES[c];
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : "";
}

// Vantage carries no cpuPlatform/isARM for GCP; derive from series (consistent in
// the shipped data). Unknown series default to Intel.
const GCP_ARM_SERIES = new Set(["t2a"]);
const GCP_AMD_SERIES = new Set(["c2d", "c3d", "n2d", "n4d", "t2d"]);
function gcpPlatform(series) {
  if (GCP_ARM_SERIES.has(series)) return { cpuPlatform: "ARM", isARM: 1 };
  if (GCP_AMD_SERIES.has(series)) return { cpuPlatform: "AMD", isARM: 0 };
  return { cpuPlatform: "Intel", isARM: 0 };
}

// AWS/GCP region key = pricing slug with hyphens → underscores. Azure pricing slugs
// are Vantage codes, so map through the record's regions table to the Azure display
// name, then normalise it ("East US" → eastus).
const underscoreKey = (slug) => slug.replace(/-/g, "_");
const azureRegionKey = (displayName) =>
  String(displayName || "")
    .toLowerCase()
    .replace(/\s+/g, "");

// Vantage omits Azure generation; carry forward the shipped value, else the family's
// shipped generation, else assume current. Phase D2 cross-checks against the Azure API.
function resolveAzureGeneration(type, family, azureGen) {
  if (!azureGen) return 1;
  if (Object.prototype.hasOwnProperty.call(azureGen.byType, type))
    return azureGen.byType[type];
  if (Object.prototype.hasOwnProperty.call(azureGen.byFamily, family))
    return azureGen.byFamily[family];
  return 1;
}

// ── Record + region assembly ─────────────────────────────────────────────────

// One raw instance → [{ regionKey, type, record }] for each shipped region it is
// priced in. Instances without an on-demand Linux price in a region are skipped there.
function instanceRegionRecords(name, raw, shippedKeys, azureGen) {
  const out = [];
  const pricing = raw.pricing || {};

  if (name === "aws") {
    const type = raw.instance_type;
    const base = {
      instanceFamily: type.split(".")[0],
      instanceFamilyName: raw.family || "",
      isGraviton: (raw.arch || []).some((a) => /arm64/i.test(a)) ? 1 : 0,
      currentGeneration: raw.generation === "current" ? 1 : 0,
      processorManufacturer: awsProcessor(raw.physical_processor),
      vCpus: num(raw.vCPU),
      memorySizeInGiB: num(raw.memory),
      nitroEnclavesSupport: raw.nitro_enclave_support ? 1 : 0,
    };
    for (const slug of Object.keys(pricing)) {
      const key = underscoreKey(slug);
      if (!shippedKeys.has(key)) continue;
      const linux = num(pricing[slug].linux && pricing[slug].linux.ondemand);
      if (!Number.isFinite(linux)) continue;
      const win = num(pricing[slug].mswin && pricing[slug].mswin.ondemand);
      out.push({
        regionKey: key,
        type,
        record: {
          ...base,
          onDemandLinuxHr: price(linux),
          onDemandWindowsHr: price(Number.isFinite(win) ? win : 0),
        },
      });
    }
    return out;
  }

  if (name === "gcp") {
    const type = raw.instance_type;
    const series = type.split("-")[0];
    const plat = gcpPlatform(series);
    const base = {
      series,
      seriesName: raw.family || "",
      generation: raw.generation === "current" ? 1 : 0,
      vCpus: num(raw.vCPU),
      memoryGiB: num(raw.memory),
    };
    for (const slug of Object.keys(pricing)) {
      const key = underscoreKey(slug);
      if (!shippedKeys.has(key)) continue;
      const linux = num(pricing[slug].linux && pricing[slug].linux.ondemand);
      if (!Number.isFinite(linux)) continue;
      const win = num(pricing[slug].windows && pricing[slug].windows.ondemand);
      out.push({
        regionKey: key,
        type,
        record: {
          ...base,
          hourlyPrice: price(linux),
          windowsHourlyPrice: price(Number.isFinite(win) ? win : 0),
          cpuPlatform: plat.cpuPlatform,
          isARM: plat.isARM,
        },
      });
    }
    return out;
  }

  // azure
  const type = raw.instance_type;
  const family = raw.family || "";
  const isARM = (raw.arch || []).some((a) => /arm64|arm/i.test(a)) ? 1 : 0;
  const base = {
    family,
    familyName: azureFamilyName(raw.category),
    isARM,
    generation: resolveAzureGeneration(type, family, azureGen),
    processorArchitecture: isARM ? "ARM" : "Intel",
    vCpus: num(raw.vcpu),
    memoryGiB: num(raw.memory),
  };
  const regionsMap = raw.regions || {};
  for (const slug of Object.keys(pricing)) {
    const key = azureRegionKey(regionsMap[slug]);
    if (!key || !shippedKeys.has(key)) continue;
    const linux = num(pricing[slug].linux && pricing[slug].linux.ondemand);
    if (!Number.isFinite(linux)) continue;
    const win = num(pricing[slug].windows && pricing[slug].windows.ondemand);
    out.push({
      regionKey: key,
      type,
      record: {
        ...base,
        linuxPrice: price(linux),
        windowsPrice: price(Number.isFinite(win) ? win : 0),
      },
    });
  }
  return out;
}

// ── Serialisation ────────────────────────────────────────────────────────────

// Match the committed region-file style: string values JSON-quoted, numbers bare.
const emitValue = (v) =>
  typeof v === "string" ? JSON.stringify(v) : String(v);

const FIELD_ORDER = {
  aws: [
    "instanceFamily",
    "instanceFamilyName",
    "isGraviton",
    "currentGeneration",
    "processorManufacturer",
    "vCpus",
    "memorySizeInGiB",
    "nitroEnclavesSupport",
    "onDemandLinuxHr",
    "onDemandWindowsHr",
  ],
  azure: [
    "family",
    "familyName",
    "isARM",
    "generation",
    "processorArchitecture",
    "vCpus",
    "memoryGiB",
    "linuxPrice",
    "windowsPrice",
  ],
  gcp: [
    "series",
    "seriesName",
    "generation",
    "vCpus",
    "memoryGiB",
    "hourlyPrice",
    "windowsHourlyPrice",
    "cpuPlatform",
    "isARM",
  ],
};

const emitRecordBody = (fieldOrder, record) =>
  fieldOrder.map((f) => `    ${f}: ${emitValue(record[f])},`).join("\n");

/**
 * Build the monolith string for one provider.
 * @param {object} o
 * @param {"aws"|"azure"|"gcp"} o.name
 * @param {"AWS"|"AZURE"|"GCP"} o.prefix  window-global prefix
 * @param {string} o.source  header-comment source label
 * @param {object[]} o.instances  raw Vantage records (snake_case)
 * @param {Set<string>|string[]} o.shippedKeys  region keys to emit
 * @param {string} o.dataDate  YYYY-MM-DD
 * @param {{byType:object,byFamily:object}} [o.azureGen]  shipped Azure generations
 * @returns {{ monolith:string, regionKeys:string[], instanceCount:number }}
 */
function buildMonolith({
  name,
  prefix,
  source,
  instances,
  shippedKeys,
  dataDate,
  azureGen,
}) {
  const keys = shippedKeys instanceof Set ? shippedKeys : new Set(shippedKeys);
  const fieldOrder = FIELD_ORDER[name];
  if (!fieldOrder) throw new Error(`unknown provider ${name}`);

  const byRegion = new Map(); // regionKey -> Map(type -> record)
  for (const raw of instances) {
    for (const { regionKey, type, record } of instanceRegionRecords(
      name,
      raw,
      keys,
      azureGen,
    )) {
      if (!byRegion.has(regionKey)) byRegion.set(regionKey, new Map());
      byRegion.get(regionKey).set(type, record);
    }
  }

  // Sorted region keys and instance types keep the output (and the split diff) stable.
  const regionKeys = [...byRegion.keys()].sort();
  const label = { AWS: "AWS", AZURE: "Azure", GCP: "GCP" }[prefix];

  const parts = [];
  parts.push(`// ${label} Instance Data - Auto-generated from ${source}`);
  parts.push(`// Updated: ${dataDate} | Includes Linux + Windows pricing`);
  parts.push(`window.${prefix}_DATA_DATE = ${JSON.stringify(dataDate)};`);
  // Self-contained assign helper; split-data.js reads the region list from the call.
  parts.push(`function make${prefix}RegionsGlobal(regions) {`);
  parts.push(`  for (const k in regions) window[k] = regions[k];`);
  parts.push(`  window.${prefix}_DATA_READY = true;`);
  parts.push(`}`);
  parts.push("");

  let instanceCount = 0;
  for (const rk of regionKeys) {
    const recs = byRegion.get(rk);
    const types = [...recs.keys()].sort();
    instanceCount += types.length;
    const body = types
      .map(
        (t) =>
          `  ${JSON.stringify(t)}: {\n${emitRecordBody(fieldOrder, recs.get(t))}\n  },`,
      )
      .join("\n");
    parts.push(`const ${rk} = {\n${body}\n};`);
    parts.push("");
  }

  parts.push(`make${prefix}RegionsGlobal({`);
  parts.push(regionKeys.map((k) => `  ${k},`).join("\n"));
  parts.push(`});`);
  parts.push("");

  return { monolith: parts.join("\n"), regionKeys, instanceCount };
}

// ── Shipped-artifact reads ───────────────────────────────────────────────────

function loadGlobals(relPath) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, relPath), "utf8"), sandbox, {
    filename: relPath,
  });
  return sandbox;
}

function readShippedRegionKeys(name, prefix) {
  const g = loadGlobals(`js/${name}/${name}-data.js`);
  const keys = g[`${prefix}_REGION_KEYS`];
  if (!Array.isArray(keys) || !keys.length) {
    throw new Error(`[${name}] no ${prefix}_REGION_KEYS in shipped manifest`);
  }
  return keys;
}

// { byType, byFamily } generations from the shipped Azure region files. byType is
// exact per instance; byFamily is the family's most common generation, for new sizes.
function collectAzureGeneration() {
  const dir = path.join(ROOT, "js", "azure", "regions");
  const byType = {};
  const familyCounts = {};
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const g = loadGlobals(`js/azure/regions/${file}`);
    const region = g[file.replace(/\.js$/, "")];
    if (!region || typeof region !== "object") continue;
    for (const [type, rec] of Object.entries(region)) {
      if (!rec || typeof rec.generation !== "number") continue;
      byType[type] = rec.generation;
      const fam = rec.family || "";
      (familyCounts[fam] ??= {})[rec.generation] =
        (familyCounts[fam][rec.generation] || 0) + 1;
    }
  }
  const byFamily = {};
  for (const [fam, counts] of Object.entries(familyCounts)) {
    byFamily[fam] = Number(
      Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0],
    );
  }
  return { byType, byFamily };
}

// ── Network + CLI ─────────────────────────────────────────────────────────────

async function fetchBulk(name) {
  const key = process.env.VANTAGE_API_KEY;
  if (!key) {
    throw new Error(
      "VANTAGE_API_KEY is not set — see .env.example / docs/DATA-SOURCES.md",
    );
  }
  const res = await fetch(BULK_URLS[name], {
    headers: {
      Authorization: `Bearer ${key}`,
      "User-Agent": "cloud-instance-recommender-fetch-vantage",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`[${name}] fetch failed: HTTP ${res.status}`);
  return res.json();
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const only = argValue("--provider");
  const dataDate = argValue("--date") || new Date().toISOString().slice(0, 10);
  const targets = PROVIDERS.filter((p) => !only || p.name === only);
  if (!targets.length) throw new Error(`unknown --provider ${only}`);

  for (const { name, prefix, source } of targets) {
    const shippedKeys = readShippedRegionKeys(name, prefix);
    const azureGen = name === "azure" ? collectAzureGeneration() : undefined;
    const instances = await fetchBulk(name);
    const { monolith, regionKeys, instanceCount } = buildMonolith({
      name,
      prefix,
      source,
      instances,
      shippedKeys,
      dataDate,
      azureGen,
    });
    fs.writeFileSync(
      path.join(ROOT, "js", name, `${name}-data.js`),
      monolith,
      "utf8",
    );
    const dropped = shippedKeys.length - regionKeys.length;
    console.log(
      `[${name}] wrote monolith: ${regionKeys.length}/${shippedKeys.length} shipped regions, ` +
        `${instanceCount} records${dropped ? `, ${dropped} region(s) got no data` : ""}`,
    );
    console.log(`[${name}] next: node tools/split-data.js`);
  }
}

module.exports = {
  buildMonolith,
  instanceRegionRecords,
  collectAzureGeneration,
  readShippedRegionKeys,
  awsProcessor,
  azureFamilyName,
  gcpPlatform,
  azureRegionKey,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

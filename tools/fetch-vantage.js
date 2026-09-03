#!/usr/bin/env node
"use strict";
/*
 * fetch-vantage.js — rebuild each provider's fat monolith from the Vantage bulk
 * instance data, in the format tools/split-data.js consumes.
 *
 *   node tools/fetch-vantage.js [--provider aws|azure|gcp] [--date YYYY-MM-DD]
 *
 * Writes to the gitignored .refresh-cache/{provider}-monolith.js, NOT over the
 * shipped js/{provider}/{provider}-data.js: the shipped tree stays untouched until
 * split-data runs, so the diffs can still read the old data out of it and a run that
 * dies part-way cannot leave a new manifest beside old region files.
 *
 * Node/CI build tool only; not shipped to the page. Requires VANTAGE_API_KEY (sent
 * as a Bearer token, never printed). Emits only region keys the shipped manifests
 * already carry. buildMonolith is pure and unit-tested against fixtures; the network
 * fetch never runs in the suite. See docs/DATA-SOURCES.md.
 */

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  argValue,
  resolveDataDate,
  writeFileAtomic,
  loadGlobals,
  monolithPath,
} = require("./lib/build-env");
const {
  round8,
  loadCommittedRegions,
  readShippedRegionKeys,
  FIELD_ORDER,
  emitRecordBody,
} = require("./lib/record-schema");

// Price normalizer (the cross-tool 8-decimal contract, see tools/lib/util.js).
const price = round8;

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

// Azure's specs feed carries no CPU vendor — only arch (x64 / Arm64) — so an AMD VM
// is indistinguishable from an Intel one by field alone, and every one of them used
// to ship labelled "Intel". Microsoft's naming convention does encode it ("if the CPU
// is AMD, it will be listed as a"), but that is NOT safe as a rule in either
// direction: the legacy A-series (a, av2) is not AMD, and in the GPU families the
// letter belongs to the accelerator, not the vendor — nca100v4 is an NVIDIA A100 on
// an AMD host, while ndsrh200v5 (ND H100 v5) is Intel. So the vendor comes from a
// table, and the naming pattern is demoted to a tripwire for anything absent from it.
// Verified against Microsoft's per-series size docs.
const AZURE_AMD_FAMILIES = new Set([
  // General purpose / compute / memory / storage — the "a" is the documented vendor.
  "basv2",
  "dadsv5",
  "dadsv6",
  "dadsv7",
  "daldsv6",
  "daldsv7",
  "dalsv6",
  "dalsv7",
  "dasv4",
  "dasv5",
  "dasv6",
  "dasv7",
  "dav4",
  "dcadsv5",
  "dcadsv6",
  "dcasv5",
  "dcasv6",
  "eadsv5",
  "eadsv6",
  "eadsv7",
  "easv4",
  "easv5",
  "easv6",
  "easv7",
  "eav4",
  "ecadsv5",
  "ecadsv6",
  "ecasv5",
  "ecasv6",
  "fadsv7",
  "faldsv7",
  "falsv6",
  "falsv7",
  "famdsv7",
  "famsv6",
  "famsv7",
  "fasv6",
  "fasv7",
  "laosv4",
  "lasv3",
  "lasv4",
  // GPU families whose AMD host CPU each size doc states outright: NCasT4_v3 (EPYC
  // Rome), NC A100 v4 (EPYC Milan), NCads H100 v5 (EPYC Genoa), NDasrA100_v4 (EPYC
  // Rome), NVads V710 v5 (EPYC Genoa). Their siblings are deliberately NOT here —
  // see the tripwire.
  "ncast4v3",
  "nca100v4",
  "ncadsh100v5",
  "ndasrv4",
  "nvadsv710v5",
]);

// Families whose name carries the AMD marker: the "a" immediately after the family
// letter and size digits. Anchored so the legacy A-series can never match. Used ONLY
// to report families the table has not classified — never to classify one.
const AZURE_AMD_NAME_HINT = /^[bdefhlmn][a-z]*a/;
const looksAzureAmd = (family) =>
  AZURE_AMD_NAME_HINT.test(family) && !/^a/.test(family);

// Azure CPU vendor for a family. Arm wins (it comes from the source's own arch), then
// the table; anything else is Intel, which is right for the large Intel majority and
// is what the tripwire below exists to keep honest.
function azureProcessor(family, isARM) {
  if (isARM) return "ARM";
  return AZURE_AMD_FAMILIES.has(String(family)) ? "AMD" : "Intel";
}

// Families that look AMD by Microsoft's convention but are absent from the table, so
// they ship as Intel. Pure, so the report and its test share one definition.
function unmappedAzureAmdFamilies(families) {
  return [...new Set(families)]
    .filter((f) => looksAzureAmd(f) && !AZURE_AMD_FAMILIES.has(f))
    .sort();
}

// Vantage carries no cpuPlatform/isARM for GCP; derive from the series. Google's
// suffix convention ("a" = Arm, "d" = AMD, bare = Intel) holds for the general-purpose
// families but NOT for the accelerator ones — a4x is Arm on NVIDIA Grace — so this
// stays a table rather than a rule. Verified against Google's machine-family docs:
// Axion Arm c4a (Neoverse V2) / n4a (Neoverse N3), Ampere Altra t2a, Grace Arm a4x;
// AMD EPYC Turin c4d/n4d/h4d, Milan c2d, Genoa c3d, plus n2d/t2d.
// A series in NONE of the three tables falls back to Intel — a guess, and the wrong
// one for every Arm or AMD family Google adds, which is exactly how c4a would have
// shipped as Intel. buildMonolith reports those rather than let them ship silently.
const GCP_ARM_SERIES = new Set(["a4x", "c4a", "n4a", "t2a"]);
const GCP_AMD_SERIES = new Set([
  "c2d",
  "c3d",
  "c4d",
  "h4d",
  "n2d",
  "n4d",
  "t2d",
]);
const GCP_INTEL_SERIES = new Set([
  "a2",
  "a3",
  "c2",
  "c3",
  "c4",
  // c4n/m4n are the network-optimized family: Intel Emerald Rapids per Google's
  // network-optimized-machines doc. The "n" is the family's purpose, not a vendor —
  // reading it as one is the same mistake the a4x note above warns about.
  "c4n",
  "e2",
  "g2",
  "h3",
  "m1",
  "m2",
  "m3",
  "m4",
  "m4n",
  "n1",
  "n2",
  "n4",
  "z3",
]);
function gcpPlatform(series) {
  if (GCP_ARM_SERIES.has(series)) return { cpuPlatform: "ARM", isARM: 1 };
  if (GCP_AMD_SERIES.has(series)) return { cpuPlatform: "AMD", isARM: 0 };
  return { cpuPlatform: "Intel", isARM: 0 };
}
const isMappedGcpSeries = (series) =>
  GCP_ARM_SERIES.has(series) ||
  GCP_AMD_SERIES.has(series) ||
  GCP_INTEL_SERIES.has(series);

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
    if (!Number.isFinite(base.vCpus) || !Number.isFinite(base.memorySizeInGiB))
      return out; // missing spec → don't ship a NaN-spec record
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
      // Absent or false reads as 0, never undefined: emitValue refuses undefined,
      // and "no local SSD" must be a value rather than a hole in the record.
      localSsdGiB: num(raw.local_ssd_size) || 0,
    };
    if (!Number.isFinite(base.vCpus) || !Number.isFinite(base.memoryGiB))
      return out; // missing spec → don't ship a NaN-spec record
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
    processorArchitecture: azureProcessor(family, isARM),
    vCpus: num(raw.vcpu),
    memoryGiB: num(raw.memory),
  };
  if (!Number.isFinite(base.vCpus) || !Number.isFinite(base.memoryGiB))
    return out; // missing spec → don't ship a NaN-spec record
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
//
// FIELD_ORDER and emitRecordBody live in tools/lib/util.js: split-data writes the
// same fields, partitioned into specs and prices, and the two writers must not
// keep separate ideas of what a record contains. emitValue's throw on a
// non-serializable value is the tripwire behind the missing-spec skip in
// instanceRegionRecords.

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

  // A GCP series in none of the platform tables just shipped on the Intel fallback.
  // Name it here, at the one point that sees everything built, so a new Arm or AMD
  // family is caught at refresh time instead of surfacing later as wrong data.
  if (name === "gcp") {
    const unmapped = new Set();
    for (const recs of byRegion.values())
      for (const rec of recs.values())
        if (!isMappedGcpSeries(rec.series)) unmapped.add(rec.series);
    if (unmapped.size)
      process.stderr.write(
        `WARNING: GCP series with no platform mapping, shipped as Intel: ` +
          `${[...unmapped].sort().join(", ")} — add each to GCP_ARM_SERIES / ` +
          `GCP_AMD_SERIES / GCP_INTEL_SERIES in tools/fetch-vantage.js\n`,
      );
  }

  // Same idea for Azure, but inverted: the vendor table is authoritative and the
  // naming convention is only a hint, so what gets reported is a family that LOOKS
  // AMD and is not in the table. It shipped as Intel; the doc for that size says
  // which it is. Not an error — some are genuinely Intel, and a few carry the letter
  // for an accelerator rather than a vendor.
  if (name === "azure") {
    const families = [];
    for (const recs of byRegion.values())
      for (const rec of recs.values()) families.push(rec.family);
    const unclassified = unmappedAzureAmdFamilies(families);
    if (unclassified.length)
      process.stderr.write(
        `WARNING: Azure families named as AMD but absent from the vendor table, ` +
          `shipped as Intel: ${unclassified.join(", ")} — check each size doc and ` +
          `add the AMD ones to AZURE_AMD_FAMILIES in tools/fetch-vantage.js\n`,
      );
  }

  // Map(rk -> Map(type -> record)) → plain { rk: { type: record } } for the shared
  // serializer below, which is the one definition of the on-disk format.
  const obj = {};
  for (const [rk, recs] of byRegion) {
    obj[rk] = {};
    for (const [t, rec] of recs) obj[rk][t] = rec;
  }
  return serializeMonolith({ name, prefix, source, dataDate, byRegion: obj });
}

/**
 * Emit the monolith string split-data.js consumes, from an already-built region map.
 * Shared by buildMonolith (Vantage generation) and tools/reconcile-data.js (official
 * merge) so the on-disk format has exactly one definition. Region keys and instance
 * types are sorted so the output — and the split diff — stays stable.
 * @param {object} o
 * @param {"aws"|"azure"|"gcp"} o.name
 * @param {"AWS"|"AZURE"|"GCP"} o.prefix  window-global prefix
 * @param {string} o.source  header-comment source label
 * @param {string} o.dataDate  YYYY-MM-DD
 * @param {Object<string,Object<string,object>>} o.byRegion  { regionKey: { type: record } }
 * @returns {{ monolith:string, regionKeys:string[], instanceCount:number }}
 */
function serializeMonolith({ name, prefix, source, dataDate, byRegion }) {
  const fieldOrder = FIELD_ORDER[name];
  if (!fieldOrder) throw new Error(`unknown provider ${name}`);
  const regionKeys = Object.keys(byRegion).sort();
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
    const recs = byRegion[rk];
    const types = Object.keys(recs).sort();
    instanceCount += types.length;
    const body = types
      .map(
        (t) =>
          `  ${JSON.stringify(t)}: {\n${emitRecordBody(fieldOrder, recs[t])}\n  },`,
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

// { byType, byFamily } generations from the shipped Azure data. byType is exact per
// instance; byFamily is the family's most common generation, for new sizes.
//
// MUST go through loadCommittedRegions, never a private readdirSync over regions/.
// `generation` and `family` are SPECS: they live in the manifest's AZURE_SPECS, not in
// the region files. A private walk would see only the price half, find no numeric
// `generation` on any record, skip every one of them silently, and carry forward
// nothing — losing the one field the Vantage feed cannot reproduce, with no error and
// no empty-result symptom, because {} is a legitimate first-run value.
function collectAzureGeneration() {
  const byType = {};
  const familyCounts = {};
  for (const region of Object.values(loadCommittedRegions("azure"))) {
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
    byFamily[fam] = mostCommonGeneration(counts);
  }
  return { byType, byFamily };
}

// { generation: count } → the most common generation; a count tie breaks to the
// HIGHER generation (a newer size is likelier current than a stale carried value).
function mostCommonGeneration(counts) {
  return Number(
    Object.entries(counts).sort(
      (a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]),
    )[0][0],
  );
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
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`[${name}] fetch failed: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const only = argValue("--provider");
  const dataDate = resolveDataDate(argValue("--date"));
  const targets = PROVIDERS.filter((p) => !only || p.name === only);
  if (!targets.length) throw new Error(`unknown --provider ${only}`);

  // Fetch + build every target before writing any file: a mid-run failure must not
  // leave a partially-regenerated set. A clobbered manifest would break
  // readShippedRegionKeys on the next run until `git restore`.
  const built = [];
  for (const { name, prefix, source } of targets) {
    const shippedKeys = readShippedRegionKeys(name, prefix);
    const azureGen = name === "azure" ? collectAzureGeneration() : undefined;
    const instances = await fetchBulk(name);
    built.push({
      name,
      shippedKeys,
      ...buildMonolith({
        name,
        prefix,
        source,
        instances,
        shippedKeys,
        dataDate,
        azureGen,
      }),
    });
  }

  for (const {
    name,
    shippedKeys,
    monolith,
    regionKeys,
    instanceCount,
  } of built) {
    const out = monolithPath(name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    writeFileAtomic(out, monolith);
    const dropped = shippedKeys.length - regionKeys.length;
    console.log(
      `[${name}] wrote ${path.relative(ROOT, out)}: ${regionKeys.length}/${shippedKeys.length} ` +
        `shipped regions, ${instanceCount} records${dropped ? `, ${dropped} region(s) got no data` : ""}`,
    );
    console.log(`[${name}] next: node tools/split-data.js`);
  }
}

module.exports = {
  buildMonolith,
  serializeMonolith,
  instanceRegionRecords,
  collectAzureGeneration,
  mostCommonGeneration,
  readShippedRegionKeys,
  awsProcessor,
  azureFamilyName,
  azureProcessor,
  unmappedAzureAmdFamilies,
  AZURE_AMD_FAMILIES,
  gcpPlatform,
  isMappedGcpSeries,
  azureRegionKey,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

// App core: shared state, column mapping tables, data readiness,
// region validation, and the data watcher. Loads first — later modules
// reference these globals at runtime.

// Main script for Cloud Instance Recommender
// Core functionality that works across all cloud providers

// Global variables
let csvData = [];
let columnHeaders = [];
let selectedProviders = [];
let processedResults = null;

// Enhanced exclude types data - now references provider-specific data
const excludeTypesData = {
  aws: [], // Will be populated from aws-specific.js
  azure: [], // Will be populated from azure-specific.js
  gcp: [], // Will be populated from gcp-specific.js
};

// Instance families data - now references provider-specific data
const familyData = {
  aws: [], // Will be populated from aws-specific.js
  azure: [], // Will be populated from azure-specific.js
  gcp: [], // Will be populated from gcp-specific.js
};

// Hardcoded column mappings
const COLUMN_MAPPINGS = {
  cpu: "CPU Count",
  memory: "Memory (GB)",
  cpuUtilization: "CPU Utilization",
  memoryUtilization: "Memory Utilization",
  vmName: "VM Name",
  appName: "App Name",
  awsRegion: "AWS Region",
  azureRegion: "Azure Region",
  gcpRegion: "GCP Region",
};

// Header synonyms for auto-matching uploaded columns to the canonical names
// above. Keys are canonical names; values are normalized candidates
// (lowercased, non-alphanumerics stripped). Only these canonicals are
// mapped — ENV/OS/Workload/Compliance/Min Gen/Exclude are read literally.
const COLUMN_SYNONYMS = {
  "CPU Count": [
    "vcpu",
    "vcpus",
    "cpu",
    "cpus",
    "cores",
    "corecount",
    "cpucores",
    "numcpu",
    "numcpus",
    "processors",
    "processorcount",
  ],
  "Memory (GB)": [
    "ram",
    "ramgb",
    "mem",
    "memgb",
    "memory",
    "memorygb",
    "memorygib",
    "memorysize",
    "memorysizegb",
    "memorysizegib",
    // MB/MiB variants (common in RVTools-style exports) — values are
    // auto-converted to GB on ingest, see detectMemoryUnit()
    "memorymb",
    "memorymib",
    "memmb",
    "memmib",
    "rammb",
    "memorysizemb",
    "memorysizemib",
  ],
  "CPU Utilization": [
    "cpuutil",
    "cpuutilization",
    "cpupct",
    "cpupercent",
    "cpuusage",
    "avgcpu",
    "cpuavg",
    "maxcpu",
  ],
  "Memory Utilization": [
    "memutil",
    "memoryutil",
    "memutilization",
    "memoryutilization",
    "mempct",
    "memorypercent",
    "memusage",
    "memoryusage",
    "avgmemory",
    "memavg",
    "ramutil",
    "maxmemory",
  ],
  "VM Name": [
    "vmname",
    "servername",
    "hostname",
    "host",
    "name",
    "server",
    "machinename",
    "computername",
    "instancename",
  ],
  // Optional grouping column — VMs sharing an app can inherit a workload from
  // the app→workload map. Unusual headers (Business Unit, Portfolio, …) won't
  // auto-match, but can be mapped to "App Name" by hand in the mapping panel.
  "App Name": [
    "appname",
    "application",
    "applicationname",
    "app",
    "appid",
    "service",
    "servicename",
  ],
  "AWS Region": ["awsregion", "amazonregion"],
  "Azure Region": ["azureregion"],
  // "gcpzone" is intentional: zones ("us-central1-a") are the expected input
  // format for the GCP Region column — the factory default region is a zone,
  // and normalizeRegionForJS strips the zone suffix before region lookup
  "GCP Region": ["gcpregion", "googleregion", "googlecloudregion", "gcpzone"],
};

// The fields eligible for auto-matching and the mapping panel. Uploaded
// columns outside this list (ENV, OS, Workload, Compliance, Min Gen,
// Exclude, anything custom) always pass through literally.
const MAPPABLE_CANONICALS = Object.values(COLUMN_MAPPINGS);
const REQUIRED_CANONICALS = [COLUMN_MAPPINGS.cpu, COLUMN_MAPPINGS.memory];

// "App Name" is an optional mappable canonical (see COLUMN_MAPPINGS): it groups
// VMs by application. It is never required, and its synonyms auto-match like any
// other column; an unusually named column can be mapped to it by hand in the
// mapping panel. When present, VMs inherit a workload from the app→workload map
// (see the app mapping panel and resolveRowWorkload in the factory). Precedence
// for a row's workload: its own Workload cell > app→workload map > page default
// > built-in "General".
const APP_NAME_CANONICAL = COLUMN_MAPPINGS.appName;

// Workload vocabulary offered in the app→workload panel (matches the sample
// CSV's Workload values and the rule engine's WORKLOAD_FAMILIES keys).
const APP_WORKLOAD_OPTIONS = [
  "General",
  "Database",
  "Web Server",
  "Cache",
  "ML/AI",
  "Batch",
  "HPC",
  "SAP",
];

// The canonicals relevant on the current page: all provider-agnostic fields
// plus only the region columns of providers this page loads (no Azure/GCP
// Region rows in the mapping panel on the AWS page, etc.). Region columns of
// other providers pass through untouched — they're unused here anyway.
function pageCanonicals() {
  const allRegionCols = new Set(
    ["aws", "azure", "gcp"].map((p) =>
      InstanceSelectorFactory.getProviderRegionColumn(p),
    ),
  );
  const pageRegionCols = new Set(
    getPageProviders().map((p) =>
      InstanceSelectorFactory.getProviderRegionColumn(p),
    ),
  );
  return MAPPABLE_CANONICALS.filter(
    (c) => !allRegionCols.has(c) || pageRegionCols.has(c),
  );
}

// Initialize page
// ─── Data readiness + queue-and-auto-start ────────────────────────────────────
// Each provider manifest (js/{p}/{p}-data.js) sets window.{PROVIDER}_DATA_READY
// = true as its last line. READY means the region key list is known — instance
// data itself is lazy-loaded per region on demand (base-instance-selector
// _injectRegionScript). If the user clicks Generate before the manifest loads,
// we queue the request and auto-execute it the moment the data is confirmed ready.

const DATA_READY_FLAGS = {
  aws: "AWS_DATA_READY",
  azure: "AZURE_DATA_READY",
  gcp: "GCP_DATA_READY",
};
let _generateQueued = false;

// Cached pre-warmed selector instances — shared with instance-selector-factory.js via window
window._prewarmedSelectors = window._prewarmedSelectors || {};

function getPageProviders() {
  const scripts = Array.from(document.querySelectorAll("script[src]")).map(
    (s) => s.src,
  );
  return Object.keys(DATA_READY_FLAGS).filter((p) =>
    scripts.some((s) => s.includes(`${p}-data.js`)),
  );
}

function allDataReady(providers = getPageProviders()) {
  return providers.every((p) => window[DATA_READY_FLAGS[p]] === true);
}

function showDataToast(msg) {
  let toast = document.getElementById("dataToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "dataToast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.style.cssText = [
      "position:fixed",
      "bottom:24px",
      "left:50%",
      "transform:translateX(-50%)",
      "background:#1e293b",
      "color:#fff",
      "padding:10px 20px",
      "border-radius:8px",
      "font-size:0.88rem",
      "font-weight:500",
      "z-index:9999",
      "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
      "transition:opacity 0.4s",
    ].join(";");
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
}

function hideDataToast() {
  const toast = document.getElementById("dataToast");
  if (toast) {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }
}

let _watcherStarted = false;
let _preWarmStarted = false;

// Caches a selector instance per provider once its manifest is ready.
// Region data is no longer preloaded here — it is lazy-loaded on demand;
// prefetchCsvRegions() warms the regions an uploaded CSV actually uses.
function preWarmSelectors() {
  for (const provider of getPageProviders()) {
    if (!window[DATA_READY_FLAGS[provider]]) continue;
    if (window._prewarmedSelectors[provider]) continue;
    try {
      window._prewarmedSelectors[provider] =
        InstanceSelectorFactory.createSelector(provider);
      console.log(`[PreWarm] ${provider} selector cached`);
    } catch (e) {
      console.warn(`[PreWarm] ${provider} failed:`, e);
    }
  }
}

// Fire-and-forget prefetch of the region files referenced by the uploaded CSV,
// so data is usually parsed before the user clicks Generate. Correctness never
// depends on this — loadRegionData lazy-loads any region still missing.
// Skips regions that validateCsvRegions() already marked unknown.
function prefetchCsvRegions() {
  if (!csvData || !csvData.length) return;
  for (const provider of getPageProviders()) {
    if (window[DATA_READY_FLAGS[provider]] !== true) continue;
    try {
      const selector =
        window._prewarmedSelectors[provider] ||
        InstanceSelectorFactory.createSelector(provider);
      window._prewarmedSelectors[provider] = selector;
      const regionColumn =
        InstanceSelectorFactory.getProviderRegionColumn(provider);
      const regions = selector.extractUniqueRegions(csvData, regionColumn);
      const validation =
        window._regionValidation && window._regionValidation[provider];
      const toLoad = [...regions].filter(
        (r) => !validation || validation[r]?.status !== "unknown",
      );
      if (toLoad.length) {
        selector.loadInstanceData(toLoad).catch((e) => {
          console.warn(`[Prefetch] ${provider} failed:`, e);
        });
      }
    } catch (e) {
      console.warn(`[Prefetch] ${provider} failed:`, e);
    }
  }
}

// ─── Region validation (shown after CSV upload) ───────────────────────────────
// Resolves one raw CSV region string against a provider's manifest key list.
// exact  → provider-normalized key is in the manifest
// fuzzy  → unique manifest key found via _resolveManifestKey (e.g. AZ suffix)
// unknown→ no safe match; generation will fall back to built-in sample data
function resolveRegion(provider, raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { status: "unknown", key: null };
  try {
    const selector =
      window._prewarmedSelectors[provider] ||
      InstanceSelectorFactory.createSelector(provider);
    window._prewarmedSelectors[provider] = selector;
    const normalized = selector.normalizeRegionForJS(trimmed);

    const keys = window[`${provider.toUpperCase()}_REGION_KEYS`];
    if (!Array.isArray(keys)) {
      // Monolithic (pre-split) data file: no manifest, but every region
      // global is already parsed onto window — validate against those so
      // real regions aren't falsely flagged during a data-update window.
      return window[normalized]
        ? { status: "exact", key: normalized }
        : { status: "unknown", key: null };
    }

    if (keys.includes(normalized)) return { status: "exact", key: normalized };
    const resolved = selector.resolveManifestKey(normalized);
    return resolved
      ? { status: "fuzzy", key: resolved }
      : { status: "unknown", key: null };
  } catch {
    return { status: "unknown", key: null };
  }
}

// Manifest keys use underscores (AWS/GCP) or are already compact (Azure)
function formatRegionKey(provider, key) {
  return provider === "azure" ? key : String(key).replace(/_/g, "-");
}

// Validates every region string in the uploaded CSV against ALL page
// providers (multicloud checkboxes can change after upload) and renders the
// chip panel. Result is kept on window._regionValidation for later steps.
function validateCsvRegions() {
  const section = document.getElementById("regionValidationSection");
  window._regionValidation = null;
  if (!csvData || !csvData.length) {
    if (section) section.classList.add("hidden");
    return;
  }

  const validation = {};
  let hasAny = false;
  for (const provider of getPageProviders()) {
    if (window[DATA_READY_FLAGS[provider]] !== true) continue;
    const regionColumn =
      InstanceSelectorFactory.getProviderRegionColumn(provider);
    if (!columnHeaders.includes(regionColumn)) continue;
    const regions = new Set();
    csvData.forEach((row) => {
      const r = (row[regionColumn] || "").trim();
      if (r) regions.add(r);
    });
    if (!regions.size) continue;
    validation[provider] = {};
    for (const raw of regions) {
      validation[provider][raw] = resolveRegion(provider, raw);
    }
    hasAny = true;
  }

  window._regionValidation = hasAny ? validation : null;
  renderRegionValidation(validation, section);
}

function renderRegionValidation(validation, section) {
  if (!section) return;
  const providers = Object.keys(validation);
  if (!providers.length) {
    section.classList.add("hidden");
    return;
  }

  const CHIP_STYLES = {
    exact: "background: var(--success-bg); color: var(--success-text);",
    fuzzy: "background: var(--warning-bg); color: var(--warning-text);",
    unknown: "background: var(--danger-bg); color: var(--danger-text);",
  };
  const PROVIDER_LABELS = { aws: "AWS", azure: "Azure", gcp: "GCP" };
  const chipBase =
    "display: inline-block; padding: 2px 10px; margin: 2px 6px 2px 0; " +
    "border-radius: 12px; font-size: 12px; font-weight: 500;";

  let unknownCount = 0;
  const rows = providers
    .map((provider) => {
      const chips = Object.entries(validation[provider])
        .map(([raw, res]) => {
          let label;
          if (res.status === "exact") {
            label = `${escapeHtml(raw)} ✓`;
          } else if (res.status === "fuzzy") {
            label = `${escapeHtml(raw)} → ${escapeHtml(formatRegionKey(provider, res.key))}`;
          } else {
            unknownCount++;
            label = `${escapeHtml(raw)} ✗`;
          }
          return `<span style="${chipBase} ${CHIP_STYLES[res.status]}" title="${
            res.status === "unknown"
              ? "Region not recognized — rows using it will get sample data"
              : res.status === "fuzzy"
                ? "Resolved to the closest matching region"
                : "Region recognized"
          }">${label}</span>`;
        })
        .join("");
      return `<p style="margin: 4px 0;"><strong>${PROVIDER_LABELS[provider] || provider}:</strong> ${chips}</p>`;
    })
    .join("");

  const warning = unknownCount
    ? `<p style="margin: 6px 0 0; color: var(--danger-text);">❗ ${unknownCount} region name(s) not recognized — rows using them will get built-in sample data, not real instance data.</p>`
    : "";

  section.innerHTML = `
    <div class="stats-info">
      <p><strong>🌍 Region Check:</strong></p>
      ${rows}
      ${warning}
    </div>
  `;
  section.classList.remove("hidden");
}

function startPreWarm() {
  if (_preWarmStarted) return;
  _preWarmStarted = true;
  preWarmSelectors(); // fire-and-forget
}

// Watches for all provider data files to finish loading, then auto-fires any
// queued generate request. Only one watcher ever runs at a time.
function watchForDataThenRun(providers = getPageProviders()) {
  if (_watcherStarted) return;
  _watcherStarted = true;

  function onDataReady() {
    _watcherStarted = false;
    hideDataToast();
    startPreWarm();
    // Covers a CSV uploaded before the manifests finished loading
    validateCsvRegions();
    prefetchCsvRegions();
    if (_generateQueued) {
      _generateQueued = false;
      generateRecommendations();
    }
  }

  if (allDataReady(providers)) {
    onDataReady();
    return;
  }

  const timer = setInterval(() => {
    if (!allDataReady(providers)) return;
    clearInterval(timer);
    onDataReady();
  }, 500);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  // Percentile/peak utilization, optional and additive. Sizing against an
  // average silently undersizes a bursty VM: a box averaging 20% with a p95 of
  // 85% is not a downsize candidate, but the average alone says it is. Which
  // statistic drives sizing is a per-run choice (see UTILIZATION_STATISTICS).
  cpuUtilizationP95: "CPU Utilization p95",
  memoryUtilizationP95: "Memory Utilization p95",
  cpuUtilizationPeak: "CPU Utilization Peak",
  memoryUtilizationPeak: "Memory Utilization Peak",
  vmName: "VM Name",
  appName: "App Name",
  // Provisioned disk, carried through to the outputs and into the AWS bulk
  // template's storage field, which was shipping blank. Optional, and nothing
  // is derived from it: storage does not influence instance selection, so a
  // file without it behaves exactly as before.
  disk: "Disk (GB)",
  // The size a VM runs on TODAY (m5.xlarge, Standard_D4s_v3, n2-standard-4).
  // Optional, and carried through to the outputs untouched, so a recommendation
  // can be read against what it replaces. By default nothing is derived from it;
  // in cloud-to-cloud mode (3.13) a row with no CPU/Memory has its specs DERIVED
  // from this column instead, which is what makes cross-provider sizing possible.
  currentInstance: "Current Instance Type",
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
    "meancpu",
    "cpumean",
  ],
  "CPU Utilization p95": [
    "cpup95",
    "p95cpu",
    "cpu95",
    "95cpu",
    "cpup95util",
    "cpupercentile95",
    "cpu95thpercentile",
  ],
  // "maxcpu" used to be a synonym for the AVERAGE column, so a peak reading
  // drove sizing while being labelled an average. It belongs here.
  "CPU Utilization Peak": [
    "maxcpu",
    "cpumax",
    "peakcpu",
    "cpupeak",
    "cpumaximum",
    "maxcpuutil",
    "cpumaxutil",
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
    "meanmemory",
    "memorymean",
  ],
  "Memory Utilization p95": [
    "memp95",
    "memoryp95",
    "p95memory",
    "p95mem",
    "memory95",
    "mem95",
    "memorypercentile95",
  ],
  "Memory Utilization Peak": [
    "maxmemory",
    "memorymax",
    "memmax",
    "peakmemory",
    "memorypeak",
    "mempeak",
    "maxmemoryutil",
  ],
  // MB/MiB variants convert to GB on ingest exactly as memory does — RVTools
  // reports "Provisioned MiB", and treating that as GB would overstate every
  // disk by 1024x.
  //
  // Bare generic words — "storage", "provisioned", "capacity" — are deliberately
  // NOT here. No other canonical shares them, so a header that normalizes to one
  // of those matches silently (it never trips the ambiguous-column review), and a
  // column literally named "Capacity" that has nothing to do with disk would flow
  // straight into the AWS bulk export's storage field undetected. Only the
  // disk-qualified forms (storagegb, provisionedstorage, capacitygb, …) and the
  // unambiguous "disk" are kept; a truly generic header goes to the mapping panel.
  "Disk (GB)": [
    "disk",
    "diskgb",
    "diskgib",
    "disksize",
    "disksizegb",
    "storagegb",
    "storagesize",
    "provisionedgb",
    "provisionedstorage",
    "totaldisk",
    "totaldiskgb",
    "totalstorage",
    "capacitygb",
    "diskmb",
    "diskmib",
    "disksizemb",
    "disksizemib",
    "storagemb",
    "storagemib",
    "provisionedmb",
    "provisionedmib",
    "capacitymb",
    "capacitymib",
  ],
  "VM Name": [
    "vmname",
    // "vm" is what RVTools calls the guest. Without it, a vInfo sheet matched
    // only "Host" — the ESXi box — and every guest on a hypervisor silently
    // took that hypervisor's name. With both present the match is ambiguous
    // and the file stops to ask, unless an import preset settles it.
    "vm",
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
  // Deliberately narrow. A bare "Size", "Type" or "SKU" means too many things in
  // an inventory export (disk size, VM type, licence SKU) to claim as the
  // current instance; those can still be mapped by hand in the panel.
  "Current Instance Type": [
    "currentinstancetype",
    "currentinstance",
    "currentsize",
    "currenttype",
    "currentvmsize",
    "instancetype",
    "vmsize",
    "machinetype",
    "existinginstancetype",
    "sourceinstancetype",
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

// Deliberately NOT the toast stack below. This is a single, persistent status
// pill for one thing — "the region data is still loading" — that stays up until
// the data arrives and is then dismissed by code (hideDataToast). Toasts are
// transient, stack, and are dismissed by the user or a timer. Folding this into
// them would mean a message with no expiry sitting in a queue of ones that have.
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

// ─── Toasts ───────────────────────────────────────────────────────────────────
// Replaces window.alert for everything the app tells the user: alert() is
// unstyled, ignores the theme, blocks the page, and reads out the origin. These
// render into the #toastStack placeholder, which is an aria-live region so a
// screen reader announces each new message.
//
// Rendered as innerHTML into an existing container (rather than built with
// createElement) to match how every other panel here works.

const TOAST_TONES = {
  info: { icon: "ℹ️", color: "var(--primary)" },
  success: { icon: "✅", color: "var(--good-strong)" },
  warning: { icon: "⚠️", color: "var(--amber-strong)" },
  error: { icon: "❌", color: "var(--red-strong)" },
};

const _toasts = [];
let _toastSeq = 0;

function renderToasts() {
  const stack = document.getElementById("toastStack");
  if (!stack) return;

  if (!_toasts.length) {
    stack.innerHTML = "";
    stack.classList.add("hidden");
    return;
  }

  stack.innerHTML = _toasts
    .map((toast) => {
      const tone = TOAST_TONES[toast.type] || TOAST_TONES.info;
      return `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border-soft);border-left:4px solid ${tone.color};border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.18);font-size:0.9rem;line-height:1.4;">
          <span aria-hidden="true">${tone.icon}</span>
          <span style="flex:1;">${escapeHtml(toast.message)}</span>
          <button type="button" onclick="dismissToast(${toast.id})" aria-label="Dismiss notification" style="border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;line-height:1;padding:0 2px;">×</button>
        </div>`;
    })
    .join("");
  stack.classList.remove("hidden");
}

// type: info | success | warning | error. duration 0 keeps it until dismissed.
function showToast(message, type = "info", duration = 6000) {
  const id = ++_toastSeq;
  _toasts.push({ id, message: String(message), type });
  renderToasts();
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

function dismissToast(id) {
  const index = _toasts.findIndex((t) => t.id === Number(id));
  if (index === -1) return;
  _toasts.splice(index, 1);
  renderToasts();
}
window.dismissToast = dismissToast;

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
    // Null-prototype accumulator: the keys are CSV region names, so a cell that
    // normalizes to "__proto__" would otherwise hit the prototype setter (the
    // value is an object) and drop the region from the panel. No global pollution
    // either way, but this matches the repo's safeMapGet / RESERVED_PRESET_NAMES
    // stance — untrusted keys never touch a live prototype.
    validation[provider] = Object.create(null);
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

// ─── Export filenames ─────────────────────────────────────────────────────────
// Every generated download is named `<base>_<YYYY-MM-DD>.<ext>` so a folder of
// them sorts and dedupes sensibly. The stamp is the user's LOCAL date: an
// evening export in a UTC+ timezone would otherwise be labelled tomorrow.
// (Sample templates are inputs, not outputs, and keep their fixed names.)
function exportDateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function exportFilename(base, extension) {
  return `${base}_${exportDateStamp()}.${extension}`;
}

// Shared CSV cell escaping (quotes + formula-injection hardening). Defined here,
// with downloadCsv / exportFilename, so the preview, the result/no-match
// downloads, and the scenario-comparison export all quote cells identically —
// one guard, not several that could drift.
// A plain negative number opens with the same "-" the guard watches for, but it
// cannot be a formula — and prefixing it makes Excel import it as TEXT, silently
// breaking any sum or formula the user builds on the export. Every input column
// is spread into each result row (`const result = { ...row }`), so a user's own
// negative column really does reach the file. Exempt only a complete numeric
// literal: "-1+1", "-cmd", "-1e5" and a bare "-" are all still hardened.
const CSV_FORMULA_START = /^[=+\-@|\t\r]/;
const CSV_PLAIN_NUMBER = /^-\d+(\.\d+)?$/;
function escapeCsvCell(val) {
  const s = String(val == null ? "" : val);
  const needsHardening = CSV_FORMULA_START.test(s) && !CSV_PLAIN_NUMBER.test(s);
  const safe = needsHardening ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// Byte-order mark. Excel assumes a CSV is in the local ANSI codepage unless the
// file starts with one, so without it a VM or application named "München" or
// "日本" opens as mojibake — the single most common complaint about CSV exports.
// Other tools ignore it.
const UTF8_BOM = "﻿";

// The one place a CSV becomes a download. Every CSV export goes through here so
// they cannot drift apart on encoding or on the object-URL cleanup.
//
// `bom: false` for files another PROGRAM reads rather than a person: the AWS
// Pricing Calculator's bulk import parses the header row, and a BOM turns the
// first header into "﻿Service Name". The BOM exists for Excel's benefit,
// and Excel is not the consumer there.
function downloadCsv(csvContent, filename, { bom = true } = {}) {
  const blob = new Blob([(bom ? UTF8_BOM : "") + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking synchronously after click() intermittently kills the download in
  // Firefox and WebKit — the browser hasn't finished reading the blob yet. Yield
  // first. This is the single choke point for every CSV export, so one deferred
  // revoke fixes them all.
  setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

// ─── Shared result-set primitives ─────────────────────────────────────────────
// Defined here (every page loads app-core.js first) so the stats bar, the
// preview table, the CSV/no-match/app exports, and the App Portfolio page all
// agree on what "no match" means and which columns are recommendations.

// Sentinel values a recommendation cell holds when nothing matched.
const NO_MATCH_VALUES = new Set([
  "No data available",
  "Missing data",
  "Error",
  "No utilization data",
]);
function isNoMatchValue(v) {
  return !v || NO_MATCH_VALUES.has(String(v)) || String(v).startsWith("No ");
}

// The recommendation ("instance") columns present in a result set — derived
// from the results so it handles L2L-only, optimized-only, and any provider
// combination.
function getInstanceColumns(results) {
  if (!results || !results.length) return [];
  return Object.keys(results[0]).filter(
    (k) =>
      k.includes("Like-to-Like Instance") || k.includes("Optimized Instance"),
  );
}

// A row is a "no match" when it has recommendation columns and EVERY one of them
// is a no-match placeholder. One definition, so the red row highlight, the
// no-match-only view filter, the no-match export, and the relax suggestion all
// agree on which rows are unmatched — a row that is red must be the same row the
// filter keeps and the export writes.
function rowIsAllNoMatch(row, instanceCols) {
  return (
    instanceCols.length > 0 && instanceCols.every((c) => isNoMatchValue(row[c]))
  );
}

// How a result set scored, by the SAME predicate the red row highlight, the
// no-match view and the no-match export use: a row counts as matched when it is
// not all-no-match. One definition, because "match rate" appears in two places —
// the generation stats bar and the scenario comparison — and a run whose rate
// reads 94% on one screen and 100% on another is telling the user two different
// things about the same data.
//
// `rate` is null when the results carry no recommendation columns: there is no
// rate to report, and 0% would read as "nothing matched".
function matchStats(results) {
  const total = results && results.length ? results.length : 0;
  const cols = getInstanceColumns(results || []);
  if (!total || !cols.length) {
    return { matched: 0, total, rate: null, hasRecommendations: !!cols.length };
  }
  const matched = results.filter((r) => !rowIsAllNoMatch(r, cols)).length;
  return {
    matched,
    total,
    rate: Math.round((matched / total) * 100),
    hasRecommendations: true,
  };
}

// Sorts rows by one column, numerically when both values parse as numbers.
// Mutates and returns `rows` — callers pass a copy when they need one.
function sortResultRows(rows, column, direction) {
  return rows.sort((a, b) => {
    const av = a[column] ?? "";
    const bv = b[column] ?? "";
    const an = parseFloat(av);
    const bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) return (an - bn) * direction;
    return String(av).localeCompare(String(bv)) * direction;
  });
}

// The result set as an export should see it: in the preview's current SORT
// order, so a downloaded file is ordered the way the user last arranged it on
// screen — but never narrowed by the preview's search FILTER, because a
// download is always the complete result set. (The preview's count line says so
// whenever a filter is active, so the two cannot silently disagree.)
function resultsInPreviewOrder(results) {
  const state = typeof window !== "undefined" && window._previewState;
  if (!state || state.sortCol === null || !results || !results.length) {
    return results;
  }
  const column = state.displayCols && state.displayCols[state.sortCol];
  if (!column || !(column in results[0])) return results;
  return sortResultRows([...results], column, state.sortDir);
}

// ─── Sizing savings ───────────────────────────────────────────────────────────
// What the optimized sizing actually bought, per provider. Never aggregated
// across providers: the same VM appears once per provider, so a combined total
// would count the same saving two or three times over.
//
// The baseline is the like-for-like recommendation when the run produced one —
// that is the honest comparison, since it is what you would have deployed
// without optimizing. On an optimized-only run there is nothing to compare
// against but the VM's current size, so that is used and labelled as such.
function computeSizingSavings(results) {
  if (!results || !results.length) return [];
  const keys = Object.keys(results[0]);
  const providers = keys
    .filter((k) => k.endsWith(" Optimized Instance"))
    .map((k) => k.replace(" Optimized Instance", ""));

  const savings = [];
  providers.forEach((provider) => {
    const optInstance = `${provider} Optimized Instance`;
    const optCpu = `${provider} Optimized vCPUs`;
    const optMem = `${provider} Optimized Memory (GiB)`;
    const baseInstance = `${provider} Like-to-Like Instance`;
    const baseCpu = `${provider} Like-to-Like vCPUs`;
    const baseMem = `${provider} Like-to-Like Memory (GiB)`;
    const againstLikeForLike = keys.includes(baseCpu);

    let vcpus = 0;
    let memory = 0;
    // The absolute before/after totals, alongside the net delta — a before→after
    // chart needs the two endpoints, not just their difference. Summed over the
    // same rows and the same baseline, so beforeVcpus − afterVcpus === vcpus.
    let beforeVcpus = 0;
    let afterVcpus = 0;
    let beforeMemory = 0;
    let afterMemory = 0;
    let rows = 0;

    results.forEach((row) => {
      if (isNoMatchValue(row[optInstance])) return;
      const toCpu = parseFloat(row[optCpu]);
      const toMem = parseFloat(row[optMem]);

      let fromCpu;
      let fromMem;
      if (againstLikeForLike) {
        // Only rows the like-for-like pass also matched can be compared
        if (isNoMatchValue(row[baseInstance])) return;
        fromCpu = parseFloat(row[baseCpu]);
        fromMem = parseFloat(row[baseMem]);
      } else {
        fromCpu = parseFloat(row[COLUMN_MAPPINGS.cpu]);
        fromMem = parseFloat(row[COLUMN_MAPPINGS.memory]);
      }

      if ([toCpu, toMem, fromCpu, fromMem].some((n) => isNaN(n))) return;
      vcpus += fromCpu - toCpu;
      memory += fromMem - toMem;
      beforeVcpus += fromCpu;
      afterVcpus += toCpu;
      beforeMemory += fromMem;
      afterMemory += toMem;
      rows++;
    });

    if (rows > 0 && (vcpus !== 0 || memory !== 0)) {
      const round = (n) => Math.round(n * 10) / 10;
      savings.push({
        provider,
        vcpus: round(vcpus),
        memory: round(memory),
        beforeVcpus: round(beforeVcpus),
        afterVcpus: round(afterVcpus),
        beforeMemory: round(beforeMemory),
        afterMemory: round(afterMemory),
        rows,
        baseline: againstLikeForLike ? "like-for-like" : "current size",
      });
    }
  });

  return savings;
}

// ─── Fit / headroom ───────────────────────────────────────────────────────────
// How much spare capacity a like-for-like recommendation leaves over the size
// that was requested. Instances come in fixed vCPU:RAM ratios, so matching a
// workload whose own ratio differs forces extra capacity on one axis — that
// excess is the headroom, and a large one flags an over-provisioned match (a
// requirement of 14 vCPU / 8 GB lands on a box with 32 GB: 300% memory
// headroom, not because the box is wrong but because nothing smaller had the
// cores).
//
// Only meaningful for the like-for-like recommendation, whose requirement is
// exactly the requested CPU Count / Memory (GB). The optimized recommendation is
// sized against utilization instead — deliberately smaller — and its rightsizing
// is shown by the vCPU diff, not here. Returns null when the numbers to compare
// are not both present (a no-match row has no vCPUs/Memory to read).
//
// Compared the way the ENGINE compares — instance GiB against requested GB
// directly, the ~7% unit difference well below the flag threshold — so the flag
// never contradicts the match the engine actually made.
function computeFitHeadroom(row, provider) {
  const reqCpu = parseFloat(row[COLUMN_MAPPINGS.cpu]);
  const reqMem = parseFloat(row[COLUMN_MAPPINGS.memory]);
  const instCpu = parseFloat(row[`${provider} Like-to-Like vCPUs`]);
  const instMem = parseFloat(row[`${provider} Like-to-Like Memory (GiB)`]);
  if ([reqCpu, reqMem, instCpu, instMem].some((n) => isNaN(n))) return null;
  if (reqCpu <= 0 || reqMem <= 0) return null;

  const cpu = (instCpu - reqCpu) / reqCpu;
  const mem = (instMem - reqMem) / reqMem;
  // The binding axis is the tighter fit; the other carries the waste. Report the
  // worse (larger) of the two as the headroom that flags over-provisioning.
  const worst = Math.max(cpu, mem);
  return {
    cpu,
    mem,
    worst,
    axis: cpu >= mem ? "vCPU" : "memory",
    reqCpu,
    reqMem,
    instCpu,
    instMem,
  };
}

// Workload shape — the memory-per-vCPU ratio of the SOURCE VM, sorted into the
// same three buckets the instance families themselves fall into, so a
// recommendation can say WHY a family fits rather than only that it did: a box
// carrying a lot of RAM per core is memory-optimized work and belongs on an
// r/E/M-family; a lean-RAM box is compute-optimized and belongs on a c/F/C2-
// family; everything between is general. Provider-agnostic on purpose — it reads
// only the provisioned CPU Count / Memory (GB), never any provider's instance —
// so the App Portfolio family-mix rollup (a later minor) can classify the same
// rows from the same numbers. Returns null when either figure is missing or
// non-positive (a row with nothing to classify), never a guessed bucket.
//
// The boundaries are inclusive and pinned by the suite: <=2.5 GB/vCPU is
// compute-optimized, >=6 is memory-optimized. They bracket the general band the
// mainline families sit in (~4 GB/vCPU) with clear room either side before a row
// is called one shape or the other.
const WORKLOAD_SHAPE_COMPUTE_MAX = 2.5;
const WORKLOAD_SHAPE_MEMORY_MIN = 6;
function classifyWorkloadShape(cpu, mem) {
  // Strict numeric conversion, not parseFloat: parseFloat("4junk") is 4 and
  // parseFloat("Infinity") is Infinity, both of which would pass a bare isNaN
  // check and hand back a shape for a value the contract calls invalid. Number()
  // rejects the trailing-garbage case, and Number.isFinite rejects Infinity.
  const c = Number(cpu);
  const m = Number(mem);
  if (!Number.isFinite(c) || !Number.isFinite(m) || c <= 0 || m <= 0)
    return null;
  const ratio = m / c;
  const shape =
    ratio <= WORKLOAD_SHAPE_COMPUTE_MAX
      ? "compute"
      : ratio >= WORKLOAD_SHAPE_MEMORY_MIN
        ? "memory"
        : "general";
  return { shape, ratio };
}

// ─── Nearest-miss "relax" suggestion ──────────────────────────────────────────
// The engine already works out, per unmatched row, which soft-filter group kept
// the otherwise-fitting instance out ("Nearest Miss" column). This turns that
// into an action: the ONE filter that, switched off, rescues the most rows.
//
// Each probe label maps to the checkbox that turns that group off, and to the
// handler that hides its sub-panel (both in form-controls.js).
const RELAX_CONTROLS = {
  "current-generation only": {
    id: "currentGenerationOnly",
    toggle: "toggleCurrentGenerationFilter",
  },
  "instance-family name": {
    id: "restrictInstanceFamilyNames",
    toggle: "toggleInstanceFamilyNameFilter",
  },
  "processor manufacturer": {
    id: "restrictProcessorManufacturers",
    toggle: "toggleProcessorManufacturerFilter",
  },
  "instance family/series": {
    id: "restrictMainFamilies",
    toggle: "toggleMainFamiliesFilter",
  },
  "exclude types": { id: "excludeTypes", toggle: "toggleExcludeTypes" },
};

// "m7i.large (2 vCPU / 8 GB) — relax: current-generation only, exclude types"
// → ["current-generation only", "exclude types"]. The format is ours (see
// formatNearestMiss in instance-selector-factory.js), so parsing it back is safe.
function parseRelaxLabels(cell) {
  const parts = String(cell || "").split(" — relax: ");
  if (parts.length < 2) return [];
  return parts[1]
    .split(", ")
    .map((s) => s.trim())
    .filter(Boolean);
}

// The single filter change that rescues the most fully-unmatched rows, or null.
//
// A row counts toward a label only when SOME provider's nearest miss is blocked
// by that label ALONE. A miss blocked by two groups is not rescued by relaxing
// one of them, so counting it would promise a rescue that never arrives.
function computeRelaxSuggestion(results) {
  if (!results || !results.length) return null;
  const instanceCols = getInstanceColumns(results);
  const missCols = Object.keys(results[0]).filter((k) =>
    k.includes("Nearest Miss"),
  );
  if (!instanceCols.length || !missCols.length) return null;

  const unmatched = results.filter((row) => rowIsAllNoMatch(row, instanceCols));
  if (!unmatched.length) return null;

  const rescues = new Map();
  unmatched.forEach((row) => {
    const rescuers = new Set();
    missCols.forEach((col) => {
      const labels = parseRelaxLabels(row[col]);
      if (labels.length === 1) rescuers.add(labels[0]);
    });
    rescuers.forEach((label) =>
      rescues.set(label, (rescues.get(label) || 0) + 1),
    );
  });

  let best = null;
  rescues.forEach((count, label) => {
    if (RELAX_CONTROLS[label] && (!best || count > best.count)) {
      best = { label, count };
    }
  });
  if (!best) return null;

  return {
    label: best.label,
    rescues: best.count,
    unmatched: unmatched.length,
    control: RELAX_CONTROLS[best.label],
  };
}

// localStorage key for the App Portfolio handoff copy (written by
// downloads.js#openAppPortfolio, read by portfolio.js).
const PORTFOLIO_STORAGE_KEY = "cloudInstanceRecommenderPortfolioData";

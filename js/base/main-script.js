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
  awsRegion: "AWS Region",
  azureRegion: "Azure Region",
  gcpRegion: "GCP Region",
};

// Header synonyms for auto-matching uploaded columns to the canonical names
// above. Keys are canonical names; values are normalized candidates
// (lowercased, non-alphanumerics stripped). Only these 8 canonicals are
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

// ─── Sticky floating Generate button ──────────────────────────────────────────
function setupStickyGenerate() {
  const originalBtn = document.querySelector(".generate-btn");
  if (!originalBtn) return;

  const bar = document.createElement("div");
  bar.id = "_stickyGenerateBar";
  bar.innerHTML = `<button class="btn btn-primary" onclick="generateRecommendations()" style="padding:10px 32px;font-size:1rem;box-shadow:0 4px 12px rgba(0,0,0,0.15);">🔄 Generate Recommendations</button>`;
  Object.assign(bar.style, {
    position: "fixed",
    bottom: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "999",
    display: "none",
    pointerEvents: "auto",
  });
  document.body.appendChild(bar);

  const observer = new IntersectionObserver(
    ([entry]) => {
      bar.style.display = entry.isIntersecting ? "none" : "block";
    },
    { threshold: 0.1 },
  );
  observer.observe(originalBtn);
}

document.addEventListener("DOMContentLoaded", function () {
  console.log("Initializing Cloud Instance Recommender with Modular Selectors");

  // Keyboard + screen-reader affordances for interactive elements
  enhanceAccessibility();

  // Sticky floating generate button
  setupStickyGenerate();

  // Start watching for data readiness; auto-fires any queued generate request
  watchForDataThenRun();

  // Load provider-specific data if available
  loadProviderSpecificData();

  // Check if modular selector system is available
  if (typeof InstanceSelectorFactory !== "undefined") {
    console.log("✅ Modular Instance Selector System detected");
    console.log(
      "Supported providers:",
      InstanceSelectorFactory.getSupportedProviders(),
    );
  } else {
    console.warn(
      "⚠️ Modular Instance Selector System not found. Please include the selector files.",
    );
  }

  // Add file upload event handler
  const fileInput = document.getElementById("csvFile");
  if (fileInput) {
    fileInput.addEventListener("change", handleFileUpload);
  }

  // Initialize range inputs
  updateCpuRanges();
  updateMemoryRanges();

  // Load usage statistics
  loadUsageStatistics();

  // Initialize optimization controls
  toggleOptimizationMode();

  // Initialize ALL provider filter controls
  initializeAllProviderFilters();

  // Initialize recommendation type handlers
  initializeRecommendationTypeHandlers();
});

// Initialize all provider filter controls
function initializeAllProviderFilters() {
  console.log("Initializing all provider filter controls");

  // Initialize AWS filter controls (if AWS-specific functions are available)
  if (typeof initializeAWSFilters !== "undefined") {
    try {
      initializeAWSFilters();
      console.log("✅ AWS filters initialized");
    } catch (error) {
      console.error("❌ Error initializing AWS filters:", error);
    }
  }

  // Initialize Azure filter controls (if Azure-specific functions are available)
  if (typeof initializeAzureFilters !== "undefined") {
    try {
      initializeAzureFilters();
      console.log("✅ Azure filters initialized");
    } catch (error) {
      console.error("❌ Error initializing Azure filters:", error);
    }
  }

  // Initialize GCP filter controls (if GCP-specific functions are available)
  if (typeof initializeGCPFilters !== "undefined") {
    try {
      initializeGCPFilters();
      console.log("✅ GCP filters initialized");
    } catch (error) {
      console.error("❌ Error initializing GCP filters:", error);
    }
  }
}

// Load provider-specific data
function loadProviderSpecificData() {
  // Load AWS data if available
  if (typeof awsExcludeTypesData !== "undefined") {
    excludeTypesData.aws = awsExcludeTypesData;
  }
  if (typeof awsFamilyData !== "undefined") {
    familyData.aws = awsFamilyData;
  }

  // Load Azure data if available
  if (typeof azureExcludeTypesData !== "undefined") {
    excludeTypesData.azure = azureExcludeTypesData;
  }
  if (typeof azureFamilyData !== "undefined") {
    familyData.azure = azureFamilyData;
  }

  // Load GCP data if available
  if (typeof gcpExcludeTypesData !== "undefined") {
    excludeTypesData.gcp = gcpExcludeTypesData;
  }
  if (typeof gcpFamilyData !== "undefined") {
    familyData.gcp = gcpFamilyData;
  }

  console.log("Loaded provider-specific data:", {
    aws: excludeTypesData.aws.length + " exclude types",
    azure: excludeTypesData.azure.length + " exclude types",
    gcp: excludeTypesData.gcp.length + " exclude types",
  });
}

// Initialize recommendation type handlers
function initializeRecommendationTypeHandlers() {
  const recommendationTypeInputs = document.querySelectorAll(
    'input[name="recommendationType"]',
  );
  recommendationTypeInputs.forEach((input) => {
    input.addEventListener("change", handleRecommendationTypeChange);
  });

  // Trigger initial setup
  handleRecommendationTypeChange();
}

// Toggle section collapse
function toggleSection(header) {
  const section = header.parentElement;
  section.classList.toggle("collapsed");
  header.setAttribute(
    "aria-expanded",
    section.classList.contains("collapsed") ? "false" : "true",
  );
}

// Makes the clickable-div section headers keyboard-operable and wires the
// dynamic status areas as live regions. Runs once on DOMContentLoaded.
function enhanceAccessibility() {
  document.querySelectorAll(".section-header[onclick]").forEach((header) => {
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    const section = header.parentElement;
    header.setAttribute(
      "aria-expanded",
      section && section.classList.contains("collapsed") ? "false" : "true",
    );
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        header.click();
      }
    });
  });

  const fileStatus = document.getElementById("fileStatus");
  if (fileStatus) fileStatus.setAttribute("aria-live", "polite");
  const progressText = document.getElementById("progressText");
  if (progressText) progressText.setAttribute("aria-live", "polite");
}

// Download sample CSV
function downloadSampleCSV() {
  const csvContent = `VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region,ENV,OS,Workload,Compliance,Min Gen
web-server-01,4,16,45,60,us-east-1,East US,us-central1-a,Production,Linux,Web Server,,
db-server-02,8,32,70,80,us-west-2,West US 2,us-west1-b,Production,Windows,Database,PCI,
app-server-03,2,8,35,45,eu-west-1,North Europe,europe-west1-c,Dev,Linux,General,,
cache-server-04,2,4,25,30,us-east-1,East US,us-central1-a,Staging,Linux,Cache,,
api-server-05,4,8,65,55,us-west-1,West US,us-west1-b,Production,Linux,Web Server,,6
microservice-06,1,2,15,20,us-east-1,East US,us-central1-a,Dev,Linux,General,,
worker-node-07,8,16,85,75,us-west-2,West US 2,us-west1-b,Production,Linux,ML/AI,HIPAA,7
frontend-08,2,4,40,50,eu-west-1,North Europe,europe-west1-c,Staging,Windows,Web Server,,`;

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "sample_instance_data.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Handle file upload using the integrated file handler
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  console.log("File upload started:", file.name);

  // Use the integrated file handler if available
  if (window.integrationManager && window.integrationManager.isReady) {
    // Let the FileHandlerIntegration handle it
    return;
  }

  ingestFile(file);
}

// Loads the vendored SheetJS parser on first use only (Excel uploads are
// rare enough that the ~900KB script shouldn't be part of page load)
function ensureXlsxLoaded() {
  if (window.XLSX) return Promise.resolve();
  if (!window._xlsxLoadPromise) {
    window._xlsxLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "js/vendor/xlsx.full.min.js";
      script.onload = () => resolve();
      script.onerror = () => {
        window._xlsxLoadPromise = null;
        reject(
          new Error("Could not load the Excel parser (js/vendor/xlsx.full.min.js)"),
        );
      };
      document.head.appendChild(script);
    });
  }
  return window._xlsxLoadPromise;
}

// Routes an uploaded file into the pipeline: .xlsx via SheetJS (first sheet
// only), everything else as CSV text
async function ingestFile(file) {
  window._uploadNote = null;

  if (!/\.xlsx$/i.test(file.name)) {
    const reader = new FileReader();
    reader.onload = function (e) {
      parseCSV(e.target.result);
    };
    reader.onerror = function () {
      const fileStatus = document.getElementById("fileStatus");
      if (fileStatus) {
        fileStatus.className = "alert alert-warning";
        fileStatus.innerHTML = `⚠️ Could not read the file "${escapeHtml(file.name)}". Please try again.`;
        fileStatus.classList.remove("hidden");
      }
    };
    reader.readAsText(file);
    return;
  }

  try {
    const MAX_XLSX_SIZE = 10 * 1024 * 1024; // same limit as the CSV path
    if (file.size === 0) throw new Error("File is empty");
    if (file.size > MAX_XLSX_SIZE) {
      throw new Error("File size too large. Maximum allowed size is 10MB.");
    }
    const buffer = await file.arrayBuffer();
    await ensureXlsxLoaded();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("The workbook has no sheets");

    // raw:false → formatted strings, matching what CSV parsing produces
    const rows2d = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    if (!rows2d.length) throw new Error(`Sheet "${sheetName}" is empty`);

    const headers = rows2d[0].map((h) => String(h).trim());
    const rows = rows2d
      .slice(1)
      .map((values) => {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = String(values[index] ?? "").trim();
        });
        return row;
      })
      .filter((row) => Object.values(row).some((v) => v !== ""));

    if (workbook.SheetNames.length > 1) {
      // Surfaced in the file status by applyIngest — not just the console
      window._uploadNote = `Workbook has ${workbook.SheetNames.length} sheets — only the first ("${sheetName}") was used`;
    }
    ingestRows(headers, rows);
  } catch (error) {
    console.error("Excel parsing failed:", error);
    const fileStatus = document.getElementById("fileStatus");
    if (fileStatus) {
      fileStatus.className = "alert alert-warning";
      fileStatus.innerHTML = `⚠️ Could not read the Excel file: ${escapeHtml(error.message)}`;
      fileStatus.classList.remove("hidden");
    }
  }
}

// Parse CSV text into headers + row objects, then hand off to ingestRows
// (which owns column mapping and everything downstream — the xlsx path
// feeds ingestRows directly)
function parseCSV(csvText) {
  console.log("Parsing CSV data");
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
  ingestRows(headers, rows);
}

// ─── Column mapping ───────────────────────────────────────────────────────────
function normalizeHeader(header) {
  return String(header)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function headerSignature(headers) {
  return headers
    .map((h) => String(h).trim().toLowerCase())
    .sort()
    .join("|");
}

// Matches uploaded headers to the 8 canonical COLUMN_MAPPINGS names.
// Per canonical, candidates come from: exact (case-insensitive) → normalized
// equality → synonym table. A bare "Region" column counts as the page's
// provider region on single-provider pages only.
// Returns { mapping (source→canonical), renames, unmatchedRequired,
// ambiguous, needsReview }.
function autoMatchHeaders(headers) {
  const canonicals = MAPPABLE_CANONICALS;
  const required = REQUIRED_CANONICALS;
  const providers = getPageProviders();
  const claimed = new Set();
  const mapping = {};
  const ambiguous = [];
  const unmatchedRequired = [];

  for (const canonical of canonicals) {
    const canonNorm = normalizeHeader(canonical);
    const synonyms = COLUMN_SYNONYMS[canonical] || [];
    const candidates = headers.filter((h) => {
      if (claimed.has(h)) return false;
      const norm = normalizeHeader(h);
      if (h.toLowerCase() === canonical.toLowerCase()) return true;
      if (norm === canonNorm) return true;
      if (synonyms.includes(norm)) return true;
      // Bare "Region": unambiguous only when the page has one provider
      if (
        norm === "region" &&
        providers.length === 1 &&
        canonical ===
          InstanceSelectorFactory.getProviderRegionColumn(providers[0])
      ) {
        return true;
      }
      return false;
    });

    if (candidates.length === 1) {
      mapping[candidates[0]] = canonical;
      claimed.add(candidates[0]);
    } else if (candidates.length > 1) {
      // Includes the collision case: literal canonical AND a synonym both
      // present — never guess silently
      ambiguous.push({ canonical, candidates });
    } else if (required.includes(canonical)) {
      unmatchedRequired.push(canonical);
    }
  }

  const renames = Object.entries(mapping)
    .filter(([source, canonical]) => source !== canonical)
    .map(([source, canonical]) => ({ from: source, to: canonical }));

  return {
    mapping,
    renames,
    unmatchedRequired,
    ambiguous,
    needsReview: ambiguous.length > 0 || unmatchedRequired.length > 0,
  };
}

function rewriteRowKeys(rows, mapping) {
  const hasRename = Object.entries(mapping).some(([s, c]) => s !== c);
  if (!hasRename) return rows;
  return rows.map((row) => {
    const out = {};
    Object.keys(row).forEach((key) => {
      out[mapping[key] || key] = row[key];
    });
    return out;
  });
}

// Saved mappings: { headerSignature: { sourceHeader: canonical } }
function loadColumnMappings() {
  try {
    return (
      JSON.parse(
        localStorage.getItem("cloudInstanceRecommenderColumnMaps"),
      ) || {}
    );
  } catch {
    return {};
  }
}

function saveColumnMapping(signature, mapping) {
  try {
    const all = loadColumnMappings();
    all[signature] = mapping;
    localStorage.setItem(
      "cloudInstanceRecommenderColumnMaps",
      JSON.stringify(all),
    );
  } catch (e) {
    console.warn("Could not persist column mapping:", e);
  }
}

// Entry point for parsed uploads (CSV and, later, xlsx). Applies column
// mapping silently when unambiguous; otherwise defers the whole pipeline
// (csvData stays empty) until the user confirms in the mapping panel.
function ingestRows(headers, rows) {
  console.log(`Parsed ${rows.length} rows with ${headers.length} columns`);

  // A mapping the user previously confirmed for this exact header set wins
  const saved = loadColumnMappings()[headerSignature(headers)];
  if (saved && Object.keys(saved).every((s) => headers.includes(s))) {
    console.log("Applying saved column mapping");
    applyIngest(headers, rows, saved);
    return;
  }

  const match = autoMatchHeaders(headers);
  if (match.needsReview) {
    csvData = [];
    columnHeaders = [];
    window._pendingIngest = { headers, rows, match };
    showColumnMappingPanel(headers, match);
    return;
  }

  applyIngest(headers, rows, match.mapping);
}

// Applies a mapping and runs the normal post-upload pipeline
function applyIngest(headers, rows, mapping) {
  const finalHeaders = headers.map((h) => mapping[h] || h);
  columnHeaders = finalHeaders;
  csvData = rewriteRowKeys(rows, mapping);
  window._pendingIngest = null;

  const panel = document.getElementById("columnMappingSection");
  if (panel) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
  }

  const renames = Object.entries(mapping)
    .filter(([source, canonical]) => source !== canonical)
    .map(([source, canonical]) => `${source} → ${canonical}`);

  // Validate required columns
  const missingColumns = REQUIRED_CANONICALS.filter(
    (col) => !finalHeaders.includes(col),
  );

  const fileStatus = document.getElementById("fileStatus");
  const renameNote = renames.length
    ? `<br>📎 Mapped columns: ${renames.map(escapeHtml).join(", ")}`
    : "";
  const uploadNote = window._uploadNote
    ? `<br>📄 ${escapeHtml(window._uploadNote)}`
    : "";
  if (missingColumns.length > 0) {
    fileStatus.className = "alert alert-warning";
    fileStatus.innerHTML = `⚠️ Missing required columns: ${missingColumns
      .map(escapeHtml)
      .join(", ")}. Please check your file format.${renameNote}${uploadNote}`;
    console.warn("Missing required columns:", missingColumns);
  } else {
    fileStatus.className = "alert alert-success";
    fileStatus.innerHTML = `✅ File loaded successfully: ${csvData.length} rows, ${finalHeaders.length} columns${renameNote}${uploadNote}`;
    console.log("File validation successful");
  }
  fileStatus.classList.remove("hidden");

  // Show file statistics
  showFileStatistics();

  // Check region names against the manifests, then start loading the region
  // data this CSV needs in the background (skipping unknown regions)
  validateCsvRegions();
  prefetchCsvRegions();
}

// Renders the mapping panel: one dropdown per canonical column, prefilled
// with the auto-match guesses; the pipeline stays deferred until Confirm
function showColumnMappingPanel(headers, match) {
  const panel = document.getElementById("columnMappingSection");
  if (!panel) {
    // Page has no panel placeholder — apply best-effort mapping instead
    applyIngest(headers, window._pendingIngest.rows, match.mapping);
    return;
  }

  const canonicals = MAPPABLE_CANONICALS;
  const required = REQUIRED_CANONICALS;
  const guessBySource = match.mapping; // source → canonical
  const guessedSource = {};
  Object.entries(guessBySource).forEach(([source, canonical]) => {
    guessedSource[canonical] = source;
  });
  // Ambiguous canonicals: preselect nothing, list candidates in the label
  const ambiguousByCanonical = {};
  match.ambiguous.forEach((a) => {
    ambiguousByCanonical[a.canonical] = a.candidates;
  });

  const selectRows = canonicals
    .map((canonical, idx) => {
      const options = [
        `<option value="">— not present —</option>`,
        ...headers.map((h, i) => {
          const selected = guessedSource[canonical] === h ? " selected" : "";
          return `<option value="${i}"${selected}>${escapeHtml(h)}</option>`;
        }),
      ].join("");
      const reqMark = required.includes(canonical)
        ? ' <span style="color: var(--red-badge);">*</span>'
        : "";
      const ambiguousNote = ambiguousByCanonical[canonical]
        ? `<span style="color: var(--warning-text); font-size: 12px;"> (several columns could match — please pick one)</span>`
        : "";
      return `
        <div style="display: flex; align-items: center; gap: 10px; margin: 6px 0;">
          <label for="colmap_${idx}" style="min-width: 180px; font-weight: 500;">${escapeHtml(canonical)}${reqMark}${ambiguousNote}</label>
          <select id="colmap_${idx}" data-canonical="${escapeHtml(canonical)}" class="form-control" style="max-width: 260px;">${options}</select>
        </div>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="stats-info">
      <p><strong>🔗 Map Your Columns</strong></p>
      <p style="font-size: 13px;">Some column names couldn't be matched automatically. Pick which of your columns corresponds to each field (<span style="color: var(--red-badge);">*</span> = required).</p>
      ${selectRows}
      <p style="font-size: 12px; margin-top: 8px;">Other columns (ENV, OS, Workload, Compliance, Min Gen, Exclude) are used as-is when present.</p>
      <button class="btn btn-primary" onclick="applyColumnMapping()" style="margin-top: 8px;">✔️ Confirm Mapping</button>
    </div>
  `;
  panel.classList.remove("hidden");

  const fileStatus = document.getElementById("fileStatus");
  if (fileStatus) {
    fileStatus.className = "alert alert-warning";
    fileStatus.innerHTML = `⚠️ Please review the column mapping below, then confirm to continue.`;
    fileStatus.classList.remove("hidden");
  }
}

// Confirm button handler for the mapping panel
function applyColumnMapping() {
  const pending = window._pendingIngest;
  if (!pending) return;

  const canonicals = MAPPABLE_CANONICALS;
  const required = REQUIRED_CANONICALS;
  const mapping = {};
  const usedSources = new Set();

  for (let idx = 0; idx < canonicals.length; idx++) {
    const select = document.getElementById(`colmap_${idx}`);
    if (!select || select.value === "") continue;
    const source = pending.headers[parseInt(select.value, 10)];
    if (usedSources.has(source)) {
      alert(
        `Column "${source}" is assigned to more than one field. Each column can map to only one field.`,
      );
      return;
    }
    usedSources.add(source);
    mapping[source] = canonicals[idx];
  }

  const missingRequired = required.filter(
    (canonical) => !Object.values(mapping).includes(canonical),
  );
  if (missingRequired.length) {
    alert(`Please assign a column for: ${missingRequired.join(", ")}`);
    return;
  }

  saveColumnMapping(headerSignature(pending.headers), mapping);
  applyIngest(pending.headers, pending.rows, mapping);
}

// Parse CSV line handling quoted values
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// Show file statistics
function showFileStatistics() {
  const statsSection = document.getElementById("fileStatsSection");
  if (!statsSection) return;

  const stats = {
    totalRows: csvData.length,
    totalColumns: columnHeaders.length,
    hasRequiredColumns: [COLUMN_MAPPINGS.cpu, COLUMN_MAPPINGS.memory].every(
      (col) => columnHeaders.includes(col),
    ),
    hasUtilizationData: [
      COLUMN_MAPPINGS.cpuUtilization,
      COLUMN_MAPPINGS.memoryUtilization,
    ].every((col) => columnHeaders.includes(col)),
  };

  statsSection.innerHTML = `
    <div class="stats-info">
      <p><strong>📊 Data Summary:</strong></p>
      <ul>
        <li>Total Rows: ${stats.totalRows}</li>
        <li>Total Columns: ${stats.totalColumns}</li>
        <li>Required Columns: ${
          stats.hasRequiredColumns ? "✅ Present" : "❌ Missing"
        }</li>
        <li>Utilization Data: ${
          stats.hasUtilizationData ? "✅ Available" : "⚠️ Not Available"
        }</li>
      </ul>
    </div>
  `;
  statsSection.classList.remove("hidden");

  // Show data preview
  showDataPreview();
}

// Show data preview
function showDataPreview() {
  const previewSection = document.getElementById("dataPreviewSection");
  if (!previewSection || csvData.length === 0) return;

  const previewData = csvData.slice(0, 5);
  const headers = columnHeaders;

  let tableHTML = `
    <p><strong>👁️ Data Preview (first 5 rows):</strong></p>
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="background: var(--surface-alt);">
            ${headers
              .map(
                (h) =>
                  `<th style="padding: 8px; border: 1px solid var(--border-mid); text-align: left;">${escapeHtml(h)}</th>`,
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
  `;

  previewData.forEach((row, i) => {
    const bgColor = i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)";
    tableHTML += `<tr style="background: ${bgColor};">`;
    headers.forEach((header) => {
      const value = row[header] || "";
      const displayValue =
        value.length > 20 ? value.substring(0, 20) + "..." : value;
      tableHTML += `<td style="padding: 8px; border: 1px solid var(--border-mid);">${escapeHtml(displayValue)}</td>`;
    });
    tableHTML += `</tr>`;
  });

  tableHTML += `
        </tbody>
      </table>
    </div>
  `;

  previewSection.innerHTML = tableHTML;
  previewSection.classList.remove("hidden");
}

// Toggle cloud provider
function toggleCloudProvider(provider) {
  const checkbox = document.getElementById(provider);

  if (checkbox.checked) {
    selectedProviders.push(provider);
  } else {
    selectedProviders = selectedProviders.filter((p) => p !== provider);
  }

  console.log("Selected providers:", selectedProviders);

  // Validate providers if modular system is available
  if (typeof validateProviderSupport !== "undefined") {
    const isValid = validateProviderSupport(selectedProviders);
    if (!isValid) {
      console.warn(
        "Some selected providers are not supported by the modular system",
      );
    }
  }

  // Update exclude controls when providers change
  const excludeCheckbox = document.getElementById("excludeTypes");
  if (excludeCheckbox && excludeCheckbox.checked) {
    updateExcludeControls();
  }
}

// Handle recommendation type change - Updated for modular system
function handleRecommendationTypeChange() {
  const optimizationControls = document.getElementById("optimizationControls");
  const selectedType = document.querySelector(
    'input[name="recommendationType"]:checked',
  );

  if (!selectedType) return;

  console.log("Recommendation type changed to:", selectedType.value);

  // Show/hide optimization controls based on recommendation type
  if (selectedType.value === "optimized" || selectedType.value === "both") {
    optimizationControls.classList.remove("hidden");
  } else {
    optimizationControls.classList.add("hidden");
  }

  // Log what will be generated
  const willGenerateLikeToLike =
    selectedType.value === "like-to-like" || selectedType.value === "both";
  const willGenerateOptimized =
    selectedType.value === "optimized" || selectedType.value === "both";

  console.log("Recommendation generation plan:", {
    likeToLike: willGenerateLikeToLike,
    optimized: willGenerateOptimized,
  });
}

// Toggle optimization mode
function toggleOptimizationMode() {
  const cpuBased = document.getElementById("cpuBased").checked;
  const memoryBased = document.getElementById("memoryBased").checked;

  const cpuRanges = document.getElementById("cpuUtilizationRanges");
  const memoryRanges = document.getElementById("memoryUtilizationRanges");

  if (cpuBased) {
    cpuRanges.classList.remove("hidden");
    updateCpuRanges();
  } else {
    cpuRanges.classList.add("hidden");
  }

  if (memoryBased) {
    memoryRanges.classList.remove("hidden");
    updateMemoryRanges();
  } else {
    memoryRanges.classList.add("hidden");
  }
}

// Update CPU range inputs
function updateCpuRanges() {
  const cpuDownsizeMax = document.getElementById("cpuDownsizeMax");
  const cpuKeepMin = document.getElementById("cpuKeepMin");
  const cpuKeepMax = document.getElementById("cpuKeepMax");
  const cpuUpsizeMin = document.getElementById("cpuUpsizeMin");

  if (!cpuDownsizeMax || !cpuKeepMin || !cpuKeepMax || !cpuUpsizeMin) return;

  const downsizeMaxVal = parseInt(cpuDownsizeMax.value);
  const keepMaxVal = parseInt(cpuKeepMax.value);

  cpuKeepMin.value = downsizeMaxVal;
  cpuUpsizeMin.value = keepMaxVal;

  // Disable upsizing if keepMax is 100
  const upsizeLabel = cpuUpsizeMin.parentElement;
  if (keepMaxVal >= 100) {
    upsizeLabel.style.opacity = "0.5";
    const spans = upsizeLabel.querySelectorAll("span");
    spans[spans.length - 1].textContent = "% - Disabled (upper limit is 100%)";
  } else {
    upsizeLabel.style.opacity = "1";
    const spans = upsizeLabel.querySelectorAll("span");
    spans[spans.length - 1].textContent = "% to 100%";
  }
}

// Update Memory range inputs
function updateMemoryRanges() {
  const memoryDownsizeMax = document.getElementById("memoryDownsizeMax");
  const memoryKeepMin = document.getElementById("memoryKeepMin");
  const memoryKeepMax = document.getElementById("memoryKeepMax");
  const memoryUpsizeMin = document.getElementById("memoryUpsizeMin");

  if (
    !memoryDownsizeMax ||
    !memoryKeepMin ||
    !memoryKeepMax ||
    !memoryUpsizeMin
  )
    return;

  const downsizeMaxVal = parseInt(memoryDownsizeMax.value);
  const keepMaxVal = parseInt(memoryKeepMax.value);

  memoryKeepMin.value = downsizeMaxVal;
  memoryUpsizeMin.value = keepMaxVal;

  // Disable upsizing if keepMax is 100
  const upsizeLabel = memoryUpsizeMin.parentElement;
  if (keepMaxVal >= 100) {
    upsizeLabel.style.opacity = "0.5";
    const spans = upsizeLabel.querySelectorAll("span");
    spans[spans.length - 1].textContent = "% - Disabled (upper limit is 100%)";
  } else {
    upsizeLabel.style.opacity = "1";
    const spans = upsizeLabel.querySelectorAll("span");
    spans[spans.length - 1].textContent = "% to 100%";
  }
}

// Toggle current generation filter
function toggleCurrentGenerationFilter() {
  const checkbox = document.getElementById("currentGenerationOnly");
  checkRuleConflicts();
  console.log(
    "Current generation filter:",
    checkbox.checked ? "Enabled" : "Disabled",
  );
}

// ─── Rule Engine UI helpers ────────────────────────────────────────────────

function getRuleDefaults() {
  return {
    env: (document.getElementById("ruleDefaultEnv")?.value || "").trim(),
    os: (document.getElementById("ruleDefaultOS")?.value || "").trim(),
    workload: (
      document.getElementById("ruleDefaultWorkload")?.value || ""
    ).trim(),
    compliance: (
      document.getElementById("ruleDefaultCompliance")?.value || ""
    ).trim(),
    minGen: (document.getElementById("ruleDefaultMinGen")?.value || "").trim(),
  };
}

function onRuleChange() {
  checkRuleConflicts();
}

function checkRuleConflicts() {
  const rules = getRuleDefaults();
  const env = rules.env.toLowerCase();
  const os = rules.os.toLowerCase();

  // ── Reset all rule group borders and conflict messages ──────────────────
  const ruleGroupIds = [
    "ruleGroupEnv",
    "ruleGroupOS",
    "ruleGroupWorkload",
    "ruleGroupCompliance",
    "ruleGroupMinGen",
  ];
  const conflictIds = [
    "conflictEnv",
    "conflictOS",
    "conflictWorkload",
    "conflictCompliance",
    "conflictMinGen",
  ];
  ruleGroupIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.border = "1.5px solid var(--border-slate)";
      el.style.background = "white";
    }
  });
  conflictIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "none";
      el.textContent = "";
    }
  });

  function flagConflict(groupId, msgId, msg) {
    const g = document.getElementById(groupId);
    const m = document.getElementById(msgId);
    if (g) {
      g.style.border = "1.5px solid var(--red-strong)";
      g.style.background = "var(--danger-bg-soft)";
    }
    if (m) {
      m.style.display = "block";
      m.textContent = "⚠ " + msg;
    }
  }

  // ── Conflict 1: OS=Windows + Graviton/ARM-only processor filter ─────────
  if (os === "windows") {
    const procRestrict = document.getElementById(
      "restrictProcessorManufacturers",
    )?.checked;
    if (procRestrict) {
      const procBoxes = document.querySelectorAll(
        "#processorCheckboxes input[type=checkbox]:checked",
      );
      const selected = Array.from(procBoxes).map((cb) =>
        cb.value.toLowerCase(),
      );
      const hasARM = selected.some(
        (v) => v === "aws" || v === "arm" || v === "graviton",
      );
      const hasIntel = selected.some((v) => v === "intel");
      const hasAMD = selected.some((v) => v === "amd");
      if (hasARM && !hasIntel && !hasAMD) {
        flagConflict(
          "ruleGroupOS",
          "conflictOS",
          "Windows needs Intel/AMD — contradicts Graviton-only processor filter",
        );
      }
    }
  }

  // ── Conflict 2: ENV=Production/Compliance + burstable-only family filter ─
  const isProdOrCompliance =
    env === "production" || env === "prod" || rules.compliance;
  if (isProdOrCompliance) {
    const mainRestrict = document.getElementById(
      "restrictMainFamilies",
    )?.checked;
    if (mainRestrict) {
      const famBoxes = document.querySelectorAll(
        "#mainFamiliesCheckboxes input[type=checkbox]:checked",
      );
      const selected = Array.from(famBoxes).map((cb) => cb.value.toLowerCase());
      const burstable = ["t", "b", "e2"]; // AWS t, Azure B, GCP e2
      const onlyBurst =
        selected.length > 0 &&
        selected.every((f) => burstable.some((b) => f.startsWith(b)));
      if (onlyBurst) {
        const conflictGroup = rules.compliance
          ? "ruleGroupCompliance"
          : "ruleGroupEnv";
        const conflictMsg = rules.compliance
          ? "conflictCompliance"
          : "conflictEnv";
        flagConflict(
          conflictGroup,
          conflictMsg,
          `${rules.compliance || rules.env} excludes burstable — contradicts restriction to burstable-only families`,
        );
      }
    }
  }

  // ── Conflict 3: Min Gen + Current Gen Only = redundant but not a conflict ─
  // (both restrict the pool, no contradiction — skip)

  // ── Conflict 4: Workload=ML/AI + processor filter = Intel/AMD only ───────
  if (rules.workload.toLowerCase() === "ml/ai") {
    const procRestrict = document.getElementById(
      "restrictProcessorManufacturers",
    )?.checked;
    if (procRestrict) {
      const procBoxes = document.querySelectorAll(
        "#processorCheckboxes input[type=checkbox]:checked",
      );
      const selected = Array.from(procBoxes).map((cb) =>
        cb.value.toLowerCase(),
      );
      const hasGPU = selected.some((v) => v === "aws" || v === "arm");
      if (selected.length > 0 && !hasGPU) {
        flagConflict(
          "ruleGroupWorkload",
          "conflictWorkload",
          "ML/AI prefers GPU families (Graviton/ARM accelerated) — Intel/AMD-only filter may exclude them",
        );
      }
    }
  }

  // ── Conflict 5: macOS + non-AWS providers selected ───────────────────────
  if (os === "macos" || os === "mac") {
    const nonAWS = (
      typeof selectedProviders !== "undefined" ? selectedProviders : []
    ).filter((p) => p !== "aws");
    if (nonAWS.length > 0) {
      flagConflict(
        "ruleGroupOS",
        "conflictOS",
        `macOS is AWS-only — ${nonAWS.map((p) => p.toUpperCase()).join(" & ")} will return no results for this OS`,
      );
    }
  }
}

// Toggle instance family name filter
function toggleInstanceFamilyNameFilter() {
  const controls = document.getElementById("instanceFamilyNameControls");
  const checkbox = document.getElementById("restrictInstanceFamilyNames");

  if (checkbox && controls) {
    if (checkbox.checked) {
      controls.classList.remove("hidden");
    } else {
      controls.classList.add("hidden");
    }
    console.log(
      "Instance family name filter:",
      checkbox.checked ? "Enabled" : "Disabled",
    );
  }
}

// Toggle processor manufacturer filter
function toggleProcessorManufacturerFilter() {
  const controls = document.getElementById("processorManufacturerControls");
  const checkbox = document.getElementById("restrictProcessorManufacturers");

  if (checkbox && controls) {
    if (checkbox.checked) {
      controls.classList.remove("hidden");
    } else {
      controls.classList.add("hidden");
    }
    console.log(
      "Processor manufacturer filter:",
      checkbox.checked ? "Enabled" : "Disabled",
    );
  }
}

// Toggle main families filter
function toggleMainFamiliesFilter() {
  const controls = document.getElementById("mainFamiliesControls");
  const checkbox = document.getElementById("restrictMainFamilies");

  if (checkbox && controls) {
    if (checkbox.checked) {
      controls.classList.remove("hidden");
    } else {
      controls.classList.add("hidden");
    }
    console.log(
      "Main families filter:",
      checkbox.checked ? "Enabled" : "Disabled",
    );
  }
}

// Toggle exclude types
function toggleExcludeTypes() {
  console.log("toggleExcludeTypes called");
  const excludeControls = document.getElementById("excludeControls");
  const checkbox = document.getElementById("excludeTypes");

  if (!excludeControls || !checkbox) {
    console.error("Required elements not found:", {
      excludeControls,
      checkbox,
    });
    return;
  }

  console.log("Exclude checkbox checked:", checkbox.checked);

  if (checkbox.checked) {
    excludeControls.classList.remove("hidden");
    updateExcludeControls();
  } else {
    excludeControls.classList.add("hidden");
  }
}

// Enhanced exclude controls with debugging
function updateExcludeControls() {
  console.log("updateExcludeControls called");
  console.log("Selected providers:", selectedProviders);

  const excludeControls = document.getElementById("excludeTypeControls");
  console.log("excludeTypeControls element:", excludeControls);

  if (!excludeControls) {
    console.error("excludeTypeControls element not found!");
    return;
  }

  excludeControls.innerHTML = "";

  if (selectedProviders.length === 0) {
    console.log("No providers selected, showing message");
    excludeControls.innerHTML =
      "<p style='color: var(--text-muted); font-style: italic; padding: 15px;'>Please select cloud providers first to see exclusion options.</p>";
    return;
  }

  console.log("Processing providers:", selectedProviders);
  console.log("Exclude types data:", excludeTypesData);

  selectedProviders.forEach((provider) => {
    console.log(`Creating exclude options for ${provider}`);

    if (
      !excludeTypesData[provider] ||
      excludeTypesData[provider].length === 0
    ) {
      console.error(`No exclude data found for provider: ${provider}`);
      return;
    }

    const div = document.createElement("div");
    div.innerHTML = `
      <div class="form-group">
        <label class="form-label">${provider.toUpperCase()} Exclude Options:</label>
        <div class="filter-checkbox-grid">
          ${excludeTypesData[provider]
            .map(
              (type) => `
              <div class="filter-checkbox-item">
                <input type="checkbox" id="exclude_${provider}_${type}" value="${type}">
                <label for="exclude_${provider}_${type}">
                  <strong>${type}</strong>
                  <span class="filter-description">${getExcludeTypeDescription(
                    provider,
                    type,
                  )}</span>
                </label>
              </div>
            `,
            )
            .join("")}
        </div>
      </div>
    `;
    excludeControls.appendChild(div);
    console.log(`Added exclude options for ${provider}`);
  });

  console.log("updateExcludeControls completed");
}

// Get exclude type descriptions - now routes to provider-specific functions
function getExcludeTypeDescription(provider, type) {
  // Try to use provider-specific description functions if available
  if (
    provider === "aws" &&
    typeof getAWSExcludeTypeDescription !== "undefined"
  ) {
    return getAWSExcludeTypeDescription(type);
  }
  if (
    provider === "azure" &&
    typeof getAzureExcludeTypeDescription !== "undefined"
  ) {
    return getAzureExcludeTypeDescription(type);
  }
  if (
    provider === "gcp" &&
    typeof getGCPExcludeTypeDescription !== "undefined"
  ) {
    return getGCPExcludeTypeDescription(type);
  }

  // Fallback to generic description
  return `Exclude ${type} instance types`;
}

// Fallback getter functions - these will be overridden by provider-specific files if available
function getSelectedInstanceFamilyNames() {
  const selected = [];
  // Look for checked checkboxes with pattern familyName_, azureSeries_, gcpFamily_
  const checkboxes = document.querySelectorAll(
    'input[id^="familyName_"]:checked, input[id^="azureSeries_"]:checked, input[id^="gcpFamily_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedProcessorManufacturers() {
  const selected = [];
  // Look for checked checkboxes with pattern processor_, azureProcessor_, gcpProcessor_
  const checkboxes = document.querySelectorAll(
    'input[id^="processor_"]:checked, input[id^="azureProcessor_"]:checked, input[id^="gcpProcessor_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedMainFamilies() {
  const selected = [];
  // Look for checked checkboxes with pattern mainFamily_, azureFamily_, gcpType_
  const checkboxes = document.querySelectorAll(
    'input[id^="mainFamily_"]:checked, input[id^="azureFamily_"]:checked, input[id^="gcpType_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

// Azure-specific fallback getter functions
function getSelectedAzureSeries() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="azureSeries_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedAzureProcessors() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="azureProcessor_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedAzureVMFamilies() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="azureFamily_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

// GCP-specific fallback getter functions
function getSelectedGCPFamilies() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="gcpFamily_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedGCPProcessors() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="gcpProcessor_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedGCPMachineTypes() {
  const selected = [];
  const checkboxes = document.querySelectorAll('input[id^="gcpType_"]:checked');
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

// Generate recommendations
function generateRecommendations() {
  console.log(
    "Starting recommendation generation with modular selector system",
  );

  // If the provider data files haven't finished parsing yet, queue this run
  // and auto-execute it the moment they are ready — no blocking, no alert.
  if (!allDataReady(selectedProviders)) {
    _generateQueued = true;
    showDataToast(
      "⏳ Instance data still loading — will start automatically when ready…",
    );
    watchForDataThenRun(selectedProviders);
    return;
  }

  // Validation
  if (csvData.length === 0) {
    alert(
      window._pendingIngest
        ? "Please confirm the column mapping first (see the panel above)."
        : "Please upload a CSV file first.",
    );
    return;
  }

  if (selectedProviders.length === 0) {
    alert("Please select at least one cloud provider.");
    return;
  }

  // Non-blocking heads-up if any selected provider has unrecognized regions
  if (window._regionValidation) {
    let unknowns = 0;
    for (const provider of selectedProviders) {
      const validation = window._regionValidation[provider];
      if (!validation) continue;
      unknowns += Object.values(validation).filter(
        (r) => r.status === "unknown",
      ).length;
    }
    if (unknowns > 0) {
      showDataToast(
        `⚠️ ${unknowns} unrecognized region name(s) — those rows will use sample data`,
      );
      setTimeout(hideDataToast, 6000);
    }
  }

  // Check if modular system is available
  if (typeof getInstanceRecommendationWithSelector === "undefined") {
    alert(
      "Modular Instance Selector system not found. Please include the required files:\n- base-instance-selector.js\n- aws-instance-selector.js\n- azure-instance-selector.js\n- gcp-instance-selector.js\n- instance-selector-factory.js",
    );
    return;
  }

  // Check if required columns exist
  const requiredColumns = [COLUMN_MAPPINGS.cpu, COLUMN_MAPPINGS.memory];
  const missingColumns = requiredColumns.filter(
    (col) => !columnHeaders.includes(col),
  );

  if (missingColumns.length > 0) {
    alert(`Missing required columns: ${missingColumns.join(", ")}`);
    return;
  }

  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked',
  );
  if (!recommendationType) {
    alert("Please select a recommendation type.");
    return;
  }

  console.log(
    "Validation passed, starting processing with type:",
    recommendationType.value,
  );

  // Show processing status — progress is now driven by the batch runner
  // (worker messages, or the chunked main-thread fallback)
  const processingStatus = document.getElementById("processingStatus");
  processingStatus.classList.remove("hidden");
  updateProgressBar(0, csvData.length);

  processRecommendations();
}

// Real progress bar driven by onProgress(done, total) callbacks
function updateProgressBar(done, total) {
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (progressFill) progressFill.style.width = pct + "%";
  if (progressText) {
    progressText.textContent =
      total && done >= total
        ? "Complete!"
        : `Processing row ${done} of ${total} for ${selectedProviders.length} provider(s)… ${pct}%`;
  }
}

// Enhanced process recommendations with modular system and recommendation type control
async function processRecommendations() {
  console.log(
    "Processing recommendations with modular selector system and N/2, N, N+1 optimization strategy",
  );

  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked',
  ).value;

  // Determine which recommendation types to generate
  const generateLikeToLike =
    recommendationType === "like-to-like" || recommendationType === "both";
  const generateOptimized =
    recommendationType === "optimized" || recommendationType === "both";

  console.log("Recommendation generation plan:", {
    type: recommendationType,
    generateLikeToLike,
    generateOptimized,
  });

  // Prepare options with comprehensive filtering and recommendation type control
  const options = {
    // **NEW: Recommendation type control**
    generateLikeToLike: generateLikeToLike,
    generateOptimized: generateOptimized,

    // Optimization strategy parameters (only used if generateOptimized is true)
    cpuBased: document.getElementById("cpuBased")?.checked || false,
    memoryBased: document.getElementById("memoryBased")?.checked || false,
    cpuDownsizeMax: parseInt(
      document.getElementById("cpuDownsizeMax")?.value || 40,
    ),
    cpuUpsizeMin: parseInt(
      document.getElementById("cpuUpsizeMin")?.value || 80,
    ),
    memoryDownsizeMax: parseInt(
      document.getElementById("memoryDownsizeMax")?.value || 40,
    ),
    memoryUpsizeMin: parseInt(
      document.getElementById("memoryUpsizeMin")?.value || 80,
    ),

    // Comprehensive AWS filtering options (only if AWS functions are available)
    currentGenerationOnly:
      document.getElementById("currentGenerationOnly")?.checked || false,
    restrictInstanceFamilyNames:
      document.getElementById("restrictInstanceFamilyNames")?.checked || false,
    selectedInstanceFamilyNames:
      typeof getSelectedInstanceFamilyNames !== "undefined"
        ? getSelectedInstanceFamilyNames()
        : [],
    restrictProcessorManufacturers:
      document.getElementById("restrictProcessorManufacturers")?.checked ||
      false,
    selectedProcessorManufacturers:
      typeof getSelectedProcessorManufacturers !== "undefined"
        ? getSelectedProcessorManufacturers()
        : [],
    restrictMainFamilies:
      document.getElementById("restrictMainFamilies")?.checked || false,
    selectedMainFamilies:
      typeof getSelectedMainFamilies !== "undefined"
        ? getSelectedMainFamilies()
        : [],
    excludeTypes: getExcludedTypes(),

    // Legacy Graviton exclusion support (derived from exclude types)
    excludeGraviton: getExcludeGravitonSetting(),

    // **FIXED: Azure-specific options**
    selectedAzureSeries: getSelectedAzureSeries(),
    selectedAzureProcessors: getSelectedAzureProcessors(),
    selectedAzureVMFamilies: getSelectedAzureVMFamilies(),

    // **FIXED: GCP-specific options**
    selectedGCPFamilies: getSelectedGCPFamilies(),
    selectedGCPProcessors: getSelectedGCPProcessors(),
    selectedGCPMachineTypes: getSelectedGCPMachineTypes(),

    // Rule Engine page-level defaults (overridden per-row by CSV columns)
    ...(getRuleDefaults().env ? { ruleDefaultEnv: getRuleDefaults().env } : {}),
    ...(getRuleDefaults().os ? { ruleDefaultOS: getRuleDefaults().os } : {}),
    ...(getRuleDefaults().workload
      ? { ruleDefaultWorkload: getRuleDefaults().workload }
      : {}),
    ...(getRuleDefaults().compliance
      ? { ruleDefaultCompliance: getRuleDefaults().compliance }
      : {}),
    ...(getRuleDefaults().minGen
      ? { ruleDefaultMinGen: getRuleDefaults().minGen }
      : {}),
  };

  console.log("Processing options:", {
    recommendationTypes: { generateLikeToLike, generateOptimized },
    filtering: {
      currentGenOnly: options.currentGenerationOnly,
      familyNames: options.selectedInstanceFamilyNames.length,
      processors: options.selectedProcessorManufacturers.length,
      mainFamilies: options.selectedMainFamilies.length,
      excludeTypes: options.excludeTypes.length,
      // Azure options
      azureSeries: options.selectedAzureSeries.length,
      azureProcessors: options.selectedAzureProcessors.length,
      azureVMFamilies: options.selectedAzureVMFamilies.length,
      // GCP options
      gcpFamilies: options.selectedGCPFamilies.length,
      gcpProcessors: options.selectedGCPProcessors.length,
      gcpMachineTypes: options.selectedGCPMachineTypes.length,
    },
    optimization: {
      cpuBased: options.cpuBased,
      memoryBased: options.memoryBased,
      ranges: `CPU(${options.cpuDownsizeMax}-${options.cpuUpsizeMin}), Memory(${options.memoryDownsizeMax}-${options.memoryUpsizeMin})`,
    },
  });

  try {
    // Use the modular instance selector system (worker when possible)
    console.log("Running recommendation batch (worker with fallback)");
    processedResults = await runRecommendationBatch(
      csvData,
      selectedProviders,
      options,
    );

    console.log("Recommendations processed successfully:", {
      totalRows: processedResults.length,
      sampleColumns: Object.keys(processedResults[0] || {}).filter(
        (key) => key.includes("Like-to-Like") || key.includes("Optimized"),
      ),
    });

    // Update usage statistics and show download section
    updateUsageStatistics(csvData.length);
    document.getElementById("downloadSection").classList.remove("hidden");

    // Show inline results preview
    showResultsPreview(processedResults);

    // On AWS page with both types: replace download button with split buttons
    updateDownloadButtons(processedResults);

    // No-match remediation export button (hidden when everything matched)
    updateNoMatchButton(processedResults);

    // Log what was actually generated
    if (processedResults.length > 0) {
      const sampleResult = processedResults[0];
      const generatedColumns = Object.keys(sampleResult).filter(
        (key) => key.includes("Like-to-Like") || key.includes("Optimized"),
      );
      console.log("Generated columns:", generatedColumns);
    }
  } catch (error) {
    console.error("Error processing recommendations:", error);
    alert(
      `An error occurred while processing recommendations: ${error.message}`,
    );
  } finally {
    const processingStatus = document.getElementById("processingStatus");
    if (processingStatus) processingStatus.classList.add("hidden");
  }
}

// ─── Worker-based batch runner ────────────────────────────────────────────────
// Snapshots the region data the CSV needs (injecting any region scripts not
// yet loaded) so it can be posted to the worker, which cannot fetch under CSP.
async function collectRegionDataForWorker(providers) {
  const regionData = {};
  const flags = {};

  for (const provider of providers) {
    const prefix = provider.toUpperCase();
    flags[`${prefix}_DATA_READY`] = window[`${prefix}_DATA_READY`] === true;
    if (window[`${prefix}_REGION_KEYS`]) {
      flags[`${prefix}_REGION_KEYS`] = window[`${prefix}_REGION_KEYS`];
    }
    if (window[`${prefix}_DATA_DATE`]) {
      flags[`${prefix}_DATA_DATE`] = window[`${prefix}_DATA_DATE`];
    }

    // Resolved regions for this provider: validation map when present,
    // otherwise resolve on the fly from the CSV
    let entries =
      (window._regionValidation && window._regionValidation[provider]) || null;
    if (!entries) {
      entries = {};
      const regionColumn =
        InstanceSelectorFactory.getProviderRegionColumn(provider);
      csvData.forEach((row) => {
        const raw = (row[regionColumn] || "").trim();
        if (raw && !entries[raw]) entries[raw] = resolveRegion(provider, raw);
      });
    }
    // No regions in the CSV → the factory will use the provider default
    if (!Object.keys(entries).length) {
      const def = InstanceSelectorFactory.getProviderDefaultRegion(provider);
      entries = { [def]: resolveRegion(provider, def) };
    }

    const selector =
      window._prewarmedSelectors[provider] ||
      InstanceSelectorFactory.createSelector(provider);
    window._prewarmedSelectors[provider] = selector;

    for (const resolution of Object.values(entries)) {
      if (!resolution || !resolution.key || resolution.status === "unknown") {
        continue; // worker will use its sample-data fallback for these rows
      }
      if (!window[resolution.key]) {
        try {
          await selector.ensureRegionScriptLoaded(resolution.key);
        } catch (e) {
          console.warn(
            `[Worker] could not load region ${resolution.key}:`,
            e,
          );
        }
      }
      if (window[resolution.key]) {
        regionData[resolution.key] = window[resolution.key];
      }
    }
  }

  return { regionData, flags };
}

// Runs the batch in a Web Worker (real progress, UI stays responsive); on any
// worker failure — file:// pages, CSP oddities, runtime errors — falls back
// ONCE to the chunked main-thread path with the same progress reporting.
async function runRecommendationBatch(rows, providers, options) {
  let worker = null;
  try {
    if (typeof Worker !== "undefined") {
      worker = new Worker("js/base/recommendation-worker.js");
    }
  } catch (e) {
    console.warn("[Worker] construction failed — using main thread:", e);
  }

  if (worker) {
    try {
      const payload = await collectRegionDataForWorker(providers);
      // Watchdog: any worker message counts as liveness (progress arrives at
      // least every `yieldEvery` rows). Prolonged silence → reject → the
      // catch below terminates the worker and runs the main-thread fallback.
      const watchdogMs = window._workerWatchdogMs || 20000;
      const results = await new Promise((resolve, reject) => {
        let watchdog = null;
        const armWatchdog = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(
            () =>
              reject(
                new Error(
                  `Worker sent no messages for ${watchdogMs}ms — assuming it stalled`,
                ),
              ),
            watchdogMs,
          );
        };
        armWatchdog();
        worker.onmessage = (event) => {
          const msg = event.data || {};
          if (msg.type === "progress") {
            armWatchdog();
            updateProgressBar(msg.done, msg.total);
          } else if (msg.type === "result") {
            clearTimeout(watchdog);
            resolve(msg.results);
          } else if (msg.type === "error") {
            clearTimeout(watchdog);
            reject(new Error(msg.message));
          }
        };
        worker.onerror = (event) => {
          clearTimeout(watchdog);
          reject(new Error(event.message || "Worker error"));
        };
        worker.postMessage({
          type: "run",
          csvData: rows,
          providers: providers,
          options: options,
          regionData: payload.regionData,
          flags: payload.flags,
        });
      });
      console.log("[Worker] batch completed in worker");
      return results;
    } catch (e) {
      console.warn("[Worker] failed — falling back to main thread:", e);
      updateProgressBar(0, rows.length);
    } finally {
      worker.terminate();
    }
  }

  return await getInstanceRecommendationWithSelector(rows, providers, options, {
    onProgress: updateProgressBar,
    yieldEvery: 25,
  });
}

// Get Graviton exclusion setting from the new exclude types UI
function getExcludeGravitonSetting() {
  console.log("getExcludeGravitonSetting called");

  // Check if Graviton exclusion is selected in the new exclude types section
  const gravitonCheckboxes = [
    document.getElementById("exclude_aws_Graviton"),
    document.getElementById("exclude_azure_ARM"),
    document.getElementById("exclude_gcp_ARM"),
  ].filter((cb) => cb !== null);

  console.log(
    "Found graviton checkboxes:",
    gravitonCheckboxes.map((cb) => (cb ? cb.id : "null")),
  );

  // Return true if ANY Graviton exclusion checkbox is checked
  const isExcluded = gravitonCheckboxes.some((checkbox) => checkbox.checked);
  console.log("Graviton exclusion setting:", isExcluded);

  return isExcluded;
}

// Get comprehensive excluded types (including Graviton, Mac, Nitro)
function getExcludedTypes() {
  const excludedTypes = [];

  selectedProviders.forEach((provider) => {
    const checkboxes = document.querySelectorAll(
      `input[id^="exclude_${provider}_"]:checked`,
    );
    checkboxes.forEach((checkbox) => {
      excludedTypes.push({
        provider: provider,
        type: checkbox.value,
      });
    });
  });

  console.log("Excluded types:", excludedTypes);
  return excludedTypes;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Generation stats bar ─────────────────────────────────────────────────────
// Shared no-match predicate — used by stats, the preview table, and the
// no-match export so they can never disagree on what "no match" means
const NO_MATCH_VALUES = new Set([
  "No data available",
  "Missing data",
  "Error",
  "No utilization data",
]);
function isNoMatchValue(v) {
  return !v || NO_MATCH_VALUES.has(String(v)) || String(v).startsWith("No ");
}

// Shared CSV cell escaping (quotes + formula-injection hardening)
function escapeCsvCell(val) {
  const s = String(val == null ? "" : val);
  const safe = /^[=+\-@|\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function _buildStatsHtml(results) {
  const allKeys = Object.keys(results[0] || {});
  const isNoMatch = isNoMatchValue;

  let matchedRows = 0;
  const rulesCounts = {};

  results.forEach((row) => {
    const instCols = allKeys.filter(
      (k) =>
        k.includes("Like-to-Like Instance") || k.includes("Optimized Instance"),
    );
    const hasMatch = instCols.some((c) => !isNoMatch(row[c]));
    if (hasMatch) matchedRows++;

    allKeys
      .filter((k) => k.includes("Rules Applied"))
      .forEach((rc) => {
        String(row[rc] || "")
          .split("|")
          .map((r) => r.trim())
          .filter(Boolean)
          .forEach((rule) => {
            const id =
              rule.match(/^([0-9]+[a-z]+|OS|MinGen|Workload|⚠)/i)?.[1] ||
              rule.substring(0, 6);
            rulesCounts[id] = (rulesCounts[id] || 0) + 1;
          });
      });
  });

  const noMatchRows = results.length - matchedRows;
  const pct = Math.round((matchedRows / results.length) * 100);
  const rulesSummary = Object.entries(rulesCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${escapeHtml(k)}(${v})`)
    .join(" · ");

  // Data freshness
  const dates = [
    window.AWS_DATA_DATE,
    window.AZURE_DATA_DATE,
    window.GCP_DATA_DATE,
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  const freshnessNote = dates.length
    ? `<span style="color:var(--text-faint);font-size:0.8em;">· Data as of ${escapeHtml(dates.join(" / "))}</span>`
    : "";

  return `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 16px;margin-bottom:12px;background:var(--success-bg);border:1px solid var(--success-border);border-radius:8px;font-size:0.875em;">
      <span style="font-weight:700;color:var(--good-strong);">✅ Generation complete</span>
      <span style="color:var(--text-body);">📊 <strong>${results.length}</strong> rows</span>
      <span style="color:var(--good-strong);">✓ <strong>${matchedRows}</strong> matched (${pct}%)</span>
      ${noMatchRows > 0 ? `<span style="color:var(--red-strong);">✗ <strong>${noMatchRows}</strong> no match</span>` : ""}
      ${rulesSummary ? `<span style="color:var(--text-soft);">Rules fired: ${rulesSummary}</span>` : ""}
      ${freshnessNote}
    </div>`;
}

// ─── Show in-browser results preview ──────────────────────────────────────────
function showResultsPreview(results) {
  const container = document.getElementById("resultsPreviewSection");
  if (!container || !results || results.length === 0) return;

  const allKeys = Object.keys(results[0] || {});
  const instanceCols = allKeys.filter(
    (k) =>
      k.includes("Like-to-Like Instance") || k.includes("Optimized Instance"),
  );
  const rulesCols = allKeys.filter((k) => k.includes("Rules Applied"));
  const reasonCols = allKeys.filter((k) => k.includes("No Match Reason"));
  const inputCols = [
    "VM Name",
    "CPU Count",
    "Memory (GB)",
    "ENV",
    "OS",
    "Workload",
    "Compliance",
  ].filter((c) => allKeys.includes(c));

  const displayCols = [...inputCols];
  instanceCols.forEach((instCol) => {
    displayCols.push(instCol);
    const vCpuCol = instCol.replace("Instance", "vCPUs");
    const memCol = instCol.replace("Instance", "Memory (GiB)");
    if (allKeys.includes(vCpuCol)) displayCols.push(vCpuCol);
    if (allKeys.includes(memCol)) displayCols.push(memCol);
  });
  rulesCols.forEach((r) => {
    if (!displayCols.includes(r)) displayCols.push(r);
  });
  reasonCols.forEach((r) => {
    if (!displayCols.includes(r)) displayCols.push(r);
  });

  // Store state for sort + search filter
  window._previewState = {
    results,
    displayCols,
    sortCol: null,
    sortDir: 1,
    filter: "",
  };
  _renderPreviewTable(container, results, displayCols, null, 1);

  container.scrollIntoView({ behavior: "smooth", block: "start" });
}

function _renderPreviewTable(
  container,
  results,
  displayCols,
  sortCol,
  sortDir,
  { filter = "", restoreFocus = false } = {},
) {
  const isNoMatch = isNoMatchValue;
  const isRulesCol = (c) => c.includes("Rules Applied");
  const isReasonCol = (c) => c.includes("No Match Reason");
  const isInstanceCol = (c) =>
    c.includes("Instance") && !c.includes("Rules") && !c.includes("Reason");
  const isVcpuCol = (c) => c.includes("vCPUs");
  const isMemCol = (c) => c.includes("Memory (GiB)");

  // Filter first (case-insensitive substring across visible columns), sort after
  const needle = String(filter || "")
    .trim()
    .toLowerCase();
  let rows = needle
    ? results.filter((row) =>
        displayCols.some((c) =>
          String(row[c] ?? "")
            .toLowerCase()
            .includes(needle),
        ),
      )
    : [...results];
  if (sortCol !== null) {
    rows.sort((a, b) => {
      const av = a[displayCols[sortCol]] ?? "";
      const bv = b[displayCols[sortCol]] ?? "";
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }

  // Build L2L vCPU map per provider for diff view
  const l2lVcpuColMap = {};
  displayCols.forEach((c) => {
    if (c.includes("Like-to-Like vCPUs")) {
      const provider = c.replace(" Like-to-Like vCPUs", "");
      l2lVcpuColMap[`${provider} Optimized vCPUs`] = c;
    }
  });

  function rulesHtml(val) {
    if (!val) return '<span style="color:var(--text-disabled)">—</span>';
    return val
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const colour = p.startsWith("⚠") ? "#d97706" : "#1a56db";
        return `<span style="display:inline-block;margin:1px 2px;padding:1px 6px;border-radius:10px;background:${colour}1a;border:1px solid ${colour}55;color:${colour};font-size:0.78em;white-space:nowrap;">${escapeHtml(p)}</span>`;
      })
      .join(" ");
  }

  const previewRows = rows.slice(0, 20);

  const sortArrow = (i) => {
    if (sortCol !== i)
      return `<span style="opacity:0.35;margin-left:4px;">⇅</span>`;
    return sortDir === 1
      ? `<span style="margin-left:4px;">▲</span>`
      : `<span style="margin-left:4px;">▼</span>`;
  };

  const countLabel = needle
    ? `first ${previewRows.length} of ${rows.length} matching rows (${results.length} total)`
    : `first ${previewRows.length} of ${results.length} rows`;

  let html = _buildStatsHtml(results);
  html += `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
      <p style="font-weight:600;margin:0;">📋 Results Preview (${countLabel})</p>
      <input id="previewSearch" type="text" placeholder="🔍 Filter rows…" aria-label="Filter preview rows"
        oninput="window._previewFilterChanged(this.value)"
        style="padding:5px 10px;border:1px solid var(--border-slate);border-radius:6px;font-size:12px;min-width:220px;background:var(--surface);color:var(--text);" />
    </div>
    <div style="overflow-x:auto;max-height:420px;overflow-y:auto;border:1px solid var(--border-slate-light);border-radius:6px;">
      <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:700px;" id="_previewTable">
        <thead>
          <tr style="position:sticky;top:0;z-index:1;background:var(--table-head-bg);color:var(--table-head-text);">
            <th style="padding:6px 8px;white-space:nowrap;cursor:default;"></th>
            ${displayCols
              .map(
                (c, i) =>
                  `<th scope="col" tabindex="0" aria-sort="${sortCol === i ? (sortDir === 1 ? "ascending" : "descending") : "none"}" onclick="window._sortPreview(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window._sortPreview(${i});}" style="padding:6px 10px;text-align:left;white-space:nowrap;font-weight:600;cursor:pointer;user-select:none;">${escapeHtml(c)}${sortArrow(i)}</th>`,
              )
              .join("")}
          </tr>
        </thead>
        <tbody>`;

  previewRows.forEach((row, ri) => {
    const instCols = displayCols.filter(isInstanceCol);
    const allNoMatch =
      instCols.length > 0 && instCols.every((c) => isNoMatch(row[c]));
    const bg = allNoMatch ? "var(--danger-bg-soft)" : ri % 2 === 0 ? "var(--surface)" : "var(--surface-alt-2)";
    const rowCsv = displayCols
      .map((c) => {
        const v = String(row[c] ?? "");
        return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      })
      .join(",");

    html += `<tr style="background:${bg};">`;
    // Copy button
    html += `<td style="padding:4px 6px;border-bottom:1px solid var(--border-lighter);white-space:nowrap;">
      <button onclick="navigator.clipboard.writeText(${escapeHtml(JSON.stringify(rowCsv))}).catch(()=>{})"
        title="Copy row as CSV" aria-label="Copy row ${ri + 1} as CSV"
        style="font-size:10px;padding:1px 5px;border:1px solid var(--border-slate);border-radius:3px;background:var(--surface-alt-2);cursor:pointer;color:var(--text-body);">⎘</button>
    </td>`;

    displayCols.forEach((col) => {
      const val = row[col] ?? "";
      let cellContent;

      if (isRulesCol(col)) {
        cellContent = rulesHtml(String(val));
      } else if (isReasonCol(col)) {
        cellContent = val
          ? `<span style="color:var(--amber-deep);font-size:0.85em;">${escapeHtml(String(val))}</span>`
          : '<span style="color:var(--text-disabled)">—</span>';
      } else if (isInstanceCol(col)) {
        const bad = isNoMatch(val);
        const color = bad ? "var(--red-strong)" : "var(--ok-strong)";
        cellContent = val
          ? `<strong style="color:${color}">${escapeHtml(String(val))}</strong>`
          : '<span style="color:var(--text-disabled)">—</span>';
      } else if (isVcpuCol(col) && l2lVcpuColMap[col]) {
        // Diff view: compare Optimized vCPUs to Like-to-Like vCPUs
        const l2lVal = parseFloat(row[l2lVcpuColMap[col]]);
        const optVal = parseFloat(val);
        let diffStyle = "";
        if (!isNaN(l2lVal) && !isNaN(optVal) && l2lVal > 0) {
          if (optVal < l2lVal) diffStyle = "color:var(--good-strong);font-weight:600;";
          else if (optVal > l2lVal)
            diffStyle = "color:var(--amber-strong);font-weight:600;";
        }
        cellContent =
          val !== "" && val !== undefined
            ? `<span style="${diffStyle}">${escapeHtml(String(val))}</span>`
            : '<span style="color:var(--text-disabled)">—</span>';
      } else {
        cellContent =
          val !== "" && val !== undefined
            ? escapeHtml(String(val))
            : '<span style="color:var(--text-disabled)">—</span>';
      }
      html += `<td style="padding:5px 10px;border-bottom:1px solid var(--border-lighter);vertical-align:top;">${cellContent}</td>`;
    });
    html += `</tr>`;
  });

  if (previewRows.length === 0 && needle) {
    html += `<tr><td colspan="${displayCols.length + 1}" style="padding:14px;text-align:center;color:var(--text-soft);">No rows match "${escapeHtml(needle)}"</td></tr>`;
  }

  html += `</tbody></table></div>`;
  if (rows.length > 20) {
    html += `<p style="font-size:0.82em;color:var(--text-soft);margin-top:4px;">Showing first 20 ${needle ? "matching " : ""}rows. Download the CSV for the full ${results.length}-row dataset.</p>`;
  }
  html += `<p style="font-size:0.8em;color:var(--text-faint);margin-top:4px;">Click any column header to sort · <span style="color:var(--good-strong);">Green Optimized vCPUs</span> = rightsized down · <span style="color:var(--amber-strong);">Amber</span> = rightsized up · Red rows = no match</p>`;

  container.innerHTML = html;
  container.classList.remove("hidden");

  // Repopulate the search input via the DOM (never as an HTML attribute) and
  // restore focus + cursor so re-rendering doesn't eat keystrokes
  const searchInput = document.getElementById("previewSearch");
  if (searchInput) {
    searchInput.value = filter || "";
    if (restoreFocus) {
      searchInput.focus();
      const pos =
        window._previewCursorPos != null
          ? window._previewCursorPos
          : (filter || "").length;
      window._previewCursorPos = null;
      if (searchInput.setSelectionRange) searchInput.setSelectionRange(pos, pos);
    }
  }
}

window._sortPreview = function (colIdx) {
  const s = window._previewState;
  if (!s) return;
  const newDir = s.sortCol === colIdx ? -s.sortDir : 1;
  s.sortCol = colIdx;
  s.sortDir = newDir;
  const container = document.getElementById("resultsPreviewSection");
  if (container)
    _renderPreviewTable(container, s.results, s.displayCols, colIdx, newDir, {
      filter: s.filter,
    });
};

// Debounced search-filter handler for the preview table
window._previewFilterChanged = function (value) {
  const s = window._previewState;
  if (!s) return;
  s.filter = value;
  clearTimeout(window._previewFilterTimer);
  window._previewFilterTimer = setTimeout(() => {
    const container = document.getElementById("resultsPreviewSection");
    const liveInput = document.getElementById("previewSearch");
    window._previewCursorPos =
      liveInput && liveInput.selectionStart != null
        ? liveInput.selectionStart
        : null;
    if (container) {
      _renderPreviewTable(
        container,
        s.results,
        s.displayCols,
        s.sortCol,
        s.sortDir,
        { filter: s.filter, restoreFocus: true },
      );
    }
  }, 150);
};

// ─── Update bulk template buttons for AWS when both L2L + Optimized generated ─

function updateDownloadButtons(results) {
  const row = document.getElementById("downloadBtnsRow");
  if (!row || !results || results.length === 0) return;

  const keys = Object.keys(results[0]);
  const hasL2L = keys.some((k) => k.includes("Like-to-Like Instance"));
  const hasOpt = keys.some((k) => k.includes("Optimized Instance"));

  const hasAzure = keys.some((k) => /^AZURE\s/i.test(k));
  const hasGCP = keys.some((k) => /^GCP\s/i.test(k));
  const isAWSOnly = !hasAzure && !hasGCP && keys.some((k) => /^AWS\s/i.test(k));

  if (!isAWSOnly) return;

  if (hasL2L && hasOpt) {
    // Both types: show Results CSV + two separate bulk template buttons
    row.innerHTML = `
      <button class="btn btn-primary" onclick="downloadResults()">
        📥 Download Results CSV
      </button>
      <button class="btn btn-secondary" onclick="downloadAWSBulkTemplate('l2l')" title="AWS Pricing Calculator Bulk Import — Like-to-Like instances only">
        🧾 Bulk Template (Like-to-Like)
      </button>
      <button class="btn btn-secondary" onclick="downloadAWSBulkTemplate('optimized')" title="AWS Pricing Calculator Bulk Import — Optimized instances only">
        🧾 Bulk Template (Optimized)
      </button>
    `;
  } else {
    // Single type: Results CSV + one bulk template button (auto-resolves to the present type)
    row.innerHTML = `
      <button class="btn btn-primary" onclick="downloadResults()">
        📥 Download Results CSV
      </button>
      <button class="btn btn-secondary" onclick="downloadAWSBulkTemplate()" title="AWS Pricing Calculator Bulk Import (EC2 Instances template)">
        🧾 Download AWS Pricing Calculator Bulk Template
      </button>
    `;
  }
}

function downloadResults() {
  if (!processedResults || processedResults.length === 0) {
    alert("No results to download. Please generate recommendations first.");
    return;
  }

  console.log("Downloading results with", processedResults.length, "rows");

  // Use the file handler if available
  if (
    window.integrationManager &&
    window.integrationManager.exportRecommendations
  ) {
    window.integrationManager.exportRecommendations(processedResults);
    return;
  }

  // Fallback to simple CSV export
  const headers = Object.keys(processedResults[0]);
  const csvContent = [
    headers.map(escapeCsvCell).join(","),
    ...processedResults.map((row) =>
      headers.map((header) => escapeCsvCell(row[header] ?? "")).join(","),
    ),
  ].join("\n");

  // Download
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = `instance_recommendations_${
    new Date().toISOString().split("T")[0]
  }.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  console.log("CSV download completed");
}

// ─── No-match remediation export ──────────────────────────────────────────────
// A row qualifies when EVERY instance column present is a no-match — deriving
// the columns from the results themselves handles L2L-only, optimized-only,
// and any provider combination automatically.
function getNoMatchRows(results) {
  if (!results || !results.length) return [];
  const instCols = Object.keys(results[0]).filter(
    (k) =>
      k.includes("Like-to-Like Instance") || k.includes("Optimized Instance"),
  );
  if (!instCols.length) return [];
  return results.filter((row) => instCols.every((c) => isNoMatchValue(row[c])));
}

// Exports the fully-unmatched rows with their original input columns plus
// the diagnostic columns (No Match Reason / Rules Applied) — a remediation
// worksheet: fix these rows, re-upload, re-generate.
function downloadNoMatchRows() {
  const noMatch = getNoMatchRows(processedResults);
  if (!noMatch.length) {
    alert("Every row received at least one recommendation — nothing to export.");
    return;
  }

  const resultKeys = Object.keys(processedResults[0]);
  const inputHeaders = columnHeaders.filter((h) => resultKeys.includes(h));
  const diagCols = resultKeys.filter(
    (k) =>
      (k.includes("No Match Reason") || k.includes("Rules Applied")) &&
      !inputHeaders.includes(k),
  );
  const headers = [...inputHeaders, ...diagCols];

  const csvContent = [
    headers.map(escapeCsvCell).join(","),
    ...noMatch.map((row) =>
      headers.map((h) => escapeCsvCell(row[h] ?? "")).join(","),
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "no-match-rows.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  console.log(`No-match export completed: ${noMatch.length} rows`);
}

// Shows the no-match button with a count badge, or hides it on all-match runs
function updateNoMatchButton(results) {
  const btn = document.getElementById("downloadNoMatchBtn");
  if (!btn) return;
  const count = getNoMatchRows(results).length;
  if (count > 0) {
    btn.textContent = `⚠️ No-Match Rows CSV (${count})`;
    btn.title = `${count} row(s) got no recommendation from any provider — download them with reasons to fix and re-upload`;
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
}

// AWS Pricing Calculator Bulk Template download
// Generates a CSV matching the EC2 Instances BulkUpload Template format.
// type = 'l2l' | 'optimized' — always one type per file to avoid double-counting.
// If omitted and only one type exists, that type is used automatically.
function downloadAWSBulkTemplate(type) {
  if (!processedResults || processedResults.length === 0) {
    alert("No results to download. Please generate recommendations first.");
    return;
  }

  const sampleRow = processedResults[0];
  const hasL2L = Object.keys(sampleRow).some((k) =>
    k.includes("AWS Like-to-Like Instance"),
  );
  const hasOpt = Object.keys(sampleRow).some((k) =>
    k.includes("AWS Optimized Instance"),
  );

  if (!hasL2L && !hasOpt) {
    alert(
      "No AWS recommendations found. Please select AWS as a provider and regenerate.",
    );
    return;
  }

  // Resolve which type to use for this file
  const useL2L = type === "l2l" || (!type && hasL2L);
  const useOpt = type === "optimized" || (!type && !hasL2L && hasOpt);

  if (!useL2L && !useOpt) {
    alert("Unknown bulk template type. Use 'l2l' or 'optimized'.");
    return;
  }

  const bulkHeaders = [
    "Group",
    "Description",
    "AWS Region",
    "Operating System",
    "Instance Type",
    "Tenancy",
    "Number of Instances",
    "Assumed Usage",
    "Usage Type",
    "Purchasing Options",
    "Storage Type",
    "Storage amount per Instance (GB)",
    "Provisioning IOPS per instance (gp3, io1, io2)",
    "EBS Throughput per Instance (Mbps)",
    "Snapshot Frequency",
    "EBS Snapshot amount per Instance (GB/snapshot)",
  ];

  const osSelector = document.querySelector('input[name="targetOS"]:checked');
  const pageOS = osSelector ? osSelector.value : "Linux";

  const rows = [];

  processedResults.forEach((row) => {
    const vmName = row["VM Name"] || row["Server Name"] || "VM";
    const region = row["AWS Region"] || "";
    const env = row["ENV"] || row["Environment"] || "Default";
    const sanitize = (s) => {
      const clean = String(s).replace(/[><&]/g, "");
      return /^[=+\-@|\t\r]/.test(clean) ? `'${clean}` : clean;
    };

    // Per-row OS overrides the page-level default
    const rowOS = (row["OS"] || row["Operating System"] || pageOS).trim();
    const templateOS = rowOS.toLowerCase().includes("windows")
      ? "Windows Server"
      : "Linux";

    const buildRow = (instanceType) => {
      if (
        !instanceType ||
        instanceType === "Missing data" ||
        instanceType === "Error" ||
        instanceType === "No utilization data"
      ) {
        return null;
      }
      return [
        sanitize(env), // Group
        sanitize(vmName), // Description — just the VM name, no type label
        region, // AWS Region
        templateOS, // Operating System (per-row)
        instanceType, // Instance Type
        "Shared Instances", // Tenancy
        "1", // Number of Instances
        "", // Assumed Usage (blank = Always On)
        "Always On", // Usage Type
        "On-Demand", // Purchasing Options
        "", // Storage Type
        "", // Storage amount
        "", // Provisioning IOPS
        "", // EBS Throughput
        "", // Snapshot Frequency
        "", // EBS Snapshot amount
      ];
    };

    if (useL2L) {
      const r = buildRow(row["AWS Like-to-Like Instance"]);
      if (r) rows.push(r);
    } else {
      const r = buildRow(row["AWS Optimized Instance"]);
      if (r) rows.push(r);
    }
  });

  if (rows.length === 0) {
    alert(
      "No valid AWS instance recommendations to export. Check that your results contain successful matches.",
    );
    return;
  }

  const escapeCell = (v) => {
    const s = String(v == null ? "" : v);
    const safe = /^[=+\-@|\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  const csvContent = [
    bulkHeaders.map(escapeCell).join(","),
    ...rows.map((r) => r.map(escapeCell).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  const suffix = useL2L ? "like_to_like" : "optimized";
  a.download = `aws_pricing_calculator_bulk_${suffix}_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  console.log(`AWS bulk template exported: ${rows.length} rows`);
}

// Enhanced usage statistics management
let usageStats = {
  toolUses: 0,
  totalVMs: 0,
  lastUpdated: new Date().toISOString(),
  gravitonRecommendations: 0,
  intelRecommendations: 0,
  averageCostSavings: 0,
};

// Load usage statistics from localStorage
function loadUsageStatistics() {
  try {
    const stored = localStorage.getItem("cloudInstanceRecommenderStats");
    if (stored) {
      usageStats = { ...usageStats, ...JSON.parse(stored) };
      updateUsageCounters();
      console.log("Loaded usage statistics:", usageStats);
    }
  } catch (e) {
    console.error("Error loading statistics:", e);
  }
}

// Enhanced save usage statistics
function saveUsageStatistics() {
  try {
    // Update timestamp
    usageStats.lastUpdated = new Date().toISOString();

    // Save to localStorage
    localStorage.setItem(
      "cloudInstanceRecommenderStats",
      JSON.stringify(usageStats),
    );

    console.log("Saved usage statistics:", usageStats);
  } catch (e) {
    console.error("Error saving statistics:", e);
  }
}

// Enhanced update usage statistics
function updateUsageStatistics(vmCount) {
  usageStats.toolUses++;
  usageStats.totalVMs += vmCount;

  updateUsageCounters();
  saveUsageStatistics();

  console.log(
    `Updated statistics: ${usageStats.toolUses} tool uses, ${usageStats.totalVMs} total VMs processed`,
  );
}

// Update usage counter display
function updateUsageCounters() {
  const toolUsageElement = document.getElementById("toolUsageCount");
  const totalVMsElement = document.getElementById("totalVMsProcessed");

  if (toolUsageElement) toolUsageElement.textContent = usageStats.toolUses;
  if (totalVMsElement) totalVMsElement.textContent = usageStats.totalVMs;
}

// Export function to get instance recommendation (for integration with file handler)
window.getInstanceRecommendation = function (
  provider,
  cpu,
  memory,
  cpuUtil,
  memoryUtil,
  recommendationType,
) {
  let result = {
    instanceType: "Not found",
    status: "No match",
    hourlyCost: "0",
    vcpus: 0,
    memory: 0,
  };

  // Try to use the modular selector system
  if (typeof InstanceSelectorFactory !== "undefined") {
    try {
      const selector = InstanceSelectorFactory.createSelector(provider);
      const options = {
        currentGenerationOnly: true,
      };

      // This would need the selector to be initialized first
      // For now, return the fallback result
      console.log(
        "Modular selector available but not initialized for single recommendation",
      );
    } catch (error) {
      console.warn(
        "Error using modular selector for single recommendation:",
        error,
      );
    }
  }

  return result;
};

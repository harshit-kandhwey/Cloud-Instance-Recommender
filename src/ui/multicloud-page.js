// Multicloud page logic: the filter helpers, the init that resets optional filters,
// and the window getters the engine reads. Loaded as a blocking head script on
// multicloud.html only, so its DOMContentLoaded listeners register before the
// deferred page scripts, as they did when this was inline.
// ── Helper: collect checked IDs from a category→values map ───────────────
function _mcFromMap(map) {
  const out = new Set();
  Object.entries(map).forEach(([id, vals]) => {
    if (document.getElementById(id)?.checked) vals.forEach((v) => out.add(v));
  });
  return [...out];
}

// ── Unified processor getter (overrides provider-specific ones) ────────────
function _mcProcessors() {
  const p = [];
  if (document.getElementById("mc_proc_intel")?.checked) p.push("Intel");
  if (document.getElementById("mc_proc_amd")?.checked) p.push("AMD");
  if (document.getElementById("mc_proc_arm")?.checked) {
    p.push("ARM"); // Azure + GCP
    p.push("AWS"); // AWS Graviton
  }
  return p;
}

// ── Category → AWS main families ─────────────────────────────────────────
function _mcAWSFamilies() {
  return _mcFromMap({
    mc_cat_general: ["m", "a"],
    mc_cat_burstable: ["t"],
    mc_cat_memory: ["r", "x", "z"],
    mc_cat_compute: ["c", "f"],
    mc_cat_storage: ["i", "d"],
    mc_cat_gpu: ["p", "g", "inf", "trn", "dl", "vt"],
    mc_cat_hpc: ["h"],
  });
}

// ── Category → Azure series ───────────────────────────────────────────────
function _mcAzureSeries() {
  return _mcFromMap({
    mc_cat_general: ["D-series", "A-series"],
    mc_cat_burstable: ["B-series"],
    mc_cat_memory: ["E-series", "M-series"],
    mc_cat_compute: ["F-series"],
    mc_cat_storage: ["L-series"],
    mc_cat_gpu: ["N-series"],
    mc_cat_hpc: ["H-series"],
  });
}

// ── Category → Azure VM families ─────────────────────────────────────────
function _mcAzureVMFamilies() {
  return _mcFromMap({
    mc_cat_general: ["Standard_D", "Standard_DS", "Standard_A"],
    mc_cat_burstable: ["Standard_B"],
    mc_cat_memory: ["Standard_E", "Standard_ES", "Standard_M", "Standard_MS"],
    mc_cat_compute: ["Standard_F", "Standard_FS"],
    mc_cat_storage: ["Standard_L", "Standard_LS"],
    mc_cat_gpu: ["Standard_N", "Standard_NC", "Standard_ND", "Standard_NV"],
    mc_cat_hpc: ["Standard_H"],
  });
}

// ── Category → GCP machine families ──────────────────────────────────────
function _mcGCPFamilies() {
  return _mcFromMap({
    mc_cat_general: ["E2", "N1", "N2", "N2D", "N4", "N4D"],
    mc_cat_burstable: ["F1", "G1"],
    mc_cat_memory: ["M3", "M4"],
    mc_cat_compute: ["C2D", "C3", "C3D", "C4"],
    mc_cat_storage: ["Z3"],
    mc_cat_gpu: ["A2", "A3", "G2"],
    mc_cat_hpc: ["H3"],
  });
}

// ── Override provider-specific getters with unified multicloud versions ──
// This blocking head script runs at parse time, BEFORE the deferred modules, whose
// top-level function declarations of the same names would overwrite anything
// assigned now. DOMContentLoaded fires after every deferred script has run.
document.addEventListener("DOMContentLoaded", function () {
  window.getSelectedProcessorManufacturers = _mcProcessors;
  window.getSelectedAzureProcessors = _mcProcessors;
  window.getSelectedGCPProcessors = _mcProcessors;
  window.getSelectedMainFamilies = _mcAWSFamilies;
  window.getSelectedAzureSeries = _mcAzureSeries;
  window.getSelectedAzureVMFamilies = _mcAzureVMFamilies;
  window.getSelectedGCPFamilies = _mcGCPFamilies;
});

// ── Exclude controls (still dynamic per-provider) ─────────────────────────
function updateMultiCloudFilters() {
  const excludeCheckbox = document.getElementById("excludeTypes");
  if (excludeCheckbox?.checked) updateExcludeControls();
}

// ── Init: reset checkboxes, hide panels, wire exclude ────────────────────
document.addEventListener("DOMContentLoaded", function () {
  // Force-reset optional filter checkboxes (prevent browser state restoration)
  [
    "restrictProcessorManufacturers",
    "restrictMainFamilies",
    "excludeTypes",
    "mc_proc_intel",
    "mc_proc_amd",
    "mc_proc_arm",
    "mc_cat_general",
    "mc_cat_burstable",
    "mc_cat_memory",
    "mc_cat_compute",
    "mc_cat_storage",
    "mc_cat_gpu",
    "mc_cat_hpc",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  [
    "processorManufacturerControls",
    "mainFamiliesControls",
    "excludeControls",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });

  setTimeout(updateMultiCloudFilters, 300);
});

// Filter presets: save/restore named filter + rule-engine configurations.
//
// A preset is a snapshot of the live configuration controls (the source of
// truth), not the computed options object, so it round-trips faithfully.
// Applying a preset sets the controls and re-fires the existing toggle
// handlers (toggleOptimizationMode, checkRuleConflicts, …) so dependent UI —
// optimization ranges, conflict flags, the exclude-types grid — rebuilds,
// then re-checks the saved dynamic-filter selections.
//
// Presets are scoped per tool page (aws/azure/gcp/multicloud), since the
// available filters differ per provider, and are applied manually — nothing
// is auto-restored on load. Persistence mirrors the column-map pattern in
// ingest.js (localStorage, try/catch so private mode never breaks the flow).

const FILTER_PRESETS_KEY = "cloudInstanceRecommenderFilterPresets";

// Simple single-value controls captured by element id.
const PRESET_CHECKBOXES = [
  "cpuBased",
  "memoryBased",
  "currentGenerationOnly",
  "restrictInstanceFamilyNames",
  "restrictProcessorManufacturers",
  "restrictMainFamilies",
  "excludeTypes",
];
const PRESET_NUMBERS = [
  "cpuDownsizeMax",
  "cpuKeepMin",
  "cpuKeepMax",
  "cpuUpsizeMin",
  "memoryDownsizeMax",
  "memoryKeepMin",
  "memoryKeepMax",
  "memoryUpsizeMin",
];
const PRESET_TEXTS = [
  "ruleDefaultEnv",
  "ruleDefaultOS",
  "ruleDefaultWorkload",
  "ruleDefaultCompliance",
  "ruleDefaultMinGen",
];
const PRESET_PROVIDER_IDS = ["aws", "azure", "gcp"];

// Dynamically-rendered per-provider filter checkboxes are captured by the id
// prefixes their provider files use (see js/{p}/{p}-specific.js).
const PRESET_GROUP_PREFIXES = [
  "familyName_",
  "azureSeries_",
  "gcpFamily_",
  "processor_",
  "azureProcessor_",
  "gcpProcessor_",
  "mainFamily_",
  "azureFamily_",
  "gcpType_",
  "exclude_",
  // multicloud.html cross-provider filters (Processor Architecture / Category)
  "mc_proc_",
  "mc_cat_",
];

function presetsPageKey() {
  return typeof currentSourcePage === "function" ? currentSourcePage() : "aws";
}

function loadPresetsStore() {
  try {
    return JSON.parse(localStorage.getItem(FILTER_PRESETS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePresetsStore(store) {
  try {
    localStorage.setItem(FILTER_PRESETS_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    console.warn("Could not persist filter presets:", e);
    return false;
  }
}

// Presets for the current page: { name: { savedAt, config } }.
function presetsForPage() {
  return loadPresetsStore()[presetsPageKey()] || {};
}

// ─── Capture / apply ──────────────────────────────────────────────────────────

function isPresetGroupId(id) {
  return PRESET_GROUP_PREFIXES.some((p) => id.startsWith(p));
}

// Snapshot the current configuration controls into a plain, JSON-safe object.
function capturePresetConfig() {
  const cfg = {
    checkboxes: {},
    numbers: {},
    texts: {},
    providers: [],
    groupChecked: [],
  };

  const rt = document.querySelector('input[name="recommendationType"]:checked');
  if (rt) cfg.recommendationType = rt.value;

  PRESET_CHECKBOXES.forEach((id) => {
    const el = document.getElementById(id);
    if (el) cfg.checkboxes[id] = !!el.checked;
  });
  PRESET_NUMBERS.forEach((id) => {
    const el = document.getElementById(id);
    // Capture unconditionally (like texts) so a blank field round-trips as blank.
    if (el) cfg.numbers[id] = el.value;
  });
  PRESET_TEXTS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) cfg.texts[id] = el.value;
  });
  PRESET_PROVIDER_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.checked) cfg.providers.push(id);
  });

  cfg.groupChecked = Array.from(
    document.querySelectorAll('input[type="checkbox"]'),
  )
    .filter((cb) => cb.checked && cb.id && isPresetGroupId(cb.id))
    .map((cb) => cb.id);

  return cfg;
}

function callIfFn(name) {
  if (typeof globalThis[name] === "function") {
    try {
      globalThis[name]();
    } catch (e) {
      console.warn(`Preset apply: ${name} failed`, e);
    }
  }
}

// Restore a captured config onto the live controls, cascading through the
// existing UI handlers so derived/rendered state stays consistent.
function applyPresetConfig(cfg) {
  if (!cfg) return;

  // Providers first: they drive which exclude options render. Mutate the
  // shared array in place (avoids duplicate-push from toggleCloudProvider).
  if (Array.isArray(cfg.providers)) {
    PRESET_PROVIDER_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = cfg.providers.includes(id);
    });
    if (
      typeof selectedProviders !== "undefined" &&
      Array.isArray(selectedProviders)
    ) {
      selectedProviders.length = 0;
      PRESET_PROVIDER_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.checked) selectedProviders.push(id);
      });
    }
  }

  // Recommendation type radio.
  if (cfg.recommendationType) {
    document
      .querySelectorAll('input[name="recommendationType"]')
      .forEach((r) => {
        r.checked = r.value === cfg.recommendationType;
      });
  }
  callIfFn("handleRecommendationTypeChange");

  // Number inputs before toggleOptimizationMode so derived range fields
  // (keepMin/upsizeMin) recompute consistently.
  Object.entries(cfg.numbers || {}).forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  });

  // Simple checkboxes.
  Object.entries(cfg.checkboxes || {}).forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!v;
  });

  // Cascade the toggles that show/hide (and, for excludes, populate) controls.
  callIfFn("toggleOptimizationMode");
  callIfFn("toggleInstanceFamilyNameFilter");
  callIfFn("toggleProcessorManufacturerFilter");
  callIfFn("toggleMainFamiliesFilter");
  callIfFn("updateExcludeControls"); // ensure the exclude grid exists to re-check
  callIfFn("toggleExcludeTypes");
  callIfFn("toggleCurrentGenerationFilter");

  // Text (rule-engine) inputs + conflict re-check.
  Object.entries(cfg.texts || {}).forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  });
  callIfFn("checkRuleConflicts");

  // Dynamic per-provider filter selections: clear all, then re-check saved.
  document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    if (cb.id && isPresetGroupId(cb.id)) cb.checked = false;
  });
  (cfg.groupChecked || []).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = true;
  });
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function pEsc(s) {
  return typeof escapeHtml === "function"
    ? escapeHtml(String(s))
    : String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
}

function renderPresetsBar() {
  const host = document.getElementById("filterPresetsBar");
  if (!host) return;
  disarmAllPresetButtons();

  const presets = presetsForPage();
  const names = Object.keys(presets).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const options = [`<option value="">— Select a preset —</option>`]
    .concat(names.map((n) => `<option value="${pEsc(n)}">${pEsc(n)}</option>`))
    .join("");

  host.innerHTML = `
    <div class="preset-bar">
      <label class="preset-label" for="presetSelect">⭐ Filter presets</label>
      <select id="presetSelect" class="form-control preset-select" onchange="onPresetSelectChange()">
        ${options}
      </select>
      <button type="button" class="btn btn-secondary" id="presetApplyBtn" onclick="applySelectedPreset()" disabled>Apply</button>
      <button type="button" class="btn btn-secondary" id="presetUpdateBtn" onclick="updateSelectedPreset()" onblur="disarmPresetButton('presetUpdateBtn')" disabled>Update</button>
      <button type="button" class="btn btn-secondary" id="presetDeleteBtn" onclick="deleteSelectedPreset()" onblur="disarmPresetButton('presetDeleteBtn')" disabled>Delete</button>
      <button type="button" class="btn btn-secondary" id="presetSaveAsBtn" onclick="savePresetAs()">💾 Save current as…</button>
      <span id="presetSaveForm" class="preset-save-form hidden">
        <label class="sr-only" for="presetNameInput">Preset name</label>
        <input id="presetNameInput" class="form-control preset-name-input" type="text" placeholder="Preset name" maxlength="60" onkeydown="onPresetNameKeydown(event)" oninput="disarmPresetButton('presetSaveConfirmBtn')" />
        <button type="button" class="btn btn-primary" id="presetSaveConfirmBtn" onclick="confirmSavePreset()" onblur="disarmPresetButton('presetSaveConfirmBtn')">Save</button>
        <button type="button" class="btn btn-secondary" onclick="cancelSavePreset()">Cancel</button>
      </span>
      <span id="presetStatus" class="preset-status" role="status" aria-live="polite"></span>
    </div>`;
}

function setPresetStatus(msg, ok) {
  const el = document.getElementById("presetStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = ok === false ? "var(--red-strong)" : "var(--good-strong)";
}

function selectedPresetName() {
  const sel = document.getElementById("presetSelect");
  return sel ? sel.value : "";
}

function onPresetSelectChange() {
  disarmAllPresetButtons();
  const has = !!selectedPresetName();
  ["presetApplyBtn", "presetUpdateBtn", "presetDeleteBtn"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = !has;
  });
  setPresetStatus("");
}

// ─── Inline confirmation (replaces window.prompt / window.confirm) ────────────
// Destructive/overwriting actions are two-step: the first click arms the
// button (label swap + status hint), a second click within 4s runs the
// action; moving focus away, editing the name, changing the selection, or
// the timeout disarms it.

const presetArm = {}; // button id → { timer, label, msg }

function armPresetButton(id, armedLabel, armMsg, action) {
  const btn = document.getElementById(id);
  if (!btn) return;
  if (presetArm[id]) {
    disarmPresetButton(id);
    action();
    return;
  }
  presetArm[id] = {
    timer: setTimeout(() => disarmPresetButton(id), 4000),
    label: btn.textContent,
    msg: armMsg,
  };
  btn.textContent = armedLabel;
  if (btn.classList) btn.classList.add("preset-armed");
  setPresetStatus(armMsg, false);
}

function disarmPresetButton(id) {
  const st = presetArm[id];
  if (!st) return;
  clearTimeout(st.timer);
  delete presetArm[id];
  const btn = document.getElementById(id);
  if (btn) {
    btn.textContent = st.label;
    if (btn.classList) btn.classList.remove("preset-armed");
  }
  // Clear the arming hint, but never a message someone else set since.
  const status = document.getElementById("presetStatus");
  if (status && status.textContent === st.msg) setPresetStatus("");
}

function disarmAllPresetButtons() {
  Object.keys(presetArm).forEach(disarmPresetButton);
}

// "Save current as…" opens an inline name form in the bar.
function savePresetAs() {
  const form = document.getElementById("presetSaveForm");
  const input = document.getElementById("presetNameInput");
  if (!form || !input) return;
  const opener = document.getElementById("presetSaveAsBtn");
  if (opener && opener.classList) opener.classList.add("hidden");
  if (form.classList) form.classList.remove("hidden");
  input.value = "";
  setPresetStatus("");
  if (typeof input.focus === "function") input.focus();
}

function cancelSavePreset() {
  disarmPresetButton("presetSaveConfirmBtn");
  const form = document.getElementById("presetSaveForm");
  const opener = document.getElementById("presetSaveAsBtn");
  if (form && form.classList) form.classList.add("hidden");
  if (opener && opener.classList) opener.classList.remove("hidden");
}

function onPresetNameKeydown(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    confirmSavePreset();
  } else if (e.key === "Escape") {
    cancelSavePreset();
  }
}

function confirmSavePreset() {
  const input = document.getElementById("presetNameInput");
  const name = ((input && input.value) || "").trim();
  if (!name) {
    setPresetStatus("Enter a name for the preset.", false);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(presetsForPage(), name)) {
    // Arms on the first click; the second click lands in the armed branch
    // and runs the overwrite with whatever the name field holds then.
    armPresetButton(
      "presetSaveConfirmBtn",
      "Overwrite?",
      `A preset named "${name}" already exists — click again to overwrite.`,
      () => writePreset(name, "Saved"),
    );
    return;
  }
  writePreset(name, "Saved");
}

// Snapshot the current controls into the named preset and reflect it in the
// bar (re-render collapses the save form and picks the preset in the select).
function writePreset(name, verb) {
  const store = loadPresetsStore();
  const page = presetsPageKey();
  store[page] = store[page] || {};
  store[page][name] = { savedAt: Date.now(), config: capturePresetConfig() };

  if (!savePresetsStore(store)) {
    setPresetStatus("Could not save preset (storage unavailable).", false);
    return;
  }
  renderPresetsBar();
  const sel = document.getElementById("presetSelect");
  if (sel) sel.value = name;
  onPresetSelectChange();
  setPresetStatus(`${verb} "${name}".`, true);
}

function applySelectedPreset() {
  const name = selectedPresetName();
  if (!name) return;
  const entry = presetsForPage()[name];
  if (!entry) {
    setPresetStatus(`Preset "${name}" no longer exists.`, false);
    return;
  }
  if (!entry.config) {
    setPresetStatus(
      `Preset "${name}" is corrupted and could not be applied.`,
      false,
    );
    return;
  }
  applyPresetConfig(entry.config);
  setPresetStatus(`Applied "${name}".`, true);
}

function updateSelectedPreset() {
  const name = selectedPresetName();
  if (!name) return;
  armPresetButton(
    "presetUpdateBtn",
    "Confirm update?",
    `Overwrite "${name}" with the current configuration? Click again to confirm.`,
    () => {
      const store = loadPresetsStore();
      const page = presetsPageKey();
      store[page] = store[page] || {};
      store[page][name] = {
        savedAt: Date.now(),
        config: capturePresetConfig(),
      };

      if (!savePresetsStore(store)) {
        setPresetStatus(
          "Could not update preset (storage unavailable).",
          false,
        );
        return;
      }
      setPresetStatus(`Updated "${name}".`, true);
    },
  );
}

function deleteSelectedPreset() {
  const name = selectedPresetName();
  if (!name) return;
  armPresetButton(
    "presetDeleteBtn",
    "Confirm delete?",
    `Delete preset "${name}"? Click again to confirm.`,
    () => {
      const store = loadPresetsStore();
      const page = presetsPageKey();
      if (store[page]) delete store[page][name];

      if (!savePresetsStore(store)) {
        setPresetStatus(
          "Could not delete preset (storage unavailable).",
          false,
        );
        return;
      }
      renderPresetsBar();
      onPresetSelectChange();
      setPresetStatus(`Deleted "${name}".`, true);
    },
  );
}

function initFilterPresets() {
  renderPresetsBar();
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", initFilterPresets);
}

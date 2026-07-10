// Filter presets verification (js/base/presets.js):
//   - capturePresetConfig snapshots the live controls into a JSON-safe object
//   - applyPresetConfig restores that snapshot (incl. clearing + re-checking
//     the dynamic per-provider filter checkboxes, and mutating selectedProviders
//     in place)
//   - capture → mutate → apply(captured) → capture is a faithful round-trip
//   - persistence is per-page-scoped and survives a storage read/write cycle
//   - save/overwrite/update/delete run through the inline form and two-step
//     confirm buttons (no window.prompt / window.confirm anywhere)
// presets.js only calls the provider toggle handlers when they exist
// (typeof guard), so this sandbox omits them — the capture/apply/persist core
// is exercised in isolation with a purpose-built fake DOM.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

// ── Fake DOM ────────────────────────────────────────────────────────────────
const els = {};
const allEls = [];
function reg(el) {
  els[el.id] = el;
  allEls.push(el);
  return el;
}
function makeEl(props) {
  const el = Object.assign(
    {
      id: "",
      type: "",
      name: "",
      value: "",
      checked: false,
      textContent: "",
      disabled: false,
      style: {},
      classes: new Set(),
      focus: () => {},
    },
    props,
  );
  el.classList = {
    add: (c) => el.classes.add(c),
    remove: (c) => el.classes.delete(c),
    contains: (c) => el.classes.has(c),
  };
  return reg(el);
}

// The control surface is built from presets.js's own constant lists after the
// module loads (see below the load), so the test auto-syncs with the source.

const document = {
  readyState: "complete",
  addEventListener: () => {},
  getElementById: (id) => els[id] || null,
  querySelector: (sel) => {
    if (sel === 'input[name="recommendationType"]:checked')
      return (
        allEls.find((e) => e.name === "recommendationType" && e.checked) || null
      );
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel === 'input[type="checkbox"]')
      return allEls.filter((e) => e.type === "checkbox");
    if (sel === 'input[name="recommendationType"]')
      return allEls.filter((e) => e.name === "recommendationType");
    return [];
  },
};

const storage = {};
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  document,
  setTimeout,
  clearTimeout,
  __page: "aws",
  selectedProviders: [],
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => {
      storage[k] = String(v);
    },
    removeItem: (k) => {
      delete storage[k];
    },
  },
};
sandbox.window = sandbox;
sandbox.currentSourcePage = () => sandbox.__page;
const ctx = vm.createContext(sandbox);
const run = (expr) => vm.runInContext(expr, ctx, { filename: "presets-test" });

vm.runInContext(
  fs.readFileSync(path.join(REPO, "js/base/presets.js"), "utf8"),
  ctx,
  { filename: "js/base/presets.js" },
);

// Build the fake control surface from presets.js's constants so a newly
// captured field automatically gains a matching fake element.
const constArr = (name) => JSON.parse(run(`JSON.stringify(${name})`));
makeEl({
  id: "likeToLike",
  type: "radio",
  name: "recommendationType",
  value: "like-to-like",
});
makeEl({
  id: "optimized",
  type: "radio",
  name: "recommendationType",
  value: "optimized",
});
makeEl({
  id: "both",
  type: "radio",
  name: "recommendationType",
  value: "both",
});
constArr("PRESET_CHECKBOXES").forEach((id) => makeEl({ id, type: "checkbox" }));
constArr("PRESET_NUMBERS").forEach((id) => makeEl({ id, type: "number" }));
constArr("PRESET_TEXTS").forEach((id) => makeEl({ id, type: "text" }));
constArr("PRESET_PROVIDER_IDS").forEach((id) =>
  makeEl({ id, type: "checkbox" }),
);
// Two representative dynamic checkboxes per group prefix (incl. mc_proc_/mc_cat_).
constArr("PRESET_GROUP_PREFIXES").forEach((p) => {
  makeEl({ id: `${p}0`, type: "checkbox" });
  makeEl({ id: `${p}1`, type: "checkbox" });
});

// ── Harness ───────────────────────────────────────────────────────────────────
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
}
function set(id, patch) {
  Object.assign(els[id], patch);
}
function reset() {
  allEls.forEach((e) => {
    e.checked = false;
    if (e.type === "number" || e.type === "text") e.value = "";
  });
}

// ── A configuration to round-trip ─────────────────────────────────────────────
reset();
set("both", { checked: true });
set("cpuBased", { checked: true });
set("restrictProcessorManufacturers", { checked: true });
set("excludeTypes", { checked: true });
set("cpuDownsizeMax", { value: "30" });
set("cpuKeepMax", { value: "70" });
set("memoryDownsizeMax", { value: "45" });
set("ruleDefaultEnv", { value: "Production" });
set("ruleDefaultCompliance", { value: "PCI" });
set("aws", { checked: true });
set("azure", { checked: true });
set("processor_0", { checked: true });
set("exclude_0", { checked: true });
set("familyName_1", { checked: true });
set("mc_proc_0", { checked: true }); // multicloud cross-provider filters
set("mc_cat_0", { checked: true });

const cfgA = run("capturePresetConfig()");

check(
  "capture reads recommendation type",
  cfgA.recommendationType === "both",
  JSON.stringify(cfgA.recommendationType),
);
check(
  "capture reads checkbox states",
  cfgA.checkboxes.cpuBased === true &&
    cfgA.checkboxes.memoryBased === false &&
    cfgA.checkboxes.excludeTypes === true,
  JSON.stringify(cfgA.checkboxes),
);
check(
  "capture reads number + text inputs",
  cfgA.numbers.cpuDownsizeMax === "30" &&
    cfgA.numbers.cpuKeepMax === "70" &&
    cfgA.texts.ruleDefaultEnv === "Production" &&
    cfgA.texts.ruleDefaultCompliance === "PCI",
  JSON.stringify({ n: cfgA.numbers, t: cfgA.texts }),
);
check(
  "capture reads selected providers",
  JSON.stringify(cfgA.providers) === JSON.stringify(["aws", "azure"]),
  JSON.stringify(cfgA.providers),
);
check(
  "capture reads dynamic group checkboxes (incl. multicloud mc_ filters)",
  JSON.stringify(cfgA.groupChecked.slice().sort()) ===
    JSON.stringify([
      "exclude_0",
      "familyName_1",
      "mc_cat_0",
      "mc_proc_0",
      "processor_0",
    ]),
  JSON.stringify(cfgA.groupChecked),
);

// ── Mutate to a different state, then apply the captured config ────────────────
reset();
set("likeToLike", { checked: true });
set("memoryBased", { checked: true });
set("cpuDownsizeMax", { value: "99" });
set("ruleDefaultOS", { value: "Windows" });
set("gcp", { checked: true });
sandbox.selectedProviders.length = 0;
sandbox.selectedProviders.push("gcp");
set("mainFamily_0", { checked: true }); // a group box NOT in cfgA

run(`applyPresetConfig(${JSON.stringify(cfgA)})`);

check(
  "apply restores recommendation type radio",
  els.both.checked === true && els.likeToLike.checked === false,
  `both=${els.both.checked} likeToLike=${els.likeToLike.checked}`,
);
check(
  "apply restores checkboxes (and clears ones absent from preset)",
  els.cpuBased.checked === true && els.memoryBased.checked === false,
  `cpuBased=${els.cpuBased.checked} memoryBased=${els.memoryBased.checked}`,
);
check(
  "apply restores number + text inputs",
  els.cpuDownsizeMax.value === "30" &&
    els.ruleDefaultEnv.value === "Production",
  `cpuDownsizeMax=${els.cpuDownsizeMax.value} env=${els.ruleDefaultEnv.value}`,
);
check(
  "apply clears a text input not present in the preset",
  els.ruleDefaultOS.value === "",
  `ruleDefaultOS=${els.ruleDefaultOS.value}`,
);
check(
  "apply restores provider checkboxes",
  els.aws.checked === true &&
    els.azure.checked === true &&
    els.gcp.checked === false,
  `aws=${els.aws.checked} azure=${els.azure.checked} gcp=${els.gcp.checked}`,
);
check(
  "apply mutates selectedProviders in place",
  JSON.stringify(sandbox.selectedProviders) ===
    JSON.stringify(["aws", "azure"]),
  JSON.stringify(sandbox.selectedProviders),
);
check(
  "apply clears group boxes absent from preset (mainFamily_0)",
  els.mainFamily_0.checked === false,
  `mainFamily_0=${els.mainFamily_0.checked}`,
);
check(
  "apply re-checks saved group boxes (incl. mc_proc_/mc_cat_)",
  els.processor_0.checked === true &&
    els.exclude_0.checked === true &&
    els.familyName_1.checked === true &&
    els.mc_proc_0.checked === true &&
    els.mc_cat_0.checked === true,
  `processor_0=${els.processor_0.checked} mc_proc_0=${els.mc_proc_0.checked}`,
);

// ── Full round-trip: capture after apply equals the original ───────────────────
const cfgB = run("capturePresetConfig()");
check(
  "capture(after apply) deep-equals the original config",
  JSON.stringify({
    ...cfgB,
    groupChecked: cfgB.groupChecked.slice().sort(),
  }) ===
    JSON.stringify({ ...cfgA, groupChecked: cfgA.groupChecked.slice().sort() }),
  JSON.stringify(cfgB),
);

// ── Persistence + per-page scoping ─────────────────────────────────────────────
sandbox.__page = "aws";
run(
  `savePresetsStore({ aws: { "Prod PCI": { savedAt: 1, config: capturePresetConfig() } } })`,
);
check(
  "presetsForPage returns presets for the current page",
  Object.keys(run("presetsForPage()")).join(",") === "Prod PCI",
  JSON.stringify(run("presetsForPage()")),
);
sandbox.__page = "azure";
check(
  "presets are isolated per page (azure sees none of aws's)",
  Object.keys(run("presetsForPage()")).length === 0,
  JSON.stringify(run("presetsForPage()")),
);
check(
  "store round-trips through localStorage",
  run(
    `JSON.parse(localStorage.getItem("cloudInstanceRecommenderFilterPresets")).aws["Prod PCI"].config.recommendationType`,
  ) === "both",
);
check(
  "loadPresetsStore tolerates malformed JSON",
  (() => {
    storage["cloudInstanceRecommenderFilterPresets"] = "{not json";
    const out = run("loadPresetsStore()");
    return out && typeof out === "object" && Object.keys(out).length === 0;
  })(),
);

// ── Corrupt-config guard (applySelectedPreset must not falsely report success) ─
reg({ id: "presetSelect", value: "" });
reg({ id: "presetStatus", textContent: "", style: {} });
sandbox.__page = "aws";
run(`savePresetsStore({ aws: { "Broken": { savedAt: 1 } } })`); // entry with no config
els.presetSelect.value = "Broken";
run("applySelectedPreset()");
check(
  "applySelectedPreset reports corruption (not 'Applied') when config is missing",
  /corrupted/i.test(els.presetStatus.textContent) &&
    els.presetStatus.style.color === "var(--red-strong)",
  `status="${els.presetStatus.textContent}" color=${els.presetStatus.style.color}`,
);

// ── Inline save / two-step confirm flows (no window.prompt / window.confirm) ──
sandbox.__page = "aws";
run(`savePresetsStore({})`);
makeEl({ id: "presetSaveForm" });
makeEl({ id: "presetNameInput", type: "text" });
makeEl({ id: "presetSaveAsBtn", textContent: "💾 Save current as…" });
makeEl({ id: "presetSaveConfirmBtn", textContent: "Save" });
makeEl({ id: "presetUpdateBtn", textContent: "Update" });
makeEl({ id: "presetDeleteBtn", textContent: "Delete" });

check(
  "presets.js no longer calls window.prompt/window.confirm",
  !/window\.(prompt|confirm)\(/.test(
    fs.readFileSync(path.join(REPO, "js/base/presets.js"), "utf8"),
  ),
);

run("savePresetAs()");
check(
  "savePresetAs reveals the inline form and hides the opener",
  !els.presetSaveForm.classes.has("hidden") &&
    els.presetSaveAsBtn.classes.has("hidden"),
);

run("confirmSavePreset()");
check(
  "empty name → error status, nothing saved",
  /enter a name/i.test(els.presetStatus.textContent) &&
    Object.keys(run("presetsForPage()")).length === 0,
  els.presetStatus.textContent,
);

els.presetNameInput.value = "Prod baseline";
run("confirmSavePreset()");
check(
  "new name saves immediately",
  /^Saved "Prod baseline"/.test(els.presetStatus.textContent) &&
    Object.keys(run("presetsForPage()")).join(",") === "Prod baseline",
  els.presetStatus.textContent,
);

els.presetNameInput.value = "Prod baseline";
run("confirmSavePreset()");
check(
  "existing name arms the save button instead of overwriting",
  els.presetSaveConfirmBtn.textContent === "Overwrite?" &&
    /already exists/i.test(els.presetStatus.textContent),
  `label="${els.presetSaveConfirmBtn.textContent}" status="${els.presetStatus.textContent}"`,
);
run("confirmSavePreset()");
check(
  "second click overwrites and restores the button label",
  /^Saved "Prod baseline"/.test(els.presetStatus.textContent) &&
    els.presetSaveConfirmBtn.textContent === "Save",
  els.presetStatus.textContent,
);

els.presetSelect.value = "Prod baseline";
run("deleteSelectedPreset()");
check(
  "first Delete click arms (preset still stored)",
  els.presetDeleteBtn.textContent === "Confirm delete?" &&
    Object.keys(run("presetsForPage()")).length === 1,
  els.presetDeleteBtn.textContent,
);
run("deleteSelectedPreset()");
check(
  "second Delete click removes the preset and restores the label",
  Object.keys(run("presetsForPage()")).length === 0 &&
    /^Deleted "Prod baseline"/.test(els.presetStatus.textContent) &&
    els.presetDeleteBtn.textContent === "Delete",
  `status="${els.presetStatus.textContent}" label="${els.presetDeleteBtn.textContent}"`,
);

run(
  `savePresetsStore({ aws: { "P1": { savedAt: 1, config: capturePresetConfig() } } })`,
);
els.presetSelect.value = "P1";
run("updateSelectedPreset()");
check(
  "first Update click arms",
  els.presetUpdateBtn.textContent === "Confirm update?",
  els.presetUpdateBtn.textContent,
);
run("onPresetSelectChange()");
check(
  "changing the selection disarms the pending confirm",
  els.presetUpdateBtn.textContent === "Update",
  els.presetUpdateBtn.textContent,
);
check(
  "disarmed Update did not touch the stored preset",
  run(`presetsForPage()["P1"].savedAt`) === 1,
);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("presets-test: all checks passed");

// Filter presets verification (js/base/presets.js):
//   - capturePresetConfig snapshots the live controls into a JSON-safe object
//   - applyPresetConfig restores that snapshot (incl. clearing + re-checking
//     the dynamic per-provider filter checkboxes, and mutating selectedProviders
//     in place)
//   - capture → mutate → apply(captured) → capture is a faithful round-trip
//   - persistence is per-page-scoped and survives a storage read/write cycle
//   - save/overwrite/update/delete run through the inline form and two-step
//     confirm buttons (no window.prompt / window.confirm anywhere), and the
//     armed state auto-disarms when the 4s timer fires (fake timers)
//   - reserved names (__proto__ / constructor / prototype) are rejected on
//     save and import — assigning them as store keys would mutate the
//     object's prototype instead of adding a preset
//   - JSON export/import: validatePresetImport shape-checks, merge renames
//     collisions instead of overwriting, and an export round-trips back in
// presets.js only calls the provider toggle handlers when they exist
// (typeof guard), so this sandbox omits them — the capture/apply/persist core
// is exercised in isolation with a purpose-built fake DOM.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");

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
// Controllable timers so the 4s arm auto-disarm can be driven deterministically.
const timers = new Map();
let timerSeq = 0;
function fireTimers() {
  const due = [...timers.values()];
  timers.clear();
  due.forEach((fn) => fn());
}
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  document,
  setTimeout: (fn) => {
    timers.set(++timerSeq, fn);
    return timerSeq;
  },
  clearTimeout: (id) => {
    timers.delete(id);
  },
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
// Provided by app-core.js on a real page. Stubbed rather than loaded, because
// app-core's `let selectedProviders` would shadow the sandbox array these tests
// assert against. The real helper is covered by the suites that do load
// app-core.js (nomatch-export, app-summary, portfolio).
sandbox.exportFilename = (base, extension) =>
  `${base}_${new Date().toISOString().slice(0, 10)}.${extension}`;

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
makeEl({ id: "presetSelect", value: "" });
makeEl({ id: "presetStatus", textContent: "" });
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
// The form starts hidden, as in the production markup renderPresetsBar emits.
makeEl({ id: "presetSaveForm", classes: new Set(["hidden"]) });
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

run("cancelSavePreset()");
check(
  "cancel re-hides the form and restores the opener",
  els.presetSaveForm.classes.has("hidden") &&
    !els.presetSaveAsBtn.classes.has("hidden"),
);
run("savePresetAs()"); // reopen for the save flows below

run("confirmSavePreset()");
check(
  "empty name → error status, nothing saved",
  /enter a name/i.test(els.presetStatus.textContent) &&
    Object.keys(run("presetsForPage()")).length === 0,
  els.presetStatus.textContent,
);

els.presetNameInput.value = "__proto__";
run("confirmSavePreset()");
check(
  "reserved name __proto__ → rejected, nothing saved, no arm",
  /reserved/i.test(els.presetStatus.textContent) &&
    Object.keys(run("presetsForPage()")).length === 0 &&
    els.presetSaveConfirmBtn.textContent === "Save",
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

// ── Arm timeout: the 4s timer must revert the button on its own ───────────────
run("updateSelectedPreset()");
check(
  "arming schedules exactly one disarm timer",
  els.presetUpdateBtn.textContent === "Confirm update?" && timers.size === 1,
  `label="${els.presetUpdateBtn.textContent}" timers=${timers.size}`,
);
fireTimers();
check(
  "timer fire auto-disarms: label + status reset, preset untouched",
  els.presetUpdateBtn.textContent === "Update" &&
    els.presetStatus.textContent === "" &&
    run(`presetsForPage()["P1"].savedAt`) === 1,
  `label="${els.presetUpdateBtn.textContent}" status="${els.presetStatus.textContent}"`,
);
run("updateSelectedPreset()");
check(
  "click after the timeout re-arms instead of running the action",
  els.presetUpdateBtn.textContent === "Confirm update?" &&
    run(`presetsForPage()["P1"].savedAt`) === 1,
  els.presetUpdateBtn.textContent,
);
run("onPresetSelectChange()"); // disarm before the next section

// ── Export / import: pure validate + merge ─────────────────────────────────────
sandbox.badPayloads = [
  null,
  [],
  "text",
  {},
  { presets: [] },
  { presets: {} },
  { presets: { X: {} } },
  { presets: { X: { savedAt: 1 } } },
];
check(
  "validatePresetImport rejects malformed payloads",
  run(`badPayloads.every((p) => validatePresetImport(p).ok === false)`),
);
// JSON.parse (unlike an object literal) creates "__proto__" as an own key,
// which is exactly what a crafted import file would deliver.
check(
  "validatePresetImport rejects reserved preset names (__proto__ / constructor / prototype)",
  run(`["__proto__", "constructor", "prototype"].every(
    (n) =>
      validatePresetImport(
        JSON.parse(
          '{"page":"aws","presets":{' +
            JSON.stringify(n) +
            ':{"savedAt":1,"config":{}}}}',
        ),
      ).ok === false,
  )`),
);
check(
  "validatePresetImport accepts a valid payload and surfaces the page",
  (() => {
    const v = run(
      `validatePresetImport({ page: "gcp", presets: { A: { savedAt: 1, config: {} } } })`,
    );
    return v.ok === true && v.page === "gcp" && !!v.presets.A;
  })(),
);

const mergeRes = run(`
  mergeImportedPresets(
    { Kept: { savedAt: 1, config: {} }, Dup: { savedAt: 2, config: {} }, "Dup (imported)": { savedAt: 3, config: {} } },
    { Fresh: { savedAt: 40, config: {} }, Dup: { savedAt: 50, config: {} }, NoStamp: { config: {} } },
    999,
  )
`);
check(
  "merge adds new names, keeps existing entries untouched",
  mergeRes.merged.Fresh.savedAt === 40 &&
    mergeRes.merged.Kept.savedAt === 1 &&
    mergeRes.merged.Dup.savedAt === 2,
  JSON.stringify(mergeRes.merged),
);
check(
  "collision renamed with a numbered suffix when '(imported)' is taken",
  mergeRes.merged["Dup (imported 2)"] &&
    mergeRes.merged["Dup (imported 2)"].savedAt === 50,
  JSON.stringify(Object.keys(mergeRes.merged)),
);
check(
  "missing savedAt stamped with `now`; counts reported",
  mergeRes.merged.NoStamp.savedAt === 999 &&
    mergeRes.added === 3 &&
    mergeRes.renamed === 1,
  JSON.stringify(mergeRes),
);

// ── Export / import: end-to-end through the fake DOM ───────────────────────────
const downloads = [];
sandbox.Blob = class {
  constructor(parts) {
    this.content = parts.join("");
  }
};
sandbox.URL = {
  createObjectURL: (blob) => {
    downloads.push({ blob });
    return "blob:x";
  },
  revokeObjectURL: () => {},
};
document.createElement = (tag) => ({
  tag,
  style: {},
  click() {
    if (this.tag === "a") downloads[downloads.length - 1].name = this.download;
  },
});
document.body = { appendChild: () => {}, removeChild: () => {} };

sandbox.__page = "aws";
run("savePresetsStore({})");
run("exportPresets()");
check(
  "export with no presets → status error, no download",
  /no presets/i.test(els.presetStatus.textContent) && downloads.length === 0,
  els.presetStatus.textContent,
);

run(
  `savePresetsStore({ aws: { "Alpha": { savedAt: 5, config: capturePresetConfig() } } })`,
);
run("exportPresets()");
check(
  "export downloads filter_presets_{page}_<date>.json",
  downloads.length === 1 &&
    /^filter_presets_aws_\d{4}-\d{2}-\d{2}\.json$/.test(downloads[0].name),
  JSON.stringify(downloads.map((d) => d.name)),
);
const exported = JSON.parse(downloads[0].blob.content);
check(
  "export payload carries page, exportedAt, and the presets",
  exported.page === "aws" &&
    typeof exported.exportedAt === "string" &&
    exported.presets.Alpha.savedAt === 5 &&
    !!exported.presets.Alpha.config,
  JSON.stringify(Object.keys(exported)),
);

run(`applyPresetImportText("{not json")`);
check(
  "import of invalid JSON → friendly status error",
  /not valid JSON/i.test(els.presetStatus.textContent),
  els.presetStatus.textContent,
);

run(
  `applyPresetImportText('{"page":"aws","presets":{"__proto__":{"savedAt":1,"config":{}}}}')`,
);
check(
  "import of a __proto__ preset is rejected end-to-end, store untouched",
  /reserved/i.test(els.presetStatus.textContent) &&
    Object.keys(run("presetsForPage()")).join(",") === "Alpha",
  els.presetStatus.textContent,
);

sandbox.__page = "azure";
sandbox.__importText = downloads[0].blob.content;
run("applyPresetImportText(__importText)");
check(
  "aws export imports onto the azure page with a cross-page note",
  Object.keys(run("presetsForPage()")).join(",") === "Alpha" &&
    /Imported 1 preset/.test(els.presetStatus.textContent) &&
    /aws page/.test(els.presetStatus.textContent),
  `presets=${JSON.stringify(Object.keys(run("presetsForPage()")))} status="${els.presetStatus.textContent}"`,
);
check(
  "imported preset keeps its original savedAt",
  run(`presetsForPage()["Alpha"].savedAt`) === 5,
);

// ── Legacy multi-cloud Min Gen migration ────────────────────────────────────
// A preset saved before MinGen went native carries the old shared
// #ruleDefaultMinGen on an AWS-centric 5/6/7 scale. On multicloud that id no
// longer exists, so applying it verbatim would set nothing and silently drop
// the user's constraint. It must be translated to what the OLD engine actually
// filtered at per provider.
console.log("[legacy multi-cloud Min Gen presets are migrated, not dropped]");
{
  // Simulate the multicloud page: the shared control is gone, the three native
  // ones are present.
  const shared = els.ruleDefaultMinGen;
  delete els.ruleDefaultMinGen;
  const toasts = [];
  sandbox.showToast = (msg, kind) => toasts.push({ msg, kind });

  const applyLegacy = (v) => {
    [
      "ruleDefaultMinGenAws",
      "ruleDefaultMinGenAzure",
      "ruleDefaultMinGenGcp",
    ].forEach((id) => {
      els[id].value = "";
    });
    toasts.length = 0;
    sandbox.__cfg = { texts: { ruleDefaultMinGen: String(v) } };
    run("applyPresetConfig(__cfg)");
    return {
      aws: els.ruleDefaultMinGenAws.value,
      azure: els.ruleDefaultMinGenAzure.value,
      gcp: els.ruleDefaultMinGenGcp.value,
    };
  };

  // Legacy 7 → the old engine filtered AWS gen 7, Azure v5, GCP rank 4 (n4).
  const g7 = applyLegacy(7);
  check(
    "legacy 7 becomes AWS 7 / Azure v5 / GCP n4",
    g7.aws === "7" && g7.azure === "5" && g7.gcp === "n4",
    JSON.stringify(g7),
  );
  // Legacy 5 → AWS 5, Azure v3 (5>4 → 5-2), GCP rank 2 (n2).
  const g5 = applyLegacy(5);
  check(
    "legacy 5 becomes AWS 5 / Azure v3 / GCP n2",
    g5.aws === "5" && g5.azure === "3" && g5.gcp === "n2",
    JSON.stringify(g5),
  );
  check("the migration is announced, not silent", toasts.length === 1);

  // Legacy 6 → GCP rank 3 (C3-era), which the page offers no option for.
  // It must NOT be quietly loosened to n2 or tightened to n4.
  const g6 = applyLegacy(6);
  check(
    "legacy 6 migrates AWS/Azure exactly and leaves GCP unset",
    g6.aws === "6" && g6.azure === "4" && g6.gcp === "",
    JSON.stringify(g6),
  );
  check(
    "the inexact GCP case is surfaced as a warning",
    toasts.length === 1 && toasts[0].kind === "warning",
    JSON.stringify(toasts),
  );

  // Regression: legacy 6 must ACTIVELY clear a prior GCP selection, not retain
  // whatever the control happened to show. applyLegacy zeroes the controls
  // first, so it can't catch this — seed a stale value and confirm it's blanked.
  [
    "ruleDefaultMinGenAws",
    "ruleDefaultMinGenAzure",
    "ruleDefaultMinGenGcp",
  ].forEach((id) => {
    els[id].value = "";
  });
  els.ruleDefaultMinGenGcp.value = "n4"; // left over from a previous preset
  toasts.length = 0;
  sandbox.__cfg = { texts: { ruleDefaultMinGen: "6" } };
  run("applyPresetConfig(__cfg)");
  check(
    "legacy 6 clears a stale GCP selection rather than leaving it active",
    els.ruleDefaultMinGenGcp.value === "",
    els.ruleDefaultMinGenGcp.value,
  );

  // A preset saved against the CURRENT design must pass through untouched.
  [
    "ruleDefaultMinGenAws",
    "ruleDefaultMinGenAzure",
    "ruleDefaultMinGenGcp",
  ].forEach((id) => {
    els[id].value = "";
  });
  sandbox.__cfg = {
    texts: { ruleDefaultMinGen: "7", ruleDefaultMinGenAws: "5" },
  };
  run("applyPresetConfig(__cfg)");
  check(
    "an explicit native value wins over the legacy translation",
    els.ruleDefaultMinGenAws.value === "5",
    els.ruleDefaultMinGenAws.value,
  );

  // Legacy "— any —" ("") is a saved no-constraint state too, not a missing
  // one: it must actively CLEAR the three native selects, not be dropped (which
  // would leave whatever stale generation a prior preset or manual edit put
  // there — the same "constraint silently changed on apply" bug in its inverse
  // form). Seed stale values and confirm all three blank out.
  els.ruleDefaultMinGenAws.value = "6";
  els.ruleDefaultMinGenAzure.value = "4";
  els.ruleDefaultMinGenGcp.value = "n4";
  toasts.length = 0;
  sandbox.__cfg = { texts: { ruleDefaultMinGen: "" } };
  run("applyPresetConfig(__cfg)");
  check(
    'legacy "— any —" clears all three native Min Gen selects, not just some',
    els.ruleDefaultMinGenAws.value === "" &&
      els.ruleDefaultMinGenAzure.value === "" &&
      els.ruleDefaultMinGenGcp.value === "",
    JSON.stringify({
      aws: els.ruleDefaultMinGenAws.value,
      azure: els.ruleDefaultMinGenAzure.value,
      gcp: els.ruleDefaultMinGenGcp.value,
    }),
  );

  // ...but an explicit native value saved alongside the legacy "— any —" still
  // wins (presence, not truthiness), so the clearing never overwrites a choice
  // the preset actually recorded.
  els.ruleDefaultMinGenAws.value = "";
  els.ruleDefaultMinGenGcp.value = "n4"; // stale, should clear
  sandbox.__cfg = {
    texts: { ruleDefaultMinGen: "", ruleDefaultMinGenAws: "6" },
  };
  run("applyPresetConfig(__cfg)");
  check(
    'legacy "— any —" clears unset natives but keeps an explicit native override',
    els.ruleDefaultMinGenAws.value === "6" &&
      els.ruleDefaultMinGenGcp.value === "",
    JSON.stringify({
      aws: els.ruleDefaultMinGenAws.value,
      gcp: els.ruleDefaultMinGenGcp.value,
    }),
  );

  els.ruleDefaultMinGen = shared;
  // On a single-provider page the shared control still exists and its value is
  // already native — the migration must not touch it.
  els.ruleDefaultMinGen.value = "";
  sandbox.__cfg = { texts: { ruleDefaultMinGen: "5" } };
  run("applyPresetConfig(__cfg)");
  check(
    "a single-provider page applies its native value unchanged",
    els.ruleDefaultMinGen.value === "5",
    els.ruleDefaultMinGen.value,
  );
  delete sandbox.showToast;
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("presets-test: all checks passed");
}

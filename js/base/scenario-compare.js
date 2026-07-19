// Scenario comparison: pin generation runs (same input, different config) and
// show which configuration settings differed plus a per-VM diff of what the
// recommendations changed. Two runs get a detailed pairwise view (config diff +
// old → new cells); three or more get an N-way matrix (one column per run).
//
// Runs are named (default "Run N", editable in place) and held in memory for
// the session only: a results grid can exceed localStorage's ~5MB, so
// cross-session save is deliberately out of scope (the roadmap notes it). A cap
// keeps the N-way matrix legible. Pinning captures a REFERENCE to that run's
// processedResults, which is never mutated (a new run reassigns the global to a
// fresh array). The diff builders are pure and unit-tested; the rest is UI.

let scenarios = [];
let scenarioSeq = 0;
const SCENARIO_MAX = 6;

function sEsc(s) {
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

// ─── Pure diff ─────────────────────────────────────────────────────────────────

// VM Name keys when every row has a unique, non-empty one; else null → pair by
// index (scenario comparison assumes the same input CSV across runs).
function scenarioRowKeys(results) {
  const names = results.map((r) => String(r["VM Name"] ?? "").trim());
  if (names.some((n) => !n)) return null;
  if (new Set(names).size !== names.length) return null;
  return names;
}

// The recommendation columns a run has that the comparison could not use, as a
// note fragment. A comparison silently narrowed to the columns two runs happen
// to share is the kind of thing a reader should be told: the diff below covers
// AWS only, even though one of these runs also produced Azure recommendations.
function excludedColsNote(allCols, comparedCols) {
  const dropped = allCols.filter((c) => !comparedCols.includes(c));
  if (!dropped.length) return "";
  return `Compared ${comparedCols.length} recommendation column(s) common to every run; not compared: ${dropped.join(", ")}.`;
}

function diffScenarios(a, b) {
  const colsA = getInstanceColumns(a.results);
  const colsB = getInstanceColumns(b.results);
  const cols = colsA.filter((c) => colsB.includes(c));

  const keysA = scenarioRowKeys(a.results);
  const keysB = scenarioRowKeys(b.results);
  const pairs = [];
  let note = "";

  if (keysA && keysB) {
    const bByName = new Map(b.results.map((r, i) => [keysB[i], r]));
    a.results.forEach((ra, i) => {
      const rb = bByName.get(keysA[i]);
      if (rb) pairs.push({ key: keysA[i], ra, rb });
    });
    if (
      pairs.length !== a.results.length ||
      a.results.length !== b.results.length
    ) {
      note = "Some VMs appear in only one run; compared the ones in both.";
    }
  } else {
    const n = Math.min(a.results.length, b.results.length);
    for (let i = 0; i < n; i++) {
      pairs.push({
        key: String(a.results[i]["VM Name"] ?? "") || `Row ${i + 1}`,
        ra: a.results[i],
        rb: b.results[i],
      });
    }
    if (a.results.length !== b.results.length) {
      note = `Runs have different row counts (${a.results.length} vs ${b.results.length}); compared the first ${n}.`;
    }
  }

  let changedCells = 0;
  let newlyMatched = 0;
  let newlyUnmatched = 0;
  const changedRows = [];

  pairs.forEach(({ key, ra, rb }) => {
    let rowChanged = false;
    const cells = cols.map((col) => {
      const av = ra[col] ?? "";
      const bv = rb[col] ?? "";
      const aMatch = !isNoMatchValue(av);
      const bMatch = !isNoMatchValue(bv);
      if (!aMatch && bMatch) newlyMatched++;
      if (aMatch && !bMatch) newlyUnmatched++;
      const changed = String(av) !== String(bv);
      if (changed) {
        changedCells++;
        rowChanged = true;
      }
      return { col, a: av, b: bv, changed };
    });
    if (rowChanged) changedRows.push({ key, cells });
  });

  const colNote = excludedColsNote([...new Set([...colsA, ...colsB])], cols);
  const fullNote = [note, colNote].filter(Boolean).join(" ");

  return {
    cols,
    note: fullNote,
    pairedRows: pairs.length,
    summary: {
      changedRows: changedRows.length,
      changedCells,
      newlyMatched,
      newlyUnmatched,
      // Each run's rate over its WHOLE result set, not over the compared cells.
      // Scoped to the intersection it could flatter a run badly: comparing a
      // multi-cloud run against an AWS-only one drops the Azure columns, so a
      // run whose Azure results all failed would report 100% here while its own
      // stats bar said otherwise. Same helper the stats bar uses, so the two
      // always agree. The delta counts above stay scoped to the compared
      // cells — that is what a diff is.
      matchRateA: matchStats(a.results).rate ?? 0,
      matchRateB: matchStats(b.results).rate ?? 0,
    },
    changedRows,
  };
}

// ─── Pure N-way diff ─────────────────────────────────────────────────────────
// Generalises diffScenarios to any number of runs (>= 2). A row's cell is
// "changed" when the runs do not all agree on it; a row is changed when any of
// its comparable cells is. Comparable columns are the instance columns common to
// EVERY run; rows pair by VM Name when every run has unique non-empty names,
// else by index — the same rule the pairwise diff uses, applied across the set.
// Kept separate from diffScenarios so the well-tested two-way path is untouched;
// the two agree on the two-run case (a cell differs iff a !== b).
function diffScenariosN(scenarios) {
  if (!scenarios || scenarios.length < 2) return null;

  // Comparable columns: intersect, preserving the first run's order.
  let cols = getInstanceColumns(scenarios[0].results);
  for (let i = 1; i < scenarios.length; i++) {
    const ci = getInstanceColumns(scenarios[i].results);
    cols = cols.filter((c) => ci.includes(c));
  }

  const keyed = scenarios.map((s) => ({ s, keys: scenarioRowKeys(s.results) }));
  const allNamed = keyed.every((k) => k.keys);

  let rowSets; // per run: Map(key → row)
  let orderedKeys; // the keys compared, in a stable order
  let note = "";

  if (allNamed) {
    rowSets = keyed.map(
      ({ s, keys }) => new Map(s.results.map((r, i) => [keys[i], r])),
    );
    // Compare only VMs present in EVERY run, in the first run's order.
    orderedKeys = keyed[0].keys.filter((k) => rowSets.every((m) => m.has(k)));
    const anyExtra = scenarios.some(
      (s) => s.results.length !== orderedKeys.length,
    );
    if (anyExtra) {
      note = "Some VMs are not in every run; compared the ones common to all.";
    }
  } else {
    const n = Math.min(...scenarios.map((s) => s.results.length));
    rowSets = scenarios.map(
      (s) => new Map(s.results.map((r, i) => [String(i), r])),
    );
    orderedKeys = [];
    for (let i = 0; i < n; i++) orderedKeys.push(String(i));
    if (scenarios.some((s) => s.results.length !== n)) {
      note = `Runs have different row counts; compared the first ${n}.`;
    }
  }

  const displayKey = (k) => {
    if (allNamed) return k;
    const r = rowSets[0].get(k);
    return String(r?.["VM Name"] ?? "") || `Row ${Number(k) + 1}`;
  };

  const changedRows = [];

  orderedKeys.forEach((k) => {
    let rowChanged = false;
    const cells = cols.map((col) => {
      const values = rowSets.map((m) => String(m.get(k)?.[col] ?? ""));
      const changed = values.some((v) => v !== values[0]);
      if (changed) rowChanged = true;
      return { col, values, changed };
    });
    if (rowChanged) changedRows.push({ key: displayKey(k), cells });
  });

  const allCols = [
    ...new Set(scenarios.flatMap((sc) => getInstanceColumns(sc.results))),
  ];
  const fullNoteN = [note, excludedColsNote(allCols, cols)]
    .filter(Boolean)
    .join(" ");

  return {
    cols,
    note: fullNoteN,
    pairedRows: orderedKeys.length,
    // Each run's rate over its WHOLE result set — see the note in diffScenarios.
    perScenario: scenarios.map((s) => ({
      label: s.label,
      matchRate: matchStats(s.results).rate ?? 0,
    })),
    changedRows,
  };
}

// ─── Pure config diff ──────────────────────────────────────────────────────────

// Friendly names for the flat controls captured by capturePresetConfig()
// (unknown ids fall back to the raw id).
const SCENARIO_CONFIG_LABELS = {
  cpuBased: "CPU-based sizing",
  memoryBased: "Memory-based sizing",
  currentGenerationOnly: "Current generation only",
  restrictInstanceFamilyNames: "Instance family name filter",
  restrictProcessorManufacturers: "Processor manufacturer filter",
  restrictMainFamilies: "Instance family/series filter",
  excludeTypes: "Exclude instance types",
  cpuDownsizeMax: "CPU downsize max %",
  cpuKeepMin: "CPU keep min %",
  cpuKeepMax: "CPU keep max %",
  cpuUpsizeMin: "CPU upsize min %",
  memoryDownsizeMax: "Memory downsize max %",
  memoryKeepMin: "Memory keep min %",
  memoryKeepMax: "Memory keep max %",
  memoryUpsizeMin: "Memory upsize min %",
  ruleDefaultEnv: "Default ENV",
  ruleDefaultOS: "Default OS",
  ruleDefaultWorkload: "Default Workload",
  ruleDefaultCompliance: "Default Compliance",
  ruleDefaultMinGen: "Default Min Gen",
  ruleDefaultMinGenAws: "Default Min Gen (AWS)",
  ruleDefaultMinGenAzure: "Default Min Gen (Azure)",
  ruleDefaultMinGenGcp: "Default Min Gen (GCP)",
};

// Dynamic filter checkbox id prefixes → readable group names (mirrors
// PRESET_GROUP_PREFIXES in presets.js; the id remainder is the option value).
const SCENARIO_GROUP_LABELS = {
  familyName_: "Family name",
  azureSeries_: "Azure series",
  gcpFamily_: "GCP series",
  processor_: "Processor",
  azureProcessor_: "Azure processor",
  gcpProcessor_: "GCP processor",
  mainFamily_: "Instance family",
  azureFamily_: "Azure VM family",
  gcpType_: "GCP category",
  exclude_: "Exclude",
  mc_proc_: "Processor architecture",
  mc_cat_: "Category",
};

function scenarioGroupLabel(id) {
  for (const prefix of Object.keys(SCENARIO_GROUP_LABELS)) {
    if (id.startsWith(prefix)) {
      return `${SCENARIO_GROUP_LABELS[prefix]}: ${id.slice(prefix.length)}`;
    }
  }
  return id;
}

// Pure: changed settings between two capturePresetConfig() snapshots, as
// [{setting, a, b}] display rows. Returns null when either snapshot is missing
// (presets.js wasn't loaded when that run was pinned); [] when nothing changed.
function diffScenarioConfigs(cfgA, cfgB) {
  if (!cfgA || !cfgB) return null;
  const rows = [];

  const rtA = String(cfgA.recommendationType ?? "");
  const rtB = String(cfgB.recommendationType ?? "");
  if (rtA !== rtB) {
    rows.push({ setting: "Recommendation type", a: rtA, b: rtB });
  }

  const provA = (cfgA.providers || []).join(", ");
  const provB = (cfgB.providers || []).join(", ");
  if (provA !== provB) {
    rows.push({ setting: "Providers", a: provA, b: provB });
  }

  // Flat keyed groups: a key missing on one side (control not on the page for
  // that run) shows as blank rather than being skipped.
  const scalarGroups = [
    ["checkboxes", (v) => (v ? "on" : "off")],
    ["numbers", (v) => String(v)],
    ["texts", (v) => String(v)],
  ];
  scalarGroups.forEach(([group, fmt]) => {
    const va = cfgA[group] || {};
    const vb = cfgB[group] || {};
    const keys = [...new Set([...Object.keys(va), ...Object.keys(vb)])];
    keys.forEach((key) => {
      const has = (o) => Object.prototype.hasOwnProperty.call(o, key);
      const a = has(va) ? fmt(va[key]) : "";
      const b = has(vb) ? fmt(vb[key]) : "";
      if (a !== b) {
        rows.push({ setting: SCENARIO_CONFIG_LABELS[key] || key, a, b });
      }
    });
  });

  // Dynamic filter selections: one row per checkbox that changed sides.
  const setA = new Set(cfgA.groupChecked || []);
  const setB = new Set(cfgB.groupChecked || []);
  [...new Set([...setA, ...setB])].forEach((id) => {
    const inA = setA.has(id);
    const inB = setB.has(id);
    if (inA !== inB) {
      rows.push({
        setting: scenarioGroupLabel(id),
        a: inA ? "✓ selected" : "—",
        b: inB ? "✓ selected" : "—",
      });
    }
  });

  return rows;
}

// ─── CSV export ─────────────────────────────────────────────────────────────────

// Pure: the whole comparison as one sectioned CSV — the run labels, the
// configuration changes, the summary, and the changed recommendation rows.
// Reuses the same pure diffs the on-screen comparison draws, so the file can
// never disagree with the table. escapeCsvCell (app-core.js) hardens every cell
// against CSV injection, exactly as the other exports do.
//
// Sectioned rather than one flat grid because the four parts have different
// shapes; blank lines separate them. Only CHANGED rows are written, matching
// what the comparison shows and what the roadmap asks for.
function buildScenarioComparisonCsv(a, b) {
  const esc = escapeCsvCell;
  const line = (cells) => cells.map(esc).join(",");
  const out = [];

  out.push(line(["Scenario comparison"]));
  out.push(line(["A", `${a.label} · ${a.at}`]));
  out.push(line(["B", `${b.label} · ${b.at}`]));
  out.push("");

  // Configuration changes.
  out.push(line(["Configuration changes (A → B)"]));
  const cfg = diffScenarioConfigs(a.config, b.config);
  if (cfg === null) {
    out.push(
      line(["Configuration snapshot unavailable for one or both runs."]),
    );
  } else if (!cfg.length) {
    out.push(line(["No configuration changed between the two runs."]));
  } else {
    out.push(line(["Setting", "A", "B"]));
    cfg.forEach((r) => out.push(line([r.setting, r.a || "—", r.b || "—"])));
  }
  out.push("");

  const d = diffScenarios(a, b);

  // Summary.
  out.push(line(["Summary"]));
  out.push(line(["Metric", "A", "B"]));
  out.push(line(["Match rate %", d.summary.matchRateA, d.summary.matchRateB]));
  out.push(
    line(["VMs changed", "", `${d.summary.changedRows} of ${d.pairedRows}`]),
  );
  out.push(line(["Newly matched", "", d.summary.newlyMatched]));
  out.push(line(["Newly unmatched", "", d.summary.newlyUnmatched]));
  if (d.note) out.push(line(["Note", d.note]));
  out.push("");

  // Changed recommendation rows: VM, then each comparable column as an (A)/(B)
  // pair so the change is legible in a spreadsheet.
  out.push(line(["Changed recommendations (A → B)"]));
  if (!d.cols.length) {
    out.push(line(["The two runs have no comparable recommendation columns."]));
  } else if (!d.changedRows.length) {
    out.push(line(["No recommendation changed between the two runs."]));
  } else {
    const header = ["VM"];
    d.cols.forEach((c) => header.push(`${c} (A)`, `${c} (B)`));
    out.push(line(header));
    d.changedRows.forEach((row) => {
      const cells = [row.key];
      row.cells.forEach((c) => cells.push(c.a ?? "", c.b ?? ""));
      out.push(line(cells));
    });
  }

  return out.join("\n");
}

// Pure: the N-way comparison as one sectioned CSV — the run labels, a per-run
// match-rate summary, and the rows that differ across the set, each comparable
// column expanded to one cell per run (`col [label]`). Used for 3+ runs; the
// two-run export keeps the richer pairwise format above.
function buildScenarioComparisonCsvN(list) {
  const esc = escapeCsvCell;
  const line = (cells) => cells.map(esc).join(",");
  const out = [];

  out.push(line(["Scenario comparison"]));
  list.forEach((s, i) => out.push(line([`S${i + 1}`, `${s.label} · ${s.at}`])));
  out.push("");

  const d = diffScenariosN(list);

  out.push(line(["Summary"]));
  out.push(line(["Scenario", "Match rate %"]));
  d.perScenario.forEach((p) => out.push(line([p.label, p.matchRate])));
  out.push(
    line(["VMs differing", `${d.changedRows.length} of ${d.pairedRows}`]),
  );
  if (d.note) out.push(line(["Note", d.note]));
  out.push("");

  out.push(line(["Differing recommendations across runs"]));
  if (!d.cols.length) {
    out.push(line(["The runs have no comparable recommendation columns."]));
  } else if (!d.changedRows.length) {
    out.push(line(["No recommendation differs across the runs."]));
  } else {
    const header = ["VM"];
    d.cols.forEach((c) =>
      list.forEach((s) => header.push(`${c} [${s.label}]`)),
    );
    out.push(line(header));
    d.changedRows.forEach((row) => {
      const cells = [row.key];
      row.cells.forEach((c) => c.values.forEach((v) => cells.push(v)));
      out.push(line(cells));
    });
  }

  return out.join("\n");
}

// Adaptive: the pairwise file for two runs (richer — carries the config diff),
// the N-way matrix for three or more.
function downloadScenarioComparison() {
  if (scenarios.length < 2) {
    showToast(
      "Pin at least two runs before exporting the comparison.",
      "warning",
    );
    return;
  }
  const csv =
    scenarios.length === 2
      ? buildScenarioComparisonCsv(scenarios[0], scenarios[1])
      : buildScenarioComparisonCsvN(scenarios);
  downloadCsv(csv, exportFilename("scenario_comparison", "csv"));
}

// ─── Pin / rename / clear ─────────────────────────────────────────────────────

function makeScenario(name) {
  scenarioSeq++;
  const label = (name && String(name).trim()) || `Run ${scenarioSeq}`;
  return {
    id: scenarioSeq,
    label,
    at: new Date().toLocaleTimeString(),
    providers:
      typeof selectedProviders !== "undefined" ? selectedProviders.slice() : [],
    // Reference is safe — processedResults is replaced (not mutated) each run.
    results: processedResults,
    // Config snapshot (best-effort; presets.js provides capturePresetConfig).
    config:
      typeof capturePresetConfig === "function" ? capturePresetConfig() : null,
  };
}

function pinScenario(name) {
  if (
    typeof processedResults === "undefined" ||
    !processedResults ||
    !processedResults.length
  ) {
    showToast("Generate recommendations first, then pin the run.", "warning");
    return;
  }
  if (scenarios.length >= SCENARIO_MAX) {
    showToast(
      `You can pin up to ${SCENARIO_MAX} runs — remove one to pin another.`,
      "warning",
    );
    return;
  }
  scenarios.push(makeScenario(name));
  renderScenarioBar();
  if (scenarios.length >= 2) renderScenarioComparison();
}

// Rename in place (blank keeps the current label). Re-renders so the comparison
// legend and any export pick up the new name immediately.
function renameScenario(id, name) {
  const s = scenarios.find((x) => x.id === id);
  if (!s) return;
  const v = String(name == null ? "" : name).trim();
  if (v) s.label = v;
  renderScenarioBar();
  if (scenarios.length >= 2) renderScenarioComparison();
}

function removeScenario(id) {
  scenarios = scenarios.filter((x) => x.id !== id);
  renderScenarioBar();
  if (scenarios.length >= 2) renderScenarioComparison();
  else {
    const result = document.getElementById("scenarioCompareResult");
    if (result) result.innerHTML = "";
  }
}

function clearScenarios() {
  scenarios = [];
  const result = document.getElementById("scenarioCompareResult");
  if (result) result.innerHTML = "";
  renderScenarioBar();
}

function compareScenarios() {
  if (scenarios.length >= 2) renderScenarioComparison();
}

// ─── UI ─────────────────────────────────────────────────────────────────────────

function updateScenarioCompare() {
  const section = document.getElementById("scenarioCompareSection");
  if (!section) return;
  section.classList.remove("hidden");
  renderScenarioBar();
}

// One chip per pinned run: an inline-editable name, its pin time, and a remove
// button. The name input is the rename affordance — no modal, no prompt().
function scenarioChip(s) {
  return `
      <span class="scenario-slot" data-id="${s.id}">
        <input class="scenario-name-input" type="text" value="${sEsc(s.label)}"
               onchange="renameScenario(${s.id}, this.value)"
               aria-label="Rename run ${sEsc(s.label)}" />
        <span class="scenario-at">${sEsc(s.at)}</span>
        <button type="button" class="scenario-remove" onclick="removeScenario(${s.id})"
                title="Remove ${sEsc(s.label)}" aria-label="Remove ${sEsc(s.label)}">✕</button>
      </span>`;
}

function renderScenarioBar() {
  const section = document.getElementById("scenarioCompareSection");
  if (!section) return;
  const canCompare = scenarios.length >= 2;
  const atCap = scenarios.length >= SCENARIO_MAX;
  const chips = scenarios.length
    ? scenarios.map(scenarioChip).join("")
    : `<span class="scenario-empty">No runs pinned yet — generate, tweak filters, and pin each run to compare.</span>`;
  const compareLabel = scenarios.length >= 3 ? "Compare all" : "Compare A ↔ B";
  section.innerHTML = `
    <div class="scenario-bar">
      <span class="scenario-title">🔀 Scenario comparison</span>
      <input id="scenarioNameInput" class="scenario-name-input scenario-name-new" type="text"
             placeholder="Name this run (optional)" aria-label="Name this run"
             ${atCap ? "disabled" : ""} />
      <button type="button" class="btn btn-secondary" onclick="pinScenario(scenarioNewName())" ${atCap ? "disabled" : ""}>📌 Pin this run</button>
      <span class="scenario-slots">${chips}</span>
      <button type="button" class="btn btn-secondary" onclick="compareScenarios()" ${canCompare ? "" : "disabled"}>${compareLabel}</button>
      <button type="button" class="btn btn-secondary" onclick="clearScenarios()" ${scenarios.length ? "" : "disabled"}>Clear</button>
    </div>
    <div id="scenarioCompareResult"></div>
    <div id="scenarioLiveStatus" class="sr-only" role="status" aria-live="polite"></div>`;
}

// Reads (and clears) the "name this run" field, so the next pin starts empty.
function scenarioNewName() {
  const input = document.getElementById("scenarioNameInput");
  if (!input) return "";
  const v = input.value;
  input.value = "";
  return v;
}

// Announce comparison outcomes to screen readers via the persistent live
// region (the results table itself is deliberately not live — a polite
// one-line summary instead of a wall of cells).
function setScenarioLiveStatus(text) {
  const live = document.getElementById("scenarioLiveStatus");
  if (live) live.textContent = text;
}

// Two runs → the detailed pairwise view (config diff + old → new cells); three
// or more → the N-way matrix. The pairwise path is unchanged from v1.
function renderScenarioComparison() {
  const result = document.getElementById("scenarioCompareResult");
  if (!result || scenarios.length < 2) return;
  if (scenarios.length === 2) {
    renderPairwiseComparison(result, scenarios[0], scenarios[1]);
  } else {
    renderNWayComparison(result, scenarios);
  }
}

function renderPairwiseComparison(result, A, B) {
  const d = diffScenarios(A, B);
  if (!d.cols.length) {
    result.innerHTML = `<div class="scenario-note">These two runs have no comparable recommendation columns (different providers or recommendation types).</div>`;
    setScenarioLiveStatus(
      "Scenario comparison not possible: the two runs have no comparable recommendation columns.",
    );
    return;
  }

  // What changed in the configuration between the two pinned runs.
  const configDiff = diffScenarioConfigs(A.config, B.config);
  let configBlock;
  if (configDiff === null) {
    configBlock = `<div class="scenario-note">Configuration snapshot not available for one or both runs, so setting changes can't be shown.</div>`;
  } else if (!configDiff.length) {
    configBlock = `<div class="scenario-note">Both runs used the same filter configuration.</div>`;
  } else {
    const cfgRows = configDiff
      .map(
        (r) =>
          `<tr><td>${sEsc(r.setting)}</td><td class="scenario-a">${sEsc(r.a || "—")}</td><td class="scenario-b">${sEsc(r.b || "—")}</td></tr>`,
      )
      .join("");
    configBlock = `
      <div class="scenario-config">
        <div class="scenario-config-title">⚙️ Configuration changes (A → B)</div>
        <div class="scenario-scroll"><table class="scenario-table scenario-config-table">
          <thead><tr><th>Setting</th><th>A</th><th>B</th></tr></thead>
          <tbody>${cfgRows}</tbody></table></div>
      </div>`;
  }

  const delta = (n) =>
    n > 0
      ? `<span class="scenario-up">+${n}</span>`
      : n < 0
        ? `<span class="scenario-down">${n}</span>`
        : "0";

  const summary = `
    <div class="scenario-summary">
      <div class="scenario-kpi"><b>${d.summary.changedRows}</b><span>of ${d.pairedRows} VMs changed</span></div>
      <div class="scenario-kpi"><b>${d.summary.matchRateA}% → ${d.summary.matchRateB}%</b><span>match rate (A → B)</span></div>
      <div class="scenario-kpi"><b>${delta(d.summary.newlyMatched)}</b><span>newly matched</span></div>
      <div class="scenario-kpi"><b>${delta(-d.summary.newlyUnmatched)}</b><span>newly unmatched</span></div>
    </div>`;

  const note = d.note ? `<div class="scenario-note">${sEsc(d.note)}</div>` : "";

  let body;
  if (!d.changedRows.length) {
    body = `<div class="scenario-note">No recommendation changed between run A (${sEsc(A.label)}) and run B (${sEsc(B.label)}).</div>`;
  } else {
    const head = `<tr><th>VM</th>${d.cols
      .map((c) => `<th>${sEsc(c)}</th>`)
      .join("")}</tr>`;
    const rows = d.changedRows
      .map((row) => {
        const cells = row.cells
          .map((c) =>
            c.changed
              ? `<td class="scenario-changed"><span class="scenario-a">${sEsc(c.a || "—")}</span> → <span class="scenario-b">${sEsc(c.b || "—")}</span></td>`
              : `<td class="scenario-same">${sEsc(c.a || "—")}</td>`,
          )
          .join("");
        return `<tr><td>${sEsc(row.key)}</td>${cells}</tr>`;
      })
      .join("");
    body = `<div class="scenario-scroll"><table class="scenario-table">
      <thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  result.innerHTML = `
    <div class="scenario-result">
      <div class="scenario-legend">Comparing <b>A: ${sEsc(A.label)}</b> ↔ <b>B: ${sEsc(B.label)}</b> — showing only changed rows.
        <button type="button" class="btn btn-secondary" onclick="downloadScenarioComparison()" style="margin-left:8px;">⬇ Export comparison CSV</button>
      </div>
      ${configBlock}${summary}${note}${body}
    </div>`;

  const cfgPart =
    configDiff === null
      ? ""
      : `; ${configDiff.length} configuration setting${configDiff.length === 1 ? "" : "s"} changed`;
  setScenarioLiveStatus(
    `Scenario comparison ready: ${d.summary.changedRows} of ${d.pairedRows} VMs changed; ` +
      `match rate ${d.summary.matchRateA}% to ${d.summary.matchRateB}%${cfgPart}.`,
  );
}

// N-way: a two-level header (one group per comparable column, a sub-column per
// run) over the rows that differ across the set. Within a differing cell every
// value that departs from the first run's is highlighted, so the eye reads what
// moved without a legend. Config is not diffed here — pairwise settings changes
// don't generalise to N runs; the per-run match rate carries the headline.
function renderNWayComparison(result, list) {
  const d = diffScenariosN(list);
  if (!d.cols.length) {
    result.innerHTML = `<div class="scenario-note">These runs have no comparable recommendation columns (different providers or recommendation types).</div>`;
    setScenarioLiveStatus(
      "Scenario comparison not possible: the runs have no comparable recommendation columns.",
    );
    return;
  }

  const kpis = d.perScenario
    .map(
      (p) =>
        `<div class="scenario-kpi"><b>${p.matchRate}%</b><span>${sEsc(p.label)} match rate</span></div>`,
    )
    .join("");
  const summary = `
    <div class="scenario-summary">
      ${kpis}
      <div class="scenario-kpi"><b>${d.changedRows.length}</b><span>of ${d.pairedRows} VMs differ</span></div>
    </div>`;

  const note = d.note ? `<div class="scenario-note">${sEsc(d.note)}</div>` : "";

  let body;
  if (!d.changedRows.length) {
    body = `<div class="scenario-note">No recommendation differs across the ${list.length} runs.</div>`;
  } else {
    const groupHead = d.cols
      .map((c) => `<th colspan="${list.length}">${sEsc(c)}</th>`)
      .join("");
    const runHead = d.cols
      .map(() => list.map((s) => `<th>${sEsc(s.label)}</th>`).join(""))
      .join("");
    const head = `
      <tr><th rowspan="2">VM</th>${groupHead}</tr>
      <tr>${runHead}</tr>`;
    const rows = d.changedRows
      .map((row) => {
        const cells = row.cells
          .map((c) =>
            c.values
              .map((v, si) => {
                // Highlight only the values that depart from the first run's,
                // within a column that actually differs on this row.
                const differs = c.changed && v !== c.values[0];
                const cls = differs ? "scenario-changed scenario-b" : "";
                return `<td class="${cls}">${sEsc(v || "—")}</td>`;
              })
              .join(""),
          )
          .join("");
        return `<tr><td>${sEsc(row.key)}</td>${cells}</tr>`;
      })
      .join("");
    body = `<div class="scenario-scroll"><table class="scenario-table scenario-nway-table">
      <thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  const runList = list.map((s) => sEsc(s.label)).join(", ");
  result.innerHTML = `
    <div class="scenario-result">
      <div class="scenario-legend">Comparing <b>${list.length} runs</b> (${runList}) — showing only rows that differ across them.
        <button type="button" class="btn btn-secondary" onclick="downloadScenarioComparison()" style="margin-left:8px;">⬇ Export comparison CSV</button>
      </div>
      ${summary}${note}${body}
    </div>`;

  setScenarioLiveStatus(
    `Scenario comparison ready across ${list.length} runs: ${d.changedRows.length} of ${d.pairedRows} VMs differ.`,
  );
}

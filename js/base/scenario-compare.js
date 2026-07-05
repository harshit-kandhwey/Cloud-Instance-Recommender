// Scenario comparison: pin two generation runs (same input, different config)
// and show a per-VM diff of what the recommendations changed.
//
// Scenarios are held in memory for the session only (results grids can exceed
// localStorage's ~5MB); pinning captures a reference to that run's
// processedResults, which is never mutated (a new run reassigns the global to
// a fresh array). The diff builder is pure and unit-tested; the rest is UI.

let scenarioA = null;
let scenarioB = null;
let scenarioPinCount = 0;

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
  let matchedA = 0;
  let matchedB = 0;
  let totalCells = 0;
  const changedRows = [];

  pairs.forEach(({ key, ra, rb }) => {
    let rowChanged = false;
    const cells = cols.map((col) => {
      const av = ra[col] ?? "";
      const bv = rb[col] ?? "";
      const aMatch = !isNoMatchValue(av);
      const bMatch = !isNoMatchValue(bv);
      totalCells++;
      if (aMatch) matchedA++;
      if (bMatch) matchedB++;
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

  return {
    cols,
    note,
    pairedRows: pairs.length,
    summary: {
      changedRows: changedRows.length,
      changedCells,
      newlyMatched,
      newlyUnmatched,
      matchRateA: totalCells ? Math.round((matchedA / totalCells) * 100) : 0,
      matchRateB: totalCells ? Math.round((matchedB / totalCells) * 100) : 0,
    },
    changedRows,
  };
}

// ─── Pin / clear ────────────────────────────────────────────────────────────────

function makeScenario() {
  scenarioPinCount++;
  return {
    label: `Run ${scenarioPinCount}`,
    at: new Date().toLocaleTimeString(),
    providers:
      typeof selectedProviders !== "undefined"
        ? selectedProviders.slice()
        : [],
    // Reference is safe — processedResults is replaced (not mutated) each run.
    results: processedResults,
    // Config snapshot (best-effort; presets.js provides capturePresetConfig).
    config:
      typeof capturePresetConfig === "function" ? capturePresetConfig() : null,
  };
}

function pinScenario() {
  if (typeof processedResults === "undefined" || !processedResults || !processedResults.length) {
    alert("Generate recommendations first, then pin the run.");
    return;
  }
  const scenario = makeScenario();
  if (!scenarioA) scenarioA = scenario;
  else if (!scenarioB) scenarioB = scenario;
  else {
    // Both full — keep the two most recent: B becomes A, new run becomes B.
    scenarioA = scenarioB;
    scenarioB = scenario;
  }
  renderScenarioBar();
  if (scenarioA && scenarioB) renderScenarioComparison();
}

function clearScenarios() {
  scenarioA = null;
  scenarioB = null;
  const result = document.getElementById("scenarioCompareResult");
  if (result) result.innerHTML = "";
  renderScenarioBar();
}

function compareScenarios() {
  if (scenarioA && scenarioB) renderScenarioComparison();
}

// ─── UI ─────────────────────────────────────────────────────────────────────────

function scenarioSlotLabel(s) {
  return s ? `${sEsc(s.label)} · ${sEsc(s.at)}` : "—";
}

function updateScenarioCompare() {
  const section = document.getElementById("scenarioCompareSection");
  if (!section) return;
  section.classList.remove("hidden");
  renderScenarioBar();
}

function renderScenarioBar() {
  const section = document.getElementById("scenarioCompareSection");
  if (!section) return;
  const both = !!(scenarioA && scenarioB);
  section.innerHTML = `
    <div class="scenario-bar">
      <span class="scenario-title">🔀 Scenario comparison</span>
      <button type="button" class="btn btn-secondary" onclick="pinScenario()">📌 Pin this run</button>
      <span class="scenario-slot"><b>A:</b> ${scenarioSlotLabel(scenarioA)}</span>
      <span class="scenario-slot"><b>B:</b> ${scenarioSlotLabel(scenarioB)}</span>
      <button type="button" class="btn btn-secondary" onclick="compareScenarios()" ${both ? "" : "disabled"}>Compare A ↔ B</button>
      <button type="button" class="btn btn-secondary" onclick="clearScenarios()" ${scenarioA || scenarioB ? "" : "disabled"}>Clear</button>
    </div>
    <div id="scenarioCompareResult"></div>`;
}

function renderScenarioComparison() {
  const result = document.getElementById("scenarioCompareResult");
  if (!result || !scenarioA || !scenarioB) return;

  const d = diffScenarios(scenarioA, scenarioB);
  if (!d.cols.length) {
    result.innerHTML = `<div class="scenario-note">These two runs have no comparable recommendation columns (different providers or recommendation types).</div>`;
    return;
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
    body = `<div class="scenario-note">No recommendation changed between run A (${sEsc(scenarioA.label)}) and run B (${sEsc(scenarioB.label)}).</div>`;
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
      <div class="scenario-legend">Comparing <b>A: ${sEsc(scenarioA.label)}</b> ↔ <b>B: ${sEsc(scenarioB.label)}</b> — showing only changed rows.</div>
      ${summary}${note}${body}
    </div>`;
}

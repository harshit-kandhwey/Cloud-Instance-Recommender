// Results preview: stats bar, sortable/searchable preview table, and
// download button arrangement.

// ─── Generation stats bar ─────────────────────────────────────────────────────
// isNoMatchValue / getInstanceColumns live in app-core.js (loaded first on
// every page) so the stats bar, exports, and the App Portfolio page share one
// definition.

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

  // Distinct applications, when the results carry an App Name column
  const appCount = allKeys.includes("App Name")
    ? new Set(
        results.map((r) => String(r["App Name"] || "").trim()).filter(Boolean),
      ).size
    : 0;

  // What optimizing actually bought, per provider. Upsizing is reported just as
  // plainly as downsizing — a stat that only ever shows a win is not a stat.
  const savingsChips = computeSizingSavings(results)
    .map((s) => {
      const parts = [];
      if (s.vcpus !== 0)
        parts.push(`${s.vcpus > 0 ? "−" : "+"}${Math.abs(s.vcpus)} vCPU`);
      if (s.memory !== 0)
        parts.push(`${s.memory > 0 ? "−" : "+"}${Math.abs(s.memory)} GB`);
      const saving = s.vcpus >= 0 && s.memory >= 0;
      const color = saving ? "var(--good-strong)" : "var(--amber-strong)";
      return `<span style="color:${color};" title="Optimized sizing across ${s.rows} matched row(s), compared with the ${s.baseline} recommendation">⚡ ${escapeHtml(s.provider)} <strong>${parts.join(" · ")}</strong></span>`;
    })
    .join("");

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
      ${appCount > 0 ? `<span style="color:var(--text-body);">🧩 <strong>${appCount}</strong> apps</span>` : ""}
      ${savingsChips}
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

  // Scroll so the download button stays visible at the top of the viewport;
  // the preview flows below and the user scrolls down for rows that don't fit.
  // (Anchoring on the preview itself pushed the download button off-screen.)
  const scrollAnchor = document.getElementById("downloadSection") || container;
  scrollAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
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
    // Same comparator the exports use, so the file matches the screen's order
    sortResultRows(rows, displayCols[sortCol], sortDir);
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
      <span style="display:flex;align-items:center;gap:8px;">
        <input id="previewSearch" type="text" placeholder="🔍 Filter rows…" aria-label="Filter preview rows"
          oninput="window._previewFilterChanged(this.value)"
          style="padding:5px 10px;border:1px solid var(--border-slate);border-radius:6px;font-size:12px;min-width:220px;background:var(--surface);color:var(--text);" />
        <button type="button" onclick="copyPreviewToClipboard()"
          title="Copy every row shown (all ${rows.length}, not just the first 20) as tab-separated text, ready to paste into a spreadsheet"
          style="padding:5px 10px;border:1px solid var(--border-slate);border-radius:6px;font-size:12px;background:var(--surface-alt);color:var(--text-body);cursor:pointer;white-space:nowrap;">📋 Copy</button>
      </span>
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
    const bg = allNoMatch
      ? "var(--danger-bg-soft)"
      : ri % 2 === 0
        ? "var(--surface)"
        : "var(--surface-alt-2)";
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
          if (optVal < l2lVal)
            diffStyle = "color:var(--good-strong);font-weight:600;";
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
  // A filter narrows only the preview; downloads always carry every row. Say so
  // whenever a filter is active — including when it narrows below 20 rows, where
  // the "showing first 20" line alone would leave the difference invisible.
  if (needle) {
    html += `<p style="font-size:0.82em;color:var(--text-soft);margin-top:4px;">Filter matches ${rows.length} of ${results.length} rows${rows.length > 20 ? " (showing the first 20)" : ""}. Downloads always contain the full ${results.length}-row dataset, in the sort order shown.</p>`;
  } else if (rows.length > 20) {
    html += `<p style="font-size:0.82em;color:var(--text-soft);margin-top:4px;">Showing first 20 rows. Download the CSV for the full ${results.length}-row dataset.</p>`;
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
      if (searchInput.setSelectionRange)
        searchInput.setSelectionRange(pos, pos);
    }
  }
}

const PROVIDER_LABELS = { aws: "AWS", azure: "Azure", gcp: "GCP" };

// The results on screen belong to the providers that were selected when Generate
// ran. Changing the checkboxes afterwards does not re-run anything, so the
// columns would quietly describe a selection the user no longer has. Say so
// instead of letting them read a stale table (or export it).
function updateStaleResultsNotice() {
  const notice = document.getElementById("resultsStaleNotice");
  if (!notice) return;

  const ranWith = window._resultsProviders;
  const hasResults =
    typeof processedResults !== "undefined" &&
    processedResults &&
    processedResults.length > 0;
  const stale =
    hasResults &&
    Array.isArray(ranWith) &&
    (ranWith.length !== selectedProviders.length ||
      ranWith.some((p) => !selectedProviders.includes(p)));

  if (!stale) {
    notice.classList.add("hidden");
    notice.innerHTML = "";
    return;
  }

  const named = ranWith.map((p) => PROVIDER_LABELS[p] || p).join(", ");
  notice.className = "alert alert-warning";
  notice.innerHTML = `⚠️ These results were generated for <strong>${escapeHtml(named)}</strong>, which is no longer what you have selected. Click Generate to update them — the table and every download still describe the old selection.`;
  notice.classList.remove("hidden");
}

// Tab-separated, because that is what a spreadsheet expects from the clipboard:
// paste lands in cells without an import step. Commas would arrive as one column.
function buildPreviewTsv(rows, displayCols) {
  const cell = (v) =>
    String(v ?? "")
      .replace(/[\t\r\n]+/g, " ")
      .trim();
  return [
    displayCols.map(cell).join("\t"),
    ...rows.map((row) => displayCols.map((c) => cell(row[c])).join("\t")),
  ].join("\n");
}

// Copies every row the filter currently matches — not just the 20 rendered —
// in the preview's sort order, so the clipboard agrees with the screen for the
// same reason the exports do.
function copyPreviewToClipboard() {
  const state = window._previewState;
  if (!state || !state.results || !state.results.length) return;

  const needle = String(state.filter || "")
    .trim()
    .toLowerCase();
  let rows = needle
    ? state.results.filter((row) =>
        state.displayCols.some((c) =>
          String(row[c] ?? "")
            .toLowerCase()
            .includes(needle),
        ),
      )
    : [...state.results];
  if (state.sortCol !== null) {
    sortResultRows(rows, state.displayCols[state.sortCol], state.sortDir);
  }

  const tsv = buildPreviewTsv(rows, state.displayCols);
  const done = () =>
    showToast(`Copied ${rows.length} row(s) to the clipboard`, "success", 3000);
  const failed = () =>
    showToast("Could not copy to the clipboard", "warning", 4000);

  // navigator.clipboard needs a secure context; a page opened from file:// has
  // none, so fall back to the old selection-based copy rather than doing nothing
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(tsv).then(done, () => {
      if (!copyViaTextarea(tsv)) failed();
      else done();
    });
    return;
  }
  if (copyViaTextarea(tsv)) done();
  else failed();
}
window.copyPreviewToClipboard = copyPreviewToClipboard;

function copyViaTextarea(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

// Offers the single filter change that rescues the most unmatched rows, so the
// user doesn't have to read the Nearest Miss column and work it out by hand.
function updateRelaxSuggestion(results) {
  const panel = document.getElementById("relaxSuggestion");
  if (!panel) return;

  const suggestion = computeRelaxSuggestion(results);
  window._relaxSuggestion = suggestion;

  if (!suggestion) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const { label, rescues, unmatched } = suggestion;
  panel.className = "alert alert-info";
  panel.innerHTML = `
    💡 <strong>${rescues}</strong> of the ${unmatched} unmatched row(s) would match if you relaxed one filter: <strong>${escapeHtml(label)}</strong>.
    <button type="button" class="btn btn-secondary" onclick="applyRelaxSuggestion()" style="margin-left: 8px; padding: 4px 12px; font-size: 13px;">🔓 Relax it and regenerate</button>`;
  panel.classList.remove("hidden");
}

// Turns the filter off and re-runs. Regenerating (rather than patching the
// results in place) keeps one source of truth: the results always come from the
// filters as they currently stand.
function applyRelaxSuggestion() {
  const suggestion = window._relaxSuggestion;
  if (!suggestion) return;

  const checkbox = document.getElementById(suggestion.control.id);
  if (!checkbox) return;
  checkbox.checked = false;

  // Let the control's own handler hide its sub-panel, so the form doesn't keep
  // showing options for a filter that is now off
  const handler = window[suggestion.control.toggle];
  if (typeof handler === "function") handler();

  showToast(`Relaxed "${suggestion.label}" — regenerating…`, "info", 4000);
  generateRecommendations();
}
window.applyRelaxSuggestion = applyRelaxSuggestion;

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

// ─── AWS Pricing Calculator bulk-template button(s) ───────────────────────────
// #downloadBtnsRow holds only the bulk-template button(s) inside the "AWS
// Pricing Calculator" download group (aws.html only). After a run with both
// L2L + Optimized types, split into one template per type to avoid
// double-counting in the calculator.

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
    row.innerHTML = `
      <button class="btn btn-secondary" onclick="downloadAWSBulkTemplate('l2l')" title="AWS Pricing Calculator Bulk Import — Like-to-Like instances only">
        🧾 Bulk Import (Like-to-Like)
      </button>
      <button class="btn btn-secondary" onclick="downloadAWSBulkTemplate('optimized')" title="AWS Pricing Calculator Bulk Import — Optimized instances only">
        🧾 Bulk Import (Optimized)
      </button>
    `;
  } else {
    // Single type: one bulk template button (auto-resolves to the present type)
    row.innerHTML = `
      <button class="btn btn-secondary" onclick="downloadAWSBulkTemplate()" title="AWS Pricing Calculator Bulk Import (EC2 Instances template)">
        🧾 Bulk Import Template
      </button>
    `;
  }
}

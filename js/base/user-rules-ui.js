// User-defined rules — the authoring UI (companion to user-rules.js, which holds
// the model/evaluator/storage). A small panel in the Generate section lets the
// user add, list and delete conditional rules ("if Workload = database, Include
// only r5"); the rules are stored per page and picked up on the next Generate.
//
// Page-only: this file touches the DOM and is NOT loaded in the worker. It leans
// on user-rules.js (normalizeUserRule / userRuleLabel / load- / saveUserRules /
// userRuleDimensionOptions / userRuleActionOptions) and on escapeHtml (app-core.js).

function renderUserRulesPanel() {
  const host = document.getElementById("userRulesPanel");
  if (!host) return;
  const rules = typeof loadUserRules === "function" ? loadUserRules() : [];

  const dimOptions = userRuleDimensionOptions()
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join("");
  const actionOptions = userRuleActionOptions()
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join("");

  const items = rules.length
    ? rules
        .map(
          (r) => `
        <li style="display:flex;align-items:center;gap:8px;padding:3px 0;">
          <span style="flex:1;font-size:0.9em;color:var(--text-body);">${escapeHtml(
            userRuleLabel(r),
          )}</span>
          <button type="button" class="btn btn-secondary" style="padding:2px 8px;font-size:0.8em;" onclick="deleteUserRule('${escapeHtml(
            r.id,
          )}')" aria-label="Delete rule: ${escapeHtml(userRuleLabel(r))}">✕</button>
        </li>`,
        )
        .join("")
    : `<li style="padding:3px 0;color:var(--text-soft);font-size:0.9em;">No custom rules yet.</li>`;

  host.innerHTML = `
    <div style="margin:10px 0;padding:10px 14px;border:1px solid var(--border-slate-light);border-radius:8px;background:var(--surface-alt);">
      <label style="font-weight:600;display:block;margin-bottom:2px;">🧩 Custom rules</label>
      <p style="margin:0 0 8px;font-size:0.82em;color:var(--text-soft);">Apply an Exclude or Include Only to every row whose ENV / OS / Workload / Compliance matches a value — for example, if Workload = database, Include only r5, r6. Rules apply on the next Generate.</p>
      <ul style="list-style:none;margin:0 0 8px;padding:0;">${items}</ul>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <span style="font-size:0.9em;color:var(--text-soft);">If</span>
        <label class="sr-only" for="urDimension">Dimension</label>
        <select id="urDimension" class="form-control" style="width:auto;">${dimOptions}</select>
        <span style="font-size:0.9em;color:var(--text-soft);">=</span>
        <label class="sr-only" for="urEquals">Value to match</label>
        <input id="urEquals" class="form-control" style="width:auto;" type="text" placeholder="e.g. database" maxlength="60" />
        <label class="sr-only" for="urAction">Action</label>
        <select id="urAction" class="form-control" style="width:auto;">${actionOptions}</select>
        <label class="sr-only" for="urTokens">Families or types</label>
        <input id="urTokens" class="form-control" style="width:auto;flex:1;min-width:140px;" type="text" placeholder="families/types, e.g. r5, r6 or burstable" maxlength="120" />
        <button type="button" class="btn btn-secondary" onclick="addUserRuleFromForm()">Add rule</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;">
        <button type="button" class="btn btn-secondary" onclick="exportUserRules()" title="Download this page's custom rules as a JSON file">📤 Export rules</button>
        <button type="button" class="btn btn-secondary" onclick="importUserRules()" title="Import custom rules from a JSON export file">📥 Import rules</button>
        <input type="file" id="userRulesImportInput" accept=".json,application/json" style="display:none;" onchange="handleUserRulesImportFile(event)" />
      </div>
      <span id="userRulesStatus" role="status" aria-live="polite" style="display:block;margin-top:6px;font-size:0.85em;"></span>
    </div>`;
}

function setUserRulesStatus(msg, ok) {
  const el = document.getElementById("userRulesStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = ok === false ? "var(--red-strong)" : "var(--good-strong)";
}

function addUserRuleFromForm() {
  const val = (id) => (document.getElementById(id) || {}).value || "";
  const rule =
    typeof normalizeUserRule === "function"
      ? normalizeUserRule({
          dimension: val("urDimension"),
          equals: val("urEquals"),
          action: val("urAction"),
          tokens: val("urTokens"),
        })
      : null;
  if (!rule) {
    setUserRulesStatus(
      "Enter a value to match and at least one family or type.",
      false,
    );
    return;
  }
  const rules = loadUserRules();
  rules.push(rule);
  if (!saveUserRules(rules)) {
    setUserRulesStatus("Could not save the rule (storage unavailable).", false);
    return;
  }
  // Re-render first (it rebuilds the status element), then report — so the
  // message lands on the fresh node, not the one just replaced.
  renderUserRulesPanel();
  setUserRulesStatus(`Added — ${userRuleLabel(rule)}`, true);
}

function deleteUserRule(id) {
  const rules = loadUserRules().filter((r) => r.id !== id);
  if (!saveUserRules(rules)) {
    setUserRulesStatus(
      "Could not delete the rule (storage unavailable).",
      false,
    );
    return;
  }
  renderUserRulesPanel();
  setUserRulesStatus("Rule deleted.", true);
}

// ─── Export / import (JSON) ───────────────────────────────────────────────────
// Rules are per-browser localStorage, per page; a JSON file moves them between
// machines/browsers. Mirrors the presets export/import (buildPresetExport /
// validatePresetImport / mergeImportedPresets) but over the rules array rather
// than the named-preset map. The export carries only the CURRENT page's rules.

function buildUserRulesExport(page, rules) {
  return {
    kind: "userRules",
    page,
    exportedAt: new Date().toISOString(),
    rules,
  };
}

// Pure: shape-check a parsed import payload. Every entry is run through
// normalizeUserRule (the same gate storage/UI/engine use), so a malformed rule
// in the file is dropped, not trusted. Returns { ok:true, page, rules } with at
// least one valid rule, or { ok:false, error }.
function validateUserRulesImport(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "not a custom-rules export file." };
  }
  if (!Array.isArray(payload.rules)) {
    return { ok: false, error: "no custom rules found in the file." };
  }
  const rules =
    typeof normalizeUserRule === "function"
      ? payload.rules.map(normalizeUserRule).filter(Boolean)
      : [];
  if (!rules.length) {
    return { ok: false, error: "the file contains no valid custom rules." };
  }
  return {
    ok: true,
    page: typeof payload.page === "string" ? payload.page : "",
    rules,
  };
}

// Pure: append imported rules to a page's list, skipping ones whose meaning
// already exists (same dimension + action + value + token set, case-insensitive)
// so re-importing the same file is a no-op rather than a pile of duplicates.
// Every appended rule gets a FRESH id: an imported rule may carry an id that
// collides with one already stored, and deleteUserRule filters by id — a
// collision would delete two rules at once. Returns { merged, added, skipped }.
function mergeImportedUserRules(existing, imported) {
  const keyOf = (r) =>
    [
      r.dimension,
      r.action,
      r.equals.toLowerCase(),
      r.tokens.map((t) => t.toLowerCase()).join(","),
    ].join("|");
  const seen = new Set((existing || []).map(keyOf));
  const merged = (existing || []).slice();
  let added = 0;
  let skipped = 0;
  (imported || []).forEach((r) => {
    const key = keyOf(r);
    if (seen.has(key)) {
      skipped++;
      return;
    }
    seen.add(key);
    const id = typeof _newRuleId === "function" ? _newRuleId() : r.id;
    merged.push({ ...r, id });
    added++;
  });
  return { merged, added, skipped };
}

function exportUserRules() {
  const page =
    typeof userRulesPageKey === "function" ? userRulesPageKey() : "index";
  const rules = loadUserRules();
  if (!rules.length) {
    setUserRulesStatus("No custom rules on this page to export.", false);
    return;
  }
  const payload = buildUserRulesExport(page, rules);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    typeof exportFilename === "function"
      ? exportFilename(`custom_rules_${page}`, "json")
      : `custom_rules_${page}.json`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
  setUserRulesStatus(`Exported ${rules.length} rule(s).`, true);
}

function importUserRules() {
  const input = document.getElementById("userRulesImportInput");
  if (input && typeof input.click === "function") input.click();
}

function handleUserRulesImportFile(event) {
  const file = event.target && event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => applyUserRulesImportText(String(reader.result || ""));
  reader.onerror = () =>
    setUserRulesStatus("Import failed: could not read the file.", false);
  reader.readAsText(file);
  // Reset so picking the same file again re-fires the change event.
  event.target.value = "";
}

function applyUserRulesImportText(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    setUserRulesStatus("Import failed: the file is not valid JSON.", false);
    return;
  }
  const v = validateUserRulesImport(payload);
  if (!v.ok) {
    setUserRulesStatus(`Import failed: ${v.error}`, false);
    return;
  }
  const { merged, added, skipped } = mergeImportedUserRules(
    loadUserRules(),
    v.rules,
  );
  if (!saveUserRules(merged)) {
    setUserRulesStatus(
      "Could not save imported rules (storage unavailable).",
      false,
    );
    return;
  }
  renderUserRulesPanel();
  const page =
    typeof userRulesPageKey === "function" ? userRulesPageKey() : "index";
  const skipNote = skipped ? `, ${skipped} already present skipped` : "";
  const pageNote =
    v.page && v.page !== page
      ? ` — note: exported from the ${v.page} page`
      : "";
  setUserRulesStatus(`Imported ${added} rule(s)${skipNote}${pageNote}.`, true);
}

function initUserRulesUi() {
  renderUserRulesPanel();
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", initUserRulesUi);
}

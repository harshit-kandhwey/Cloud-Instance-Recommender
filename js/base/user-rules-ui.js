// User-defined rules — the authoring UI (companion to user-rules.js, which holds
// the model/evaluator/storage). A small panel in the Generate section lets the
// user add, list and delete conditional rules ("if Workload = database, Include
// only r5"); the rules are stored per page and picked up on the next Generate.
//
// Page-only: this file touches the DOM and is NOT loaded in the worker. It leans
// on user-rules.js (normalizeUserRule / userRuleLabel / load- / saveUserRules)
// and on escapeHtml (app-core.js).

function renderUserRulesPanel() {
  const host = document.getElementById("userRulesPanel");
  if (!host) return;
  const rules = typeof loadUserRules === "function" ? loadUserRules() : [];

  const dimOptions = [
    ["workload", "Workload"],
    ["env", "ENV"],
    ["os", "OS"],
    ["compliance", "Compliance"],
  ]
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join("");
  const actionOptions = [
    ["exclude", "Exclude"],
    ["includeOnly", "Include only"],
  ]
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

function initUserRulesUi() {
  renderUserRulesPanel();
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", initUserRulesUi);
}

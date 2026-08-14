// User-defined rules: conditional per-row filters the user authors in the UI
// ("if Workload = database, Include Only m5, r5"). A rule matches a row when the
// row's value for the rule's dimension equals the rule's value (case-insensitive)
// and then contributes its tokens to that row's Exclude or Include Only — the
// SAME per-row machinery the CSV columns feed, evaluated in the factory. Rules
// are stored per page (like presets) and carried into the worker as
// options.userRules.
//
// This file is loaded BOTH on the pages and inside the recommendation worker, so
// it must stay DOM-free at the top level: the model + evaluator are pure, and the
// storage helpers (which touch localStorage) are only ever called on the page.

// The dimensions a rule can key on — exactly the closed-enum rule inputs the
// engine already reads per row (rowEnv / rowOS / rowWorkload / rowCompliance).
const USER_RULE_DIMENSIONS = ["env", "os", "workload", "compliance"];
// exclude → drop the tokens; includeOnly → keep only the tokens (allow-list).
const USER_RULE_ACTIONS = ["exclude", "includeOnly"];
const USER_RULES_KEY = "cloudInstanceRecommenderUserRules";

const _USER_RULE_DIM_LABELS = {
  env: "ENV",
  os: "OS",
  workload: "Workload",
  compliance: "Compliance",
};

// A pipe is the Rules Applied column's separator; stripping it keeps a rule's
// text from mis-splitting that column downstream. Commas are the token-list
// separator and are handled where tokens are parsed, not here.
function _cleanRuleText(s) {
  return String(s == null ? "" : s)
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Validate + normalise a raw rule (from storage, an import, or the UI) into the
// canonical shape, or null if it cannot be trusted. Dimension and action are
// constrained to the known sets; `equals` must be non-empty; `tokens` is a
// non-empty list of clean, comma-free strings. A missing id is assigned one, so
// a hand-written or imported rule still gets a stable handle.
function normalizeUserRule(raw) {
  if (!raw || typeof raw !== "object") return null;
  const dimension = String(raw.dimension || "")
    .toLowerCase()
    .trim();
  if (!USER_RULE_DIMENSIONS.includes(dimension)) return null;
  const action = USER_RULE_ACTIONS.find(
    (a) => a.toLowerCase() === String(raw.action || "").toLowerCase(),
  );
  if (!action) return null;
  const equals = _cleanRuleText(raw.equals);
  if (!equals) return null;
  const tokensRaw = Array.isArray(raw.tokens)
    ? raw.tokens
    : String(raw.tokens || "").split(",");
  const tokens = tokensRaw
    .map((t) => _cleanRuleText(t).replace(/,/g, " ").trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  const id = _cleanRuleText(raw.id) || _newRuleId();
  return { id, dimension, equals, action, tokens };
}

function _newRuleId() {
  return `ur-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// A human sentence for the Rules Applied column and the UI list. Pipe-free (see
// _cleanRuleText) so it survives the Rules Applied separator.
function userRuleLabel(rule) {
  const r = normalizeUserRule(rule);
  if (!r) return "";
  const dim = _USER_RULE_DIM_LABELS[r.dimension];
  const act = r.action === "includeOnly" ? "include only" : "exclude";
  return `User: ${dim}=${r.equals} → ${act} ${r.tokens.join(", ")}`;
}

// Match PRE-NORMALISED rules against one row's resolved dimension values, per
// row. Returns the tokens to merge into that row's Exclude / Include Only, plus
// the labels of the rules that fired (for the Rules Applied column). The caller
// guarantees each rule is already canonical (normalizeUserRule output), so this
// is the hot per-row path and does NOT re-normalise: the factory normalises the
// rule set ONCE before its row loop (see normalizeUserRules) and calls this per
// row, rather than re-validating every rule against every row.
function _matchUserRules(dims, rules) {
  const excludeTokens = [];
  const includeOnlyTokens = [];
  const fired = [];
  if (!Array.isArray(rules)) return { excludeTokens, includeOnlyTokens, fired };
  const dimVal = (d) =>
    String((dims && dims[d]) || "")
      .toLowerCase()
      .trim();
  rules.forEach((r) => {
    if (!r) return;
    if (dimVal(r.dimension) !== r.equals.toLowerCase()) return;
    if (r.action === "exclude") excludeTokens.push(...r.tokens);
    else includeOnlyTokens.push(...r.tokens);
    fired.push(userRuleLabel(r));
  });
  return { excludeTokens, includeOnlyTokens, fired };
}

// Normalise a whole rule set once, dropping any that fail validation. The
// once-per-run counterpart to _matchUserRules' per-row matching.
function normalizeUserRules(rules) {
  return Array.isArray(rules)
    ? rules.map(normalizeUserRule).filter(Boolean)
    : [];
}

// Public, defensive entry point: normalise then match. Used directly by tests and
// anywhere a raw (unnormalised) rule set is on hand; the factory takes the
// normalise-once / match-per-row path above instead.
function evaluateUserRules(dims, rules) {
  return _matchUserRules(dims, normalizeUserRules(rules));
}

// ─── Storage (page-only; never called in the worker) ────────────────────────
// Rules are scoped per page, keyed by the page's filename, because a token like
// "m5" names an AWS family and would match nothing on the Azure/GCP pages — the
// same reasoning that scopes presets per page.
function userRulesPageKey() {
  try {
    return (
      (typeof location !== "undefined" && location.pathname.split("/").pop()) ||
      "index"
    )
      .toLowerCase()
      .replace(/\.html?$/, "");
  } catch {
    return "index";
  }
}

function loadUserRules() {
  try {
    const store = JSON.parse(localStorage.getItem(USER_RULES_KEY)) || {};
    const list = store[userRulesPageKey()];
    return Array.isArray(list)
      ? list.map(normalizeUserRule).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveUserRules(rules) {
  try {
    const clean = (Array.isArray(rules) ? rules : [])
      .map(normalizeUserRule)
      .filter(Boolean);
    const store = JSON.parse(localStorage.getItem(USER_RULES_KEY)) || {};
    store[userRulesPageKey()] = clean;
    localStorage.setItem(USER_RULES_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

// Sizing policy: which utilization statistic a row is sized on, chosen from its ENV,
// Criticality and Workload. Pure data plus a pure resolver; a run reads it only when
// Size against is the per-row policy. Storage is page-only and never called in the
// worker, like user rules.
//
// A statistic is chosen in three steps: Criticality and Workload each name one, the
// higher wins, then the row's ENV caps it. ENV is the dominant axis on purpose: a Dev
// database must not be sized on the figure a Production database is.

const SIZING_POLICY_VERSION = 1;

// Ascending. Sizing on a lower statistic than a VM needs under-provisions it, so
// "higher" always means "safer".
const SIZING_STATISTIC_LADDER = ["avg", "p90", "p95", "p99", "peak"];

// The shipped defaults, a documented starting point and not a tuned result: CPU is
// bursty and memory usually is not, so memory is held at p95 or below.
const DEFAULT_SIZING_POLICY = Object.freeze({
  v: SIZING_POLICY_VERSION,
  criticality: Object.freeze({
    critical: "p99",
    high: "p95",
    medium: "p90",
    low: "p90",
  }),
  workload: Object.freeze({ database: "p95", batch: "peak" }),
  envCeiling: Object.freeze({ production: "peak", staging: "p95", dev: "avg" }),
  memoryCeiling: "p95",
  // The safety veto's thresholds, in percent: a downsize is held for review when the
  // dimension's Peak reaches peakMin or its p95 is above p95Max. Starting points, like
  // the rest of the defaults.
  veto: Object.freeze({ peakMin: 95, p95Max: 85 }),
});
const SIZING_VETO_KEYS = ["peakMin", "p95Max"];

function sizingStatisticRank(statistic) {
  return SIZING_STATISTIC_LADDER.indexOf(statistic);
}

function higherSizingStatistic(a, b) {
  return sizingStatisticRank(a) >= sizingStatisticRank(b) ? a : b;
}

function lowerSizingStatistic(a, b) {
  return sizingStatisticRank(a) <= sizingStatisticRank(b) ? a : b;
}

const _hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// The vocabularies a policy may name, read live from the engine so a policy can never
// offer a value the engine does not recognise. Workload keys are lower-cased names.
function sizingPolicyVocabulary() {
  const recognized =
    (typeof RuleEngine !== "undefined" && RuleEngine.RECOGNIZED) || {};
  return {
    criticality: (recognized.criticality || []).slice(),
    workload: (recognized.workload || []).map((w) => String(w).toLowerCase()),
    envClasses: Object.keys(recognized.envClasses || {}),
  };
}

// Validates a stored or imported policy. Returns { policy, problems }. An entry from
// another version, or anything that is not an object, is dropped for the default: it
// asks again rather than replaying a shape this code no longer understands. Within a
// current-version policy, each bad cell falls back to that cell's default and is named
// in `problems`, so nothing is silently reinterpreted.
function normalizeSizingPolicy(raw) {
  const problems = [];
  const fallback = () => ({
    policy: structuredCopyPolicy(DEFAULT_SIZING_POLICY),
    problems,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback();
  }
  if (raw.v !== SIZING_POLICY_VERSION) {
    problems.push(`policy version ${String(raw.v)} is not supported`);
    return fallback();
  }

  const vocab = sizingPolicyVocabulary();
  const valid = (s) => sizingStatisticRank(s) >= 0;
  const policy = structuredCopyPolicy(DEFAULT_SIZING_POLICY);

  const readMap = (name, allowedKeys, key) => {
    const given = raw[name];
    if (given === undefined) return;
    if (!given || typeof given !== "object" || Array.isArray(given)) {
      problems.push(`${name} must be an object`);
      return;
    }
    for (const k of Object.keys(given)) {
      if (!allowedKeys.includes(k)) {
        problems.push(`${name}: "${k}" is not a recognised ${key}`);
      } else if (!valid(given[k])) {
        problems.push(`${name}.${k}: "${String(given[k])}" is not a statistic`);
      } else {
        Object.defineProperty(policy[name], k, {
          value: given[k],
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
  };
  readMap("criticality", vocab.criticality, "criticality");
  readMap("workload", vocab.workload, "workload");
  readMap("envCeiling", vocab.envClasses, "environment");

  if (raw.memoryCeiling !== undefined) {
    if (valid(raw.memoryCeiling)) policy.memoryCeiling = raw.memoryCeiling;
    else
      problems.push(
        `memoryCeiling: "${String(raw.memoryCeiling)}" is not a statistic`,
      );
  }

  if (raw.veto !== undefined) {
    const given = raw.veto;
    if (!given || typeof given !== "object" || Array.isArray(given)) {
      problems.push("veto must be an object");
    } else {
      for (const k of Object.keys(given)) {
        const v = given[k];
        if (!SIZING_VETO_KEYS.includes(k)) {
          problems.push(`veto: "${k}" is not a recognised threshold`);
        } else if (typeof v !== "number" || !(v > 0 && v <= 100)) {
          problems.push(
            `veto.${k}: "${String(v)}" must be a number above 0 and at most 100`,
          );
        } else {
          policy.veto[k] = v;
        }
      }
    }
  }
  return { policy, problems };
}

function structuredCopyPolicy(p) {
  return {
    v: p.v,
    criticality: { ...p.criticality },
    workload: { ...p.workload },
    envCeiling: { ...p.envCeiling },
    memoryCeiling: p.memoryCeiling,
    veto: { ...p.veto },
  };
}

// Classes an ENV string by the engine's own grouping. Returns null for blank or
// unrecognised, which the resolver treats as the safest (highest) ceiling.
function sizingEnvClass(env) {
  const classes =
    (typeof RuleEngine !== "undefined" &&
      RuleEngine.RECOGNIZED &&
      RuleEngine.RECOGNIZED.envClasses) ||
    {};
  const value = String(env == null ? "" : env)
    .trim()
    .toLowerCase();
  if (!value) return null;
  for (const name of Object.keys(classes)) {
    if (classes[name].includes(value)) return name;
  }
  return null;
}

// Resolves the statistic for one row: { cpu, memory, reason }. `row` carries the
// already-resolved env, criticality and workload strings (the caller applies the page
// defaults). A blank or unrecognised ENV is capped like Production, and a blank or
// unrecognised Criticality counts as medium: when unsure, size on the higher figure,
// never the lower. `reason` says so, so the choice is traceable.
function resolvePolicyStatistic(row, policy) {
  const p = policy || DEFAULT_SIZING_POLICY;
  const notes = [];

  const envClass = sizingEnvClass(row && row.env);
  const envUsed = envClass || "production";
  if (!envClass) notes.push("ENV not recognised, capped as production");

  const critKey = String((row && row.criticality) || "")
    .trim()
    .toLowerCase();
  const critKnown = _hasOwn(p.criticality, critKey);
  const critUsed = critKnown ? critKey : "medium";
  if (!critKnown) notes.push("Criticality not recognised, treated as medium");
  const critStat = p.criticality[critUsed];

  const wlKey = String((row && row.workload) || "")
    .trim()
    .toLowerCase();
  const wlStat = _hasOwn(p.workload, wlKey) ? p.workload[wlKey] : null;

  const wanted = wlStat ? higherSizingStatistic(critStat, wlStat) : critStat;
  const cpu = lowerSizingStatistic(wanted, p.envCeiling[envUsed]);
  const memory = lowerSizingStatistic(cpu, p.memoryCeiling);

  const parts = [`${envUsed}`, `${critUsed}`];
  if (wlStat) parts.push(wlKey);
  const capped = cpu !== wanted ? `, capped by ${envUsed} to ${cpu}` : "";
  const reason =
    `${parts.join(" + ")} → ${wanted}${capped}` +
    (notes.length ? ` (${notes.join("; ")})` : "");
  return { cpu, memory, reason };
}

// ─── Storage (page-only; never called in the worker) ────────────────────────
// Scoped per page for the same reason user rules and presets are: the tool pages
// differ in what they offer. One entry per page, versioned, dropped if it is not.
function sizingPolicyPageKey() {
  return typeof userRulesPageKey === "function" ? userRulesPageKey() : "index";
}

function loadSizingPolicy() {
  try {
    const store = readStoredObject(STORAGE_KEYS.sizingPolicies);
    const page = sizingPolicyPageKey();
    // Own entry only: the page key is a URL segment, never a safe property name.
    if (!_hasOwn(store, page))
      return structuredCopyPolicy(DEFAULT_SIZING_POLICY);
    return normalizeSizingPolicy(store[page]).policy;
  } catch {
    return structuredCopyPolicy(DEFAULT_SIZING_POLICY);
  }
}

// Returns { ok, reason, problems }. A policy that fails validation is not saved: the
// problems are handed back so the caller can say what to fix.
function saveSizingPolicy(policy) {
  const { policy: clean, problems } = normalizeSizingPolicy(policy);
  if (problems.length) return { ok: false, reason: "invalid", problems };
  try {
    const store = readStoredObject(STORAGE_KEYS.sizingPolicies);
    // defineProperty, not assignment: assigning to "__proto__" sets the prototype and
    // stores nothing, so the save would report success and persist no policy.
    Object.defineProperty(store, sizingPolicyPageKey(), {
      value: clean,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const json = JSON.stringify(store);
    if (typeof StorageManager !== "undefined") {
      const result = StorageManager.write("sizingPolicies", json);
      return { ...result, problems: [] };
    }
    localStorage.setItem(STORAGE_KEYS.sizingPolicies, json);
    return { ok: true, problems: [] };
  } catch {
    return { ok: false, reason: "unavailable", problems: [] };
  }
}

// Named snapshots of a generation run's per-VM outputs (3.21 phase 2). A snapshot
// holds the rows, the providers the run used and the user rules it applied, never
// the raw inventory. priceSavings is attached to the results array, not to a row,
// so copying rows cannot carry it, and nothing here reads that array property
// (CLAUDE rule 7). Entries are versioned: an unknown version is dropped on read,
// not migrated (CLAUDE rule 6).
const FleetSnapshots = (() => {
  const SCHEMA_VERSION = 1;
  const MAX_NAME_LENGTH = 60;

  function readEntries() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEYS.fleetSnapshots);
    } catch {
      return [];
    }
    if (raw === null) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        e !== null &&
        typeof e === "object" &&
        e.v === SCHEMA_VERSION &&
        typeof e.id === "string" &&
        typeof e.name === "string" &&
        Array.isArray(e.rows),
    );
  }

  function normaliseName(name) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed.length === 0) return { error: "empty" };
    if (trimmed.length > MAX_NAME_LENGTH) return { error: "too-long" };
    return { name: trimmed };
  }

  function build({ name, rows, providers, rules, takenAt, id }) {
    const checked = normaliseName(name);
    if (checked.error) return { ok: false, reason: checked.error };
    if (!Array.isArray(rows)) return { ok: false, reason: "no-rows" };
    const entry = {
      v: SCHEMA_VERSION,
      id:
        id ||
        `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      name: checked.name,
      takenAt: takenAt || new Date().toISOString(),
      providers: Array.isArray(providers) ? providers.slice() : [],
      rules: Array.isArray(rules) ? JSON.parse(JSON.stringify(rules)) : [],
      rows: JSON.parse(JSON.stringify(rows)),
    };
    return { ok: true, entry };
  }

  function list() {
    return readEntries();
  }

  function save(entry) {
    const existing = readEntries();
    if (existing.some((e) => e.name === entry.name)) {
      return { ok: false, reason: "duplicate" };
    }
    const result = StorageManager.write(
      "fleetSnapshots",
      JSON.stringify([...existing, entry]),
    );
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  function remove(id) {
    const remaining = readEntries().filter((e) => e.id !== id);
    const result = StorageManager.write(
      "fleetSnapshots",
      JSON.stringify(remaining),
    );
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  // Same fleet means the same VM names. Below this share of the larger side, the two
  // runs are different estates and a diff between them would pair unrelated VMs.
  const MIN_OVERLAP = 0.9;

  function compareFleet(entry, freshResults) {
    const before = scenarioRowKeys(entry.rows);
    const after = scenarioRowKeys(freshResults);
    if (before === null || after === null) {
      return { ok: false, reason: "not-keyed" };
    }
    const afterSet = new Set(after);
    const beforeSet = new Set(before);
    const shared = before.filter((n) => afterSet.has(n));
    const larger = Math.max(before.length, after.length);
    const overlap = larger === 0 ? 0 : shared.length / larger;
    const added = after.filter((n) => !beforeSet.has(n));
    const removed = before.filter((n) => !afterSet.has(n));
    if (overlap < MIN_OVERLAP) {
      return { ok: false, reason: "low-overlap", overlap, added, removed };
    }
    return { ok: true, overlap, added, removed };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    MIN_OVERLAP,
    build,
    list,
    save,
    remove,
    compareFleet,
  });
})();

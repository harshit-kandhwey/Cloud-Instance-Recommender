// Named snapshots of a generation run's per-VM outputs (3.21 phase 2). A snapshot
// holds the rows, the providers the run used and the user rules it applied, never
// the raw inventory. priceSavings is attached to the results array, not to a row,
// so copying rows cannot carry it, and nothing here reads that array property
// (CLAUDE rule 7). Entries are versioned: an unknown version is ignored on read,
// not migrated (CLAUDE rule 6), and left in storage untouched by a save or delete.
const FleetSnapshots = (() => {
  const SCHEMA_VERSION = 1;
  const MAX_NAME_LENGTH = 60;

  function readRaw() {
    try {
      return localStorage.getItem(STORAGE_KEYS.fleetSnapshots);
    } catch {
      return null;
    }
  }

  function parseStored(raw) {
    if (raw === null) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    return Array.isArray(parsed) ? parsed : [];
  }

  function readStored() {
    return parseStored(readRaw());
  }

  const isCurrent = (e) =>
    e !== null &&
    typeof e === "object" &&
    e.v === SCHEMA_VERSION &&
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    Array.isArray(e.rows);

  // Written by another build under a version this one cannot read. It is never shown
  // or trusted, but a save or delete here must not destroy it.
  const isOtherVersion = (e) =>
    e !== null &&
    typeof e === "object" &&
    e.v !== undefined &&
    e.v !== SCHEMA_VERSION;

  function readEntries() {
    return readStored().filter(isCurrent);
  }

  // What a write keeps: the readable entries and the other-version ones, in stored order.
  // Anything else is malformed and is dropped.
  function keptEntries(stored) {
    return stored.filter((e) => isCurrent(e) || isOtherVersion(e));
  }

  // Another tab can write between this one's read and its write, and a blind write would
  // drop that tab's snapshot. The stored text is read again just before the write; if it
  // moved, the change is rebuilt from the new list once, and a second move is refused.
  function writeFrom(build) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = readRaw();
      const built = build(parseStored(raw));
      if (!built.ok) return built;
      if (readRaw() !== raw) continue;
      const result = AppStorage.write(
        "fleetSnapshots",
        JSON.stringify(built.list),
      );
      return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    }
    return { ok: false, reason: "changed" };
  }

  function normaliseName(name) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed.length === 0) return { error: "empty" };
    if (trimmed.length > MAX_NAME_LENGTH) return { error: "too-long" };
    return { name: trimmed };
  }

  /**
   * @param {{ name: string, rows: any[], providers?: string[], rules?: any[], takenAt?: string, id?: string }} input
   * @returns {{ ok: true, entry: any } | { ok: false, reason: string }}
   */
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
    return writeFrom((stored) =>
      stored.filter(isCurrent).some((e) => e.name === entry.name)
        ? { ok: false, reason: "duplicate" }
        : { ok: true, list: [...keptEntries(stored), entry] },
    );
  }

  function remove(id) {
    return writeFrom((stored) => ({
      ok: true,
      list: keptEntries(stored).filter((e) => !(isCurrent(e) && e.id === id)),
    }));
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

// Named snapshots of a generation run's per-VM outputs (3.21 phase 2). A snapshot
// holds the result rows, the providers the run used and the user rules it applied.
// Each result row carries the input columns of its VM as well as the recommendation,
// so a snapshot and its exported file hold the uploaded columns too.
// priceSavings is attached to the results array, not to a row,
// so copying rows cannot carry it, and nothing here reads that array property
// (CLAUDE rule 7). Entries are versioned: an unknown version is ignored on read,
// not migrated (CLAUDE rule 6), and left in storage untouched by a save or delete.
// A snapshot file (3.22) is read back through the same build and save as a captured
// run, after the checks in parseImport: nothing reaches storage by another route.
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

  // ── Snapshot file (3.22) ──────────────────────────────────────────────────────
  const FILE_FORMAT = "cir-fleet-snapshot";
  // Text longer than this is refused before JSON.parse allocates for it. Well under
  // the localStorage quota a snapshot must still fit into.
  const MAX_IMPORT_CHARS = 4 * 1048576;
  const MAX_IMPORT_ROWS = 20000;
  const MAX_IMPORT_RULES = 500;
  const MAX_PROVIDERS = 8;
  const MAX_PROVIDER_LENGTH = 32;
  // Keys that would write to an object's prototype if a later copy used plain assignment.
  const POISON_KEYS = ["__proto__", "constructor", "prototype"];

  /** @param {string} name */
  function fileSlug(name) {
    const slug = String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    return slug || "snapshot";
  }

  /**
   * The text and file name for one stored snapshot. The id is not exported: an import
   * is a new snapshot and gets its own.
   * @param {string} id
   * @returns {{ ok: true, text: string, filename: string } | { ok: false, reason: string }}
   */
  function exportEntry(id) {
    const entry = readEntries().find((e) => e.id === id);
    if (!entry) return { ok: false, reason: "missing" };
    const text = JSON.stringify({
      format: FILE_FORMAT,
      v: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      name: entry.name,
      takenAt: entry.takenAt,
      providers: entry.providers,
      rules: entry.rules,
      rows: entry.rows,
    });
    return {
      ok: true,
      text,
      filename: `fleet_snapshot_${fileSlug(entry.name)}.json`,
    };
  }

  /** @param {any} value */
  function hasPoisonKey(value) {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(hasPoisonKey);
    return Object.keys(value).some(
      (k) => POISON_KEYS.includes(k) || hasPoisonKey(value[k]),
    );
  }

  // Control characters are removed from a name; everything else is kept as typed. A
  // leading = + - @ is not rewritten here: the formula guard sits on every export path,
  // and the panel escapes the name as HTML.
  /** @param {unknown} name */
  function cleanName(name) {
    return typeof name === "string"
      ? name
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  }

  /**
   * Validates a snapshot file's text without touching storage. Anything that is not
   * exactly the shape this build writes is refused with a reason; nothing is repaired.
   * @param {unknown} text
   * @returns {{ ok: true, name: string, takenAt: string, providers: string[], rules: any[], rows: any[] } | { ok: false, reason: string }}
   */
  function parseImport(text) {
    if (typeof text !== "string") return { ok: false, reason: "not-json" };
    if (text.length > MAX_IMPORT_CHARS)
      return { ok: false, reason: "too-large" };
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return { ok: false, reason: "not-json" };
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      return { ok: false, reason: "not-snapshot" };
    }
    if (doc.format !== FILE_FORMAT)
      return { ok: false, reason: "not-snapshot" };
    if (doc.v !== SCHEMA_VERSION) return { ok: false, reason: "version" };
    if (!Array.isArray(doc.rows) || doc.rows.length === 0) {
      return { ok: false, reason: "no-rows" };
    }
    if (doc.rows.length > MAX_IMPORT_ROWS)
      return { ok: false, reason: "too-many-rows" };
    for (const row of doc.rows) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        return { ok: false, reason: "bad-row" };
      }
      for (const key of Object.keys(row)) {
        const cell = row[key];
        const plain =
          cell === null ||
          typeof cell === "string" ||
          typeof cell === "number" ||
          typeof cell === "boolean";
        if (POISON_KEYS.includes(key) || !plain)
          return { ok: false, reason: "bad-row" };
      }
    }
    const providers = doc.providers === undefined ? [] : doc.providers;
    if (
      !Array.isArray(providers) ||
      providers.length > MAX_PROVIDERS ||
      providers.some(
        (p) => typeof p !== "string" || p.length > MAX_PROVIDER_LENGTH,
      )
    ) {
      return { ok: false, reason: "bad-providers" };
    }
    const rules = doc.rules === undefined ? [] : doc.rules;
    if (
      !Array.isArray(rules) ||
      rules.length > MAX_IMPORT_RULES ||
      rules.some(
        (r) => r === null || typeof r !== "object" || Array.isArray(r),
      ) ||
      hasPoisonKey(rules)
    ) {
      return { ok: false, reason: "bad-rules" };
    }
    if (
      typeof doc.takenAt !== "string" ||
      Number.isNaN(Date.parse(doc.takenAt))
    ) {
      return { ok: false, reason: "bad-date" };
    }
    const name = cleanName(doc.name);
    if (!name) return { ok: false, reason: "empty" };
    return {
      ok: true,
      name,
      takenAt: doc.takenAt,
      providers,
      rules,
      rows: doc.rows,
    };
  }

  // The first free "name (2)", "name (3)", ... within the name length limit.
  /** @param {string} name */
  function suggestName(name) {
    const taken = new Set(readEntries().map((e) => e.name));
    for (let n = 2; n < 1000; n++) {
      const suffix = ` (${n})`;
      const candidate = name.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
      if (!taken.has(candidate)) return candidate;
    }
    return name.slice(0, MAX_NAME_LENGTH);
  }

  /**
   * Reads a snapshot file into storage through build + save, the same door as a
   * captured run. A name that already exists is a refusal that carries a suggested
   * rename; it is never an overwrite.
   * @param {string} text
   * @param {{ name?: string }} [options] a rename chosen by the user
   * @returns {{ ok: true, entry: any } | { ok: false, reason: string, name?: string, suggestion?: string }}
   */
  function importText(text, options = {}) {
    const parsed = parseImport(text);
    if (!parsed.ok) return parsed;
    const name =
      options.name === undefined ? parsed.name : cleanName(options.name);
    const built = build({
      name,
      rows: parsed.rows,
      providers: parsed.providers,
      rules: parsed.rules,
      takenAt: parsed.takenAt,
    });
    if (!built.ok) return built;
    const saved = save(built.entry);
    if (!saved.ok) {
      return saved.reason === "duplicate"
        ? {
            ok: false,
            reason: "duplicate",
            name: built.entry.name,
            suggestion: suggestName(built.entry.name),
          }
        : saved;
    }
    return { ok: true, entry: built.entry };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    MIN_OVERLAP,
    MAX_IMPORT_CHARS,
    MAX_IMPORT_ROWS,
    build,
    list,
    save,
    remove,
    compareFleet,
    exportEntry,
    parseImport,
    importText,
  });
})();

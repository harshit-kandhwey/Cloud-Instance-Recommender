// Fleet snapshots (src/features/fleet-snapshots.js, 3.21 phase 2): what a saved
// snapshot holds, what it must never hold, and how a stored list is read back.
// Covered: rows are copied rather than shared, priceSavings on the results array
// never reaches the entry (CLAUDE rule 7), names are validated, duplicates are
// refused, unknown versions are dropped on read (CLAUDE rule 6), a quota refusal
// leaves the stored list unchanged, and removal targets one id.
const {
  buildEngineContext,
  makeChecker,
  fakeLocalStorage,
} = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: [
    "src/shared/storage-keys.js",
    "src/shared/storage-manager.js",
    "src/features/fleet-snapshots.js",
  ],
  label: "fleet-snapshots",
});
const { check, state } = makeChecker();

const KEY = run("STORAGE_KEYS.fleetSnapshots");
function fresh(limitUnits) {
  const store = fakeLocalStorage({ limitUnits });
  ctx.localStorage = store;
  return store;
}

const sourceRows = [
  { VM: "web-01", "Recommended Instance": "m5.large", ENV: "Prod" },
  { VM: "db-01", "Recommended Instance": "r5.xlarge", ENV: "Prod" },
];
const sourceResults = [...sourceRows];
/** @type {any} */ (sourceResults).priceSavings = {
  percent: 18,
  provider: "aws",
};

{
  fresh();
  ctx.__results = sourceResults;
  const built = run(
    `FleetSnapshots.build({ name: "Q4 estate", rows: __results, providers: ["aws"], rules: [{ id: "r1" }] })`,
  );
  check(
    "a valid name builds an entry",
    built.ok === true,
    JSON.stringify(built),
  );
  const json = JSON.stringify(built.entry);
  check("the entry records schema version 1", built.entry.v === 1);
  check(
    "the entry never carries priceSavings, even though the results array does",
    /** @type {any} */ (sourceResults).priceSavings !== undefined &&
      !json.includes("priceSavings") &&
      !json.includes("percent"),
  );
  const savedVM = sourceRows[0].VM;
  sourceRows[0].VM = "mutated-after-build";
  check(
    "rows are copied, so later edits to the source do not change the snapshot",
    built.entry.rows[0].VM === savedVM,
  );
  sourceRows[0].VM = savedVM;
  check(
    "the entry keeps the providers and rules the run used",
    built.entry.providers.length === 1 && built.entry.rules[0].id === "r1",
  );
}

{
  fresh();
  for (const bad of ["", "   ", "x".repeat(61)]) {
    const r = run(
      `FleetSnapshots.build({ name: ${JSON.stringify(bad)}, rows: [] })`,
    );
    check(
      `a name of ${bad.length} characters is refused`,
      r.ok === false,
      JSON.stringify(r),
    );
  }
}

{
  const store = fresh();
  const built = run(
    `FleetSnapshots.build({ name: "Baseline", rows: [{ VM: "a" }], providers: [], rules: [], id: "s1" })`,
  );
  const saved = run(`FleetSnapshots.save(${JSON.stringify(built.entry)})`);
  check("a snapshot saves", saved.ok === true);
  const listed = run("FleetSnapshots.list()");
  check(
    "a saved snapshot reads back by name",
    listed.length === 1 && listed[0].name === "Baseline",
  );
  check(
    "the store holds the saved list under its registry key",
    JSON.parse(store.getItem(KEY)).length === 1,
  );

  const dup = run(
    `FleetSnapshots.save(${JSON.stringify({ ...built.entry, id: "s2" })})`,
  );
  check(
    "a second snapshot with the same name is refused",
    dup.reason === "duplicate",
  );
}

{
  const store = fresh();
  store.setItem(
    KEY,
    JSON.stringify([
      { v: 1, id: "ok", name: "Current", rows: [] },
      { v: 2, id: "future", name: "From a newer build", rows: [] },
      { id: "unversioned", name: "No version", rows: [] },
    ]),
  );
  const listed = run("FleetSnapshots.list()").map((e) => e.id);
  check(
    "entries of an unknown or missing version are dropped on read",
    JSON.stringify(listed) === JSON.stringify(["ok"]),
    JSON.stringify(listed),
  );
}

{
  const store = fresh();
  const future = {
    v: 2,
    id: "future",
    name: "From a newer build",
    rows: [],
    extra: "kept as is",
  };
  store.setItem(
    KEY,
    JSON.stringify([
      { v: 1, id: "ok", name: "Current", rows: [] },
      future,
      { id: "unversioned", name: "No version", rows: [] },
      "junk",
    ]),
  );
  const built = run(
    `FleetSnapshots.build({ name: "New", rows: [{ "VM Name": "a" }] })`,
  );
  const saved = run(`FleetSnapshots.save(${JSON.stringify(built.entry)})`);
  const stored = JSON.parse(store.getItem(KEY));
  check(
    "saving keeps an entry another build wrote, unchanged",
    saved.ok &&
      stored.some((e) => JSON.stringify(e) === JSON.stringify(future)),
    JSON.stringify(stored.map((e) => e && e.id)),
  );
  check(
    "saving still drops entries that are malformed",
    !stored.includes("junk") &&
      !stored.some((e) => e && e.id === "unversioned"),
    JSON.stringify(stored.map((e) => e && e.id)),
  );
  const removed = run(`FleetSnapshots.remove("ok")`);
  const after = JSON.parse(store.getItem(KEY));
  check(
    "deleting a snapshot removes only that one and keeps the other build's entry",
    removed.ok &&
      after.some((e) => e && e.id === "future") &&
      after.some((e) => e && e.name === "New") &&
      !after.some((e) => e && e.id === "ok"),
    JSON.stringify(after.map((e) => e && e.id)),
  );
  run(`FleetSnapshots.remove("future")`);
  check(
    "an id that belongs to another build's entry deletes nothing",
    JSON.parse(store.getItem(KEY)).some((e) => e && e.id === "future"),
  );
}

{
  const store = fresh(120);
  const big = run(
    `FleetSnapshots.build({ name: "Large", rows: JSON.parse(${JSON.stringify(JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ VM: `vm-${i}`, Notes: "x".repeat(20) }))))}), id: "big" })`,
  );
  const before = store.getItem(KEY);
  const refused = run(`FleetSnapshots.save(${JSON.stringify(big.entry)})`);
  check(
    "a snapshot that would exceed the quota is refused, not truncated",
    refused.ok === false && refused.reason === "quota",
    JSON.stringify(refused),
  );
  check(
    "a refused save leaves the stored list unchanged",
    store.getItem(KEY) === before,
  );
}

{
  const store = fresh();
  const a = run(`FleetSnapshots.build({ name: "A", rows: [], id: "a" })`).entry;
  const b = run(`FleetSnapshots.build({ name: "B", rows: [], id: "b" })`).entry;
  run(`FleetSnapshots.save(${JSON.stringify(a)})`);
  run(`FleetSnapshots.save(${JSON.stringify(b)})`);
  run('FleetSnapshots.remove("a")');
  const ids = JSON.parse(store.getItem(KEY)).map((e) => e.id);
  check(
    "removal deletes only the named id",
    JSON.stringify(ids) === JSON.stringify(["b"]),
  );
}

// Another tab writes the list between this tab's read and its write. The store below
// lets the test place that write exactly there: `moves` says how many reads of the key
// are followed by a foreign write.
function storeWithForeignWrites(moves) {
  const store = fresh();
  const realGet = store.getItem.bind(store);
  let reads = 0;
  store.getItem = (k) => {
    const value = realGet(k);
    if (k === KEY && reads < moves) {
      reads++;
      const list = value === null ? [] : JSON.parse(value);
      list.push({
        v: 1,
        id: `other${reads}`,
        name: `From another tab ${reads}`,
        rows: [],
      });
      store.setItem(KEY, JSON.stringify(list));
    }
    return value;
  };
  return store;
}
const mine = (id, name) => ({ v: 1, id, name, rows: [] });

{
  const store = storeWithForeignWrites(1);
  const saved = run(
    `FleetSnapshots.save(${JSON.stringify(mine("m", "Mine"))})`,
  );
  const ids = JSON.parse(store.getItem(KEY)).map((e) => e.id);
  check(
    "a save that races another tab keeps both snapshots",
    saved.ok === true &&
      JSON.stringify(ids) === JSON.stringify(["other1", "m"]),
    JSON.stringify({ saved, ids }),
  );
}
{
  const store = storeWithForeignWrites(1);
  store.setItem(KEY, JSON.stringify([mine("a", "A"), mine("b", "B")]));
  const removed = run('FleetSnapshots.remove("a")');
  const ids = JSON.parse(store.getItem(KEY)).map((e) => e.id);
  check(
    "a delete that races another tab does not drop the other tab's snapshot",
    removed.ok === true && ids.includes("other1") && !ids.includes("a"),
    JSON.stringify({ removed, ids }),
  );
}
{
  const store = storeWithForeignWrites(Infinity);
  const saved = run(
    `FleetSnapshots.save(${JSON.stringify(mine("m", "Mine"))})`,
  );
  const ids = JSON.parse(store.getItem(KEY)).map((e) => e.id);
  check(
    "a list that keeps moving is refused with a reason and not overwritten",
    saved.ok === false && saved.reason === "changed" && !ids.includes("m"),
    JSON.stringify({ saved, ids }),
  );
}

// ── Snapshot file (3.22): export, validated import, one door ──────────────────────
{
  const FILE = (over = {}) =>
    JSON.stringify({
      format: "cir-fleet-snapshot",
      v: 1,
      exportedAt: "2026-10-11T00:00:00.000Z",
      name: "Shared estate",
      takenAt: "2026-10-10T08:00:00.000Z",
      providers: ["aws"],
      rules: [{ id: "r1", dimension: "env" }],
      rows: [{ VM: "web-01", "AWS Optimized Instance": "m5.large", CPU: 4 }],
      ...over,
    });
  const importText = (text, options) => {
    ctx.__text = text;
    ctx.__opts = options;
    return run(`FleetSnapshots.importText(__text, __opts)`);
  };
  const names = () => run(`FleetSnapshots.list().map((e) => e.name)`);
  const rawStore = (store) => store.getItem(KEY);

  // round trip
  {
    fresh();
    ctx.__results = sourceResults;
    const built = run(
      `FleetSnapshots.build({ name: "Q4 estate", rows: __results, providers: ["aws"], rules: [{ id: "r1" }], takenAt: "2026-10-01T00:00:00.000Z" })`,
    );
    run(`FleetSnapshots.save(${JSON.stringify(built.entry)})`);
    const made = run(
      `FleetSnapshots.exportEntry(${JSON.stringify(built.entry.id)})`,
    );
    check(
      "an export is made for a stored snapshot",
      made.ok === true && /\.json$/.test(made.filename),
      JSON.stringify(made).slice(0, 200),
    );
    const doc = JSON.parse(made.text);
    check(
      "the file carries the format marker and the schema version",
      doc.format === "cir-fleet-snapshot" && doc.v === 1,
    );
    check("the file does not carry the snapshot's id", !("id" in doc));
    check(
      "the file name is derived from the snapshot name",
      made.filename === "fleet_snapshot_q4_estate.json",
      made.filename,
    );
    check(
      "exporting an id that is not stored is refused",
      run(`FleetSnapshots.exportEntry("nope")`).ok === false,
    );

    fresh();
    const back = importText(made.text);
    check(
      "the exported file imports into an empty browser",
      back.ok === true,
      JSON.stringify(back),
    );
    const kept = run(`FleetSnapshots.list()`)[0];
    check(
      "the imported snapshot keeps name, date, providers, rules and rows",
      kept.name === "Q4 estate" &&
        kept.takenAt === "2026-10-01T00:00:00.000Z" &&
        JSON.stringify(kept.providers) === '["aws"]' &&
        JSON.stringify(kept.rules) === '[{"id":"r1"}]' &&
        JSON.stringify(kept.rows) === JSON.stringify(sourceRows),
      JSON.stringify(kept).slice(0, 240),
    );
    check(
      "an import is a new snapshot with its own id",
      kept.id !== built.entry.id,
    );
    check(
      "imported rows are plain objects",
      run(
        `Object.getPrototypeOf(FleetSnapshots.list()[0].rows[0]) === Object.prototype`,
      ) === true,
    );
  }

  // refusals leave storage exactly as it was
  {
    const store = fresh();
    ctx.__results = sourceResults;
    run(
      `FleetSnapshots.save(FleetSnapshots.build({ name: "Existing", rows: __results }).entry)`,
    );
    const before = rawStore(store);
    const bigText = "x".repeat(run(`FleetSnapshots.MAX_IMPORT_CHARS`) + 1);
    const manyRows = Array.from(
      { length: run(`FleetSnapshots.MAX_IMPORT_ROWS`) + 1 },
      () => ({ VM: "v" }),
    );
    const cases = [
      ["not JSON", "{{", "not-json"],
      ["a JSON array", "[]", "not-snapshot"],
      ["JSON null", "null", "not-snapshot"],
      [
        "the wrong format marker",
        FILE({ format: "something-else" }),
        "not-snapshot",
      ],
      ["a future schema version", FILE({ v: 2 }), "version"],
      ["no rows", FILE({ rows: [] }), "no-rows"],
      ["rows that are not an array", FILE({ rows: "web-01" }), "no-rows"],
      ["text over the size cap", bigText, "too-large"],
      ["too many rows", FILE({ rows: manyRows }), "too-many-rows"],
      [
        "a nested object in a cell",
        FILE({ rows: [{ VM: { a: 1 } }] }),
        "bad-row",
      ],
      ["a row that is an array", FILE({ rows: [["web-01"]] }), "bad-row"],
      [
        "a __proto__ key in a row",
        FILE().replace('"VM":"web-01"', '"__proto__":"x"'),
        "bad-row",
      ],
      [
        "a constructor key in a row",
        FILE().replace('"VM":"web-01"', '"constructor":"x"'),
        "bad-row",
      ],
      [
        "providers that are not strings",
        FILE({ providers: [1] }),
        "bad-providers",
      ],
      [
        "providers that are not a list",
        FILE({ providers: "aws" }),
        "bad-providers",
      ],
      [
        "a provider name over the length cap",
        FILE({ providers: ["p".repeat(33)] }),
        "bad-providers",
      ],
      [
        "more providers than the cap",
        FILE({ providers: Array.from({ length: 9 }, () => "aws") }),
        "bad-providers",
      ],
      [
        "rules carrying a __proto__ key",
        FILE().replace('"id":"r1"', '"__proto__":{"x":1}'),
        "bad-rules",
      ],
      ["a date that is not a date", FILE({ takenAt: "yesterday" }), "bad-date"],
      [
        "a name of only control characters",
        FILE({ name: "\u0000\u0007" }),
        "empty",
      ],
      ["a name over 60 characters", FILE({ name: "n".repeat(61) }), "too-long"],
    ];
    for (const [label, text, reason] of cases) {
      const r = importText(text);
      check(
        `refused: ${label}`,
        r.ok === false && r.reason === reason,
        JSON.stringify(r),
      );
    }
    check(
      "every refusal left the stored list byte-identical",
      rawStore(store) === before,
    );
    check(
      "and the existing snapshot is still the only one",
      JSON.stringify(names()) === '["Existing"]',
    );
  }

  // a name that exists is a refusal with a rename offer, never an overwrite
  {
    const store = fresh();
    check(
      "the first import of a name succeeds",
      importText(FILE()).ok === true,
    );
    const stored = rawStore(store);
    const again = importText(FILE({ rows: [{ VM: "other-vm" }] }));
    check(
      "the same name again is refused as a duplicate with a suggested rename",
      again.ok === false &&
        again.reason === "duplicate" &&
        again.suggestion === "Shared estate (2)",
      JSON.stringify(again),
    );
    check(
      "the refusal left the stored list untouched",
      rawStore(store) === stored,
    );
    const renamed = importText(FILE({ rows: [{ VM: "other-vm" }] }), {
      name: again.suggestion,
    });
    check(
      "importing under the suggested name succeeds",
      renamed.ok === true,
      JSON.stringify(renamed),
    );
    check(
      "both snapshots exist and the first one's rows were not replaced",
      JSON.stringify(names()) === '["Shared estate","Shared estate (2)"]' &&
        run(`FleetSnapshots.list()[0].rows[0].VM`) === "web-01",
      JSON.stringify(names()),
    );
    const third = importText(FILE());
    check(
      "the next suggestion skips a name already taken",
      third.suggestion === "Shared estate (3)",
      JSON.stringify(third),
    );
  }

  // a name cut to make room for the suffix does not end in a space before it
  {
    fresh();
    const long = "a".repeat(55) + " " + "b".repeat(4);
    importText(FILE({ name: long }));
    const again = importText(FILE({ name: long }));
    check(
      "a suggestion cut at a space carries no double space",
      again.reason === "duplicate" &&
        again.suggestion === "a".repeat(55) + " (2)" &&
        !/\s\s/.test(again.suggestion),
      JSON.stringify(again.suggestion),
    );
  }

  // names are cleaned of control characters, and kept as typed otherwise
  {
    fresh();
    importText(FILE({ name: "  Q4\tplan\u0007\n v2 " }));
    check(
      "control characters in an imported name become single spaces",
      JSON.stringify(names()) === '["Q4 plan v2"]',
      JSON.stringify(names()),
    );
    importText(FILE({ name: '=HYPERLINK("x")' }));
    check(
      "a formula-looking name is stored as plain text for the export guards to handle",
      names().includes('=HYPERLINK("x")'),
      JSON.stringify(names()),
    );
  }

  // the one door: quota, other-version entries, malformed neighbours
  {
    const store = fresh(120);
    const r = importText(FILE());
    check(
      "a full browser refuses the import with the quota reason",
      r.ok === false && r.reason === "quota",
      JSON.stringify(r),
    );
    check(
      "and stores nothing",
      rawStore(store) === null || rawStore(store) === "[]",
    );
  }
  {
    const store = fresh();
    store.setItem(
      KEY,
      JSON.stringify([{ v: 99, id: "future", name: "From later", rows: [] }]),
    );
    const r = importText(FILE());
    const kept = JSON.parse(rawStore(store));
    check(
      "an import keeps a stored entry written by another version",
      r.ok === true &&
        kept.some((e) => e.id === "future" && e.v === 99) &&
        kept.length === 2,
      rawStore(store).slice(0, 200),
    );
  }
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("fleet-snapshots-test: all checks passed");
}

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

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("fleet-snapshots-test: all checks passed");
}

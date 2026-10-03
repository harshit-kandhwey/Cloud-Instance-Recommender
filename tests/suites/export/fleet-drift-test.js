// Drift identity (src/features/fleet-snapshots.js compareFleet, 3.21 phase 3): a
// snapshot and a fresh run are compared only when they describe the same estate.
// Same estate means the same VM Name set, at or above MIN_OVERLAP of the larger side.
// Below that, or when either side cannot be keyed (duplicate or missing names), the
// comparison is refused, so no diff can pair unrelated VMs.
const { buildEngineContext, makeChecker } = require("../harness");

const { run } = buildEngineContext({
  scripts: [
    "src/shared/storage-keys.js",
    "src/shared/storage-manager.js",
    "src/shared/app-core.js",
    "src/features/scenario-compare.js",
    "src/features/fleet-snapshots.js",
  ],
  label: "fleet-drift",
});
const { check, state } = makeChecker();

const names = (n, prefix = "vm") =>
  Array.from({ length: n }, (_, i) => ({ "VM Name": `${prefix}-${i}` }));

function compare(snapshotRows, freshRows) {
  return run(
    `FleetSnapshots.compareFleet(${JSON.stringify({ rows: snapshotRows })}, ${JSON.stringify(freshRows)})`,
  );
}

{
  const r = compare(names(10), names(10));
  check(
    "the same estate compares, with full overlap",
    r.ok === true && r.overlap === 1,
  );
  check(
    "the same estate reports nothing added or removed",
    r.added.length === 0 && r.removed.length === 0,
  );
}

{
  const fresh = [...names(10), { "VM Name": "vm-new" }];
  const r = compare(names(10), fresh);
  check(
    "one new VM among eleven still clears the overlap threshold",
    r.ok === true && r.added.length === 1 && r.added[0] === "vm-new",
    JSON.stringify(r),
  );
}

{
  const r = compare(names(10), names(5));
  check(
    "half the estate is refused as a different estate",
    r.ok === false && r.reason === "low-overlap",
    JSON.stringify(r),
  );
  check("the refusal still names what went missing", r.removed.length === 5);
}

{
  const dup = [...names(3), { "VM Name": "vm-0" }];
  check(
    "duplicate VM names on the fresh side are refused",
    compare(names(3), dup).reason === "not-keyed",
  );
  const missing = [...names(3), { "VM Name": "" }];
  check(
    "a blank VM name on the fresh side is refused",
    compare(names(3), missing).reason === "not-keyed",
  );
}

{
  const r = compare([], []);
  check("two empty runs are never reported as the same fleet", r.ok === false);
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("fleet-drift-test: all checks passed");
}

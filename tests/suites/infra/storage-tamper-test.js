// localStorage is writable by anything on the origin, so every value read back from
// it is untrusted input (3.21 phase 1, A3). For each persisted store, a value that
// is not the expected shape must neither throw out of its loader nor be trusted:
// the loader returns an empty default, and a prototype-pollution payload must not
// reach Object.prototype.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, buildContext, makeChecker } = require("../harness");

const HOSTILE = {
  "unparseable JSON": "{not json",
  "a top-level array": "[1,2,3]",
  "a bare number": "42",
  "a bare string": '"hello"',
  null: "null",
  "a prototype-pollution payload":
    '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}',
};

const LOADERS = [
  [
    "filter presets",
    "cloudInstanceRecommenderFilterPresets",
    "loadPresetsStore()",
  ],
  [
    "app workload map",
    "cloudInstanceRecommenderAppMap",
    "loadAppWorkloadMap()",
  ],
  [
    "column mappings",
    "cloudInstanceRecommenderColumnMaps",
    "loadColumnMappings()",
  ],
  ["user rules", "cloudInstanceRecommenderUserRules", "loadUserRules()"],
];

const { check, state } = makeChecker();

for (const [label, storageKey, call] of LOADERS) {
  for (const [kind, raw] of Object.entries(HOSTILE)) {
    const { ctx, run } = buildContext({ seedStorage: { [storageKey]: raw } });
    if (label === "filter presets") {
      vm.runInContext(
        fs.readFileSync(path.join(REPO, "src/features/presets.js"), "utf8"),
        ctx,
        { filename: "presets.js" },
      );
    }
    let result;
    let threw = null;
    try {
      result = run(`JSON.stringify(${call})`);
    } catch (e) {
      threw = e;
    }
    check(
      `${label}: ${kind} does not throw`,
      threw === null,
      threw && String(threw.message),
    );
    if (threw === null) {
      check(
        `${label}: ${kind} leaves the loaded value on its own prototype`,
        run(
          `Object.getPrototypeOf(${call}) === Object.prototype || Array.isArray(${call})`,
        ),
      );
      check(
        `${label}: ${kind} does not pollute Object.prototype`,
        run("({}).polluted") === undefined,
      );
    }
  }
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("storage-tamper-test: all checks passed");
}

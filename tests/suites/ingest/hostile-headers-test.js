// A file's header text is attacker-controlled. Looking a header up in a plain
// mapping object finds inherited members, so a column called "constructor" or
// "toString" used to be renamed to that function's source text. And a saved
// mapping of the wrong shape must be ignored like an old-version one.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx, run } = buildContext();

ctx.rows = [
  {
    VM: "a",
    constructor: "x",
    toString: "y",
    valueOf: "z",
    "CPU Count": "2",
  },
];
ctx.mapping = { VM: "VM Name" };

console.log("[rewriteRowKeys leaves inherited-name headers alone]");
{
  const keys = run(`Object.keys(rewriteRowKeys(rows, mapping)[0])`);
  check(
    "the mapped header is renamed",
    keys.includes("VM Name") && !keys.includes("VM"),
    JSON.stringify(keys),
  );
  check(
    "constructor / toString / valueOf keep their own names",
    ["constructor", "toString", "valueOf"].every((k) => keys.includes(k)),
    JSON.stringify(keys),
  );
  check(
    "no key is a function's source text",
    !keys.some((k) => /native code/.test(k)),
    JSON.stringify(keys),
  );
}

console.log("[applyIngest computes the same final headers]");
{
  run(`applyIngest(Object.keys(rows[0]), rows, mapping)`);
  const headers = run(`columnHeaders`);
  check(
    "final headers keep inherited-name columns intact",
    !headers.some((h) => /native code/.test(h)) &&
      headers.includes("constructor") &&
      headers.includes("VM Name"),
    JSON.stringify(headers),
  );
}

console.log("[readSavedMapping ignores a wrong-shaped entry]");
{
  const read = (entry) =>
    JSON.stringify(run(`readSavedMapping(${JSON.stringify(entry)})`));
  check(
    "a well-formed entry is read",
    read({
      v: 2,
      mapping: { A: "VM Name" },
      units: { "Memory (GB)": "MB" },
    }) ===
      JSON.stringify({
        mapping: { A: "VM Name" },
        units: { "Memory (GB)": "MB" },
      }),
  );
  for (const [label, entry] of [
    ["a string mapping", { v: 2, mapping: "abc" }],
    ["an array mapping", { v: 2, mapping: ["VM Name"] }],
    ["an older version", { v: 1, mapping: { A: "VM Name" } }],
  ]) {
    check(`${label} is ignored`, read(entry) === "null", read(entry));
  }
  check(
    "a non-object units field falls back to empty",
    JSON.stringify(
      run(
        `readSavedMapping({ v: 2, mapping: { A: "VM Name" }, units: "MB" }).units`,
      ),
    ) === "{}",
  );
}

if (state.failures) {
  console.error(`\nhostile-headers: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nhostile-headers: all checks passed");
  process.exitCode = 0;
}

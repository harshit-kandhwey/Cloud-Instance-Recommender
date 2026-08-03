// Repeated headers (dedupeHeaders): two columns with the same name must NOT
// collapse into one. Rows are built by header NAME, so without the rename the
// later column silently overwrites the earlier one for every row, and the
// mapping panel then offers two entries that are secretly the same column.
// dedupeHeaders gives the repeats a distinct "(n)" name; the tricky part is the
// collision case, where the auto-name it would pick ("X (2)") already exists as
// a real third column — it has to keep counting, or it re-creates the very
// collapse it exists to prevent. Blank headers name no column and are left as-is.
//
// Covers both entry points: the direct unit contract and the CSV path
// (parseDelimitedText) that owns the rows keyed by those names.
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx } = buildContext();
const dedupe = (arr) =>
  vm.runInContext(`dedupeHeaders(${JSON.stringify(arr)})`, ctx);
const parseDelimited = (text) =>
  vm.runInContext(`parseDelimitedText(${JSON.stringify(text)})`, ctx);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("[a repeated name gets a distinct (n) suffix]");
{
  const out = dedupe(["Memory", "Memory"]);
  check(
    "the second Memory becomes Memory (2)",
    eq(out, ["Memory", "Memory (2)"]),
    JSON.stringify(out),
  );
  const three = dedupe(["cpu", "cpu", "cpu"]);
  check(
    "a third repeat keeps counting to (3)",
    eq(three, ["cpu", "cpu (2)", "cpu (3)"]),
    JSON.stringify(three),
  );
}

console.log("[the auto-name never re-collapses onto an existing column]");
{
  // "Memory (2)" already exists as a real third column, so renaming the second
  // "Memory" to "Memory (2)" would recreate the collision. It must skip to (3).
  const out = dedupe(["Memory", "Memory (2)", "Memory"]);
  check(
    "the repeat skips the taken (2) and lands on (3)",
    eq(out, ["Memory", "Memory (2)", "Memory (3)"]),
    JSON.stringify(out),
  );
  check(
    "every resulting name is unique",
    new Set(out).size === out.length,
    JSON.stringify(out),
  );
}

console.log("[blank headers name no column and are left alone]");
{
  const out = dedupe(["A", "", "A", ""]);
  check(
    "the repeated A is renamed but both blanks stay blank",
    eq(out, ["A", "", "A (2)", ""]),
    JSON.stringify(out),
  );
}

console.log("[end to end: a CSV keeps both same-named columns' values]");
{
  // Two columns literally called "Memory" with different values per row. The
  // collapse bug would leave only the second value under a single "Memory" key.
  const { headers, rows } = parseDelimited("VM,Memory,Memory\nweb-01,16,32");
  check(
    "the header list carries both names, distinctly",
    headers.includes("Memory") && headers.includes("Memory (2)"),
    JSON.stringify(headers),
  );
  const row = rows[0] || {};
  check(
    "the first column's value survives under Memory",
    String(row["Memory"]) === "16",
    JSON.stringify(row),
  );
  check(
    "the second column's value is kept under Memory (2), not merged away",
    String(row["Memory (2)"]) === "32",
    JSON.stringify(row),
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

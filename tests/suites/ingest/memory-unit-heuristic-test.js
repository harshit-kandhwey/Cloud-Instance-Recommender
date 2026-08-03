// A unit that lies: a memory column labelled GB whose values are really MiB.
// The engine cannot convert on the values alone — a real fleet of 512 GB–1 TB
// machines exists, and dividing it by 1024 would corrupt it exactly as surely
// as leaving RVTools' MiB alone. So the heuristic only ever RAISES A QUESTION,
// and it raises it from the MEDIAN, not the mean or the max, so one genuine
// outlier cannot speak for the file. The end-to-end "Is the memory column in
// MB?" prompt is covered by input-hygiene-test; this pins the load-bearing math
// underneath it — median robustness, the >= 1024 boundary, and the filtering of
// blanks/zeros/garbage — none of which that DOM-level test exercises.
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx } = buildContext();

const MEM = vm.runInContext("COLUMN_MAPPINGS.memory", ctx);
const median = (rows, col) =>
  vm.runInContext(
    `medianMemory(${JSON.stringify(rows)}, ${JSON.stringify(col)})`,
    ctx,
  );
// analyzeInputHygiene reads COLUMN_MAPPINGS.memory internally, so key the rows
// by it. Round-trip through JSON so the result crosses the vm boundary as data.
const memUnitOf = (mems) => {
  const rows = mems.map((m) => ({ [MEM]: String(m) }));
  return JSON.parse(
    vm.runInContext(
      `JSON.stringify(analyzeInputHygiene(${JSON.stringify(rows)}).memoryUnit ?? null)`,
      ctx,
    ),
  );
};
const col = (vals) => vals.map((v) => ({ m: v }));

console.log("[medianMemory is the true median, not the mean or the max]");
{
  // Mean ≈ 250012, max = 999999; only the median (16) is unmoved by the outlier.
  check(
    "one huge outlier does not move the median off 16",
    median(col([16, 16, 16, 999999]), "m") === 16,
    String(median(col([16, 16, 16, 999999]), "m")),
  );
  check(
    "odd length picks the middle value",
    median(col([8, 32, 16]), "m") === 16,
    String(median(col([8, 32, 16]), "m")),
  );
}

console.log("[medianMemory ignores blanks, zeros and non-numeric cells]");
{
  check(
    "blank, zero and garbage rows do not drag the median",
    median(col(["", "0", "not-a-number", 16, 16]), "m") === 16,
    String(median(col(["", "0", "not-a-number", 16, 16]), "m")),
  );
  check(
    "a column with no usable numbers is null, not zero or NaN",
    median(col(["", "0", "x"]), "m") === null,
    String(median(col(["", "0", "x"]), "m")),
  );
}

console.log("[the MB question is raised from the median, not one big machine]");
{
  // A small-GB fleet with a single enormous row: the median stays at 16, so the
  // question must NOT fire — this is the false positive the median exists to stop.
  check(
    "a small-GB fleet with one outlier does NOT raise the MB question",
    memUnitOf([16, 16, 16, 999999]) === null,
    JSON.stringify(memUnitOf([16, 16, 16, 999999])),
  );
  // A genuinely-MiB file: every value is thousands, so the median is too.
  const mib = memUnitOf([16384, 8192, 32768]);
  check(
    "a file whose median looks like MiB does raise the question",
    mib != null && mib.median === 16384,
    JSON.stringify(mib),
  );
}

console.log("[the 1024 boundary is inclusive]");
{
  check(
    "a median of exactly 1024 raises the question",
    (memUnitOf([1024, 1024, 1024]) || {}).median === 1024,
    JSON.stringify(memUnitOf([1024, 1024, 1024])),
  );
  check(
    "a median of 1023 does not",
    memUnitOf([1023, 1023, 1023]) === null,
    JSON.stringify(memUnitOf([1023, 1023, 1023])),
  );
}

console.log("[no memory column, no question]");
{
  const noMem = JSON.parse(
    vm.runInContext(
      `JSON.stringify(analyzeInputHygiene([{ "VM Name": "web-01" }]).memoryUnit ?? null)`,
      ctx,
    ),
  );
  check(
    "a file with no memory column raises nothing",
    noMem === null,
    JSON.stringify(noMem),
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

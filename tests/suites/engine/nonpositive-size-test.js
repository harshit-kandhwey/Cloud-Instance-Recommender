// A row whose CPU Count or Memory (GB) is not a positive number cannot be sized.
// A negative figure is a requirement every instance meets, so passing it through
// sized the VM to the smallest instance in the region with no error — a wrong
// answer that looks like any other pick. It must come back as a no-match that
// names the bad figure.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx, run } = buildContext();

const row = (name, cpu, mem) => ({
  "VM Name": name,
  "CPU Count": cpu,
  "Memory (GB)": mem,
  "AWS Region": "us-east-1",
});
ctx.rows = [
  row("ok", "4", "16"),
  row("neg-cpu", "-2", "8"),
  row("neg-mem", "2", "-8"),
  row("neg-both", "-2", "-8"),
  row("zero-cpu", "0", "8"),
  row("blank-mem", "2", ""),
];

(async () => {
  const results = await run(
    `getInstanceRecommendationWithSelector(rows, ['aws'], { generateLikeToLike: true })`,
  );
  const by = Object.fromEntries(results.map((r) => [r["VM Name"], r]));
  const inst = (n) => by[n]["AWS Like-to-Like Instance"];
  const why = (n) => by[n]["AWS No Match Reason"];

  check("a valid row still sizes", /\./.test(inst("ok")), inst("ok"));
  check(
    "a negative CPU Count is refused, not sized to the smallest instance",
    inst("neg-cpu") === "Missing data" &&
      why("neg-cpu") === "CPU Count is negative",
    `${inst("neg-cpu")} / ${why("neg-cpu")}`,
  );
  check(
    "a negative Memory is refused and named",
    inst("neg-mem") === "Missing data" &&
      why("neg-mem") === "Memory (GB) is negative",
    `${inst("neg-mem")} / ${why("neg-mem")}`,
  );
  check(
    "both negative names the CPU first",
    inst("neg-both") === "Missing data" &&
      why("neg-both") === "CPU Count is negative",
    why("neg-both"),
  );
  check(
    "a zero CPU Count keeps its own message",
    why("zero-cpu") === "CPU Count is 0 or missing",
    why("zero-cpu"),
  );
  check(
    "a blank Memory keeps its own message",
    why("blank-mem") === "Memory (GB) is 0 or missing",
    why("blank-mem"),
  );
})()
  .catch((err) => {
    console.error(err);
    state.failures++;
  })
  .finally(() => {
    if (state.failures) {
      console.error(`\nnonpositive-size: ${state.failures} check(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log("\nnonpositive-size: all checks passed");
      process.exitCode = 0;
    }
  });

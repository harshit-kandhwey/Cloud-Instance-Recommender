// Upload-time confidence (3.21 phase 6): how well the data behind each row, and
// behind the whole file, supports a sizing. Reported coarse, with a reason, and
// only when it says something: an ordinary average-only upload stays silent.
const vm = require("vm");
const { buildContext, makeChecker, parse } = require("../harness");

const { check, state } = makeChecker();
const html = (elements) => elements.inputHygieneSection.innerHTML;

const HEAD = "VM Name,CPU Count,Memory (GB),AWS Region";
const UTIL =
  "CPU Utilization,Memory Utilization,CPU Utilization p95,Memory Utilization p95";

console.log("[an average-only file says nothing about confidence]");
{
  const { ctx, elements } = buildContext();
  parse(
    ctx,
    `${HEAD},CPU Utilization,Memory Utilization
a,4,16,us-east-1,20,30
b,4,16,us-east-1,25,35`,
  );
  check(
    "no panel, no noise",
    elements.inputHygieneSection.classes.has("hidden") && html(elements) === "",
    html(elements),
  );
}

console.log("[a file that carries percentiles names the rows that fall short]");
{
  const { ctx, elements } = buildContext();
  // Row 2: both dimensions have a p95 → High. Row 3: CPU p95 but memory average
  // only → Medium. Row 4: averages only → Low. Row 5: no utilization → Low.
  parse(
    ctx,
    `${HEAD},${UTIL}
a,4,16,us-east-1,20,30,85,70
b,4,16,us-east-1,20,30,85,
c,4,16,us-east-1,20,30,,
d,4,16,us-east-1,,,,`,
  );
  const out = html(elements);
  check(
    "the panel appears with its own heading",
    out.includes("How well the data supports sizing"),
    out,
  );
  check(
    "High, Medium and Low are each counted",
    /High: 1 VM,/.test(out) &&
      /Medium: 1 VM,[^<]*\(rows 3\)/.test(out) &&
      /Low: 2 VMs,[^<]*bursts are invisible[^<]*\(rows 4, 5\)/.test(out),
    out,
  );
  check(
    "the file-level answer is separate and carries its own reason",
    /Whole file: <strong>Low<\/strong> — fewer than 25 VMs/.test(out),
    out,
  );
  check(
    "a confidence-only notice does not claim any row is wrong",
    !out.includes("look wrong") && out.includes("less utilization data"),
    out,
  );
  check(
    "the report keeps the assessment for later readers",
    ctx.window._inputHygiene.confidence &&
      ctx.window._inputHygiene.confidence.tiers.low.length === 2,
  );
}

console.log("[the two tiers cannot be gamed by each other]");
{
  const { ctx } = buildContext();
  const run = (rows) => {
    ctx.__rows = rows;
    return vm.runInContext("assessInputConfidence(__rows)", ctx);
  };
  const avgRow = (n) => ({
    "VM Name": `v${n}`,
    "CPU Utilization": "20",
    "Memory Utilization": "30",
  });
  const many = Array.from({ length: 300 }, (_, i) => avgRow(i));
  const r = run(many);
  check(
    "three hundred average-only rows raise the fleet tier but no row's",
    r.fleet === "high" &&
      r.tiers.low.length === 300 &&
      r.tiers.high.length === 0,
    JSON.stringify({ fleet: r.fleet, low: r.tiers.low.length }),
  );
  const oneRich = run([
    {
      "VM Name": "x",
      "CPU Utilization": "20",
      "CPU Utilization p95": "80",
      "Memory Utilization": "30",
      "Memory Utilization p95": "60",
    },
  ]);
  check(
    "one rich row is High, and the one-VM file is still Low",
    oneRich.tiers.high.length === 1 && oneRich.fleet === "low",
    JSON.stringify(oneRich),
  );
  const tierAt = (n) =>
    run(many.slice(0, 0).concat(Array.from({ length: n }, (_, i) => avgRow(i))))
      .fleet;
  check(
    "fleet tier edges: 24 Low, 25 Medium, 249 Medium, 250 High",
    tierAt(24) === "low" &&
      tierAt(25) === "medium" &&
      tierAt(249) === "medium" &&
      tierAt(250) === "high",
    [24, 25, 249, 250].map(tierAt).join(","),
  );
}

console.log("[what counts as a reading is the sizing resolver's own rule]");
{
  const { ctx } = buildContext();
  const run = (row) => {
    ctx.__rows = [row];
    return vm.runInContext("assessInputConfidence(__rows)", ctx);
  };
  check(
    "a non-numeric, zero or negative percentile is not a reading",
    ["n/a", "0", "-5", "  "].every(
      (junk) =>
        run({ "CPU Utilization": "20", "CPU Utilization p95": junk }).tiers.low
          .length === 1,
    ),
  );
  check(
    "an inherited percentile column is never a reading",
    run(
      Object.assign(Object.create({ "CPU Utilization p95": "99" }), {
        "CPU Utilization": "20",
      }),
    ).tiers.low.length === 1,
  );
  check(
    "a CPU-only file with a CPU percentile is High, not Medium for lacking memory",
    run({ "CPU Utilization": "20", "CPU Utilization p95": "80" }).tiers.high
      .length === 1,
  );
  check(
    "p90, p99 and peak each count as a burst-capable reading",
    [
      "CPU Utilization p90",
      "CPU Utilization p99",
      "CPU Utilization Peak",
    ].every(
      (col) =>
        run({ "CPU Utilization": "20", [col]: "80" }).tiers.high.length === 1,
    ),
  );
  check(
    "the median is not a burst-capable reading",
    run({ "CPU Utilization": "20", "CPU Utilization p50": "10" }).tiers.low
      .length === 1,
  );
}

process.exitCode = state.failures ? 1 : 0;

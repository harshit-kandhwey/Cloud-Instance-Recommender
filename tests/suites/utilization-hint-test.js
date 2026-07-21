// The "Size against" statistic hint (onUtilizationStatisticChange) must warn
// only about the ENABLED optimization axes. A run with Memory-Based off and a
// file that carries CPU alone is complete — warning that the missing memory
// statistic "falls back for every row" is a false alarm about a dimension the
// run never reads. These checks pin that: the hint tracks the active axes, not
// both unconditionally.
const vm = require("vm");
const { buildContext, makeChecker } = require("./harness");

const { check, state } = makeChecker();

function drive(ctx, { stat, cpu, memory, headers }) {
  vm.runInContext(`columnHeaders = ${JSON.stringify(headers)}`, ctx);
  ctx.document.getElementById("cpuBased").checked = cpu;
  ctx.document.getElementById("memoryBased").checked = memory;
  const sel = ctx.document.getElementById("utilizationStatistic");
  sel.value = stat;
  const hint = ctx.document.getElementById("utilizationStatisticHint");
  hint.classes.delete("hint-warning");
  ctx.onUtilizationStatisticChange();
  return {
    text: hint.textContent,
    warned: hint.classes.has("hint-warning"),
  };
}

(async () => {
  const { ctx } = buildContext();

  const CPU95 = "CPU Utilization p95";
  const MEM95 = "Memory Utilization p95";

  console.log("[both axes on: unchanged dual-axis behaviour]");
  let r = drive(ctx, {
    stat: "p95",
    cpu: true,
    memory: true,
    headers: [CPU95, MEM95],
  });
  check("both columns present → no warning", !r.warned, r.text);
  check(
    "both present → positive 'Sizing against' message",
    /Sizing against p95/.test(r.text),
    r.text,
  );

  r = drive(ctx, { stat: "p95", cpu: true, memory: true, headers: [CPU95] });
  check("both axes on, only CPU present → warns", r.warned, r.text);
  check(
    "the warning names the missing memory column",
    r.text.includes(MEM95),
    r.text,
  );

  console.log("[Memory-Based off: the finding-4 fix]");
  r = drive(ctx, { stat: "p95", cpu: true, memory: false, headers: [CPU95] });
  check(
    "memory axis off + CPU present → NO warning (was a false alarm)",
    !r.warned,
    r.text,
  );
  check(
    "memory off + CPU present → positive message",
    /Sizing against p95/.test(r.text),
    r.text,
  );

  r = drive(ctx, { stat: "p95", cpu: true, memory: false, headers: [MEM95] });
  check(
    "memory off + only CPU axis active but its column absent → warns",
    r.warned,
    r.text,
  );
  check(
    "that warning names the CPU column, not memory",
    r.text.includes(CPU95) && !r.text.includes(MEM95),
    r.text,
  );

  console.log("[CPU-Based off: symmetric]");
  r = drive(ctx, { stat: "p95", cpu: false, memory: true, headers: [MEM95] });
  check("cpu axis off + memory present → NO warning", !r.warned, r.text);

  r = drive(ctx, { stat: "p95", cpu: false, memory: true, headers: [CPU95] });
  check(
    "cpu off + only memory axis active but its column absent → warns",
    r.warned,
    r.text,
  );
  check(
    "that warning names the memory column, not CPU",
    r.text.includes(MEM95) && !r.text.includes(CPU95),
    r.text,
  );

  process.exit(state.failures ? 1 : 0);
})();

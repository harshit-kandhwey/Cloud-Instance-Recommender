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
    html: hint.innerHTML,
    warned: hint.classes.has("hint-warning"),
  };
}

// toggleOptimizationMode also refreshes the enabled axis's range inputs, and
// updateCpu/MemoryRanges reach through the upsize input's parentElement to a
// label span. On the real page that structure exists; the fake DOM fabricates
// bare elements, so give those two inputs the parent-with-span shape they read
// (else the range update throws before the hint refresh under test is reached).
function seedRangeParents(ctx) {
  for (const id of ["cpuUpsizeMin", "memoryUpsizeMin"]) {
    const el = ctx.document.getElementById(id);
    const span = { textContent: "" };
    el.parentElement = { style: {}, querySelectorAll: () => [span] };
  }
}

// Flip the axes and go through toggleOptimizationMode (NOT the handler
// directly) — this is what a user does when they tick an axis off, and it is
// the only thing that proves toggleOptimizationMode re-evaluates the hint. The
// statistic and headers are left as the preceding drive() set them.
function toggle(ctx, { cpu, memory }) {
  ctx.document.getElementById("cpuBased").checked = cpu;
  ctx.document.getElementById("memoryBased").checked = memory;
  const hint = ctx.document.getElementById("utilizationStatisticHint");
  ctx.toggleOptimizationMode();
  return {
    text: hint.textContent,
    html: hint.innerHTML,
    warned: hint.classes.has("hint-warning"),
  };
}

(async () => {
  const { ctx } = buildContext();

  const CPU95 = "CPU Utilization p95";
  const MEM95 = "Memory Utilization p95";

  // Seed a distinctive default so dataset.defaultHtml — captured on the first
  // handler call — is a real string, and the neutral branch has something
  // meaningful to restore. The neutral path does `innerHTML = defaultHtml`, so
  // this is what "the hint went back to its default guidance" looks like.
  const DEFAULT_HTML = "<strong>Sized On</strong> — the statistic sizing uses.";
  ctx.document.getElementById("utilizationStatisticHint").innerHTML =
    DEFAULT_HTML;

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

  console.log("[toggleOptimizationMode refreshes the hint]");
  seedRangeParents(ctx);
  // Establish a live warning (both axes on, only CPU present → memory missing),
  // then disable Memory-Based via the toggle path. If toggleOptimizationMode
  // did not re-run the hint, the stale "memory falls back" warning would remain
  // and this would fail — which is the point of driving through the toggle.
  drive(ctx, { stat: "p95", cpu: true, memory: true, headers: [CPU95] });
  r = toggle(ctx, { cpu: true, memory: false });
  check(
    "disabling Memory-Based clears the now-stale warning (via toggle, not the handler)",
    !r.warned,
    r.text,
  );
  check(
    "and the refreshed hint is the positive message",
    /Sizing against p95/.test(r.text),
    r.text,
  );

  console.log("[both axes disabled → neutral hint, never a phantom warning]");
  // A column IS present (so the earlier no-headers guard does not fire) but no
  // axis is enabled. The naive present/missing test would then read 0-of-0
  // active columns and fire a nonsense "no p95 columns () for the enabled
  // optimization axes" warning; the no-axis guard must short-circuit to the
  // neutral hint instead.
  drive(ctx, { stat: "p95", cpu: true, memory: true, headers: [CPU95] }); // warns (mem missing)
  // Dirty the markup first, so the text assertion proves the neutral branch
  // actually RESTORED the default — not merely that no warning class was added.
  // A regression that showed some other non-neutral message would leave this
  // sentinel in place (warnings write textContent, the neutral path innerHTML).
  ctx.document.getElementById("utilizationStatisticHint").innerHTML =
    "STALE-DIRTY";
  r = toggle(ctx, { cpu: false, memory: false });
  check(
    "both axes off (a column present) → no phantom 0-of-0 warning",
    !r.warned,
    r.text,
  );
  check(
    "both axes off → the hint is restored to its neutral default text",
    r.html === DEFAULT_HTML,
    r.html,
  );

  process.exit(state.failures ? 1 : 0);
})();

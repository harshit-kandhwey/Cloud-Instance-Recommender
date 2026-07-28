// Range-linking verification for updateCpuRanges / updateMemoryRanges.
//
// These two handlers keep the downsize/keep/upsize sliders consistent: the keep
// band's lower edge tracks the downsize ceiling, the upsize floor tracks the keep
// ceiling, and upsizing is disabled once the keep ceiling reaches 100%. They are
// the model behind the CPU/Memory sizing controls, so a break here silently lets
// the panel offer an impossible range (e.g. an upsize floor below the keep
// ceiling) without ever throwing. The behavioral surface both handlers sit on is
// what this suite covers.
//
// The shared fakeElement does not model parentElement or a real querySelectorAll,
// and both handlers read `upsizeMin.parentElement` and its <span> children — so
// each scenario attaches a parentElement stub to the upsize input it materialises.
const { buildContext, makeChecker } = require("./harness");

// Give the upsize input a label parent with two spans, the second of which the
// handler rewrites. Returns the label so the caller can read style/spans back.
function attachUpsizeLabel(ctx, id) {
  const el = ctx.document.getElementById(id);
  const spans = [{ textContent: "from" }, { textContent: "to" }];
  el.parentElement = {
    style: {},
    querySelectorAll: (sel) => (sel === "span" ? spans : []),
  };
  el.parentElement.spans = spans;
  return el.parentElement;
}

function setVal(ctx, id, v) {
  ctx.document.getElementById(id).value = String(v);
}

const { check, state } = makeChecker();

// ── CPU: keepMax below 100 → bands link, upsizing enabled ──────────────────────
{
  const { ctx } = buildContext();
  ["cpuDownsizeMax", "cpuKeepMin", "cpuKeepMax", "cpuUpsizeMin"].forEach((id) =>
    ctx.document.getElementById(id),
  );
  setVal(ctx, "cpuDownsizeMax", 20);
  setVal(ctx, "cpuKeepMax", 80);
  const label = attachUpsizeLabel(ctx, "cpuUpsizeMin");

  ctx.updateCpuRanges();

  check(
    "cpu keep-min tracks downsize-max",
    ctx.document.getElementById("cpuKeepMin").value === 20,
    ctx.document.getElementById("cpuKeepMin").value,
  );
  check(
    "cpu upsize-min tracks keep-max",
    ctx.document.getElementById("cpuUpsizeMin").value === 80,
    ctx.document.getElementById("cpuUpsizeMin").value,
  );
  check("cpu upsizing enabled (opacity 1)", label.style.opacity === "1");
  check(
    "cpu upsize label reads to 100%",
    label.spans[1].textContent === "% to 100%",
    label.spans[1].textContent,
  );
}

// ── CPU: keepMax at 100 → upsizing disabled ────────────────────────────────────
{
  const { ctx } = buildContext();
  ["cpuDownsizeMax", "cpuKeepMin", "cpuKeepMax", "cpuUpsizeMin"].forEach((id) =>
    ctx.document.getElementById(id),
  );
  setVal(ctx, "cpuDownsizeMax", 30);
  setVal(ctx, "cpuKeepMax", 100);
  const label = attachUpsizeLabel(ctx, "cpuUpsizeMin");

  ctx.updateCpuRanges();

  check("cpu upsizing dimmed (opacity 0.5)", label.style.opacity === "0.5");
  check(
    "cpu upsize label reads disabled",
    label.spans[1].textContent === "% - Disabled (upper limit is 100%)",
    label.spans[1].textContent,
  );
}

// ── CPU: a missing input → early return, nothing mutated, no throw ─────────────
{
  const { ctx } = buildContext({ missingElements: ["cpuKeepMin"] });
  setVal(ctx, "cpuDownsizeMax", 25);
  setVal(ctx, "cpuKeepMax", 60);
  const upsize = ctx.document.getElementById("cpuUpsizeMin");
  upsize.value = "sentinel";
  let threw = false;
  try {
    ctx.updateCpuRanges();
  } catch {
    threw = true;
  }
  check("cpu guard: no throw when an input is absent", !threw);
  check(
    "cpu guard: untouched when an input is absent",
    upsize.value === "sentinel",
    upsize.value,
  );
}

// ── Memory: keepMax below 100 → bands link, upsizing enabled ───────────────────
{
  const { ctx } = buildContext();
  [
    "memoryDownsizeMax",
    "memoryKeepMin",
    "memoryKeepMax",
    "memoryUpsizeMin",
  ].forEach((id) => ctx.document.getElementById(id));
  setVal(ctx, "memoryDownsizeMax", 15);
  setVal(ctx, "memoryKeepMax", 75);
  const label = attachUpsizeLabel(ctx, "memoryUpsizeMin");

  ctx.updateMemoryRanges();

  check(
    "memory keep-min tracks downsize-max",
    ctx.document.getElementById("memoryKeepMin").value === 15,
    ctx.document.getElementById("memoryKeepMin").value,
  );
  check(
    "memory upsize-min tracks keep-max",
    ctx.document.getElementById("memoryUpsizeMin").value === 75,
    ctx.document.getElementById("memoryUpsizeMin").value,
  );
  check("memory upsizing enabled (opacity 1)", label.style.opacity === "1");
  check(
    "memory upsize label reads to 100%",
    label.spans[1].textContent === "% to 100%",
    label.spans[1].textContent,
  );
}

// ── Memory: keepMax at 100 → upsizing disabled ─────────────────────────────────
{
  const { ctx } = buildContext();
  [
    "memoryDownsizeMax",
    "memoryKeepMin",
    "memoryKeepMax",
    "memoryUpsizeMin",
  ].forEach((id) => ctx.document.getElementById(id));
  setVal(ctx, "memoryDownsizeMax", 40);
  setVal(ctx, "memoryKeepMax", 100);
  const label = attachUpsizeLabel(ctx, "memoryUpsizeMin");

  ctx.updateMemoryRanges();

  check("memory upsizing dimmed (opacity 0.5)", label.style.opacity === "0.5");
  check(
    "memory upsize label reads disabled",
    label.spans[1].textContent === "% - Disabled (upper limit is 100%)",
    label.spans[1].textContent,
  );
}

// ── Memory: a missing input → early return, nothing mutated, no throw ──────────
{
  const { ctx } = buildContext({ missingElements: ["memoryUpsizeMin"] });
  setVal(ctx, "memoryDownsizeMax", 25);
  setVal(ctx, "memoryKeepMax", 60);
  const keepMin = ctx.document.getElementById("memoryKeepMin");
  keepMin.value = "sentinel";
  let threw = false;
  try {
    ctx.updateMemoryRanges();
  } catch {
    threw = true;
  }
  check("memory guard: no throw when an input is absent", !threw);
  check(
    "memory guard: untouched when an input is absent",
    keepMin.value === "sentinel",
    keepMin.value,
  );
}

process.exitCode = state.failures ? 1 : 0;

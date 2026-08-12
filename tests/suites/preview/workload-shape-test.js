// Workload shape: the RAM-per-vCPU classification of the SOURCE VM, in two
// layers. The pure primitive classifyWorkloadShape (provider-agnostic, so the
// later portfolio family-mix rollup can reuse it) sorts a row into compute /
// general / memory; the preview badge trails the provisioned Memory (GB) cell
// with "Compute-optimized" / "Memory-optimized" and is silent on the general
// band. Display-only, like the fit and verdict flags — it must never reach a
// download, so the CSV schema and the goldens stay untouched.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx, elements } = buildContext();
const classify = ctx.classifyWorkloadShape;

// A source row carrying only the shape inputs; the badge reads CPU Count /
// Memory (GB), nothing about a recommendation.
const src = (name, cpu, mem) => ({
  "VM Name": name,
  "CPU Count": String(cpu),
  "Memory (GB)": String(mem),
});
const render = (rows) => {
  ctx.showResultsPreview(rows);
  return elements.resultsPreviewSection.innerHTML;
};
const rowFor = (html, vmName) =>
  (html.match(/<tr[\s\S]*?<\/tr>/g) || []).find((r) =>
    r.includes(`>${vmName}<`),
  ) || "";

console.log("[classifyWorkloadShape sorts a row by its RAM-per-vCPU ratio]");
{
  // The plan's two contract rows: lean RAM is compute, rich RAM is memory.
  check(
    "8 vCPU / 16 GB (ratio 2) is compute-optimized",
    classify(8, 16)?.shape === "compute",
    JSON.stringify(classify(8, 16)),
  );
  check(
    "4 vCPU / 32 GB (ratio 8) is memory-optimized",
    classify(4, 32)?.shape === "memory",
    JSON.stringify(classify(4, 32)),
  );
  check(
    "4 vCPU / 16 GB (ratio 4) is general",
    classify(4, 16)?.shape === "general",
    JSON.stringify(classify(4, 16)),
  );
  check(
    "the ratio is reported alongside the shape",
    classify(4, 32)?.ratio === 8,
    JSON.stringify(classify(4, 32)),
  );
}

console.log("[the boundaries are inclusive and pinned]");
{
  // Exactly 2.5 GB/vCPU is still compute; a hair above tips to general.
  check(
    "ratio exactly 2.5 (4 vCPU / 10 GB) is compute",
    classify(4, 10)?.shape === "compute",
    JSON.stringify(classify(4, 10)),
  );
  check(
    "ratio 2.75 (4 vCPU / 11 GB) is general",
    classify(4, 11)?.shape === "general",
    JSON.stringify(classify(4, 11)),
  );
  // Exactly 6 GB/vCPU is already memory; a hair below stays general.
  check(
    "ratio exactly 6 (4 vCPU / 24 GB) is memory",
    classify(4, 24)?.shape === "memory",
    JSON.stringify(classify(4, 24)),
  );
  check(
    "ratio 5.75 (4 vCPU / 23 GB) is general",
    classify(4, 23)?.shape === "general",
    JSON.stringify(classify(4, 23)),
  );
}

console.log("[a row with nothing to classify returns null, never a guess]");
{
  check("null when memory is missing", classify(4, "") === null);
  check("null when cpu is not a number", classify("n/a", 16) === null);
  check("null when cpu is zero (no ratio)", classify(0, 16) === null);
  check("null when memory is negative", classify(4, -8) === null);
}

console.log(
  "[the badge marks the two skewed shapes and stays silent on general]",
);
{
  const html = render([
    src("mem", 4, 32), // memory-optimized
    src("cpu", 8, 16), // compute-optimized
    src("gen", 4, 16), // general → no badge
  ]);
  check(
    "the memory-heavy row is flagged Memory-optimized",
    rowFor(html, "mem").includes("Memory-optimized"),
    rowFor(html, "mem"),
  );
  check(
    "the compute-heavy row is flagged Compute-optimized",
    rowFor(html, "cpu").includes("Compute-optimized"),
    rowFor(html, "cpu"),
  );
  // Assert the row is present before asserting what it lacks, or "no badge"
  // passes vacuously against a lookup that found nothing.
  const genRow = rowFor(html, "gen");
  check("the general row is present to be checked", genRow.includes(">gen<"));
  check(
    "a general-band row carries no shape badge",
    genRow.includes(">gen<") &&
      !genRow.includes("Memory-optimized") &&
      !genRow.includes("Compute-optimized"),
    genRow,
  );
}

console.log("[each shape wears its own CPU / memory label colour]");
{
  const html = render([src("mem", 4, 32), src("cpu", 8, 16)]);
  const spanOf = (word) =>
    html.match(new RegExp(`<span[^>]*>${word}</span>`))?.[0] || "";
  check(
    "Memory-optimized wears the memory label token (teal)",
    spanOf("Memory-optimized").includes("var(--util-label-mem)"),
    spanOf("Memory-optimized"),
  );
  check(
    "Compute-optimized wears the CPU label token (indigo)",
    spanOf("Compute-optimized").includes("var(--util-label-cpu)"),
    spanOf("Compute-optimized"),
  );
}

console.log("[the badge carries a text alternative naming the ratio]");
{
  const html = render([src("mem", 4, 32)]);
  check(
    "the flag has an aria-label reporting the GB-per-vCPU it acted on",
    /aria-label="Memory-optimized shape: 8 GB RAM per vCPU[^"]*"/.test(html),
    html.match(/aria-label="[^"]*shape:[^"]*"/)?.[0],
  );
}

console.log("[the badge is display-only — it never enters the row data]");
{
  const row = src("a", 4, 32);
  const before = JSON.stringify(row);
  const keysBefore = Object.keys(row).length;
  render([row]);
  check("rendering does not mutate the row", JSON.stringify(row) === before);
  check("no column was added", Object.keys(row).length === keysBefore);
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

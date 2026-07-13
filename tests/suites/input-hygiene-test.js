// Input hygiene: bad rows are named, with the row numbers a spreadsheet shows,
// before the run rather than after — and a clean file says nothing at all.
const { buildContext, makeChecker, rowsOf, parse } = require("./harness");

const { check, state } = makeChecker();
const panel = (elements) => elements.inputHygieneSection;
const ingest = parse;
const rows = rowsOf;

const CLEAN = `VM Name,CPU Count,Memory (GB),CPU Utilization,AWS Region
web-01,4,16,45,us-east-1
db-02,8,32,70,us-west-2`;

console.log("[a clean file says nothing]");
{
  const { ctx, elements } = buildContext();
  ingest(ctx, CLEAN);
  check(
    "no panel, no noise",
    panel(elements).classes.has("hidden") && panel(elements).innerHTML === "",
    panel(elements).innerHTML,
  );
}

console.log("[rows that cannot size are named, with their row numbers]");
{
  const { ctx, elements } = buildContext();
  // Row 2 is fine. Row 3 has no CPU, row 4 has zero memory, row 5 has a CPU
  // count no provider sells, row 6 reports 140% utilization.
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),CPU Utilization,AWS Region
web-01,4,16,45,us-east-1
no-cpu,,16,50,us-east-1
no-mem,4,0,50,us-east-1
huge,9999,16,50,us-east-1
over,4,16,140,us-east-1`,
  );
  const html = panel(elements).innerHTML;
  check("the panel is shown", !panel(elements).classes.has("hidden"));
  check(
    "missing CPU is reported against row 3",
    /CPU count is missing or zero[^<]*1 row \(3\)/.test(html),
    html,
  );
  check(
    "zero memory is reported against row 4",
    /Memory is missing or zero[^<]*1 row \(4\)/.test(html),
    html,
  );
  check(
    "an impossible CPU count is reported against row 5",
    /CPU count above 512[^<]*1 row \(5\)/.test(html),
    html,
  );
  check(
    "utilization outside 0–100% is reported against row 6",
    /CPU utilization outside 0–100%[^<]*1 row \(6\)/.test(html),
    html,
  );
  // The row numbers are the ones the user sees in their spreadsheet: the header
  // is row 1, so the first data row is 2. Off-by-one here sends them hunting.
  check(
    "the good row is never mentioned",
    !html.includes("(2)") && !/\(2,/.test(html),
    html,
  );
  check(
    "but the file still loads — a report, not a gate",
    rows(ctx).length === 5,
  );
}

console.log("[duplicate names are a question, not a verdict]");
{
  const { ctx, elements, toasts } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1
db-02,8,32,us-east-1
web-01,4,16,us-west-2`,
  );
  const html = panel(elements).innerHTML;
  check(
    "the repeated name and both its rows are named",
    /web-01[^<]*rows 2, 4/.test(html),
    html,
  );
  check(
    "both answers are offered rather than one being taken",
    html.includes("mergeDuplicateVmNames()") &&
      html.includes("keepDuplicateVmNames()"),
  );
  check("nothing is dropped until asked", rows(ctx).length === 3);

  ctx.mergeDuplicateVmNames();
  check(
    "merging keeps the first of each name",
    rows(ctx).length === 2 &&
      rows(ctx)
        .map((r) => r["AWS Region"])
        .join(",") === "us-east-1,us-east-1",
    JSON.stringify(rows(ctx)),
  );
  check(
    "and the panel clears, because the question is answered",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );
  check(
    "the user is told what was removed",
    toasts.some((t) => /Removed 1 duplicate row/.test(t.message)),
    JSON.stringify(toasts),
  );
}

console.log("[removed duplicates stay removed]");
{
  // csvData is the mapped view of _lastIngest.rows. Pruning only the view left
  // the source rows intact, so anything that re-derives from them — editing the
  // mapping, answering the memory-unit question — brought every duplicate back.
  const { ctx, elements } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1
db-02,8,32,us-east-1
web-01,4,16,us-west-2`,
  );
  ctx.mergeDuplicateVmNames();
  check("merged down to two rows", rows(ctx).length === 2);
  check(
    "and the SOURCE rows were pruned too, not just the view",
    ctx.window._lastIngest.rows.length === 2,
    JSON.stringify(ctx.window._lastIngest.rows),
  );

  // Re-derive from source, the way editing the mapping does.
  const last = ctx.window._lastIngest;
  ctx.applyIngest(last.headers, last.rows, last.mapping, last.units);
  check(
    "re-deriving from source does not resurrect them",
    rows(ctx).length === 2 &&
      rows(ctx)
        .map((r) => r["VM Name"])
        .join(",") === "web-01,db-02",
    JSON.stringify(rows(ctx).map((r) => r["VM Name"])),
  );
  check(
    "and the panel stays quiet, because there is nothing left to ask",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );
}

console.log("[keeping duplicates stops the question being re-asked]");
{
  const { ctx, elements } = buildContext();
  const dupes = `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1
web-01,4,16,us-west-2`;
  ingest(ctx, dupes);
  ctx.keepDuplicateVmNames();
  check(
    "the panel clears and every row survives",
    panel(elements).classes.has("hidden") && rows(ctx).length === 2,
  );
  // The report is recomputed from the data, so a dismissal that lived inside it
  // would simply be regenerated on the next render.
  ctx.reportInputHygiene();
  check(
    "and it stays cleared on a re-render",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );

  // But the answer belonged to THAT file. A new upload must ask again.
  ingest(ctx, dupes);
  check(
    "a fresh upload asks again",
    !panel(elements).classes.has("hidden") &&
      panel(elements).innerHTML.includes("keepDuplicateVmNames()"),
    panel(elements).innerHTML,
  );
}

console.log("[fixing one thing does not re-ask about another]");
{
  // A file with BOTH questions open: a repeated name, and memory that looks like
  // MiB. The user answers the duplicate question, then converts the units.
  //
  // The conversion re-derives from source through applyIngest, which clears the
  // per-file acknowledgements because it is normally the arrival of a NEW file.
  // This is not that — it is a remediation of the file already loaded, and
  // dividing memory by 1024 cannot change which VM names repeat. Re-asking would
  // look to the user like their answer had not registered.
  const { ctx, elements } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory,AWS Region
web-01,4,16384,us-east-1
web-01,4,16384,us-west-2
db-02,8,65536,us-east-1`,
  );
  const opening = panel(elements).innerHTML;
  check(
    "both questions are open",
    /used more than once/.test(opening) &&
      /Is the memory column in MB\?/.test(opening),
    opening,
  );

  ctx.keepDuplicateVmNames(); // "they are different VMs"
  ctx.convertMemoryToGb(); // "and the memory really is MiB"

  const after = panel(elements).innerHTML;
  check(
    "the memory is converted",
    rows(ctx)
      .map((r) => r["Memory (GB)"])
      .join(",") === "16,16,64",
    JSON.stringify(rows(ctx).map((r) => r["Memory (GB)"])),
  );
  check(
    "and the duplicate question is NOT asked again",
    !/used more than once/.test(after),
    after,
  );
  check(
    "with all three rows still present, as the user asked",
    rows(ctx).length === 3,
    String(rows(ctx).length),
  );
}
{
  // The inverse, which must keep working: re-mapping the columns DOES re-ask.
  // Choosing a different column as the VM name genuinely changes which rows are
  // duplicates, so a previous answer no longer means anything.
  const { ctx, elements } = buildContext();
  ingest(
    ctx,
    `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1
web-01,4,16,us-west-2`,
  );
  ctx.keepDuplicateVmNames();
  check(
    "the question is put away",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );

  const last = ctx.window._lastIngest;
  ctx.applyIngest(last.headers, last.rows, last.mapping, last.units);
  check(
    "but re-applying a mapping asks again, because the rows may now differ",
    /used more than once/.test(panel(elements).innerHTML),
    panel(elements).innerHTML,
  );
}

console.log("[a long list of bad rows is summarised, not dumped]");
{
  const { ctx, elements } = buildContext();
  const many = Array.from({ length: 20 }, (_, i) => `vm-${i},0,16,us-east-1`);
  ingest(ctx, ["VM Name,CPU Count,Memory (GB),AWS Region", ...many].join("\n"));
  const html = panel(elements).innerHTML;
  check(
    "all 20 are counted but only the first few listed",
    /20 rows \(2, 3, 4, 5, 6, 7, 8, 9 and 12 more\)/.test(html),
    html,
  );
}

process.exit(state.failures ? 1 : 0);

// The sample gallery. The samples go through the real pipeline, so the messy one
// has to ACTUALLY trip the input check — a sample that merely describes bad data
// without producing it teaches nothing and rots silently.
const { buildContext, makeChecker, rowsOf } = require("./harness");

const { check, state } = makeChecker();
const rows = rowsOf;

console.log("[the gallery offers the three samples]");
{
  const { ctx, elements } = buildContext();
  ctx.renderSampleGallery();
  const html = elements.sampleGallery.innerHTML;
  check(
    "small, large and messy are all offered",
    /Small &amp; clean|Small & clean/.test(html) &&
      html.includes("Large") &&
      html.includes("Deliberately messy"),
    html,
  );
  check(
    "each loads by index, not by interpolated text",
    (html.match(/loadSampleDataset\(\d+\)/g) || []).length === 3,
    html,
  );
}

console.log("[the clean sample is genuinely clean]");
{
  const { ctx, elements } = buildContext();
  ctx.loadSampleDataset(0);
  check("it loads 8 rows", rows(ctx).length === 8, String(rows(ctx).length));
  check(
    "the input check finds nothing to say about it",
    elements.inputHygieneSection.classes.has("hidden"),
    elements.inputHygieneSection.innerHTML,
  );
  check(
    "and it needs no column mapping",
    elements.columnMappingSection.classes.has("hidden"),
  );
}

console.log("[the large sample is large, and deterministic]");
{
  const { ctx } = buildContext();
  ctx.loadSampleDataset(1);
  check("500 rows", rows(ctx).length === 500, String(rows(ctx).length));

  // Two people clicking "Large" must be looking at the same file, or comparing
  // notes about it is meaningless.
  const second = buildContext();
  second.ctx.loadSampleDataset(1);
  check(
    "the same file every time",
    JSON.stringify(rows(ctx)) === JSON.stringify(rowsOf(second.ctx)),
  );
}

console.log("[the messy sample really is messy — it trips the checks]");
{
  const { ctx, elements } = buildContext();
  ctx.loadSampleDataset(2);
  const html = elements.inputHygieneSection.innerHTML;

  check(
    "the input check fires at all",
    !elements.inputHygieneSection.classes.has("hidden"),
    html,
  );
  check(
    "it catches the row with no CPU",
    /CPU count is missing or zero/.test(html),
    html,
  );
  check(
    "it catches the impossible utilization",
    /CPU utilization outside 0–100%/.test(html),
    html,
  );
  check("it catches the blank VM name", /VM name is blank/.test(html), html);
  check(
    "it asks about the duplicate VM name",
    /used more than once/.test(html) && /web-01/.test(html),
    html,
  );
  check(
    "and it asks whether the memory column is MiB",
    /Is the memory column in MB\?/.test(html),
    html,
  );
  check(
    "the memory is left untouched until that question is answered",
    rows(ctx)[0]["Memory (GB)"] === "16384",
    JSON.stringify(rows(ctx)[0]),
  );

  // The questions are answerable, and answering them fixes the file.
  ctx.convertMemoryToGb();
  check(
    "answering MB converts it",
    rows(ctx)[0]["Memory (GB)"] === "16",
    JSON.stringify(rows(ctx)[0]),
  );
  ctx.mergeDuplicateVmNames();
  check(
    "and merging the duplicate leaves one web-01",
    rows(ctx).filter((r) => r["VM Name"] === "web-01").length === 1,
    JSON.stringify(rows(ctx).map((r) => r["VM Name"])),
  );
}

console.log("[a sample replaces whatever was loaded before]");
{
  const { ctx, elements } = buildContext();
  ctx.document.getElementById("csvFile").value = "old-inventory.csv";
  ctx.loadSampleDataset(0);
  check(
    "the stale file name is cleared",
    elements.csvFile.value === "",
    elements.csvFile.value,
  );
  check(
    "and the status says which sample is loaded",
    /Sample loaded \(Small & clean\)/.test(elements.fileStatus.innerHTML),
    elements.fileStatus.innerHTML,
  );
}

process.exit(state.failures ? 1 : 0);

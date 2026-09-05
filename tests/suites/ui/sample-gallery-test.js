// The sample gallery. The samples go through the real pipeline, so the messy one
// has to ACTUALLY trip the input check — a sample that merely describes bad data
// without producing it teaches nothing and rots silently.
const { buildContext, makeChecker, rowsOf, headersOf } = require("../harness");

const { check, state } = makeChecker();

console.log("[the gallery offers all four samples]");
{
  const { ctx, elements } = buildContext();
  ctx.renderSampleGallery();
  const html = elements.sampleGallery.innerHTML;
  check(
    "small, large, messy and full feature set are all offered",
    /Small &amp; clean|Small & clean/.test(html) &&
      html.includes("Large") &&
      html.includes("Deliberately messy") &&
      html.includes("Full feature set"),
    html,
  );
  // Not just four calls — four DISTINCT indexes. Four loadSampleDataset(0)
  // calls would pass a bare count while every gallery action loaded the same
  // sample, which is the exact defect this check exists to catch.
  const indexes = [...html.matchAll(/loadSampleDataset\((\d+)\)/g)]
    .map((match) => match[1])
    .sort();
  check(
    "each loads by index, not by interpolated text",
    indexes.join(",") === "0,1,2,3",
    html,
  );
}

console.log("[the clean sample is genuinely clean]");
{
  const { ctx, elements } = buildContext();
  ctx.loadSampleDataset(0);
  check(
    "it loads 8 rows",
    rowsOf(ctx).length === 8,
    String(rowsOf(ctx).length),
  );
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
  check("500 rows", rowsOf(ctx).length === 500, String(rowsOf(ctx).length));

  // Two people clicking "Large" must be looking at the same file, or comparing
  // notes about it is meaningless.
  const second = buildContext();
  second.ctx.loadSampleDataset(1);
  const a = rowsOf(ctx);
  const b = rowsOf(second.ctx);
  const firstDiff = a.findIndex(
    (row, i) => JSON.stringify(row) !== JSON.stringify(b[i]),
  );
  check(
    "the same file every time",
    a.length === b.length && firstDiff === -1,
    firstDiff === -1
      ? `lengths ${a.length} vs ${b.length}`
      : `row ${firstDiff} differs: ${JSON.stringify(a[firstDiff])} vs ${JSON.stringify(b[firstDiff])}`,
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
    "and it asks whether the memory column is MB",
    /Is the memory column in MB\?/.test(html),
    html,
  );
  check(
    "the memory is left untouched until that question is answered",
    rowsOf(ctx)[0]["Memory (GB)"] === "16384",
    JSON.stringify(rowsOf(ctx)[0]),
  );

  // The questions are answerable, and answering them fixes the file.
  ctx.convertMemoryToGb();
  check(
    "answering MB converts it",
    rowsOf(ctx)[0]["Memory (GB)"] === "16",
    JSON.stringify(rowsOf(ctx)[0]),
  );
  ctx.mergeDuplicateVmNames();
  check(
    "and merging the duplicate leaves one web-01",
    rowsOf(ctx).filter((r) => r["VM Name"] === "web-01").length === 1,
    JSON.stringify(rowsOf(ctx).map((r) => r["VM Name"])),
  );
}

console.log(
  "[the full feature set sample carries every optional column and the newest workload values]",
);
{
  const { ctx, elements } = buildContext();
  ctx.loadSampleDataset(3);
  const rows = rowsOf(ctx);
  const headers = headersOf(ctx);

  check("it loads 7 rows", rows.length === 7, String(rows.length));
  check(
    "it carries every optional column the builder now emits",
    ["Compliance", "Exclude", "Include Only", "Current Instance Type"].every(
      (c) => headers.includes(c),
    ) && headers.some((h) => /Min Gen/.test(h)),
    JSON.stringify(headers),
  );

  const byName = Object.fromEntries(rows.map((r) => [r["VM Name"], r]));
  check(
    "a cloud-to-cloud row carries Current Instance Type with no CPU/Memory",
    byName["legacy-01"]?.["Current Instance Type"] === "m5.xlarge" &&
      (byName["legacy-01"]?.["CPU Count"] || "") === "",
    JSON.stringify(byName["legacy-01"]),
  );
  check(
    "a row demonstrates the atomic Compliance vocabulary",
    byName["dc-01"]?.["Compliance"] === "Current-Generation Hardware",
    JSON.stringify(byName["dc-01"]),
  );
  check(
    "a row combines a legacy Compliance alias with an atomic option",
    byName["nosql-01"]?.["Compliance"] ===
      "AWS Nitro Enclaves,Confidential Computing",
    JSON.stringify(byName["nosql-01"]),
  );
  check(
    "a row demonstrates Azure Trusted Launch",
    byName["file-01"]?.["Compliance"] === "Azure Trusted Launch",
    JSON.stringify(byName["file-01"]),
  );
  check(
    "a row demonstrates Min Gen",
    (byName["analytics-01"]?.["Min Gen"] ||
      byName["analytics-01"]?.["AWS Min Gen"]) === "6",
    JSON.stringify(byName["analytics-01"]),
  );
  check(
    "a row demonstrates a multi-value Exclude",
    byName["build-01"]?.["Exclude"] === "Burstable,GPU",
    JSON.stringify(byName["build-01"]),
  );
  check(
    "a row demonstrates a multi-value Include Only",
    byName["container-01"]?.["Include Only"] === "m5,m6",
    JSON.stringify(byName["container-01"]),
  );
  check(
    "every one of item C's new workload concepts appears somewhere in the dataset",
    [
      "Application Server",
      "Domain Controller",
      "NoSQL",
      "File Server",
      "Analytics",
      "Build Farm",
      "Container Host",
    ].every((w) => rows.some((r) => r["Workload"] === w)),
    JSON.stringify(rows.map((r) => r["Workload"])),
  );
  // The cloud-to-cloud row deliberately has no CPU/Memory — the engine only
  // derives specs from Current Instance Type when the page's own
  // "Cloud-to-cloud" toggle is on, and loading a sample can't flip a
  // checkbox for the user. The hygiene check correctly flags it: an honest
  // nudge toward the toggle, not silence about an incomplete-looking row.
  const hygieneHtml = elements.inputHygieneSection.innerHTML;
  check(
    "the input check names the cloud-to-cloud row's missing CPU/Memory, and nothing else",
    !elements.inputHygieneSection.classes.has("hidden") &&
      /CPU count is missing or zero[^<]*1 row \(2\)/.test(hygieneHtml) &&
      /Memory is missing or zero[^<]*1 row \(2\)/.test(hygieneHtml),
    hygieneHtml,
  );
  check(
    "and it needs no column mapping",
    elements.columnMappingSection.classes.has("hidden"),
  );
}

console.log(
  "[the full feature set sample splits Min Gen by provider on a multi-provider page]",
);
{
  // The default buildContext() above is single-provider (aws.html) and never
  // exercises the multi-column split; dataScripts forces the 3-provider path.
  const { ctx } = buildContext({
    dataScripts: [
      "js/aws/aws-data.js",
      "js/azure/azure-data.js",
      "js/gcp/gcp-data.js",
    ],
  });
  ctx.loadSampleDataset(3);
  const byName = Object.fromEntries(rowsOf(ctx).map((r) => [r["VM Name"], r]));
  check(
    "the AWS-only Min Gen value lands under AWS Min Gen only, not Azure/GCP too",
    byName["analytics-01"]?.["AWS Min Gen"] === "6" &&
      (byName["analytics-01"]?.["Azure Min Gen"] || "") === "" &&
      (byName["analytics-01"]?.["GCP Min Gen"] || "") === "",
    JSON.stringify(byName["analytics-01"]),
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
    /Sample loaded \(Small (?:&|&amp;) clean\)/.test(
      elements.fileStatus.innerHTML,
    ),
    elements.fileStatus.innerHTML,
  );
}

process.exitCode = state.failures ? 1 : 0;

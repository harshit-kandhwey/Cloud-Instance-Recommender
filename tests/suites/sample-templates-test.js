// The sample CSV templates the pages hand out, and the <pre> previews of them.
//
// These drifted: Exclude and Current Instance Type were documented, shipped and
// tested, and not one sample mentioned them — so the file a user starts from
// silently omitted two features. Nothing caught it because nothing looked. This
// looks.
//
// Every sample goes through the REAL pipeline. A template that no longer parses,
// or that opens the mapping panel, is worse than a missing column: it is the
// first thing a new user runs, and it would fail in their hands, not ours.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  REPO,
  buildContext,
  makeChecker,
  rowsOf,
  headersOf,
  parse,
} = require("./harness");

const { check, state } = makeChecker();

// Every column the docs promise an input file may carry. CONTRIBUTING.md: "Any
// sample CSV templates in the repo or in the HTML <pre> previews should include
// all columns." Add a column to the product, add it here, and the samples that
// forgot it go red.
const COMMON_COLUMNS = [
  "VM Name",
  "App Name",
  "CPU Count",
  "Memory (GB)",
  "CPU Utilization",
  "Memory Utilization",
  "ENV",
  "OS",
  "Workload",
  "Compliance",
  "Min Gen",
  "Exclude",
  "Current Instance Type",
];

const SAMPLES = [
  {
    label: "AWS",
    page: "aws.html",
    script: "js/aws/aws-specific.js",
    fn: "downloadAWSSampleCSV",
    dataScript: "js/aws/aws-data.js",
    regions: ["AWS Region"],
  },
  {
    label: "Azure",
    page: "azure.html",
    script: "js/azure/azure-specific.js",
    fn: "downloadAzureSampleCSV",
    dataScript: "js/azure/azure-data.js",
    regions: ["Azure Region"],
  },
  {
    label: "GCP",
    page: "gcp.html",
    script: "js/gcp/gcp-specific.js",
    fn: "downloadGCPSampleCSV",
    dataScript: "js/gcp/gcp-data.js",
    regions: ["GCP Region"],
  },
  {
    // downloadSampleCSV lives in ingest.js, which every page loads.
    label: "Multicloud",
    page: "multicloud.html",
    script: null,
    fn: "downloadSampleCSV",
    dataScript: "js/aws/aws-data.js",
    regions: ["AWS Region", "Azure Region", "GCP Region"],
  },
];

// The CSV the page would hand the user, captured instead of downloaded.
function generateSample(sample) {
  const { ctx, elements } = buildContext({ dataScript: sample.dataScript });
  if (sample.script) {
    vm.runInContext(
      fs.readFileSync(path.join(REPO, sample.script), "utf8"),
      ctx,
      { filename: sample.script },
    );
  }
  let csv = null;
  ctx.downloadCsv = (content) => {
    csv = content;
  };
  ctx[sample.fn]();
  return { ctx, elements, csv };
}

// Every line of the <pre> inside the page's .sample-csv block. Tolerant of
// attributes on either tag: a class added for styling must not fail this suite
// for a reason that has nothing to do with the drift it exists to catch.
//
// The whole block, not just the header row. Comparing headers alone let gcp.html
// sit for a release showing a different OS, a different compliance value and
// zone-suffixed regions its own download never produced — the columns matched,
// so nothing looked.
function previewLines(page) {
  const html = fs.readFileSync(path.join(REPO, page), "utf8");
  const block = html.match(
    /<div[^>]*class="[^"]*\bsample-csv\b[^"]*"[^>]*>\s*<pre[^>]*>\s*([\s\S]*?)<\/pre>/,
  );
  if (!block) return null;
  return block[1]
    .trim()
    .split("\n")
    .map((line) => line.trim());
}

for (const sample of SAMPLES) {
  console.log(`[the ${sample.label} sample template]`);
  const { ctx, elements, csv } = generateSample(sample);

  check("a sample is produced", typeof csv === "string" && csv.length > 0);
  // Without this, a sample that never reached downloadCsv would take a null into
  // parse() and abort the whole process — the remaining samples would go
  // unchecked and the failure would surface as a crash rather than as this
  // suite's own clean report.
  if (typeof csv !== "string" || !csv.length) continue;

  parse(ctx, csv);
  const rows = rowsOf(ctx);
  const headers = headersOf(ctx);

  // The template is the one file every new user runs. If it needs mapping, or
  // trips the input check, it fails in their hands on their first attempt.
  check(
    "it loads with nothing to map",
    elements.columnMappingSection.classes.has("hidden") && rows.length > 0,
    elements.columnMappingSection.innerHTML,
  );
  check(
    "and nothing to complain about",
    elements.inputHygieneSection.classes.has("hidden"),
    elements.inputHygieneSection.innerHTML,
  );

  const expected = [...COMMON_COLUMNS, ...sample.regions];
  const missing = expected.filter((c) => !headers.includes(c));
  check(
    "it carries every column the docs promise",
    missing.length === 0,
    `missing: ${missing.join(", ")}`,
  );

  // Exclude holds a comma-separated list, so its cell must be quoted — and a
  // sample that ships an unquoted one would shift every column after it right
  // by one, which is exactly the kind of break that reads as "the tool is
  // broken" rather than "the sample is".
  const excluding = rows.find((r) => (r["Exclude"] || "").includes(","));
  check(
    "the quoted multi-value Exclude survives the round trip",
    !!excluding && excluding["Exclude"] === "Burstable,GPU",
    JSON.stringify(excluding && excluding["Exclude"]),
  );
  check(
    "and the row it is on is otherwise intact, so no column has shifted",
    !!excluding &&
      excluding["Compliance"] === "PCI" &&
      /^[A-Za-z]/.test(excluding["Current Instance Type"] || ""),
    JSON.stringify(excluding),
  );

  check(
    "every row carries a current instance type",
    rows.every((r) => (r["Current Instance Type"] || "").trim() !== ""),
    JSON.stringify(rows.map((r) => r["Current Instance Type"])),
  );

  // The preview is what a user reads before deciding to download. Every line of
  // it must be a line of the actual file — not merely the same columns, the same
  // DATA. A preview that shows a region or an OS the download does not contain is
  // simply a lie about the download, and the user has no way to know.
  const preview = previewLines(sample.page);
  const downloaded = csv.split("\n").map((line) => line.trim());
  check(
    `the <pre> preview on ${sample.page} was found`,
    Array.isArray(preview) && preview.length > 1,
    String(preview),
  );
  if (preview) {
    const mismatch = preview.findIndex((line, i) => line !== downloaded[i]);
    check(
      `and every line of it is a line of the download`,
      mismatch === -1,
      mismatch === -1
        ? ""
        : `line ${mismatch + 1} differs\n     preview : ${preview[mismatch]}\n     download: ${downloaded[mismatch]}`,
    );
  }
}

process.exit(state.failures ? 1 : 0);

// AWS Application Discovery Service import template.
//
// Shape taken from a REAL ADS template. The generic matcher recognises exactly
// one of its columns (HostName), so without a preset an ADS file stops at the
// mapping panel every single time with both required columns unmatched.
const {
  buildContext,
  makeChecker,
  rowsOf,
  parse,
  confirmMapping,
} = require("../harness");

const { check, state } = makeChecker();

// ADS namespaces its columns. Trimmed to the ones that matter, in the real order.
const ADS_HEADERS = [
  "ExternalId",
  "SMBiosId",
  "HostName",
  "VMware.MoRefId",
  "CPU.NumberOfProcessors",
  "CPU.NumberOfCores",
  "CPU.NumberOfLogicalCores",
  "OS.Name",
  "VMware.VMName",
  "RAM.TotalSizeInMB",
  "RAM.UsedSizeInMB.Avg",
  "RAM.UsedSizeInMB.Max",
  "CPU.UsagePct.Avg",
  "CPU.UsagePct.Max",
];

const adsFile = (...rows) =>
  [ADS_HEADERS.join(","), ...rows.map((r) => r.join(","))].join("\n");

// sockets 4, cores 8, LOGICAL 16 — the three differ on purpose, because which
// one is picked is the whole question.
const SAMPLE = [
  "id-1",
  "smbios-1",
  "web-01.corp",
  "vm-01",
  4,
  8,
  16,
  "Microsoft Windows Server 2012",
  "WEB01",
  12000, // RAM.TotalSizeInMB
  2000, // RAM.UsedSizeInMB.Avg
  6000,
  67.22, // CPU.UsagePct.Avg
  98.34,
];

console.log("[an ADS template loads without being asked to map anything]");
{
  const { ctx, elements } = buildContext();
  parse(ctx, adsFile(SAMPLE));
  const row = rowsOf(ctx)[0] || {};

  check(
    "it is recognised, and says so",
    /Recognised as a AWS Application Discovery Service export/.test(
      elements.fileStatus.innerHTML,
    ),
    elements.fileStatus.innerHTML,
  );
  check(
    "nothing is asked",
    elements.columnMappingSection.classes.has("hidden") &&
      rowsOf(ctx).length === 1,
  );
  check(
    "the VM is named from HostName",
    row["VM Name"] === "web-01.corp",
    JSON.stringify(row["VM Name"]),
  );
  check(
    "CPU comes from LOGICAL cores (16), not sockets (4) or physical cores (8)",
    row["CPU Count"] === "16",
    `got ${JSON.stringify(row["CPU Count"])}`,
  );
  check(
    "memory is converted from MB (12000 → 11.72 GB)",
    row["Memory (GB)"] === "11.72",
    JSON.stringify(row["Memory (GB)"]),
  );
  check(
    "CPU utilization comes from the average, not the max",
    row["CPU Utilization"] === "67.22",
    JSON.stringify(row["CPU Utilization"]),
  );
}

console.log("[memory utilization is derived, because ADS does not report it]");
{
  // ADS gives memory USED in megabytes. The optimizer needs a percentage on a
  // 0–100 scale, so the derivation is (used ÷ total) × 100. Without it memoryUtil
  // is 0, the engine leaves memory at its current size for every VM in the fleet,
  // and the file is sized on CPU alone — quietly forgoing most of the saving.
  const { ctx } = buildContext();
  parse(ctx, adsFile(SAMPLE));
  check(
    "2000 of 12000 MB → 16.7%",
    rowsOf(ctx)[0]["Memory Utilization"] === "16.7",
    JSON.stringify(rowsOf(ctx)[0]["Memory Utilization"]),
  );
}
{
  // Absent, not zero. A zero would read as "0% used" and invite the optimizer to
  // shrink the machine to nothing; an empty cell means "unknown", and memory is
  // left alone.
  const withoutUsage = [...SAMPLE];
  withoutUsage[ADS_HEADERS.indexOf("RAM.UsedSizeInMB.Avg")] = "";
  const { ctx } = buildContext();
  parse(ctx, adsFile(withoutUsage));
  check(
    "a missing usage figure derives nothing, rather than deriving 0%",
    rowsOf(ctx)[0]["Memory Utilization"] === "",
    JSON.stringify(rowsOf(ctx)[0]["Memory Utilization"]),
  );
}
{
  // A file that already carries the column keeps its own values: the user's data
  // outranks anything computed from it.
  const { ctx } = buildContext();
  parse(
    ctx,
    [
      [...ADS_HEADERS, "Memory Utilization"].join(","),
      [...SAMPLE, "88"].join(","),
    ].join("\n"),
  );
  check(
    "an explicit Memory Utilization column is not overwritten by the derivation",
    rowsOf(ctx)[0]["Memory Utilization"] === "88",
    JSON.stringify(rowsOf(ctx)[0]["Memory Utilization"]),
  );
}

console.log(
  "[the derivation finds its columns by name, not by literal string]",
);
{
  // detect and columns match headers by NORMALIZED name, tolerant of case and
  // punctuation. If the derivation read its sources as literal strings, an export
  // that varied only in case — while still being detected as ADS — would yield
  // NaN and derive "" for every row: no error, no failing test, and memory-based
  // right-sizing quietly switched off for the entire fleet.
  const shouted = ADS_HEADERS.map((h) =>
    h === "RAM.TotalSizeInMB"
      ? "RAM.TOTALSIZEINMB"
      : h === "RAM.UsedSizeInMB.Avg"
        ? "ram_usedsizeinmb_avg"
        : h,
  );
  const { ctx, elements } = buildContext();
  parse(ctx, [shouted.join(","), SAMPLE.join(",")].join("\n"));
  check(
    "the file is still recognised",
    /Application Discovery/.test(elements.fileStatus.innerHTML),
    elements.fileStatus.innerHTML,
  );
  check(
    "and the utilization is still derived, despite the different spelling",
    rowsOf(ctx)[0]["Memory Utilization"] === "16.7",
    JSON.stringify(rowsOf(ctx)[0]["Memory Utilization"]),
  );
}

console.log("[a mapping saved before the preset existed still derives]");
{
  // The saved-mapping branch used to run BEFORE derivation and return early, so
  // any file the user had already answered for skipped the derivation entirely —
  // and lost its memory utilization silently, which is the one thing the preset
  // was added to provide.
  const { ctx, store } = buildContext();
  const signature = ADS_HEADERS.map((h) => h.trim().toLowerCase())
    .sort()
    .join("|");
  store.set(
    "cloudInstanceRecommenderColumnMaps",
    JSON.stringify({
      [signature]: {
        v: 2,
        mapping: {
          HostName: "VM Name",
          "CPU.NumberOfLogicalCores": "CPU Count",
          "RAM.TotalSizeInMB": "Memory (GB)",
        },
        units: { "Memory (GB)": "MB" },
      },
    }),
  );

  parse(ctx, adsFile(SAMPLE));
  const row = rowsOf(ctx)[0] || {};
  check(
    "the saved mapping is applied",
    row["CPU Count"] === "16" && row["Memory (GB)"] === "11.72",
    JSON.stringify(row),
  );
  check(
    "and the derived column is there anyway",
    row["Memory Utilization"] === "16.7",
    JSON.stringify(row["Memory Utilization"]),
  );
}

console.log("[a mapping edited on a derived file can still be replayed]");
{
  // A derived column is added to the headers, so a mapping saved against THOSE
  // headers is keyed to a file that does not exist: the real file never has the
  // derived column, so its signature never matches, and the mapping is saved and
  // never replayed. Every path that saves must sign the FILE's own headers.
  const { ctx, elements, store } = buildContext();
  parse(ctx, adsFile(SAMPLE));

  // Reopen the mapping the preset applied, and confirm it — the way a user who
  // wanted physical cores instead of logical ones would.
  ctx.editColumnMapping();
  check(
    "the mapping can be reopened on a recognised file",
    !elements.columnMappingSection.classes.has("hidden"),
  );

  confirmMapping(ctx, {
    "VM Name": "HostName",
    "CPU Count": "CPU.NumberOfLogicalCores",
    "Memory (GB)": "RAM.TotalSizeInMB",
  });

  const saved = JSON.parse(
    store.get("cloudInstanceRecommenderColumnMaps") || "{}",
  );
  const keys = Object.keys(saved);
  // The key must be the signature of the FILE — the headers it actually has.
  const fileSignature = ADS_HEADERS.map((h) => h.trim().toLowerCase())
    .sort()
    .join("|");

  check("one mapping was saved", keys.length === 1, JSON.stringify(keys));
  check(
    "keyed to the file's OWN headers, so a later upload can match it",
    keys[0] === fileSignature,
    `saved  : ${keys[0]}\n     expected: ${fileSignature}`,
  );
  check(
    "and NOT to the derived headers, which no upload ever produces",
    !keys[0].includes("memory utilization"),
    keys[0],
  );
}

console.log("[the preset does not claim files it has not recognised]");
{
  // The preset converts MB and picks a specific CPU column, so a false positive
  // mis-sizes every row. A file with a plain "CPU Count"/"Memory (GB)" pair and
  // a HostName is NOT ADS, however server-ish it looks.
  const { ctx, elements } = buildContext();
  parse(
    ctx,
    `HostName,CPU Count,Memory (GB),OS.Name
web-01.corp,4,16,Linux`,
  );
  check(
    "an ordinary inventory is not announced as ADS",
    !/Application Discovery/.test(elements.fileStatus.innerHTML),
    elements.fileStatus.innerHTML,
  );
  check(
    "and its GB memory is left alone, not divided by 1024",
    rowsOf(ctx)[0]["Memory (GB)"] === "16",
    JSON.stringify(rowsOf(ctx)[0]),
  );
}

console.log("[without the preset this file would be unusable]");
{
  // The point of the preset, stated as a fact about the generic matcher: it maps
  // exactly one ADS column, and neither required one.
  const { ctx } = buildContext();
  const match = ctx.autoMatchHeaders(ADS_HEADERS, null); // preset explicitly off
  check(
    "generically, both required columns are unmatched",
    match.unmatchedRequired.includes("CPU Count") &&
      match.unmatchedRequired.includes("Memory (GB)"),
    JSON.stringify(match.unmatchedRequired),
  );
  check(
    "so an ADS file would stop at the mapping panel every time",
    match.needsReview,
  );
}

process.exit(state.failures ? 1 : 0);

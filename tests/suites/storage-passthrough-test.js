// Storage pass-through: the Disk (GB) input column, its MiB conversion, and
// the AWS bulk-template storage field that was shipping blank.
//
// The load-bearing part is the unit conversion. RVTools reports "Provisioned
// MiB", so treating that column as GB overstates every disk by 1024x — the
// same class of silent corruption the memory column already guards against,
// which is why disk joined memory in one SIZE_COLUMNS list rather than growing
// a parallel path that could drift.
//
// Storage never influences instance selection. A file carrying a disk column
// must produce byte-identical recommendations to one without it.
const vm = require("vm");
const { buildContext, makeChecker, rowsOf, headersOf } = require("./harness");

const { check, state } = makeChecker();

// ── The canonical and its synonyms ───────────────────────────────────────────
console.log("[disk headers auto-match to the Disk (GB) canonical]");
const { ctx } = buildContext();
const run = (expr) => vm.runInContext(expr, ctx, { filename: "storage" });

const matchOne = (header) => {
  ctx.__h = [header];
  const m = run("autoMatchHeaders(__h)");
  return m.mapping[header];
};

for (const h of [
  "Disk (GB)",
  "Disk GB",
  "Storage (GB)",
  "Disk Size",
  "Capacity GB",
]) {
  check(`"${h}" maps to Disk (GB)`, matchOne(h) === "Disk (GB)", matchOne(h));
}
check(
  "a disk header is not mistaken for memory",
  matchOne("Disk GB") !== "Memory (GB)",
);
check(
  "a memory header is still memory",
  matchOne("Memory GB") === "Memory (GB)",
);

// ── The conversion ───────────────────────────────────────────────────────────
// An MiB-suffixed header is EXPLICIT evidence, which is the only thing that
// licenses a conversion here.
console.log("[an MiB-suffixed disk header converts to GB on ingest]");
(async () => {
  const ingest = (csv) => {
    const c = buildContext();
    vm.runInContext(`parseCSV(${JSON.stringify(csv)})`, c.ctx, {
      filename: "storage-ingest",
    });
    return c;
  };

  const MIB = [
    "VM Name,CPU Count,Memory (GB),Provisioned MiB,AWS Region",
    "vm-a,4,16,524288,us-east-1",
  ].join("\n");
  const a = ingest(MIB);
  const rowsA = rowsOf(a.ctx);
  check(
    "premise: the file ingested and the disk column was mapped",
    rowsA.length === 1 && headersOf(a.ctx).includes("Disk (GB)"),
    headersOf(a.ctx).join(","),
  );
  check(
    "524288 MiB becomes 512 GB, not 524288",
    rowsA.length === 1 && parseFloat(rowsA[0]["Disk (GB)"]) === 512,
    rowsA[0] && rowsA[0]["Disk (GB)"],
  );

  const GB = [
    "VM Name,CPU Count,Memory (GB),Disk (GB),AWS Region",
    "vm-a,4,16,512,us-east-1",
  ].join("\n");
  const b = ingest(GB);
  check(
    "a GB-labelled disk column is left alone",
    parseFloat(rowsOf(b.ctx)[0]["Disk (GB)"]) === 512,
    rowsOf(b.ctx)[0]["Disk (GB)"],
  );
  check(
    "and memory is untouched by the disk conversion",
    parseFloat(rowsOf(a.ctx)[0]["Memory (GB)"]) === 16,
    rowsOf(a.ctx)[0]["Memory (GB)"],
  );

  // ── Storage must not move a recommendation ────────────────────────────────
  console.log("[storage is carried, never acted on]");
  const OPTS = { generateLikeToLike: true, generateOptimized: false };
  const withDisk = [
    {
      "VM Name": "x",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "Disk (GB)": "512",
      "AWS Region": "us-east-1",
    },
  ];
  const withoutDisk = [
    {
      "VM Name": "x",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "AWS Region": "us-east-1",
    },
  ];
  try {
    ctx.__opts = OPTS;
    ctx.__with = withDisk;
    ctx.__without = withoutDisk;
    const outWith = (
      await run(
        "getInstanceRecommendationWithSelector(__with, ['aws'], __opts)",
      )
    )[0];
    const outWithout = (
      await run(
        "getInstanceRecommendationWithSelector(__without, ['aws'], __opts)",
      )
    )[0];
    check(
      "premise: both runs produced a real recommendation",
      outWith["AWS Like-to-Like Instance"] &&
        outWith["AWS Like-to-Like Instance"] !== "No data available",
      outWith["AWS Like-to-Like Instance"],
    );
    check(
      "the disk column does not change the recommendation",
      outWith["AWS Like-to-Like Instance"] ===
        outWithout["AWS Like-to-Like Instance"],
      `${outWith["AWS Like-to-Like Instance"]} vs ${outWithout["AWS Like-to-Like Instance"]}`,
    );
    check(
      "and it is carried through to the output untouched",
      outWith["Disk (GB)"] === "512",
      outWith["Disk (GB)"],
    );

    // ── The AWS bulk template ─────────────────────────────────────────────────
    console.log("[the bulk template's storage field is no longer blank]");
    // processedResults / downloadCsv are module-scoped bindings inside the vm
    // context, so they can only be replaced by evaluating IN the context —
    // ctx.processedResults would be a different, unread property.
    const capture = [];
    ctx.__capture = capture;
    ctx.__results = [
      outWith,
      { ...outWithout, "VM Name": "y" },
      // A real but sub-1GB disk. It must round to blank, not to a literal "0":
      // the importer reads "0" as "no volume", the opposite of the intended
      // "leave it blank and let the calculator apply its default".
      { ...outWithout, "VM Name": "z", "Disk (GB)": "0.4" },
    ];
    ctx.document.querySelector = () => null;
    run("processedResults = __results");
    run("downloadCsv = (content) => __capture.push(content)");
    run("resultsInPreviewOrder = (r) => r");
    run("downloadAWSBulkTemplate('l2l')");

    check("premise: the template was generated", capture.length === 1);
    const lines = (capture[0] || "").trim().split("\n");
    const headers = lines[0].split(",");
    const amountIdx = headers.indexOf("Storage amount per Instance (GB)");
    const typeIdx = headers.indexOf("Storage Type");
    check(
      "premise: the storage columns are present in the template",
      amountIdx !== -1 && typeIdx !== -1,
      headers.join("|"),
    );
    const cells = lines.slice(1).map((l) => l.split(","));
    check(
      "a row with a disk size carries it",
      cells[0] && cells[0][amountIdx] === "512",
      cells[0] && cells[0][amountIdx],
    );
    check(
      "a row without one stays blank rather than inventing a size",
      cells[1] && cells[1][amountIdx] === "",
      cells[1] && `"${cells[1][amountIdx]}"`,
    );
    check(
      "a sub-1GB disk rounds to blank, not to a literal 0 (no-volume)",
      cells[2] && cells[2][amountIdx] === "",
      cells[2] && `"${cells[2][amountIdx]}"`,
    );
    check(
      "Storage Type is left blank — its accepted vocabulary is unknown",
      cells.length === 3 && cells.every((c) => c[typeIdx] === ""),
      cells.map((c) => c[typeIdx]).join("|"),
    );
  } catch (e) {
    check("the storage runs complete without throwing", false, e && e.message);
  }

  process.exit(state.failures ? 1 : 0);
})();

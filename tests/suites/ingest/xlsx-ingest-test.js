// .xlsx ingestion via vendored SheetJS.
// Builds real xlsx files with the vendored library, then feeds them through
// ingestFile() in the simulated-DOM context (including lazy script load).
const path = require("path");
const vm = require("vm");
const { buildContext } = require("../harness");

const REPO = path.resolve(__dirname, "..", "..", "..");
const XLSX = require(path.join(REPO, "js/vendor/xlsx.full.min.js"));

function makeXlsx(sheets) {
  // sheets: [{name, aoa}]
  const wb = XLSX.utils.book_new();
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function fakeFile(name, arrayBuffer) {
  // size mirrors a real File: ingest.js checks it against the empty/oversize
  // guards. Without it the fixtures only pass because the guard reads
  // `file.size === 0`; a tightening to `!file.size` would reject every one of
  // these as empty. Set it so the fixtures behave like real File objects.
  return {
    name,
    size: arrayBuffer.byteLength,
    arrayBuffer: async () => arrayBuffer,
  };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

const AOA = [
  [
    "VM Name",
    "CPU Count",
    "Memory (GB)",
    "CPU Utilization",
    "Memory Utilization",
    "AWS Region",
  ],
  ["web-server-01", 4, 16, 45, 60, "us-east-1"],
  ["db-server-02", 8, 32, 70, 80, "us-west-2"],
];
const CSV_EQUIV = `VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region
web-server-01,4,16,45,60,us-east-1
db-server-02,8,32,70,80,us-west-2`;

(async () => {
  console.log("[1. canonical xlsx + lazy library load]");
  {
    const { ctx, requested } = buildContext();
    check("XLSX not preloaded", !ctx.XLSX);
    await ctx.ingestFile(
      fakeFile("servers.xlsx", makeXlsx([{ name: "Sheet1", aoa: AOA }])),
    );
    check(
      "vendor script lazily injected",
      requested.includes("js/vendor/xlsx.full.min.js"),
      requested.join(","),
    );
    const data = vm.runInContext("csvData", ctx);
    check("2 rows ingested", data.length === 2, JSON.stringify(data));
    check(
      "values are trimmed strings",
      data[0]["CPU Count"] === "4" && data[1]["Memory (GB)"] === "32",
    );

    // Byte-equivalence with the CSV path ⇒ identical downstream output
    const xlsxJson = JSON.stringify(data);
    vm.runInContext(`parseCSV(${JSON.stringify(CSV_EQUIV)})`, ctx);
    const csvJson = JSON.stringify(vm.runInContext("csvData", ctx));
    check(
      "xlsx rows identical to CSV rows",
      xlsxJson === csvJson,
      `${xlsxJson}\nvs\n${csvJson}`,
    );
  }

  console.log("[2. synonym headers in xlsx go through column mapping]");
  {
    const { ctx } = buildContext();
    const aoa = [
      ["Hostname", "vCPUs", "RAM", "AWS Region"],
      ["srv1", 8, 32, "us-west-2"],
    ];
    await ctx.ingestFile(fakeFile("x.xlsx", makeXlsx([{ name: "S", aoa }])));
    const data = vm.runInContext("csvData", ctx);
    check(
      "auto-mapped to canonical keys",
      data.length === 1 &&
        data[0]["CPU Count"] === "8" &&
        data[0]["VM Name"] === "srv1",
      JSON.stringify(data),
    );
  }

  // The best-SCORING sheet is chosen, not the positionally first — here "First"
  // carries six mappable columns and "Second" only three, so First wins on score
  // and happens to also be first. The score-vs-order tiebreak itself lives in
  // sheet-picker-test; this only pins that a multi-sheet workbook ingests the
  // winning sheet's rows end to end.
  console.log("[3. multi-sheet → the best-scoring sheet is ingested]");
  {
    const { ctx } = buildContext();
    const wb = makeXlsx([
      { name: "First", aoa: AOA },
      {
        name: "Second",
        aoa: [
          ["VM Name", "CPU Count", "Memory (GB)"],
          ["WRONG", 1, 1],
        ],
      },
    ]);
    await ctx.ingestFile(fakeFile("multi.xlsx", wb));
    const data = vm.runInContext("csvData", ctx);
    check(
      "best-scoring sheet used (First: 6 mappable cols vs Second: 3)",
      data.length === 2 && data[0]["VM Name"] === "web-server-01",
    );
  }

  console.log("[4. empty rows dropped, empty sheet errors cleanly]");
  {
    const { ctx, elements } = buildContext();
    const aoa = [
      ["VM Name", "CPU Count", "Memory (GB)"],
      ["a", 2, 4],
      ["", "", ""],
      ["b", 4, 8],
    ];
    await ctx.ingestFile(fakeFile("gaps.xlsx", makeXlsx([{ name: "S", aoa }])));
    check("empty row dropped", vm.runInContext("csvData", ctx).length === 2);

    await ctx.ingestFile(
      fakeFile("empty.xlsx", makeXlsx([{ name: "S", aoa: [] }])),
    );
    check(
      "empty sheet → warning status, no crash",
      elements.fileStatus.innerHTML.includes("Could not read the Excel file"),
      elements.fileStatus.innerHTML,
    );
  }

  console.log("[5. csv path untouched by ingestFile routing]");
  {
    const { ctx, requested } = buildContext();
    // FileReader stub for the CSV branch
    ctx.FileReader = class {
      readAsText(file) {
        const self = this;
        setTimeout(() => self.onload({ target: { result: file._text } }), 0);
      }
    };
    await ctx.ingestFile({
      name: "plain.csv",
      size: Buffer.byteLength(CSV_EQUIV, "utf8"),
      _text: CSV_EQUIV,
    });
    await new Promise((r) => setTimeout(r, 50));
    check(
      "csv ingested via parseCSV",
      vm.runInContext("csvData", ctx).length === 2,
    );
    check(
      "xlsx lib NOT loaded for csv",
      !requested.includes("js/vendor/xlsx.full.min.js"),
    );
  }

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

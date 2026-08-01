// Verification of the xlsx/CSV upload hardening: multi-sheet UI note,
// size/empty guards, and reader.onerror.
const path = require("path");
const { buildContext } = require("../harness");

const REPO = path.resolve(__dirname, "..", "..", "..");
const XLSX = require(path.join(REPO, "js/vendor/xlsx.full.min.js"));

function makeXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const { ctx, elements } = buildContext();
// elements is shared across blocks, so a check that reads fileStatus/sheetPicker
// can pass on state a PRIOR block left behind — a regression that stopped writing
// fileStatus would go unnoticed. Clear the DOM between blocks that assert on it,
// so each starts from a blank slate.
function resetUi() {
  for (const key of Object.keys(elements)) delete elements[key];
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
  ["VM Name", "CPU Count", "Memory (GB)"],
  ["a", 4, 16],
];

(async () => {
  console.log("[a multi-sheet workbook offers the choice]");
  {
    resetUi();
    // Every sheet here has data. A sheet with headers and no rows is a template,
    // not a candidate, and is excluded — see sheet-picker-test.
    const buf = makeXlsx([
      { name: "Data", aoa: AOA },
      { name: "Notes", aoa: [["x"], ["a note"]] },
      { name: "More", aoa: [["y"], ["another"]] },
    ]);
    await ctx.ingestFile({
      name: "multi.xlsx",
      size: buf.byteLength,
      arrayBuffer: async () => buf,
    });
    // The sheets are offered, not silently reduced to the first one. Which sheet
    // wins, and what switching does, belong to sheet-picker-test.
    check(
      "the sheet picker is shown",
      !elements.sheetPickerSection.classes.has("hidden") &&
        elements.sheetPickerSection.innerHTML.includes("3 sheets"),
      elements.sheetPickerSection.innerHTML,
    );
    check(
      "still success status",
      elements.fileStatus.className.includes("alert-success"),
    );
  }

  console.log("[single sheet → no note]");
  {
    resetUi();
    const buf = makeXlsx([{ name: "Only", aoa: AOA }]);
    await ctx.ingestFile({
      name: "one.xlsx",
      size: buf.byteLength,
      arrayBuffer: async () => buf,
    });
    // Assert the positive (it ingested) AND the absence, so the "no note" half
    // cannot pass merely because the code stopped writing fileStatus at all.
    check(
      "single sheet ingests with no multi-sheet note",
      elements.fileStatus.className.includes("alert-success") &&
        !elements.fileStatus.innerHTML.includes("sheets"),
      elements.fileStatus.innerHTML,
    );
  }

  console.log("[size/empty guards]");
  {
    resetUi();
    await ctx.ingestFile({
      name: "big.xlsx",
      size: 11 * 1024 * 1024,
      arrayBuffer: async () => {
        throw new Error("should not be called");
      },
    });
    check(
      "oversized rejected before buffering",
      elements.fileStatus.innerHTML.includes("Maximum allowed size is 10MB"),
      elements.fileStatus.innerHTML,
    );

    await ctx.ingestFile({
      name: "zero.xlsx",
      size: 0,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    check(
      "empty file rejected",
      elements.fileStatus.innerHTML.includes("File is empty"),
    );
  }

  // The extension is a claim; the first bytes are evidence. A real workbook
  // renamed .csv used to be read as text and parsed into garbage rows.
  console.log("[content sniffing beats the extension]");
  {
    resetUi();
    // A file whose bytes are actually readable, unlike the mocks above (which
    // have no slice() and therefore fall back to routing by extension)
    const fakeFile = (name, bytes) => {
      // Copy: Buffer.slice() is a VIEW into Node's shared pool, so .buffer on it
      // would hand back the whole pool rather than these bytes
      const u8 = new Uint8Array(bytes);
      return {
        name,
        size: u8.byteLength,
        _bytes: u8,
        slice: (start, end) => ({
          arrayBuffer: async () => u8.slice(start, end).buffer,
        }),
        arrayBuffer: async () => u8.buffer,
      };
    };
    ctx.FileReader = class {
      readAsText(file) {
        const self = this;
        setTimeout(
          () =>
            self.onload({
              target: { result: Buffer.from(file._bytes).toString("utf8") },
            }),
          0,
        );
      }
    };

    const sniff = (bytes) => ctx.sniffFileKind(new Uint8Array(bytes));
    check("PK zip header → excel", sniff([0x50, 0x4b, 0x03, 0x04]) === "excel");
    check(
      "OLE header → legacy-excel",
      sniff([0xd0, 0xcf, 0x11, 0xe0]) === "legacy-excel",
    );
    check("NUL byte → binary", sniff([0x89, 0x50, 0x00, 0x01]) === "binary");
    check("plain text → text", sniff([0x56, 0x4d, 0x2c, 0x43]) === "text");
    check("no bytes → unknown", ctx.sniffFileKind(null) === "unknown");

    // These all carry NO NUL in their first bytes, so a NUL test alone would
    // call them text and hand them to the CSV parser. Use the REAL signatures:
    // a PNG magic with an injected NUL would pass for the wrong reason.
    check(
      "real PNG signature → binary",
      sniff([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) === "binary",
    );
    check(
      "JPEG → binary",
      sniff([0xff, 0xd8, 0xff, 0xe1, 0x12, 0x34, 0x45, 0x78]) === "binary",
    );
    check(
      "GIF → binary (printable signature)",
      sniff([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x20]) === "binary",
    );
    check(
      "PDF → binary (printable signature)",
      sniff([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) === "binary",
    );
    check(
      "RTF → binary (printable signature)",
      sniff([0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31]) === "binary",
    );
    // A UTF-8 BOM, then "VM N" — high bytes must NOT be mistaken for binary
    check(
      "UTF-8 BOM CSV → text",
      sniff([0xef, 0xbb, 0xbf, 0x56, 0x4d, 0x20, 0x4e, 0x2c]) === "text",
    );

    // A genuine workbook that someone renamed to .csv
    const xlsxBytes = new Uint8Array(makeXlsx([{ name: "Only", aoa: AOA }]));
    await ctx.ingestFile(fakeFile("inventory.csv", xlsxBytes));
    check(
      "workbook named .csv is read as Excel, not garbage text",
      elements.fileStatus.className.includes("alert-success") &&
        elements.fileStatus.innerHTML.includes("1 rows"),
      elements.fileStatus.innerHTML,
    );
    check(
      "and the rerouting is disclosed",
      elements.fileStatus.innerHTML.includes("is an Excel workbook"),
      elements.fileStatus.innerHTML,
    );

    // ...and the reverse: CSV text saved with an .xlsx extension
    const csvText = "VM Name,CPU Count,Memory (GB)\nweb-1,4,16\n";
    await ctx.ingestFile(
      fakeFile("inventory.xlsx", Buffer.from(csvText, "utf8")),
    );
    await new Promise((r) => setTimeout(r, 20));
    check(
      "text named .xlsx is read as CSV",
      elements.fileStatus.className.includes("alert-success") &&
        elements.fileStatus.innerHTML.includes("is plain text"),
      elements.fileStatus.innerHTML,
    );

    await ctx.ingestFile(
      fakeFile("old-book.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2])),
    );
    check(
      "legacy .xls rejected with guidance",
      elements.fileStatus.innerHTML.includes("save it as .xlsx or CSV"),
      elements.fileStatus.innerHTML,
    );

    // A genuine PNG renamed .csv — no NUL anywhere in the signature
    await ctx.ingestFile(
      fakeFile(
        "photo.csv",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    );
    check(
      "a real PNG is rejected with guidance",
      // innerHTML is escaped, so match around the apostrophe
      elements.fileStatus.innerHTML.includes("look like a CSV or Excel"),
      elements.fileStatus.innerHTML,
    );

    await ctx.ingestFile(
      fakeFile(
        "report.csv",
        Buffer.from("%PDF-1.7\nnot really a spreadsheet", "utf8"),
      ),
    );
    check(
      "a PDF is refused rather than parsed as CSV",
      elements.fileStatus.innerHTML.includes("look like a CSV or Excel"),
      elements.fileStatus.innerHTML,
    );

    // A workbook with no extension at all: the drop handler no longer gates on
    // the name, so ingestFile must still accept it on its bytes
    resetUi();
    await ctx.ingestFile(fakeFile("inventory", xlsxBytes));
    check(
      "an extensionless workbook is still read as Excel",
      // Assert the row count too — alert-success alone would pass on a prior
      // successful ingest's leftover class if this path wrote nothing.
      elements.fileStatus.className.includes("alert-success") &&
        elements.fileStatus.innerHTML.includes("1 rows"),
      elements.fileStatus.innerHTML,
    );
  }

  console.log("[csv reader.onerror]");
  {
    resetUi();
    ctx.FileReader = class {
      readAsText() {
        const self = this;
        setTimeout(() => self.onerror && self.onerror(new Error("io")), 0);
      }
    };
    await ctx.ingestFile({ name: "broken.csv", size: 10 });
    await new Promise((r) => setTimeout(r, 50));
    check(
      "read failure surfaces in UI",
      elements.fileStatus.innerHTML.includes("Could not read the file"),
      elements.fileStatus.innerHTML,
    );
  }

  // Size and emptiness are checked for CSV too, not just xlsx — the legacy
  // file handler used to be the only thing enforcing this on the CSV path
  console.log("[csv size/emptiness validation]");
  {
    resetUi();
    await ctx.ingestFile({ name: "big.csv", size: 11 * 1024 * 1024 });
    check(
      "oversized csv rejected",
      elements.fileStatus.innerHTML.includes("Maximum allowed size is 10MB"),
      elements.fileStatus.innerHTML,
    );

    await ctx.ingestFile({ name: "zero.csv", size: 0 });
    check(
      "empty csv rejected",
      elements.fileStatus.innerHTML.includes("File is empty"),
      elements.fileStatus.innerHTML,
    );
  }

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

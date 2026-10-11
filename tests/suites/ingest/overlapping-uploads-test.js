// overlapping-uploads suite: the latest file chosen wins. A workbook is read through
// an async buffer and a parse; a CSV is read through a FileReader. With two files in
// flight the one that finished last used to commit last, so a slow workbook picked
// first replaced a CSV picked second, and the rows on screen were not the file the
// user last chose. Covered both orders, the sequential control, and that a stale
// file's failure does not overwrite the status of the file that won.
const path = require("path");
const { buildContext, rowsOf, REPO } = require("../harness");
const XLSX = require(path.join(REPO, "js/vendor/xlsx.full.min.js"));

const { ctx, elements } = buildContext();
const resetUi = () => {
  for (const key of Object.keys(elements)) delete elements[key];
};

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEAD = ["VM Name", "CPU Count", "Memory (GB)"];

function workbook(vmName, delayMs, { fail = false } = {}) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([HEAD, [vmName, 4, 16]]),
    "Data",
  );
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const bytes = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  );
  return {
    name: `${vmName}.xlsx`,
    size: bytes.byteLength,
    arrayBuffer: async () => {
      await sleep(delayMs);
      if (fail) throw new Error("stale workbook failed");
      return bytes;
    },
  };
}

// A FileReader whose load finishes after `delayMs`, delivering `text`.
function useCsvReader(text, delayMs) {
  ctx.FileReader = class {
    /** @type {any} */
    onload = null;
    /** @type {any} */
    onerror = null;
    readAsText() {
      const self = this;
      setTimeout(() => {
        if (self.onload) self.onload({ target: { result: text } });
      }, delayMs);
    }
  };
}
const csvFile = (vmName) => ({ name: `${vmName}.csv`, size: 40 });
const csvText = (vmName) => `${HEAD.join(",")}\n${vmName},2,8\n`;
const firstVm = () => {
  const rows = rowsOf(ctx);
  return rows && rows[0] ? rows[0]["VM Name"] : undefined;
};

(async () => {
  console.log(
    "[a slow workbook picked first does not replace the CSV picked second]",
  );
  {
    resetUi();
    const slow = ctx.ingestFile(workbook("workbook-vm", 120));
    useCsvReader(csvText("csv-vm"), 5);
    await ctx.ingestFile(csvFile("csv-vm"));
    await sleep(20);
    check(
      "the CSV's rows are loaded",
      firstVm() === "csv-vm",
      String(firstVm()),
    );
    await slow;
    await sleep(20);
    check(
      "after the workbook finishes, the CSV's rows are still the ones loaded",
      firstVm() === "csv-vm",
      String(firstVm()),
    );
    check(
      "and no sheet picker from the workbook appears",
      !elements.sheetPickerSection ||
        elements.sheetPickerSection.classes.has("hidden") ||
        !elements.sheetPickerSection.innerHTML.includes("workbook"),
    );
  }

  console.log(
    "[a slow CSV picked first does not replace the workbook picked second]",
  );
  {
    resetUi();
    useCsvReader(csvText("csv-vm"), 120);
    const slow = ctx.ingestFile(csvFile("csv-vm"));
    await ctx.ingestFile(workbook("workbook-vm", 5));
    await sleep(20);
    check(
      "the workbook's rows are loaded",
      firstVm() === "workbook-vm",
      String(firstVm()),
    );
    await slow;
    await sleep(160);
    check(
      "after the CSV's reader finishes, the workbook's rows are still loaded",
      firstVm() === "workbook-vm",
      String(firstVm()),
    );
  }

  console.log("[one file at a time still loads]");
  {
    resetUi();
    useCsvReader(csvText("first-vm"), 5);
    await ctx.ingestFile(csvFile("first-vm"));
    await sleep(20);
    check("a lone CSV loads", firstVm() === "first-vm", String(firstVm()));
    await ctx.ingestFile(workbook("second-vm", 5));
    check(
      "a later workbook replaces it, as before",
      firstVm() === "second-vm",
      String(firstVm()),
    );
  }

  console.log(
    "[a superseded file's failure does not overwrite the winner's status]",
  );
  {
    resetUi();
    const stale = ctx.ingestFile(workbook("bad-vm", 100, { fail: true }));
    useCsvReader(csvText("csv-vm"), 5);
    await ctx.ingestFile(csvFile("csv-vm"));
    await sleep(20);
    await stale;
    await sleep(20);
    const html = elements.fileStatus ? elements.fileStatus.innerHTML : "";
    check(
      "the status still reports the CSV, not the stale workbook's error",
      !html.includes("Could not read the Excel file") &&
        elements.fileStatus.className.includes("alert-success"),
      html.slice(0, 160),
    );
  }

  console.log(
    "[a superseded CSV's read error does not overwrite the winner's status]",
  );
  {
    resetUi();
    ctx.FileReader = class {
      /** @type {any} */
      onload = null;
      /** @type {any} */
      onerror = null;
      readAsText() {
        const self = this;
        setTimeout(() => self.onerror && self.onerror(new Error("io")), 100);
      }
    };
    const stale = ctx.ingestFile(csvFile("broken-vm"));
    await ctx.ingestFile(workbook("workbook-vm", 5));
    await stale;
    await sleep(160);
    const html = elements.fileStatus ? elements.fileStatus.innerHTML : "";
    check(
      "the status still reports the workbook, not the stale read error",
      !html.includes("Could not read the file") &&
        elements.fileStatus.className.includes("alert-success"),
      html.slice(0, 160),
    );
  }

  process.exitCode = failures ? 1 : 0;
  if (!failures) console.log("\noverlapping-uploads: all checks passed");
})();

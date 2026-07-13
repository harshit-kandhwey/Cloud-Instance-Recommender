// Multi-sheet .xlsx: the inventory sheet is opened, not merely the first one,
// and the choice stays visible and changeable.
//
// Builds real workbooks with the vendored SheetJS and drives ingestFile() in the
// simulated-DOM context, the same way step5-test does.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const XLSX = require(path.join(REPO, "js/vendor/xlsx.full.min.js"));

function makeXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const fakeFile = (name, arrayBuffer) => ({
  name,
  size: arrayBuffer.byteLength,
  arrayBuffer: async () => arrayBuffer,
  text: async () => Buffer.from(arrayBuffer).toString("utf8"),
});

// `hidePicker` drops the picker element, to exercise the fallback on a page that
// has none — the harness's getElementById otherwise conjures every id asked for.
function buildContext({ hidePicker = false } = {}) {
  const elements = {};
  function fakeElement(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        innerHTML: "",
        className: "",
        textContent: "",
        style: {},
        value: "",
        checked: false,
        classes: new Set(["hidden"]),
        classList: {
          add: (c) => elements[id].classes.add(c),
          remove: (c) => elements[id].classes.delete(c),
          toggle: () => {},
          contains: (c) => elements[id].classes.has(c),
        },
        addEventListener: () => {},
        querySelectorAll: () => [],
      };
    }
    return elements[id];
  }
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    // The CSV branch of ingestFile goes through FileReader, which Node has not
    FileReader: class {
      readAsText(file) {
        file.text().then((t) => {
          this.onload && this.onload({ target: { result: t } });
        });
      }
    },
  };
  sandbox.window = sandbox;
  sandbox.document = {
    createElement: (tag) => ({ tag, style: {} }),
    getElementById: (id) =>
      hidePicker && id === "sheetPickerSection" ? null : fakeElement(id),
    querySelectorAll: (sel) =>
      sel === "script[src]" ? [{ src: "js/aws/aws-data.js" }] : [],
    addEventListener: () => {},
    head: {
      appendChild(script) {
        if (script.tag !== "script") return;
        setTimeout(() => {
          try {
            const code = fs.readFileSync(path.join(REPO, script.src), "utf8");
            vm.runInContext(code, ctx, { filename: script.src });
            script.onload && script.onload();
          } catch (e) {
            script.onerror && script.onerror(e);
          }
        }, 0);
      },
    },
    body: { appendChild: () => {}, removeChild: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  const load = (rel) =>
    vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
      filename: rel,
    });
  load("js/aws/aws-data.js");
  for (const f of [
    "js/base/rule-engine.js",
    "js/base/base-instance-selector.js",
    "js/aws/aws-instance-selector.js",
    "js/azure/azure-instance-selector.js",
    "js/gcp/gcp-instance-selector.js",
    "js/base/instance-selector-factory.js",
    "js/base/app-core.js",
    "js/base/ui-shell.js",
    "js/base/ingest.js",
    "js/base/manual-entry.js",
    "js/base/form-controls.js",
    "js/base/generate.js",
    "js/base/preview.js",
    "js/base/downloads.js",
  ])
    load(f);
  return { ctx, elements };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

const rowsOf = (ctx) => vm.runInContext("csvData", ctx);
const INVENTORY_HEADERS = ["VM Name", "CPU Count", "Memory (GB)", "AWS Region"];
const inventory = (...names) => [
  INVENTORY_HEADERS,
  ...names.map((n, i) => [n, 4 + i, 16, "us-east-1"]),
];

// An RVTools export: the VM inventory is in vInfo, behind a metadata tab, and
// followed by tabs that describe the same VMs from other angles.
const RVTOOLS = [
  {
    name: "vMetaData",
    aoa: [
      ["Metadata item", "Value"],
      ["Author", "RVTools"],
    ],
  },
  { name: "vInfo", aoa: inventory("web-01", "db-02", "app-03") },
  {
    name: "vCPU",
    aoa: [
      ["VM", "Sockets"],
      ["web-01", 2],
    ],
  },
];

(async () => {
  console.log("[the inventory sheet is opened, not the first sheet]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));

    // The whole point: SheetNames[0] is vMetaData, and reading it would have
    // produced two junk rows with no CPU or memory at all.
    check(
      "vInfo is read, though vMetaData comes first",
      rowsOf(ctx).length === 3 && rowsOf(ctx)[0]["VM Name"] === "web-01",
      JSON.stringify(rowsOf(ctx)),
    );
    check(
      "the picker is shown and preselects the sheet that was opened",
      !elements.sheetPickerSection.classes.has("hidden") &&
        /<option value="vInfo" selected>/.test(
          elements.sheetPickerSection.innerHTML,
        ),
    );
    check(
      "every readable sheet is offered, with its row count",
      ["vMetaData", "vInfo", "vCPU"].every((n) =>
        elements.sheetPickerSection.innerHTML.includes(`>${n} — `),
      ),
      elements.sheetPickerSection.innerHTML,
    );
  }

  console.log("[the user can override the choice]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "twins.xlsx",
        makeXlsx([
          { name: "First", aoa: inventory("from-first") },
          { name: "Second", aoa: inventory("from-second", "and-another") },
        ]),
      ),
    );
    ctx.selectSheet("Second");
    check(
      "switching sheets re-ingests from the chosen one",
      rowsOf(ctx).length === 2 && rowsOf(ctx)[0]["VM Name"] === "from-second",
      JSON.stringify(rowsOf(ctx)),
    );
    check(
      "the picker follows the switch",
      /<option value="Second" selected>/.test(
        elements.sheetPickerSection.innerHTML,
      ),
    );
    check(
      "an unknown sheet name is ignored rather than blanking the data",
      (ctx.selectSheet("nope"), rowsOf(ctx).length === 2),
    );
  }

  console.log(
    "[switching to a sheet that is not an inventory asks, not guesses]",
  );
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));
    ctx.selectSheet("vCPU"); // has VM and Sockets — no CPU count, no memory
    check(
      "the column-mapping panel opens rather than loading columns it cannot read",
      !elements.columnMappingSection.classes.has("hidden") &&
        rowsOf(ctx).length === 0,
      `rows=${JSON.stringify(rowsOf(ctx))}`,
    );
  }

  console.log("[sheets that are not data are not offered]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "gaps.xlsx",
        makeXlsx([
          { name: "Empty", aoa: [] },
          {
            name: "Blank header",
            aoa: [
              ["", ""],
              ["", ""],
            ],
          },
          { name: "Data", aoa: inventory("web-01") },
        ]),
      ),
    );
    check(
      "an empty tab and a headerless tab are skipped",
      !elements.sheetPickerSection.innerHTML.includes("Empty") &&
        !elements.sheetPickerSection.innerHTML.includes("Blank header"),
      elements.sheetPickerSection.innerHTML,
    );
    check(
      "one usable sheet left → no picker, and it is read",
      elements.sheetPickerSection.classes.has("hidden") &&
        rowsOf(ctx).length === 1,
    );
  }

  console.log("[unchanged where there is no choice to make]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "one.xlsx",
        makeXlsx([{ name: "Sheet1", aoa: inventory("web-01", "db-02") }]),
      ),
    );
    check(
      "a single-sheet workbook reads as before, with no picker",
      rowsOf(ctx).length === 2 &&
        elements.sheetPickerSection.classes.has("hidden"),
    );
  }
  {
    // Two sheets the scorer cannot tell apart: order decides, as it always did.
    const { ctx } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "twins.xlsx",
        makeXlsx([
          { name: "First", aoa: inventory("from-first") },
          { name: "Second", aoa: inventory("from-second") },
        ]),
      ),
    );
    check(
      "a tie falls back to workbook order",
      rowsOf(ctx)[0]["VM Name"] === "from-first",
      JSON.stringify(rowsOf(ctx)),
    );
  }

  console.log("[the picker never outlives the file it belongs to]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));
    check(
      "picker shown for the workbook",
      !elements.sheetPickerSection.classes.has("hidden"),
    );
    await ctx.ingestFile(
      fakeFile(
        "plain.csv",
        // A CSV goes down the FileReader path, which the harness has no stub
        // for; ingestFile still has to clear the workbook state before it gets
        // there, which is what this asserts.
        new TextEncoder().encode("VM Name,CPU Count\nweb-01,4\n").buffer,
      ),
    );
    check(
      "uploading a CSV afterwards clears it, rather than offering the old sheets",
      elements.sheetPickerSection.classes.has("hidden") &&
        elements.sheetPickerSection.innerHTML === "" &&
        ctx.window._uploadedSheets === null,
    );
  }

  console.log("[a page without a picker still says what it opened]");
  {
    const { ctx, elements } = buildContext({ hidePicker: true });
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));
    check(
      "the status line names the sheet, rather than reading one invisibly",
      /vInfo/.test(elements.fileStatus.innerHTML) &&
        /3 sheets/.test(elements.fileStatus.innerHTML),
      elements.fileStatus.innerHTML,
    );
    check("and it still reads the right sheet", rowsOf(ctx).length === 3);
  }

  process.exit(failures ? 1 : 0);
})();

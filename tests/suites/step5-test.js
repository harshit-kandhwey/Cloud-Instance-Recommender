// Step 5 verification: .xlsx ingestion via vendored SheetJS.
// Builds real xlsx files with the vendored library, then feeds them through
// ingestFile() in the simulated-DOM context (including lazy script load).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
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
  return { name, arrayBuffer: async () => arrayBuffer };
}

function buildContext() {
  const elements = {};
  const requested = [];
  function fakeElement(id) {
    if (!elements[id]) {
      elements[id] = {
        id, innerHTML: "", className: "", textContent: "", style: {},
        value: "", checked: false,
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
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    alert: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  sandbox.window = sandbox;
  sandbox.document = {
    createElement: (tag) => ({ tag, style: {} }),
    getElementById: (id) => fakeElement(id),
    querySelectorAll: (sel) =>
      sel === "script[src]" ? [{ src: "js/aws/aws-data.js" }] : [],
    addEventListener: () => {},
    head: {
      appendChild(script) {
        if (script.tag !== "script") return;
        requested.push(script.src);
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
    vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, { filename: rel });
  load("js/aws/aws-data.js");
  for (const f of [
    "js/base/rule-engine.js",
    "js/base/base-instance-selector.js",
    "js/aws/aws-instance-selector.js",
    "js/azure/azure-instance-selector.js",
    "js/gcp/gcp-instance-selector.js",
    "js/base/instance-selector-factory.js",
    "js/base/main-script.js",
  ]) load(f);
  return { ctx, elements, requested };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else { failures++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

const AOA = [
  ["VM Name", "CPU Count", "Memory (GB)", "CPU Utilization", "Memory Utilization", "AWS Region"],
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
    await ctx.ingestFile(fakeFile("servers.xlsx", makeXlsx([{ name: "Sheet1", aoa: AOA }])));
    check("vendor script lazily injected", requested.includes("js/vendor/xlsx.full.min.js"), requested.join(","));
    const data = vm.runInContext("csvData", ctx);
    check("2 rows ingested", data.length === 2, JSON.stringify(data));
    check("values are trimmed strings", data[0]["CPU Count"] === "4" && data[1]["Memory (GB)"] === "32");

    // Byte-equivalence with the CSV path ⇒ identical downstream output
    const xlsxJson = JSON.stringify(data);
    vm.runInContext(`parseCSV(${JSON.stringify(CSV_EQUIV)})`, ctx);
    const csvJson = JSON.stringify(vm.runInContext("csvData", ctx));
    check("xlsx rows identical to CSV rows", xlsxJson === csvJson, `${xlsxJson}\nvs\n${csvJson}`);
  }

  console.log("[2. synonym headers in xlsx go through column mapping]");
  {
    const { ctx } = buildContext();
    const aoa = [["Hostname", "vCPUs", "RAM", "AWS Region"], ["srv1", 8, 32, "us-west-2"]];
    await ctx.ingestFile(fakeFile("x.xlsx", makeXlsx([{ name: "S", aoa }])));
    const data = vm.runInContext("csvData", ctx);
    check("auto-mapped to canonical keys", data.length === 1 && data[0]["CPU Count"] === "8" && data[0]["VM Name"] === "srv1", JSON.stringify(data));
  }

  console.log("[3. multi-sheet → first sheet]");
  {
    const { ctx } = buildContext();
    const wb = makeXlsx([
      { name: "First", aoa: AOA },
      { name: "Second", aoa: [["VM Name", "CPU Count", "Memory (GB)"], ["WRONG", 1, 1]] },
    ]);
    await ctx.ingestFile(fakeFile("multi.xlsx", wb));
    const data = vm.runInContext("csvData", ctx);
    check("first sheet used", data.length === 2 && data[0]["VM Name"] === "web-server-01");
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

    await ctx.ingestFile(fakeFile("empty.xlsx", makeXlsx([{ name: "S", aoa: [] }])));
    check("empty sheet → warning status, no crash",
      elements.fileStatus.innerHTML.includes("Could not read the Excel file"),
      elements.fileStatus.innerHTML);
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
    await ctx.ingestFile({ name: "plain.csv", _text: CSV_EQUIV });
    await new Promise((r) => setTimeout(r, 50));
    check("csv ingested via parseCSV", vm.runInContext("csvData", ctx).length === 2);
    check("xlsx lib NOT loaded for csv", !requested.includes("js/vendor/xlsx.full.min.js"));
  }

  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

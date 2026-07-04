// Verification of the xlsx/CSV upload hardening: multi-sheet UI note,
// size/empty guards, reader.onerror, and file-handler validator scoping.
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

const elements = {};
function fakeElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id, innerHTML: "", className: "", style: {}, value: "",
      classes: new Set(["hidden"]),
      classList: {
        add: (c) => elements[id].classes.add(c),
        remove: (c) => elements[id].classes.delete(c),
        toggle: () => {}, contains: (c) => elements[id].classes.has(c),
      },
      addEventListener: () => {}, querySelectorAll: () => [],
      focus: () => {}, setSelectionRange: () => {}, scrollIntoView: () => {},
    };
  }
  return elements[id];
}
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
sandbox.window = sandbox;
sandbox.document = {
  createElement: (tag) => ({ tag, style: {} }),
  getElementById: (id) => fakeElement(id),
  querySelectorAll: (sel) => (sel === "script[src]" ? [{ src: "js/aws/aws-data.js" }] : []),
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
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, { filename: rel });
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
]) load(f);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else { failures++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

const AOA = [["VM Name", "CPU Count", "Memory (GB)"], ["a", 4, 16]];

(async () => {
  console.log("[multi-sheet note surfaces in fileStatus]");
  {
    const buf = makeXlsx([
      { name: "Data", aoa: AOA },
      { name: "Notes", aoa: [["x"]] },
      { name: "More", aoa: [["y"]] },
    ]);
    await ctx.ingestFile({ name: "multi.xlsx", size: buf.byteLength, arrayBuffer: async () => buf });
    check("note in fileStatus", elements.fileStatus.innerHTML.includes("3 sheets — only the first (&quot;Data&quot;) was used"), elements.fileStatus.innerHTML);
    check("still success status", elements.fileStatus.className.includes("alert-success"));
  }

  console.log("[single sheet → no note]");
  {
    const buf = makeXlsx([{ name: "Only", aoa: AOA }]);
    await ctx.ingestFile({ name: "one.xlsx", size: buf.byteLength, arrayBuffer: async () => buf });
    check("no note", !elements.fileStatus.innerHTML.includes("sheets"));
  }

  console.log("[size/empty guards]");
  {
    await ctx.ingestFile({ name: "big.xlsx", size: 11 * 1024 * 1024, arrayBuffer: async () => { throw new Error("should not be called"); } });
    check("oversized rejected before buffering", elements.fileStatus.innerHTML.includes("Maximum allowed size is 10MB"), elements.fileStatus.innerHTML);

    await ctx.ingestFile({ name: "zero.xlsx", size: 0, arrayBuffer: async () => new ArrayBuffer(0) });
    check("empty file rejected", elements.fileStatus.innerHTML.includes("File is empty"));
  }

  console.log("[csv reader.onerror]");
  {
    ctx.FileReader = class {
      readAsText() {
        const self = this;
        setTimeout(() => self.onerror && self.onerror(new Error("io")), 0);
      }
    };
    await ctx.ingestFile({ name: "broken.csv", size: 10 });
    await new Promise((r) => setTimeout(r, 50));
    check("read failure surfaces in UI", elements.fileStatus.innerHTML.includes("Could not read the file"), elements.fileStatus.innerHTML);
  }

  console.log("[file-handler validator scoped to CSV]");
  {
    const fhCtx = vm.createContext({
      window: {}, console: { log: () => {}, warn: () => {}, error: () => {} },
      document: undefined, module: { exports: {} },
      setTimeout, clearTimeout,
    });
    fhCtx.window = fhCtx;
    vm.runInContext(
      fs.readFileSync(path.join(REPO, "js/base/file-handler.js"), "utf8"),
      fhCtx, { filename: "file-handler.js" },
    );
    const FileHandler = fhCtx.module.exports.FileHandler;
    const fh = new FileHandler();
    check("csv accepted", fh._isValidFileType({ name: "a.csv", type: "" }));
    check("xlsx NOT advertised by text parser", !fh._isValidFileType({ name: "a.xlsx", type: "" }));
  }

  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

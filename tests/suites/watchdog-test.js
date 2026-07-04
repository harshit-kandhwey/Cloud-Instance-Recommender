// Watchdog verification: a Worker that never responds must trigger the
// watchdog rejection, terminate, and fall back to the main-thread path,
// still producing correct results.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

let terminated = 0;
let posted = 0;

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  alert: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  Worker: class FakeStalledWorker {
    constructor() {}
    postMessage() {
      posted++;
      // never replies — simulates a stalled worker
    }
    terminate() {
      terminated++;
    }
  },
};
sandbox.window = sandbox;
sandbox.document = {
  createElement: (tag) => ({ tag, style: {} }),
  getElementById: () => null,
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

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}

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

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

(async () => {
  ctx._workerWatchdogMs = 300; // short watchdog for the test

  const rows = [
    {
      "VM Name": "a",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "AWS Region": "us-east-1",
    },
  ];
  const options = {
    generateLikeToLike: true,
    generateOptimized: false,
    excludeTypes: [],
    selectedInstanceFamilyNames: [],
    selectedProcessorManufacturers: [],
    selectedMainFamilies: [],
    selectedAzureSeries: [],
    selectedAzureProcessors: [],
    selectedAzureVMFamilies: [],
    selectedGCPFamilies: [],
    selectedGCPProcessors: [],
    selectedGCPMachineTypes: [],
  };

  const start = Date.now();
  const results = await ctx.runRecommendationBatch(rows, ["aws"], options);
  const elapsed = Date.now() - start;

  check("worker was attempted", posted === 1, `posted=${posted}`);
  check("worker terminated after stall", terminated === 1, `terminated=${terminated}`);
  check("watchdog waited before fallback", elapsed >= 300, `${elapsed}ms`);
  check("fallback produced results", Array.isArray(results) && results.length === 1);
  check(
    "fallback used real region data",
    results[0]["AWS Like-to-Like Instance"] &&
      results[0]["AWS Like-to-Like Instance"] !== "No data available" &&
      results[0]["AWS Like-to-Like Instance"] !== "Missing data",
    JSON.stringify(results[0]["AWS Like-to-Like Instance"]),
  );

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Step 3 verification: simulates the recommendation worker end-to-end
// (importScripts shim + postMessage protocol) and the hooked main-thread
// fallback, comparing both against the golden multicloud output.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const GOLD = path.join(__dirname, "..", "golden", "goldens");

const SAMPLE_CSV = `VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region,ENV,OS,Workload,Compliance,Min Gen
web-server-01,4,16,45,60,us-east-1,East US,us-central1-a,Production,Linux,Web Server,,
db-server-02,8,32,70,80,us-west-2,West US 2,us-west1-b,Production,Windows,Database,PCI,
app-server-03,2,8,35,45,eu-west-1,North Europe,europe-west1-c,Dev,Linux,General,,
cache-server-04,2,4,25,30,us-east-1,East US,us-central1-a,Staging,Linux,Cache,,
api-server-05,4,8,65,55,us-west-1,West US,us-west1-b,Production,Linux,Web Server,,6
microservice-06,1,2,15,20,us-east-1,East US,us-central1-a,Dev,Linux,General,,
worker-node-07,8,16,85,75,us-west-2,West US 2,us-west1-b,Production,Linux,ML/AI,HIPAA,7
frontend-08,2,4,40,50,eu-west-1,North Europe,europe-west1-c,Staging,Windows,Web Server,,`;

function parseSample() {
  const lines = SAMPLE_CSV.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = values[i] || ""));
    return row;
  });
}

function escapeCell(val) {
  const s = String(val == null ? "" : val);
  const safe = /^[=+\-@|\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function toCsv(results) {
  const headers = Object.keys(results[0]);
  return [
    headers.map(escapeCell).join(","),
    ...results.map((row) =>
      headers.map((h) => escapeCell(row[h] ?? "")).join(","),
    ),
  ].join("\n");
}

const OPTIONS = {
  generateLikeToLike: true,
  generateOptimized: true,
  cpuBased: true,
  memoryBased: true,
  cpuDownsizeMax: 40,
  cpuUpsizeMin: 80,
  memoryDownsizeMax: 40,
  memoryUpsizeMin: 80,
  currentGenerationOnly: false,
  restrictInstanceFamilyNames: false,
  selectedInstanceFamilyNames: [],
  restrictProcessorManufacturers: false,
  selectedProcessorManufacturers: [],
  restrictMainFamilies: false,
  selectedMainFamilies: [],
  excludeTypes: [],
  excludeGraviton: false,
  selectedAzureSeries: [],
  selectedAzureProcessors: [],
  selectedAzureVMFamilies: [],
  selectedGCPFamilies: [],
  selectedGCPProcessors: [],
  selectedGCPMachineTypes: [],
};
const PROVIDERS = ["aws", "azure", "gcp"];

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

// ── Data context: manifests + only the regions the CSV needs ────────────────
const REGION_FILES = {
  aws: ["us_east_1", "us_west_2", "eu_west_1", "us_west_1"],
  azure: ["eastus", "westus2", "northeurope", "westus"],
  gcp: ["us_central1", "us_west1", "europe_west1"],
};
const dataCtx = vm.createContext({ window: {} });
dataCtx.window = dataCtx;
const flags = {};
const regionData = {};
for (const p of PROVIDERS) {
  vm.runInContext(
    fs.readFileSync(path.join(REPO, `js/${p}/${p}-data.js`), "utf8"),
    dataCtx,
  );
  const prefix = p.toUpperCase();
  flags[`${prefix}_DATA_READY`] = true;
  flags[`${prefix}_REGION_KEYS`] = dataCtx[`${prefix}_REGION_KEYS`];
  flags[`${prefix}_DATA_DATE`] = dataCtx[`${prefix}_DATA_DATE`];
  for (const key of REGION_FILES[p]) {
    vm.runInContext(
      fs.readFileSync(path.join(REPO, `js/${p}/regions/${key}.js`), "utf8"),
      dataCtx,
    );
    regionData[key] = dataCtx[key];
  }
}

// ── Worker sandbox with importScripts shim ──────────────────────────────────
const posted = [];
const workerSandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  postMessage: (m) => posted.push(m),
  importScripts: (...files) => {
    for (const f of files) {
      const full = path.join(REPO, "js/base", f);
      vm.runInContext(fs.readFileSync(full, "utf8"), workerCtx, {
        filename: full,
      });
    }
  },
};
workerSandbox.self = workerSandbox;
const workerCtx = vm.createContext(workerSandbox);

vm.runInContext(
  fs.readFileSync(path.join(REPO, "js/base/recommendation-worker.js"), "utf8"),
  workerCtx,
  { filename: "recommendation-worker.js" },
);

(async () => {
  console.log("[worker protocol]");
  check("onmessage handler registered", typeof workerCtx.onmessage === "function");
  // window shim: factory assigns window.getInstanceRecommendationWithSelector;
  // reachable as a global only if self.window = self worked
  check(
    "window shim set",
    typeof workerCtx.getInstanceRecommendationWithSelector === "function",
  );

  // Simulate structured clone (worker gets copies, not references)
  const clonedMsg = JSON.parse(
    JSON.stringify({
      type: "run",
      csvData: parseSample(),
      providers: PROVIDERS,
      options: OPTIONS,
      regionData,
      flags,
    }),
  );
  await workerCtx.onmessage({ data: clonedMsg });

  // Wait for the async handler's postMessage(result)
  for (let i = 0; i < 100 && !posted.some((m) => m.type === "result"); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const progress = posted.filter((m) => m.type === "progress");
  const result = posted.find((m) => m.type === "result");
  const errorMsg = posted.find((m) => m.type === "error");
  check("no error message", !errorMsg, errorMsg && errorMsg.message);
  check("result posted", !!result);
  check(
    "final progress is 8/8",
    progress.length > 0 &&
      progress[progress.length - 1].done === 8 &&
      progress[progress.length - 1].total === 8,
    JSON.stringify(progress),
  );

  const golden = fs.readFileSync(path.join(GOLD, "multicloud-both.csv"), "utf8");
  check("worker output matches golden", toCsv(result.results) === golden);

  console.log("[main-thread fallback with hooks]");
  const mainCtx = vm.createContext({
    window: {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
  });
  mainCtx.window = mainCtx;
  for (const p of PROVIDERS) {
    vm.runInContext(
      fs.readFileSync(path.join(REPO, `js/${p}/${p}-data.js`), "utf8"),
      mainCtx,
    );
    for (const key of REGION_FILES[p]) {
      vm.runInContext(
        fs.readFileSync(path.join(REPO, `js/${p}/regions/${key}.js`), "utf8"),
        mainCtx,
      );
    }
  }
  for (const f of [
    "js/base/rule-engine.js",
    "js/base/base-instance-selector.js",
    "js/aws/aws-instance-selector.js",
    "js/azure/azure-instance-selector.js",
    "js/gcp/gcp-instance-selector.js",
    "js/base/instance-selector-factory.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(REPO, f), "utf8"), mainCtx, {
      filename: f,
    });
  }
  const calls = [];
  const results2 = await mainCtx.getInstanceRecommendationWithSelector(
    parseSample(),
    PROVIDERS,
    OPTIONS,
    { onProgress: (d, t) => calls.push([d, t]), yieldEvery: 3 },
  );
  check(
    "fallback progress at 3,6,8",
    JSON.stringify(calls) === "[[3,8],[6,8],[8,8]]",
    JSON.stringify(calls),
  );
  check("fallback output matches golden", toCsv(results2) === golden);

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

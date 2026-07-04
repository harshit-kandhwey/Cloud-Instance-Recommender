// Golden-output harness for the Cloud-Instance-Recommender upgrade plan.
// Runs the built-in sample CSV through the real pure pipeline (rule-engine,
// selectors, factory) inside a Node VM context and writes result CSVs
// serialized exactly like main-script.js downloadResults().
//
// Usage: node golden-run.js <repoDir> <outDir>
// Re-run after each risky step and byte-compare against the saved goldens.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = process.argv[2];
const OUT = process.argv[3];
if (!REPO || !OUT) {
  console.error("usage: node golden-run.js <repoDir> <outDir>");
  process.exit(2);
}

// Same rows as downloadSampleCSV() in main-script.js
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

// Identical to the escapeCell fallback in downloadResults()
function escapeCell(val) {
  const s = String(val == null ? "" : val);
  const safe = /^[=+\-@|\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(results) {
  if (!results.length) {
    throw new Error("toCsv: no results to serialize");
  }
  // Union of keys across all rows (first-seen order) so a column appearing
  // only on later rows can't be silently dropped from the golden
  const headers = [...new Set(results.flatMap((row) => Object.keys(row)))];
  return [
    headers.map(escapeCell).join(","),
    ...results.map((row) =>
      headers.map((h) => escapeCell(row[h] ?? "")).join(","),
    ),
  ].join("\n");
}

const warnings = [];
function makeContext() {
  const sandbox = {
    console: {
      log: () => {},
      warn: (...a) => warnings.push(a.join(" ")),
      error: (...a) => warnings.push("ERROR: " + a.join(" ")),
    },
    setTimeout,
  };
  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}

function load(ctx, rel) {
  const file = path.join(REPO, rel);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
}

const CODE_FILES = [
  "js/base/rule-engine.js",
  "js/base/base-instance-selector.js",
  "js/aws/aws-instance-selector.js",
  "js/azure/azure-instance-selector.js",
  "js/gcp/gcp-instance-selector.js",
  "js/base/instance-selector-factory.js",
];

// Loads provider data: monolith if present, else manifest + all region files
function loadProviderData(ctx, name) {
  load(ctx, `js/${name}/${name}-data.js`);
  const prefix = name.toUpperCase();
  const keys = ctx[`${prefix}_REGION_KEYS`];
  if (Array.isArray(keys)) {
    for (const key of keys) load(ctx, `js/${name}/regions/${key}.js`);
  }
}

const BASE_OPTIONS = {
  cpuBased: false,
  memoryBased: false,
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

const SCENARIOS = [
  {
    file: "aws-l2l.csv",
    providers: ["aws"],
    options: {
      ...BASE_OPTIONS,
      generateLikeToLike: true,
      generateOptimized: false,
    },
  },
  {
    file: "multicloud-both.csv",
    providers: ["aws", "azure", "gcp"],
    options: {
      ...BASE_OPTIONS,
      generateLikeToLike: true,
      generateOptimized: true,
      cpuBased: true,
      memoryBased: true,
    },
  },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const { file, providers, options } of SCENARIOS) {
    const ctx = makeContext();
    for (const p of providers) loadProviderData(ctx, p);
    for (const f of CODE_FILES) load(ctx, f);

    const results = await ctx.getInstanceRecommendationWithSelector(
      parseSample(),
      providers,
      options,
    );
    fs.writeFileSync(path.join(OUT, file), toCsv(results), "utf8");
    console.log(
      `${file}: ${results.length} rows, ${new Set(results.flatMap((row) => Object.keys(row))).size} columns`,
    );
  }

  const fallbackWarns = warnings.filter((w) => w.includes("fallback"));
  if (fallbackWarns.length) {
    console.error("FATAL: sample-data fallback was used — golden is invalid:");
    fallbackWarns.forEach((w) => console.error("  " + w));
    process.exit(1);
  }
  const errors = warnings.filter((w) => w.startsWith("ERROR:"));
  if (errors.length) {
    console.error("Console errors during run:");
    errors.forEach((w) => console.error("  " + w));
    process.exit(1);
  }
  console.log("Done — no fallbacks, no errors.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

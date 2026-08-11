// Recommendation worker end-to-end: simulates the worker
// (importScripts shim + postMessage protocol) and the hooked main-thread
// fallback, comparing both against the golden multicloud output.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");
const GOLD = path.join(__dirname, "..", "..", "golden", "goldens");

// The SAME rows golden-run.js uses — this suite compares its output against
// that runner's golden, so any drift between the two copies would show up as a
// golden mismatch that has nothing to do with the worker under test.
const SAMPLE_CSV = `VM Name,App Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region,ENV,OS,Workload,Compliance,AWS Min Gen,Azure Min Gen,GCP Min Gen
web-server-01,Storefront,4,16,45,60,us-east-1,East US,us-central1-a,Production,Linux,Web Server,,,,
db-server-02,Billing,8,32,70,80,us-west-2,West US 2,us-west1-b,Production,Windows,Database,PCI,,,
app-server-03,Billing,2,8,35,45,eu-west-1,North Europe,europe-west1-c,Dev,Linux,General,,,,
cache-server-04,Storefront,2,4,25,30,us-east-1,East US,us-central1-a,Staging,Linux,Cache,,,,
api-server-05,Storefront,4,8,65,55,us-west-1,West US,us-west1-b,Production,Linux,Web Server,,6,4,n4
microservice-06,Analytics,1,2,15,20,us-east-1,East US,us-central1-a,Dev,Linux,General,,,,
worker-node-07,Analytics,8,16,85,75,us-west-2,West US 2,us-west1-b,Production,Linux,ML/AI,HIPAA,7,5,n4
frontend-08,Storefront,2,4,40,50,eu-west-1,North Europe,europe-west1-c,Staging,Windows,Web Server,,,,`;

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

// REGION_FILES is hand-coupled to the regions SAMPLE_CSV references. If the
// sample later gains a region not listed here, the worker would silently load
// incomplete data and fall back to sample rows — surfacing only as a golden
// mismatch with no pointer to the cause. Fail loudly instead: every listed key
// must resolve to real data, and the count of distinct sample regions per
// provider must match the list. (A new sample region that shares a normalized
// key with an existing one would trip the count check — update the list then.)
const SAMPLE_REGION_COL = {
  aws: "AWS Region",
  azure: "Azure Region",
  gcp: "GCP Region",
};
for (const p of PROVIDERS) {
  for (const key of REGION_FILES[p]) {
    if (!regionData[key]) {
      throw new Error(`REGION_FILES[${p}] key "${key}" loaded no data`);
    }
  }
  const distinct = new Set(
    parseSample()
      .map((r) => r[SAMPLE_REGION_COL[p]])
      .filter(Boolean),
  );
  if (distinct.size !== REGION_FILES[p].length) {
    throw new Error(
      `SAMPLE_CSV references ${distinct.size} distinct ${p} regions but ` +
        `REGION_FILES lists ${REGION_FILES[p].length} — add the missing region file(s).`,
    );
  }
}

// ── Worker sandbox with importScripts shim ──────────────────────────────────
const posted = [];
const workerSandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  // A real worker structured-clones outbound messages; clone here too so a result
  // carrying a value browser postMessage could not clone fails in the test rather
  // than passing against a shared reference the real page would never receive.
  postMessage: (m) => posted.push(structuredClone(m)),
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
  check(
    "onmessage handler registered",
    typeof workerCtx.onmessage === "function",
  );
  // window shim: factory assigns window.getInstanceRecommendationWithSelector;
  // reachable as a global only if self.window = self worked
  check(
    "window shim set",
    typeof workerCtx.getInstanceRecommendationWithSelector === "function",
  );

  // ── Region-identity invariant: the worker preserves the region SET ──────────
  // The setup count check above (distinct sample regions === REGION_FILES length)
  // is necessary but not sufficient: equal counts can hide a mismatched key. The
  // stronger invariant is set equality between (a) the region keys the worker's
  // OWN selector derives from the raw sample-CSV region strings and (b) the region
  // data files the worker was handed. Crucially the normalization is read LIVE off
  // InstanceSelectorFactory — the exact factory the worker importScripts — not a
  // copy in the test, so a change to any provider's normalizeRegionForJS (the
  // hyphen→underscore, the Azure display-name map, the GCP zone-strip) surfaces
  // here as a real diff instead of drifting silently. This was deferred from 3.10
  // (round 9) precisely because a naive raw compare fails — "us-east-1" the sample
  // uses is not "us_east_1" the file is keyed by until normalizeRegionForJS runs.
  const sampleRows = parseSample();
  for (const p of PROVIDERS) {
    const selector = workerCtx.InstanceSelectorFactory.createSelector(p);
    const derived = new Set(
      sampleRows
        .map((r) => r[SAMPLE_REGION_COL[p]])
        .filter(Boolean)
        .map((region) => selector.normalizeRegionForJS(region)),
    );
    const loaded = new Set(REGION_FILES[p]);
    const equal =
      derived.size === loaded.size && [...derived].every((k) => loaded.has(k));
    check(
      `${p}: worker region-set identity (live-normalized sample === loaded files)`,
      equal,
      `derived={${[...derived].sort().join(",")}} loaded={${[...loaded].sort().join(",")}}`,
    );
  }

  // The worker gets copies, not references. structuredClone is the algorithm
  // postMessage actually uses — more faithful than a JSON round-trip, which would
  // stringify Dates and drop undefined/functions, exercising a different shape
  // than a real worker receives.
  const clonedMsg = structuredClone({
    type: "run",
    csvData: parseSample(),
    providers: PROVIDERS,
    options: OPTIONS,
    regionData,
    flags,
  });
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

  const golden = fs.readFileSync(
    path.join(GOLD, "multicloud-both.csv"),
    "utf8",
  );
  // Guard result before serializing: if the worker posted an error or the poll
  // timed out, result is undefined and toCsv(result.results) would throw, aborting
  // the IIFE before the fallback checks below ever run — losing their granular
  // pass/fail. A missing result should be one clean failure, not a crash. Guard
  // .results.length too: toCsv dereferences results[0], so an empty results array
  // crashes the same way a missing message would.
  check(
    "worker output matches golden",
    !!result?.results?.length && toCsv(result.results) === golden,
  );

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
  check(
    "fallback output matches golden",
    !!results2?.length && toCsv(results2) === golden,
  );

  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

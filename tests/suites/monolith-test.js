// CodeRabbit fix verification: resolveRegion in the monolithic (no-manifest)
// data-file state must validate against window globals — real regions exact,
// garbage unknown.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  alert: () => {},
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
sandbox.window = sandbox;
sandbox.document = {
  createElement: (tag) => ({ tag, style: {} }),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  head: { appendChild: () => {} },
  body: { appendChild: () => {}, removeChild: () => {} },
};
const ctx = vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}

// Simulate the monolith era: region globals present, NO manifest keys
load("js/aws/regions/us_east_1.js");
load("js/azure/regions/eastus.js");
ctx.AWS_DATA_READY = true;
ctx.AZURE_DATA_READY = true;
// (AWS_REGION_KEYS / AZURE_REGION_KEYS intentionally absent)

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

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

const r = (p, raw) =>
  vm.runInContext(
    `resolveRegion(${JSON.stringify(p)}, ${JSON.stringify(raw)})`,
    ctx,
  );

console.log("[monolith state: no {P}_REGION_KEYS]");
check(
  "aws us-east-1 exact via window global",
  r("aws", "us-east-1").status === "exact",
);
check("aws key is us_east_1", r("aws", "us-east-1").key === "us_east_1");
check(
  "azure East US exact via window global",
  r("azure", "East US").status === "exact",
);
check("aws narnia-99 unknown", r("aws", "narnia-99").status === "unknown");
check("azure Atlantis unknown", r("azure", "Atlantis").status === "unknown");
check(
  "gcp (no data at all) unknown",
  r("gcp", "us-central1").status === "unknown",
);

console.log("[public wrappers]");
const sel = ctx.InstanceSelectorFactory.createSelector("aws");
check(
  "resolveManifestKey wrapper exists",
  typeof sel.resolveManifestKey === "function",
);
check(
  "ensureRegionScriptLoaded wrapper exists",
  typeof sel.ensureRegionScriptLoaded === "function",
);
check(
  "no manifest → resolveManifestKey null",
  sel.resolveManifestKey("us_east_1") === null,
);

process.exit(failures ? 1 : 0);

// Exercises the browser-only lazy-load path with a simulated <script> loader:
// document.head.appendChild reads script.src from the repo and executes it in
// the same VM context, then fires onload (onerror if the file is missing).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const requestedSrcs = [];

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
  createElement: (tag) => ({ tag }),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { appendChild: () => {}, removeChild: () => {} },
  head: {
    appendChild(script) {
      requestedSrcs.push(script.src);
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
};
const ctx = vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}

// Manifests + code only — NO region files preloaded
for (const p of ["aws", "azure", "gcp"]) load(`js/${p}/${p}-data.js`);
for (const f of [
  "js/base/rule-engine.js",
  "js/base/base-instance-selector.js",
  "js/aws/aws-instance-selector.js",
  "js/azure/azure-instance-selector.js",
  "js/gcp/gcp-instance-selector.js",
  "js/base/instance-selector-factory.js",
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

(async () => {
  console.log("[manifest keys]");
  const aws = ctx.InstanceSelectorFactory.createSelector("aws");
  const azure = ctx.InstanceSelectorFactory.createSelector("azure");
  const gcp = ctx.InstanceSelectorFactory.createSelector("gcp");
  console.log(
    `  counts: aws=${aws.getAllAvailableRegionKeys().length}, azure=${azure.getAllAvailableRegionKeys().length}, gcp=${gcp.getAllAvailableRegionKeys().length}`,
  );
  check("aws manifest keys usable", aws.getAllAvailableRegionKeys().length > 0);
  check(
    "azure returns display names",
    azure.getAllAvailableRegionKeys().includes("East US"),
  );
  check(
    "gcp returns dash keys",
    gcp.getAllAvailableRegionKeys().includes("us-central1"),
  );

  console.log("[lazy inject: known regions]");
  check("us_east_1 not on window before load", ctx.us_east_1 === undefined);
  await aws.loadInstanceData(new Set(["us-east-1"]));
  check("aws us-east-1 injected", typeof ctx.us_east_1 === "object");
  check(
    "aws instances parsed",
    (aws.instanceData["us-east-1"] || []).length > 100,
    `got ${(aws.instanceData["us-east-1"] || []).length}`,
  );
  check("aws region marked loaded", aws.loadedRegions.has("aws-us-east-1"));

  await azure.loadInstanceData(new Set(["East US"]));
  check("azure East US → eastus injected", typeof ctx.eastus === "object");
  check(
    "azure instances parsed",
    (azure.instanceData["East US"] || []).length > 100,
  );

  await gcp.loadInstanceData(new Set(["us-central1-a"]));
  check(
    "gcp zone suffix stripped → us_central1",
    typeof ctx.us_central1 === "object",
  );
  check(
    "gcp instances parsed",
    (gcp.instanceData["us-central1-a"] || []).length > 50,
  );

  console.log("[unknown region → fallback, no 404]");
  const before = requestedSrcs.length;
  await aws.loadRegionData("xx-fake-9");
  check(
    "no script request for unknown region",
    requestedSrcs.length === before,
    `requested: ${requestedSrcs.slice(before).join(", ")}`,
  );
  check(
    "fallback data parsed",
    (aws.instanceData["xx-fake-9"] || []).length > 0,
  );
  check("fallback NOT marked loaded", !aws.loadedRegions.has("aws-xx-fake-9"));

  console.log("[dedupe]");
  const aws2 = ctx.InstanceSelectorFactory.createSelector("aws");
  const beforeDedupe = requestedSrcs.length;
  await Promise.all([
    aws2._injectRegionScript("us_west_2"),
    aws2._injectRegionScript("us_west_2"),
    aws._injectRegionScript("us_west_2"),
  ]);
  const newReqs = requestedSrcs.slice(beforeDedupe);
  check(
    "3 concurrent requests → 1 script tag",
    newReqs.length === 1,
    `got ${newReqs.length}`,
  );

  console.log("[requested srcs] " + requestedSrcs.join(", "));
  console.log("[freshness] AWS_DATA_DATE=" + ctx.AWS_DATA_DATE);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

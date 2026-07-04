// Step 2 verification: region validation panel + fuzzy lazy-load path.
// Loads main-script.js with a minimal DOM stub and drives parseCSV directly.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const requestedSrcs = [];
const elements = {};

function fakeElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      innerHTML: "",
      className: "",
      textContent: "",
      style: { cssText: "", opacity: "" },
      classes: new Set(["hidden"]),
      classList: {
        add: (c) => elements[id].classes.add(c),
        remove: (c) => elements[id].classes.delete(c),
        toggle: (c) =>
          elements[id].classes.has(c)
            ? elements[id].classes.delete(c)
            : elements[id].classes.add(c),
        contains: (c) => elements[id].classes.has(c),
      },
      addEventListener: () => {},
      appendChild: () => {},
      remove: () => {},
      querySelectorAll: () => [],
      checked: false,
      value: "",
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
  getElementById: (id) => fakeElement(id),
  querySelectorAll: (sel) =>
    sel === "script[src]"
      ? [
          { src: "js/aws/aws-data.js" },
          { src: "js/azure/azure-data.js" },
          { src: "js/gcp/gcp-data.js" },
        ]
      : [],
  addEventListener: () => {},
  head: {
    appendChild(script) {
      if (script.tag !== "script") return;
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
  body: { appendChild: () => {}, removeChild: () => {} },
};
const ctx = vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}

for (const p of ["aws", "azure", "gcp"]) load(`js/${p}/${p}-data.js`);
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

(async () => {
  // Mixed CSV: valid, AZ-suffix typo, garbage; valid Azure display name; GCP zone
  const csv = `VM Name,CPU Count,Memory (GB),AWS Region,Azure Region,GCP Region
a,4,16,us-east-1,East US,us-central1-a
b,2,8,us-east-1a,East US 2,europe-west1-c
c,2,4,narnia-99,Atlantis,mordor1-x`;

  vm.runInContext("parseCSV(" + JSON.stringify(csv) + ")", ctx);

  console.log("[window._regionValidation]");
  const v = ctx._regionValidation;
  check("validation stored", v && v.aws && v.azure && v.gcp);
  check("aws us-east-1 exact", v.aws["us-east-1"].status === "exact");
  check(
    "aws us-east-1a fuzzy → us_east_1",
    v.aws["us-east-1a"].status === "fuzzy" &&
      v.aws["us-east-1a"].key === "us_east_1",
    JSON.stringify(v.aws["us-east-1a"]),
  );
  check("aws narnia-99 unknown", v.aws["narnia-99"].status === "unknown");
  check("azure East US exact", v.azure["East US"].status === "exact");
  check("azure East US 2 exact", v.azure["East US 2"].status === "exact");
  check("azure Atlantis unknown", v.azure["Atlantis"].status === "unknown");
  check("gcp zone exact", v.gcp["us-central1-a"].status === "exact");
  check("gcp europe-west1-c exact", v.gcp["europe-west1-c"].status === "exact");
  check("gcp mordor1-x unknown", v.gcp["mordor1-x"].status === "unknown");

  console.log("[panel rendering]");
  const panel = elements["regionValidationSection"];
  check("panel visible", panel && !panel.classes.has("hidden"));
  check("panel has exact chip", panel.innerHTML.includes("us-east-1 ✓"));
  check(
    "panel has fuzzy chip",
    panel.innerHTML.includes("us-east-1a → us-east-1"),
    panel.innerHTML.slice(0, 300),
  );
  check("panel has unknown chip", panel.innerHTML.includes("narnia-99 ✗"));
  check(
    "panel warns about sample data",
    panel.innerHTML.includes("sample data"),
  );
  check(
    "unknown count is 3",
    /3 region name\(s\) not recognized/.test(panel.innerHTML),
  );

  // Poll for the fire-and-forget prefetch instead of a fixed sleep (CI-safe)
  const expectedSrcs = [
    "js/aws/regions/us_east_1.js",
    "js/azure/regions/eastus.js",
    "js/gcp/regions/us_central1.js",
  ];
  const deadline = Date.now() + 2000;
  while (
    Date.now() < deadline &&
    !expectedSrcs.every((s) => requestedSrcs.includes(s))
  ) {
    await new Promise((r) => setTimeout(r, 25));
  }
  console.log("[prefetch] requested: " + requestedSrcs.join(", "));
  check(
    "prefetch loaded valid + fuzzy regions only",
    requestedSrcs.includes("js/aws/regions/us_east_1.js") &&
      requestedSrcs.includes("js/azure/regions/eastus.js") &&
      requestedSrcs.includes("js/gcp/regions/us_central1.js"),
  );
  check(
    "no request for unknown regions",
    !requestedSrcs.some((s) => /narnia|atlantis|mordor/i.test(s)),
  );

  console.log("[fuzzy lazy-load truthfulness]");
  const aws = ctx.InstanceSelectorFactory.createSelector("aws");
  await aws.loadRegionData("us-east-1a");
  const rows = aws.instanceData["us-east-1a"] || [];
  check(
    "us-east-1a got REAL us-east-1 data (not sample)",
    rows.length > 100,
    `got ${rows.length} instances`,
  );

  // Re-upload with all-valid regions replaces the panel without warning
  const csv2 = `VM Name,CPU Count,Memory (GB),AWS Region
d,4,16,us-west-2`;
  vm.runInContext("parseCSV(" + JSON.stringify(csv2) + ")", ctx);
  console.log("[re-upload]");
  check("panel still visible", !panel.classes.has("hidden"));
  check("old chips replaced", !panel.innerHTML.includes("narnia-99"));
  check(
    "no warning when all valid",
    !panel.innerHTML.includes("not recognized"),
  );
  check("validation replaced", !ctx._regionValidation.azure);

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

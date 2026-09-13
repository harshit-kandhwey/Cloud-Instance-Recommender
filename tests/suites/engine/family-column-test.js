// The per-provider "Family" column: the family category ("General purpose",
// "Compute optimized", ...) of the instance each row landed on.
//
// The column is written straight from the region data's own family-name field,
// never parsed back out of the instance name. That is not a stylistic
// preference — Azure's family is genuinely NOT a function of its instance name:
// `b2ms` → `bs` and `b1ls` → `bs` drop the size letter, but `d16lsv6` → `dlsv6`
// keeps it, and `d15iv2` → `dv2` drops an `i` — no name-based rule reliably
// reproduces Azure's family field, so it is read from the data instead of parsed.
//
// So these checks pin the column to the DATA, exhaustively, for every row of a
// real run: the value must equal the family name the region file itself carries
// for the exact instance that was recommended.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

// The factory is pure and DOM-free, so the run needs no simulated document.
function makeContext() {
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
  };
  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}
const load = (ctx, rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });

const CODE_FILES = [
  "src/core/rules/rule-engine.js",
  "src/core/engine/base-instance-selector.js",
  "src/providers/aws/aws-instance-selector.js",
  "src/providers/azure/azure-instance-selector.js",
  "src/providers/gcp/gcp-instance-selector.js",
  "src/core/engine/instance-selector-factory.js",
  "src/shared/app-core.js",
];

// Only the regions these rows name — loading all 141 would make the suite slow
// for no added coverage.
const REGIONS = [
  ["aws", "us_east_1"],
  ["azure", "eastus"],
  ["gcp", "us_central1"],
];

function buildRun() {
  const ctx = makeContext();
  for (const p of ["aws", "azure", "gcp"])
    load(ctx, `src/providers/${p}/${p}-data.js`);
  for (const [p, key] of REGIONS)
    load(ctx, `src/providers/${p}/regions/${key}.js`);
  for (const f of CODE_FILES) load(ctx, f);
  return ctx;
}

// The family-name field each provider's region data uses. This is the mapping
// the selectors already normalise through `createStandardizedInstance`.
const FAMILY_NAME_FIELD = {
  AWS: "instanceFamilyName",
  AZURE: "familyName",
  GCP: "seriesName",
};
const REGION_GLOBAL = { AWS: "us_east_1", AZURE: "eastus", GCP: "us_central1" };

// Rows with deliberately different CPU:RAM ratios, so the run lands on more than
// one category — a fixture where every row is "General purpose" could not tell a
// correctly-wired column from one hard-coded to the commonest value.
const ROWS = [
  {
    "VM Name": "balanced",
    "CPU Count": "4",
    "Memory (GB)": "16",
    "CPU Utilization": "45",
    "Memory Utilization": "60",
    "AWS Region": "us-east-1",
    "Azure Region": "East US",
    "GCP Region": "us-central1-a",
  },
  {
    "VM Name": "memory-heavy",
    "CPU Count": "4",
    "Memory (GB)": "64",
    "CPU Utilization": "40",
    "Memory Utilization": "70",
    "AWS Region": "us-east-1",
    "Azure Region": "East US",
    "GCP Region": "us-central1-a",
  },
  {
    "VM Name": "cpu-heavy",
    "CPU Count": "16",
    "Memory (GB)": "8",
    "CPU Utilization": "80",
    "Memory Utilization": "30",
    "AWS Region": "us-east-1",
    "Azure Region": "East US",
    "GCP Region": "us-central1-a",
  },
];

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

(async () => {
  const ctx = buildRun();
  const results = await ctx.getInstanceRecommendationWithSelector(
    ROWS,
    ["aws", "azure", "gcp"],
    OPTIONS,
  );

  console.log("[every Family cell is the region data's own answer]");
  {
    // The invariant, checked against the data for every row and every provider:
    // look the recommended instance back up in the shipped data and compare.
    //
    // The lookup must merge the two halves exactly as the loader does. The family
    // name is a SPEC and lives in the manifest, so reading the region global alone
    // would compare the engine's correct answer against undefined and report every
    // cell as wrong — the test breaking, not the product.
    // Read off `window` as a property, not a bare identifier: a bare name that
    // isn't assigned in the context throws ReferenceError and unwinds this whole
    // block with a stack trace instead of a named check failure — the "test
    // breaking, not the product" comment above applies here too, one level deeper.
    const specsOf = (provider) =>
      (vm.runInContext(`window["${provider.toUpperCase()}_SPECS"]`, ctx) || {})
        .compute || {};
    let checked = 0;
    const mismatches = [];
    const seenCategories = new Set();

    for (const row of results) {
      for (const provider of Object.keys(FAMILY_NAME_FIELD)) {
        for (const kind of ["Like-to-Like", "Optimized"]) {
          const instance = row[`${provider} ${kind} Instance`];
          const family = row[`${provider} ${kind} Family`];
          if (ctx.isNoMatchValue(instance)) continue;

          const regionData = vm.runInContext(REGION_GLOBAL[provider], ctx);
          if (!regionData[instance]) {
            mismatches.push(`${instance} is not in the region data at all`);
            continue;
          }
          const details = {
            ...specsOf(provider)[instance],
            ...regionData[instance],
          };
          const truth = details[FAMILY_NAME_FIELD[provider]];
          checked++;
          seenCategories.add(family);
          if (family !== truth) {
            mismatches.push(
              `${row["VM Name"]} ${provider} ${kind}: ${instance} → column "${family}" but data says "${truth}"`,
            );
          }
        }
      }
    }

    check("the run produced Family cells to check", checked > 0, `${checked}`);
    check(
      "every Family cell matches the region data for that exact instance",
      mismatches.length === 0,
      mismatches.slice(0, 3).join(" ; "),
    );
    // A fixture landing on one category everywhere could not distinguish a wired
    // column from a hard-coded one.
    check(
      "and the rows span more than one category, so the check can discriminate",
      seenCategories.size > 1,
      `saw: ${[...seenCategories].join(", ")}`,
    );
  }

  console.log("[the column never leaks undefined, on any path]");
  {
    // createEmptyResult() has no instance to name a family for. It declares
    // familyName itself, so the factory writes a real value through; without
    // that, the CSV would carry the string "undefined".
    const ctx2 = buildRun();
    const noMatch = await ctx2.getInstanceRecommendationWithSelector(
      [
        {
          "VM Name": "impossible",
          "CPU Count": "99999",
          "Memory (GB)": "99999",
          "CPU Utilization": "50",
          "Memory Utilization": "50",
          "AWS Region": "us-east-1",
          "Azure Region": "East US",
          "GCP Region": "us-central1-a",
        },
        {
          "VM Name": "no-region",
          "CPU Count": "4",
          "Memory (GB)": "16",
          "CPU Utilization": "50",
          "Memory Utilization": "50",
          "AWS Region": "",
          "Azure Region": "",
          "GCP Region": "",
        },
      ],
      ["aws", "azure", "gcp"],
      OPTIONS,
    );

    const famCells = noMatch.flatMap((row) =>
      Object.entries(row)
        .filter(([k]) => / Family$/.test(k))
        .map(([k, v]) => `${row["VM Name"]}.${k}=${v}`),
    );
    check(
      "unmatched rows still carry every Family column",
      famCells.length === 12,
      `${famCells.length} cells (expected 12: 2 rows × 3 providers × 2 kinds)`,
    );
    check(
      "and no cell is undefined",
      !famCells.some((c) => /=undefined$/.test(c)),
      famCells.filter((c) => /=undefined$/.test(c)).join(" ; "),
    );
  }

  console.log("[the new column does not disturb no-match detection]");
  {
    // getInstanceColumns() matches on a SUBSTRING of the column name. "AWS
    // Optimized Family" must not be mistaken for a recommendation column — if it
    // were, a matched row would look unmatched (its Family cell is not an
    // instance name), and the red highlight, the no-match view and the no-match
    // export would all disagree with the stats bar.
    const instanceCols = ctx.getInstanceColumns(results);
    const familyCols = Object.keys(results[0]).filter((k) =>
      / Family$/.test(k),
    );
    check(
      "the run really does have Family columns",
      familyCols.length === 6,
      familyCols.join(", "),
    );
    check(
      "no Family column is counted as a recommendation column",
      !instanceCols.some((c) => / Family$/.test(c)),
      instanceCols.filter((c) => / Family$/.test(c)).join(", "),
    );
    check(
      "so a fully-matched row is still read as matched",
      results.every((row) => !ctx.rowIsAllNoMatch(row, instanceCols)),
      "a matched row was reported as all-no-match",
    );
    // computeSizingSavings derives its provider list from the column names too.
    const providers = Object.keys(results[0])
      .filter((k) => k.endsWith(" Optimized Instance"))
      .map((k) => k.replace(" Optimized Instance", ""));
    check(
      "and the provider list is still exactly the three providers",
      providers.join(",") === "AWS,AZURE,GCP",
      providers.join(","),
    );
  }

  console.log("[the Family column sits with the instance it describes]");
  {
    const keys = Object.keys(results[0]);
    const misplaced = [];
    for (const provider of ["AWS", "AZURE", "GCP"]) {
      for (const kind of ["Like-to-Like", "Optimized"]) {
        const i = keys.indexOf(`${provider} ${kind} Instance`);
        const f = keys.indexOf(`${provider} ${kind} Family`);
        if (f !== i + 1) {
          misplaced.push(`${provider} ${kind}: Instance@${i}, Family@${f}`);
        }
      }
    }
    check(
      "each Family column follows its own Instance column",
      misplaced.length === 0,
      misplaced.join(" ; "),
    );
  }

  console.log("[the dead family regexes are gone, not merely unused]");
  {
    // Dead code left for a future reader to trust is worse than none — one of
    // these definitions was also silently broken (Azure's key shape never
    // matched a real record), so removal closes both problems at once.
    const files = [
      "src/core/engine/base-instance-selector.js",
      "src/providers/aws/aws-instance-selector.js",
      "src/providers/azure/azure-instance-selector.js",
      "src/providers/gcp/gcp-instance-selector.js",
    ];
    const survivors = files.filter((f) =>
      /getInstanceFamily/.test(fs.readFileSync(path.join(REPO, f), "utf8")),
    );
    check(
      "no getInstanceFamily definition or caller remains",
      survivors.length === 0,
      survivors.join(", "),
    );
  }

  console.log(
    "[Azure VM Family filter matches both v1/v2 and v3+ naming for *S families]",
  );
  {
    const ctx = buildRun();
    const matches = (type, filter) =>
      vm.runInContext(
        `azureMatchesVmFamily(${JSON.stringify(type)}, ${JSON.stringify(filter)})`,
        ctx,
      );
    // Found by CodeRabbit round 1: a plain prefix test never matched v3+ names
    // (Standard_D2s_v3), since the "s" moved after the vCPU count. Found by
    // CodeRabbit round 2: the FIX then broke v1/v2 names (Standard_DS1_v2),
    // which embed the "S" directly in the family letters instead.
    check(
      "Standard_DS matches the v1/v2 embedded-S name Standard_DS1_v2",
      matches("Standard_DS1_v2", "Standard_DS") === true,
    );
    check(
      "Standard_DS matches the v3+ suffix-flag name Standard_D2s_v3",
      matches("Standard_D2s_v3", "Standard_DS") === true,
    );
    check(
      "Standard_D does NOT match a storage-flagged v1/v2 name",
      matches("Standard_D1_v2", "Standard_DS") === false,
    );
    check(
      "Standard_D does NOT match a storage-flagged v3+ name",
      matches("Standard_D2_v3", "Standard_DS") === false,
    );
    check(
      "Standard_D still matches its own plain v3+ name",
      matches("Standard_D2_v3", "Standard_D") === true,
    );
    check(
      "Standard_B (no S-variant in the family list) matches Standard_B2ms",
      matches("Standard_B2ms", "Standard_B") === true,
    );
  }

  console.log(
    "[GCP family description lookup survives the family's real casing]",
  );
  {
    const ctx = buildRun();
    load(ctx, "src/providers/gcp/gcp-specific.js");
    // Found by CodeRabbit: the wrapper lowercased its argument before looking
    // it up in a map keyed by UPPERCASE names, so every call fell through to
    // the generic fallback text regardless of family.
    const e2 = vm.runInContext(`getGCPFamilyDescription("E2")`, ctx);
    const fallback = vm.runInContext(
      `getGCPFamilyDescription("not-a-real-family")`,
      ctx,
    );
    check(
      "a real family name resolves to its own description, not the fallback",
      typeof e2 === "string" && e2 !== fallback,
      e2,
    );
    check(
      "an unrecognised family still falls back cleanly (no throw)",
      typeof fallback === "string" && fallback.length > 0,
      fallback,
    );
  }

  console.log(
    "[AWS Graviton/Nitro flags delegate to RuleEngine.isFlagTrue's wider value set]",
  );
  {
    const ctx = buildRun();
    vm.runInContext(`__aws = new AWSInstanceSelector();`, ctx);
    // Found by CodeRabbit: the local literal test accepted 1/"1.0"/true but not
    // the string "1" that RuleEngine.isFlagTrue itself already treats as true —
    // a second, narrower copy of the same parsing.
    check(
      'isGravitonInstance now accepts the string "1", not just 1/"1.0"',
      vm.runInContext(`__aws.isGravitonInstance({ isGraviton: "1" })`, ctx) ===
        true,
    );
    check(
      "isGravitonInstance still rejects a falsy value",
      vm.runInContext(`__aws.isGravitonInstance({ isGraviton: 0 })`, ctx) ===
        false,
    );
    const result = vm.runInContext(
      `__aws.createInstanceResult({ nitroSupport: "1", processor: "AWS", price: 0.1, vCpus: 2, memory: 4, instanceType: "m5.large", family: "m5", familyName: "General purpose", generation: 1 }, 2, 4)`,
      ctx,
    );
    check(
      'nitroSupport on the result also accepts the string "1"',
      result.nitroSupport === true,
      JSON.stringify(result.nitroSupport),
    );
  }

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

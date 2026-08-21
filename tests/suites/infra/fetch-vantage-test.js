// fetch-vantage suite: pins tools/fetch-vantage.js's pure builder against recorded
// Vantage fixtures — field derivations, region filtering, Azure generation carry-
// forward, and split-data.js format compatibility. No network runs here.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, makeChecker } = require("../harness");
const {
  buildMonolith,
  gcpPlatform,
  azureRegionKey,
  awsProcessor,
} = require("../../../tools/fetch-vantage");

const { check, state } = makeChecker();

const fixture = (f) =>
  JSON.parse(
    fs.readFileSync(path.join(REPO, "tests", "fixtures", "vantage", f), "utf8"),
  );

// Run a generated monolith in a fresh sandbox and return the window globals it set.
function runMonolith(monolith) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(monolith, sandbox, { filename: "monolith.js" });
  return sandbox;
}

// Replicate split-data.js's parse to prove the monolith is compatible: region-block
// count must equal the makeXRegionsGlobal key-list count, and each block compiles.
function splitDataParity(monolith) {
  const lines = monolith.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (current === null) {
      const m = line.match(/^const ([A-Za-z_][A-Za-z0-9_]*) = \{$/);
      if (m) current = m[1];
    } else if (line === "};") {
      blocks.push(current);
      current = null;
    }
  }
  const call = monolith.match(/make\w*RegionsGlobal\(\{([\s\S]*?)\}\)/);
  const declared = call
    ? call[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return { blocks, declared };
}

// ── AWS ───────────────────────────────────────────────────────────────────────
{
  const awsShipped = ["us_east_1", "eu_west_1"]; // us_mars_1 (synthetic) omitted
  const { monolith, regionKeys, instanceCount } = buildMonolith({
    name: "aws",
    prefix: "AWS",
    source: "instances.vantage.sh",
    instances: fixture("ec2.json"),
    shippedKeys: awsShipped,
    dataDate: "2026-08-21",
  });
  const g = runMonolith(monolith);

  check("[aws] DATA_DATE stamped", g.AWS_DATA_DATE === "2026-08-21");
  check("[aws] DATA_READY set by make call", g.AWS_DATA_READY === true);
  check(
    "[aws] only shipped regions emitted",
    regionKeys.join(",") === "eu_west_1,us_east_1",
    regionKeys.join(","),
  );
  check("[aws] unshipped slug us_mars_1 dropped", g.us_mars_1 === undefined);

  const m5 = g.us_east_1["m5.large"];
  check(
    "[aws] m5.large mapped correctly",
    m5.instanceFamily === "m5" &&
      m5.instanceFamilyName === "General purpose" &&
      m5.isGraviton === 0 &&
      m5.currentGeneration === 1 &&
      m5.processorManufacturer === "Intel" &&
      m5.vCpus === 2 &&
      m5.memorySizeInGiB === 8 &&
      m5.nitroEnclavesSupport === 0 &&
      m5.onDemandLinuxHr === 0.096 &&
      m5.onDemandWindowsHr === 0.188,
    JSON.stringify(m5),
  );
  check(
    "[aws] graviton c6g → isGraviton 1, processor AWS",
    g.us_east_1["c6g.medium"].isGraviton === 1 &&
      g.us_east_1["c6g.medium"].processorManufacturer === "AWS",
  );
  check(
    "[aws] AMD m5a → processor AMD",
    g.us_east_1["m5a.large"].processorManufacturer === "AMD",
  );
  check(
    "[aws] previous-gen c1.medium → currentGeneration 0",
    g.us_east_1["c1.medium"].currentGeneration === 0,
  );
  check("[aws] instanceCount = 4 types × 2 regions = 8", instanceCount === 8);

  const parity = splitDataParity(monolith);
  check(
    "[aws] split-data parity: block count == make-call keys",
    parity.blocks.length === parity.declared.length &&
      parity.blocks.length === 2,
    `blocks ${parity.blocks.length} vs declared ${parity.declared.length}`,
  );
}

// ── Azure ─────────────────────────────────────────────────────────────────────
{
  const azureShipped = ["eastus", "westeurope"]; // marscentral (synthetic) omitted
  // byType carries d4sv5/a0/e8asv5; d4psv5 omitted from byType to exercise the
  // byFamily fallback (family dpsv5).
  const azureGen = {
    byType: { d4sv5: 1, a0: 0, e8asv5: 1 },
    byFamily: { dpsv5: 1 },
  };
  const { monolith, regionKeys } = buildMonolith({
    name: "azure",
    prefix: "AZURE",
    source: "instances.vantage.sh/azure",
    instances: fixture("azure.json"),
    shippedKeys: azureShipped,
    dataDate: "2026-08-21",
    azureGen,
  });
  const g = runMonolith(monolith);

  check(
    "[azure] region display names normalised to shipped keys",
    regionKeys.join(",") === "eastus,westeurope",
    regionKeys.join(","),
  );
  check(
    "[azure] unshipped 'Mars Central' dropped",
    g.marscentral === undefined,
  );

  const d4 = g.eastus.d4sv5;
  check(
    "[azure] d4sv5 mapped (Intel, gen carried from byType)",
    d4.family === "dsv5" &&
      d4.familyName === "General purpose" &&
      d4.isARM === 0 &&
      d4.generation === 1 &&
      d4.processorArchitecture === "Intel" &&
      d4.vCpus === 4 &&
      d4.memoryGiB === 16 &&
      d4.linuxPrice === 0.192 &&
      d4.windowsPrice === 0.376,
    JSON.stringify(d4),
  );
  check(
    "[azure] ARM d4psv5 → isARM 1, processorArchitecture ARM, gen via byFamily",
    g.eastus.d4psv5.isARM === 1 &&
      g.eastus.d4psv5.processorArchitecture === "ARM" &&
      g.eastus.d4psv5.generation === 1,
    JSON.stringify(g.eastus.d4psv5),
  );
  check(
    "[azure] legacy a0 → generation 0 carried",
    g.eastus.a0.generation === 0,
  );
  check(
    "[azure] AMD family e8asv5 labelled Intel (matches shipped convention)",
    g.eastus.e8asv5.processorArchitecture === "Intel",
  );
}

// ── GCP ───────────────────────────────────────────────────────────────────────
{
  const gcpShipped = ["us_central1", "europe_west1"]; // mars_central1 omitted
  const { monolith, regionKeys } = buildMonolith({
    name: "gcp",
    prefix: "GCP",
    source: "instances.vantage.sh/gcp",
    instances: fixture("gcp.json"),
    shippedKeys: gcpShipped,
    dataDate: "2026-08-21",
  });
  const g = runMonolith(monolith);

  check("[gcp] unshipped mars_central1 dropped", g.mars_central1 === undefined);
  check(
    "[gcp] shipped regions emitted",
    regionKeys.includes("us_central1"),
    regionKeys.join(","),
  );

  const n2 = g.us_central1["n2-standard-4"];
  check(
    "[gcp] n2-standard-4 mapped (Intel)",
    n2.series === "n2" &&
      n2.seriesName === "General purpose" &&
      n2.generation === 1 &&
      n2.vCpus === 4 &&
      n2.memoryGiB === 16 &&
      n2.cpuPlatform === "Intel" &&
      n2.isARM === 0,
    JSON.stringify(n2),
  );
  check(
    "[gcp] price float-noise stripped (0.19423600000000002 → 0.194236)",
    n2.hourlyPrice === 0.194236,
    String(n2.hourlyPrice),
  );
  check(
    "[gcp] AMD n2d → cpuPlatform AMD",
    g.us_central1["n2d-standard-4"].cpuPlatform === "AMD",
  );
  check(
    "[gcp] ARM t2a → cpuPlatform ARM, isARM 1",
    g.us_central1["t2a-standard-4"].cpuPlatform === "ARM" &&
      g.us_central1["t2a-standard-4"].isARM === 1,
  );
}

// ── Exported derivation helpers ────────────────────────────────────────────────
{
  check(
    "awsProcessor buckets",
    awsProcessor("AWS Graviton3 Processor") === "AWS" &&
      awsProcessor("AMD EPYC 7571") === "AMD" &&
      awsProcessor("Intel Xeon Platinum 8175") === "Intel" &&
      awsProcessor("Variable") === "Intel",
  );
  check(
    "gcpPlatform table",
    gcpPlatform("t2a").isARM === 1 &&
      gcpPlatform("n2d").cpuPlatform === "AMD" &&
      gcpPlatform("n2").cpuPlatform === "Intel" &&
      gcpPlatform("zzz").cpuPlatform === "Intel",
  );
  check(
    "azureRegionKey normalises display names",
    azureRegionKey("East US") === "eastus" &&
      azureRegionKey("Australia Central 2") === "australiacentral2",
  );
}

if (state.failures) {
  console.error(`\nfetch-vantage: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nfetch-vantage: all checks passed");
  process.exitCode = 0;
}

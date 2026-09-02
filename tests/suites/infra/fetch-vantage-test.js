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
  isMappedGcpSeries,
  azureRegionKey,
  awsProcessor,
  azureProcessor,
  unmappedAzureAmdFamilies,
  AZURE_AMD_FAMILIES,
  mostCommonGeneration,
} = require("../../../tools/fetch-vantage");
const { loadCommittedRegions } = require("../../../tools/lib/util");

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
  // Guard (plant-RED: return isARM ? "ARM" : "Intel" again): Azure's feed carries no
  // CPU vendor, so every AMD VM used to ship labelled Intel — 356 of 1257 types. The
  // vendor now comes from a table keyed on the family.
  check(
    "[azure] AMD family e8asv5 is labelled AMD, not Intel",
    g.eastus.e8asv5.processorArchitecture === "AMD" &&
      g.eastus.e8asv5.isARM === 0,
    JSON.stringify(g.eastus.e8asv5),
  );
  check(
    "[azure] Intel dsv5 and Arm dpsv5 are unchanged by the vendor table",
    g.eastus.d4sv5.processorArchitecture === "Intel" &&
      g.eastus.d4psv5.processorArchitecture === "ARM",
  );
  // Guard (plant-RED: classify on a bare /a/ substring): the legacy A-series is not
  // AMD. A substring rule labels it AMD and is wrong for every one of these.
  check(
    "[azure] legacy A-series a0 stays Intel",
    g.eastus.a0.processorArchitecture === "Intel",
    JSON.stringify(g.eastus.a0),
  );
}

// ── Azure vendor table: the pure classifier and its tripwire ────────────────────
{
  check(
    "azureProcessor: Arm wins, table decides the rest",
    azureProcessor("dpsv6", 1) === "ARM" &&
      azureProcessor("easv5", 0) === "AMD" &&
      azureProcessor("dsv5", 0) === "Intel",
  );

  // Every family the shipped data carries whose name marks it AMD must be classified,
  // or it silently ships as Intel — the failure this whole table exists to end.
  for (const fam of [
    "dasv5",
    "eadsv7",
    "fasv7",
    "lasv3",
    "basv2",
    "ncast4v3",
  ]) {
    check(`AZURE_AMD_FAMILIES carries ${fam}`, AZURE_AMD_FAMILIES.has(fam));
  }
  // Verified Intel despite sitting in the GPU block: the "a" in a GPU family can
  // belong to the accelerator (ND H100 v5 is Intel), which is why this is a table.
  check(
    "AZURE_AMD_FAMILIES does not sweep in the Intel GPU families",
    !AZURE_AMD_FAMILIES.has("ndsrh200v5") && !AZURE_AMD_FAMILIES.has("ndsrv5"),
  );

  // Guard (plant-RED: drop the !/^a/ anchor): the tripwire reports an AMD-named
  // family the table has not classified, and must never report the A-series.
  const flagged = unmappedAzureAmdFamilies([
    "dasv5", // classified → not reported
    "dsv5", // not AMD-named → not reported
    "a", // legacy A-series → never reported
    "av2",
    "masv9", // AMD-named, unclassified → reported
  ]);
  check(
    "the tripwire reports only AMD-named families absent from the table",
    flagged.join(",") === "masv9",
    flagged.join(",") || "none",
  );
}

// ── GCP ───────────────────────────────────────────────────────────────────────
{
  const gcpShipped = ["us_central1", "europe_west1"]; // mars_central1 omitted
  // The fixture carries an invented q9z series, so this build also exercises the
  // unmapped-series report; capture stderr rather than let it litter the run.
  const written = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (s) => {
    written.push(String(s));
    return true;
  };
  let monolith, regionKeys;
  try {
    ({ monolith, regionKeys } = buildMonolith({
      name: "gcp",
      prefix: "GCP",
      source: "instances.vantage.sh/gcp",
      instances: fixture("gcp.json"),
      shippedKeys: gcpShipped,
      dataDate: "2026-08-21",
    }));
  } finally {
    process.stderr.write = realWrite;
  }
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
  // c4a is Axion Arm. It was absent from the series table, so it would have shipped
  // as Intel and read as x86 to every processor filter — the whole point of the fix.
  check(
    "[gcp] Axion c4a → cpuPlatform ARM, isARM 1 (not the Intel default)",
    g.us_central1["c4a-standard-4"].cpuPlatform === "ARM" &&
      g.us_central1["c4a-standard-4"].isARM === 1,
    JSON.stringify(g.us_central1["c4a-standard-4"]),
  );
  // An unmapped series still ships (on the Intel fallback) but must not do so quietly.
  check(
    "[gcp] an unmapped series is reported, naming the series and the tables to fix",
    written.some(
      (s) =>
        /no platform mapping/.test(s) &&
        /q9z/.test(s) &&
        /GCP_ARM_SERIES/.test(s),
    ),
    JSON.stringify(written),
  );
  check(
    "[gcp] the report names only the unmapped series, not the mapped ones",
    written.every((s) => !/\b(c4a|t2a|n2d|n2)\b/.test(s)),
    JSON.stringify(written),
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
  // Every Arm family Google ships, per its machine-family docs: Axion c4a/n4a,
  // Ampere Altra t2a, Grace a4x. Each defaulted to Intel before the series table
  // was completed, and an Arm box read as x86 is wrong in both directions — it
  // passes an x86-only filter and fails an Arm-only one.
  check(
    "every Arm GCP series maps to ARM (Axion c4a/n4a, Altra t2a, Grace a4x)",
    ["c4a", "n4a", "t2a", "a4x"].every(
      (s) => gcpPlatform(s).cpuPlatform === "ARM" && gcpPlatform(s).isARM === 1,
    ),
    JSON.stringify(
      ["c4a", "n4a", "t2a", "a4x"].map((s) => [s, gcpPlatform(s).cpuPlatform]),
    ),
  );
  // Guard (plant-RED: drop either from GCP_INTEL_SERIES): the network-optimized pair
  // is Intel Emerald Rapids. Asserted directly rather than through the shipped data,
  // which does not carry them until the refresh that introduced them lands — until
  // then the "every shipped series is mapped" check cannot see them.
  check(
    "network-optimized c4n/m4n map to Intel, and the n is not read as a vendor",
    ["c4n", "m4n"].every(
      (s) =>
        isMappedGcpSeries(s) &&
        gcpPlatform(s).cpuPlatform === "Intel" &&
        gcpPlatform(s).isARM === 0,
    ),
    JSON.stringify(
      ["c4n", "m4n"].map((s) => [
        s,
        gcpPlatform(s).cpuPlatform,
        isMappedGcpSeries(s),
      ]),
    ),
  );
  check(
    "every AMD GCP series maps to AMD (Turin c4d/n4d/h4d, Milan c2d, Genoa c3d, n2d, t2d)",
    ["c2d", "c3d", "c4d", "h4d", "n2d", "n4d", "t2d"].every(
      (s) => gcpPlatform(s).cpuPlatform === "AMD" && gcpPlatform(s).isARM === 0,
    ),
    JSON.stringify(
      ["c2d", "c3d", "c4d", "h4d", "n2d", "n4d", "t2d"].map((s) => [
        s,
        gcpPlatform(s).cpuPlatform,
      ]),
    ),
  );
  check(
    "isMappedGcpSeries knows the mapped families and flags an unseen one",
    ["c4a", "n4a", "a4x", "c4d", "h4d", "t2a", "n2", "z3", "m4"].every(
      isMappedGcpSeries,
    ) && !isMappedGcpSeries("q9z"),
  );
  // The shipped data is the list the mapping has to cover: any series already on
  // disk that the tables don't know would be riding the Intel fallback right now.
  {
    // Through the shared loader, not a private walk: `series` is a SPEC and lives in
    // the manifest, so reading the region files alone would collect nothing but
    // undefined and turn this check into noise about a field that was never there.
    const shipped = new Set();
    for (const region of Object.values(loadCommittedRegions("gcp")))
      for (const rec of Object.values(region)) shipped.add(rec.series);
    const unmapped = [...shipped].filter((s) => !isMappedGcpSeries(s)).sort();
    check(
      "every series in the shipped GCP data has a platform mapping",
      unmapped.length === 0,
      `unmapped: ${unmapped.join(", ") || "none"} (of ${shipped.size} shipped)`,
    );
  }
  check(
    "azureRegionKey normalises display names",
    azureRegionKey("East US") === "eastus" &&
      azureRegionKey("Australia Central 2") === "australiacentral2",
  );

  check(
    "mostCommonGeneration ties break to the higher generation",
    mostCommonGeneration({ 1: 1, 2: 1 }) === 2 &&
      mostCommonGeneration({ 1: 3, 2: 1 }) === 1,
    JSON.stringify([
      mostCommonGeneration({ 1: 1, 2: 1 }),
      mostCommonGeneration({ 1: 3, 2: 1 }),
    ]),
  );
}

// ── Record hygiene: missing spec skipped, missing Windows rate → 0 ──────────────
{
  // A record with a valid Linux price but no vCPU/memory must be dropped, never
  // emitted with a NaN spec (would ship "NaN" into the monolith).
  const noSpec = {
    instance_type: "x9.huge",
    family: "General purpose",
    vCPU: null,
    memory: 64,
    pricing: {
      "us-east-1": { linux: { ondemand: 0.5 }, mswin: { ondemand: 1 } },
    },
  };
  const withSpec = {
    instance_type: "m5.large",
    family: "General purpose",
    vCPU: 2,
    memory: 8,
    physical_processor: "Intel Xeon",
    // no mswin block → Windows rate must fall back to 0
    pricing: { "us-east-1": { linux: { ondemand: 0.096 } } },
  };
  const { monolith } = buildMonolith({
    name: "aws",
    prefix: "AWS",
    source: "instances.vantage.sh",
    instances: [noSpec, withSpec],
    shippedKeys: ["us_east_1"],
    dataDate: "2026-08-21",
  });
  const g = runMonolith(monolith);
  check(
    "[aws] missing-spec record dropped (no NaN shipped)",
    g.us_east_1["x9.huge"] === undefined && !/NaN|undefined/.test(monolith),
  );
  check(
    "[aws] missing Windows rate falls back to 0",
    g.us_east_1["m5.large"].onDemandWindowsHr === 0,
    JSON.stringify(g.us_east_1["m5.large"]),
  );

  // GCP uses the `windows` pricing key (not `mswin`); same fallback.
  const gcpNoWin = {
    instance_type: "n2-standard-2",
    family: "General purpose",
    vCPU: 2,
    memory: 8,
    pricing: { "us-central1": { linux: { ondemand: 0.1 } } },
  };
  const gcp = runMonolith(
    buildMonolith({
      name: "gcp",
      prefix: "GCP",
      source: "instances.vantage.sh/gcp",
      instances: [gcpNoWin],
      shippedKeys: ["us_central1"],
      dataDate: "2026-08-21",
    }).monolith,
  );
  check(
    "[gcp] missing Windows rate falls back to 0",
    gcp.us_central1["n2-standard-2"].windowsHourlyPrice === 0,
  );
}

// ── Shipped region data comes from the shared loader, never a private walk ────
// Structural, because the failure is structural AND silent. Specs live in the
// manifest now; a private readdirSync over regions/ returns the PRICE half only, so
// collectAzureGeneration would find no numeric `generation` on any record and
// silently carry forward nothing — losing the one field the feed cannot reproduce. Nothing throws, nothing is
// empty, and the loss reads as a data change rather than as a bug. recommendation-diff
// already carries this pin — it is here because the twin is what went missing last time.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "tools", "fetch-vantage.js"),
    "utf8",
  );
  // Strip line comments before looking: the prose above collectAzureGeneration says
  // the word readdirSync, and a check that reads comments is a check that reports on
  // documentation. Match the CALL.
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  check(
    "fetch-vantage reads shipped region data through loadCommittedRegions",
    code.includes("loadCommittedRegions") && !/readdirSync\s*\(/.test(code),
    /readdirSync\s*\(/.test(code) ? "has its own readdirSync" : "shared",
  );
}

if (state.failures) {
  console.error(`\nfetch-vantage: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nfetch-vantage: all checks passed");
  process.exitCode = 0;
}

// tools/split-data.js — the writer for the two-part shipped format.
//
// Nothing exercised this tool before: the committed repo holds only its OUTPUT
// (a manifest plus regions/) and the monolithic input is a transient file that
// lives in the gitignored .refresh-cache/ and is never committed — so
// data-integrity-test pins the artifacts and had no way to pin the thing that
// writes them. This suite builds a real monolith in a temp root and runs the
// actual splitProvider over it.
//
// What matters most here is that the split is LOSSLESS. The old format could only
// lose a whole region block, which left unbalanced braces and failed to compile.
// The two-part format can lose a single field, which compiles perfectly and
// ships — so the tool verifies its own round trip before writing, and the checks
// below drive that verification off its happy path deliberately.
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { makeChecker } = require("../harness");
const {
  splitProvider,
  verifyRoundTrip,
  SERVICE,
} = require("../../../tools/split-data");
const {
  specFields,
  priceFields,
  monolithPath,
} = require("../../../tools/lib/util");

const { check, state } = makeChecker();

// A monolith in exactly the shape fetch-vantage's serializeMonolith emits: a
// header comment, the date, a self-contained assign helper, one `const <key> = {}`
// per region, and the make{P}RegionsGlobal call that names them.
//
// The option flags exist to reach splitProvider's guard clauses, each of which is
// a real upstream-drift mode: a generator that stops stamping the date, one that
// stops emitting the call, one whose call names a region it did not define, and
// one whose helper stops assigning onto window.
function monolith(regions, opts = {}) {
  const {
    prefix = "AWS",
    dataDate = "2026-08-30",
    omitDate = false,
    omitCall = false,
    inertHelper = false,
    declare = null,
  } = opts;
  const blocks = Object.entries(regions)
    .map(([key, types]) => {
      const body = Object.entries(types)
        .map(
          ([type, rec]) =>
            `  ${JSON.stringify(type)}: {\n` +
            Object.entries(rec)
              .map(([f, v]) => `    ${f}: ${JSON.stringify(v)},`)
              .join("\n") +
            `\n  },`,
        )
        .join("\n");
      return `const ${key} = {\n${body}\n};\n`;
    })
    .join("\n");
  const named = declare || Object.keys(regions);
  return (
    `// ${prefix} Instance Data - Auto-generated from a test fixture\n` +
    `// Updated: ${dataDate} | Includes Linux + Windows pricing\n` +
    (omitDate ? "" : `window.${prefix}_DATA_DATE = "${dataDate}";\n`) +
    `function make${prefix}RegionsGlobal(regions) {\n` +
    (inertHelper
      ? `  void regions;\n`
      : `  for (const k in regions) window[k] = regions[k];\n`) +
    `  window.${prefix}_DATA_READY = true;\n` +
    `}\n\n` +
    blocks +
    (omitCall
      ? ""
      : `\nmake${prefix}RegionsGlobal({\n` +
        named.map((k) => `  ${k},`).join("\n") +
        `\n});\n`)
  );
}

// One full record per provider, in FIELD_ORDER, so the partition has something to
// divide. Prices are the two fields that legitimately vary by region.
//
// All three providers are exercised, not just AWS, and GCP is the reason: its two
// price fields sit in the MIDDLE of its field order, with cpuPlatform and isARM
// after them, while AWS and Azure both end on their prices. An AWS-only suite
// would pass a splitter that simply took the last two fields as the price half.
const RECORDS = {
  aws: {
    instanceFamily: "m5",
    instanceFamilyName: "General purpose",
    isGraviton: 0,
    currentGeneration: 1,
    processorManufacturer: "Intel",
    vCpus: 2,
    memorySizeInGiB: 8,
    nitroEnclavesSupport: 1,
    onDemandLinuxHr: 0.096,
    onDemandWindowsHr: 0.188,
  },
  azure: {
    family: "Dv5",
    familyName: "General purpose",
    isARM: 0,
    generation: 5,
    processorArchitecture: "x64",
    vCpus: 2,
    memoryGiB: 8,
    linuxPrice: 0.096,
    windowsPrice: 0.188,
  },
  gcp: {
    series: "n2",
    seriesName: "General purpose",
    generation: 2,
    vCpus: 2,
    memoryGiB: 8,
    localSsdGiB: 0,
    hourlyPrice: 0.0971,
    windowsHourlyPrice: 0.1911,
    cpuPlatform: "Intel",
    isARM: 0,
  },
};

const recFor = (provider, over = {}) => ({ ...RECORDS[provider], ...over });
const rec = (over = {}) => recFor("aws", over);

const AWS = { name: "aws", prefix: "AWS" };
const AZURE = { name: "azure", prefix: "AZURE" };
const GCP = { name: "gcp", prefix: "GCP" };

// Drop a monolith at the scratch path the tool reads — .refresh-cache/{name}-monolith.js,
// NOT the shipped manifest. The two are different files now, which is what lets the
// diffs read the old shipped data while the new data waits beside it.
function writeMonolith(root, source, name = "aws") {
  const p = monolithPath(name, root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, source, "utf8");
  return p;
}

function tempRoot(source, name = "aws") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cir-split-"));
  fs.mkdirSync(path.join(root, "js", name), { recursive: true });
  writeMonolith(root, source, name);
  return root;
}

// Capture what the tool logs, so the operator-facing warnings can be asserted
// rather than assumed. The sw.js cache warning in particular is the only signal a
// pruned region leaves, and 3.14 established that a stale cached region file is a
// user-visible defect.
function capturingLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = original;
  }
}

// Load the emitted artifacts the way the page does: manifest first, then region
// files, into one shared window-like sandbox.
function loadEmitted(root, keys) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  vm.runInContext(read("js/aws/aws-data.js"), sandbox, {
    filename: "aws-data.js",
  });
  for (const key of keys) {
    vm.runInContext(read(`js/aws/regions/${key}.js`), sandbox, {
      filename: `${key}.js`,
    });
  }
  return sandbox;
}

const threw = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return String(err.message || err);
  }
};

// ── The shipped tree is untouched until this tool runs ─────────────────────────
// The whole point of Option D: fetch-vantage, reconcile and both diffs leave
// js/{p}/ alone, so the diffs can still read the OLD data — the specs included,
// which live in the shipped manifest — while the NEW data waits in .refresh-cache/.
// Splitting must therefore consume the scratch file and leave it in place, never
// write back over its own input.
console.log("[the scratch monolith is input only]");
{
  const source = monolith({ us_east_1: { "m5.large": rec() } });
  const root = tempRoot(source);
  const scratch = monolithPath("aws", root);
  splitProvider(AWS, root);
  check(
    "the scratch monolith is left exactly as it was found",
    fs.readFileSync(scratch, "utf8") === source,
  );
  check(
    "and the manifest was written to the shipped path, not the scratch one",
    fs
      .readFileSync(path.join(root, "js", "aws", "aws-data.js"), "utf8")
      .includes("window.AWS_REGION_KEYS"),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// ── The happy path: two regions, one shared type, one region-only type ─────────
console.log("[split: the two-part format]");
{
  const source = monolith({
    us_east_1: {
      "m5.large": rec(),
      "c5.xlarge": rec({
        instanceFamily: "c5",
        vCpus: 4,
        onDemandLinuxHr: 0.17,
      }),
    },
    // m5.large's specs repeat identically and its price differs — the whole
    // premise of the split in two records.
    eu_west_1: { "m5.large": rec({ onDemandLinuxHr: 0.107 }) },
  });
  const root = tempRoot(source);
  const result = splitProvider(AWS, root);

  check(
    "reports 2 regions and 2 type specs",
    result.count === 2 && result.types === 2,
    JSON.stringify(result),
  );

  const g = loadEmitted(root, ["us_east_1", "eu_west_1"]);

  check(
    "manifest carries the service-scoped specs blob",
    g.AWS_SPECS && typeof g.AWS_SPECS[SERVICE] === "object",
    `AWS_SPECS = ${JSON.stringify(g.AWS_SPECS)}`,
  );
  check(
    "specs are stored once per type, not once per region",
    Object.keys(g.AWS_SPECS[SERVICE]).sort().join(",") === "c5.xlarge,m5.large",
    Object.keys(g.AWS_SPECS[SERVICE]).join(","),
  );
  check(
    "manifest still declares AWS_REGION_KEYS and AWS_DATA_DATE",
    g.AWS_REGION_KEYS.join(",") === "us_east_1,eu_west_1" &&
      g.AWS_DATA_DATE === "2026-08-30",
    `${g.AWS_REGION_KEYS} / ${g.AWS_DATA_DATE}`,
  );

  // The load-order property the manifest's field order exists to guarantee: a
  // consumer that waits on AWS_DATA_READY must never see it true while the specs
  // half is still missing, so the flag is assigned last.
  //
  // Match the ASSIGNMENTS, not the bare names. The manifest's own header comment
  // says "AWS_SPECS holds each type's specifications once", and an earlier version
  // of this check compared indexOf("AWS_SPECS") — which found that comment, sat
  // before everything, and passed no matter where the real assignment went. It
  // survived a planted reorder. Count them too: with only an ordering test, a
  // second READY assignment planted ahead of the specs still leaves the trailing
  // one in place and the ordering can be read either way.
  const src = fs.readFileSync(
    path.join(root, "js", "aws", "aws-data.js"),
    "utf8",
  );
  const at = (needle) => src.indexOf(needle);
  const countOf = (needle) => src.split(needle).length - 1;
  check(
    "the manifest assigns AWS_SPECS and AWS_DATA_READY exactly once each",
    countOf("window.AWS_SPECS = ") === 1 &&
      countOf("window.AWS_DATA_READY = ") === 1,
    `SPECS x${countOf("window.AWS_SPECS = ")}, READY x${countOf("window.AWS_DATA_READY = ")}`,
  );
  check(
    "window.AWS_DATA_READY is assigned after window.AWS_SPECS",
    at("window.AWS_DATA_READY = ") > at("window.AWS_SPECS = "),
    `SPECS at ${at("window.AWS_SPECS = ")}, READY at ${at("window.AWS_DATA_READY = ")}`,
  );

  // A region file carries prices and ONLY prices. Asserting the absence matters
  // as much as asserting the presence: a split that emitted the fat record into
  // the region file too would pass every rehydration check below while saving
  // nothing at all.
  const priceNames = priceFields("aws");
  const specNames = specFields("aws");
  const east = g.us_east_1["m5.large"];
  check(
    "region record carries exactly the price fields",
    Object.keys(east).sort().join(",") === [...priceNames].sort().join(","),
    Object.keys(east).join(","),
  );
  check(
    "region record carries no spec field",
    specNames.every((f) => !(f in east)),
    specNames.filter((f) => f in east).join(","),
  );
  check(
    "the two regions kept their own prices",
    g.us_east_1["m5.large"].onDemandLinuxHr === 0.096 &&
      g.eu_west_1["m5.large"].onDemandLinuxHr === 0.107,
    `${g.us_east_1["m5.large"].onDemandLinuxHr} / ${g.eu_west_1["m5.large"].onDemandLinuxHr}`,
  );
  check(
    "a region-only type is absent from the other region",
    !("c5.xlarge" in g.eu_west_1),
    Object.keys(g.eu_west_1).join(","),
  );

  // Rehydration is the whole contract: merge the halves and the ten-field record
  // every consumer above the loader speaks must come back exactly.
  console.log("[rehydration]");
  const rehydrated = {
    ...g.AWS_SPECS[SERVICE]["m5.large"],
    ...g.us_east_1["m5.large"],
  };
  const original = rec();
  check(
    "specs + prices rebuild the original record field for field",
    Object.keys(original).every((f) => rehydrated[f] === original[f]) &&
      Object.keys(rehydrated).length === Object.keys(original).length,
    JSON.stringify(rehydrated),
  );

  // ── Idempotency ─────────────────────────────────────────────────────────────
  // Input and output are separate files now, so a re-run is not a skip: it splits
  // the same monolith again and must land on the same manifest byte for byte. That
  // is the stronger property — the old guard proved only that the tool declined to
  // re-read its own output, which a tool that skipped EVERYTHING would also pass.
  console.log("[idempotency]");
  const second = splitProvider(AWS, root);
  check(
    "a second run re-splits rather than skipping",
    second.skipped !== true && second.count === 2,
    JSON.stringify(second),
  );
  const afterSecond = fs.readFileSync(
    path.join(root, "js", "aws", "aws-data.js"),
    "utf8",
  );
  check("and lands on a byte-identical manifest", afterSecond === src);

  fs.rmSync(root, { recursive: true, force: true });
}

// A manifest sitting at the scratch path is a pipeline mix-up — fetch-vantage did
// not run and something else put it there. Splitting it would emit a manifest whose
// specs blob came from a manifest, so the tool must refuse by name rather than
// produce a plausible-looking half-empty artifact.
{
  const root = tempRoot(monolith({ us_east_1: { "m5.large": rec() } }));
  splitProvider(AWS, root);
  writeMonolith(
    root,
    fs.readFileSync(path.join(root, "js", "aws", "aws-data.js"), "utf8"),
  );
  const msg = threw(() => splitProvider(AWS, root));
  check(
    "a manifest at the scratch path is refused, not split",
    msg !== null && /is a manifest, not a monolith/.test(msg),
    msg || "did not throw",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// ── The hard-fails, all of which must land before any disk write ──────────────
console.log("[hard-fails]");

// Region set drift: the call names a region the monolith never assigns.
{
  const source = monolith({ us_east_1: { "m5.large": rec() } }).replace(
    "makeAWSRegionsGlobal({\n  us_east_1,",
    "makeAWSRegionsGlobal({\n  us_east_1,\n  eu_west_1,",
  );
  const root = tempRoot(source);
  const msg = threw(() => splitProvider(AWS, root));
  check(
    "a declared region the monolith does not assign aborts",
    msg !== null && /found 1 region blocks but .*declares 2/.test(msg),
    msg || "did not throw",
  );
  check(
    "and nothing was written",
    !fs.existsSync(path.join(root, "js", "aws", "regions")),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// A DUPLICATE declared key defeats the count-only check above without tripping
// it: two real blocks {us_east_1, eu_west_1} but the call declares
// {us_east_1, us_east_1} — same length, and "missing" is empty because every
// declared name IS a real block. Before the fix, this passed straight through to
// the write loop, which iterates the DECLARED list: us_east_1 would be written
// twice and eu_west_1 — a real region with real records — silently never
// written at all. This is the actual failure mode; the "call names a region the
// monolith never assigns" case above (length mismatch) does not exercise it.
{
  const source = monolith(
    {
      us_east_1: { "m5.large": rec() },
      eu_west_1: { "m5.large": rec() },
    },
    { declare: ["us_east_1", "us_east_1"] },
  );
  const root = tempRoot(source);
  const msg = threw(() => splitProvider(AWS, root));
  check(
    "a duplicate declared key aborts, rather than silently dropping the other region",
    msg !== null && /duplicate region key/.test(msg),
    msg || "did not throw",
  );
  check(
    "and nothing was written (not even the duplicated region)",
    !fs.existsSync(path.join(root, "js", "aws", "regions")),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// The writer-side twin of data-integrity-test's region-invariance guard. Specs
// are stored once per type, so a type whose specs differ between two regions
// cannot be split without losing one of them. The tool must refuse rather than
// pick a winner.
{
  const root = tempRoot(
    monolith({
      us_east_1: { "m5.large": rec() },
      eu_west_1: { "m5.large": rec({ vCpus: 4 }) },
    }),
  );
  const msg = threw(() => splitProvider(AWS, root));
  check(
    "a type whose specs differ by region aborts, naming both regions and the field",
    msg !== null &&
      msg.includes("m5.large.vCpus") &&
      msg.includes("us_east_1") &&
      msg.includes("eu_west_1"),
    msg || "did not throw",
  );
  check(
    "and nothing was written",
    !fs.existsSync(path.join(root, "js", "aws", "regions")),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// The round-trip verifier drives the same artifacts the writer is about to emit,
// so on the happy path it can only ever pass. Drive it directly against doctored
// artifacts instead — otherwise this is a check that cannot fail, which is worse
// than no check at all.
console.log("[round-trip verifier, driven off its happy path]");
{
  const original = { us_east_1: { "m5.large": rec() } };
  const sandbox = { us_east_1: original.us_east_1 };
  const goodManifest =
    `window.AWS_SPECS = { ${SERVICE}: { "m5.large": {\n` +
    specFields("aws")
      .map((f) => `  ${f}: ${JSON.stringify(rec()[f])},`)
      .join("\n") +
    `\n} } };\n`;
  const goodRegion = {
    key: "us_east_1",
    fileContent:
      `window.us_east_1 = { "m5.large": {\n` +
      priceFields("aws")
        .map((f) => `  ${f}: ${JSON.stringify(rec()[f])},`)
        .join("\n") +
      `\n} };\n`,
  };
  const run = (manifest, files) =>
    threw(() =>
      verifyRoundTrip({
        name: "aws",
        prefix: "AWS",
        manifest,
        files,
        sandbox,
        declaredKeys: ["us_east_1"],
      }),
    );

  check(
    "faithful artifacts pass",
    run(goodManifest, [goodRegion]) === null,
    run(goodManifest, [goodRegion]) || "",
  );

  // A dropped spec field: compiles, ships, and is invisible without this check.
  const lostSpec = goodManifest.replace(/  vCpus: 2,\n/, "");
  check(
    "a spec field dropped from the manifest is caught and named",
    (run(lostSpec, [goodRegion]) || "").includes("us_east_1.m5.large.vCpus"),
    run(lostSpec, [goodRegion]) || "did not throw",
  );

  // A price silently altered — the failure mode with the largest blast radius,
  // because a wrong price is a plausible price.
  const badPrice = {
    key: "us_east_1",
    fileContent: goodRegion.fileContent.replace("0.096", "0.196"),
  };
  check(
    "a price changed in transit is caught and named",
    (run(goodManifest, [badPrice]) || "").includes(
      "us_east_1.m5.large.onDemandLinuxHr",
    ),
    run(goodManifest, [badPrice]) || "did not throw",
  );

  // A type present in a region file with no specs entry — the state that would
  // rehydrate to a half-record the loader then drops as if it were unpriced.
  const orphan = {
    key: "us_east_1",
    fileContent: goodRegion.fileContent.replace(
      "window.us_east_1 = {",
      'window.us_east_1 = { "c5.xlarge": { onDemandLinuxHr: 0.17, onDemandWindowsHr: 0.3 },',
    ),
  };
  const orphanSandbox = {
    us_east_1: {
      "m5.large": rec(),
      "c5.xlarge": rec({ instanceFamily: "c5" }),
    },
  };
  const orphanMsg = threw(() =>
    verifyRoundTrip({
      name: "aws",
      prefix: "AWS",
      manifest: goodManifest,
      files: [orphan],
      sandbox: orphanSandbox,
      declaredKeys: ["us_east_1"],
    }),
  );
  check(
    "a region type with no specs entry is caught and named",
    (orphanMsg || "").includes("c5.xlarge") &&
      (orphanMsg || "").includes("AWS_SPECS"),
    orphanMsg || "did not throw",
  );

  // A manifest with no specs blob at all — the shape a half-finished migration
  // leaves behind.
  check(
    "a manifest with no specs blob is caught",
    (run("window.AWS_SPECS = {};\n", [goodRegion]) || "").includes(
      `AWS_SPECS.${SERVICE}`,
    ),
    run("window.AWS_SPECS = {};\n", [goodRegion]) || "did not throw",
  );
}

// ── All three providers, because their field orders differ in shape ────────────
// AWS has ten fields and ends on its two prices; Azure has nine and also ends on
// them; GCP has nine with its prices in the MIDDLE. Running only AWS would leave
// a positional partition bug undetected on the one provider that would show it.
console.log("[every provider round-trips through its own field order]");
for (const provider of [AWS, AZURE, GCP]) {
  const { name } = provider;
  const key = "us_east_1";
  const root = tempRoot(
    monolith(
      {
        [key]: { "type.a": recFor(name) },
        eu_west_1: { "type.a": recFor(name) },
      },
      { prefix: provider.prefix },
    ),
    name,
  );
  // Guarded: the tool's own round-trip verifier throws on a partition bug, and an
  // unguarded call would unwind the whole suite and skip every check after this
  // provider — which is how a run reports one stack trace instead of the eight
  // results that would say WHICH providers were affected.
  const splitErr = threw(() => splitProvider(provider, root));
  check(`[${name}] the split completed`, splitErr === null, splitErr || "");
  if (splitErr !== null) {
    fs.rmSync(root, { recursive: true, force: true });
    continue;
  }

  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  vm.runInContext(read(`js/${name}/${name}-data.js`), sandbox, {
    filename: `${name}-data.js`,
  });
  vm.runInContext(read(`js/${name}/regions/${key}.js`), sandbox, {
    filename: `${key}.js`,
  });

  const specs = (sandbox[`${provider.prefix}_SPECS`] || {})[SERVICE] || {};
  const prices = sandbox[key] || {};
  const rehydrated = { ...specs["type.a"], ...prices["type.a"] };
  const original = recFor(name);
  check(
    `[${name}] the record rebuilds from its two halves, field for field`,
    Object.keys(original).every((f) => rehydrated[f] === original[f]) &&
      Object.keys(rehydrated).length === Object.keys(original).length,
    JSON.stringify(rehydrated),
  );
  check(
    `[${name}] the price half is exactly the declared price fields, wherever they sit in the order`,
    Object.keys(prices["type.a"] || {})
      .sort()
      .join(",") === [...priceFields(name)].sort().join(","),
    Object.keys(prices["type.a"] || {}).join(","),
  );
  check(
    `[${name}] no spec field leaked into the region file`,
    specFields(name).every((f) => !(f in (prices["type.a"] || {}))),
    specFields(name)
      .filter((f) => f in (prices["type.a"] || {}))
      .join(","),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// ── The remaining guard clauses, each a real upstream-drift mode ───────────────
console.log("[upstream drift]");
{
  const cases = [
    [
      "a monolith with no data date aborts",
      { omitDate: true },
      /AWS_DATA_DATE not found/,
    ],
    [
      "a monolith with no makeRegionsGlobal call aborts",
      { omitCall: true },
      /makeRegionsGlobal call not found/,
    ],
    [
      "a call naming a region with no block aborts before evaluation",
      { declare: ["us_east_1", "ghost_region_1"] },
      /found 1 region blocks but .*declares 2/,
    ],
    [
      "a helper that assigns nothing onto window aborts",
      { inertHelper: true },
      /declared but not assigned onto window: us_east_1/,
    ],
  ];
  for (const [label, opts, pattern] of cases) {
    const root = tempRoot(monolith({ us_east_1: { "m5.large": rec() } }, opts));
    const msg = threw(() => splitProvider(AWS, root));
    check(label, msg !== null && pattern.test(msg), msg || "did not throw");
    check(
      `  ${label} — wrote nothing`,
      !fs.existsSync(path.join(root, "js", "aws", "regions")),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A provider with no scratch monolith is skipped, not an error: the tool runs over
// all three every refresh, and --provider-scoped or partial runs are normal.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cir-split-"));
  let lines = [];
  let result = null;
  const msg = threw(() => {
    const captured = capturingLog(() => splitProvider(AWS, root));
    lines = captured.lines;
    result = captured.result;
  });
  // Assert OUTSIDE capturingLog. It replaces console.log for the whole callback, so
  // a check run inside it has its own ok:/FAIL: line captured into `lines` instead
  // of printed — the run would still exit non-zero, but name nothing.
  check(
    "an absent monolith is skipped, not thrown on",
    result !== null && result.skipped === true,
    msg || JSON.stringify(result),
  );
  check("skipping an absent provider raises nothing", msg === null, msg || "");
  // Assert the MESSAGE, not just that nothing was written. The operator's only clue
  // is the path it names, and a skip that stopped naming it would leave this check
  // green while telling them nothing.
  check(
    "and the skip names the scratch path the operator must produce",
    lines.some((l) =>
      l.includes(path.relative(root, monolithPath("aws", root))),
    ),
    lines.join(" | ") || "nothing logged",
  );
  check("the skip wrote nothing", !fs.existsSync(path.join(root, "js")));
  fs.rmSync(root, { recursive: true, force: true });
}

// ── Pruning a region that upstream dropped ─────────────────────────────────────
// The stale file must be deleted AND the operator told to bump the service-worker
// cache — a pruned region keeps being served from a client's cache because
// revalidating a deleted file 404s, so the warning is the only thing standing
// between a dropped region and users still being recommended out of it.
console.log("[pruning a dropped region]");
{
  const root = tempRoot(
    monolith({
      us_east_1: { "m5.large": rec() },
      eu_west_1: { "m5.large": rec() },
    }),
  );
  splitProvider(AWS, root);
  const regionsDir = path.join(root, "js", "aws", "regions");
  check(
    "both regions written on the first pass",
    fs.readdirSync(regionsDir).sort().join(",") === "eu_west_1.js,us_east_1.js",
    fs.readdirSync(regionsDir).join(","),
  );

  // Upstream drops a region: rewrite the monolith with only one and re-split.
  // Guarded like the [upstream drift] scenarios above, not called bare: an
  // uncaught throw here would unwind this whole suite and skip every check after
  // it, including [CLI wiring] — the exact failure mode a suite crash produces,
  // as opposed to a named FAIL. A result that came back without `pruned` would
  // otherwise raise a raw TypeError instead of a named failure too.
  writeMonolith(root, monolith({ us_east_1: { "m5.large": rec() } }));
  let result = null;
  let lines = [];
  const reSplitErr = threw(() => {
    const captured = capturingLog(() => splitProvider(AWS, root));
    result = captured.result;
    lines = captured.lines;
  });
  check(
    "the re-split completes without throwing",
    reSplitErr === null,
    reSplitErr || "",
  );
  check(
    "the dropped region's file is removed",
    fs.readdirSync(regionsDir).join(",") === "us_east_1.js",
    fs.readdirSync(regionsDir).join(","),
  );
  check(
    "the prune is reported by name",
    Boolean(result) && (result.pruned || []).join(",") === "eu_west_1.js",
    JSON.stringify(result && result.pruned),
  );
  check(
    "and the operator is told to bump the service-worker cache",
    lines.some((l) => l.includes("sw.js") && l.includes("CACHE")),
    lines.join(" | ") || "nothing logged",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// ── The CLI actually drives all three providers ────────────────────────────────
// A unit test of splitProvider proves nothing about whether anything calls it:
// v3.14.32 shipped a green suite for a helper the CLI had stopped calling. Pin
// main()'s BODY specifically — checking the whole file would pass on the export
// list and the PROVIDERS table alone.
console.log("[CLI wiring]");
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "tools", "split-data.js"),
    "utf8",
  );
  // Strip line comments first, then extract. main() documents why it must NOT call
  // process.exit(), naming the call in prose — and a structural check that reads
  // comments reports on documentation rather than on code.
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  const body = (code.match(/function main\(\)\s*\{[\s\S]*?\n\}/) || [""])[0];
  check(
    "main() was found to inspect",
    body.includes("main") && body.length > 40,
    `${body.length} chars`,
  );
  check(
    "main() iterates PROVIDERS and calls splitProvider on each",
    /for\s*\(.*of PROVIDERS\)/.test(body) && body.includes("splitProvider("),
    body.replace(/\s+/g, " ").slice(0, 120),
  );
  check(
    "main() exits non-zero when a provider failed",
    /process\.exitCode\s*=\s*failed\s*\?\s*1\s*:\s*0/.test(body),
    body.replace(/\s+/g, " ").slice(0, 200),
  );
  // exitCode, never exit(): the workflow runs this tool as
  // `node tools/split-data.js | tee split.log` and greps that log for the
  // region-removal warning that says sw.js needs a CACHE bump. With stdout a pipe,
  // exit() can kill the process before the warning flushes — losing the signal on
  // the one run that had something to say. This suite's own footer carries the same
  // rule; the tool is where it actually costs something.
  check(
    "main() does not call process.exit(), which can truncate the piped warning",
    !/process\.exit\s*\(/.test(body),
    body.replace(/\s+/g, " ").slice(0, 200),
  );
  check(
    "all three providers are declared for it to iterate",
    /"aws"/.test(src) && /"azure"/.test(src) && /"gcp"/.test(src),
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

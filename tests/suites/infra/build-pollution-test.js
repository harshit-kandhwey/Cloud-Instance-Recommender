// build-pollution suite: names that come from a vendor feed are keys, not prototypes.
// The three official price parsers accumulated into plain objects keyed by instance
// type, region and series names taken from the feed. A feed entry named "__proto__"
// made the first lookup return Object.prototype itself, and the price written into
// that "record" landed on every object in the build process (({}).onDemandLinuxHr
// became 1.25), so a later step could read a price that no record carried. The local
// refresh also copied every key of .env into the environment its child processes
// inherit. Each probe runs in its own node process so a regression cannot pollute this
// suite's own Object.prototype.
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const probe = (code) =>
  execFileSync(process.execPath, ["-e", code], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();

// ── AWS: instanceType ───────────────────────────────────────────────────────────
{
  const out = probe(`
    const { parseAwsRegion } = require("./scripts/data/fetch-official-aws.js");
    const feed = (type) => ({
      products: {
        sku1: {
          productFamily: "Compute Instance",
          attributes: {
            tenancy: "Shared", capacitystatus: "Used", preInstalledSw: "NA",
            operatingSystem: "Linux", instanceType: type, vcpu: "2", memory: "8 GiB",
          },
        },
      },
      terms: { OnDemand: { sku1: { a: { priceDimensions: { b: { unit: "Hrs", pricePerUnit: { USD: "1.25" } } } } } } },
    });
    const hostile = parseAwsRegion(feed("__proto__"));
    const polluted = String(({}).onDemandLinuxHr);
    const ordinary = parseAwsRegion(feed("m5.large"));
    console.log(JSON.stringify({
      polluted,
      ownKey: Object.prototype.hasOwnProperty.call(hostile, "__proto__"),
      keptPrice: hostile["__proto__"] && hostile["__proto__"].onDemandLinuxHr,
      plain: Object.getPrototypeOf(hostile) === Object.prototype,
      ordinary: ordinary["m5.large"] && ordinary["m5.large"].onDemandLinuxHr,
    }));
  `);
  const r = JSON.parse(out);
  check(
    "AWS: a feed type named __proto__ leaves Object.prototype clean",
    r.polluted === "undefined",
    out,
  );
  check(
    "AWS: that type is kept as a record under its own key, with its price",
    r.ownKey === true && r.keptPrice === 1.25,
    out,
  );
  check("AWS: the result is a plain object like before", r.plain === true, out);
  check("AWS: an ordinary type is unchanged", r.ordinary === 1.25, out);
}

// ── Azure: region and type ──────────────────────────────────────────────────────
{
  const out = probe(`
    const { parseAzureItems } = require("./scripts/data/fetch-official-azure.js");
    const item = (region, sku) => ({
      serviceName: "Virtual Machines", type: "Consumption", unitOfMeasure: "1 Hour",
      skuName: "D2 v5", armRegionName: region, armSkuName: sku,
      productName: "Virtual Machines Dv5 Series", unitPrice: 0.5,
    });
    const byRegion = parseAzureItems([item("__proto__", "Standard_D2_v5")]);
    const polluted = String(({}).d2v5);
    const byType = parseAzureItems([item("eastus", "Standard___proto__")]);
    const typePolluted = String(({}).linuxPrice);
    const ordinary = parseAzureItems([item("eastus", "Standard_D2_v5")]);
    console.log(JSON.stringify({
      polluted,
      typePolluted,
      regionKept: Object.prototype.hasOwnProperty.call(byRegion, "__proto__"),
      keptPrice: byRegion["__proto__"] && byRegion["__proto__"].d2v5 && byRegion["__proto__"].d2v5.linuxPrice,
      typeKept: Object.keys(byType.eastus || {}),
      ordinary: ordinary.eastus && ordinary.eastus.d2v5 && ordinary.eastus.d2v5.linuxPrice,
    }));
  `);
  const r = JSON.parse(out);
  check(
    "Azure: a feed region named __proto__ leaves Object.prototype clean",
    r.polluted === "undefined" && r.typePolluted === "undefined",
    out,
  );
  check(
    "Azure: that region is kept as a key, with its record",
    r.regionKept === true && r.keptPrice === 0.5,
    out,
  );
  check(
    "Azure: an ordinary region and type are unchanged",
    r.ordinary === 0.5,
    out,
  );
}

// ── GCP: region keys ────────────────────────────────────────────────────────────
{
  const out = probe(`
    const g = require("./scripts/data/fetch-official-gcp.js");
    const core = (region) => ({
      category: { resourceFamily: "Compute", usageType: "OnDemand", resourceGroup: "CPU" },
      description: "N2 Instance Core running in X",
      serviceRegions: [region],
      pricingInfo: [{ pricingExpression: { tieredRates: [{ unitPrice: { units: "0", nanos: 31000000 } }] } }],
    });
    const rates = g.parseCoreRamSkus([core("__proto__")]);
    const polluted = String(({}).coreHr);
    const series = Object.keys(rates);
    console.log(JSON.stringify({
      polluted,
      series,
      regionKept: series.length === 1 && Object.prototype.hasOwnProperty.call(rates[series[0]], "__proto__"),
      plain: series.length === 1 && Object.getPrototypeOf(rates[series[0]]) === Object.prototype,
    }));
  `);
  const r = JSON.parse(out);
  check(
    "GCP: a service region named __proto__ leaves Object.prototype clean",
    r.polluted === "undefined",
    out,
  );
  check(
    "GCP: that region is kept as a key under its series, as a plain object",
    r.regionKept === true && r.plain === true,
    out,
  );
}

// ── the helper both rely on ─────────────────────────────────────────────────────
{
  const { toPlain } = require(path.join(REPO, "scripts/lib/build-env.js"));
  const bare = Object.create(null);
  bare["__proto__"] = Object.create(null);
  bare["__proto__"].x = 1;
  bare.ordinary = 2;
  const plain = toPlain(bare);
  check(
    "toPlain gives a plain object that keeps a __proto__ key as a key",
    Object.getPrototypeOf(plain) === Object.prototype &&
      Object.prototype.hasOwnProperty.call(plain, "__proto__") &&
      plain.ordinary === 2 &&
      Object.getPrototypeOf(plain["__proto__"]) === Object.prototype &&
      plain["__proto__"].x === 1,
  );
  check(
    "toPlain passes primitives through",
    toPlain(5) === 5 && toPlain("a") === "a" && toPlain(null) === null,
  );
  const withList = toPlain({ regions: ["a", { z: 1 }] });
  check(
    "toPlain keeps an array an array, so a list in a record is not turned into an object",
    Array.isArray(withList.regions) &&
      withList.regions.length === 2 &&
      withList.regions[0] === "a" &&
      withList.regions[1].z === 1,
    JSON.stringify(withList),
  );
}

// ── .env: only the keys the pipeline reads ──────────────────────────────────────
{
  const mod = require(path.join(REPO, "scripts/data/refresh-local.js"));
  const kept = mod.pickAllowedEnv({
    VANTAGE_API_KEY: "a",
    GCP_BILLING_API_KEY: "b",
    NODE_OPTIONS: "--require ./evil.js",
    PATH: "/evil",
    LD_PRELOAD: "/evil.so",
    HOME: "/x",
  });
  check(
    "the two pipeline keys are imported",
    kept.VANTAGE_API_KEY === "a" && kept.GCP_BILLING_API_KEY === "b",
    JSON.stringify(kept),
  );
  check(
    "NODE_OPTIONS, PATH and every other key are not",
    Object.keys(kept).length === 2,
    JSON.stringify(kept),
  );
  // The allow-list must cover exactly what the pipeline demands, or a key it needs
  // would be dropped and the run would fail as "missing".
  const needed = mod.missingKeys({ pricing: true }, {});
  const sample = Object.fromEntries(needed.map((k) => [k, "v"]));
  check(
    "every key the pipeline requires survives the filter",
    needed.length > 0 &&
      Object.keys(mod.pickAllowedEnv(sample)).length === needed.length,
    needed.join(","),
  );
  const src = fs.readFileSync(
    path.join(REPO, "scripts/data/refresh-local.js"),
    "utf8",
  );
  const body = src.slice(src.indexOf("function loadDotEnv"));
  check(
    "loadDotEnv reads .env through the filter",
    /pickAllowedEnv\(\s*parseEnv\(/.test(body.slice(0, 400)),
    body.slice(0, 200),
  );
}

if (state.failures) {
  console.error(`\nbuild-pollution: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nbuild-pollution: all checks passed");
  process.exitCode = 0;
}

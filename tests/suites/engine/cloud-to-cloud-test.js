// Cloud-to-cloud sizing, part 1 — the reverse-lookup primitives (Phase B1).
// Before a VM can be right-sized across providers FROM the instance type it runs
// on today, two pure pieces have to hold:
//   - inferInstanceTypeProvider: which cloud a type name belongs to, from its
//     naming shape alone (AWS dot, Azure underscore, GCP hyphen);
//   - BaseInstanceSelector.getSpecsForInstanceType: the { vCpus, memory } a loaded
//     provider's data carries for that type, or null when it does not know it.
// The mode that USES these (deriving specs when CPU/Memory are blank) is Phase B2;
// this suite pins the primitives on their own so a regression there fails here,
// not three layers downstream.
const { buildEngineContext, buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx, run } = buildEngineContext({
  scripts: [
    "src/core/rules/rule-engine.js",
    "src/core/engine/base-instance-selector.js",
    "src/core/engine/instance-selector-factory.js",
  ],
  label: "cloud-to-cloud",
});

// ── inferInstanceTypeProvider: the naming-shape → provider table ─────────────
console.log("[a type name's separator alone identifies its cloud]");
{
  const infer = ctx.inferInstanceTypeProvider;
  const cases = [
    ["m5.xlarge", "aws"],
    ["r5a.2xlarge", "aws"],
    ["t3.micro", "aws"],
    ["c6gn.16xlarge", "aws"],
    ["Standard_D4s_v5", "azure"],
    ["D4s_v5", "azure"],
    ["Standard_B2ms", "azure"],
    ["n2-standard-4", "gcp"],
    ["e2-medium", "gcp"],
    ["c3d-highcpu-8", "gcp"],
    ["n2-custom-4-16384", "gcp"],
  ];
  for (const [type, want] of cases) {
    check(`"${type}" → ${want}`, infer(type) === want, `got ${infer(type)}`);
  }
  // A bare word matches no cloud's shape — better an unknown than a wrong guess.
  check("a shapeless name is unknown, not guessed", infer("mystery") === "");
  check("a blank name is unknown", infer("") === "" && infer(null) === "");
  check(
    "whitespace is trimmed before shape testing",
    infer("  m5.large  ") === "aws",
  );
}

// ── getSpecsForInstanceType: reverse lookup over loaded data ─────────────────
// A hand-built pool across two regions, so behaviour is exact and independent of
// any shipped region file. The lookup must find a type in whichever region carries
// it, match case-insensitively, and refuse a zero-spec row.
console.log("[the reverse lookup returns the specs the data carries]");
{
  run(`
    __sel = new BaseInstanceSelector();
    __sel.getProviderName = function () { return "AWS"; };
    __sel.getSampleData = function () { return []; };
    __sel.instanceData = {
      "us-east-1": [
        { instanceType: "m5.xlarge", vCpus: 4, memory: 16, family: "m5" },
        { instanceType: "r5.large", vCpus: 2, memory: 16, family: "r5" },
      ],
      "eu-west-1": [
        { instanceType: "c5.2xlarge", vCpus: 8, memory: 16, family: "c5" },
        { instanceType: "broken.0", vCpus: 0, memory: 0, family: "broken" },
      ],
    };
  `);
  const specs = (t) =>
    run(`__sel.getSpecsForInstanceType(${JSON.stringify(t)})`);

  check(
    "an exact type resolves to its vCPU / memory",
    JSON.stringify(specs("m5.xlarge")) ===
      JSON.stringify({ instanceType: "m5.xlarge", vCpus: 4, memory: 16 }),
    JSON.stringify(specs("m5.xlarge")),
  );
  check(
    "a type in a second loaded region is found too",
    specs("c5.2xlarge")?.vCpus === 8 && specs("c5.2xlarge")?.memory === 16,
    JSON.stringify(specs("c5.2xlarge")),
  );
  check(
    "the match is case-insensitive but keeps the data's casing",
    specs("M5.XLarge")?.instanceType === "m5.xlarge",
    JSON.stringify(specs("M5.XLarge")),
  );
  check("an unknown type resolves to null", specs("x9.huge") === null);
  check(
    "a blank type resolves to null",
    specs("") === null && specs(null) === null,
  );
  check(
    "a zero-spec data row is never returned as a real box",
    specs("broken.0") === null,
    JSON.stringify(specs("broken.0")),
  );
}

console.log("[an empty or unloaded selector answers null, never throws]");
{
  run(`
    __empty = new BaseInstanceSelector();
    __empty.getProviderName = function () { return "AWS"; };
  `);
  check(
    "a selector with no loaded data returns null",
    run(`__empty.getSpecsForInstanceType("m5.xlarge")`) === null,
  );
}

// ── The mode: deriving a row's size from its Current Instance Type (Phase B2) ─
// This is the DELIBERATE inversion of the invariant current-instance-test.js
// defends ("the Current Instance Type never changes sizing"). That guard stays
// true in the DEFAULT mode; here, ONLY under options.cloudToCloud and ONLY when a
// row carries no CPU/Memory, the type drives the size — from the derivedSpecs map
// the main thread resolves and passes across the worker boundary.
(async () => {
  const { ctx } = buildContext();
  const rows = [
    // No CPU/Memory — pure cloud-to-cloud rows naming what they run on today.
    {
      "VM Name": "a",
      "Current Instance Type": "m5.xlarge",
      "AWS Region": "us-east-1",
    },
    {
      "VM Name": "b",
      "Current Instance Type": "m5.xlarge",
      "AWS Region": "us-east-1",
    },
    // Explicit CPU/Memory present — precedence says these win, type ignored.
    {
      "VM Name": "c",
      "CPU Count": "8",
      "Memory (GB)": "32",
      "Current Instance Type": "m5.xlarge",
      "AWS Region": "us-east-1",
    },
    // A named source type the main thread could not resolve.
    {
      "VM Name": "d",
      "Current Instance Type": "zz9.mega",
      "AWS Region": "us-east-1",
    },
    // Partial specs: CPU present, Memory blank. Derivation fills a row with
    // NEITHER, so this is NOT derived — a partial row is a data gap the existing
    // No-Match handles, not a cloud-to-cloud row.
    {
      "VM Name": "e",
      "CPU Count": "8",
      "Current Instance Type": "m5.xlarge",
      "AWS Region": "us-east-1",
    },
  ];
  const derivedSpecs = { "m5.xlarge": { cpu: 4, memory: 16 } };
  const L2L = "AWS Like-to-Like Instance";

  console.log(
    "[default mode: a spec-less row does NOT derive — invariant holds]",
  );
  {
    const off = await ctx.getInstanceRecommendationWithSelector(
      rows,
      ["aws"],
      {},
    );
    check(
      "with the mode off, a row with no CPU/Memory is Missing data, not derived",
      off[0][L2L] === "Missing data",
      JSON.stringify(off[0][L2L]),
    );
    check(
      "with the mode off, no Sized From column is added",
      !("Sized From" in off[0]),
      JSON.stringify(Object.keys(off[0])),
    );
  }

  console.log("[cloud-to-cloud mode: the source type drives the size]");
  {
    const on = await ctx.getInstanceRecommendationWithSelector(rows, ["aws"], {
      cloudToCloud: true,
      derivedSpecs,
    });
    check(
      "a spec-less row is now sized (a real instance, not Missing data)",
      on[0][L2L] !== "Missing data" && !!on[0][L2L],
      JSON.stringify(on[0][L2L]),
    );
    check(
      "Sized From names the source instance type it derived from",
      on[0]["Sized From"] === "m5.xlarge",
      JSON.stringify(on[0]["Sized From"]),
    );
    check(
      "two rows with the same derived type get the same recommendation",
      on[0][L2L] === on[1][L2L],
      `${on[0][L2L]} vs ${on[1][L2L]}`,
    );
    check(
      "a row with explicit CPU/Memory ignores its type (precedence: specs win)",
      on[2]["Sized From"] === "",
      JSON.stringify(on[2]["Sized From"]),
    );
    check(
      "an unresolved source type is a No-Match that names the type",
      /not recognised/.test(on[3]["AWS No Match Reason"] || ""),
      JSON.stringify(on[3]["AWS No Match Reason"]),
    );
    check(
      "a partially-specified row (CPU only) is not derived — both axes must be blank",
      on[4]["Sized From"] === "" && on[4][L2L] === "Missing data",
      `${JSON.stringify(on[4]["Sized From"])} / ${on[4][L2L]}`,
    );
  }

  // ── The main-thread resolver: buildDerivedSpecs (Phase B3) ─────────────────
  // What generate.js runs before the batch: it turns the spec-less rows into the
  // derivedSpecs map the factory consumes. A pre-warmed selector is injected so
  // the test controls the data and isolates the resolver's LOGIC — which rows
  // qualify, provider inference, the map shape — from region-loading plumbing.
  console.log("[buildDerivedSpecs resolves spec-less rows to a specs map]");
  {
    const { ctx: c } = buildContext();
    // A fake AWS selector with one known box and a no-op initialize, injected as
    // a pre-warmed selector so buildDerivedSpecs reuses it instead of loading data.
    c.window._prewarmedSelectors = c.window._prewarmedSelectors || {};
    const B = c.BaseInstanceSelector;
    const fake = new B();
    fake.getProviderName = () => "AWS";
    fake.initialize = async () => {};
    fake.instanceData = {
      "us-east-1": [
        { instanceType: "m5.xlarge", vCpus: 4, memory: 16, family: "m5" },
        { instanceType: "c5.large", vCpus: 2, memory: 4, family: "c5" },
      ],
    };
    c.window._prewarmedSelectors.aws = fake;

    const map = await c.buildDerivedSpecs([
      { "VM Name": "a", "Current Instance Type": "m5.xlarge" },
      // Has explicit specs AND names a DIFFERENT type → must be skipped, so its
      // c5.large never reaches the map (this is what pins the spec-less filter).
      {
        "VM Name": "b",
        "CPU Count": "8",
        "Memory (GB)": "32",
        "Current Instance Type": "c5.large",
      },
      // No Current Instance Type → nothing to resolve.
      { "VM Name": "c" },
    ]);
    check(
      "a spec-less row's type resolves to its vCPU / memory",
      JSON.stringify(map["m5.xlarge"]) ===
        JSON.stringify({ cpu: 4, memory: 16 }),
      JSON.stringify(map),
    );
    check(
      "only the spec-less named type is in the map (rows with specs are skipped)",
      Object.keys(map).length === 1,
      JSON.stringify(Object.keys(map)),
    );
    const emptyMap = await c.buildDerivedSpecs([]);
    check(
      "an empty input yields an empty map, never throws",
      emptyMap && Object.keys(emptyMap).length === 0,
      JSON.stringify(emptyMap),
    );
  }

  // Cross-provider resolution — the whole point of the mode. A source type from
  // ANOTHER cloud must be routed to that cloud's data by inferInstanceTypeProvider,
  // even when it is not a selected target. An Azure type (Standard_D4s_v5) is
  // resolved from an injected Azure selector, proving the underscore-shape
  // inference drives which provider's data answers.
  console.log("[buildDerivedSpecs resolves a source type from another cloud]");
  {
    const { ctx: c } = buildContext();
    c.window._prewarmedSelectors = c.window._prewarmedSelectors || {};
    const B = c.BaseInstanceSelector;
    const azure = new B();
    azure.getProviderName = () => "Azure";
    azure.initialize = async () => {};
    azure.instanceData = {
      eastus: [
        {
          instanceType: "Standard_D4s_v5",
          vCpus: 4,
          memory: 16,
          family: "Dsv5",
        },
      ],
    };
    c.window._prewarmedSelectors.azure = azure;

    const map = await c.buildDerivedSpecs([
      { "VM Name": "x", "Current Instance Type": "Standard_D4s_v5" },
    ]);
    check(
      "an Azure-named source type is routed to Azure data and resolved",
      JSON.stringify(map["standard_d4s_v5"]) ===
        JSON.stringify({ cpu: 4, memory: 16 }),
      JSON.stringify(map),
    );
  }

  // A provider's data failing to load must not read as "the type doesn't
  // exist" — coding.md #1 (never a plausible wrong answer). The row still
  // becomes No-Match downstream, but a toast has to say WHY.
  console.log(
    "[buildDerivedSpecs warns, by name, when a provider's data fails to load]",
  );
  {
    const { ctx: c, toasts } = buildContext();
    c.window._prewarmedSelectors = c.window._prewarmedSelectors || {};
    const B = c.BaseInstanceSelector;
    const failing = new B();
    failing.getProviderName = () => "AWS";
    failing.initialize = async () => {
      throw new Error("network down");
    };
    c.window._prewarmedSelectors.aws = failing;

    const map = await c.buildDerivedSpecs([
      { "VM Name": "a", "Current Instance Type": "m5.xlarge" },
    ]);
    check(
      "a failed provider's types are absent from the map, not a thrown error",
      Object.keys(map).length === 0,
      JSON.stringify(map),
    );
    check(
      "a warning toast names the provider that failed to load",
      toasts.some((t) => t.type === "warning" && /aws/i.test(t.message)),
      JSON.stringify(toasts),
    );
  }

  // collectRegionDataForWorker resolves regions from the per-run row snapshot
  // (coding.md #3, "snapshot before await") — found by CodeRabbit reading the
  // module-level `csvData` instead, which a concurrent upload could reassign
  // while this worker batch is still in flight.
  console.log(
    "[collectRegionDataForWorker resolves regions from its rows param, not live csvData]",
  );
  {
    const { ctx: c, run } = buildContext();
    c.window._regionValidation = null; // force the per-row CSV scan path
    c.window._prewarmedSelectors = c.window._prewarmedSelectors || {};
    const seenRaws = [];
    // Stub out real region resolution — this test only cares WHICH raw region
    // string reached it, not whether a real region file loads.
    c.resolveRegion = (provider, raw) => {
      seenRaws.push(raw);
      return { key: "nonexistent_region", status: "known" };
    };
    // csvData is a module-scoped `let` inside generate.js — `c.csvData = ...`
    // would only set a stale, unrelated property on the sandbox object (see
    // harness.js's own note on this); run() evaluates INSIDE the module scope,
    // the only way to actually reach and mutate that binding.
    run(
      `csvData = ${JSON.stringify([{ "AWS Region": "stale-live-global" }])};`,
    );
    const rowsForRun = [{ "AWS Region": "fresh-snapshot-row" }];
    await c.collectRegionDataForWorker(["aws"], rowsForRun);
    check(
      "the snapshot row's region was resolved",
      seenRaws.includes("fresh-snapshot-row"),
      JSON.stringify(seenRaws),
    );
    check(
      "the stale module-level csvData's region was NOT resolved",
      !seenRaws.includes("stale-live-global"),
      JSON.stringify(seenRaws),
    );
  }

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
  // pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

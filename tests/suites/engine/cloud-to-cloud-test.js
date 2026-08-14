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
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx, run } = buildEngineContext({
  scripts: [
    "js/base/rule-engine.js",
    "js/base/base-instance-selector.js",
    "js/base/instance-selector-factory.js",
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

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

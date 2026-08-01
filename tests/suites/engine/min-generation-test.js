// meetsMinGeneration must read an Azure instance's VERSION, not a digit that
// happens to follow a "v" in its name (rule-engine.js).
//
// The bug this pins: the Azure branch used /v(\d+)/i on the instance TYPE, which
// takes the FIRST v<digits>. For the NV/NC series the "v" belongs to the series
// name, so nv48sv3 (a v3 machine) was read as generation 48 and nv24 (no version
// at all) as generation 24. Both looked absurdly new, so a MinGen filter could
// never exclude them.
//
// Anchoring to the trailing version is NOT enough on its own: "nv24" ends in
// "v24", and no suffix rule separates that from a real version. The version is
// therefore read from the FAMILY, which carries it and nothing else —
// nv24 → "nv" (none), nv48sv3 → "nvv3", d4sv5 → "dsv5".
//
// Every type/family pair below is REAL, taken from js/azure/regions/eastus.js.
// Invented names would prove nothing about the format the parser actually meets.
//
// NOTE ON THE minGen VALUES. Every value is NATIVE to the cloud it is applied
// to: an Azure value is the v-number itself ("5" = v5), an AWS value is the
// family number, a GCP value is a family name ("n4"). Nothing is translated
// between clouds — the multi-cloud page supplies three values, one per provider.
// The two scales used to share one number space, which made the Azure page's own
// "v5+" option filter to v3+; that is pinned below.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");
const sandbox = { console: { log() {}, warn() {}, error() {} } };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(REPO, "js/base/rule-engine.js"), "utf8"),
  ctx,
  { filename: "rule-engine.js" },
);
const RE = ctx.RuleEngine;

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
};

// Real (instanceType → family) pairs from js/azure/regions/eastus.js.
const FAMILY = {
  nv24: "nv",
  nv12: "nv",
  nv6: "nv",
  nv48sv3: "nvv3",
  nv12sv3: "nvv3",
  nv24sv3: "nvv3",
  nv12adsv5: "nvv5",
  nv72adsv5: "nvv5",
  nv36adsv5: "nvv5",
  nv12adsv710v5: "nvadsv710v5",
  d4sv3: "dsv3",
  d4sv5: "dsv5",
  a1v2: "av2",
};
const inst = (instanceType) => {
  if (!(instanceType in FAMILY)) {
    // A typo'd key would otherwise be silently tested with no family, quietly
    // exercising the fallback instead of the case the test names.
    throw new Error(
      `min-generation-test: no real family for "${instanceType}"`,
    );
  }
  return { instanceType, family: FAMILY[instanceType] };
};
const meets = (type, minGen) =>
  RE.meetsMinGeneration(inst(type), minGen, "azure");
// The Azure-page select value asking for "version v or newer" — now simply the
// v-number, since the multi-cloud scale no longer shares this number space.
const minGenFor = (v) => v;

console.log("[a size-embedded v is not a version]");
{
  const v5 = minGenFor(5);
  check(
    "nv48sv3 is excluded by a v5+ filter (it is v3)",
    meets("nv48sv3", v5) === false,
    `meets("nv48sv3", ${v5}) = ${meets("nv48sv3", v5)}`,
  );
  check(
    "nv24sv3 is excluded by a v5+ filter (it is v3)",
    meets("nv24sv3", v5) === false,
    `meets("nv24sv3", ${v5}) = ${meets("nv24sv3", v5)}`,
  );
  check(
    "nv12sv3 is excluded by a v4+ filter (it is v3)",
    meets("nv12sv3", minGenFor(4)) === false,
    `meets("nv12sv3", 4) = ${meets("nv12sv3", minGenFor(4))}`,
  );
}

console.log("[no version means original generation, not a huge one]");
{
  // nv24 / nv12 / nv6 carry no version — family is plain "nv". A v3+ filter must
  // drop them; the old regex read the SIZE as the version and kept them.
  check(
    "nv24 is excluded by a v3+ filter (it has no version)",
    meets("nv24", minGenFor(3)) === false,
    `meets("nv24", 3) = ${meets("nv24", minGenFor(3))}`,
  );
  check(
    "nv12 is excluded by a v3+ filter (it has no version)",
    meets("nv12", minGenFor(3)) === false,
    `meets("nv12", 3) = ${meets("nv12", minGenFor(3))}`,
  );
  check(
    "nv6 is excluded by a v3+ filter (it has no version)",
    meets("nv6", minGenFor(3)) === false,
    `meets("nv6", 3) = ${meets("nv6", minGenFor(3))}`,
  );
  check(
    "and an original-generation box still passes a v2+ filter",
    meets("nv24", 2) === true,
  );
}

console.log("[genuinely new machines are still kept]");
{
  // The fix must not over-correct: these really are v5, and must survive.
  const v5 = minGenFor(5);
  check("nv12adsv5 passes a v5+ filter", meets("nv12adsv5", v5) === true);
  check("nv72adsv5 passes a v5+ filter", meets("nv72adsv5", v5) === true);
  check("nv36adsv5 passes a v5+ filter", meets("nv36adsv5", v5) === true);
  check(
    "nv12adsv710v5 passes a v5+ filter",
    meets("nv12adsv710v5", v5) === true,
  );
  check("d4sv5 passes a v5+ filter", meets("d4sv5", v5) === true);
  check("d4sv3 is excluded by a v5+ filter", meets("d4sv3", v5) === false);
  check("d4sv3 passes a v3+ filter", meets("d4sv3", minGenFor(3)) === true);
  check(
    "a1v2 is excluded by a v3+ filter",
    meets("a1v2", minGenFor(3)) === false,
  );
  check("no filter keeps everything", meets("nv48sv3", "") === true);
}

console.log("[the type is only a fallback, and never overrides the family]");
{
  // A row with no family (hand-built fixtures, sample data gaps) still parses a
  // real trailing version rather than giving up.
  const noFamily = { instanceType: "d4sv3", family: "" };
  check(
    "a familyless d4sv3 is still read as v3",
    RE.meetsMinGeneration(noFamily, minGenFor(3), "azure") === true &&
      RE.meetsMinGeneration(noFamily, minGenFor(4), "azure") === false,
  );
  // And where the two disagree, the family wins: family "nv" (no version) must
  // beat the type's misleading trailing "v24".
  check(
    "family 'nv' beats the type's trailing v24",
    RE.meetsMinGeneration(
      { instanceType: "nv24", family: "nv" },
      minGenFor(3),
      "azure",
    ) === false,
  );
}

console.log("[the Azure page's own v5+ means v5, not v3]");
{
  // THE COLLISION THAT IS NOW GONE. There used to be one cross-provider scale
  // sharing a number space with the native values, and the engine guessed
  // between them with `minNum > 4 ? minNum - 2 : minNum`. That guess is why the
  // Azure page's "v5+ (Dsv5, Esv5…)" option quietly filtered to v3+. Every value
  // is now native to the cloud it lands on, so nothing is translated.
  check(
    'Azure "5" means v5 — it excludes a v3 machine',
    meets("d4sv3", "5") === false,
    `meets("d4sv3", "5") = ${meets("d4sv3", "5")}`,
  );
  check('Azure "5" keeps a v5 machine', meets("d4sv5", "5") === true);
  check('Azure "4" excludes a v3 machine', meets("d4sv3", "4") === false);
  check('Azure "3" keeps a v3 machine', meets("d4sv3", "3") === true);
  check(
    'Azure "7" is v7 — it is NOT quietly rewritten to v5',
    meets("d4sv5", "7") === false,
    `meets("d4sv5", "7") = ${meets("d4sv5", "7")}`,
  );
}

console.log("[each provider reads its own native scale]");
{
  const aws = (t, g) =>
    RE.meetsMinGeneration(
      { instanceType: t, family: t.split(".")[0] },
      g,
      "aws",
    );
  check(
    "AWS 5 keeps m5, AWS 7 drops it",
    aws("m5.large", "5") === true && aws("m5.large", "7") === false,
  );
  check("AWS 7 keeps m7i", aws("m7i.large", "7") === true);

  const gcp = (fam, g) =>
    RE.meetsMinGeneration(
      { instanceType: `${fam}-standard-4`, family: `${fam}-standard` },
      g,
      "gcp",
    );
  // GCP's native value is a family NAME — every GCP control now sends one.
  check(
    'GCP "n4" keeps n4 and drops n2',
    gcp("n4", "n4") === true && gcp("n2", "n4") === false,
  );
  check(
    'GCP "n2" keeps n2 and drops n1',
    gcp("n2", "n2") === true && gcp("n1", "n2") === false,
  );
  // A bare number only arrives from a legacy shared column and keeps the old
  // cross-provider mapping, so such a sheet still behaves as it always did.
  check(
    "GCP legacy number 7 still means gen 4",
    gcp("n4", "7") === true && gcp("n2", "7") === false,
  );
  check(
    "GCP legacy number 5 still means gen 2",
    gcp("n2", "5") === true && gcp("n1", "5") === false,
  );
}

console.log("[the two version parsers agree]");
{
  // meetsMinGeneration and generationRank both read an Azure version. Two
  // parsers for one fact is how this bug survived: generationRank was anchored
  // in 3.8.14 while this one kept the first-match regex. Pin them together so
  // they cannot drift apart again — for every type, the version generationRank
  // reads must be exactly the boundary at which MinGen starts excluding it.
  const disagreements = Object.keys(FAMILY).filter((t) => {
    const rank = RE.generationRank(inst(t), "azure");
    return (
      meets(t, minGenFor(rank)) !== true ||
      meets(t, minGenFor(rank + 1)) !== false
    );
  });
  check(
    "every type's MinGen boundary matches the version generationRank reads",
    disagreements.length === 0,
    `disagree: ${disagreements.join(", ")}`,
  );
  check(
    "and generationRank reads the real versions, not the sizes",
    RE.generationRank(inst("nv48sv3"), "azure") === 3 &&
      RE.generationRank(inst("nv72adsv5"), "azure") === 5 &&
      RE.generationRank(inst("nv24"), "azure") === 2,
    `nv48sv3=${RE.generationRank(inst("nv48sv3"), "azure")} nv72adsv5=${RE.generationRank(inst("nv72adsv5"), "azure")} nv24=${RE.generationRank(inst("nv24"), "azure")}`,
  );
}

process.exit(failures ? 1 : 0);

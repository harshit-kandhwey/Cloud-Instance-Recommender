// Everything the app persists is JSON another tab, an older build or a user
// can leave in any shape. A stored string, array or number is truthy, so a bare
// `JSON.parse(...) || {}` returns it; writing a key onto it is then silently
// dropped while the save reports success. Each store must fall back to empty.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const KEYS = {
  rules: "cloudInstanceRecommenderUserRules",
  appMap: "cloudInstanceRecommenderAppMap",
  colMaps: "cloudInstanceRecommenderColumnMaps",
  presets: "cloudInstanceRecommenderFilterPresets",
};
const WRONG_SHAPES = ['"text"', "[1,2]", "42", "true", "null", "{bad json"];

// presets.js is not part of the shared harness script list.
const PRESETS_SRC = fs.readFileSync(
  path.join(REPO, "src/features/presets.js"),
  "utf8",
);
function ctxWith(seed) {
  const { ctx } = buildContext({ seedStorage: seed });
  ctx.location = { pathname: "/aws.html" };
  vm.runInContext(PRESETS_SRC, ctx, { filename: "src/features/presets.js" });
  return ctx;
}
const run = (ctx, code) =>
  JSON.parse(vm.runInContext(`JSON.stringify(${code})`, ctx));

console.log("[readStoredObject]");
for (const bad of WRONG_SHAPES) {
  const ctx = ctxWith({ k: bad });
  check(
    `stored ${bad} reads as an empty object`,
    JSON.stringify(run(ctx, 'readStoredObject("k")')) === "{}",
  );
}
check(
  "a stored plain object is returned",
  run(ctxWith({ k: '{"a":1}' }), 'readStoredObject("k")').a === 1,
);
check(
  "an absent key reads as an empty object",
  JSON.stringify(run(ctxWith({}), 'readStoredObject("k")')) === "{}",
);

console.log("[each store falls back to empty on a wrong shape]");
for (const bad of WRONG_SHAPES) {
  check(
    `column mappings, stored ${bad}`,
    JSON.stringify(
      run(ctxWith({ [KEYS.colMaps]: bad }), "loadColumnMappings()"),
    ) === "{}",
  );
  check(
    `app workload map, stored ${bad}`,
    JSON.stringify(
      run(ctxWith({ [KEYS.appMap]: bad }), "loadAppWorkloadMap()"),
    ) === "{}",
  );
  check(
    `presets store, stored ${bad}`,
    JSON.stringify(
      run(ctxWith({ [KEYS.presets]: bad }), "loadPresetsStore()"),
    ) === "{}",
  );
  check(
    `user rules, stored ${bad}`,
    JSON.stringify(run(ctxWith({ [KEYS.rules]: bad }), "loadUserRules()")) ===
      "[]",
  );
}

console.log("[a wrong-shaped page entry is not treated as that page's data]");
{
  const ctx = ctxWith({ [KEYS.presets]: '{"aws":"abc","azure":[1]}' });
  const forPage = run(ctx, "presetsForPage()");
  check(
    "presets: a string page entry is not spread into character keys",
    JSON.stringify(forPage) === "{}",
    JSON.stringify(forPage),
  );
}

console.log("[saving a preset over a wrong-shaped page entry]");
for (const bad of ['"abc"', "[1]", "7"]) {
  const ctx = ctxWith({ [KEYS.presets]: `{"aws":${bad}}` });
  vm.runInContext('writePreset("mine", "Saved")', ctx);
  const names = Object.keys(run(ctx, "presetsForPage()"));
  check(
    `a preset saved over page entry ${bad} is read back`,
    names.length === 1 && names[0] === "mine",
    JSON.stringify(names),
  );
}
{
  const ctx = ctxWith({ [KEYS.presets]: '{"aws":"abc"}' });
  vm.runInContext(
    `applyPresetImportText(JSON.stringify({ page: "aws", presets: { imp: { config: {} } } }))`,
    ctx,
  );
  const names = Object.keys(run(ctx, "presetsForPage()"));
  check(
    "an import over a string page entry keeps only the imported preset",
    names.length === 1 && names[0] === "imp",
    JSON.stringify(names),
  );
}

console.log("[section states]");
{
  const SECTIONS_KEY = vm.runInContext("SECTIONS_STORAGE_KEY", ctxWith({}));
  for (const bad of ['"text"', "[1,2]", '{"aws":"abc"}', '{"aws":[1]}']) {
    check(
      `stored ${bad} yields no section states`,
      JSON.stringify(
        run(ctxWith({ [SECTIONS_KEY]: bad }), "loadSectionStates()"),
      ) === "{}",
    );
  }
  const ctx = ctxWith({ [SECTIONS_KEY]: '{"aws":"abc"}' });
  vm.runInContext('saveSectionState("filters", true)', ctx);
  check(
    "a collapse saved over a string page entry is read back",
    run(ctx, "loadSectionStates()").filters === "collapsed",
  );
}

console.log("[a save over a wrong-shaped store still persists]");
for (const bad of ['"text"', "[1,2]", "42"]) {
  const ctx = ctxWith({ [KEYS.rules]: bad });
  const saved = vm.runInContext(
    'saveUserRules([{ dimension: "workload", equals: "database", action: "exclude", tokens: ["m5"] }])',
    ctx,
  );
  const back = run(ctx, "loadUserRules()");
  check(
    `rules saved over stored ${bad} are read back`,
    saved === true && back.length === 1 && back[0].tokens[0] === "m5",
    `saved=${saved} back=${JSON.stringify(back)}`,
  );
}

// The page key comes from the URL. One that names an inherited member must still
// get its own entry: assigning to "__proto__" sets the prototype and stores nothing,
// so the save reported success while persisting no rules.
console.log(
  "[a page key naming an inherited property still gets its own entry]",
);
for (const page of ["__proto__", "constructor", "toString"]) {
  const ctx = ctxWith({});
  ctx.location = { pathname: `/${page}` };
  const saved = vm.runInContext(
    'saveUserRules([{ dimension: "workload", equals: "database", action: "exclude", tokens: ["m5"] }])',
    ctx,
  );
  const back = run(ctx, "loadUserRules()");
  check(
    `rules saved on a page called ${page} are read back`,
    saved === true && back.length === 1 && back[0].tokens[0] === "m5",
    `saved=${saved} back=${JSON.stringify(back)}`,
  );
  const other = ctxWith({});
  other.location = { pathname: `/${page}` };
  check(
    `nothing saved for ${page} reads as an empty list, not the inherited member`,
    JSON.stringify(run(other, "loadUserRules()")) === "[]",
  );
}

if (state.failures) {
  console.error(`\npersisted-shape: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\npersisted-shape: all checks passed");
  process.exitCode = 0;
}

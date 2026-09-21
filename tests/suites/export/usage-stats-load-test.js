// loadUsageStatistics reads a stored JSON blob and merges it over the defaults.
// Spreading a stored string or array would inject character/index keys into the
// stats object, so only a plain object may be merged.
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const KEY = "cloudInstanceRecommenderStats";

function statsAfterLoading(stored) {
  const { ctx } = buildContext({ seedStorage: { [KEY]: stored } });
  vm.runInContext("loadUsageStatistics()", ctx);
  return JSON.parse(vm.runInContext("JSON.stringify(usageStats)", ctx));
}

console.log("[a stored plain object is merged over the defaults]");
{
  const s = statsAfterLoading(JSON.stringify({ toolUses: 7 }));
  check("the stored counter is applied", s.toolUses === 7, JSON.stringify(s));
  check("an unstored field keeps its default", s.totalVMs === 0);
}

console.log("[a stored value of the wrong shape is ignored]");
for (const bad of ['"hello"', "[1,2,3]", "42", "null"]) {
  const s = statsAfterLoading(bad);
  const injected = Object.keys(s).filter((k) => /^\d+$/.test(k));
  check(
    `stored ${bad} injects no keys and keeps the defaults`,
    injected.length === 0 && s.toolUses === 0,
    JSON.stringify(s),
  );
}

if (state.failures) {
  console.error(`\nusage-stats-load: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nusage-stats-load: all checks passed");
  process.exitCode = 0;
}

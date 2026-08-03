// A row that cannot size: the requirement exceeds every instance the region
// offers, on the vCPU axis, the memory axis, or both. That is a size wall, not
// a filter problem — no amount of relaxing soft filters conjures capacity that
// is not on the menu — so getLikeToLikeInstance must return a clean no-match and
// attach NO "nearest miss" relax hint. A false hint here is worse than none: it
// sends the user to loosen a filter that could never have helped.
//
// nearest-miss-test pins computeNearestMiss's null-on-size-wall in isolation and
// the filter-removal case end to end. This pins the end-to-end SIZE-WALL contract
// through getLikeToLikeInstance, and pairs it with the filter case so the absent
// hint is proven discriminating rather than vacuous (a selector that simply never
// attached a nearestMiss would pass the size-wall check alone).
const { buildEngineContext } = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: [
    "js/base/base-instance-selector.js",
    "js/base/instance-selector-factory.js",
  ],
  label: "cannot-size",
});

run(`
  __sel = new BaseInstanceSelector();
  __sel.getProviderName = function () { return "AWS"; };
  __sel.getSampleData = function () { return []; };
`);

// The whole region: two small, current-gen, Intel instances. Nothing here is
// remotely large, so a big request hits a hard ceiling.
ctx.pool = [
  {
    instanceType: "t3.medium",
    vCpus: 2,
    memory: 4,
    price: 0.04,
    generation: 2,
    familyName: "General purpose",
    processor: "Intel",
    family: "t3",
    isGraviton: 0,
  },
  {
    instanceType: "m5.large",
    vCpus: 2,
    memory: 8,
    price: 0.1,
    generation: 2,
    familyName: "General purpose",
    processor: "Intel",
    family: "m5",
    isGraviton: 0,
  },
];
run(`__sel.instanceData = { r1: pool };`);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
}

console.log("[a row bigger than anything on offer is a clean no-match]");
{
  const wall = run(`__sel.getLikeToLikeInstance("r1", 64, 256, {})`);
  check(
    "no instance is invented — the result is a no-match",
    !!wall && wall.instanceType === "No data available",
    wall && wall.instanceType,
  );
  check(
    "the no-match states a reason",
    !!wall && typeof wall.reason === "string" && wall.reason !== "",
    JSON.stringify(wall && wall.reason),
  );
  check(
    "a size wall carries NO relax hint — no filter could have helped",
    !!wall && wall.nearestMiss === undefined,
    JSON.stringify(wall && wall.nearestMiss),
  );
}

console.log("[the wall stands even when only one axis overshoots]");
{
  // Fits on CPU (2 <= 2) but not memory (999 > 8): still a size wall, so still
  // no hint. Guards the memory axis independently of CPU.
  const memWall = run(`__sel.getLikeToLikeInstance("r1", 2, 999, {})`);
  check(
    "a memory-only overshoot is still a no-match with no hint",
    !!memWall &&
      memWall.instanceType === "No data available" &&
      memWall.nearestMiss === undefined,
    JSON.stringify({
      t: memWall && memWall.instanceType,
      nm: memWall && memWall.nearestMiss,
    }),
  );
  // The underlying reason the hint is absent: nothing even meets the size.
  const nm = run(`__sel.computeNearestMiss(pool, 2, 999, {})`);
  check(
    "computeNearestMiss confirms the shortfall is size, returning null",
    nm === null,
    JSON.stringify(nm),
  );
}

console.log("[contrast: a fitting size removed by a filter DOES get a hint]");
{
  // Request fits (2 vCPU / 4 GB) but the AMD-only filter removes the all-Intel
  // pool. Here a size-fitting candidate exists, so relaxing IS the remedy and the
  // hint must appear — proving the absence above is discriminating, not vacuous.
  const filtered = run(
    `__sel.getLikeToLikeInstance("r1", 2, 4, { restrictProcessorManufacturers: true, selectedProcessorManufacturers: ["AMD"] })`,
  );
  check(
    "a filter-removed row is a no-match",
    !!filtered && filtered.instanceType === "No data available",
    filtered && filtered.instanceType,
  );
  check(
    "and it carries the nearest miss with the filter to relax",
    !!filtered &&
      !!filtered.nearestMiss &&
      filtered.nearestMiss.instanceType === "t3.medium" &&
      JSON.stringify(filtered.nearestMiss.blockedBy) ===
        JSON.stringify(["processor manufacturer"]),
    JSON.stringify(filtered && filtered.nearestMiss),
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = failures ? 1 : 0;

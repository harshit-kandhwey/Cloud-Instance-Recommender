// BP — burstable preference for Dev/Test at low utilization
// (js/base/rule-engine.js), the inverse of rule 1a.
//
// 1a keeps burstable families OUT of Production/Staging. This rule prefers
// them for a Dev/Test box that idles, which is exactly what a credit-based
// family is for. The two can never both fire on one row: their ENV triggers
// are disjoint.
//
// Three things make this rule honest rather than a guess:
//   1. Unknown utilization is NOT low utilization. With no reading there is no
//      evidence the box idles, and preferring burstable anyway would quietly
//      hand every Dev row a credit-limited instance.
//   2. "Low" is the run's OWN downsize threshold, not a number invented here,
//      so the rule and the N/2 sizing agree on what low means.
//   3. It is a nudge, not a filter, and it sorts BEFORE the workload
//      preference — so an explicit workload (a Dev database asking for
//      memory-optimized) sorts last and wins.
const { buildContext, makeChecker } = require("./harness");

const { check, state } = makeChecker();
const { ctx } = buildContext();
const RuleEngine = ctx.RuleEngine;

// A burstable and a non-burstable of the same shape. The NON-burstable is
// cheaper, so cheapest-adequate ordering puts it first unless the rule moves
// it — without that, every check below could pass for the wrong reason.
const POOL = [
  {
    instanceType: "m7i.large",
    family: "m7i",
    familyName: "General purpose",
    vCpus: 2,
    memory: 8,
    price: 1,
    generation: 1,
  },
  {
    instanceType: "t3.large",
    family: "t3",
    familyName: "General purpose",
    vCpus: 2,
    memory: 8,
    price: 2,
    generation: 1,
  },
];

const apply = (opts, pool = POOL, provider = "aws") =>
  RuleEngine.apply(
    pool,
    { reqCpu: 2, reqMemory: 8, rowCpuUtil: 10, rowMemoryUtil: 10, ...opts },
    provider,
  );

const firstOf = (r) => r.instances[0] && r.instances[0].instanceType;
const fired = (r) => r.rules.some((x) => /Burstable preferred/i.test(x));

check(
  "premise: the non-burstable is cheaper, so it leads by default",
  POOL[0].price < POOL[1].price,
);
check(
  "premise: with no ENV the burstable does NOT lead",
  firstOf(apply({ rowEnv: "" })) === "m7i.large",
  firstOf(apply({ rowEnv: "" })),
);

console.log("[Dev/Test at low utilization prefers burstable]");
for (const env of ["Dev", "Test", "Development", "QA", "testing"]) {
  const r = apply({ rowEnv: env });
  check(
    `${env} puts the burstable first`,
    firstOf(r) === "t3.large" && fired(r),
    `${firstOf(r)} | ${r.rules.join(" | ")}`,
  );
}

console.log("[Production and Staging are untouched — 1a owns them]");
for (const env of ["Production", "Staging"]) {
  const r = apply({ rowEnv: env });
  check(
    `${env} excludes burstable rather than preferring it`,
    firstOf(r) === "m7i.large" && !fired(r),
    `${firstOf(r)} | ${r.rules.join(" | ")}`,
  );
  check(
    `${env} still reports the 1a exclusion`,
    r.rules.some((x) => /1a: Burstable excluded/.test(x)),
    r.rules.join(" | "),
  );
}

console.log("[utilization has to actually be low, and actually be known]");
check(
  "a busy Dev box keeps the normal cheapest-adequate pick",
  firstOf(apply({ rowEnv: "Dev", rowCpuUtil: 85, rowMemoryUtil: 85 })) ===
    "m7i.large",
);
check(
  "high memory alone is enough to withhold the preference",
  firstOf(apply({ rowEnv: "Dev", rowCpuUtil: 10, rowMemoryUtil: 90 })) ===
    "m7i.large",
  "a box idle on CPU but not memory is not an idle box",
);
// The one that matters: no reading must not read as "idle".
const unknown = apply({ rowEnv: "Dev", rowCpuUtil: 0, rowMemoryUtil: 0 });
check(
  "unknown utilization does NOT count as low",
  firstOf(unknown) === "m7i.large" && !fired(unknown),
  `${firstOf(unknown)} | ${unknown.rules.join(" | ")}`,
);
check(
  "a row carrying only one of the two readings is still judged on it",
  firstOf(apply({ rowEnv: "Dev", rowCpuUtil: 10, rowMemoryUtil: 0 })) ===
    "t3.large",
);
// ...but only when that reading is CPU. Burstable families are CPU-credit-
// limited, so a low MEMORY reading while CPU is UNMEASURED is not evidence the
// box idles — the preference must withhold, or a possibly-hot box gets a
// credit-limited instance on memory evidence alone.
const cpuBlind = apply({ rowEnv: "Dev", rowCpuUtil: 0, rowMemoryUtil: 10 });
check(
  "low memory with CPU unmeasured does NOT prefer burstable",
  firstOf(cpuBlind) === "m7i.large" && !fired(cpuBlind),
  `${firstOf(cpuBlind)} | ${cpuBlind.rules.join(" | ")}`,
);

console.log("[the run's own threshold defines low, not a number of our own]");
check(
  "35% is low under the default 40 threshold",
  firstOf(apply({ rowEnv: "Dev", rowCpuUtil: 35, rowMemoryUtil: 35 })) ===
    "t3.large",
);
check(
  "the same 35% is NOT low when the run lowered the threshold to 20",
  firstOf(
    apply({
      rowEnv: "Dev",
      rowCpuUtil: 35,
      rowMemoryUtil: 35,
      cpuDownsizeMax: 20,
      memoryDownsizeMax: 20,
    }),
  ) === "m7i.large",
);
check(
  "and IS low when the run raised it to 60",
  firstOf(
    apply({
      rowEnv: "Dev",
      rowCpuUtil: 55,
      rowMemoryUtil: 55,
      cpuDownsizeMax: 60,
      memoryDownsizeMax: 60,
    }),
  ) === "t3.large",
);

console.log("[an explicit workload preference still wins]");
// Workload sorts last, so a Dev database asking for memory-optimized is not
// silently handed a burstable box instead.
const DB_POOL = [
  ...POOL,
  {
    instanceType: "r7i.large",
    family: "r7i",
    familyName: "Memory optimized",
    vCpus: 2,
    memory: 16,
    price: 3,
    generation: 1,
  },
];
const dbRow = apply({ rowEnv: "Dev", rowWorkload: "Database" }, DB_POOL);
check(
  "a Dev database leads with the memory-optimized family, not the burstable",
  firstOf(dbRow) === "r7i.large",
  `${firstOf(dbRow)} | ${dbRow.rules.join(" | ")}`,
);
check(
  "and both rules are reported, so the interaction is visible",
  fired(dbRow) && dbRow.rules.some((x) => /database preference/i.test(x)),
  dbRow.rules.join(" | "),
);
// A general/blank workload does not sort at all, which is where BP does its work.
check(
  "a general Dev workload still gets the burstable",
  firstOf(apply({ rowEnv: "Dev", rowWorkload: "General" })) === "t3.large",
);

console.log("[it is a preference, never a filter]");
const devRow = apply({ rowEnv: "Dev" });
check(
  "no candidate is removed — the non-burstable is still available",
  devRow.instances.length === 2,
  String(devRow.instances.length),
);
const noBurstable = apply({ rowEnv: "Dev" }, [POOL[0]]);
check(
  "a pool with no burstable member returns normally and claims nothing",
  firstOf(noBurstable) === "m7i.large" && !fired(noBurstable),
  noBurstable.rules.join(" | "),
);
// An oversized burstable must not be dragged forward: the fit bound applies
// here exactly as it does to the workload preference.
const bigBurstable = [
  POOL[0],
  {
    instanceType: "t3.16xlarge",
    family: "t3",
    familyName: "General purpose",
    vCpus: 64,
    memory: 256,
    price: 2,
    generation: 1,
  },
];
check(
  "a hugely oversized burstable is not preferred into first place",
  firstOf(apply({ rowEnv: "Dev" }, bigBurstable)) === "m7i.large",
  firstOf(apply({ rowEnv: "Dev" }, bigBurstable)),
);
// And when BOTH an oversized and a right-sized burstable are present, the
// right-sized one leads. Without this case the bound inside the sort is
// untested: the guard above already refuses a pool whose ONLY burstable is
// oversized, so that check alone passes even with the bound removed.
const mixedBurstable = [
  POOL[0],
  {
    instanceType: "t3.16xlarge",
    family: "t3",
    familyName: "General purpose",
    vCpus: 64,
    memory: 256,
    price: 0.5,
    generation: 1,
  },
  POOL[1],
];
check(
  "the right-sized burstable leads, not the oversized one that is cheaper",
  firstOf(apply({ rowEnv: "Dev" }, mixedBurstable)) === "t3.large",
  firstOf(apply({ rowEnv: "Dev" }, mixedBurstable)),
);

process.exit(state.failures ? 1 : 0);

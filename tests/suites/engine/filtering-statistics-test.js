// getFilteringStatistics is what the generation log and window.getProviderStatistics
// report about a loaded catalogue. Each provider adds its own counters to a common
// core (totals, generation, processor and family-name breakdowns, percentages), so
// this pins the whole shape per provider against a small hand-counted fixture.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx, run } = buildContext();

const stats = (cls, regions) => {
  ctx.__regions = regions;
  return run(
    `(function () { const s = new ${cls}(); s.instanceData = __regions; return JSON.parse(JSON.stringify(s.getFilteringStatistics())); })()`,
  );
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("[AWS]");
{
  const s = stats("AWSInstanceSelector", {
    r1: [
      {
        instanceType: "m5.large",
        generation: 1.0,
        processor: "Intel",
        familyName: "General purpose",
        isGraviton: 0,
        nitroSupport: 1,
      },
      {
        instanceType: "t4g.small",
        generation: "1.0",
        processor: "AWS",
        familyName: "General purpose",
        isGraviton: 1,
        nitroSupport: 0,
      },
    ],
    r2: [
      {
        instanceType: "m1.small",
        generation: 0,
        processor: "",
        familyName: "",
        isGraviton: 0,
        nitroSupport: 1.0,
      },
    ],
  });
  check(
    "totals and generation",
    s.totalInstances === 3 &&
      s.currentGeneration === 2 &&
      s.previousGeneration === 1,
  );
  check(
    "processor and family-name breakdowns (blank is Unknown)",
    same(s.processorBreakdown, { Intel: 1, AWS: 1, Unknown: 1 }) &&
      same(s.familyNameBreakdown, { "General purpose": 2, Unknown: 1 }),
    JSON.stringify([s.processorBreakdown, s.familyNameBreakdown]),
  );
  check(
    "graviton and nitro counts",
    s.gravitonInstances === 1 && s.nitroInstances === 2,
  );
  check(
    "percentages",
    s.currentGenerationPercentage === "66.7" &&
      s.gravitonPercentage === "33.3" &&
      s.nitroPercentage === "66.7",
    JSON.stringify([
      s.currentGenerationPercentage,
      s.gravitonPercentage,
      s.nitroPercentage,
    ]),
  );
  check(
    "capabilities are reported",
    s.filteringCapabilities.nitroFilter === true &&
      s.filteringCapabilities.mainFamilyFilter === true,
  );
  const empty = stats("AWSInstanceSelector", {});
  check(
    "an empty catalogue reports zeros, not NaN",
    empty.totalInstances === 0 &&
      empty.currentGenerationPercentage === 0 &&
      empty.gravitonPercentage === 0 &&
      empty.nitroPercentage === 0,
    JSON.stringify(empty),
  );
}

console.log("[Azure]");
{
  const s = stats("AzureInstanceSelector", {
    r1: [
      {
        instanceType: "d4sv5",
        generation: 1,
        processor: "Intel",
        familyName: "General purpose",
        isGraviton: 0,
      },
      {
        instanceType: "d2sv3",
        generation: 0,
        processor: "AMD",
        familyName: "General purpose",
        isGraviton: 1,
      },
    ],
    r2: [
      {
        instanceType: "nv6",
        generation: "1.0",
        processor: "ARM",
        familyName: "",
        isGraviton: 0,
      },
    ],
  });
  check(
    "totals and generation",
    s.totalInstances === 3 &&
      s.currentGeneration === 2 &&
      s.previousGeneration === 1,
  );
  check(
    "processor, family-name and VM-series breakdowns",
    same(s.processorBreakdown, { Intel: 1, AMD: 1, ARM: 1 }) &&
      same(s.familyNameBreakdown, { "General purpose": 2, Unknown: 1 }) &&
      same(s.vmSeriesBreakdown, { D: 2, NV: 1 }),
    JSON.stringify([
      s.processorBreakdown,
      s.familyNameBreakdown,
      s.vmSeriesBreakdown,
    ]),
  );
  check("ARM count covers the flag and the processor", s.armInstances === 2);
  check(
    "percentages",
    s.currentGenerationPercentage === "66.7" && s.armPercentage === "66.7",
    JSON.stringify([s.currentGenerationPercentage, s.armPercentage]),
  );
  const empty = stats("AzureInstanceSelector", {});
  check(
    "an empty catalogue reports zeros",
    empty.totalInstances === 0 &&
      empty.currentGenerationPercentage === 0 &&
      empty.armPercentage === 0,
  );
}

console.log("[GCP]");
{
  const s = stats("GCPInstanceSelector", {
    r1: [
      {
        instanceType: "n2-standard-4",
        generation: 1,
        processor: "Intel",
        familyName: "General purpose",
        isGraviton: 0,
      },
      {
        instanceType: "t2a-standard-2",
        generation: 0,
        processor: "ARM",
        familyName: "General purpose",
        isGraviton: 0,
      },
    ],
    r2: [
      {
        instanceType: "e2-micro",
        generation: "1.0",
        processor: "AMD",
        familyName: "",
        isGraviton: 0,
      },
    ],
  });
  check(
    "totals and generation",
    s.totalInstances === 3 &&
      s.currentGeneration === 2 &&
      s.previousGeneration === 1,
  );
  check(
    "processor, family-name, series and category breakdowns",
    same(s.processorBreakdown, { Intel: 1, ARM: 1, AMD: 1 }) &&
      same(s.familyNameBreakdown, { "General purpose": 2, Unknown: 1 }) &&
      same(s.machineSeriesBreakdown, { n2: 1, t2a: 1, e2: 1 }) &&
      same(s.machineCategoryBreakdown, { standard: 2, "shared-core": 1 }),
    JSON.stringify([s.machineSeriesBreakdown, s.machineCategoryBreakdown]),
  );
  check(
    "ARM and shared-core counts",
    s.armInstances === 1 && s.sharedCoreInstances === 1,
  );
  check(
    "percentages",
    s.currentGenerationPercentage === "66.7" &&
      s.armPercentage === "33.3" &&
      s.sharedCorePercentage === "33.3",
    JSON.stringify([
      s.currentGenerationPercentage,
      s.armPercentage,
      s.sharedCorePercentage,
    ]),
  );
  const empty = stats("GCPInstanceSelector", {});
  check(
    "an empty catalogue reports zeros",
    empty.totalInstances === 0 &&
      empty.armPercentage === 0 &&
      empty.sharedCorePercentage === 0,
  );
}

if (state.failures) {
  console.error(`\nfiltering-statistics: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nfiltering-statistics: all checks passed");
  process.exitCode = 0;
}

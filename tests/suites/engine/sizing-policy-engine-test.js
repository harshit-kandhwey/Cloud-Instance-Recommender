// Sizing policy in a run (3.21 phase 7): with "Size against: per-row policy" each row
// is sized on the statistic its ENV, Criticality and Workload select. The same bursty
// VM must size differently in Production and in Dev, the reason must be recorded per
// row, and a run that does not ask for the policy must be untouched.
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx } = buildContext();
const run = (expr) => vm.runInContext(expr, ctx, { filename: "policy-engine" });

const BASE = {
  generateLikeToLike: false,
  generateOptimized: true,
  cpuBased: true,
  memoryBased: true,
  cpuDownsizeMax: 40,
  memoryDownsizeMax: 40,
  cpuUpsizeMin: 80,
  memoryUpsizeMin: 80,
};

// One bursty 8-vCPU VM: 20% on average, 85% at p95, 95% at p99.
const vmRow = (extra) => ({
  "VM Name": "bursty",
  "CPU Count": "8",
  "Memory (GB)": "32",
  "AWS Region": "us-east-1",
  "CPU Utilization": "20",
  "Memory Utilization": "20",
  "CPU Utilization p95": "85",
  "Memory Utilization p95": "85",
  "CPU Utilization p99": "95",
  "Memory Utilization p99": "95",
  ...extra,
});

async function sized(rows, options) {
  ctx.__rows = rows;
  ctx.__opts = { ...BASE, ...options };
  const out = await run(
    "getInstanceRecommendationWithSelector(__rows, ['aws'], __opts)",
  );
  return out[0];
}
const vcpus = (r) => parseInt(r["AWS Optimized vCPUs"], 10);
const policyRun = { utilizationStatistic: "policy" };

(async () => {
  try {
    console.log("[the same VM sizes differently by ENV]");
    const prod = await sized(
      [vmRow({ ENV: "Production", Criticality: "Critical" })],
      policyRun,
    );
    const dev = await sized(
      [vmRow({ ENV: "Dev", Criticality: "Critical" })],
      policyRun,
    );
    check(
      "premise: both rows produced a recommendation",
      Number.isFinite(vcpus(prod)) && Number.isFinite(vcpus(dev)),
      `prod=${prod["AWS Optimized Instance"]} dev=${dev["AWS Optimized Instance"]}`,
    );
    check(
      "a Production critical VM is sized on p99 and is not downsized",
      vcpus(prod) >= 8,
      `${prod["AWS Optimized Instance"]} (${vcpus(prod)} vCPU)`,
    );
    check(
      "the identical VM in Dev is capped to the average and is downsized",
      vcpus(dev) < 8,
      `${dev["AWS Optimized Instance"]} (${vcpus(dev)} vCPU)`,
    );
    check(
      "the two genuinely disagree",
      vcpus(prod) !== vcpus(dev),
      `${vcpus(prod)} vs ${vcpus(dev)}`,
    );

    console.log("[Sized On records why]");
    check(
      "Production names its statistic and the policy reason",
      prod["Sized On"].startsWith("CPU: p99, Mem: p95") ||
        prod["Sized On"].startsWith("p99"),
      prod["Sized On"],
    );
    check(
      "the reason names the ENV, the criticality and the statistic chosen",
      prod["Sized On"].includes("policy: production + critical → p99"),
      prod["Sized On"],
    );
    check(
      "Dev says it was capped, and by what",
      dev["Sized On"].startsWith("Average") &&
        dev["Sized On"].includes("capped by dev to avg"),
      dev["Sized On"],
    );

    console.log("[CPU and memory carry different defaults]");
    check(
      "CPU is sized on p99 while memory is held at p95",
      prod["Sized On"].startsWith("CPU: p99, Mem: p95"),
      prod["Sized On"],
    );

    console.log("[a row missing the wanted statistic falls back, and says so]");
    const noP99 = vmRow({ ENV: "Production", Criticality: "Critical" });
    delete noP99["CPU Utilization p99"];
    delete noP99["Memory Utilization p99"];
    const fell = await sized([noP99], policyRun);
    check(
      "p99 wanted but absent: uses p95, marked as a fallback, reason still recorded",
      fell["Sized On"].startsWith("CPU: p95 (fallback), Mem: p95") &&
        fell["Sized On"].includes("policy: production + critical → p99"),
      fell["Sized On"],
    );

    console.log(
      "[the row's ENV comes from the page default when the cell is blank]",
    );
    const defaulted = await sized(
      [vmRow({ ENV: "", Criticality: "Critical" })],
      { ...policyRun, ruleDefaultEnv: "Dev" },
    );
    check(
      "a blank ENV cell with the page default Dev is capped as Dev",
      vcpus(defaulted) < 8 && defaulted["Sized On"].includes("dev + critical"),
      defaulted["Sized On"],
    );
    const unknown = await sized(
      [vmRow({ Criticality: "Critical" })],
      policyRun,
    );
    check(
      "no ENV anywhere is capped like Production, and the reason says it assumed",
      vcpus(unknown) >= 8 && unknown["Sized On"].includes("ENV not recognised"),
      unknown["Sized On"],
    );

    console.log("[the policy in the options is the one used]");
    const lenient = await sized(
      [vmRow({ ENV: "Dev", Criticality: "Critical" })],
      {
        ...policyRun,
        sizingPolicy: {
          v: 1,
          envCeiling: { production: "peak", staging: "p95", dev: "p99" },
        },
      },
    );
    check(
      "a policy that lets Dev reach p99 stops the downsize",
      vcpus(lenient) >= 8,
      `${lenient["AWS Optimized Instance"]} (${vcpus(lenient)} vCPU) ${lenient["Sized On"]}`,
    );

    console.log("[a run that does not ask for the policy is untouched]");
    const explicit = await sized(
      [vmRow({ ENV: "Production", Criticality: "Critical" })],
      { utilizationStatistic: "avg" },
    );
    check(
      "an average run ignores ENV and Criticality and carries no policy text",
      vcpus(explicit) < 8 && !explicit["Sized On"].includes("policy"),
      explicit["Sized On"],
    );

    console.log("[the safety veto holds a downsize against a saturating VM]");
    // A Dev VM sizes on the average (20%), so it would be halved. The veto looks at the
    // row's OWN Peak and p95 as a second metric and holds the downsize when either says
    // the VM is saturating, flagging it for manual review instead.
    const devRow = (extra) =>
      vmRow({ ENV: "Dev", Criticality: "Critical", ...extra });
    const calm = devRow({});
    delete calm["CPU Utilization p99"];
    const base = await sized([calm], policyRun);
    check(
      "premise: with no reading near saturation the Dev VM is downsized and not flagged",
      vcpus(base) < 8 && base["Review Flag"] === "",
      `${vcpus(base)} vCPU, flag="${base["Review Flag"]}"`,
    );
    const spike = await sized(
      [devRow({ "CPU Utilization Peak": "97" })],
      policyRun,
    );
    check(
      "a Peak of 97% holds the CPU downsize and says why",
      vcpus(spike) >= 8 &&
        spike["Review Flag"].includes("CPU downsize held for review") &&
        spike["Review Flag"].includes("Peak 97%"),
      `${vcpus(spike)} vCPU, flag="${spike["Review Flag"]}"`,
    );
    const saturated = await sized(
      [devRow({ "CPU Utilization p95": "88" })],
      policyRun,
    );
    check(
      "a p95 above 85% holds it too, naming the p95",
      vcpus(saturated) >= 8 &&
        saturated["Review Flag"].includes("p95 88% is above 85%"),
      `${vcpus(saturated)} vCPU, flag="${saturated["Review Flag"]}"`,
    );
    const atP95 = await sized(
      [devRow({ "CPU Utilization p95": "85" })],
      policyRun,
    );
    const underPeak = await sized(
      [devRow({ "CPU Utilization Peak": "94" })],
      policyRun,
    );
    const atPeak = await sized(
      [devRow({ "CPU Utilization Peak": "95" })],
      policyRun,
    );
    check(
      "the edges: p95 of exactly 85 and a Peak of 94 do not hold; a Peak of exactly 95 does",
      atP95["Review Flag"] === "" &&
        underPeak["Review Flag"] === "" &&
        atPeak["Review Flag"] !== "",
      `${atP95["Review Flag"]} | ${underPeak["Review Flag"]} | ${atPeak["Review Flag"]}`,
    );
    const memOnly = await sized(
      [devRow({ "Memory Utilization Peak": "98" })],
      policyRun,
    );
    check(
      "only the saturating dimension is flagged: memory is named, CPU is not",
      memOnly["Review Flag"].includes("Memory downsize held") &&
        !memOnly["Review Flag"].includes("CPU"),
      memOnly["Review Flag"],
    );
    const both = await sized(
      [
        devRow({
          "CPU Utilization Peak": "97",
          "Memory Utilization Peak": "98",
        }),
      ],
      policyRun,
    );
    check(
      "both dimensions can be held and are both named",
      both["Review Flag"].includes("CPU downsize held") &&
        both["Review Flag"].includes("Memory downsize held"),
      both["Review Flag"],
    );
    const prodSpike = await sized(
      [
        vmRow({
          ENV: "Production",
          Criticality: "Critical",
          "CPU Utilization Peak": "99",
        }),
      ],
      policyRun,
    );
    check(
      "a row that is not being downsized anyway is not flagged, whatever its Peak",
      prodSpike["Review Flag"] === "",
      prodSpike["Review Flag"],
    );
    const loose = await sized([devRow({ "CPU Utilization Peak": "97" })], {
      ...policyRun,
      sizingPolicy: { v: 1, veto: { peakMin: 99 } },
    });
    check(
      "the thresholds come from the policy: a Peak of 97 no longer holds at peakMin 99",
      loose["Review Flag"] === "" && vcpus(loose) < 8,
      `${vcpus(loose)} vCPU, flag="${loose["Review Flag"]}"`,
    );

    console.log("[the selector keeps a held dimension's size]");
    // Asserted on the sizing target the selector computes, not on the instance picked:
    // the cheapest instance meeting a target can have more vCPUs than the target.
    ctx.__sel = run("InstanceSelectorFactory.createSelector('aws')");
    const target = (cpuUtil, memUtil, hold) => {
      ctx.__o = { ...BASE, ...hold };
      ctx.__u = [cpuUtil, memUtil];
      return run(
        "__sel.getOptimizedInstance('us-east-1', 8, 32, __u[0], __u[1], __o)",
      ).reason;
    };
    check(
      "with no hold both dimensions halve",
      target(20, 20, {}).includes("to 4vCPU/16GB"),
      target(20, 20, {}),
    );
    check(
      "holdCpuDownsize keeps the CPU and still halves memory",
      target(20, 20, { holdCpuDownsize: true }).includes("to 8vCPU/16GB"),
      target(20, 20, { holdCpuDownsize: true }),
    );
    check(
      "holdMemoryDownsize keeps the memory and still halves the CPU",
      target(20, 20, { holdMemoryDownsize: true }).includes("to 4vCPU/32GB"),
      target(20, 20, { holdMemoryDownsize: true }),
    );
    check(
      "holding both keeps both",
      target(20, 20, {
        holdCpuDownsize: true,
        holdMemoryDownsize: true,
      }).includes("to 8vCPU/32GB"),
    );
    check(
      "a hold never blocks an upsize: a busy VM still goes to N+1",
      target(90, 90, {
        holdCpuDownsize: true,
        holdMemoryDownsize: true,
      }).includes("to 9vCPU/33GB"),
      target(90, 90, { holdCpuDownsize: true, holdMemoryDownsize: true }),
    );

    console.log("[the veto is a per-row policy feature only]");
    const explicitSpike = await sized(
      [devRow({ "CPU Utilization Peak": "97" })],
      { utilizationStatistic: "avg" },
    );
    check(
      "an explicit-statistic run still downsizes the same VM and carries no Review Flag column",
      vcpus(explicitSpike) < 8 && !("Review Flag" in explicitSpike),
      Object.keys(explicitSpike).join(","),
    );
    const likeOnly = await sized([devRow({})], {
      ...policyRun,
      generateOptimized: false,
      generateLikeToLike: true,
    });
    check(
      "a like-to-like-only policy run has no Review Flag column, as it has no Sized On",
      !("Review Flag" in likeOnly),
    );
    check(
      "every row of an optimized policy run carries the column, blank when nothing was held",
      "Review Flag" in prod && prod["Review Flag"] === "",
      Object.keys(prod).join(","),
    );

    console.log("[a missing module fails loudly]");
    run(
      "globalThis.__saved = resolvePolicyStatistic; resolvePolicyStatistic = undefined;",
    );
    let message = "";
    try {
      await sized([vmRow({ ENV: "Production" })], policyRun);
    } catch (e) {
      message = String((e && e.message) || e);
    }
    run("resolvePolicyStatistic = globalThis.__saved;");
    check(
      "the run refuses rather than sizing every row on the average",
      message.includes("sizing policy module is not loaded"),
      message,
    );

    console.log("[an invalid policy fails the run and names the problem]");
    let invalid = "";
    try {
      await sized([vmRow({ ENV: "Production" })], {
        ...policyRun,
        sizingPolicy: { v: 1, memoryCeiling: "p97" },
      });
    } catch (e) {
      invalid = String((e && e.message) || e);
    }
    check(
      "a bad cell stops the run rather than silently using the default for it",
      invalid.includes("not valid") && invalid.includes("memoryCeiling"),
      invalid,
    );
    let oldVersion = "";
    try {
      await sized([vmRow({ ENV: "Production" })], {
        ...policyRun,
        sizingPolicy: { v: 7 },
      });
    } catch (e) {
      oldVersion = String((e && e.message) || e);
    }
    check(
      "a policy from another version stops the run too",
      oldVersion.includes("not valid") && oldVersion.includes("version"),
      oldVersion,
    );
  } catch (e) {
    check("the policy runs complete without throwing", false, e && e.stack);
  }
  process.exitCode = state.failures ? 1 : 0;
})();

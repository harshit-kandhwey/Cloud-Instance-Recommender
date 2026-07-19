// Percentile / peak utilization (js/base/instance-selector-factory.js):
// which statistic a run sizes against, and what happens to a row that does not
// carry it.
//
// The point of the feature is that an AVERAGE hides bursts. A VM averaging 20%
// looks like a downsize candidate; the same VM at p95 85% is not one, and
// shipping the downsize would under-provision it in production. So the load-
// bearing test here is not "the option is read" — it is that the SAME row
// produces a DIFFERENT target under avg than under p95.
//
// resolveUtilization lives in the factory rather than app-core.js on purpose:
// app-core.js is not in recommendation-worker.js's importScripts list, so a
// resolver defined there would throw on every worker run. step3-test covers the
// worker end to end; this suite covers the resolution rules.
const vm = require("vm");
const { buildContext, makeChecker } = require("./harness");

const { check, state } = makeChecker();
const { ctx } = buildContext();
const run = (expr) => vm.runInContext(expr, ctx, { filename: "pct-util" });

// ── resolveUtilization: which statistic wins, and when it falls back ──────────
console.log("[the requested statistic is used when the row carries it]");
const resolve = (row, want) => {
  ctx.__row = row;
  ctx.__want = want;
  return run("resolveUtilization(__row, __want)");
};

const full = {
  "CPU Utilization": "20",
  "Memory Utilization": "30",
  "CPU Utilization p95": "85",
  "Memory Utilization p95": "70",
  "CPU Utilization Peak": "97",
  "Memory Utilization Peak": "91",
};

check(
  "avg reads the average columns",
  resolve(full, "avg").cpu === 20 && resolve(full, "avg").memory === 30,
  JSON.stringify(resolve(full, "avg")),
);
check(
  "p95 reads the p95 columns",
  resolve(full, "p95").cpu === 85 && resolve(full, "p95").memory === 70,
  JSON.stringify(resolve(full, "p95")),
);
check(
  "peak reads the peak columns",
  resolve(full, "peak").cpu === 97 && resolve(full, "peak").memory === 91,
  JSON.stringify(resolve(full, "peak")),
);
check(
  "nothing is flagged as a fallback when the statistic was present",
  !resolve(full, "p95").fellBack && resolve(full, "p95").statistic === "p95",
);

console.log("[a row missing the requested statistic falls back, and says so]");
const avgOnly = { "CPU Utilization": "20", "Memory Utilization": "30" };
const r1 = resolve(avgOnly, "p95");
check(
  "p95 requested but absent → uses the average",
  r1.cpu === 20 && r1.statistic === "avg" && r1.fellBack === true,
  JSON.stringify(r1),
);

// Preferring the HIGHER statistic first is the deliberate rule: falling to a
// LOWER number than requested would under-provision.
const p95AndPeak = {
  "CPU Utilization p95": "85",
  "Memory Utilization p95": "70",
  "CPU Utilization Peak": "97",
  "Memory Utilization Peak": "91",
};
const r2 = resolve(p95AndPeak, "avg");
check(
  "average absent → prefers p95 over peak, rather than the lowest available",
  r2.statistic === "p95" && r2.cpu === 85 && r2.fellBack === true,
  JSON.stringify(r2),
);
const peakOnly = { "CPU Utilization Peak": "97" };
const r3 = resolve(peakOnly, "p95");
check(
  "p95 absent → falls to peak before average",
  r3.statistic === "peak" && r3.cpu === 97,
  JSON.stringify(r3),
);

console.log("[blank and junk values never win over a populated column]");
const blankP95 = {
  "CPU Utilization": "20",
  "Memory Utilization": "30",
  "CPU Utilization p95": "",
  "Memory Utilization p95": "   ",
};
const r4 = resolve(blankP95, "p95");
check(
  "an empty p95 column does not beat a populated average",
  r4.statistic === "avg" && r4.cpu === 20,
  JSON.stringify(r4),
);
check(
  "a non-numeric cell is ignored, not treated as 0-and-present",
  resolve({ "CPU Utilization p95": "n/a", "CPU Utilization": "20" }, "p95")
    .statistic === "avg",
);
check(
  "a negative reading is ignored",
  resolve({ "CPU Utilization p95": "-5", "CPU Utilization": "20" }, "p95")
    .statistic === "avg",
);
check(
  "a row with no utilization at all resolves to zero, not a crash",
  resolve({ "VM Name": "x" }, "p95").cpu === 0 &&
    resolve({ "VM Name": "x" }, "p95").fellBack === false,
);
check(
  "an unknown statistic name degrades to the average rather than throwing",
  resolve(full, "nonsense").statistic === "avg" &&
    resolve(full, undefined).statistic === "avg",
);
// Keys come from untrusted CSV headers, so the lookup must not reach the
// prototype chain.
check(
  "a prototype-chain key cannot masquerade as a reading",
  resolve({}, "constructor").statistic === "avg",
);

// ── The behaviour that justifies the feature ─────────────────────────────────
// One bursty VM: 8 vCPU, average 20% (a downsize candidate), p95 85% (not one).
// Under avg the N/2 rule targets 4 vCPU; under p95 the N+1 rule targets 9.
console.log("[the same bursty row sizes differently under avg and p95]");
const OPTS = {
  generateLikeToLike: false,
  generateOptimized: true,
  cpuBased: true,
  memoryBased: true,
  cpuDownsizeMax: 40,
  memoryDownsizeMax: 40,
  cpuUpsizeMin: 80,
  memoryUpsizeMin: 80,
};
ctx.__bursty = [
  {
    "VM Name": "bursty",
    "CPU Count": "8",
    "Memory (GB)": "32",
    "AWS Region": "us-east-1",
    "CPU Utilization": "20",
    "Memory Utilization": "20",
    "CPU Utilization p95": "85",
    "Memory Utilization p95": "85",
  },
];

(async () => {
  const runWith = async (stat) => {
    ctx.__opts = { ...OPTS, utilizationStatistic: stat };
    const out = await run(
      "getInstanceRecommendationWithSelector(__bursty, ['aws'], __opts)",
    );
    return out[0];
  };

  try {
    const onAvg = await runWith("avg");
    const onP95 = await runWith("p95");

    const avgCpus = parseInt(onAvg["AWS Optimized vCPUs"], 10);
    const p95Cpus = parseInt(onP95["AWS Optimized vCPUs"], 10);

    check(
      "premise: both runs produced a real recommendation",
      Number.isFinite(avgCpus) && Number.isFinite(p95Cpus),
      `avg=${onAvg["AWS Optimized Instance"]} p95=${onP95["AWS Optimized Instance"]}`,
    );
    check(
      "sizing on the average downsizes the bursty VM",
      avgCpus < 8,
      `avg → ${onAvg["AWS Optimized Instance"]} (${avgCpus} vCPU)`,
    );
    check(
      "sizing on p95 does NOT downsize it — the burst is visible",
      p95Cpus >= 8,
      `p95 → ${onP95["AWS Optimized Instance"]} (${p95Cpus} vCPU)`,
    );
    check(
      "the two statistics genuinely disagree for this row",
      avgCpus !== p95Cpus,
      `avg=${avgCpus} p95=${p95Cpus}`,
    );

    // ── The Sized On column ──────────────────────────────────────────────────
    console.log("[Sized On reports the basis actually used]");
    check(
      "the statistic that sized the row is named",
      onAvg["Sized On"] === "Average" && onP95["Sized On"] === "p95",
      `avg="${onAvg["Sized On"]}" p95="${onP95["Sized On"]}"`,
    );

    ctx.__avgOnly = [{ ...ctx.__bursty[0] }];
    delete ctx.__avgOnly[0]["CPU Utilization p95"];
    delete ctx.__avgOnly[0]["Memory Utilization p95"];
    ctx.__opts = { ...OPTS, utilizationStatistic: "p95" };
    const fellBack = (
      await run(
        "getInstanceRecommendationWithSelector(__avgOnly, ['aws'], __opts)",
      )
    )[0];
    check(
      "a row that fell back is marked, not silently reported as p95",
      fellBack["Sized On"] === "Average (fallback)",
      `"${fellBack["Sized On"]}"`,
    );

    // Schema parity: the column belongs to the optimized pass only.
    ctx.__opts = { generateLikeToLike: true, generateOptimized: false };
    const l2lOnly = (
      await run(
        "getInstanceRecommendationWithSelector(__bursty, ['aws'], __opts)",
      )
    )[0];
    check(
      "a like-to-like-only run carries no Sized On column",
      !Object.keys(l2lOnly).includes("Sized On"),
      Object.keys(l2lOnly)
        .filter((k) => /Sized/.test(k))
        .join(","),
    );
  } catch (e) {
    check("the sizing runs complete without throwing", false, e && e.message);
  }

  process.exit(state.failures ? 1 : 0);
})();

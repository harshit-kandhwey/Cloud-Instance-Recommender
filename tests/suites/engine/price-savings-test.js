// results.priceSavings (src/core/engine/instance-selector-factory.js): the one
// place in the codebase that computes an absolute price at all — an aggregate,
// per-provider relative percentage, attached to the ARRAY (never a row), added
// when CLAUDE.md rule 7 ("no pricing in outputs") was reversed 2026-09-14. See
// docs/data/CANONICAL-SOURCES.md and ROADMAP.md's 3.17.
const { buildContext, makeChecker } = require("../harness");
const vm = require("vm");

const { check, state } = makeChecker();

(async () => {
  try {
    const { ctx } = buildContext({
      dataScript: "src/providers/aws/aws-data.js",
    });

    // Low utilization -> the optimized pass downsizes -> a cheaper instance,
    // so the aggregate should read POSITIVE ("lower ranked cost").
    ctx.__downsizeRows = [
      {
        "VM Name": "idle-01",
        "CPU Count": "16",
        "Memory (GB)": "64",
        "CPU Utilization": "5",
        "Memory Utilization": "5",
        "AWS Region": "us-east-1",
      },
    ];
    // High utilization -> the optimized pass upsizes -> a pricier instance,
    // so the aggregate should read NEGATIVE ("higher ranked cost").
    ctx.__upsizeRows = [
      {
        "VM Name": "busy-01",
        "CPU Count": "2",
        "Memory (GB)": "4",
        "CPU Utilization": "95",
        "Memory Utilization": "95",
        "AWS Region": "us-east-1",
      },
    ];
    ctx.__opts = {
      generateLikeToLike: true,
      generateOptimized: true,
      cpuBased: true,
      memoryBased: true,
      cpuDownsizeMax: 40,
      memoryDownsizeMax: 40,
      cpuUpsizeMin: 80,
      memoryUpsizeMin: 80,
    };

    console.log("[a downsize reports a positive relative percentage]");
    const downsized = await vm.runInContext(
      "getInstanceRecommendationWithSelector(__downsizeRows, ['aws'], __opts)",
      ctx,
      { filename: "price-savings-downsize" },
    );
    check(
      "results.priceSavings carries an AWS entry",
      downsized.priceSavings && typeof downsized.priceSavings.AWS === "object",
      JSON.stringify(downsized.priceSavings),
    );
    if (downsized.priceSavings && downsized.priceSavings.AWS) {
      check(
        "the downsize's percentage is positive (optimized ranks lower)",
        downsized.priceSavings.AWS.pct > 0,
        `pct=${downsized.priceSavings.AWS.pct}`,
      );
      check(
        "and it covers exactly the one comparable row",
        downsized.priceSavings.AWS.rows === 1,
        `rows=${downsized.priceSavings.AWS.rows}`,
      );
    }
    check(
      "the row object itself carries no price field of any kind",
      !Object.keys(downsized[0]).some((k) => /price/i.test(k)),
      JSON.stringify(Object.keys(downsized[0])),
    );

    console.log("[an upsize reports a negative relative percentage]");
    const upsized = await vm.runInContext(
      "getInstanceRecommendationWithSelector(__upsizeRows, ['aws'], __opts)",
      ctx,
      { filename: "price-savings-upsize" },
    );
    check(
      "the upsize fixture produces a comparable AWS entry",
      upsized.priceSavings && typeof upsized.priceSavings.AWS === "object",
      JSON.stringify(upsized.priceSavings),
    );
    if (upsized.priceSavings && upsized.priceSavings.AWS) {
      check(
        "the upsize's percentage is negative (optimized ranks higher)",
        upsized.priceSavings.AWS.pct < 0,
        `pct=${upsized.priceSavings.AWS.pct}`,
      );
    }

    console.log(
      "[optimized-only run (no Like-to-Like pass) produces no priceSavings entry]",
    );
    ctx.__optOnlyOpts = { generateLikeToLike: false, generateOptimized: true };
    const optOnly = await vm.runInContext(
      "getInstanceRecommendationWithSelector(__downsizeRows, ['aws'], __optOnlyOpts)",
      ctx,
      { filename: "price-savings-opt-only" },
    );
    check(
      "no basis to compare against, so no AWS entry is fabricated",
      !optOnly.priceSavings || !optOnly.priceSavings.AWS,
      JSON.stringify(optOnly.priceSavings),
    );

    process.exitCode = state.failures ? 1 : 0;
  } catch (e) {
    check(
      "the integration run completes without throwing",
      false,
      e && e.message,
    );
    process.exitCode = 1;
  }
})();

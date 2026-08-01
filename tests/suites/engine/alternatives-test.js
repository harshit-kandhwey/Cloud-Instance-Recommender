// Alternative-strategy picks (Top-N alternatives): Most Cost Optimized,
// Workload Based, Newest Generation — computed over the same valid candidate
// pool as the primary recommendation. See the locked strategy spec.
//
// computeAlternatives lives on the base selector; RuleEngine.generationRank is
// the per-provider newness ordinal; formatAlternative renders a compact cell.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx } = buildContext();
const run = (expr) => vm.runInContext(expr, ctx, { filename: "alternatives" });

// ── generationRank: newest = higher, per provider ──────────────────────────────
console.log("[generationRank per provider]");
const rank = (inst, p) =>
  run(
    `RuleEngine.generationRank(${JSON.stringify(inst)}, ${JSON.stringify(p)})`,
  );
check(
  "AWS parses the family number (m7i>m5)",
  rank({ instanceType: "m7i.large", family: "m7i" }, "aws") === 7 &&
    rank({ instanceType: "m5.large", family: "m5" }, "aws") === 5,
);
check(
  "GCP maps the family order (n4>n2>e2)",
  rank({ instanceType: "n4-standard-4", family: "n4" }, "gcp") >
    rank({ instanceType: "n2-standard-4", family: "n2" }, "gcp") &&
    rank({ instanceType: "n2-standard-4", family: "n2" }, "gcp") >
      rank({ instanceType: "e2-standard-4", family: "e2" }, "gcp"),
);
// Real (type, family) pairs from js/azure/regions/ — the families here used to
// be invented ("d", "nv"), which is not what the parser meets in production.
// The version is read from the FAMILY, since the type alone cannot be parsed:
// nv72adsv5 needs its trailing v5, but nv24's trailing "v24" is its vCPU count.
check(
  "Azure reads the version from the family, not a size-embedded v",
  rank({ instanceType: "d4asv7", family: "dasv7" }, "azure") === 7 &&
    rank({ instanceType: "nv72adsv5", family: "nvv5" }, "azure") === 5 &&
    rank({ instanceType: "nv24", family: "nv" }, "azure") === 2,
  `d4asv7=${rank({ instanceType: "d4asv7", family: "dasv7" }, "azure")} nv72adsv5=${rank({ instanceType: "nv72adsv5", family: "nvv5" }, "azure")} nv24=${rank({ instanceType: "nv24", family: "nv" }, "azure")}`,
);

// ── computeAlternatives over a synthetic pool ──────────────────────────────────
// A GCP Cache VM (2/4). Pool: a cheap+new general (n4), a general (e2), and the
// huge memory-optimized cache family member (m3-ultramem, over-provisioned).
ctx.pool = [
  {
    instanceType: "e2-standard-2",
    family: "e2",
    vCpus: 2,
    memory: 8,
    price: 0.06,
  },
  {
    instanceType: "n4-highcpu-2",
    family: "n4",
    vCpus: 2,
    memory: 4,
    price: 0.05,
  },
  {
    instanceType: "m3-ultramem-32",
    family: "m3",
    vCpus: 32,
    memory: 976,
    price: 5.0,
  },
];
run("sel = InstanceSelectorFactory.createSelector('gcp');");
run("alt = sel.computeAlternatives(pool, 2, 4, { rowWorkload: 'cache' });");

console.log("[Most Cost Optimized — cheapest, workload ignored]");
check(
  "picks the lowest-price instance regardless of workload family",
  run("alt.cost.instanceType") === "n4-highcpu-2",
  run("JSON.stringify(alt.cost)"),
);

console.log("[Workload Based — cheapest in the preferred family, UNBOUNDED]");
check(
  "picks the memory-optimized cache family even though it over-provisions",
  run("alt.workload.instanceType") === "m3-ultramem-32",
  run("JSON.stringify(alt.workload)"),
);

console.log("[Newest Generation — newest within the like-to-like size window]");
check(
  "picks the newest-generation instance that is still sized near the request",
  run("alt.newestGen.instanceType") === "n4-highcpu-2",
  run("JSON.stringify(alt.newestGen)"),
);
check(
  "never returns the over-provisioned m3-ultramem as 'newest'",
  run("alt.newestGen.instanceType") !== "m3-ultramem-32",
);
// Discriminating: an instance that is BOTH newest-gen AND cheapest but grossly
// over-sized must still be excluded by the size window — otherwise it would win.
ctx.poolGen = [
  {
    instanceType: "n4-highcpu-2",
    family: "n4",
    vCpus: 2,
    memory: 4,
    price: 0.05,
  },
  {
    instanceType: "n4-megamem-64",
    family: "n4",
    vCpus: 64,
    memory: 976,
    price: 0.02,
  },
];
run(
  "altW = sel.computeAlternatives(poolGen, 2, 4, { rowWorkload: 'general' });",
);
check(
  "the size window excludes a newest+cheapest but oversized instance",
  run("altW.newestGen.instanceType") === "n4-highcpu-2",
  run("JSON.stringify(altW.newestGen)"),
);

console.log("[Workload Based is empty for a General workload]");
run(
  "altGen = sel.computeAlternatives(pool, 2, 4, { rowWorkload: 'general' });",
);
check("no workload → Workload Based is null", run("altGen.workload") === null);
check(
  "but Most Cost Optimized still resolves",
  run("altGen.cost.instanceType") === "n4-highcpu-2",
);

console.log("[an empty pool yields all-null alternatives]");
run("altNone = sel.computeAlternatives([], 2, 4, { rowWorkload: 'cache' });");
check(
  "every strategy is null when nothing is adequate",
  run("altNone.cost") === null &&
    run("altNone.workload") === null &&
    run("altNone.newestGen") === null,
);

// ── formatAlternative: compact cell, never a price ─────────────────────────────
console.log("[formatAlternative renders instanceType (vCPU/GiB), or empty]");
check(
  "a pick renders as 'type (v/m)'",
  run(
    'formatAlternative({ instanceType: "e2-standard-2", vCpus: 2, memory: 8 })',
  ) === "e2-standard-2 (2/8)",
);
check("null renders as empty string", run("formatAlternative(null)") === "");

// ── the columns reach the exported schema ──────────────────────────────────────
// A real single-provider run: the three alternative columns exist on every row
// with the compact format, and a no-match row carries them empty (schema parity).
console.log("[factory writes the three columns for every row]");
ctx.rows = [
  {
    "VM Name": "ok",
    "CPU Count": "2",
    "Memory (GB)": "8",
    "AWS Region": "us-east-1",
    Workload: "Database",
  },
  {
    "VM Name": "bad",
    "CPU Count": "2",
    "Memory (GB)": "8",
    "AWS Region": "",
    Workload: "Database",
  },
];

(async () => {
  try {
    const results = await run(
      "getInstanceRecommendationWithSelector(rows, ['aws'], { generateLikeToLike: true })",
    );
    const keys = Object.keys(results[0]);
    check(
      "the three alternative columns are present",
      [
        "AWS Most Cost Optimized",
        "AWS Workload Based",
        "AWS Newest Generation",
      ].every((c) => keys.includes(c)),
      keys
        .filter((k) =>
          /Cost Optimized|Workload Based|Newest Generation/.test(k),
        )
        .join(", "),
    );
    check(
      "a matched row's cost pick is a compact 'type (v/m)' cell",
      /\(\d+\/\d+\)$/.test(results[0]["AWS Most Cost Optimized"]),
      results[0]["AWS Most Cost Optimized"],
    );
    check(
      "a no-match row carries the columns empty (schema parity)",
      results[1]["AWS Most Cost Optimized"] === "" &&
        results[1]["AWS Workload Based"] === "" &&
        results[1]["AWS Newest Generation"] === "",
      JSON.stringify({
        cost: results[1]["AWS Most Cost Optimized"],
        workload: results[1]["AWS Workload Based"],
        gen: results[1]["AWS Newest Generation"],
      }),
    );
  } catch (e) {
    check("the factory run completes without throwing", false, e && e.message);
  }

  // ── the alternatives source must follow the pick that actually matched ───────
  // On a "both" run, like-to-like is tried at the REQUESTED size and optimized at
  // the utilization-derived target. A huge request with tiny utilization is the
  // case where they disagree: like-to-like finds nothing, optimized rescues the
  // row. Sourcing alternatives from like-to-like unconditionally left the three
  // strategy cells blank on a row that HAS a recommendation.
  console.log("[alternatives follow the recommendation that matched]");
  try {
    const rescued = await run(
      `getInstanceRecommendationWithSelector(
         [{
           "VM Name": "huge-but-idle",
           "CPU Count": "1600",
           "Memory (GB)": "20000",
           "AWS Region": "us-east-1",
           "CPU Utilization": "1",
           "Memory Utilization": "1",
           Workload: "Database"
         }],
         ['aws'],
         {
           generateLikeToLike: true,
           generateOptimized: true,
           cpuBased: true,
           memoryBased: true,
           cpuDownsizeMax: 40,
           memoryDownsizeMax: 40,
           cpuUpsizeMin: 80,
           memoryUpsizeMin: 80
         }
       )`,
    );
    const row = rescued[0];
    // Guard the premise first — if like-to-like ever starts matching this size,
    // the assertion below would pass for the wrong reason.
    const premise =
      row["AWS Like-to-Like Instance"] === "No data available" &&
      row["AWS Optimized Instance"] !== "No data available" &&
      row["AWS Optimized Instance"] !== "Missing data";
    check(
      "premise: like-to-like finds nothing, optimized still matches",
      premise,
      `l2l=${row["AWS Like-to-Like Instance"]} opt=${row["AWS Optimized Instance"]}`,
    );
    if (premise) {
      check(
        "the row's alternatives come from the optimized pick, not the empty one",
        /\(\d+\/\d+\)$/.test(row["AWS Most Cost Optimized"]) &&
          /\(\d+\/\d+\)$/.test(row["AWS Newest Generation"]),
        `cost=${JSON.stringify(row["AWS Most Cost Optimized"])} gen=${JSON.stringify(row["AWS Newest Generation"])}`,
      );
      // The third cell is asserted too, but the expectation is EMPTY and that is
      // not a gap: Workload Based is the cheapest member of the workload's
      // preferred family, and AWS database prefers r/x/z. A 1600-vCPU/20000-GB
      // requirement leaves only u7i in the pool, so no r/x/z member exists to
      // pick — the documented "none in the family" outcome. Pinning it here
      // stops a future change from quietly filling this cell with a family the
      // workload never asked for, which would look like an improvement.
      check(
        "and Workload Based is empty because no r/x/z member survives at this size",
        row["AWS Workload Based"] === "",
        JSON.stringify(row["AWS Workload Based"]),
      );
    }
  } catch (e) {
    check("the rescued-row run completes without throwing", false, e.message);
  }

  // ── Workload Based, populated, at the COLUMN level ──────────────────────────
  // computeAlternatives().workload is covered directly above (the GCP cache
  // pool). What had no populated case was the output COLUMN: every row-level
  // assertion of "${P} Workload Based" expected "", so the wiring from
  // alt.workload through formatAlternative into the result cell was only ever
  // exercised on its empty path. Blanking that one assignment leaves the unit
  // check green and the exports silently short a column. An ordinary Database
  // row at a size the r/x/z families actually reach is what closes it.
  console.log("[Workload Based names a member of the preferred family]");
  try {
    const normal = await run(
      `getInstanceRecommendationWithSelector(
         [{
           "VM Name": "ordinary-db",
           "CPU Count": "8",
           "Memory (GB)": "64",
           "AWS Region": "us-east-1",
           Workload: "Database"
         }],
         ['aws'],
         { generateLikeToLike: true }
       )`,
    );
    const cell = normal[0]["AWS Workload Based"];
    check(
      "the workload pick is a compact 'type (v/m)' cell, not blank",
      /\(\d+\/\d+\)$/.test(cell),
      JSON.stringify(cell),
    );
    // The point of the column is the FAMILY, not merely that something is there.
    check(
      "and it belongs to a database-preferred family (r/x/z)",
      /^[rxz]/i.test(String(cell)),
      JSON.stringify(cell),
    );
  } catch (e) {
    check("the workload-pick run completes without throwing", false, e.message);
  }

  process.exit(state.failures ? 1 : 0);
})();

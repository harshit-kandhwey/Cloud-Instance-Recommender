// Per-row Include Only allow-list (base-instance-selector.js applyFilters +
// instance-selector-factory.js). The symmetric twin of the per-row Exclude: a
// VM may land ONLY on the families/types the list names. Two layers:
//   - the selector: applyFilters keeps an instance only if it matches a token,
//     read through the SAME matcher Exclude uses; row-level and run-level filters
//     BOTH apply (intersection), so a conflict empties the pool → No-Match with
//     the list named in the Nearest Miss.
//   - the factory: the CSV "Include Only" column is parsed into rowOptions and
//     reaches the recommendation (goldens carry no such column, so this is the
//     only guard on that wiring).
// Precedence decided with the user: BOTH apply (intersection), consistent with
// how per-row Exclude already unions with the run-level exclude.
const { buildEngineContext, buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

// ── Selector layer: a hand-built pool, so behaviour is exact ────────────────
const { ctx, run } = buildEngineContext({
  scripts: [
    "js/base/rule-engine.js",
    "js/base/base-instance-selector.js",
    "js/base/instance-selector-factory.js",
  ],
  label: "include-only",
});
run(`
  __sel = new BaseInstanceSelector();
  __sel.getProviderName = function () { return "AWS"; };
  __sel.getSampleData = function () { return []; };
`);

// Three families, all 2 vCPU / 8 GB and current-gen, price-sorted ascending so
// getLikeToLikeInstance's cheapest-survivor pick is predictable: burstable t3
// (cheapest), general m5, compute c5.
const box = (instanceType, family, familyName, price) => ({
  instanceType,
  vCpus: 2,
  memory: 8,
  price,
  family,
  familyName,
  processor: "Intel",
  generation: 1,
  isGraviton: 0,
});
ctx.pool = [
  box("t3.large", "t3", "General purpose", 0.08),
  box("m5.large", "m5", "General purpose", 0.1),
  box("c5.large", "c5", "Compute optimized", 0.12),
];
run(`__sel.instanceData = { r: pool };`);
const pick = (opts) =>
  run(`__sel.getLikeToLikeInstance("r", 2, 8, ${JSON.stringify(opts)})`);

console.log("[an allow-list keeps only the families it names]");
{
  check(
    "Include Only m5 lands on m5, not the cheaper t3",
    pick({ includeOnlyTypes: ["m5"] }).instanceType === "m5.large",
    JSON.stringify(pick({ includeOnlyTypes: ["m5"] })),
  );
  check(
    "Include Only c5 lands on c5",
    pick({ includeOnlyTypes: ["c5"] }).instanceType === "c5.large",
    JSON.stringify(pick({ includeOnlyTypes: ["c5"] })),
  );
  // A two-token list keeps both, and the cheapest of the two wins — never the
  // excluded t3, even though it is cheaper than either.
  const both = pick({ includeOnlyTypes: ["m5", "c5"] });
  check(
    "a two-family list picks the cheaper listed family (m5), never the unlisted t3",
    both.instanceType === "m5.large",
    JSON.stringify(both),
  );
}

console.log("[the allow-list reads the same vocabulary as Exclude]");
{
  // A classifier token, not a family name: "burstable" allow-lists ONLY the t3.
  check(
    "Include Only burstable keeps the burstable family alone",
    pick({ includeOnlyTypes: ["burstable"] }).instanceType === "t3.large",
    JSON.stringify(pick({ includeOnlyTypes: ["burstable"] })),
  );
  // And the same matcher still drives Exclude after the refactor: excluding
  // burstable drops t3, so the cheapest survivor is m5.
  check(
    "Exclude burstable still drops the t3 (matcher refactor is behaviour-preserving)",
    pick({ excludeTypes: ["burstable"] }).instanceType === "m5.large",
    JSON.stringify(pick({ excludeTypes: ["burstable"] })),
  );
}

console.log("[no allow-list means no allow-list — every family is eligible]");
{
  check(
    "with no Include Only the cheapest overall (t3) is picked",
    pick({}).instanceType === "t3.large",
    JSON.stringify(pick({})),
  );
}

console.log("[an allow-list that fits nothing is a No-Match naming the list]");
{
  const r = pick({ includeOnlyTypes: ["zzz-nope"] });
  check(
    "an unmatchable allow-list returns No-Match",
    r.instanceType === "No data available",
    JSON.stringify(r),
  );
  check(
    "and the Nearest Miss attributes the block to the include-only list",
    !!r.nearestMiss &&
      Array.isArray(r.nearestMiss.blockedBy) &&
      r.nearestMiss.blockedBy.includes("include-only list"),
    JSON.stringify(r.nearestMiss),
  );
}

console.log(
  "[row-level and run-level both apply — a conflict is a No-Match, not an override]",
);
{
  // Include Only m5 (a General-purpose family) vs a run-level restriction to
  // Compute-optimized only: the two cannot both be satisfied. Intersection, so
  // the row is a No-Match — the row filter does NOT override the run filter.
  const r = pick({
    includeOnlyTypes: ["m5"],
    restrictInstanceFamilyNames: true,
    selectedInstanceFamilyNames: ["Compute optimized"],
  });
  check(
    "a row-vs-run conflict empties the pool (intersection, not override)",
    r.instanceType === "No data available",
    JSON.stringify(r),
  );
  check(
    "and BOTH blocking filters are named in the Nearest Miss",
    !!r.nearestMiss &&
      r.nearestMiss.blockedBy.includes("include-only list") &&
      r.nearestMiss.blockedBy.includes("instance-family name"),
    JSON.stringify(r.nearestMiss && r.nearestMiss.blockedBy),
  );
}

// ── Factory layer: the CSV "Include Only" column actually reaches the run ────
console.log("[the factory wires the CSV Include Only column into the run]");
{
  const fb = buildContext(); // real AWS data (us-east-1 available)
  fb.ctx.rowsIO = [
    {
      "VM Name": "only-m5",
      "CPU Count": "2",
      "Memory (GB)": "8",
      "AWS Region": "us-east-1",
      "Include Only": "m5",
    },
    {
      "VM Name": "impossible",
      "CPU Count": "2",
      "Memory (GB)": "8",
      "AWS Region": "us-east-1",
      "Include Only": "zzz-nope",
    },
  ];
  (async () => {
    try {
      const results = await fb.run(
        "getInstanceRecommendationWithSelector(rowsIO, ['aws'], { generateLikeToLike: true })",
      );
      check(
        // "m5" allow-lists the whole m5 family (m5, m5a, m5n, …) — the same
        // substring breadth Exclude has, since both read one matcher.
        "a row with Include Only=m5 lands on an m5-family instance",
        /^m5/.test(results[0]["AWS Like-to-Like Instance"]),
        results[0]["AWS Like-to-Like Instance"],
      );
      check(
        "a row whose Include Only fits nothing is No-Match with the list named",
        results[1]["AWS Like-to-Like Instance"] === "No data available" &&
          /include-only list/.test(results[1]["AWS Nearest Miss"] || ""),
        JSON.stringify({
          inst: results[1]["AWS Like-to-Like Instance"],
          miss: results[1]["AWS Nearest Miss"],
        }),
      );
    } catch (e) {
      check(
        "the factory run completes without throwing",
        false,
        e && e.message,
      );
    }
    // process.exitCode set here, inside the async IIFE, so it reflects the
    // factory-layer checks too (they resolve after the synchronous ones).
    process.exitCode = state.failures ? 1 : 0;
  })();
}

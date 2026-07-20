// SQL — the SQL Server licence floor (js/base/rule-engine.js).
//
// SQL Server is licensed per core with a minimum of 4 core licences per VM, so
// a 1 or 2 vCPU recommendation is billed as 4 regardless: the smaller box saves
// no licence money and only costs performance. The rule raises the FLOOR, not
// the pick — an 8 vCPU SQL box stays 8.
//
// It has to hold on the optimized pass too, which is where it actually bites: a
// lightly-used 4 vCPU SQL box is exactly what the N/2 rule would halve to 2.
const vm = require("vm");
const { buildContext, makeChecker } = require("./harness");

const { check, state } = makeChecker();
const { ctx } = buildContext();
const RuleEngine = ctx.RuleEngine;

const inst = (type, vCpus, memory, price) => ({
  instanceType: type,
  family: type.split(".")[0],
  familyName: "General purpose",
  vCpus,
  memory,
  price,
  generation: 1,
});

// Cheapest first, so cheapest-adequate ordering would pick the 2 vCPU box.
const POOL = [
  inst("m7i.large", 2, 8, 1),
  inst("m7i.xlarge", 4, 16, 2),
  inst("m7i.2xlarge", 8, 32, 4),
];

const apply = (workload, pool = POOL, provider = "aws") =>
  RuleEngine.apply(
    pool,
    { rowWorkload: workload, reqCpu: 2, reqMemory: 8 },
    provider,
  );

const types = (r) => r.instances.map((i) => i.instanceType);
const fired = (r) => r.rules.some((x) => /licence floor/i.test(x));

console.log("[the floor removes candidates below 4 vCPUs]");
check(
  "premise: a non-SQL workload keeps the 2 vCPU box",
  types(apply("Database")).includes("m7i.large"),
  types(apply("Database")).join(","),
);

const sql = apply("SQL Server");
check(
  "SQL Server drops everything under 4 vCPUs",
  !types(sql).includes("m7i.large"),
  types(sql).join(","),
);
check(
  "and keeps everything at or above it",
  types(sql).includes("m7i.xlarge") && types(sql).includes("m7i.2xlarge"),
  types(sql).join(","),
);
check("and says so", fired(sql), sql.rules.join(" | "));

for (const w of ["SQL", "sqlserver", "MSSQL", "sql server"]) {
  check(
    `"${w}" is recognised as SQL Server`,
    !types(apply(w)).includes("m7i.large"),
    types(apply(w)).join(","),
  );
}
check(
  "a workload merely containing the letters sql is not swept in",
  types(apply("PostgreSQL")).includes("m7i.large"),
  types(apply("PostgreSQL")).join(","),
);

console.log("[it is a floor, not a target]");
check(
  "an 8 vCPU candidate is not pulled down to the minimum",
  types(apply("SQL Server")).includes("m7i.2xlarge"),
);
const alreadyBig = [
  inst("m7i.2xlarge", 8, 32, 4),
  inst("m7i.4xlarge", 16, 64, 8),
];
const big = apply("SQL Server", alreadyBig);
check(
  "a pool entirely above the floor is untouched",
  types(big).length === 2,
  types(big).join(","),
);
check(
  "and the rule does not claim to have done anything",
  !fired(big),
  big.rules.join(" | "),
);

console.log("[it degrades rather than forcing a no-match]");
const tiny = [inst("m7i.large", 2, 8, 1)];
const r = apply("SQL Server", tiny);
check(
  "a region with nothing at 4 vCPUs still returns a recommendation",
  r.instances.length === 1,
  types(r).join(","),
);
check(
  "and it is marked as not applied, not silently reported as licensed",
  r.rules.some((x) => /not applied/i.test(x)),
  r.rules.join(" | "),
);

// ── The case that actually bites, end to end ─────────────────────────────────
// A 4 vCPU SQL box at 10% utilization is exactly what N/2 would halve to 2.
console.log("[the optimized pass cannot downsize below the licence floor]");
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
const row = (workload) => [
  {
    "VM Name": "sqlbox",
    "CPU Count": "4",
    "Memory (GB)": "16",
    "CPU Utilization": "10",
    "Memory Utilization": "10",
    "AWS Region": "us-east-1",
    Workload: workload,
  },
];

(async () => {
  const run = (expr) => vm.runInContext(expr, ctx, { filename: "sql" });
  try {
    ctx.__opts = OPTS;
    ctx.__plain = row("Database");
    ctx.__sql = row("SQL Server");
    const plain = (
      await run(
        "getInstanceRecommendationWithSelector(__plain, ['aws'], __opts)",
      )
    )[0];
    const sqlRow = (
      await run("getInstanceRecommendationWithSelector(__sql, ['aws'], __opts)")
    )[0];

    const plainCpus = parseInt(plain["AWS Optimized vCPUs"], 10);
    const sqlCpus = parseInt(sqlRow["AWS Optimized vCPUs"], 10);

    check(
      "premise: both rows produced a real recommendation",
      Number.isFinite(plainCpus) && Number.isFinite(sqlCpus),
      `${plain["AWS Optimized Instance"]} / ${sqlRow["AWS Optimized Instance"]}`,
    );
    // Without this the SQL check below could pass simply because nothing
    // downsized at all.
    check(
      "premise: the same row without SQL IS downsized below 4",
      plainCpus < 4,
      `${plain["AWS Optimized Instance"]} (${plainCpus} vCPU)`,
    );
    check(
      "the SQL row is not downsized below the licence floor",
      sqlCpus >= 4,
      `${sqlRow["AWS Optimized Instance"]} (${sqlCpus} vCPU)`,
    );
    check(
      "and the row reports the floor",
      /licence floor/i.test(sqlRow["AWS Rules Applied"] || ""),
      sqlRow["AWS Rules Applied"],
    );
  } catch (e) {
    check("the SQL runs complete without throwing", false, e && e.message);
  }

  process.exit(state.failures ? 1 : 0);
})();

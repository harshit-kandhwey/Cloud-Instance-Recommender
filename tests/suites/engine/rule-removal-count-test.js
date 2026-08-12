// Rule-fired transparency (rule-engine.js): a filtering rule reports HOW MANY
// candidates it removed ("1a: Burstable excluded — 3 removed"), so the Rules
// Applied column can explain a pick rather than only naming the rule that fired.
// A rule that removed nothing keeps its plain label (never "— 0 removed"), and
// the sort/preference rules — which reorder, never remove — carry no count.
const { buildEngineContext } = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: ["js/base/rule-engine.js"],
  label: "rule-removal-count",
});

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
};

const inst = (o) => ({
  instanceType: "m5.large",
  family: "m5",
  familyName: "General purpose",
  vCpus: 4,
  memory: 16,
  price: 0.1,
  generation: 1,
  isGraviton: 0,
  ...o,
});
const rules = (res) => res.rules;

console.log("[a filtering rule reports its exact removal count]");
{
  // Production drops the three burstable t3 boxes; two general m5 survive.
  ctx.pool = [
    inst({ instanceType: "t3.large", family: "t3" }),
    inst({ instanceType: "t3.xlarge", family: "t3" }),
    inst({ instanceType: "t3.2xlarge", family: "t3" }),
    inst({ instanceType: "m5.large", family: "m5" }),
    inst({ instanceType: "m5.xlarge", family: "m5" }),
  ];
  const res = run("RuleEngine.apply(pool, { rowEnv: 'production' }, 'aws')");
  check(
    "1a burstable exclusion names the count it removed",
    rules(res).some((r) => r === "1a: Burstable excluded — 3 removed"),
    JSON.stringify(rules(res)),
  );
  check(
    "and the surviving pool is exactly the two it kept",
    res.instances.length === 2 && res.instances.every((i) => i.family === "m5"),
    JSON.stringify(res.instances.map((i) => i.instanceType)),
  );
}

console.log("[a rule that removes nothing keeps its plain label — no count]");
{
  // Production + database, every candidate already ≥4 vCPU, non-burstable and
  // current-gen: 1d fires but removes nothing, so it carries no "— removed".
  ctx.allBig = [
    inst({ instanceType: "m5.xlarge", vCpus: 4 }),
    inst({ instanceType: "m5.2xlarge", vCpus: 8 }),
  ];
  const res = run(
    "RuleEngine.apply(allBig, { rowEnv: 'production', rowWorkload: 'database' }, 'aws')",
  );
  const oneD = rules(res).filter((r) => r.startsWith("1d: Network-tier"));
  check("1d fired exactly once", oneD.length === 1, JSON.stringify(rules(res)));
  check(
    "and it carries no removal count, because it removed nothing",
    oneD[0] === "1d: Network-tier preference (≥4 vCPUs)",
    JSON.stringify(oneD),
  );
  check(
    "no rule ever reports the meaningless '— 0 removed'",
    !rules(res).some((r) => /— 0 removed/.test(r)),
    JSON.stringify(rules(res)),
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = failures ? 1 : 0;

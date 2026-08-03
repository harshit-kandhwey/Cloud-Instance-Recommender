// GPU / accelerator workload support (js/base/rule-engine.js).
//
// Two directions, and the second is the one that matters in practice:
//   1. An ML/AI row must land on an accelerator.
//   2. Every OTHER workload must NOT. An accelerator is not a substitute for a
//      general-purpose box of the same shape — it costs far more and carries
//      hardware the workload will never use.
//
// (2) is not hypothetical. Against the real region files, before this rule
// existed, a plain like-to-like request landed on an accelerator at several
// common sizes — worst on GCP, where 48c/192g picked g2-standard-48 and
// 64c/1024g picked a2-megagpu-16g.
//
// The classifier reads familyName (the provider's own classification) rather
// than family prefixes, because prefixes do not survive crossing providers:
// "g" and "dl" mark accelerators on AWS but mark Azure's G/GS memory-optimized
// and Dl-series general-purpose instances — 60 instances in eastus that the
// previous prefix list wrongly called GPUs.
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

// ── The classifier, against the real familyName strings ──────────────────────
console.log("[isAccelerator reads familyName, per provider]");
const { ctx } = buildContext();
const RuleEngine = ctx.RuleEngine;
const acc = (inst, provider) => RuleEngine.isAccelerator(inst, provider);

check(
  "AWS GPU instance",
  acc({ family: "p5", familyName: "GPU instance" }, "aws"),
);
check(
  "AWS ML ASIC (trn/inf)",
  acc({ family: "trn1", familyName: "Machine Learning ASIC Instances" }, "aws"),
);
check("AWS FPGA", acc({ family: "f2", familyName: "FPGA Instances" }, "aws"));
check(
  "AWS media accelerator",
  acc({ family: "vt1", familyName: "Media Accelerator Instances" }, "aws"),
);
check("Azure GPU", acc({ family: "nc", familyName: "GPU" }, "azure"));
check(
  "GCP Accelerator optimized",
  acc({ family: "a3", familyName: "Accelerator optimized" }, "gcp"),
);

console.log("[non-accelerators are not swept up — the prefix trap]");
// The exact instances the old provider-agnostic prefix list misclassified.
check(
  "Azure G-series is memory-optimized, not a GPU",
  !acc({ family: "g", familyName: "Memory optimized" }, "azure"),
);
check(
  "Azure GS-series is memory-optimized, not a GPU",
  !acc({ family: "gs", familyName: "Memory optimized" }, "azure"),
);
check(
  "Azure Dl-series is general-purpose, not a GPU",
  !acc({ family: "dldsv5", familyName: "General purpose" }, "azure"),
);
check(
  "AWS m-series is not an accelerator",
  !acc({ family: "m7i", familyName: "General purpose" }, "aws"),
);
// "basic" must not match the \basic\b ASIC pattern.
check(
  "a familyName containing 'basic' is not an ASIC",
  !acc({ family: "b2", familyName: "Basic tier" }, "azure"),
);

console.log("[familyName wins; prefixes are only a blank-familyName fallback]");
check(
  "blank familyName falls back to a provider-anchored prefix",
  acc({ family: "nc", familyName: "" }, "azure") &&
    acc({ family: "a3", familyName: "" }, "gcp"),
);
check(
  "the fallback does not cross providers",
  !acc({ family: "g", familyName: "" }, "azure") &&
    !acc({ family: "dldsv5", familyName: "" }, "azure"),
);
check("an instance with neither signal is not an accelerator", !acc({}, "aws"));

// ── The rule, through RuleEngine.apply ───────────────────────────────────────
console.log("[ML/AI requires an accelerator; other workloads exclude one]");
const POOL = [
  {
    instanceType: "m7i.24xlarge",
    family: "m7i",
    familyName: "General purpose",
    vCpus: 96,
    memory: 384,
    price: 4,
    generation: 1,
  },
  {
    instanceType: "g6.24xlarge",
    family: "g6",
    familyName: "GPU instance",
    vCpus: 96,
    memory: 384,
    price: 2,
    generation: 1,
  },
];

const applyWith = (workload, pool = POOL, provider = "aws") =>
  RuleEngine.apply(
    pool,
    { rowWorkload: workload, reqCpu: 96, reqMemory: 384 },
    provider,
  );

// Premise: the accelerator is the CHEAPER of the two, so cheapest-adequate
// ordering would pick it if nothing kept it out. Without this the "excluded"
// check below could pass for the wrong reason.
check(
  "premise: the accelerator would otherwise win on price",
  POOL[1].price < POOL[0].price,
);

const general = applyWith("");
check(
  "a blank workload does not keep the GPU box",
  general.instances.every((i) => !acc(i, "aws")),
  general.instances.map((i) => i.instanceType).join(","),
);
check(
  "and the row says why",
  general.rules.some((r) => /accelerators excluded/i.test(r)),
  general.rules.join(" | "),
);
for (const wl of ["Database", "Web Server", "Cache", "Batch", "HPC", "SAP"]) {
  const r = applyWith(wl);
  check(
    `${wl} excludes the accelerator`,
    r.instances.every((i) => !acc(i, "aws")),
    r.instances.map((i) => i.instanceType).join(","),
  );
}

const ml = applyWith("ML/AI");
check(
  "ML/AI keeps ONLY the accelerator",
  ml.instances.length === 1 && ml.instances[0].instanceType === "g6.24xlarge",
  ml.instances.map((i) => i.instanceType).join(","),
);
check(
  "and the row says the accelerator was required",
  ml.rules.some((r) => /accelerator required/i.test(r)),
  ml.rules.join(" | "),
);
check(
  "a CSV row that just says GPU is treated the same as ML/AI",
  applyWith("GPU").instances.length === 1 &&
    applyWith("GPU").instances[0].instanceType === "g6.24xlarge" &&
    applyWith("gpu").instances.length === 1 &&
    applyWith("gpu").instances[0].instanceType === "g6.24xlarge",
);

console.log("[neither direction is allowed to empty the pool]");
const onlyAccel = [POOL[1]];
const r1 = applyWith("Database", onlyAccel);
check(
  "when ONLY accelerators fit, the pool stands rather than going no-match",
  r1.instances.length === 1,
  r1.instances.map((i) => i.instanceType).join(","),
);
check(
  "and the exclusion is not claimed in the rules",
  !r1.rules.some((r) => /accelerators excluded/i.test(r)),
  r1.rules.join(" | "),
);
const onlyPlain = [POOL[0]];
const r2 = applyWith("ML/AI", onlyPlain);
check(
  "ML/AI in a region with no accelerator still returns a recommendation",
  r2.instances.length === 1,
);
check(
  "and it is marked as not applied, not silently reported as a GPU sizing",
  r2.rules.some((r) => /no accelerator available/i.test(r)),
  r2.rules.join(" | "),
);

// ── End to end, against the real region data ─────────────────────────────────
// The sizes below are the ones the probe caught landing on an accelerator.
console.log(
  "[real GCP data: the sizes that used to pick a GPU box no longer do]",
);
(async () => {
  try {
    const g = buildContext({ dataScript: "js/gcp/gcp-data.js" });
    g.ctx.__rows = [
      {
        "VM Name": "a",
        "CPU Count": "48",
        "Memory (GB)": "192",
        "GCP Region": "us-central1",
      },
      {
        "VM Name": "b",
        "CPU Count": "64",
        "Memory (GB)": "1024",
        "GCP Region": "us-central1",
      },
    ];
    g.ctx.__opts = { generateLikeToLike: true, generateOptimized: false };
    const out = await vm.runInContext(
      "getInstanceRecommendationWithSelector(__rows, ['gcp'], __opts)",
      g.ctx,
      { filename: "gpu-e2e" },
    );
    check(
      "premise: both rows produced a real recommendation",
      out.length === 2 &&
        out.every(
          (r) =>
            r["GCP Like-to-Like Instance"] &&
            r["GCP Like-to-Like Instance"] !== "No data available",
        ),
      out.map((r) => r["GCP Like-to-Like Instance"]).join(","),
    );
    const picks = out.map((r) => r["GCP Like-to-Like Instance"]);
    check(
      "48c/192g no longer picks g2-standard-48",
      Array.isArray(picks) &&
        typeof picks[0] === "string" &&
        !/^g2-/.test(picks[0]),
      JSON.stringify(picks),
    );
    check(
      "64c/1024g no longer picks an a2/a3 GPU box",
      Array.isArray(picks) &&
        typeof picks[1] === "string" &&
        !/^a[234]-/.test(picks[1]),
      JSON.stringify(picks),
    );
  } catch (e) {
    check(
      "the end-to-end run completes without throwing",
      false,
      e && e.message,
    );
  }

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = state.failures ? 1 : 0;
})();

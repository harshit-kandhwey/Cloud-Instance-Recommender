// Multicloud family-equivalence explainer (js/base/instance-selector-factory.js):
// a single "Family Equivalence" column, added ONLY on multi-cloud runs, that
// folds each cloud's family-class name to a shared class and says whether the
// clouds landed on the same KIND of machine.
//
// The vocabularies already align across clouds — "General purpose", "Compute
// optimized", "Memory optimized", "Storage optimized" are written verbatim on
// all three — so normalizeFamilyClass only actively folds the ONE class whose
// name differs (the accelerator), and passes everything else through unmapped
// rather than guessing it into a bucket.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const REPO = path.resolve(__dirname, "..", "..", "..");
const { check, state } = makeChecker();

// ── normalizeFamilyClass: only accelerator names fold; the rest pass through ──
console.log(
  "[normalizeFamilyClass folds accelerators, passes the rest through]",
);
{
  const { ctx } = buildContext();
  const norm = (s) => {
    ctx.__f = s;
    return vm.runInContext("normalizeFamilyClass(__f)", ctx);
  };
  check(
    "General purpose passes through",
    norm("General purpose") === "General purpose",
  );
  check(
    "Compute optimized passes through",
    norm("Compute optimized") === "Compute optimized",
  );
  check(
    "Memory optimized passes through",
    norm("Memory optimized") === "Memory optimized",
  );
  check(
    "Storage optimized passes through",
    norm("Storage optimized") === "Storage optimized",
  );
  // The three cloud-specific accelerator names fold to one shared label.
  check(
    "AWS 'GPU instance' -> Accelerator",
    norm("GPU instance") === "Accelerator",
  );
  check(
    "AWS ML ASIC -> Accelerator",
    norm("Machine Learning ASIC Instances") === "Accelerator",
  );
  check("AWS FPGA -> Accelerator", norm("FPGA Instances") === "Accelerator");
  check("Azure 'GPU' -> Accelerator", norm("GPU") === "Accelerator");
  check(
    "GCP 'Accelerator optimized' -> Accelerator",
    norm("Accelerator optimized") === "Accelerator",
  );
  // The \basic\b guard: "Basic tier" carries 'asic' inside a word, must NOT fold.
  check(
    "'Basic tier' is not an accelerator",
    norm("Basic tier") === "Basic tier",
  );
  // Unrecognised classes pass through unmapped rather than being bucketed.
  check("Azure-only 'HPC' passes through", norm("HPC") === "HPC");
  check("blank / missing -> blank", norm("") === "" && norm(undefined) === "");
}

// ── describeFamilyEquivalence: agree vs differ, L2L-first, optimized fallback ──
console.log("[describeFamilyEquivalence: agree, differ, fallback, empty]");
{
  const { ctx } = buildContext();
  const desc = (result, providers) => {
    ctx.__r = result;
    ctx.__p = providers;
    return vm.runInContext("describeFamilyEquivalence(__r, __p)", ctx);
  };
  check(
    "clouds agree -> 'General purpose on AWS, GCP'",
    desc(
      {
        "AWS Like-to-Like Family": "General purpose",
        "GCP Like-to-Like Family": "General purpose",
      },
      ["aws", "gcp"],
    ) === "General purpose on AWS, GCP",
  );
  check(
    "clouds differ -> 'Differs — AWS …, GCP …' (the informative case)",
    desc(
      {
        "AWS Like-to-Like Family": "General purpose",
        "GCP Like-to-Like Family": "Memory optimized",
      },
      ["aws", "gcp"],
    ) === "Differs — AWS General purpose, GCP Memory optimized",
  );
  check(
    "accelerators with different names across clouds fold to agreement",
    desc(
      {
        "AWS Like-to-Like Family": "GPU instance",
        "GCP Like-to-Like Family": "Accelerator optimized",
      },
      ["aws", "gcp"],
    ) === "Accelerator on AWS, GCP",
  );
  check(
    "reads the optimized family when like-to-like is N/A",
    desc(
      {
        "AWS Like-to-Like Family": "N/A",
        "AWS Optimized Family": "Compute optimized",
        "GCP Like-to-Like Family": "Compute optimized",
      },
      ["aws", "gcp"],
    ) === "Compute optimized on AWS, GCP",
  );
  check(
    "a provider with no usable family is dropped, not shown blank",
    desc(
      {
        "AWS Like-to-Like Family": "General purpose",
        "GCP Like-to-Like Family": "Error",
        "GCP Optimized Family": "N/A",
      },
      ["aws", "gcp"],
    ) === "General purpose on AWS",
  );
  check(
    "nothing usable -> empty string",
    desc(
      { "AWS Like-to-Like Family": "N/A", "GCP Like-to-Like Family": "Error" },
      ["aws", "gcp"],
    ) === "",
  );
}

// ── Gating: the column exists only on a multi-cloud run, end to end ───────────
console.log("[the column is added on multi-cloud runs and absent on single]");
(async () => {
  try {
    const { ctx } = buildContext({ dataScript: "js/aws/aws-data.js" });
    // Load a SECOND provider's data into the same context so a real two-cloud
    // run can resolve both regions (mirrors gpu-workload-test's e2e approach).
    vm.runInContext(
      fs.readFileSync(path.join(REPO, "js/gcp/gcp-data.js"), "utf8"),
      ctx,
      { filename: "js/gcp/gcp-data.js" },
    );
    ctx.__rows = [
      {
        "VM Name": "a",
        "CPU Count": "4",
        "Memory (GB)": "16",
        "AWS Region": "us-east-1",
        "GCP Region": "us-central1",
      },
    ];
    ctx.__opts = { generateLikeToLike: true, generateOptimized: false };

    const multi = await vm.runInContext(
      "getInstanceRecommendationWithSelector(__rows, ['aws','gcp'], __opts)",
      ctx,
      { filename: "fe-multi" },
    );
    check(
      "multi-cloud run carries a Family Equivalence column",
      Object.prototype.hasOwnProperty.call(multi[0], "Family Equivalence"),
      JSON.stringify(Object.keys(multi[0])),
    );
    check(
      "and it names both clouds",
      /AWS/.test(multi[0]["Family Equivalence"]) &&
        /GCP/.test(multi[0]["Family Equivalence"]),
      multi[0]["Family Equivalence"],
    );

    const single = await vm.runInContext(
      "getInstanceRecommendationWithSelector(__rows, ['aws'], __opts)",
      ctx,
      { filename: "fe-single" },
    );
    check(
      "a single-provider run does NOT add the column",
      !Object.prototype.hasOwnProperty.call(single[0], "Family Equivalence"),
      JSON.stringify(Object.keys(single[0])),
    );

    process.exit(state.failures ? 1 : 0);
  } catch (e) {
    check(
      "the integration run completes without throwing",
      false,
      e && e.message,
    );
    process.exit(1);
  }
})();

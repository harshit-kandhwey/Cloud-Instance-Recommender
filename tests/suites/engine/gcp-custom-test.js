// GCP custom machine types, part 1 — the shape primitives (Phase C1).
// When a standard GCP shape over-provisions a row, a custom vCPU/RAM shape can fit
// it tighter. Two pure pieces build that suggestion:
//   - buildCustomMachineType: the tightest VALID custom type for a required size,
//     applying each family's OWN GCP rules (min vCPU — E2/N2/N2D/N4/N4D need 2,
//     only N1 allows 1; even vCPUs, multiples of 4 above 32; a per-vCPU memory
//     band that differs by family — N1 0.9–6.5, N4/N4D ≥2, the rest 0.5–8; N1's
//     prefixless "custom-…" naming) — or "" for a family GCP does not let you
//     customise, or a size beyond the family's ceiling;
//   - customShapeWorthwhile: whether a standard pick wastes enough (default 25%
//     over on either axis) to be worth suggesting a custom shape at all.
// No pricing anywhere (D8): "wasteful" is vCPU/RAM headroom, never dollars. The
// wiring that emits the suggestion column is Phase C2.
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx, run } = buildEngineContext({
  scripts: [
    "js/base/rule-engine.js",
    "js/base/base-instance-selector.js",
    "js/gcp/gcp-instance-selector.js",
  ],
  label: "gcp-custom",
});
run(`__gcp = new GCPInstanceSelector();`);
const J = JSON.stringify;
const custom = (fam, cpu, mem) =>
  run(`__gcp.buildCustomMachineType(${J(fam)}, ${J(cpu)}, ${J(mem)})`);
const worth = (sv, sm, rc, rm) =>
  run(`__gcp.customShapeWorthwhile(${J(sv)}, ${J(sm)}, ${J(rc)}, ${J(rm)})`);

console.log("[buildCustomMachineType shapes a valid custom type to the need]");
{
  check(
    "a plain fit rounds nothing it need not",
    custom("n2", 4, 16) === "n2-custom-4-16384",
    custom("n2", 4, 16),
  );
  check(
    "an odd vCPU count rounds up to the next even number",
    custom("n2", 5, 8) === "n2-custom-6-8192",
    custom("n2", 5, 8),
  );
  check(
    "memory rounds UP to a whole 256 MB block, never below the need",
    custom("n2", 2, 5.1) === "n2-custom-2-5376",
    custom("n2", 2, 5.1),
  );
  check(
    "memory below the N2 floor (0.5 GB/vCPU) is clamped up into the band",
    custom("n2", 8, 1) === "n2-custom-8-4096",
    custom("n2", 8, 1),
  );
  check(
    "memory above the N2 ceiling (8 GB/vCPU) raises vCPU, never truncates memory",
    custom("n2", 2, 100) === "n2-custom-14-102400",
    custom("n2", 2, 100),
  );
  check(
    "a memory need beyond the family's max vCPU yields no shape",
    custom("n2", 2, 2000) === "",
    custom("n2", 2, 2000),
  );
}

console.log("[each family applies its OWN vCPU/memory/naming rules]");
{
  check(
    "E2 needs at least 2 vCPUs — 1 rounds up, never a bad e2-custom-1",
    custom("e2", 1, 2) === "e2-custom-2-2048",
    custom("e2", 1, 2),
  );
  check(
    "N1 alone allows 1 vCPU, and uses the prefixless custom- form",
    custom("n1", 1, 2) === "custom-1-2048",
    custom("n1", 1, 2),
  );
  check(
    "N1 memory past 6.5 GB/vCPU raises vCPU to cover it (prefixless form)",
    custom("n1", 1, 10) === "custom-2-10240",
    custom("n1", 1, 10),
  );
  check(
    "N4 needs at least 2 GB/vCPU — a leaner ask is clamped up",
    custom("n4", 4, 4) === "n4-custom-4-8192",
    custom("n4", 4, 4),
  );
  check(
    "above 32 vCPUs the count rounds up to a multiple of 4",
    custom("n2", 33, 66) === "n2-custom-36-67584",
    custom("n2", 33, 66),
  );
  check(
    "a size beyond the family ceiling yields no shape (E2 max 32)",
    custom("e2", 40, 80) === "",
    custom("e2", 40, 80),
  );
}

console.log("[only families GCP lets you customise get a custom shape]");
{
  check("a general-purpose family (n2) qualifies", custom("n2", 4, 16) !== "");
  check(
    "e2 / n2d / n4 qualify too",
    custom("n2d", 4, 16) !== "" && custom("n4", 4, 16) !== "",
  );
  check(
    "a compute-optimized family (c2) does not — GCP has no c2 custom",
    custom("c2", 4, 16) === "",
    custom("c2", 4, 16),
  );
  check(
    "a memory-optimized family (m3) does not",
    custom("m3", 4, 16) === "",
    custom("m3", 4, 16),
  );
  check(
    "family match is case-insensitive",
    custom("N2", 4, 16) === "n2-custom-4-16384",
  );
}

console.log("[an unusable size yields no shape, never a broken string]");
{
  check("zero cpu → empty", custom("n2", 0, 16) === "");
  check("non-numeric memory → empty", custom("n2", 4, "x") === "");
  check("negative memory → empty", custom("n2", 4, -8) === "");
}

console.log("[customShapeWorthwhile fires only on real waste]");
{
  check("25% spare vCPU is worthwhile", worth(5, 16, 4, 16) === true);
  check("25% spare memory is worthwhile", worth(4, 20, 4, 16) === true);
  check(
    "an exact fit is not worthwhile",
    worth(4, 16, 4, 16) === false,
    String(worth(4, 16, 4, 16)),
  );
  check(
    "just under the threshold is not worthwhile",
    worth(4, 19, 4, 16) === false,
    String(worth(4, 19, 4, 16)),
  );
  check(
    "a missing standard figure never reads as wasteful",
    worth(0, 16, 4, 16) === false,
  );
  check(
    "a missing requirement never reads as wasteful",
    worth(8, 32, 0, 16) === false,
  );
}

console.log("[isCustomExcluded reads the Custom classifier, GCP-scoped]");
{
  const excl = (opts) => run(`__gcp.isCustomExcluded(${J(opts)})`);
  check(
    "a GCP-tagged Custom token excludes",
    excl({ excludeTypes: [{ provider: "gcp", type: "Custom" }] }) === true,
  );
  check(
    "a plain 'custom' token excludes",
    excl({ excludeTypes: ["custom"] }) === true,
  );
  check(
    "a Custom token tagged for another provider does not",
    excl({ excludeTypes: [{ provider: "aws", type: "Custom" }] }) === false,
  );
  check("no exclude list → not excluded", excl({}) === false);
}

console.log("[customFitSuggestion ties the pieces together]");
{
  const suggest = (chosen, rc, rm, opts) =>
    run(
      `__gcp.customFitSuggestion(${J(chosen)}, ${J(rc)}, ${J(rm)}, ${J(opts || {})})`,
    );
  const std = { instanceType: "n2-standard-8", vCpus: 8, memory: 32 };
  check(
    "an over-provisioned standard pick yields a tighter custom shape",
    suggest(std, 4, 16, {}) === "n2-custom-4-16384",
    suggest(std, 4, 16, {}),
  );
  check(
    "an exact-fit pick yields no suggestion",
    suggest(
      { instanceType: "n2-standard-4", vCpus: 4, memory: 16 },
      4,
      16,
      {},
    ) === "",
  );
  check(
    "Custom excluded → no suggestion even when wasteful",
    suggest(std, 4, 16, { excludeTypes: ["custom"] }) === "",
  );
  check(
    "a no-data pick → no suggestion",
    suggest(
      { instanceType: "No data available", vCpus: 0, memory: 0 },
      4,
      16,
      {},
    ) === "",
  );
  check(
    "a non-custom family pick (c2) → no suggestion",
    suggest(
      { instanceType: "c2-standard-8", vCpus: 8, memory: 32 },
      4,
      16,
      {},
    ) === "",
  );
}

// The factory wiring: a real GCP run carries the GCP Custom Fit column (empty or
// filled), proving the column is initialised and the suggestion is called.
(async () => {
  const { buildContext } = require("../harness");
  const { ctx: c } = buildContext({ dataScript: "js/gcp/gcp-data.js" });
  console.log("[a GCP run surfaces the GCP Custom Fit column]");
  const res = await c.getInstanceRecommendationWithSelector(
    [
      {
        "VM Name": "g",
        "CPU Count": "1",
        "Memory (GB)": "1",
        "GCP Region": "us-central1",
      },
    ],
    ["gcp"],
    {},
  );
  check(
    "the result carries a GCP Custom Fit column",
    !!res[0] && "GCP Custom Fit" in res[0],
    JSON.stringify(Object.keys(res[0] || {})),
  );

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
  // pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

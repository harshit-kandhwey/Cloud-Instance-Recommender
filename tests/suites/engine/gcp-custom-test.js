// GCP custom machine types, part 1 — the shape primitives (Phase C1).
// When a standard GCP shape over-provisions a row, a custom vCPU/RAM shape can fit
// it tighter. Two pure pieces build that suggestion:
//   - buildCustomMachineType: the tightest VALID custom type for a required size,
//     applying GCP's rules (vCPU 1 or even; memory a whole 256 MB block, 0.5–8 GB
//     per vCPU) — or "" for a family GCP does not let you customise;
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
    "1 vCPU is allowed (not rounded up to 2)",
    custom("e2", 1, 2) === "e2-custom-1-2048",
    custom("e2", 1, 2),
  );
  check(
    "memory rounds UP to a whole 256 MB block, never below the need",
    custom("n2", 2, 5.1) === "n2-custom-2-5376",
    custom("n2", 2, 5.1),
  );
  check(
    "memory below 0.5 GB/vCPU is clamped up into the band",
    custom("n2", 8, 1) === "n2-custom-8-4096",
    custom("n2", 8, 1),
  );
  check(
    "memory above 8 GB/vCPU is clamped down into the band",
    custom("n2", 2, 100) === "n2-custom-2-16384",
    custom("n2", 2, 100),
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

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

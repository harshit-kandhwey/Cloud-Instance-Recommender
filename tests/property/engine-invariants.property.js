// Property-based engine invariants (base-instance-selector.js + rule-engine.js +
// instance-selector-factory.js). Where the example-based engine suites pin ONE
// hand-built pool per behaviour, this fuzzes hundreds of random pools + requests
// against four load-bearing guarantees the selector must never break:
//
//   P1 Soundness    — a matched recommendation ALWAYS meets the requested
//                     vCPU and memory. Under-provisioning is the failure the
//                     engine's own comments call "the one that hurts", so this
//                     runs against a RICH pool (burstable / accelerator / mixed
//                     processors / every generation) under FULLY RANDOM rule
//                     options — it must hold no matter what the pipeline does.
//   P2 No-Match honesty — with no soft filters and no workload preference, the
//                     result is No-Match IFF no instance meets the size. The
//                     test recomputes "does any fit?" itself as an independent
//                     oracle, so a bug that no-matches a fittable request (or
//                     matches an unfittable one) is caught.
//   P3 Target monotonicity — a stricter target never returns a CHEAPER box: for
//                     a fixed pool, req' ⊇ req ⇒ price(pick') ≥ price(pick),
//                     No-Match treated as +∞. Provable because feasible sets
//                     nest and the pick is the cheapest survivor.
//   P4 Determinism   — same pool + request + options ⇒ identical recommendation
//                     across calls; guards against an accidental dependency on
//                     iteration order, Date, or shared mutable state.
//
// This suite lives OUTSIDE tests/suites/ (so run-all.js and the coverage tool
// never see it) and OUTSIDE `npm test`: it is the one harness suite that needs a
// node_module (fast-check), and the core `node tests/run-all.js` run stays
// dependency-free. Invoke it with `npm run test:property`.
//
// BOUNDS THAT MAKE THE PROPERTIES TRUE (not the engine's — the TEST's):
//   • P2/P3 use a "plain" pool (General purpose, non-burstable, non-accelerator,
//     Intel, current-gen) and EMPTY rule options, because even a blank workload
//     trips the rule engine's non-GPU branch (rule-engine.js:577) which drops
//     accelerators, and burstable/mac families have their own rules — any of
//     which would legitimately make the P2 iff and the P3 price-order false.
//   • P3 additionally forbids the workload-preference sort: it reorders the pool
//     by family, not price, so the cheapest-survivor pick — and thus price
//     monotonicity — no longer holds. Hard filters (current-gen, family,
//     processor) DO nest and are exercised by a P3 variant.
const fc = require("fast-check");
const { buildEngineContext, makeChecker } = require("../suites/harness");

const { ctx } = buildEngineContext({
  scripts: [
    "js/base/rule-engine.js",
    "js/base/base-instance-selector.js",
    "js/base/instance-selector-factory.js",
  ],
  label: "property-invariants",
});

// A bare AWS-flavoured base selector, plus a __pick helper that runs entirely
// INSIDE the vm realm: pool + options cross the boundary as JSON strings and are
// re-parsed in-context, so every object the engine touches is native to its own
// realm (no cross-realm Array/prototype surprises). Returns just the fields the
// properties assert on.
ctx.window.__setup = `
  __sel = new BaseInstanceSelector();
  __sel.getProviderName = function () { return "AWS"; };
  __sel.getSampleData = function () { return []; };
  __pick = function (poolJson, region, cpu, mem, optsJson) {
    __sel.instanceData = {};
    __sel.instanceData[region] = JSON.parse(poolJson);
    var r = __sel.getLikeToLikeInstance(region, cpu, mem, JSON.parse(optsJson));
    return {
      instanceType: r.instanceType,
      vCpus: r.vCpus,
      memory: r.memory,
      price: r.price,
    };
  };
  true;
`;
require("vm").runInContext(ctx.window.__setup, ctx, {
  filename: "property-invariants-setup",
});

const NO_MATCH = "No data available";
const REGION = "test-region";

// price crosses as an integer count of milli-units, so the oracle compares exact
// integers and never trips over float equality.
const priceMilli = fc.integer({ min: 1, max: 100000 });
const vcpu = fc.integer({ min: 1, max: 64 });
const mem = fc.integer({ min: 1, max: 256 });

// A "plain" instance: nothing that any rule branch keys on. General purpose,
// current-gen, Intel, a non-burstable / non-accelerator / non-mac family. With
// empty options the rule engine is a genuine no-op over a pool of these.
const plainRec = fc.record({
  vCpus: vcpu,
  memory: mem,
  priceMilli,
  fam: fc.constantFrom("m5", "m6i", "c5", "c6i", "r5", "r6i"),
});

// A "rich" instance: spans the families and traits the rule pipeline reacts to,
// so P1 is stressed against burstable, accelerator, Graviton, prev-gen and mixed
// processors — exactly the pool where a filter/sort bug could leak an
// under-sized box through.
const richRec = fc.record({
  vCpus: vcpu,
  memory: mem,
  priceMilli,
  fam: fc.constantFrom("t3", "m5", "c5", "r5", "p3", "g4dn", "mac1", "m7g"),
  familyName: fc.constantFrom(
    "General purpose",
    "Compute optimized",
    "Memory optimized",
    "GPU instance",
  ),
  processor: fc.constantFrom("Intel", "AMD", "Graviton"),
  generation: fc.constantFrom(1, 2),
  isGraviton: fc.constantFrom(0, 1),
});

// Turn generated records into a price-sorted pool with unique instance types —
// parseData sorts by price ascending and getLikeToLikeInstance relies on
// filteredInstances[0] being the cheapest, so the injected pool must mirror that.
function toPool(records, plain) {
  return records
    .map((r, idx) => ({
      instanceType: `${r.fam}.n${idx}`,
      vCpus: r.vCpus,
      memory: r.memory,
      price: r.priceMilli / 1000,
      family: r.fam,
      familyName: plain ? "General purpose" : r.familyName,
      processor: plain ? "Intel" : r.processor,
      generation: plain ? 1 : r.generation,
      isGraviton: plain ? 0 : r.isGraviton,
    }))
    .sort((a, b) => a.price - b.price);
}

const plainPool = fc
  .array(plainRec, { minLength: 1, maxLength: 12 })
  .map((rs) => toPool(rs, true));
const richPool = fc
  .array(richRec, { minLength: 1, maxLength: 12 })
  .map((rs) => toPool(rs, false));

const pick = (pool, cpu, memReq, opts) =>
  ctx.window.__pick(
    JSON.stringify(pool),
    REGION,
    cpu,
    memReq,
    JSON.stringify(opts),
  );

const { check, state } = makeChecker();

// Wrap one fast-check property so a falsified case (with fast-check's shrunk
// counterexample AND its reproduction seed, both in the thrown message) surfaces
// as a single named FAIL rather than an uncaught throw.
function prop(name, arb, predicate, numRuns = 250) {
  try {
    fc.assert(fc.property(arb, predicate), { numRuns });
    check(name, true);
  } catch (err) {
    check(name, false, String(err && err.message ? err.message : err));
  }
}

// ── P1: Soundness — a matched box never under-provisions ───────────────────
// Rich pool, fully random rule options. If it matched, it fits.
const p1Options = fc.record({
  currentGenerationOnly: fc.boolean(),
  restrictProcessorManufacturers: fc.boolean(),
  selectedProcessorManufacturers: fc.subarray(["Intel", "AMD", "Graviton"]),
  excludeTypes: fc.subarray([
    "burstable",
    "graviton",
    "gpu",
    "previous generation",
  ]),
  rowEnv: fc.constantFrom("", "production", "staging", "dev", "qa"),
  rowOS: fc.constantFrom("linux", "windows", "macos"),
  rowWorkload: fc.constantFrom(
    "general",
    "database",
    "web server",
    "sql server",
    "machine learning",
  ),
  rowCompliance: fc.constantFrom("", "pci", "hipaa", "soc2"),
});

prop(
  "P1 soundness — a matched recommendation always meets requested vCPU and memory",
  fc.tuple(richPool, vcpu, mem, p1Options),
  ([pool, cpu, memReq, opts]) => {
    const r = pick(pool, cpu, memReq, opts);
    if (r.instanceType === NO_MATCH) return true; // no-match makes no size claim
    return r.vCpus >= cpu && r.memory >= memReq;
  },
);

// ── P2: No-Match honesty — no-match IFF nothing fits ───────────────────────
// Plain pool, no options: the rule engine is a no-op, so the ONLY reason to
// no-match is the size floor. The oracle recomputes "does any fit?".
prop(
  "P2 no-match honesty — no-match exactly when no instance meets the size",
  fc.tuple(plainPool, vcpu, mem),
  ([pool, cpu, memReq]) => {
    const r = pick(pool, cpu, memReq, {});
    const anyFits = pool.some((i) => i.vCpus >= cpu && i.memory >= memReq);
    const matched = r.instanceType !== NO_MATCH;
    return matched === anyFits;
  },
);

// ── P3: Target monotonicity — stricter target never returns a cheaper box ──
// Plain pool, no workload sort. Non-negative deltas make req2 ⊇ req1.
const monoInputs = fc.record({
  cpu1: vcpu,
  mem1: mem,
  dCpu: fc.integer({ min: 0, max: 64 }),
  dMem: fc.integer({ min: 0, max: 256 }),
});

prop(
  "P3 monotonicity — a stricter target never returns a cheaper box (size only)",
  fc.tuple(plainPool, monoInputs),
  ([pool, { cpu1, mem1, dCpu, dMem }]) => {
    const cpu2 = cpu1 + dCpu;
    const mem2 = mem1 + dMem;
    const r1 = pick(pool, cpu1, mem1, {});
    const r2 = pick(pool, cpu2, mem2, {});
    const m1 = r1.instanceType !== NO_MATCH;
    const m2 = r2.instanceType !== NO_MATCH;
    // No-match is +∞: a stricter target that no-matches is fine, but if the
    // looser one already no-matched the stricter one MUST too.
    if (!m1) return !m2;
    if (!m2) return true;
    return r2.price >= r1.price;
  },
);

// P3b: hard filters nest too — the same monotonicity holds with a current-gen +
// processor restriction pinned on both picks. (The plain pool is all current-gen
// Intel, so these filters keep the whole pool but exercise the filtered path.)
prop(
  "P3b monotonicity — holds under hard filters (current-gen + processor)",
  fc.tuple(plainPool, monoInputs),
  ([pool, { cpu1, mem1, dCpu, dMem }]) => {
    const opts = {
      currentGenerationOnly: true,
      restrictProcessorManufacturers: true,
      selectedProcessorManufacturers: ["Intel"],
    };
    const r1 = pick(pool, cpu1, mem1, opts);
    const r2 = pick(pool, cpu1 + dCpu, mem1 + dMem, opts);
    const m1 = r1.instanceType !== NO_MATCH;
    const m2 = r2.instanceType !== NO_MATCH;
    if (!m1) return !m2;
    if (!m2) return true;
    return r2.price >= r1.price;
  },
);

// ── P4: Determinism — same input, same recommendation ──────────────────────
// A pure function of (pool, request, options), so two calls must agree exactly.
// Cheap to assert and it guards against an accidental dependency on iteration
// order, Date, or shared mutable state creeping into the pipeline. Rich pool +
// random options so it holds across the whole rule surface, not just plain runs.
prop(
  "P4 determinism — identical input yields an identical recommendation",
  fc.tuple(richPool, vcpu, mem, p1Options),
  ([pool, cpu, memReq, opts]) => {
    const a = pick(pool, cpu, memReq, opts);
    const b = pick(pool, cpu, memReq, opts);
    return (
      a.instanceType === b.instanceType &&
      a.vCpus === b.vCpus &&
      a.memory === b.memory &&
      a.price === b.price
    );
  },
);

console.log(
  state.failures
    ? `\nengine-invariants: ${state.failures} propert${state.failures === 1 ? "y" : "ies"} FAILED`
    : "\nengine-invariants: all properties held",
);
process.exitCode = state.failures ? 1 : 0;

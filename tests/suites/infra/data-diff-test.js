// data-diff suite: pins tools/data-diff.js's pure diff + report against synthetic
// old/new region snapshots — region/family/type deltas, spec and price moves, the
// no-op guard, the CHANGES/NO-CHANGES sentinel, and monolith parsing. No network.
const { makeChecker } = require("../harness");
const {
  diffProvider,
  hasChanges,
  renderReport,
  renderProvider,
  regionsFromMonolith,
} = require("../../../tools/data-diff");
const { buildMonolith } = require("../../../tools/fetch-vantage");

const { check, state } = makeChecker();

// Minimal AWS record — only the fields data-diff reads (family, specs, prices).
const aws = (o) => ({
  instanceFamily: o.family,
  instanceFamilyName: "General purpose",
  isGraviton: o.isGraviton ?? 0,
  currentGeneration: 1,
  processorManufacturer: "Intel",
  vCpus: o.vCpus,
  memorySizeInGiB: o.mem,
  nitroEnclavesSupport: 0,
  onDemandLinuxHr: o.linux,
  onDemandWindowsHr: o.win ?? 0,
});

// ── AWS delta scenario ──────────────────────────────────────────────────────────
{
  const old = {
    us_east_1: {
      "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.096 }),
      "c1.medium": aws({ family: "c1", vCpus: 2, mem: 1.7, linux: 0.13 }),
    },
    eu_west_1: {
      "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.1 }),
    },
  };
  const nw = {
    us_east_1: {
      // m5.large: spec change (vCpus 2→4) + price move (0.096→0.099).
      "m5.large": aws({ family: "m5", vCpus: 4, mem: 8, linux: 0.099 }),
      // c8g.medium: brand new family + type.
      "c8g.medium": aws({
        family: "c8g",
        isGraviton: 1,
        vCpus: 1,
        mem: 2,
        linux: 0.036,
      }),
    },
    eu_west_1: {
      "m5.large": aws({ family: "m5", vCpus: 4, mem: 8, linux: 0.1 }), // price unchanged here
    },
    ap_south_1: {
      "m5.large": aws({ family: "m5", vCpus: 4, mem: 8, linux: 0.09 }),
    },
  };
  const d = diffProvider("aws", old, nw);

  check("[aws] has changes", hasChanges(d) === true);
  check(
    "[aws] region ap_south_1 added",
    d.regionsAdded.join(",") === "ap_south_1",
    d.regionsAdded.join(","),
  );
  check("[aws] no regions removed", d.regionsRemoved.length === 0);
  check(
    "[aws] family c8g added",
    d.familiesAdded.join(",") === "c8g",
    d.familiesAdded.join(","),
  );
  check(
    "[aws] family c1 removed",
    d.familiesRemoved.join(",") === "c1",
    d.familiesRemoved.join(","),
  );
  check(
    "[aws] c8g.medium added (all regions it prices in)",
    d.typesAdded.length === 1 &&
      d.typesAdded[0].type === "c8g.medium" &&
      d.typesAdded[0].family === "c8g" &&
      d.typesAdded[0].regions === 1,
    JSON.stringify(d.typesAdded),
  );
  check(
    "[aws] c1.medium retired",
    d.typesRemoved.length === 1 && d.typesRemoved[0].type === "c1.medium",
    JSON.stringify(d.typesRemoved),
  );
  check(
    "[aws] m5.large vCpus spec change 2 → 4 reported once (region-independent)",
    d.specChanges.length === 1 &&
      d.specChanges[0].type === "m5.large" &&
      d.specChanges[0].field === "vCpus" &&
      d.specChanges[0].old === 2 &&
      d.specChanges[0].new === 4,
    JSON.stringify(d.specChanges),
  );
  check(
    "[aws] m5.large linux price move: only us_east_1 changed, sample carries pct",
    d.priceChanges.length === 1 &&
      d.priceChanges[0].type === "m5.large" &&
      d.priceChanges[0].field === "onDemandLinuxHr" &&
      d.priceChanges[0].regionsChanged === 1 &&
      d.priceChanges[0].sample.region === "us_east_1" &&
      d.priceChanges[0].sample.old === 0.096 &&
      d.priceChanges[0].sample.new === 0.099 &&
      Math.abs(d.priceChanges[0].sample.pct - 3.125) < 1e-9,
    JSON.stringify(d.priceChanges),
  );

  const report = renderReport([d]);
  check(
    "[aws] report carries CHANGES sentinel first",
    report.startsWith("<!-- data-diff: CHANGES -->"),
    report.split("\n")[0],
  );
  check(
    "[aws] report shows absolute old → new prices (Absolute + %)",
    report.includes("0.096 → 0.099") && report.includes("+3.1%"),
  );
  check(
    "[aws] retired size names its family",
    report.includes("c1.medium [c1]"),
  );
}

// ── Price-move aggregation: largest-magnitude sample, pct range ─────────────────
{
  const rec = (linux) => aws({ family: "m5", vCpus: 2, mem: 8, linux });
  const old = {
    r1: { "m5.large": rec(1.0) },
    r2: { "m5.large": rec(1.0) },
    r3: { "m5.large": rec(1.0) },
  };
  const nw = {
    r1: { "m5.large": rec(1.01) }, // +1%
    r2: { "m5.large": rec(1.0) }, // unchanged
    r3: { "m5.large": rec(1.2) }, // +20%
  };
  const d = diffProvider("aws", old, nw);
  const pc = d.priceChanges[0];
  check(
    "[price] only changed regions counted (2 of 3)",
    pc.regionsChanged === 2,
    String(pc.regionsChanged),
  );
  check(
    "[price] sample is the largest move (r3 +20%)",
    pc.sample.region === "r3" && Math.abs(pc.sample.pct - 20) < 1e-9,
    JSON.stringify(pc.sample),
  );
  check(
    "[price] pct range spans min..max",
    Math.abs(pc.minPct - 1) < 1e-9 && Math.abs(pc.maxPct - 20) < 1e-9,
    `${pc.minPct}..${pc.maxPct}`,
  );
}

// ── Sub-ULP price noise suppressed (old data predating the 8-decimal normalizer) ──
{
  const old = {
    r1: {
      "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.898464615 }),
    },
  };
  const nw = {
    r1: {
      "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.89846462 }),
    },
  };
  const d = diffProvider("aws", old, nw);
  check(
    "[price] 9-decimal → 8-decimal rounding is not a price move",
    d.priceChanges.length === 0,
    JSON.stringify(d.priceChanges),
  );
  // A change at the 8-decimal grid IS a real move.
  const real = diffProvider("aws", old, {
    r1: { "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.9 }) },
  });
  check(
    "[price] real move above rounding precision still reported",
    real.priceChanges.length === 1,
    JSON.stringify(real.priceChanges),
  );
}

// ── No-op guard ─────────────────────────────────────────────────────────────────
{
  const same = {
    us_east_1: {
      "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.096 }),
    },
  };
  const d = diffProvider("aws", same, JSON.parse(JSON.stringify(same)));
  check("[noop] identical data → no changes", hasChanges(d) === false);
  const report = renderReport([d]);
  check(
    "[noop] report carries NO-CHANGES sentinel",
    report.startsWith("<!-- data-diff: NO-CHANGES -->"),
    report.split("\n")[0],
  );
  check(
    "[noop] report states no changes",
    report.includes("No data changes detected."),
  );
}

// ── regionsFromMonolith: parse a real generated monolith ────────────────────────
{
  const instances = [
    {
      instance_type: "n2-standard-4",
      family: "General purpose",
      generation: "current",
      vCPU: 4,
      memory: 16,
      pricing: {
        "us-central1": {
          linux: { ondemand: 0.19 },
          windows: { ondemand: 0.3 },
        },
      },
    },
  ];
  const { monolith } = buildMonolith({
    name: "gcp",
    prefix: "GCP",
    source: "instances.vantage.sh/gcp",
    instances,
    shippedKeys: ["us_central1"],
    dataDate: "2026-08-22",
  });
  const regions = regionsFromMonolith(monolith);
  check(
    "[monolith] region key extracted from make-call",
    Object.keys(regions).join(",") === "us_central1",
    Object.keys(regions).join(","),
  );
  check(
    "[monolith] record body carried through",
    regions.us_central1["n2-standard-4"].vCpus === 4 &&
      regions.us_central1["n2-standard-4"].hourlyPrice === 0.19,
    JSON.stringify(regions.us_central1),
  );

  // Diff a monolith against itself → no changes (round-trip sanity).
  const d = diffProvider("gcp", regions, regionsFromMonolith(monolith));
  check("[monolith] self-diff is a no-op", hasChanges(d) === false);
}

// ── Unchanged provider section + all-quiet short-circuit ────────────────────────
{
  const empty = diffProvider(
    "azure",
    { eastus: { d4sv5: {} } },
    { eastus: { d4sv5: {} } },
  );
  // Per-provider render: an unchanged provider still gets a titled "No changes." block
  // (shown when a SIBLING provider changed and the report renders every section).
  const section = renderProvider(empty);
  check(
    "[azure] unchanged provider section titled with 'No changes.'",
    section.startsWith("### Azure") && section.includes("No changes."),
    section,
  );
  // Whole-report: when EVERY provider is quiet, the report collapses to the sentinel
  // + one line and skips per-provider sections.
  const report = renderReport([empty]);
  check(
    "[azure] all-quiet report short-circuits (no per-provider section)",
    report.startsWith("<!-- data-diff: NO-CHANGES -->") &&
      !report.includes("### Azure"),
    report,
  );
}

if (state.failures) {
  console.error(`\ndata-diff: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\ndata-diff: all checks passed");
  process.exitCode = 0;
}

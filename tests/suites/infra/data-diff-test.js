// data-diff suite: pins tools/data-diff.js's pure diff + report against synthetic
// old/new region snapshots — region/family/type deltas, spec and price moves, the
// no-op guard, the CHANGES/NO-CHANGES sentinel, and monolith parsing. No network.
const fs = require("fs");
const path = require("path");
const { makeChecker } = require("../harness");
const {
  diffProvider,
  hasChanges,
  renderReport,
  renderProvider,
  renderUnpriced,
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

// ── Non-finite price anomaly: reported, never a silent no-change ─────────────────
{
  const old = {
    r1: { "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.096 }) },
  };
  // A broken refresh emitted a non-numeric price on the new side.
  const broken = aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.096 });
  broken.onDemandLinuxHr = NaN;
  const nw = { r1: { "m5.large": broken } };
  const d = diffProvider("aws", old, nw);
  check(
    "[anomaly] finite → NaN price is a reported change, not a silent skip",
    hasChanges(d) === true &&
      d.priceChanges.length === 1 &&
      d.priceChanges[0].sample.region === "r1",
    JSON.stringify(d.priceChanges),
  );
  const report = renderReport([d]);
  check(
    "[anomaly] report carries CHANGES sentinel + flags the unparseable side",
    report.startsWith("<!-- data-diff: CHANGES -->") &&
      report.includes("unparseable"),
    report.split("\n")[0],
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

  // A make-call listing a region key the body never defines must fail by name,
  // not crash later in Object.entries(undefined) with no context.
  const orphan = [
    "function makeGCPRegionsGlobal(regions){ for (const k in regions) window[k] = regions[k]; }",
    'const us_central1 = { "n2-standard-2": { series: "n2" } };',
    "const ghost_region = undefined;",
    "makeGCPRegionsGlobal({",
    "  us_central1,",
    "  ghost_region,",
    "});",
  ].join("\n");
  let msg = "";
  try {
    regionsFromMonolith(orphan);
  } catch (e) {
    msg = String((e && e.message) || e);
  }
  check(
    "[monolith] region listed but never defined → named error",
    /ghost_region/.test(msg),
    msg,
  );
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

// ── Shipped region data comes from the shared loader, never a private walk ────
// Structural, because the failure is structural AND silent. Specs live in the
// manifest now; a private readdirSync over regions/ returns the PRICE half only, so
// every spec field would read undefined and the diff would report a spec change
// for every type in the catalogue, or none at all. Nothing throws, nothing is
// empty, and the loss reads as a data change rather than as a bug. recommendation-diff
// already carries this pin — it is here because the twin is what went missing last time.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "tools", "data-diff.js"),
    "utf8",
  );
  // Strip line comments before looking, so the check matches the CALL and not prose
  // about it — a check that reads comments reports on documentation. (data-diff.js
  // happens to mention neither word today; the twin in fetch-vantage-test does, which
  // is where this guard was learned. Keep it: a comment is one edit away.)
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  check(
    "data-diff reads shipped region data through loadCommittedRegions",
    code.includes("loadCommittedRegions") && !/readdirSync\s*\(/.test(code),
    // Detail prints only on failure, so the else-branch is not "all good" — it is
    // the other way this check can fail: the shared loader is gone entirely.
    /readdirSync\s*\(/.test(code)
      ? "has its own readdirSync"
      : "no loadCommittedRegions call",
  );
}

// ── Records priced for no OS: reported, but never a "change" ────────────────────
// The recommender drops a record it cannot price. That exclusion is right; the
// silence around it was the defect. This section is the only thing that says so,
// so it must survive a no-change refresh — and must not, by existing, turn one
// into a PR-opening change, or the gap would raise a PR every month forever.
{
  const snap = {
    us_east_1: {
      // Priced for Linux only — still priced, so not reported.
      "inf1.xlarge": aws({ family: "inf1", vCpus: 4, mem: 8, linux: 0.228 }),
      // Priced for Windows only — also still priced.
      "u-6tb1.metal": aws({
        family: "u-6tb1",
        vCpus: 448,
        mem: 6144,
        linux: 0,
        win: 20.608,
      }),
      // Priced for NEITHER: the case this section exists for.
      "p4d.24xlarge": aws({
        family: "p4d",
        vCpus: 96,
        mem: 1152,
        linux: 0,
        win: 0,
      }),
    },
    eu_west_1: {
      // The SAME type, priced here — which is what makes the us_east_1 record a
      // feed gap rather than a withdrawal.
      "p4d.24xlarge": aws({
        family: "p4d",
        vCpus: 96,
        mem: 1152,
        linux: 32.77,
      }),
    },
  };
  const d = diffProvider("aws", snap, JSON.parse(JSON.stringify(snap)));

  check(
    "[unpriced] a record priced for no OS is reported",
    d.unpriced.length === 1 && d.unpriced[0].type === "p4d.24xlarge",
    JSON.stringify(d.unpriced.map((u) => u.type)),
  );
  check(
    "[unpriced] it names the regions that carry no price",
    JSON.stringify(d.unpriced[0].regions) === JSON.stringify(["us_east_1"]),
    JSON.stringify(d.unpriced[0].regions),
  );
  check(
    "[unpriced] and counts the regions that DO price it (gap vs withdrawal)",
    d.unpriced[0].pricedIn === 1,
    String(d.unpriced[0].pricedIn),
  );
  check(
    "[unpriced] a record priced for only ONE OS is not reported",
    !d.unpriced.some((u) => /inf1|u-6tb1/.test(u.type)),
    JSON.stringify(d.unpriced.map((u) => u.type)),
  );

  // The load-bearing one: identical old/new, so nothing changed.
  check(
    "[unpriced] does not count as a change (a standing gap must not open a PR)",
    hasChanges(d) === false,
    `hasChanges=${hasChanges(d)}`,
  );
  const report = renderReport([d]);
  check(
    "[unpriced] the report still carries the NO-CHANGES sentinel",
    report.startsWith("<!-- data-diff: NO-CHANGES -->"),
    report.split("\n")[0],
  );
  check(
    "[unpriced] yet the section is rendered on that unchanged run",
    report.includes("Records priced for no operating system (1)") &&
      report.includes("p4d.24xlarge [p4d] — unpriced in us_east_1") &&
      report.includes("priced in 1 other region"),
    report,
  );
  check(
    "[unpriced] no absolute price reaches the section (D8)",
    !/32\.77|20\.608|0\.228/.test(renderUnpriced([d])),
    renderUnpriced([d]),
  );

  // Absent is not zero — the same distinction the selector draws. A record that
  // never carried the field is malformed, not a priced-at-zero product statement,
  // and folding the two together would turn a broken refresh into a page of
  // plausible-looking "price gaps".
  const malformed = diffProvider(
    "aws",
    { us_east_1: { "ghost.large": {} } },
    { us_east_1: { "ghost.large": {} } },
  );
  check(
    "[unpriced] a record with NO price field is not reported as unpriced",
    malformed.unpriced.length === 0 && renderUnpriced([malformed]) === null,
    JSON.stringify(malformed.unpriced),
  );

  const clean = diffProvider(
    "aws",
    {
      us_east_1: {
        "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.1 }),
      },
    },
    {
      us_east_1: {
        "m5.large": aws({ family: "m5", vCpus: 2, mem: 8, linux: 0.1 }),
      },
    },
  );
  check(
    "[unpriced] fully-priced data renders no section at all",
    clean.unpriced.length === 0 &&
      renderUnpriced([clean]) === null &&
      !renderReport([clean]).includes("priced for no operating system"),
  );
}

if (state.failures) {
  console.error(`\ndata-diff: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\ndata-diff: all checks passed");
  process.exitCode = 0;
}

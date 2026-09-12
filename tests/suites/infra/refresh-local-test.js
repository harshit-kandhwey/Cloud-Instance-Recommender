// refresh-local suite: pins tools/refresh-local.js's pure plan — the pipeline order
// (each step consumes what the one before it produced, and split-data runs LAST because
// it is the only step that writes the shipped js/ tree both diffs read as the OLD side),
// that --specs-only drops the official fetch + reconcile, the .env parser, and the
// required-key gate. The order IS the reason this tool exists, so it is guarded RED.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");
const {
  planSteps,
  skipNotice,
  parseEnv,
  missingKeys,
} = require("../../../tools/refresh-local");

const { check, state } = makeChecker();

const names = (opts) => planSteps(opts).map((s) => s.name);

// ── Full (pricing) plan: order + membership ──────────────────────────────────────
{
  const order = names({ pricing: true, date: "2026-08-26" });
  check(
    "pricing plan is the full ordered pipeline",
    order.join(" -> ") ===
      "fetch-official-aws -> fetch-official-azure -> fetch-official-gcp -> " +
        "fetch-vantage -> reconcile-data -> data-diff -> recommendation-diff -> split-data",
    order.join(" -> "),
  );

  // Guard A (plant-RED: move any official fetcher after reconcile-data): each official
  // fetch writes the .refresh-cache/{p}-pricing.json that reconcile consumes, so all
  // three must precede it. They also precede fetch-vantage, which they no longer need
  // to — fetch-vantage stopped overwriting the manifest they read — but the declared
  // order is what CI mirrors step for step, so it is pinned as declared.
  const vantage = order.indexOf("fetch-vantage");
  check(
    "all official fetchers run BEFORE fetch-vantage and reconcile-data",
    ["fetch-official-aws", "fetch-official-azure", "fetch-official-gcp"].every(
      (n) =>
        order.indexOf(n) !== -1 &&
        order.indexOf(n) < vantage &&
        order.indexOf(n) < order.indexOf("reconcile-data"),
    ),
    order.join(" -> "),
  );

  // Guard B (plant-RED: put split-data before data-diff): the diff and the flip check both
  // read the shipped js/ tree as the OLD side, and split-data is the one step that rewrites
  // it, so both must come first — reconcile between vantage and diff so the diff sees
  // reconciled prices; recommendation-diff after data-diff and before split.
  check(
    "reconcile after fetch-vantage, data-diff after reconcile, recommendation-diff before split-data LAST",
    vantage < order.indexOf("reconcile-data") &&
      order.indexOf("reconcile-data") < order.indexOf("data-diff") &&
      order.indexOf("data-diff") < order.indexOf("recommendation-diff") &&
      order.indexOf("recommendation-diff") < order.indexOf("split-data") &&
      order[order.length - 1] === "split-data",
    order.join(" -> "),
  );
}

// ── Specs-only plan: no official fetch, no reconcile ─────────────────────────────
{
  const order = names({ pricing: false, date: "2026-08-26" });
  check(
    "specs-only plan is fetch-vantage -> data-diff -> recommendation-diff -> split-data",
    order.join(" -> ") ===
      "fetch-vantage -> data-diff -> recommendation-diff -> split-data",
    order.join(" -> "),
  );
  check(
    "specs-only plan drops every official fetch + reconcile",
    !order.some(
      (n) => n.startsWith("fetch-official-") || n === "reconcile-data",
    ),
    order.join(" -> "),
  );
}

// ── data-diff step carries the sentinel/capture wiring ──────────────────────────
{
  const diff = planSteps({ pricing: true, date: "x" }).find(
    (s) => s.name === "data-diff",
  );
  const split = planSteps({ pricing: true, date: "x" }).find(
    (s) => s.name === "split-data",
  );
  check(
    "data-diff captures a report and is the sentinel step; split gated on changed",
    diff.isDiff === true &&
      /diff-report\.md$/.test(diff.captureTo) &&
      split.onlyIfChanged === true,
    JSON.stringify({ diff, split }),
  );
}

// ── --date flows into fetch-vantage ──────────────────────────────────────────────
{
  const v = planSteps({ pricing: false, date: "2026-01-02" }).find(
    (s) => s.name === "fetch-vantage",
  );
  check(
    "the snapshot date is passed to fetch-vantage",
    v.args.join(" ") === "--date 2026-01-02",
    v.args.join(" "),
  );
}

// ── .env parser ──────────────────────────────────────────────────────────────────
{
  const env = parseEnv(
    [
      "# a comment",
      "",
      "VANTAGE_API_KEY=abc123",
      'GCP_BILLING_API_KEY="q u o t e d"',
      "SPACED = trimmed ",
      "no_equals_line",
      "TRAILING_CR=win\r",
    ].join("\n"),
  );
  check(
    "parseEnv reads keys, strips quotes/CR/whitespace, skips comments and junk",
    env.VANTAGE_API_KEY === "abc123" &&
      env.GCP_BILLING_API_KEY === "q u o t e d" &&
      env.SPACED === "trimmed" &&
      env.TRAILING_CR === "win" &&
      !("no_equals_line" in env),
    JSON.stringify(env),
  );
}

// ── required-key gate ────────────────────────────────────────────────────────────
{
  check(
    "pricing run requires Vantage + GCP keys; specs-only requires only Vantage",
    missingKeys({ pricing: true }, {}).join(",") ===
      "VANTAGE_API_KEY,GCP_BILLING_API_KEY" &&
      missingKeys({ pricing: false }, {}).join(",") === "VANTAGE_API_KEY" &&
      missingKeys(
        { pricing: true },
        {
          VANTAGE_API_KEY: "x",
          GCP_BILLING_API_KEY: "y",
        },
      ).length === 0,
  );
}

// ── The skip notice names the step it is actually skipping ──────────────────────
{
  const gated = planSteps({ pricing: true, date: "x" }).filter(
    (s) => s.onlyIfChanged,
  );
  check(
    "more than one step is gated on the diff finding changes",
    gated.length >= 2,
    gated.map((s) => s.name).join(","),
  );

  // Guard (plant-RED: hardcode one step name in skipNotice): a no-op diff skips
  // BOTH gated steps and prints the notice once each, so a fixed name mislabels
  // every step but the one it names.
  const wrong = gated.filter((s) => !skipNotice(s).includes(s.name));
  check(
    "the skip notice names each gated step it skips",
    wrong.length === 0,
    wrong.map((s) => `${s.name}: ${skipNotice(s).trim()}`).join(" | ") ||
      "none",
  );
}

// ── The three places that state the order stay in step with the plan ────────────
// The order is load-bearing, so a stale statement of it is a real hazard: a
// maintainer following a header that omits a step reorders the pipeline by hand.
// recommendation-diff was added to planSteps and to the workflow body but not to
// these headers, which is exactly the drift this pins.
{
  const chainSteps = planSteps({ pricing: true, date: "x" })
    .map((s) => s.name)
    .filter((n) => !n.startsWith("fetch-official-"));

  // The arrow chain itself, not the surrounding prose: each file states the order
  // once, from the fetch-vantage arrow through split-data, wrapped over one or two
  // lines. Reading the whole file would pass on a prose mention of a step the chain
  // omits, which is the drift being pinned.
  const chainOf = (rel) => {
    const lines = fs.readFileSync(path.join(REPO, rel), "utf8").split("\n");
    const start = lines.findIndex((l) => /fetch-vantage\s*(->|→)/.test(l));
    if (start === -1) return "";
    const end = lines.findIndex(
      (l, i) => i >= start && l.includes("split-data"),
    );
    return end === -1 ? "" : lines.slice(start, end + 1).join(" ");
  };

  for (const rel of [
    "tools/refresh-local.js",
    ".github/workflows/data-refresh.yml",
    "docs/DATA-SOURCES.md",
  ]) {
    const chain = chainOf(rel);
    const missing = chainSteps.filter((n) => !chain.includes(n));
    check(
      `${rel} states the full pipeline order`,
      chain !== "" && missing.length === 0,
      chain === "" ? "no order chain found" : missing.join(",") || "complete",
    );
  }
}

if (state.failures) {
  console.error(`\nrefresh-local: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nrefresh-local: all checks passed");
  process.exitCode = 0;
}

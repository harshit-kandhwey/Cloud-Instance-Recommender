// refresh-local suite: pins tools/refresh-local.js's pure plan — the LOAD-BEARING
// pipeline order (official fetchers before fetch-vantage, which overwrites the manifest
// they read; data-diff before split-data, which overwrites the regions/ it reads as the
// OLD side), that --specs-only drops the official fetch + reconcile, the .env parser, and
// the required-key gate. The order IS the reason this tool exists, so it is guarded RED.
const { makeChecker } = require("../harness");
const {
  planSteps,
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
        "fetch-vantage -> reconcile-data -> data-diff -> split-data",
    order.join(" -> "),
  );

  // Guard A (plant-RED: move any official fetcher after fetch-vantage): every official
  // fetch must precede fetch-vantage, which destroys the manifest they read.
  const vantage = order.indexOf("fetch-vantage");
  check(
    "all official fetchers run BEFORE fetch-vantage",
    ["fetch-official-aws", "fetch-official-azure", "fetch-official-gcp"].every(
      (n) => order.indexOf(n) !== -1 && order.indexOf(n) < vantage,
    ),
    order.join(" -> "),
  );

  // Guard B (plant-RED: put split-data before data-diff): the diff reads regions/ as the
  // OLD side, split overwrites it, so diff must come first — and reconcile between vantage
  // and diff so the diff sees reconciled prices.
  check(
    "reconcile after fetch-vantage, data-diff after reconcile, split-data LAST",
    vantage < order.indexOf("reconcile-data") &&
      order.indexOf("reconcile-data") < order.indexOf("data-diff") &&
      order.indexOf("data-diff") < order.indexOf("split-data") &&
      order[order.length - 1] === "split-data",
    order.join(" -> "),
  );
}

// ── Specs-only plan: no official fetch, no reconcile ─────────────────────────────
{
  const order = names({ pricing: false, date: "2026-08-26" });
  check(
    "specs-only plan is fetch-vantage -> data-diff -> split-data",
    order.join(" -> ") === "fetch-vantage -> data-diff -> split-data",
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

if (state.failures) {
  console.error(`\nrefresh-local: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nrefresh-local: all checks passed");
  process.exitCode = 0;
}

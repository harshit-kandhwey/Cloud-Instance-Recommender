// renderDataFreshness populates the header #dataFreshness badge from the loaded
// provider manifests' {P}_DATA_DATE globals: one date when providers agree, a
// per-provider breakdown when they differ, hidden when none loaded, and a no-op
// when the page lacks the placeholder. The DOMContentLoaded handler does not run
// in the harness, so each case calls renderDataFreshness() directly.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

(async () => {
  // ── Single provider ──────────────────────────────────────────────────────────
  {
    const { ctx, run } = buildContext({ dataScript: "js/aws/aws-data.js" });
    const awsDate = run("window.AWS_DATA_DATE");
    ctx.renderDataFreshness();
    const el = ctx.document.getElementById("dataFreshness");
    check(
      "[single] badge shows the provider's data date",
      el.textContent === `📅 Instance data updated ${awsDate}`,
      el.textContent,
    );
    check("[single] badge is unhidden", el.hidden === false);
    check("[single] badge carries an explanatory title", Boolean(el.title));
  }

  // ── Multiple providers, same date → deduped to one ───────────────────────────
  {
    const { ctx, run } = buildContext({
      dataScripts: [
        "js/aws/aws-data.js",
        "js/azure/azure-data.js",
        "js/gcp/gcp-data.js",
      ],
    });
    // A refresh stamps every provider with the same snapshot date, so the three
    // loaded globals agree and the badge dedupes to that one date.
    const awsDate = run("window.AWS_DATA_DATE");
    ctx.renderDataFreshness();
    const el = ctx.document.getElementById("dataFreshness");
    check(
      "[multi-same] one date, no per-provider breakdown",
      el.textContent === `📅 Instance data updated ${awsDate}` &&
        !el.textContent.includes("AWS"),
      el.textContent,
    );
  }

  // ── Multiple providers, differing dates → per-provider breakdown ─────────────
  {
    const { ctx, run } = buildContext({
      dataScripts: [
        "js/aws/aws-data.js",
        "js/azure/azure-data.js",
        "js/gcp/gcp-data.js",
      ],
    });
    const awsDate = run("window.AWS_DATA_DATE");
    const gcpDate = run("window.GCP_DATA_DATE");
    // Force a divergence: inject an Azure date guaranteed to differ from the
    // loaded snapshot, so the per-provider breakdown path renders regardless of
    // what date the shipped data currently carries.
    const azureDate = awsDate === "2026-07-01" ? "2026-07-02" : "2026-07-01";
    run(`window.AZURE_DATA_DATE = ${JSON.stringify(azureDate)}`);
    ctx.renderDataFreshness();
    const el = ctx.document.getElementById("dataFreshness");
    check(
      "[multi-diff] each provider's date is named",
      el.textContent ===
        `📅 Instance data updated AWS ${awsDate} · Azure ${azureDate} · GCP ${gcpDate}`,
      el.textContent,
    );
  }

  // ── No date loaded → hidden, empty ───────────────────────────────────────────
  {
    const { ctx, run } = buildContext({ dataScript: "js/aws/aws-data.js" });
    run("delete window.AWS_DATA_DATE");
    ctx.renderDataFreshness();
    const el = ctx.document.getElementById("dataFreshness");
    check("[none] badge hidden when no date loaded", el.hidden === true);
    check("[none] badge text cleared", el.textContent === "");
  }

  // ── Placeholder absent → no throw ────────────────────────────────────────────
  {
    const { ctx } = buildContext({
      dataScript: "js/aws/aws-data.js",
      missingElements: ["dataFreshness"],
    });
    let ok = true;
    try {
      ctx.renderDataFreshness();
    } catch {
      ok = false;
    }
    check("[absent] no-op when the page has no #dataFreshness", ok);
  }

  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

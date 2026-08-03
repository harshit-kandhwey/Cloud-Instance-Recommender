// Region validation panel + fuzzy lazy-load path.
// Loads main-script.js with a minimal DOM stub and drives parseCSV directly.
const { buildContext, parse } = require("../harness");

// Multicloud page: all three providers present, so parseCSV validates the AWS,
// Azure and GCP region columns at once. The shared loader records both the
// scripts it injects (requested) and any that fail to run (loaderErrors) — the
// same faults this suite used to track by hand, so a missing/renamed region
// file surfaces as a named FAIL instead of a silent "0 instances".
const { ctx, elements, requested, loaderErrors } = buildContext({
  dataScripts: [
    "js/aws/aws-data.js",
    "js/azure/azure-data.js",
    "js/gcp/gcp-data.js",
  ],
});

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

(async () => {
  // Mixed CSV: valid, AZ-suffix typo, garbage; valid Azure display name; GCP zone
  const csv = `VM Name,CPU Count,Memory (GB),AWS Region,Azure Region,GCP Region
a,4,16,us-east-1,East US,us-central1-a
b,2,8,us-east-1a,East US 2,europe-west1-c
c,2,4,narnia-99,Atlantis,mordor1-x`;

  parse(ctx, csv);

  console.log("[window._regionValidation]");
  const v = ctx._regionValidation;
  check("validation stored", v && v.aws && v.azure && v.gcp);
  // Optional-chain every lookup: a missing key would otherwise throw a TypeError
  // that unwinds to the outer catch, skipping the panel/prefetch/lazy-load checks
  // below and printing a stack trace instead of a named FAIL.
  check("aws us-east-1 exact", v?.aws?.["us-east-1"]?.status === "exact");
  check(
    "aws us-east-1a fuzzy → us_east_1",
    v?.aws?.["us-east-1a"]?.status === "fuzzy" &&
      v?.aws?.["us-east-1a"]?.key === "us_east_1",
    JSON.stringify(v?.aws?.["us-east-1a"]),
  );
  check("aws narnia-99 unknown", v?.aws?.["narnia-99"]?.status === "unknown");
  check("azure East US exact", v?.azure?.["East US"]?.status === "exact");
  check("azure East US 2 exact", v?.azure?.["East US 2"]?.status === "exact");
  check("azure Atlantis unknown", v?.azure?.["Atlantis"]?.status === "unknown");
  check("gcp zone exact", v?.gcp?.["us-central1-a"]?.status === "exact");
  check(
    "gcp europe-west1-c exact",
    v?.gcp?.["europe-west1-c"]?.status === "exact",
  );
  check("gcp mordor1-x unknown", v?.gcp?.["mordor1-x"]?.status === "unknown");

  console.log("[panel rendering]");
  const panel = elements["regionValidationSection"];
  check("panel visible", panel && !panel.classes.has("hidden"));
  // Read innerHTML through a guarded local: elements is populated lazily, so if
  // the app never rendered the panel, `panel` is undefined and every chip check
  // below would throw on .innerHTML — unwinding to the outer catch and skipping
  // the rest of the suite, the exact crash-vs-clean-failure the visibility check
  // above is meant to report as one FAIL.
  const panelHtml = panel?.innerHTML ?? "";
  check("panel has exact chip", panelHtml.includes("us-east-1 ✓"));
  check(
    "panel has fuzzy chip",
    panelHtml.includes("us-east-1a → us-east-1"),
    panelHtml.slice(0, 300),
  );
  check("panel has unknown chip", panelHtml.includes("narnia-99 ✗"));
  check("panel warns about sample data", panelHtml.includes("sample data"));
  check(
    "unknown count is 3",
    /3 region name\(s\) not recognized/.test(panelHtml),
  );

  // Poll for the fire-and-forget prefetch instead of a fixed sleep (CI-safe)
  const expectedSrcs = [
    "js/aws/regions/us_east_1.js",
    "js/azure/regions/eastus.js",
    "js/gcp/regions/us_central1.js",
  ];
  const deadline = Date.now() + 2000;
  while (
    Date.now() < deadline &&
    !expectedSrcs.every((s) => requested.includes(s))
  ) {
    await new Promise((r) => setTimeout(r, 25));
  }
  console.log("[prefetch] requested: " + requested.join(", "));
  check(
    "no loader faults while fetching region files",
    loaderErrors.length === 0,
    loaderErrors.join("; "),
  );
  check(
    "prefetch loaded valid + fuzzy regions only",
    // Reuse expectedSrcs so the predicate here cannot drift from the poll above.
    expectedSrcs.every((s) => requested.includes(s)),
    `missing: ${expectedSrcs.filter((s) => !requested.includes(s)).join(", ")}`,
  );
  check(
    "no request for unknown regions",
    !requested.some((s) => /narnia|atlantis|mordor/i.test(s)),
  );

  console.log("[fuzzy lazy-load truthfulness]");
  const aws = ctx.InstanceSelectorFactory.createSelector("aws");
  await aws.loadRegionData("us-east-1a");
  const rows = aws.instanceData["us-east-1a"] || [];
  check(
    "us-east-1a got REAL us-east-1 data (not sample)",
    rows.length > 100,
    `got ${rows.length} instances`,
  );

  // Re-upload with all-valid regions replaces the panel without warning
  const csv2 = `VM Name,CPU Count,Memory (GB),AWS Region
d,4,16,us-west-2`;
  parse(ctx, csv2);
  console.log("[re-upload]");
  check("panel still visible", !!panel && !panel.classes.has("hidden"));
  // Same guarded read as the first render: an unrendered panel is one FAIL, not
  // a throw that unwinds past the checks below.
  const panelHtml2 = panel?.innerHTML ?? "";
  check("old chips replaced", !panelHtml2.includes("narnia-99"));
  check("no warning when all valid", !panelHtml2.includes("not recognized"));
  check("validation replaced", !ctx._regionValidation?.azure);

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

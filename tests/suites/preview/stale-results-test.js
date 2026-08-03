// Results describe the providers AND the rows that were loaded when Generate
// ran. Change either and nothing re-runs — so the table and every download go on
// describing something the user no longer has, and must say so.
//
// The data half matters because there are now four ways to load rows (upload,
// paste, sample, manual) and three of them are one click. Replacing the data
// under a set of results is easy, and looks like nothing happened.
const vm = require("vm");
const { buildContext, makeChecker, parse } = require("../harness");

const { check, state } = makeChecker();
const notice = (elements) => elements.resultsStaleNotice;

const FILE_A = `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1
db-02,8,32,us-east-1`;

// Same shape, same row count, different machines. Comparing row counts would
// call this unchanged — which is exactly the replacement a user is least likely
// to spot by eye.
const FILE_B = `VM Name,CPU Count,Memory (GB),AWS Region
mail-01,2,8,us-west-2
file-02,16,64,us-west-2`;

// Stand in for a completed run: AWS is selected, results exist, and they carry
// the providers and the ingest token that were current at the time.
//
// selectedProviders and processedResults are `let` bindings in app-core, which
// shadow the sandbox's own properties inside a vm context — they can only be set
// by evaluating an assignment IN the context.
function pretendGenerated(ctx) {
  vm.runInContext(
    `selectedProviders = ["aws"];
     processedResults = [{ "VM Name": "web-01", "AWS Like-to-Like Instance": "m5.xlarge" }];`,
    ctx,
  );
  ctx.window._resultsProviders = ["aws"];
  ctx.window._resultsIngestToken = ctx.window._ingestToken;
  ctx.updateStaleResultsNotice();
}

console.log("[fresh results say nothing]");
{
  const { ctx, elements } = buildContext();
  parse(ctx, FILE_A);
  pretendGenerated(ctx);
  check(
    "no notice while the results still describe what is loaded",
    notice(elements).classes.has("hidden"),
    notice(elements).innerHTML,
  );
}

console.log("[replacing the data makes them stale]");
{
  const { ctx, elements } = buildContext();
  parse(ctx, FILE_A);
  pretendGenerated(ctx);

  parse(ctx, FILE_B);
  check(
    "the notice appears",
    !notice(elements).classes.has("hidden"),
    notice(elements).innerHTML,
  );
  check(
    "and says the data was replaced, not that the providers changed",
    /data you have since replaced/.test(notice(elements).innerHTML),
    notice(elements).innerHTML,
  );
}

console.log("[every route into the data counts, not just file upload]");
{
  for (const [label, load] of [
    [
      "paste",
      (ctx) => {
        ctx.renderPasteControl();
        ctx.document.getElementById("pasteInput").value = FILE_B;
        ctx.ingestPastedData();
      },
    ],
    ["sample", (ctx) => ctx.loadSampleDataset(0)],
  ]) {
    const { ctx, elements } = buildContext();
    parse(ctx, FILE_A);
    pretendGenerated(ctx);
    load(ctx);
    check(
      `loading by ${label} marks the results stale`,
      !notice(elements).classes.has("hidden") &&
        /data you have since replaced/.test(notice(elements).innerHTML),
      notice(elements).innerHTML,
    );
  }
}

console.log("[the provider case still works, and is worded for itself]");
{
  const { ctx, elements } = buildContext();
  parse(ctx, FILE_A);
  pretendGenerated(ctx);

  // Same data, different selection.
  vm.runInContext(`selectedProviders = ["aws", "azure"]`, ctx);
  ctx.updateStaleResultsNotice();
  check(
    "changing providers still raises the notice",
    !notice(elements).classes.has("hidden"),
    notice(elements).innerHTML,
  );
  check(
    "worded as a selection change, not a data change",
    /no longer what you have selected/.test(notice(elements).innerHTML),
    notice(elements).innerHTML,
  );
}

console.log("[data replaced WHILE the run is in flight]");
{
  // The token must be snapshotted when the run starts, not read when it ends.
  // Reading it at the end stamps the finished batch with the token of data that
  // landed DURING the run — so results computed from the old rows would present
  // themselves as describing the new ones. That is the precise case the token
  // exists for, and it is the one it would have got wrong.
  //
  // Modelled at the seam: take the snapshot, ingest mid-flight, then record.
  const { ctx, elements } = buildContext();
  parse(ctx, FILE_A);
  vm.runInContext(
    `selectedProviders = ["aws"];
     processedResults = [{ "VM Name": "web-01" }];`,
    ctx,
  );

  const ingestTokenForRun = ctx.window._ingestToken; // start of run
  parse(ctx, FILE_B); // …the user loads a new file while it runs…
  ctx.window._resultsProviders = ["aws"];
  ctx.window._resultsIngestToken = ingestTokenForRun; // end of run
  ctx.updateStaleResultsNotice();

  check(
    "the results are stale, because they describe the file that was replaced",
    !notice(elements).classes.has("hidden") &&
      /data you have since replaced/.test(notice(elements).innerHTML),
    notice(elements).innerHTML,
  );
}
{
  // And the same seam, done the wrong way: recording the LIVE token at the end.
  // This models the bug, so it is EXPECTED to pass — it exercises a hand-built
  // seam, not generate.js. The guard that would actually catch the regression in
  // generate.js is the source-level check below.
  const { ctx, elements } = buildContext();
  parse(ctx, FILE_A);
  vm.runInContext(
    `selectedProviders = ["aws"];
     processedResults = [{ "VM Name": "web-01" }];`,
    ctx,
  );
  parse(ctx, FILE_B);
  ctx.window._resultsProviders = ["aws"];
  ctx.window._resultsIngestToken = ctx.window._ingestToken; // read too late
  ctx.updateStaleResultsNotice();
  check(
    "reading the token after the run would hide the staleness (the bug)",
    notice(elements).classes.has("hidden"),
    "if this fails the model is wrong, not the code",
  );
}
{
  // The guard that keeps the two above honest: generate.js must take the
  // snapshot BEFORE it awaits the batch, which is a fact about the source.
  const fs = require("fs");
  const path = require("path");
  const { REPO } = require("../harness");
  const src = fs.readFileSync(path.join(REPO, "js/base/generate.js"), "utf8");
  const snapshot = src.indexOf("const ingestTokenForRun = window._ingestToken");
  const awaited = src.indexOf("await runRecommendationBatch");
  const recorded = src.indexOf(
    "window._resultsIngestToken = ingestTokenForRun",
  );
  check(
    "generate.js snapshots the ingest token before awaiting the batch",
    snapshot !== -1 && awaited !== -1 && snapshot < awaited,
    `snapshot@${snapshot} await@${awaited}`,
  );
  check(
    "and records that snapshot, not the live value",
    recorded !== -1 && !/_resultsIngestToken = window\._ingestToken/.test(src),
    "still reading window._ingestToken after the await",
  );
}

console.log("[no results, nothing to be stale about]");
{
  const { ctx, elements } = buildContext();
  parse(ctx, FILE_A);
  parse(ctx, FILE_B);
  check(
    "loading data twice before ever generating says nothing",
    notice(elements).classes.has("hidden"),
    notice(elements).innerHTML,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

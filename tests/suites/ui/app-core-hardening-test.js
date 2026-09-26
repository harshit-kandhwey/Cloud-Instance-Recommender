// Two shared-core behaviours that failed quietly:
//  - the "still loading" watcher polled forever when a provider manifest never
//    loaded, so the toast stayed and the queued run never started;
//  - the relax suggestion matched a label against a plain object, so an input
//    column carrying "… — relax: constructor" selected an inherited function.
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

console.log("[the data watcher gives up instead of polling forever]");
{
  const { ctx, toasts } = buildContext();
  let tick = null;
  let cleared = false;
  ctx.setInterval = (fn) => {
    tick = fn;
    return 1;
  };
  ctx.clearInterval = () => {
    cleared = true;
  };
  ctx.window.AWS_DATA_READY = false;
  vm.runInContext("_generateQueued = true", ctx);
  vm.runInContext('watchForDataThenRun(["aws"])', ctx);
  check(
    "a poll is started while data is not ready",
    typeof tick === "function",
  );

  const limit = vm.runInContext("DATA_LOAD_GIVE_UP_TICKS", ctx);
  for (let i = 0; i < limit - 1; i++) tick();
  check(
    "it keeps waiting until the limit",
    cleared === false &&
      vm.runInContext("_generateQueued", ctx) === true &&
      vm.runInContext("_watcherStarted", ctx) === true,
  );
  tick();
  check("at the limit the poll stops", cleared === true);
  check(
    "the queued run is dropped and the watcher can start again",
    vm.runInContext("_generateQueued", ctx) === false &&
      vm.runInContext("_watcherStarted", ctx) === false,
  );
  check(
    "the user is told to reload, as an error",
    toasts.length === 1 &&
      toasts[0].type === "error" &&
      /did not finish loading/.test(toasts[0].message),
    JSON.stringify(toasts),
  );
}

console.log("[a poll that finds the data ready still runs the queue]");
{
  const { ctx } = buildContext();
  let tick = null;
  ctx.setInterval = (fn) => {
    tick = fn;
    return 1;
  };
  ctx.clearInterval = () => {};
  ctx.window.AWS_DATA_READY = false;
  ctx.generateRecommendations = () => {
    ctx.__ran = true;
  };
  vm.runInContext("_generateQueued = true", ctx);
  vm.runInContext('watchForDataThenRun(["aws"])', ctx);
  ctx.window.AWS_DATA_READY = true;
  tick();
  check(
    "the queued generate runs once data is ready",
    ctx.__ran === true && vm.runInContext("_generateQueued", ctx) === false,
  );
}

console.log("[the relax suggestion ignores an inherited label]");
{
  const { ctx } = buildContext();
  ctx.results = [
    {
      "AWS Like-to-Like Instance": "No data available",
      "Some Nearest Miss": "m5.large (2 vCPU / 8 GB) — relax: constructor",
    },
  ];
  check(
    "a hostile label yields no suggestion",
    vm.runInContext("computeRelaxSuggestion(results)", ctx) === null,
  );
  ctx.results = [
    {
      "AWS Like-to-Like Instance": "No data available",
      "AWS Nearest Miss":
        "m5.large (2 vCPU / 8 GB) — relax: current-generation only",
    },
  ];
  const real = vm.runInContext("computeRelaxSuggestion(results)", ctx);
  check(
    "a real label still yields its suggestion",
    real && real.label === "current-generation only" && real.rescues === 1,
    JSON.stringify(real),
  );
}

console.log("[a repeated provider change event lists the provider once]");
{
  const { ctx, elements } = buildContext();
  vm.runInContext("selectedProviders = []", ctx);
  // Materialise the checkbox the handler looks up, then tick it.
  vm.runInContext('document.getElementById("aws")', ctx);
  elements.aws.checked = true;
  vm.runInContext('toggleCloudProvider("aws")', ctx);
  vm.runInContext('toggleCloudProvider("aws")', ctx);
  check(
    "two change events leave one entry",
    JSON.stringify(vm.runInContext("selectedProviders", ctx)) ===
      JSON.stringify(["aws"]),
    JSON.stringify(vm.runInContext("selectedProviders", ctx)),
  );
  elements.aws.checked = false;
  vm.runInContext('toggleCloudProvider("aws")', ctx);
  check(
    "unticking removes it",
    vm.runInContext("selectedProviders.length", ctx) === 0,
  );
}

if (state.failures) {
  console.error(`\napp-core-hardening: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\napp-core-hardening: all checks passed");
  process.exitCode = 0;
}

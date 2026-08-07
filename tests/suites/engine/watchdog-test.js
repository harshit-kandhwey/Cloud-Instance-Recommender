// Watchdog verification: a Worker that never responds must trigger the
// watchdog rejection, terminate, and fall back to the main-thread path,
// still producing correct results.
const { buildContext } = require("../harness");

// The worker the app will construct: it accepts the run but never replies, so
// the watchdog timer is what has to fire. It counts the post and the terminate
// the app is expected to make.
let terminated = 0;
let posted = 0;
const { ctx } = buildContext({
  worker: class FakeStalledWorker {
    postMessage() {
      posted++; // never replies — simulates a stalled worker
    }
    terminate() {
      terminated++;
    }
  },
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
  const watchdogMs = 300;
  // Outer safety net for the whole race. Overridable so a slow CI box can raise
  // it without editing the test; the fallback normally settles ~watchdogMs.
  const testTimeoutMs = Number(process.env.WATCHDOG_TEST_TIMEOUT_MS) || 2500;
  ctx._workerWatchdogMs = watchdogMs; // short watchdog for the test

  const rows = [
    {
      "VM Name": "a",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "AWS Region": "us-east-1",
    },
  ];
  const options = {
    generateLikeToLike: true,
    generateOptimized: false,
    excludeTypes: [],
    selectedInstanceFamilyNames: [],
    selectedProcessorManufacturers: [],
    selectedMainFamilies: [],
    selectedAzureSeries: [],
    selectedAzureProcessors: [],
    selectedAzureVMFamilies: [],
    selectedGCPFamilies: [],
    selectedGCPProcessors: [],
    selectedGCPMachineTypes: [],
  };

  const start = Date.now();
  // Keep the safety-net timer's handle so it can be cleared once the race
  // settles — otherwise it stays pending and keeps the event loop alive to
  // testTimeoutMs (a leaked timer, and a real hang once this suite moves off
  // process.exit()).
  let watchdogTimer;
  let results;
  // finally, not a trailing clearTimeout: if the batch REJECTS, the await throws
  // and a success-path clear never runs, so the safety-net timer stays pending
  // and holds the event loop open to testTimeoutMs — the exact leak this handle
  // exists to prevent, only on the failure path.
  try {
    results = await Promise.race([
      ctx.runRecommendationBatch(rows, ["aws"], options),
      new Promise((_, reject) => {
        watchdogTimer = setTimeout(
          () => reject(new Error("watchdog fallback did not settle")),
          testTimeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(watchdogTimer);
  }
  const elapsed = Date.now() - start;

  check("worker was attempted", posted === 1, `posted=${posted}`);
  check(
    "worker terminated after stall",
    terminated === 1,
    `terminated=${terminated}`,
  );
  check(
    "watchdog used the short test timeout before fallback",
    elapsed >= watchdogMs && elapsed < testTimeoutMs,
    `${elapsed}ms`,
  );
  check(
    "fallback produced results",
    Array.isArray(results) && results.length === 1,
  );
  check(
    "fallback used real region data",
    !!results?.[0]?.["AWS Like-to-Like Instance"] &&
      results[0]["AWS Like-to-Like Instance"] !== "No data available" &&
      results[0]["AWS Like-to-Like Instance"] !== "Missing data",
    JSON.stringify(results?.[0]?.["AWS Like-to-Like Instance"]),
  );

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

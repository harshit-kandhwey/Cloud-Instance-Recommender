// src/shared/storage-manager.js is the one path the app uses to measure, write
// and clear its own localStorage keys (3.21 phase 1). These checks pin the
// behaviour a user can lose data to if it drifts: usage counts only owned keys,
// a full store is reported as "quota" rather than thrown or silently dropped,
// and clearing never touches a key the app does not own.
const {
  REPO,
  buildEngineContext,
  makeChecker,
  fakeLocalStorage,
} = require("../harness");

const { ctx, run } = buildEngineContext({
  scripts: ["src/shared/storage-keys.js", "src/shared/storage-manager.js"],
  label: "storage-manager",
});

const { check, state } = makeChecker();

const keys = run("STORAGE_KEYS");
const owned = Object.values(keys);
const foreign = "someOtherAppsKey";

function fresh(limitUnits) {
  const store = fakeLocalStorage({ limitUnits });
  ctx.localStorage = store;
  return store;
}

{
  const store = fresh();
  const u = run("AppStorage.usage()");
  check("usage lists every owned key", u.items.length === owned.length);
  check(
    "absent keys measure zero bytes",
    u.items.every((i) => !i.present && i.bytes === 0) && u.totalBytes === 0,
  );

  store.setItem(keys.portfolioData, "abcd");
  store.setItem(foreign, "x".repeat(500));
  const after = run("AppStorage.usage()");
  const portfolio = after.items.find((i) => i.id === "portfolioData");
  check(
    "a present owned key counts key plus value",
    portfolio.bytes === (keys.portfolioData.length + 4) * 2,
  );
  check(
    "a foreign key does not count toward usage",
    after.totalBytes === portfolio.bytes,
  );
}

{
  const store = fresh(40);
  const ok = run('AppStorage.write("manualVMs", "small")');
  check("a write under the limit succeeds", ok.ok === true);
  const big = run('AppStorage.write("filterPresets", "y".repeat(200))');
  check(
    "a write past the quota reports reason quota and does not throw",
    big.ok === false && big.reason === "quota",
    JSON.stringify(big),
  );
  check(
    "the earlier value survives a refused write",
    store.getItem(keys.manualVMs) === "small",
  );
}

{
  fresh();
  ctx.localStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("storage disabled");
    },
    removeItem: () => {},
  };
  const r = run('AppStorage.write("userRules", "{}")');
  check(
    "a non-quota failure reports unavailable, not quota",
    r.ok === false && r.reason === "unavailable",
    JSON.stringify(r),
  );
}

{
  let threw = false;
  try {
    run('AppStorage.write("notAKey", "x")');
  } catch {
    threw = true;
  }
  check("an id outside the registry is refused", threw);
}

{
  const store = fresh();
  for (const k of owned) store.setItem(k, "v");
  store.setItem(foreign, "keep me");
  run("AppStorage.clearAll()");
  check(
    "clearAll removes every owned key",
    owned.every((k) => store.getItem(k) === null),
  );
  check(
    "clearAll leaves a foreign key untouched",
    store.getItem(foreign) === "keep me",
  );
}

{
  const store = fresh();
  store.setItem(keys.stats, "1");
  store.setItem(keys.appMap, "2");
  run('AppStorage.clear("stats")');
  check(
    "clear removes only the named owned key",
    store.getItem(keys.stats) === null && store.getItem(keys.appMap) === "2",
  );
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("storage-manager-test: all checks passed");
}

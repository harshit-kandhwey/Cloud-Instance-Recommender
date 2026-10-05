// The Browser Storage section's event handlers (src/ui/storage-manager-ui.js): the
// two-step clear, saving a named snapshot, and deleting one. The markup builders are
// covered by storage-manager-ui-test and the real clicks by the e2e specs; this suite
// drives the handlers themselves through a small fake DOM, because the branches that
// matter (refuse before a run, refuse a bad name, refuse a duplicate, no room, a
// browser that will not clear) are ones a happy-path click never reaches.
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

function setup({ removeThrows, quotaFull } = {}) {
  const { ctx, load, run } = buildEngineContext({
    scripts: [
      "src/shared/storage-keys.js",
      "src/shared/storage-manager.js",
      "src/shared/app-core.js",
    ],
    label: "storage-handlers",
  });
  const store = {};
  const calls = { manualVMs: 0, stats: 0 };
  ctx.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      if (quotaFull) {
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      }
      store[k] = String(v);
    },
    removeItem: (k) => {
      if (removeThrows) throw new Error("blocked");
      delete store[k];
    },
  };
  const els = {};
  for (const id of [
    "storageManagerPanel",
    "storageManagerStatus",
    "fleetSnapshotsPanel",
    "fleetSnapshotName",
  ]) {
    els[id] = { id, innerHTML: "", textContent: "", value: "" };
  }
  ctx.document = {
    addEventListener() {},
    getElementById: (id) => els[id] || null,
  };
  ctx.loadManualVMs = () => {
    calls.manualVMs++;
  };
  ctx.freshUsageStatistics = () => {
    calls.stats++;
    return {};
  };
  load("src/features/fleet-snapshots.js");
  load("src/ui/storage-manager-ui.js");
  run("processedResults = [{ 'VM Name': 'a', 'CPU Count': '4' }]");
  ctx.window._resultsProviders = ["aws"];
  return { ctx, run, store, els, calls };
}

const key = (t, id) => t.run(`STORAGE_KEYS.${id}`);
const panelClick = (action, id) => ({
  target: {
    closest: (sel) =>
      sel === "[data-storage-action]"
        ? {
            getAttribute: (n) =>
              n === "data-storage-action"
                ? action
                : n === "data-storage-id"
                  ? id
                  : null,
          }
        : null,
  },
});
const submitEvent = (fromSnapshotForm = true) => ({
  prevented: false,
  preventDefault() {
    this.prevented = true;
  },
  target: {
    matches: (sel) => fromSnapshotForm && sel === "#fleetSnapshotForm",
  },
});
const deleteClick = (id) => ({
  target: {
    closest: (sel) =>
      sel === "[data-snapshot-delete]" && id !== null
        ? { getAttribute: () => id }
        : null,
  },
});
// What the snapshot panel last rendered (its status line is inside the markup).
const panel = (t) => t.els.fleetSnapshotsPanel.innerHTML;
const save = (t, name) => {
  t.els.fleetSnapshotName.value = name;
  const e = submitEvent();
  t.run("handleFleetSnapshotSubmit")(e);
  return e;
};

console.log("[the two-step clear in the storage panel]");
{
  const t = setup();
  t.run("handleStoragePanelClick")({ target: { closest: () => null } });
  check(
    "a click that is not on a clear control does nothing",
    t.els.storageManagerPanel.innerHTML === "" &&
      t.run("storagePendingClear") === null,
  );

  t.store[key(t, "stats")] = "{}";
  t.store[key(t, "theme")] = "dark";
  t.run("handleStoragePanelClick")(panelClick("clear-all"));
  check(
    "the first press on Clear all only arms it",
    t.run("storagePendingClear") === "all" &&
      t.els.storageManagerPanel.innerHTML.includes("Confirm clear all") &&
      key(t, "stats") in t.store &&
      key(t, "theme") in t.store,
  );
  t.run("handleStoragePanelClick")(panelClick("clear-all"));
  check(
    "the second press clears every key the app owns, and says so",
    !(key(t, "stats") in t.store) &&
      !(key(t, "theme") in t.store) &&
      t.els.storageManagerStatus.textContent === "All app data cleared." &&
      t.run("storagePendingClear") === null,
    JSON.stringify(t.store),
  );
  check(
    "clearing everything also resets the in-memory copies that would write it back",
    t.calls.manualVMs === 1 && t.calls.stats === 1,
    JSON.stringify(t.calls),
  );
}
{
  const t = setup();
  t.store[key(t, "stats")] = "{}";
  t.store[key(t, "theme")] = "dark";
  t.run("handleStoragePanelClick")(panelClick("clear", "stats"));
  t.run("handleStoragePanelClick")(panelClick("clear", "theme"));
  check(
    "pressing a different key's Clear re-arms for that key and clears nothing yet",
    t.run("storagePendingClear") === "theme" &&
      key(t, "stats") in t.store &&
      key(t, "theme") in t.store,
  );
  t.run("handleStoragePanelClick")(panelClick("clear", "theme"));
  check(
    "confirming clears only that key",
    !(key(t, "theme") in t.store) && key(t, "stats") in t.store,
    JSON.stringify(t.store),
  );
  check(
    "and says it cleared, without resetting copies the key does not own",
    t.els.storageManagerStatus.textContent === "Cleared." &&
      t.calls.manualVMs === 0 &&
      t.calls.stats === 0,
  );
  t.run("handleStoragePanelClick")(panelClick("clear", "stats"));
  t.run("handleStoragePanelClick")(panelClick("clear", "stats"));
  check(
    "clearing the usage counts resets its in-memory copy",
    t.calls.stats === 1,
    JSON.stringify(t.calls),
  );
}
{
  const t = setup({ removeThrows: true });
  t.store[key(t, "theme")] = "dark";
  t.run("handleStoragePanelClick")(panelClick("clear", "theme"));
  t.run("handleStoragePanelClick")(panelClick("clear", "theme"));
  check(
    "a browser that will not clear says so, and the panel is not left armed",
    t.els.storageManagerStatus.textContent ===
      "This browser would not clear the data." &&
      t.run("storagePendingClear") === null,
    t.els.storageManagerStatus.textContent,
  );
}

console.log("[saving a snapshot]");
{
  const t = setup();
  t.run("processedResults = null");
  const e = save(t, "anything");
  check(
    "before any run it is refused with the reason, and the form's own submit is stopped",
    e.prevented &&
      panel(t).includes("Generate a run before saving a snapshot."),
    panel(t),
  );
  t.run("processedResults = [{ 'VM Name': 'a', 'CPU Count': '4' }]");

  save(t, "   ");
  check(
    "a blank name is refused",
    panel(t).includes("Enter a name for the snapshot."),
  );
  save(t, "x".repeat(61));
  check(
    "a name over 60 characters is refused",
    panel(t).includes("Keep the name to 60 characters."),
  );
  check(
    "nothing was saved by the refusals",
    !(key(t, "fleetSnapshots") in t.store),
  );

  save(t, "March estate");
  check(
    "a valid name saves, and the panel confirms it",
    panel(t).includes("Saved &quot;March estate&quot;.") &&
      t.run("FleetSnapshots.list().length") === 1,
    panel(t),
  );
  save(t, "March estate");
  check(
    "the same name again is refused as a duplicate and adds nothing",
    panel(t).includes("already exists") &&
      t.run("FleetSnapshots.list().length") === 1,
    panel(t),
  );
}
{
  const t = setup();
  const e = submitEvent(false);
  t.run("handleFleetSnapshotSubmit")(e);
  check(
    "a submit from some other form is left alone",
    !e.prevented && panel(t) === "",
  );
}
{
  const t = setup({ quotaFull: true });
  save(t, "full");
  check(
    "a browser with no room says so and points at what to do",
    panel(t).includes("no room for another snapshot"),
    panel(t),
  );
}

console.log("[deleting a snapshot]");
{
  const t = setup();
  save(t, "first");
  save(t, "second");
  const [a, b] = t.run("FleetSnapshots.list()").map((s) => s.id);

  t.run("handleFleetSnapshotDelete")(deleteClick(null));
  check(
    "a click that is not on a snapshot's Delete does nothing",
    t.run("FleetSnapshots.list().length") === 2 &&
      t.run("fleetPendingDelete") === null,
  );

  t.run("handleFleetSnapshotDelete")(deleteClick(a));
  check(
    "the first press only arms that snapshot, and the button says to confirm",
    t.run("fleetPendingDelete") === a &&
      t.run("FleetSnapshots.list().length") === 2 &&
      panel(t).includes("Confirm delete"),
    panel(t),
  );
  t.run("handleFleetSnapshotDelete")(deleteClick(b));
  check(
    "pressing a different snapshot's Delete re-arms for that one and deletes neither",
    t.run("fleetPendingDelete") === b &&
      t.run("FleetSnapshots.list().length") === 2,
  );
  t.run("handleFleetSnapshotDelete")(deleteClick(b));
  const left = t.run("FleetSnapshots.list()").map((s) => s.id);
  check(
    "confirming deletes only that snapshot and says so",
    left.length === 1 &&
      left[0] === a &&
      panel(t).includes("Snapshot deleted.") &&
      t.run("fleetPendingDelete") === null,
    panel(t),
  );
  t.run("handleFleetSnapshotDelete")(deleteClick("gone"));
  t.run("handleFleetSnapshotDelete")(deleteClick("gone"));
  check(
    "deleting an id that is already gone is harmless: it reports done and the rest are untouched",
    panel(t).includes("Snapshot deleted.") &&
      t.run("FleetSnapshots.list().length") === 1,
    panel(t),
  );

  // The write that removes it fails: the snapshot must stay, and the panel must say so
  // rather than claim a delete that did not happen.
  t.ctx.localStorage.setItem = () => {
    throw new Error("blocked");
  };
  t.run("handleFleetSnapshotDelete")(deleteClick(a));
  t.run("handleFleetSnapshotDelete")(deleteClick(a));
  check(
    "when the browser refuses the write, it says the snapshot could not be deleted and keeps it",
    panel(t).includes("could not be deleted") &&
      !panel(t).includes("Snapshot deleted.") &&
      t.run("FleetSnapshots.list().length") === 1,
    panel(t),
  );
}

process.exitCode = state.failures ? 1 : 0;

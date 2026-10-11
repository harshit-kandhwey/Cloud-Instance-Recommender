// Storage panel: lists the app's own localStorage keys with their
// measured size and lets the user clear one or all of them. Renders into
// #storageManagerPanel and does nothing on a page that lacks it.
//
// Controls carry data attributes and share one delegated listener, never inline
// handlers. Clearing is two-step in place: the first press arms the button, the
// second performs the clear. confirm() is banned in this codebase.

let storagePendingClear = null;

function formatStorageBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function storageClearLabel(id) {
  return storagePendingClear === id ? "Confirm clear" : "Clear";
}

function renderStorageRows(usage) {
  return usage.items
    .map((item) => {
      const id = escapeHtml(item.id);
      const disabled = item.present ? "" : " disabled";
      return `<tr>
          <th scope="row"><code>${escapeHtml(item.key)}</code></th>
          <td>${item.present ? "stored" : "empty"}</td>
          <td>${formatStorageBytes(item.bytes)}</td>
          <td><button type="button" class="btn btn-secondary" data-storage-action="clear" data-storage-id="${id}"${disabled}>${storageClearLabel(item.id)}</button></td>
        </tr>`;
    })
    .join("");
}

function renderStorageManagerPanel() {
  const host = document.getElementById("storageManagerPanel");
  if (!host) return;
  let usage;
  try {
    usage = AppStorage.usage();
  } catch {
    host.innerHTML =
      '<p role="status">Browser storage is unavailable here, so there is nothing to show or clear.</p>';
    return;
  }
  const allLabel =
    storagePendingClear === "all" ? "Confirm clear all" : "Clear all app data";
  host.innerHTML = `
        <p>This browser holds <strong>${formatStorageBytes(usage.totalBytes)}</strong> of data for this app, measured from the keys it owns. Nothing here leaves the browser.</p>
        <div class="table-wrapper">
          <table>
            <thead><tr><th scope="col">Key</th><th scope="col">State</th><th scope="col">Size</th><th scope="col">Action</th></tr></thead>
            <tbody>${renderStorageRows(usage)}</tbody>
          </table>
        </div>
        <p><button type="button" class="btn btn-secondary" data-storage-action="clear-all">${allLabel}</button></p>
        <p role="status" aria-live="polite" id="storageManagerStatus"></p>`;
}

function handleStoragePanelClick(event) {
  const button = event.target.closest("[data-storage-action]");
  if (!button) return;
  const action = button.getAttribute("data-storage-action");
  const target =
    action === "clear-all" ? "all" : button.getAttribute("data-storage-id");
  if (storagePendingClear !== target) {
    storagePendingClear = target;
    renderStorageManagerPanel();
    return;
  }
  try {
    applyStorageClear(target);
  } catch {
    storagePendingClear = null;
    renderStorageManagerPanel();
    const failed = document.getElementById("storageManagerStatus");
    if (failed) failed.textContent = "This browser would not clear the data.";
    return;
  }
  storagePendingClear = null;
  fleetPendingDelete = null;
  renderStorageManagerPanel();
  renderFleetSnapshotsPanel();
  const status = document.getElementById("storageManagerStatus");
  if (status)
    status.textContent =
      target === "all" ? "All app data cleared." : "Cleared.";
}

// Storage is cleared and the in-memory copies that would write it back are reset
// first, so a later save cannot restore the data the user just cleared.
function applyStorageClear(target) {
  if (target === "all") AppStorage.clearAll();
  else AppStorage.clear(target);
  if (target === "all" || target === "manualVMs") loadManualVMs();
  if (target === "all" || target === "stats") {
    usageStats = freshUsageStatistics();
    if (typeof updateUsageCounters === "function") updateUsageCounters();
  }
  // The panels that list stored data would otherwise keep showing what was just cleared
  // until the next reload.
  const touches = (key) => target === "all" || target === key;
  if (touches("userRules") && typeof renderUserRulesPanel === "function") {
    renderUserRulesPanel();
  }
  if (touches("filterPresets") && typeof renderPresetsBar === "function") {
    renderPresetsBar();
  }
  if (touches("columnMaps") && typeof renderSavedMappings === "function") {
    renderSavedMappings();
  }
}

let fleetPendingDelete = null;

function renderFleetSnapshotRows(entries) {
  return entries
    .map((e) => {
      const id = escapeHtml(e.id);
      const armed = fleetPendingDelete === e.id;
      return `<li>
          <strong>${escapeHtml(e.name)}</strong>
          <span>${escapeHtml(String(e.rows.length))} VMs, saved ${escapeHtml(e.takenAt)}</span>
          <button type="button" class="btn btn-secondary" data-snapshot-compare="${id}">Compare with last run</button>
          <button type="button" class="btn btn-secondary" data-snapshot-export="${id}">Export file</button>
          <button type="button" class="btn btn-secondary" data-snapshot-delete="${id}">${armed ? "Confirm delete" : "Delete"}</button>
        </li>`;
    })
    .join("");
}

function renderFleetSnapshotsPanel(status, detailHtml) {
  const host = document.getElementById("fleetSnapshotsPanel");
  if (!host) return;
  const entries = FleetSnapshots.list();
  const typed = document.getElementById("fleetSnapshotName");
  const typedValue = typed ? typed.value : "";
  host.innerHTML = `
        <p>Save the results of the last run as a named snapshot in this browser. A snapshot holds the per-VM results, which include the columns you uploaded, plus the providers and the rules the run used.</p>
        <form id="fleetSnapshotForm">
          <label for="fleetSnapshotName">Snapshot name</label>
          <input id="fleetSnapshotName" type="text" maxlength="60" autocomplete="off" value="${escapeHtml(typedValue)}">
          <button type="submit" class="btn btn-secondary">Save snapshot</button>
        </form>
        <p>To move a snapshot to another browser or person, export it as a file and import it there. The file is made and read on this device and is sent nowhere; it holds the same per-VM results as the snapshot, so handle it like the inventory.</p>
        <p>
          <button type="button" class="btn btn-secondary" data-snapshot-import-pick>Import snapshot file</button>
          <input id="fleetSnapshotImportFile" type="file" accept=".json,application/json" hidden>
        </p>
        <p role="status" aria-live="polite" id="fleetSnapshotStatus">${escapeHtml(status || "")}</p>
        ${detailHtml || ""}
        <ul>${entries.length ? renderFleetSnapshotRows(entries) : "<li>No snapshots saved.</li>"}</ul>`;
}

function handleFleetSnapshotSubmit(event) {
  if (handleFleetSnapshotImportRename(event)) return;
  if (!event.target.matches("#fleetSnapshotForm")) return;
  event.preventDefault();
  const name = document.getElementById("fleetSnapshotName")?.value ?? "";
  if (typeof processedResults === "undefined" || !processedResults) {
    renderFleetSnapshotsPanel("Generate a run before saving a snapshot.");
    return;
  }
  const built = FleetSnapshots.build({
    name,
    rows: processedResults,
    providers: window._resultsProviders || [],
    rules: typeof loadUserRules === "function" ? loadUserRules() : [],
  });
  if (!built.ok) {
    const why = {
      empty: "Enter a name for the snapshot.",
      "too-long": "Keep the name to 60 characters.",
    };
    renderFleetSnapshotsPanel(
      why[built.reason] || "The snapshot could not be built.",
    );
    return;
  }
  const saved = FleetSnapshots.save(built.entry);
  if (saved.ok) {
    renderFleetSnapshotsPanel(`Saved "${built.entry.name}".`);
    return;
  }
  const why = {
    duplicate: `A snapshot named "${built.entry.name}" already exists.`,
    quota:
      "This browser has no room for another snapshot. Delete one or clear app data first.",
    changed:
      "Another tab changed the snapshots while this one was saving. Try again.",
  };
  renderFleetSnapshotsPanel(
    why[saved.reason] || "The snapshot could not be saved.",
  );
}

// Text of a file that was refused only because its name is taken; kept until the
// user picks a new name or leaves.
let fleetPendingImportText = null;
// The taken name and the suggested one, so the rename form can be shown again.
let fleetPendingImportOffer = null;

const IMPORT_REFUSALS = {
  "too-large": "That file is too large to be a snapshot.",
  "not-json": "That file is not valid JSON.",
  "not-snapshot": "That file is not a fleet snapshot.",
  version:
    "That snapshot file was written by a different version of this tool and is not read.",
  "no-rows": "That snapshot file has no VMs in it.",
  "too-many-rows":
    "That snapshot file has more VMs than this tool will import.",
  "bad-row": "That snapshot file has a row this tool will not read.",
  "bad-providers":
    "That snapshot file lists providers this tool will not read.",
  "bad-rules": "That snapshot file has rules this tool will not read.",
  "bad-date": "That snapshot file has no valid date.",
  empty: "That snapshot file has no name.",
  "too-long": "The snapshot name is longer than 60 characters.",
  quota:
    "This browser has no room for another snapshot. Delete one or clear app data first.",
  changed:
    "Another tab changed the snapshots while this one was importing. Try again.",
};

function renderImportRenameHtml(name, suggestion) {
  return `<form id="fleetSnapshotImportForm">
          <p>A snapshot named "${escapeHtml(name)}" already exists, and the file never replaces it. Choose another name to import it as.</p>
          <label for="fleetSnapshotImportName">Import as</label>
          <input id="fleetSnapshotImportName" type="text" maxlength="60" autocomplete="off" value="${escapeHtml(suggestion)}">
          <button type="submit" class="btn btn-secondary">Import with this name</button>
        </form>`;
}

function finishFleetImport(result) {
  if (result.ok) {
    fleetPendingImportText = null;
    fleetPendingImportOffer = null;
    renderFleetSnapshotsPanel(`Imported "${result.entry.name}".`);
    return;
  }
  if (result.reason === "duplicate") {
    fleetPendingImportOffer = {
      name: result.name,
      suggestion: result.suggestion,
    };
    renderFleetSnapshotsPanel(
      "That snapshot's name is already taken.",
      renderImportRenameHtml(result.name, result.suggestion),
    );
    return;
  }
  fleetPendingImportText = null;
  fleetPendingImportOffer = null;
  renderFleetSnapshotsPanel(
    IMPORT_REFUSALS[result.reason] ||
      "The snapshot file could not be imported.",
  );
}

function handleFleetSnapshotImportFile(event) {
  const input = event.target;
  if (!input.matches("#fleetSnapshotImportFile")) return;
  const file = input.files && input.files[0];
  if (!file) return;
  // A new choice replaces whatever an earlier refused file left for the rename form.
  fleetPendingImportText = null;
  fleetPendingImportOffer = null;
  // The file's byte size is the user-facing 4 MB cap; parseImport re-checks the decoded
  // text length, which can only be smaller.
  if (file.size > FleetSnapshots.MAX_IMPORT_CHARS) {
    renderFleetSnapshotsPanel(IMPORT_REFUSALS["too-large"]);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    fleetPendingImportText = text;
    finishFleetImport(FleetSnapshots.importText(text));
  };
  reader.onerror = () =>
    renderFleetSnapshotsPanel("That file could not be read.");
  reader.readAsText(file);
}

function handleFleetSnapshotImportRename(event) {
  if (!event.target.matches("#fleetSnapshotImportForm")) return false;
  event.preventDefault();
  if (fleetPendingImportText === null) {
    renderFleetSnapshotsPanel("Choose the file again.");
    return true;
  }
  const name = document.getElementById("fleetSnapshotImportName")?.value ?? "";
  if (name.trim() === "") {
    // The typed name is empty; the file is fine, so keep it and ask again.
    const offer = fleetPendingImportOffer;
    renderFleetSnapshotsPanel(
      "Type a name to import the file as.",
      offer ? renderImportRenameHtml(offer.name, offer.suggestion) : "",
    );
    return true;
  }
  finishFleetImport(
    FleetSnapshots.importText(fleetPendingImportText, { name }),
  );
  return true;
}

function handleFleetSnapshotExport(event) {
  const button = event.target.closest("[data-snapshot-export]");
  if (!button) return false;
  const made = FleetSnapshots.exportEntry(
    button.getAttribute("data-snapshot-export"),
  );
  if (!made.ok) {
    renderFleetSnapshotsPanel("That snapshot no longer exists.");
    return true;
  }
  downloadJson(made.text, made.filename);
  renderFleetSnapshotsPanel(`Exported "${made.filename}".`);
  return true;
}

function handleFleetSnapshotImportPick(event) {
  if (!event.target.closest("[data-snapshot-import-pick]")) return false;
  const input = document.getElementById("fleetSnapshotImportFile");
  if (input) input.click();
  return true;
}

const DIFF_ROW_LIMIT = 50;

function renderSnapshotDiffHtml(diff) {
  const changedCount = diff.changedRows.length;
  const summary = `<p>${changedCount} VM${changedCount === 1 ? "" : "s"} changed, ${diff.summary.changedCells} cell${diff.summary.changedCells === 1 ? "" : "s"} across ${diff.cols.length} compared column${diff.cols.length === 1 ? "" : "s"}.${diff.note ? " " + escapeHtml(diff.note) : ""}</p>`;
  if (changedCount === 0) return `${summary}<p>No compared cell changed.</p>`;
  const body = diff.changedRows
    .slice(0, DIFF_ROW_LIMIT)
    .flatMap((row) =>
      row.cells
        .filter((cell) => cell.changed)
        .map(
          (cell) => `<tr>
            <th scope="row">${escapeHtml(row.key)}</th>
            <td>${escapeHtml(cell.col)}</td>
            <td>${escapeHtml(String(cell.a))}</td>
            <td>${escapeHtml(String(cell.b))}</td>
          </tr>`,
        ),
    )
    .join("");
  const more =
    changedCount > DIFF_ROW_LIMIT
      ? `<p>Showing the first ${DIFF_ROW_LIMIT} of ${changedCount} changed VMs.</p>`
      : "";
  return `${summary}<div class="table-wrapper"><table>
          <thead><tr><th scope="col">VM</th><th scope="col">Column</th><th scope="col">Last snapshot</th><th scope="col">Last run</th></tr></thead>
          <tbody>${body}</tbody>
        </table></div>${more}`;
}

const COMPARE_NAME_LIST_LIMIT = 10;

function vmList(names) {
  const shown = names.slice(0, COMPARE_NAME_LIST_LIMIT).join(", ");
  const rest = names.length - COMPARE_NAME_LIST_LIMIT;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

function fleetCompareMessage(result) {
  const pct = Math.round(result.overlap * 100);
  if (result.ok) {
    return `Same estate (${pct}% of VMs in common): ${result.added.length} added, ${result.removed.length} removed.`;
  }
  if (result.reason === "not-keyed") {
    return "This comparison needs every VM to have a unique, non-blank VM Name.";
  }
  const parts = [
    `Different estate (${pct}% of VMs in common, below ${Math.round(FleetSnapshots.MIN_OVERLAP * 100)}%), so no comparison was made.`,
  ];
  if (result.added.length) parts.push(`Added: ${vmList(result.added)}.`);
  if (result.removed.length) parts.push(`Removed: ${vmList(result.removed)}.`);
  parts.push("Save this run as a new snapshot to keep it.");

  return parts.join(" ");
}

function handleFleetSnapshotCompare(event) {
  const button = event.target.closest("[data-snapshot-compare]");
  if (!button) return false;
  const id = button.getAttribute("data-snapshot-compare");
  if (typeof processedResults === "undefined" || !processedResults) {
    renderFleetSnapshotsPanel("Generate a run to compare against.");
    return true;
  }
  const entry = FleetSnapshots.list().find((e) => e.id === id);
  if (!entry) {
    renderFleetSnapshotsPanel("That snapshot no longer exists.");
    return true;
  }
  const identity = FleetSnapshots.compareFleet(entry, processedResults);
  const detail = identity.ok
    ? renderSnapshotDiffHtml(
        diffScenarios(
          { results: entry.rows, providers: entry.providers, config: null },
          {
            results: processedResults,
            providers: window._resultsProviders || [],
            config: null,
          },
        ),
      )
    : "";
  renderFleetSnapshotsPanel(fleetCompareMessage(identity), detail);
  return true;
}

function handleFleetSnapshotDelete(event) {
  if (handleFleetSnapshotCompare(event)) return;
  if (handleFleetSnapshotExport(event)) return;
  if (handleFleetSnapshotImportPick(event)) return;
  const button = event.target.closest("[data-snapshot-delete]");
  if (!button) return;
  const id = button.getAttribute("data-snapshot-delete");
  if (fleetPendingDelete !== id) {
    fleetPendingDelete = id;
    renderFleetSnapshotsPanel();
    return;
  }
  fleetPendingDelete = null;
  const removed = FleetSnapshots.remove(id);
  renderFleetSnapshotsPanel(
    removed.ok ? "Snapshot deleted." : "The snapshot could not be deleted.",
  );
}

document.addEventListener("DOMContentLoaded", function () {
  const host = document.getElementById("storageManagerPanel");
  if (host) {
    host.addEventListener("click", handleStoragePanelClick);
    renderStorageManagerPanel();
  }
  const fleet = document.getElementById("fleetSnapshotsPanel");
  if (fleet) {
    fleet.addEventListener("submit", handleFleetSnapshotSubmit);
    fleet.addEventListener("click", handleFleetSnapshotDelete);
    fleet.addEventListener("change", handleFleetSnapshotImportFile);
    renderFleetSnapshotsPanel();
  }
});

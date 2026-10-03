// Storage panel (3.21 phase 1): lists the app's own localStorage keys with their
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
    usage = StorageManager.usage();
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
  if (target === "all") StorageManager.clearAll();
  else StorageManager.clear(target);
  storagePendingClear = null;
  renderStorageManagerPanel();
  const status = document.getElementById("storageManagerStatus");
  if (status)
    status.textContent =
      target === "all" ? "All app data cleared." : "Cleared.";
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
          <button type="button" class="btn btn-secondary" data-snapshot-delete="${id}">${armed ? "Confirm delete" : "Delete"}</button>
        </li>`;
    })
    .join("");
}

function renderFleetSnapshotsPanel(status) {
  const host = document.getElementById("fleetSnapshotsPanel");
  if (!host) return;
  const entries = FleetSnapshots.list();
  const typed = document.getElementById("fleetSnapshotName");
  const typedValue = typed ? typed.value : "";
  host.innerHTML = `
        <p>Save the results of the last run as a named snapshot in this browser. A snapshot holds per-VM results, the providers and the rules the run used, never the inventory.</p>
        <form id="fleetSnapshotForm">
          <label for="fleetSnapshotName">Snapshot name</label>
          <input id="fleetSnapshotName" type="text" maxlength="60" autocomplete="off" value="${escapeHtml(typedValue)}">
          <button type="submit" class="btn btn-secondary">Save snapshot</button>
        </form>
        <p role="status" aria-live="polite" id="fleetSnapshotStatus">${escapeHtml(status || "")}</p>
        <ul>${entries.length ? renderFleetSnapshotRows(entries) : "<li>No snapshots saved.</li>"}</ul>`;
}

function handleFleetSnapshotSubmit(event) {
  if (!event.target.matches("#fleetSnapshotForm")) return;
  event.preventDefault();
  const name = document.getElementById("fleetSnapshotName").value;
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
  };
  renderFleetSnapshotsPanel(
    why[saved.reason] || "The snapshot could not be saved.",
  );
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
  renderFleetSnapshotsPanel(
    fleetCompareMessage(FleetSnapshots.compareFleet(entry, processedResults)),
  );
  return true;
}

function handleFleetSnapshotDelete(event) {
  if (handleFleetSnapshotCompare(event)) return;
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
    renderFleetSnapshotsPanel();
  }
});

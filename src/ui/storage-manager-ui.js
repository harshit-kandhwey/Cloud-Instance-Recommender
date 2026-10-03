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

document.addEventListener("DOMContentLoaded", function () {
  const host = document.getElementById("storageManagerPanel");
  if (!host) return;
  host.addEventListener("click", handleStoragePanelClick);
  renderStorageManagerPanel();
});

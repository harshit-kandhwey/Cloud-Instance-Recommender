// Manual VM entry: form-based alternative to file upload, feeding the
// same ingestRows() pipeline.

// ─── Manual VM entry ──────────────────────────────────────────────────────────
// Alternative to file upload for small inventories: a form that builds rows
// with canonical headers and feeds the exact same ingestRows() pipeline, so
// region validation, workers, preview, and exports all behave identically.
let manualVMs = [];

function loadManualVMs() {
  try {
    const stored = localStorage.getItem("cloudInstanceRecommenderManualVMs");
    if (stored) manualVMs = JSON.parse(stored) || [];
  } catch {
    manualVMs = [];
  }
}

function saveManualVMs() {
  try {
    localStorage.setItem(
      "cloudInstanceRecommenderManualVMs",
      JSON.stringify(manualVMs),
    );
  } catch (e) {
    console.warn("Could not persist manual VM list:", e);
  }
}

// The row currently being edited, if any. Editing happens in the form above the
// table — the same fields, prefilled — rather than in the table itself: a second
// set of inputs would be a second place for the validation, the defaults and the
// region autocomplete to drift out of step with this one.
function manualEditingRow() {
  const index = window._manualEditIndex;
  return Number.isInteger(index) && manualVMs[index] ? manualVMs[index] : null;
}

// Field definitions for the current page's providers. Region inputs are
// sticky: they keep the last-entered value across adds.
function manualFieldDefs() {
  const editing = manualEditingRow();
  const defs = [
    {
      key: "VM Name",
      label: "VM Name",
      type: "text",
      placeholder: "web-server-01",
    },
    {
      key: "CPU Count",
      label: "CPU Count *",
      type: "number",
      placeholder: "4",
    },
    {
      key: "Memory (GB)",
      label: "Memory (GB) *",
      type: "number",
      placeholder: "16",
    },
    {
      key: "CPU Utilization",
      label: "CPU Util %",
      type: "number",
      placeholder: "45",
    },
    {
      key: "Memory Utilization",
      label: "Mem Util %",
      type: "number",
      placeholder: "60",
    },
  ];
  window._manualRegionDefaults = window._manualRegionDefaults || {};
  for (const provider of getPageProviders()) {
    const key = InstanceSelectorFactory.getProviderRegionColumn(provider);
    defs.push({
      key,
      label: key,
      type: "text",
      list: `manualRegions_${provider}`,
      provider,
      value:
        window._manualRegionDefaults[key] ||
        InstanceSelectorFactory.getProviderDefaultRegion(provider),
    });
  }

  // Editing overrides every default, including the sticky region — the point is
  // to see the row as it is, not as a new row would start.
  if (editing) {
    for (const def of defs) def.value = editing[def.key] || "";
  }
  return defs;
}

function toggleManualEntry() {
  const section = document.getElementById("manualEntrySection");
  if (!section) return;
  if (section.classList.contains("hidden")) {
    loadManualVMs();
    renderManualEntry();
    section.classList.remove("hidden");
  } else {
    section.classList.add("hidden");
  }
}

function renderManualEntry() {
  const section = document.getElementById("manualEntrySection");
  if (!section) return;
  const defs = manualFieldDefs();

  const inputs = defs
    .map((d, i) => {
      const listAttr = d.list ? ` list="${d.list}"` : "";
      const valueAttr = d.value ? ` value="${escapeHtml(d.value)}"` : "";
      return `
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <label for="manual_${i}" style="font-size: 11px; font-weight: 600; color: var(--text-body);">${escapeHtml(d.label)}</label>
        <input id="manual_${i}" type="${d.type}"${listAttr}${valueAttr} placeholder="${escapeHtml(d.placeholder || "")}" class="form-control" style="padding: 6px 10px; font-size: 13px; width: 140px;" />
      </div>`;
    })
    .join("");

  // Region autocomplete from the loaded manifests (best effort)
  const datalists = getPageProviders()
    .map((provider) => {
      let regions = [];
      try {
        const selector =
          window._prewarmedSelectors[provider] ||
          InstanceSelectorFactory.createSelector(provider);
        window._prewarmedSelectors[provider] = selector;
        regions = selector.getAllAvailableRegionKeys();
      } catch {
        regions = [];
      }
      return `<datalist id="manualRegions_${provider}">${regions
        .map((r) => `<option value="${escapeHtml(r)}"></option>`)
        .join("")}</datalist>`;
    })
    .join("");

  const regionCols = getPageProviders().map((p) =>
    InstanceSelectorFactory.getProviderRegionColumn(p),
  );
  const listCols = ["VM Name", "CPU Count", "Memory (GB)", ...regionCols];
  const listHtml = manualVMs.length
    ? `<div style="overflow-x: auto; margin-top: 10px;">
        <table style="border-collapse: collapse; font-size: 12px;">
          <thead><tr>${listCols
            .map(
              (c) =>
                `<th style="padding: 4px 10px; text-align: left; border-bottom: 1px solid var(--border-slate);">${escapeHtml(c)}</th>`,
            )
            .join("")}<th></th></tr></thead>
          <tbody>${manualVMs
            .map((vm, i) => {
              const beingEdited = i === window._manualEditIndex;
              const rowStyle = beingEdited
                ? ' style="background: var(--info-bg);"'
                : "";
              return `<tr${rowStyle}>${listCols
                .map(
                  (c) =>
                    `<td style="padding: 3px 10px; border-bottom: 1px solid var(--border-lighter);">${escapeHtml(vm[c] || "")}</td>`,
                )
                .join(
                  "",
                )}<td style="padding: 3px 6px; border-bottom: 1px solid var(--border-lighter); white-space: nowrap;"><button onclick="manualEditVM(${i})" aria-label="Edit VM ${i + 1}" title="Edit this row in the form above" style="font-size: 11px; padding: 1px 7px; border: 1px solid var(--border-slate); border-radius: 4px; background: var(--surface-alt); color: var(--text-body); cursor: pointer;">✏️</button> <button onclick="manualRemoveVM(${i})" aria-label="Remove VM ${i + 1}" title="Remove" style="font-size: 11px; padding: 1px 7px; border: 1px solid var(--border-slate); border-radius: 4px; background: var(--surface-alt); color: var(--red-strong); cursor: pointer;">✕</button></td></tr>`;
            })
            .join("")}</tbody>
        </table>
      </div>`
    : `<p style="font-size: 12px; color: var(--text-soft); margin-top: 10px;">No VMs added yet — fill the fields and click Add VM.</p>`;

  const editing = manualEditingRow();

  // Adding several near-identical VMs one at a time is the tedious case this is
  // worst at: a fleet is rarely one web server. Copies numbers them for you.
  const copiesField = editing
    ? ""
    : `
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <label for="manualCopies" style="font-size: 11px; font-weight: 600; color: var(--text-body);">Copies</label>
        <input id="manualCopies" type="number" min="1" max="${MANUAL_MAX_COPIES}" value="1" class="form-control" style="padding: 6px 10px; font-size: 13px; width: 80px;" title="Add this many VMs at once, numbered from the name above" />
      </div>`;

  const formButtons = editing
    ? `<button class="btn btn-primary" onclick="manualSaveEdit()" style="padding: 8px 16px; font-size: 13px;">💾 Save changes</button>
       <button class="btn btn-secondary" onclick="manualCancelEdit()" style="padding: 8px 16px; font-size: 13px;">Cancel</button>`
    : `<button class="btn btn-secondary" onclick="manualAddVM()" style="padding: 8px 16px; font-size: 13px;">➕ Add VM</button>`;

  const clearButton = window._manualConfirmClear
    ? `<button class="btn btn-secondary" onclick="manualClearVMs()" style="margin-top: 10px; font-size: 14px; padding: 10px 20px; color: var(--red-strong);">🗑️ Really remove all ${manualVMs.length}?</button>
       <button class="btn btn-secondary" onclick="manualCancelClear()" style="margin-top: 10px; font-size: 14px; padding: 10px 20px;">Keep them</button>`
    : `<button class="btn btn-secondary" onclick="manualConfirmClear()" style="margin-top: 10px; font-size: 14px; padding: 10px 20px;">🗑️ Clear all</button>`;

  // Apply is withheld mid-edit. It reads the saved list, so pressing it with an
  // unsaved edit in the form would quietly ingest the row's OLD values — the
  // change would simply vanish, with the form still showing it. Save or Cancel
  // first; both are one click away.
  const applyButtons =
    manualVMs.length && !editing
      ? `<button class="btn btn-primary" onclick="manualApplyVMs()" style="margin-top: 10px; font-size: 14px; padding: 10px 20px;">✅ Use these ${manualVMs.length} VM(s)</button>
       ${clearButton}`
      : "";

  section.innerHTML = `
    <div class="stats-info">
      <p><strong>✍️ Manual VM Entry</strong></p>
      <p style="font-size: 12px; color: var(--text-soft);">${
        editing
          ? "Editing the highlighted row — change the fields and save."
          : "Handy for a few VMs — for large inventories use the file upload above. ENV/OS/Workload/Compliance defaults from Advanced Filtering apply to all rows."
      }</p>
      <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;">
        ${inputs}
        ${copiesField}
        ${formButtons}
      </div>
      ${listHtml}
      ${applyButtons}
    </div>
    ${datalists}
  `;
}

// Enough to describe a cluster, few enough that a mistyped 1000 cannot lock the
// page up building rows nobody wanted.
const MANUAL_MAX_COPIES = 50;

// Reads the form. Returns null (having said why) when it does not describe a VM.
function readManualForm() {
  const defs = manualFieldDefs();
  const row = {};
  defs.forEach((d, i) => {
    const input = document.getElementById(`manual_${i}`);
    row[d.key] = input ? String(input.value || "").trim() : "";
  });

  const cpu = parseFloat(row["CPU Count"]);
  const memory = parseFloat(row["Memory (GB)"]);
  if (isNaN(cpu) || cpu <= 0 || isNaN(memory) || memory <= 0) {
    showToast(
      "Please enter a CPU Count and Memory (GB) greater than 0.",
      "warning",
    );
    return null;
  }
  return { row, defs };
}

function manualAddVM() {
  const read = readManualForm();
  if (!read) return;
  const { row, defs } = read;

  const copiesInput = document.getElementById("manualCopies");
  const requested = copiesInput ? parseInt(copiesInput.value, 10) : 1;
  const copies = Math.min(
    Math.max(Number.isFinite(requested) ? requested : 1, 1),
    MANUAL_MAX_COPIES,
  );

  const base = row["VM Name"] || `vm-${manualVMs.length + 1}`;
  for (let n = 1; n <= copies; n++) {
    // A single VM keeps the name exactly as typed — suffixing a lone "web-01"
    // into "web-01-01" would be surprising.
    const name = copies === 1 ? base : `${base}-${String(n).padStart(2, "0")}`;
    manualVMs.push({ ...row, "VM Name": name });
  }
  saveManualVMs();

  // Region values stay sticky for the next add; the rest reset
  defs.forEach((d) => {
    if (d.provider) window._manualRegionDefaults[d.key] = row[d.key];
  });

  if (copies > 1) {
    showToast(
      `Added ${copies} VMs, ${base}-01 to ${base}-${String(copies).padStart(2, "0")}`,
      "success",
    );
  }

  renderManualEntry();
  const firstInput = document.getElementById("manual_0");
  if (firstInput && firstInput.focus) firstInput.focus();
}

// ─── Editing a row ───────────────────────────────────────────────────────────
// The row is edited in the form above, prefilled — not in the table. One editor
// means one place for the CPU/memory validation and the region autocomplete to
// live, rather than two that drift.

function manualEditVM(index) {
  if (!manualVMs[index]) return;
  window._manualEditIndex = index;
  renderManualEntry();
  const firstInput = document.getElementById("manual_0");
  if (firstInput && firstInput.focus) firstInput.focus();
}

function manualSaveEdit() {
  const index = window._manualEditIndex;
  if (!Number.isInteger(index) || !manualVMs[index]) return;

  const read = readManualForm();
  if (!read) return; // invalid — stay in edit mode rather than discarding it

  manualVMs[index] = read.row;
  window._manualEditIndex = null;
  saveManualVMs();
  renderManualEntry();
  showToast("Row updated", "success");
}

function manualCancelEdit() {
  window._manualEditIndex = null;
  renderManualEntry();
}

function manualRemoveVM(index) {
  // Removing the row under edit would leave the form editing a row that no
  // longer exists; removing one BEFORE it would leave it editing the wrong one.
  if (Number.isInteger(window._manualEditIndex)) {
    if (index === window._manualEditIndex) window._manualEditIndex = null;
    else if (index < window._manualEditIndex) window._manualEditIndex -= 1;
  }
  manualVMs.splice(index, 1);
  saveManualVMs();
  renderManualEntry();
}

// Two-step, in place. The native confirm() blocks the page and cannot be themed;
// the rest of the app stopped using it in 3.5.
function manualConfirmClear() {
  if (!manualVMs.length) return;
  window._manualConfirmClear = true;
  renderManualEntry();
}

function manualCancelClear() {
  window._manualConfirmClear = false;
  renderManualEntry();
}

function manualClearVMs() {
  if (!manualVMs.length) return;
  manualVMs = [];
  window._manualEditIndex = null;
  window._manualConfirmClear = false;
  saveManualVMs();
  renderManualEntry();
}

// Feeds the manual list into the shared pipeline (canonical headers, so
// mapping is a no-op and everything downstream behaves like an upload)
function manualApplyVMs() {
  if (!manualVMs.length) {
    showToast("Add at least one VM first.", "warning");
    return;
  }
  // The button is withheld mid-edit, but say so rather than relying on that:
  // this reads the SAVED list, so an unsaved edit would be silently discarded.
  if (manualEditingRow()) {
    showToast(
      "Save or cancel the row you are editing first — its changes are not in the list yet.",
      "warning",
    );
    return;
  }

  // Every route into the data clears what the previous one left behind. Without
  // this, applying manual rows after a workbook left that workbook's sheet
  // picker on screen, still offering its sheets — and picking one would silently
  // replace the manual rows with a sheet the user had already moved on from.
  resetIngestState();
  window._ingestLabel = "Manual entry applied";

  const fileInput = document.getElementById("csvFile");
  if (fileInput) fileInput.value = "";
  const headers = manualFieldDefs().map((d) => d.key);
  ingestRows(
    headers,
    manualVMs.map((vm) => ({ ...vm })),
  );
}

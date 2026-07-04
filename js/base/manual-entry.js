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

// Field definitions for the current page's providers. Region inputs are
// sticky: they keep the last-entered value across adds.
function manualFieldDefs() {
  const defs = [
    { key: "VM Name", label: "VM Name", type: "text", placeholder: "web-server-01" },
    { key: "CPU Count", label: "CPU Count *", type: "number", placeholder: "4" },
    { key: "Memory (GB)", label: "Memory (GB) *", type: "number", placeholder: "16" },
    { key: "CPU Utilization", label: "CPU Util %", type: "number", placeholder: "45" },
    { key: "Memory Utilization", label: "Mem Util %", type: "number", placeholder: "60" },
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
            .map(
              (vm, i) =>
                `<tr>${listCols
                  .map(
                    (c) =>
                      `<td style="padding: 3px 10px; border-bottom: 1px solid var(--border-lighter);">${escapeHtml(vm[c] || "")}</td>`,
                  )
                  .join(
                    "",
                  )}<td style="padding: 3px 6px; border-bottom: 1px solid var(--border-lighter);"><button onclick="manualRemoveVM(${i})" aria-label="Remove VM ${i + 1}" title="Remove" style="font-size: 11px; padding: 1px 7px; border: 1px solid var(--border-slate); border-radius: 4px; background: var(--surface-alt); color: var(--red-strong); cursor: pointer;">✕</button></td></tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>`
    : `<p style="font-size: 12px; color: var(--text-soft); margin-top: 10px;">No VMs added yet — fill the fields and click Add VM.</p>`;

  const applyButtons = manualVMs.length
    ? `<button class="btn btn-primary" onclick="manualApplyVMs()" style="margin-top: 10px; font-size: 14px; padding: 10px 20px;">✅ Use these ${manualVMs.length} VM(s)</button>
       <button class="btn btn-secondary" onclick="manualClearVMs()" style="margin-top: 10px; font-size: 14px; padding: 10px 20px;">🗑️ Clear all</button>`
    : "";

  section.innerHTML = `
    <div class="stats-info">
      <p><strong>✍️ Manual VM Entry</strong></p>
      <p style="font-size: 12px; color: var(--text-soft);">Handy for a few VMs — for large inventories use the file upload above. ENV/OS/Workload/Compliance defaults from Advanced Filtering apply to all rows.</p>
      <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;">
        ${inputs}
        <button class="btn btn-secondary" onclick="manualAddVM()" style="padding: 8px 16px; font-size: 13px;">➕ Add VM</button>
      </div>
      ${listHtml}
      ${applyButtons}
    </div>
    ${datalists}
  `;
}

function manualAddVM() {
  const defs = manualFieldDefs();
  const row = {};
  defs.forEach((d, i) => {
    const input = document.getElementById(`manual_${i}`);
    row[d.key] = input ? String(input.value || "").trim() : "";
  });

  const cpu = parseFloat(row["CPU Count"]);
  const memory = parseFloat(row["Memory (GB)"]);
  if (isNaN(cpu) || cpu <= 0 || isNaN(memory) || memory <= 0) {
    alert("Please enter a CPU Count and Memory (GB) greater than 0.");
    return;
  }
  if (!row["VM Name"]) row["VM Name"] = `vm-${manualVMs.length + 1}`;

  manualVMs.push(row);
  saveManualVMs();

  // Region values stay sticky for the next add; the rest reset
  defs.forEach((d, i) => {
    if (d.provider) {
      window._manualRegionDefaults[d.key] = row[d.key];
    }
  });
  renderManualEntry();
  const firstInput = document.getElementById("manual_0");
  if (firstInput && firstInput.focus) firstInput.focus();
}

function manualRemoveVM(index) {
  manualVMs.splice(index, 1);
  saveManualVMs();
  renderManualEntry();
}

function manualClearVMs() {
  if (!manualVMs.length) return;
  if (!confirm(`Remove all ${manualVMs.length} manually entered VM(s)?`)) {
    return;
  }
  manualVMs = [];
  saveManualVMs();
  renderManualEntry();
}

// Feeds the manual list into the shared pipeline (canonical headers, so
// mapping is a no-op and everything downstream behaves like an upload)
function manualApplyVMs() {
  if (!manualVMs.length) {
    alert("Add at least one VM first.");
    return;
  }
  window._uploadNote = null;
  window._ingestLabel = "Manual entry applied";
  const headers = manualFieldDefs().map((d) => d.key);
  ingestRows(
    headers,
    manualVMs.map((vm) => ({ ...vm })),
  );
}
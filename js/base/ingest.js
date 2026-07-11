// Ingestion: file upload (CSV/xlsx), parsing, column auto-mapping,
// mapping panel, and MB→GB unit conversion.

// Download sample CSV
function downloadSampleCSV() {
  const csvContent = `VM Name,App Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region,ENV,OS,Workload,Compliance,Min Gen
web-server-01,Storefront,4,16,45,60,us-east-1,East US,us-central1-a,Production,Linux,Web Server,,
db-server-02,Billing,8,32,70,80,us-west-2,West US 2,us-west1-b,Production,Windows,Database,PCI,
app-server-03,Billing,2,8,35,45,eu-west-1,North Europe,europe-west1-c,Dev,Linux,General,,
cache-server-04,Storefront,2,4,25,30,us-east-1,East US,us-central1-a,Staging,Linux,Cache,,
api-server-05,Storefront,4,8,65,55,us-west-1,West US,us-west1-b,Production,Linux,Web Server,,6
microservice-06,Analytics,1,2,15,20,us-east-1,East US,us-central1-a,Dev,Linux,General,,
worker-node-07,Analytics,8,16,85,75,us-west-2,West US 2,us-west1-b,Production,Linux,ML/AI,HIPAA,7
frontend-08,Storefront,2,4,40,50,eu-west-1,North Europe,europe-west1-c,Staging,Windows,Web Server,,`;

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "sample_instance_data.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Handle file upload
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  console.log("File upload started:", file.name);
  ingestFile(file);
}

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

function showUploadError(message) {
  const fileStatus = document.getElementById("fileStatus");
  if (!fileStatus) return;
  fileStatus.className = "alert alert-warning";
  fileStatus.innerHTML = `⚠️ ${escapeHtml(message)}`;
  fileStatus.classList.remove("hidden");
}

// Drag-and-drop onto the upload box. The document-wide preventDefault matters:
// without it a drop that misses the zone makes the browser navigate to the file.
function setupFileDragAndDrop(fileInput) {
  const dropZone = fileInput.closest(".file-upload") || fileInput.parentElement;
  if (!dropZone) return;

  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  ["dragenter", "dragover", "dragleave", "drop"].forEach((event) => {
    dropZone.addEventListener(event, stop);
    document.body.addEventListener(event, stop);
  });

  ["dragenter", "dragover"].forEach((event) =>
    dropZone.addEventListener(event, () => dropZone.classList.add("dragover")),
  );
  ["dragleave", "drop"].forEach((event) =>
    dropZone.addEventListener(event, () =>
      dropZone.classList.remove("dragover"),
    ),
  );

  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;

    const file = files[0];
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      showUploadError("Please drop a CSV or Excel (.xlsx) file.");
      return;
    }

    // Route through the input so the change handler stays the only entry point
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// Loads the vendored SheetJS parser on first use only (Excel uploads are
// rare enough that the ~900KB script shouldn't be part of page load)
function ensureXlsxLoaded() {
  if (window.XLSX) return Promise.resolve();
  if (!window._xlsxLoadPromise) {
    window._xlsxLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "js/vendor/xlsx.full.min.js";
      script.onload = () => resolve();
      script.onerror = () => {
        window._xlsxLoadPromise = null;
        reject(
          new Error(
            "Could not load the Excel parser (js/vendor/xlsx.full.min.js)",
          ),
        );
      };
      document.head.appendChild(script);
    });
  }
  return window._xlsxLoadPromise;
}

// What a file actually IS, from its first bytes — the extension is a claim, not
// evidence. A .xlsx is a ZIP; a workbook renamed .csv would otherwise be read as
// text and silently parsed into garbage rows.
// Returns "excel" | "legacy-excel" | "binary" | "text", or "unknown" when the
// bytes could not be read (callers then fall back to the extension).
function sniffFileKind(head) {
  if (!head || !head.length) return "unknown";
  const startsWith = (...bytes) => bytes.every((b, i) => head[i] === b);

  // ZIP local-file header ("PK\x03\x04") — every .xlsx is a ZIP container
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return "excel";
  // OLE2 compound file — a legacy .xls, which SheetJS's full build can read but
  // which users are better off re-saving
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0)) return "legacy-excel";
  // Text never contains NUL; any binary we don't recognize lands here
  if (head.includes(0x00)) return "binary";
  return "text";
}

async function readFileHead(file, bytes = 8) {
  if (typeof file.slice !== "function") return null;
  try {
    return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
  } catch {
    return null;
  }
}

// Routes an uploaded file into the pipeline by its CONTENT: a ZIP goes to
// SheetJS (first sheet only), text goes to the CSV parser, and anything else is
// rejected with an explanation. The extension only decides when the bytes are
// unavailable.
async function ingestFile(file) {
  window._uploadNote = null;
  window._ingestLabel = null;

  // Applies to both branches — an empty or oversized CSV used to be caught
  // only by the legacy handler, which no longer exists
  if (file.size === 0) {
    showUploadError("File is empty");
    return;
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    showUploadError("File size too large. Maximum allowed size is 10MB.");
    return;
  }

  const namedXlsx = /\.xlsx$/i.test(file.name);
  const kind = sniffFileKind(await readFileHead(file));

  if (kind === "legacy-excel") {
    showUploadError(
      `"${file.name}" is a legacy Excel workbook (.xls). Open it in Excel and save it as .xlsx or CSV, then upload it again.`,
    );
    return;
  }
  if (kind === "binary") {
    showUploadError(
      `"${file.name}" doesn't look like a CSV or Excel file. Please upload a .csv or .xlsx inventory.`,
    );
    return;
  }

  // Content wins over the name, but say so — a silently re-routed file would be
  // confusing when the user goes looking for why their ".csv" opened as Excel.
  if (kind === "excel" && !namedXlsx) {
    window._uploadNote = `"${file.name}" is named as a CSV but is an Excel workbook — read as Excel`;
  } else if (kind === "text" && namedXlsx) {
    window._uploadNote = `"${file.name}" is named as an Excel file but is plain text — read as CSV`;
  }

  const asExcel = kind === "unknown" ? namedXlsx : kind === "excel";

  if (!asExcel) {
    const reader = new FileReader();
    reader.onload = function (e) {
      parseCSV(e.target.result);
    };
    reader.onerror = function () {
      const fileStatus = document.getElementById("fileStatus");
      if (fileStatus) {
        fileStatus.className = "alert alert-warning";
        fileStatus.innerHTML = `⚠️ Could not read the file "${escapeHtml(file.name)}". Please try again.`;
        fileStatus.classList.remove("hidden");
      }
    };
    reader.readAsText(file);
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    await ensureXlsxLoaded();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("The workbook has no sheets");

    // raw:false → formatted strings, matching what CSV parsing produces
    const rows2d = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    if (!rows2d.length) throw new Error(`Sheet "${sheetName}" is empty`);

    const headers = rows2d[0].map((h) => String(h).trim());
    const rows = rows2d
      .slice(1)
      .map((values) => {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = String(values[index] ?? "").trim();
        });
        return row;
      })
      .filter((row) => Object.values(row).some((v) => v !== ""));

    if (workbook.SheetNames.length > 1) {
      // Surfaced in the file status by applyIngest — not just the console.
      // Appended, so it cannot swallow a mis-named-file note set above.
      const sheetNote = `Workbook has ${workbook.SheetNames.length} sheets — only the first ("${sheetName}") was used`;
      window._uploadNote = window._uploadNote
        ? `${window._uploadNote}. ${sheetNote}`
        : sheetNote;
    }
    ingestRows(headers, rows);
  } catch (error) {
    console.error("Excel parsing failed:", error);
    const fileStatus = document.getElementById("fileStatus");
    if (fileStatus) {
      fileStatus.className = "alert alert-warning";
      fileStatus.innerHTML = `⚠️ Could not read the Excel file: ${escapeHtml(error.message)}`;
      fileStatus.classList.remove("hidden");
    }
  }
}

// Parse CSV text into headers + row objects, then hand off to ingestRows
// (which owns column mapping and everything downstream — the xlsx path
// feeds ingestRows directly)
function parseCSV(csvText) {
  console.log("Parsing CSV data");
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
  ingestRows(headers, rows);
}

// ─── Column mapping ───────────────────────────────────────────────────────────
function normalizeHeader(header) {
  return String(header)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function headerSignature(headers) {
  return headers
    .map((h) => String(h).trim().toLowerCase())
    .sort()
    .join("|");
}

// App→workload map: { "<app name lowercased>": "<Workload>" }. Persisted
// globally (not per-file) so the same app prefills its workload on later
// uploads. Consumed at generation time via options.appWorkloadMap.
function loadAppWorkloadMap() {
  try {
    return (
      JSON.parse(localStorage.getItem("cloudInstanceRecommenderAppMap")) || {}
    );
  } catch {
    return {};
  }
}

// Returns true on success, false if storage is unavailable (quota exceeded,
// private-browsing, etc.) so callers can tell the user honestly rather than
// claiming a save that was actually discarded.
function saveAppWorkloadMap(map) {
  try {
    localStorage.setItem("cloudInstanceRecommenderAppMap", JSON.stringify(map));
    return true;
  } catch (e) {
    console.warn("Could not persist app→workload map:", e);
    return false;
  }
}

// Matches uploaded headers to the canonical COLUMN_MAPPINGS names.
// Per canonical, candidates come from: exact (case-insensitive) → normalized
// equality → synonym table. A bare "Region" column counts as the page's
// provider region on single-provider pages only. Only CPU Count and Memory
// (GB) are required; the rest (VM Name, App Name, region cols) are optional.
// Returns { mapping (source→canonical), renames, unmatchedRequired,
// ambiguous, needsReview }.
function autoMatchHeaders(headers) {
  const canonicals = pageCanonicals();
  const required = REQUIRED_CANONICALS;
  const providers = getPageProviders();
  const claimed = new Set();
  const mapping = {};
  const ambiguous = [];
  const unmatchedRequired = [];

  for (const canonical of canonicals) {
    const canonNorm = normalizeHeader(canonical);
    const synonyms = COLUMN_SYNONYMS[canonical] || [];
    const candidates = headers.filter((h) => {
      if (claimed.has(h)) return false;
      const norm = normalizeHeader(h);
      if (h.toLowerCase() === canonical.toLowerCase()) return true;
      if (norm === canonNorm) return true;
      if (synonyms.includes(norm)) return true;
      // Bare "Region": unambiguous only when the page has one provider
      if (
        norm === "region" &&
        providers.length === 1 &&
        canonical ===
          InstanceSelectorFactory.getProviderRegionColumn(providers[0])
      ) {
        return true;
      }
      return false;
    });

    if (candidates.length === 1) {
      mapping[candidates[0]] = canonical;
      claimed.add(candidates[0]);
    } else if (candidates.length > 1) {
      // Includes the collision case: literal canonical AND a synonym both
      // present — never guess silently
      ambiguous.push({ canonical, candidates });
    } else if (required.includes(canonical)) {
      unmatchedRequired.push(canonical);
    }
  }

  const renames = Object.entries(mapping)
    .filter(([source, canonical]) => source !== canonical)
    .map(([source, canonical]) => ({ from: source, to: canonical }));

  return {
    mapping,
    renames,
    unmatchedRequired,
    ambiguous,
    needsReview: ambiguous.length > 0 || unmatchedRequired.length > 0,
  };
}

function rewriteRowKeys(rows, mapping) {
  const hasRename = Object.entries(mapping).some(([s, c]) => s !== c);
  if (!hasRename) return rows;
  return rows.map((row) => {
    const out = {};
    Object.keys(row).forEach((key) => {
      out[mapping[key] || key] = row[key];
    });
    return out;
  });
}

// A header whose normalized name ends in mb/mib (RVTools-style exports)
// holds megabytes
function isMbHeader(header) {
  return /(mb|mib)$/.test(normalizeHeader(header));
}

// Memory unit detection for a mapping: MB source → convert to GB on ingest
function detectMemoryUnit(mapping) {
  const source = Object.keys(mapping).find(
    (s) => mapping[s] === COLUMN_MAPPINGS.memory,
  );
  if (!source) return {};
  return isMbHeader(source) ? { [COLUMN_MAPPINGS.memory]: "MB" } : {};
}

// Saved mappings: { headerSignature: { mapping: {source: canonical},
// units: {canonical: "MB"} } }. Older entries were the flat mapping object.
function loadColumnMappings() {
  try {
    return (
      JSON.parse(localStorage.getItem("cloudInstanceRecommenderColumnMaps")) ||
      {}
    );
  } catch {
    return {};
  }
}

function readSavedMapping(entry) {
  if (!entry) return null;
  if (entry.mapping)
    return { mapping: entry.mapping, units: entry.units || {} };
  return { mapping: entry, units: detectMemoryUnit(entry) }; // legacy format
}

function saveColumnMapping(signature, mapping, units) {
  try {
    const all = loadColumnMappings();
    all[signature] = { mapping, units: units || {} };
    localStorage.setItem(
      "cloudInstanceRecommenderColumnMaps",
      JSON.stringify(all),
    );
  } catch (e) {
    console.warn("Could not persist column mapping:", e);
  }
}

// Entry point for parsed uploads (CSV and, later, xlsx). Applies column
// mapping silently when unambiguous; otherwise defers the whole pipeline
// (csvData stays empty) until the user confirms in the mapping panel.
function ingestRows(headers, rows) {
  console.log(`Parsed ${rows.length} rows with ${headers.length} columns`);

  // A mapping the user previously confirmed for this exact header set wins
  const saved = readSavedMapping(
    loadColumnMappings()[headerSignature(headers)],
  );
  if (saved && Object.keys(saved.mapping).every((s) => headers.includes(s))) {
    console.log("Applying saved column mapping");
    applyIngest(headers, rows, saved.mapping, saved.units);
    return;
  }

  const match = autoMatchHeaders(headers);
  if (match.needsReview) {
    csvData = [];
    columnHeaders = [];
    window._pendingIngest = { headers, rows, match };
    showColumnMappingPanel(headers, match);
    return;
  }

  applyIngest(headers, rows, match.mapping, detectMemoryUnit(match.mapping));
}

// Applies a mapping and runs the normal post-upload pipeline
function applyIngest(headers, rows, mapping, units = {}) {
  const finalHeaders = headers.map((h) => mapping[h] || h);
  columnHeaders = finalHeaders;
  csvData = rewriteRowKeys(rows, mapping);

  // Unit conversion: memory supplied in MB (RVTools-style) → GB
  const memCol = COLUMN_MAPPINGS.memory;
  const memConverted = units && units[memCol] === "MB";
  if (memConverted) {
    csvData = csvData.map((row) => {
      const v = parseFloat(row[memCol]);
      if (isNaN(v)) return row;
      return { ...row, [memCol]: String(Math.round((v / 1024) * 100) / 100) };
    });
  }

  window._pendingIngest = null;
  // Keep the pre-rewrite originals so the mapping stays editable afterwards
  window._lastIngest = { headers, rows, mapping, units: units || {} };

  const panel = document.getElementById("columnMappingSection");
  if (panel) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
  }

  const renames = Object.entries(mapping)
    .filter(([source, canonical]) => source !== canonical)
    .map(([source, canonical]) => `${source} → ${canonical}`);

  // Validate required columns
  const missingColumns = REQUIRED_CANONICALS.filter(
    (col) => !finalHeaders.includes(col),
  );

  const fileStatus = document.getElementById("fileStatus");
  const renameNote = renames.length
    ? `<br>📎 Mapped columns: ${renames.map(escapeHtml).join(", ")}`
    : "";
  const uploadNote = window._uploadNote
    ? `<br>📄 ${escapeHtml(window._uploadNote)}`
    : "";
  const memNote = memConverted
    ? `<br>📐 Memory values converted from MB to GB`
    : "";
  const editBtn = ` <button onclick="editColumnMapping()" title="Change which of your columns map to the CPU, memory, name, and region fields" style="margin-left: 8px; padding: 2px 10px; font-size: 12px; border: 1px solid var(--border-slate); border-radius: 6px; background: var(--surface-alt); color: var(--text-body); cursor: pointer;">✏️ Edit mapping</button>`;
  const okLabel = window._ingestLabel || "File loaded successfully";
  if (missingColumns.length > 0) {
    fileStatus.className = "alert alert-warning";
    fileStatus.innerHTML = `⚠️ Missing required columns: ${missingColumns
      .map(escapeHtml)
      .join(
        ", ",
      )}. Please check your file format.${renameNote}${uploadNote}${memNote}${editBtn}`;
    console.warn("Missing required columns:", missingColumns);
  } else {
    fileStatus.className = "alert alert-success";
    fileStatus.innerHTML = `✅ ${okLabel}: ${csvData.length} rows, ${finalHeaders.length} columns${renameNote}${uploadNote}${memNote}${editBtn}`;
    console.log("File validation successful");
  }
  fileStatus.classList.remove("hidden");

  // Show file statistics
  showFileStatistics();

  // Check region names against the manifests, then start loading the region
  // data this CSV needs in the background (skipping unknown regions)
  validateCsvRegions();
  prefetchCsvRegions();

  // If the file groups VMs by application but has no per-row Workload, offer
  // the app→workload mapping panel so those VMs can inherit a workload.
  maybeShowAppMappingPanel();
}

// Renders the mapping panel: one dropdown per canonical column, prefilled
// with the auto-match guesses; the pipeline stays deferred until Confirm.
// opts.isEdit reopens the panel over already-applied data: nothing changes
// unless the user confirms, and Cancel simply closes the panel.
function showColumnMappingPanel(headers, match, opts = {}) {
  const panel = document.getElementById("columnMappingSection");
  if (!panel) {
    // Page has no panel placeholder — apply best-effort mapping instead
    if (!opts.isEdit) {
      applyIngest(
        headers,
        window._pendingIngest.rows,
        match.mapping,
        match.units || detectMemoryUnit(match.mapping),
      );
    }
    return;
  }

  const canonicals = pageCanonicals();
  const required = REQUIRED_CANONICALS;
  const guessBySource = match.mapping; // source → canonical
  const guessedSource = {};
  Object.entries(guessBySource).forEach(([source, canonical]) => {
    guessedSource[canonical] = source;
  });
  // Ambiguous canonicals: preselect nothing, list candidates in the label
  const ambiguousByCanonical = {};
  match.ambiguous.forEach((a) => {
    ambiguousByCanonical[a.canonical] = a.candidates;
  });

  // Memory unit prefill: saved/applied units win (edit mode), else detect
  // from the guessed source header
  const memUnit =
    (match.units || detectMemoryUnit(match.mapping))[COLUMN_MAPPINGS.memory] ===
    "MB"
      ? "MB"
      : "GB";

  const selectRows = canonicals
    .map((canonical, idx) => {
      const isMemory = canonical === COLUMN_MAPPINGS.memory;
      const options = [
        `<option value="">— not present —</option>`,
        ...headers.map((h, i) => {
          const selected = guessedSource[canonical] === h ? " selected" : "";
          return `<option value="${i}"${selected}>${escapeHtml(h)}</option>`;
        }),
      ].join("");
      const reqMark = required.includes(canonical)
        ? ' <span style="color: var(--red-badge);">*</span>'
        : "";
      const ambiguousNote = ambiguousByCanonical[canonical]
        ? `<span style="color: var(--warning-text); font-size: 12px;"> (several columns could match — please pick one)</span>`
        : "";
      const syncAttr = isMemory ? ` onchange="window._syncMemUnit(this)"` : "";
      const unitSelect = isMemory
        ? ` <select id="colmap_unit_mem" class="form-control" style="max-width: 190px;" aria-label="Unit of the memory values in your file" title="RVTools-style exports list memory in MB — pick MB to convert to GB automatically">
            <option value="GB"${memUnit === "GB" ? " selected" : ""}>values are GB</option>
            <option value="MB"${memUnit === "MB" ? " selected" : ""}>values are MB → ÷1024</option>
          </select>`
        : "";
      return `
        <div style="display: flex; align-items: center; gap: 10px; margin: 6px 0; flex-wrap: wrap;">
          <label for="colmap_${idx}" style="min-width: 180px; font-weight: 500;">${escapeHtml(canonical)}${reqMark}${ambiguousNote}</label>
          <select id="colmap_${idx}" data-canonical="${escapeHtml(canonical)}"${syncAttr} class="form-control" style="max-width: 260px;">${options}</select>${unitSelect}
        </div>`;
    })
    .join("");

  const intro = opts.isEdit
    ? `Adjust which of your columns maps to each field, then confirm to re-apply (<span style="color: var(--red-badge);">*</span> = required). Nothing changes until you confirm.`
    : `Some column names couldn't be matched automatically. Pick which of your columns corresponds to each field (<span style="color: var(--red-badge);">*</span> = required).`;
  const cancelBtn = opts.isEdit
    ? ` <button class="btn btn-secondary" onclick="cancelColumnMapping()" style="margin-top: 8px;">Cancel</button>`
    : "";

  panel.innerHTML = `
    <div class="stats-info">
      <p><strong>🔗 Map Your Columns</strong></p>
      <p style="font-size: 13px;">${intro}</p>
      ${selectRows}
      <p style="font-size: 12px; margin-top: 8px;">Other columns (ENV, OS, Workload, Compliance, Min Gen, Exclude) are used as-is when present.</p>
      <button class="btn btn-primary" onclick="applyColumnMapping()" style="margin-top: 8px;">✔️ Confirm Mapping</button>${cancelBtn}
    </div>
  `;
  panel.classList.remove("hidden");

  if (!opts.isEdit) {
    const fileStatus = document.getElementById("fileStatus");
    if (fileStatus) {
      fileStatus.className = "alert alert-warning";
      fileStatus.innerHTML = `⚠️ Please review the column mapping below, then confirm to continue.`;
      fileStatus.classList.remove("hidden");
    }
  }
}

// Keeps the memory-unit dropdown in step with the chosen source column:
// picking a column whose name ends in MB/MiB flips the unit to MB
window._syncMemUnit = function (select) {
  const unitSelect = document.getElementById("colmap_unit_mem");
  if (!unitSelect || !select || !select.options) return;
  const label = select.options[select.selectedIndex]
    ? select.options[select.selectedIndex].text || ""
    : "";
  unitSelect.value = isMbHeader(label) ? "MB" : "GB";
};

// "Edit mapping" button: reopens the panel prefilled with the mapping that
// is currently applied, using the original (pre-rewrite) headers and rows
function editColumnMapping() {
  const last = window._lastIngest;
  if (!last) return;
  window._pendingIngest = {
    headers: last.headers,
    rows: last.rows,
    match: {
      mapping: last.mapping,
      ambiguous: [],
      unmatchedRequired: [],
      units: last.units || {},
    },
  };
  showColumnMappingPanel(last.headers, window._pendingIngest.match, {
    isEdit: true,
  });
  const panel = document.getElementById("columnMappingSection");
  if (panel && panel.scrollIntoView) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Cancel button (edit mode only): close the panel, keep the applied mapping
function cancelColumnMapping() {
  window._pendingIngest = null;
  const panel = document.getElementById("columnMappingSection");
  if (panel) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
  }
}

// Confirm button handler for the mapping panel
function applyColumnMapping() {
  const pending = window._pendingIngest;
  if (!pending) return;

  const canonicals = pageCanonicals();
  const required = REQUIRED_CANONICALS;
  const mapping = {};
  const usedSources = new Set();

  for (let idx = 0; idx < canonicals.length; idx++) {
    const select = document.getElementById(`colmap_${idx}`);
    if (!select || select.value === "") continue;
    const source = pending.headers[parseInt(select.value, 10)];
    if (usedSources.has(source)) {
      alert(
        `Column "${source}" is assigned to more than one field. Each column can map to only one field.`,
      );
      return;
    }
    usedSources.add(source);
    mapping[source] = canonicals[idx];
  }

  const missingRequired = required.filter(
    (canonical) => !Object.values(mapping).includes(canonical),
  );
  if (missingRequired.length) {
    alert(`Please assign a column for: ${missingRequired.join(", ")}`);
    return;
  }

  // Memory unit: explicit dropdown choice wins; auto-detect otherwise
  const units = {};
  if (Object.values(mapping).includes(COLUMN_MAPPINGS.memory)) {
    const unitSelect = document.getElementById("colmap_unit_mem");
    if (unitSelect && unitSelect.value === "MB") {
      units[COLUMN_MAPPINGS.memory] = "MB";
    } else if (!unitSelect || !unitSelect.value) {
      Object.assign(units, detectMemoryUnit(mapping));
    }
  }

  saveColumnMapping(headerSignature(pending.headers), mapping, units);
  applyIngest(pending.headers, pending.rows, mapping, units);
}

// ─── App → workload mapping panel ─────────────────────────────────────────────
// Appears after ingest when the file has an "App Name" column but no per-row
// "Workload" column: assigning a workload per application lets every VM in that
// app inherit it at generation time. Purely optional — the panel only persists
// the map; generation reads it (see resolveRowWorkload in the factory).
function maybeShowAppMappingPanel() {
  const panel = document.getElementById("appMappingSection");
  if (!panel) return;

  const hasApp = columnHeaders.includes(APP_NAME_CANONICAL);
  const hasWorkload = columnHeaders.includes("Workload");
  // Dedupe case-insensitively (the persisted map keys on the lowercased name),
  // keeping the first-seen casing for the label — otherwise "Billing" and
  // "billing" would render as two rows that silently save to the same key.
  const apps = hasApp
    ? Array.from(
        csvData
          .reduce((seen, r) => {
            const raw = (r[APP_NAME_CANONICAL] || "").trim();
            if (raw && !seen.has(raw.toLowerCase())) {
              seen.set(raw.toLowerCase(), raw);
            }
            return seen;
          }, new Map())
          .values(),
      ).sort((a, b) => a.localeCompare(b))
    : [];

  // Nothing to map: no App Name column, an explicit Workload column already
  // wins, or the App Name column is empty on every row.
  if (!hasApp || hasWorkload || !apps.length) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const saved = loadAppWorkloadMap();
  const rows = apps
    .map((app, idx) => {
      // safeMapGet (defined in instance-selector-factory.js) guards against
      // inherited Object.prototype keys like an app literally named "constructor"
      const cur = safeMapGet(saved, app.toLowerCase());
      const opts = [
        `<option value="">— use page default —</option>`,
        ...APP_WORKLOAD_OPTIONS.map(
          (w) =>
            `<option value="${escapeHtml(w)}"${cur === w ? " selected" : ""}>${escapeHtml(w)}</option>`,
        ),
      ].join("");
      return `
        <div style="display: flex; align-items: center; gap: 10px; margin: 6px 0; flex-wrap: wrap;">
          <label for="appmap_${idx}" style="min-width: 200px; font-weight: 500;">${escapeHtml(app)}</label>
          <select id="appmap_${idx}" data-app="${escapeHtml(app)}" class="form-control" style="max-width: 220px;">${opts}</select>
        </div>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="stats-info">
      <p><strong>🧩 Map Applications to Workloads</strong> <span style="font-size: 12px; color: var(--text-soft);">(optional)</span></p>
      <p style="font-size: 13px;">Your file has an <strong>App Name</strong> column but no <strong>Workload</strong> column. Assign a workload per application and every VM in it inherits that workload when you generate. Precedence: a row's own Workload cell → this map → page default → General.</p>
      ${rows}
      <button class="btn btn-primary" onclick="applyAppMapping()" style="margin-top: 8px;">💾 Save App Workloads</button>
      <span id="appMappingStatus" role="status" style="margin-left: 10px; font-size: 13px; color: var(--good-strong);"></span>
    </div>`;
  panel.classList.remove("hidden");
}

// Save button: merge the panel's selections into the persisted app→workload
// map (blank = clear that app so it falls back to the page default).
function applyAppMapping() {
  const panel = document.getElementById("appMappingSection");
  if (!panel) return;
  const map = loadAppWorkloadMap();
  panel.querySelectorAll("select[data-app]").forEach((sel) => {
    const app = (sel.getAttribute("data-app") || "").toLowerCase();
    if (!app) return;
    if (sel.value) map[app] = sel.value;
    else delete map[app];
  });
  const ok = saveAppWorkloadMap(map);
  const status = document.getElementById("appMappingStatus");
  if (status) {
    status.textContent = ok
      ? "✓ Saved — applied on the next Generate"
      : "⚠️ Could not save — browser storage is unavailable";
    // The span's base color is the success green; recolor on failure so the
    // warning doesn't read as a success.
    status.style.color = ok ? "var(--good-strong)" : "var(--red-strong)";
  }
}

// Parse CSV line handling quoted values
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

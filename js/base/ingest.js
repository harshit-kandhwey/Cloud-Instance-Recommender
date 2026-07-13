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

  downloadCsv(csvContent, "sample_instance_data.csv");
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

    // No extension gate here: ingestFile decides by content, so a workbook
    // whose name doesn't end in .xlsx is still accepted, and anything that
    // isn't a spreadsheet is refused there with a specific reason.
    const file = files[0];

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

  // Formats whose signature is entirely printable would survive the control-
  // character test below and be handed to the CSV parser as text.
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return "binary"; // "%PDF-"
  if (startsWith(0x7b, 0x5c, 0x72, 0x74, 0x66)) return "binary"; // "{\rtf"
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "binary"; // "GIF8"
  // JPEG's high bytes are not control characters, and the length bytes that
  // follow are not reliably zero, so it needs naming too
  if (startsWith(0xff, 0xd8, 0xff)) return "binary"; // JPEG

  // Any C0 control character other than tab/CR/LF means this is not text. NUL is
  // the obvious case, but a NUL test alone is not a text test: a real PNG
  // (89 50 4E 47 0D 0A 1A 0A) has none, and only its 0x1A gives it away.
  const TEXT_CONTROLS = [0x09, 0x0a, 0x0d];
  if (head.some((b) => b < 0x20 && !TEXT_CONTROLS.includes(b))) return "binary";

  // High bytes are fine — a UTF-8 BOM or a non-ASCII VM name is still text
  return "text";
}

// A spreadsheet writes 16384 as "16,384" when the cell carries a thousands
// separator — and RVTools does exactly that for Memory, in every export I have
// seen, across versions.
//
// `parseFloat("16,384")` is **16**. Not NaN, not an error: a wrong answer, and a
// plausible-looking one. A 16 GiB VM then had its MiB divided by 1024 and arrived
// as 0.02 GB, and every machine in the file sized to the smallest instance on
// offer. Nothing caught it — 0.02 is not zero, so the input check stayed quiet,
// and the median was far below the MiB threshold, so that question never fired.
// The report came out looking entirely normal and was entirely wrong.
//
// Only strictly grouped thousands are stripped. `1,234` and `1,234,567.8` are
// unambiguous; `3,5` is left alone, because in much of the world that is three
// and a half, and guessing at a locale is how this class of bug starts.
const GROUPED_THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

function normalizeCellValue(value) {
  const text = String(value ?? "").trim();
  return GROUPED_THOUSANDS.test(text) ? text.replace(/,/g, "") : text;
}

async function readFileHead(file, bytes = 8) {
  if (typeof file.slice !== "function") return null;
  try {
    return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
  } catch {
    return null;
  }
}

// Every new input starts from a clean slate: a CSV after a workbook must not
// leave the previous file's sheet picker on screen, still offering its sheets.
function resetIngestState() {
  window._uploadNote = null;
  window._ingestLabel = null;
  window._uploadedSheets = null;
  window._uploadFileNote = null;
  const picker = document.getElementById("sheetPickerSection");
  if (picker) {
    picker.classList.add("hidden");
    picker.innerHTML = "";
  }
}

// Routes an uploaded file into the pipeline by its CONTENT: a ZIP goes to
// SheetJS (which then picks the sheet that looks like an inventory), text goes
// to the delimited-text parser, and anything else is rejected with an
// explanation. The extension only decides when the bytes are unavailable.
async function ingestFile(file) {
  // Nothing is torn down until the new file is known to be usable. Resetting
  // first left a rejected upload having already removed the previous workbook's
  // sheet picker while its rows were still loaded and generatable — the controls
  // that produced the data on screen would be gone, and the data would not be.
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

  // Past the gates: this file is going to be read, so the old one can go.
  resetIngestState();

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

    const sheets = workbook.SheetNames.map((name) =>
      readWorkbookSheet(workbook, name),
    ).filter(Boolean);
    if (!sheets.length) throw new Error("The workbook has no sheets with data");

    const chosen = pickBestSheet(sheets);
    window._uploadedSheets = sheets;
    // The file-level note ("named .csv but is a workbook") stays true across a
    // sheet switch, so keep it to re-apply — _uploadNote is consumed per ingest.
    window._uploadFileNote = window._uploadNote;

    // A page with no picker gives the user no way to see or change the choice,
    // so there it must at least say what it opened.
    if (!renderSheetPicker(sheets, chosen.name) && sheets.length > 1) {
      const sheetNote = `Workbook has ${sheets.length} sheets — read "${chosen.name}"`;
      window._uploadNote = window._uploadNote
        ? `${window._uploadNote}. ${sheetNote}`
        : sheetNote;
    }

    ingestRows(chosen.headers, chosen.rows);
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

// ─── Workbook sheets ─────────────────────────────────────────────────────────
// Workbooks are rarely single-sheet. An RVTools export keeps the VM inventory in
// a "vInfo" tab behind other tabs; a hand-kept spreadsheet often leads with a
// cover note or a pivot. Reading SheetNames[0] gets those files quietly wrong,
// so read every sheet, open the one that most looks like an inventory, and leave
// the choice visible and changeable.

// Returns null for a sheet with no data or no header row — an empty tab and a
// notes tab are not candidates, and must not be offered as one.
function readWorkbookSheet(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) return null;

  // raw:false → formatted strings, matching what CSV parsing produces
  const rows2d = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (!rows2d.length) return null;

  const headers = rows2d[0].map((h) => String(h).trim());
  if (!headers.some((h) => h !== "")) return null;

  const rows = rows2d
    .slice(1)
    .map((values) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = normalizeCellValue(values[index]);
      });
      return row;
    })
    .filter((row) => Object.values(row).some((v) => v !== ""));

  // A sheet with headers and no rows is a template, not an inventory. It has to
  // be excluded here rather than merely ranked low: scoring weighs recognised
  // columns above row count, so a blank template with a full set of canonical
  // headers would outrank the populated sheet next to it and open empty.
  if (!rows.length) return null;

  return { name, headers, rows };
}

// A sheet an import preset RECOGNISES is the inventory — that beats any amount
// of generic column counting, and it must, because generic counting gets real
// files wrong. An RVTools workbook has 28 tabs, and `vHost` (the ESXi servers
// the VMs run ON) can map more canonical-looking columns than `vInfo` (the VMs
// themselves). The picker duly opened `vHost` on a real export: the wrong
// machines entirely, and with no `VM`/`Powerstate` column the RVTools preset
// then did not fire either. The preset knows which sheet is the inventory. Ask
// it first, and only fall back to counting columns when nothing is recognised.
function scoreSheet(sheet) {
  const match = autoMatchHeaders(sheet.headers);
  return {
    recognised: !!match.preset,
    hasRequired: match.unmatchedRequired.length === 0,
    mapped: Object.keys(match.mapping).length,
    rows: sheet.rows.length,
  };
}

// In order: a sheet a preset recognises, then one with every required column,
// then the one with the most recognised columns, then the biggest. Ties fall
// back to workbook order, so a workbook whose sheets look alike still opens its
// first — the behaviour from before there was a choice to make.
function pickBestSheet(sheets) {
  const scored = sheets.map((sheet) => ({ sheet, ...scoreSheet(sheet) }));
  return scored.reduce((best, s) => {
    if (s.recognised !== best.recognised) return s.recognised ? s : best;
    if (s.hasRequired !== best.hasRequired) return s.hasRequired ? s : best;
    if (s.mapped !== best.mapped) return s.mapped > best.mapped ? s : best;
    return s.rows > best.rows ? s : best;
  }).sheet;
}

// Returns false when the page has no picker element, so the caller can fall back
// to explaining the choice in the status line instead.
function renderSheetPicker(sheets, activeName) {
  const el = document.getElementById("sheetPickerSection");
  if (!el) return false;

  if (sheets.length < 2) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return true;
  }

  const options = sheets
    .map((s) => {
      const count = `${s.rows.length} row${s.rows.length === 1 ? "" : "s"}`;
      const selected = s.name === activeName ? " selected" : "";
      return `<option value="${escapeHtml(s.name)}"${selected}>${escapeHtml(s.name)} — ${count}</option>`;
    })
    .join("");

  el.innerHTML = `
    <div class="alert alert-info">
      <label for="sheetPicker"><strong>📑 Sheet to read:</strong></label>
      <select id="sheetPicker" onchange="selectSheet(this.value)" aria-label="Which sheet of the workbook to read" style="margin-left: 8px; padding: 4px 8px; border: 1px solid var(--border-slate); border-radius: 6px; background: var(--surface); color: var(--text-body);">${options}</select>
      <br>This workbook has ${sheets.length} sheets. “${escapeHtml(activeName)}” best matches the expected columns — switch if that is the wrong one.
    </div>`;
  el.classList.remove("hidden");
  return true;
}

function selectSheet(name) {
  const sheets = window._uploadedSheets || [];
  const sheet = sheets.find((s) => s.name === name);
  if (!sheet) return;

  window._uploadNote = window._uploadFileNote;
  renderSheetPicker(sheets, name);
  ingestRows(sheet.headers, sheet.rows);
}

// Parse CSV text into headers + row objects, then hand off to ingestRows
// (which owns column mapping and everything downstream — the xlsx path
// feeds ingestRows directly)
function parseCSV(csvText) {
  console.log("Parsing CSV data");
  const { headers, rows } = parseDelimitedText(csvText);
  ingestRows(headers, rows);
}

// ─── Sample datasets ─────────────────────────────────────────────────────────
// The one sample file is a clean eight rows: it shows the format and nothing
// else. It cannot show what a large run looks like, and it certainly cannot show
// what the tool does with a file that is WRONG — which is most real inventories.
// These load through the normal pipeline, so what they demonstrate is the actual
// behaviour rather than a description of it.

// Regions the page's own providers actually have, so a sample never arrives
// carrying a region column the page cannot resolve.
const SAMPLE_REGIONS = {
  aws: ["us-east-1", "us-west-2", "eu-west-1"],
  azure: ["East US", "West US 2", "North Europe"],
  gcp: ["us-central1-a", "us-west1-b", "europe-west1-c"],
};

function sampleRegionColumns() {
  return getPageProviders().map((provider) => ({
    header: InstanceSelectorFactory.getProviderRegionColumn(provider),
    values: SAMPLE_REGIONS[provider] || [""],
  }));
}

function buildSampleCsv(rows, { memoryHeader = "Memory (GB)" } = {}) {
  const regionCols = sampleRegionColumns();
  const headers = [
    "VM Name",
    "App Name",
    "CPU Count",
    memoryHeader,
    "CPU Utilization",
    "Memory Utilization",
    ...regionCols.map((c) => c.header),
    "ENV",
    "OS",
    "Workload",
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      r.app,
      r.cpu,
      r.memory,
      r.cpuUtil,
      r.memUtil,
      ...regionCols.map(
        (c) => r.region ?? c.values[r.regionIndex % c.values.length],
      ),
      r.env,
      r.os,
      r.workload,
    ].join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

const SAMPLE_DATASETS = [
  {
    id: "small",
    label: "Small & clean",
    blurb: "8 VMs, everything filled in. What a good file looks like.",
    build: () =>
      buildSampleCsv([
        {
          name: "web-01",
          app: "Storefront",
          cpu: 4,
          memory: 16,
          cpuUtil: 45,
          memUtil: 60,
          regionIndex: 0,
          env: "Production",
          os: "Linux",
          workload: "Web Server",
        },
        {
          name: "web-02",
          app: "Storefront",
          cpu: 4,
          memory: 16,
          cpuUtil: 38,
          memUtil: 55,
          regionIndex: 0,
          env: "Production",
          os: "Linux",
          workload: "Web Server",
        },
        {
          name: "db-01",
          app: "Billing",
          cpu: 8,
          memory: 64,
          cpuUtil: 72,
          memUtil: 81,
          regionIndex: 1,
          env: "Production",
          os: "Windows",
          workload: "Database",
        },
        {
          name: "db-02",
          app: "Billing",
          cpu: 8,
          memory: 64,
          cpuUtil: 30,
          memUtil: 40,
          regionIndex: 1,
          env: "Staging",
          os: "Windows",
          workload: "Database",
        },
        {
          name: "cache-01",
          app: "Storefront",
          cpu: 2,
          memory: 8,
          cpuUtil: 25,
          memUtil: 70,
          regionIndex: 0,
          env: "Production",
          os: "Linux",
          workload: "Cache",
        },
        {
          name: "batch-01",
          app: "Analytics",
          cpu: 16,
          memory: 32,
          cpuUtil: 88,
          memUtil: 45,
          regionIndex: 2,
          env: "Production",
          os: "Linux",
          workload: "General",
        },
        {
          name: "dev-01",
          app: "Analytics",
          cpu: 2,
          memory: 4,
          cpuUtil: 12,
          memUtil: 20,
          regionIndex: 2,
          env: "Dev",
          os: "Linux",
          workload: "General",
        },
        {
          name: "api-01",
          app: "Storefront",
          cpu: 4,
          memory: 8,
          cpuUtil: 65,
          memUtil: 52,
          regionIndex: 1,
          env: "Production",
          os: "Linux",
          workload: "Web Server",
        },
      ]),
  },
  {
    id: "large",
    label: "Large",
    blurb:
      "500 VMs. Shows the batch run, the progress bar, and a real preview.",
    build: () => {
      const apps = ["Storefront", "Billing", "Analytics", "Identity", "Search"];
      const workloads = ["Web Server", "Database", "Cache", "General", "ML/AI"];
      const envs = ["Production", "Staging", "Dev"];
      const rows = [];
      for (let i = 1; i <= 500; i++) {
        // Deterministic, not random: two people loading "Large" should be
        // looking at the same file.
        const cpu = [1, 2, 4, 8, 16, 32][i % 6];
        rows.push({
          name: `vm-${String(i).padStart(3, "0")}`,
          app: apps[i % apps.length],
          cpu,
          memory: cpu * [1, 2, 4][i % 3],
          cpuUtil: 10 + ((i * 7) % 80),
          memUtil: 15 + ((i * 11) % 75),
          regionIndex: i % 3,
          env: envs[i % envs.length],
          os: i % 4 === 0 ? "Windows" : "Linux",
          workload: workloads[i % workloads.length],
        });
      }
      return buildSampleCsv(rows);
    },
  },
  {
    id: "messy",
    label: "Deliberately messy",
    blurb:
      "Memory in MiB, a VM listed twice, a row with no CPU, an impossible utilization, a blank name, an unknown region. Shows what the input check catches.",
    build: () => {
      const known = sampleRegionColumns()[0].values[0];
      const rows = [
        // Every memory value is MiB under a header that does not say so — the
        // median is what makes the unit question fire at all.
        {
          name: "web-01",
          app: "Storefront",
          cpu: 4,
          memory: 16384,
          cpuUtil: 45,
          memUtil: 60,
          regionIndex: 0,
          env: "Production",
          os: "Linux",
          workload: "Web Server",
        },
        {
          name: "web-01",
          app: "Storefront",
          cpu: 4,
          memory: 16384,
          cpuUtil: 45,
          memUtil: 60,
          regionIndex: 1,
          env: "Production",
          os: "Linux",
          workload: "Web Server",
        },
        {
          name: "db-01",
          app: "Billing",
          cpu: 8,
          memory: 65536,
          cpuUtil: 72,
          memUtil: 81,
          regionIndex: 1,
          env: "Production",
          os: "Windows",
          workload: "Database",
        },
        {
          name: "no-cpu-01",
          app: "Billing",
          cpu: 0,
          memory: 32768,
          cpuUtil: 50,
          memUtil: 50,
          regionIndex: 0,
          env: "Production",
          os: "Linux",
          workload: "General",
        },
        {
          name: "over-01",
          app: "Analytics",
          cpu: 2,
          memory: 8192,
          cpuUtil: 140,
          memUtil: 60,
          regionIndex: 0,
          env: "Dev",
          os: "Linux",
          workload: "General",
        },
        {
          name: "",
          app: "Analytics",
          cpu: 2,
          memory: 8192,
          cpuUtil: 30,
          memUtil: 40,
          regionIndex: 2,
          env: "Dev",
          os: "Linux",
          workload: "General",
        },
        {
          name: "lost-01",
          app: "Search",
          cpu: 4,
          memory: 16384,
          cpuUtil: 55,
          memUtil: 65,
          region: `${known}-99`,
          env: "Production",
          os: "Linux",
          workload: "General",
        },
      ];
      return buildSampleCsv(rows, { memoryHeader: "Memory" });
    },
  },
];

function renderSampleGallery() {
  const el = document.getElementById("sampleGallery");
  if (!el) return;

  const cards = SAMPLE_DATASETS.map(
    (dataset, index) => `
      <li style="margin-bottom: 8px;">
        <button onclick="loadSampleDataset(${index})" class="btn btn-secondary" style="font-size: 13px; padding: 6px 14px;">▶️ Load ${escapeHtml(dataset.label)}</button>
        <span style="margin-left: 8px; font-size: 13px; color: var(--text-muted);">${escapeHtml(dataset.blurb)}</span>
      </li>`,
  ).join("");

  el.innerHTML = `
    <div style="margin-top: 14px;">
      <strong style="font-size: 14px;">Or try one of these</strong>
      <ul style="margin: 8px 0 0 0; padding: 0; list-style: none;">${cards}</ul>
    </div>`;
}

// Loaded through parseCSV, exactly as an upload is — so the messy one really
// does trip the input check, rather than being described as though it would.
function loadSampleDataset(index) {
  const dataset = SAMPLE_DATASETS[index];
  if (!dataset) return;

  resetIngestState();
  window._ingestLabel = `Sample loaded (${dataset.label})`;

  const fileInput = document.getElementById("csvFile");
  if (fileInput) fileInput.value = "";

  parseCSV(dataset.build());
  showToast(`Loaded the “${dataset.label}” sample`, "success");
}

// ─── Paste ───────────────────────────────────────────────────────────────────
// Not everyone has a file. A few dozen rows selected in Excel and copied is the
// shortest path from an inventory to an answer, and it goes through exactly the
// same pipeline as an upload — the same mapping, hygiene check, and region
// validation — because a second route into the data is a second route to get it
// wrong.

function renderPasteControl() {
  const el = document.getElementById("pasteDataSection");
  if (!el) return;
  el.innerHTML = `
    <button type="button" class="btn btn-secondary" onclick="togglePastePanel()" style="font-size: 13px; padding: 8px 16px;">📋 Or paste rows from a spreadsheet</button>
    <div id="pastePanel" class="hidden" style="margin-top: 10px;">
      <label for="pasteInput" style="display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-muted);">
        Copy the rows from Excel, Google Sheets, or a CSV — <strong>including the header row</strong> — and paste them here.
      </label>
      <textarea id="pasteInput" rows="8" aria-label="Paste inventory rows, including the header row"
        placeholder="VM Name&#9;CPU Count&#9;Memory (GB)&#10;web-01&#9;4&#9;16"
        style="width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px; padding: 8px; border: 1px solid var(--border-slate); border-radius: 6px; background: var(--surface); color: var(--text-body);"></textarea>
      <div style="margin-top: 8px;">
        <button type="button" class="btn btn-primary" onclick="ingestPastedData()" style="font-size: 13px; padding: 8px 16px;">Use this data</button>
        <button type="button" class="btn btn-secondary" onclick="togglePastePanel()" style="font-size: 13px; padding: 8px 16px; margin-left: 8px;">Cancel</button>
      </div>
    </div>`;
}

function togglePastePanel() {
  const panel = document.getElementById("pastePanel");
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (opening) {
    const input = document.getElementById("pasteInput");
    if (input) input.focus();
  }
}

function ingestPastedData() {
  const input = document.getElementById("pasteInput");
  const text = input ? input.value : "";

  if (!text.trim()) {
    showToast("Paste some rows first — including the header row", "warning");
    return;
  }

  const { headers, rows } = parseDelimitedText(text);
  if (!rows.length) {
    // A header with nothing under it is the classic paste mistake: the header
    // row was selected and the data was not.
    showToast(
      "That looks like a header row with no data under it — copy the rows too",
      "warning",
    );
    return;
  }

  resetIngestState();
  window._ingestLabel = "Pasted data loaded";

  // A file name left in the picker would now be describing data that is not on
  // screen. Clearing it also lets the same file be re-selected afterwards.
  const fileInput = document.getElementById("csvFile");
  if (fileInput) fileInput.value = "";

  ingestRows(headers, rows);
  togglePastePanel();
}

// ─── Column mapping ───────────────────────────────────────────────────────────
function normalizeHeader(header) {
  return String(header)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// The separator is shared, not assumed. The saved-mapping manager counts a
// signature's columns by splitting it back apart, and a header containing this
// character would miscount — but so would changing the join here and leaving the
// split behind, which is the failure that is easy to miss.
const SIGNATURE_SEPARATOR = "|";

function headerSignature(headers) {
  return headers
    .map((h) => String(h).trim().toLowerCase())
    .sort()
    .join(SIGNATURE_SEPARATOR);
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

// ─── Import presets ──────────────────────────────────────────────────────────
// Exports from the tools people actually inventory with. A preset exists only to
// settle what the generic matcher cannot, and to name units a header hides.
//
// RVTools' vInfo sheet ships both "VM" (the guest) and "Host" (the ESXi box it
// runs on), and both are VM-name synonyms — so the matcher finds two candidates
// and stops to ask, on every RVTools file ever exported. The preset says which
// one is the VM. (Before "vm" was a synonym at all it was worse than a stall:
// only "Host" matched, so every guest on a hypervisor silently took that
// hypervisor's name, and nothing anywhere said so.)
//
// `detect` must key on headers only that tool ships, so a preset never claims a
// file it has not recognised, and it names as few columns as possible: anything
// it stays silent about goes through the normal matcher and synonym table.
// Keys are normalized (normalizeHeader), so casing and spacing do not matter.
const IMPORT_PRESETS = [
  {
    name: "RVTools",
    // A preset that claims a file it does not recognise is worse than no preset:
    // this one divides memory by 1024, so a false positive corrupts every row.
    // "VM", "Powerstate" and "CPUs" alone are not enough — any hand-rolled
    // vSphere export could have those, with memory already in GB. RVTools' own
    // MiB-suffixed sizing columns are the distinguishing mark, and they are also
    // the evidence for the MiB convention this preset relies on: a file that
    // reports provisioned storage in MiB reports memory in MiB too.
    detect: (norm) =>
      norm.has("vm") &&
      norm.has("powerstate") &&
      norm.has("cpus") &&
      ["provisionedmib", "inusemib", "provisionedmb", "inusemb"].some((h) =>
        norm.has(h),
      ),
    columns: {
      vm: COLUMN_MAPPINGS.vmName, // not "Host" (the ESXi host) or "DNS Name"
      cpus: COLUMN_MAPPINGS.cpu,
      memory: COLUMN_MAPPINGS.memory,
    },
    // vInfo's "Memory" is MiB, and says so nowhere in the header
    memoryUnit: "MB",
  },
  {
    name: "AWS Application Discovery Service",
    // ADS namespaces its columns ("CPU.NumberOfLogicalCores", "RAM.TotalSizeInMB",
    // "CPU.UsagePct.Avg"). Nothing else writes headers shaped like that, and the
    // generic matcher recognises NONE of them — an ADS file otherwise stops at
    // the mapping panel every single time, with both required columns unmatched.
    detect: (norm) =>
      norm.has("cpunumberoflogicalcores") &&
      norm.has("ramtotalsizeinmb") &&
      norm.has("cpuusagepctavg"),
    columns: {
      // Logical cores, not sockets ("NumberOfProcessors") and not physical cores
      // ("NumberOfCores"): a cloud vCPU corresponds to what the guest OS sees,
      // which is the logical count. The other two are still offered in the panel
      // if a particular fleet needs them.
      cpunumberoflogicalcores: COLUMN_MAPPINGS.cpu,
      ramtotalsizeinmb: COLUMN_MAPPINGS.memory,
      cpuusagepctavg: COLUMN_MAPPINGS.cpuUtilization,
      // "HostName" already maps on its own, but naming it here keeps the VM name
      // from drifting to some other column as the synonym table grows.
      hostname: COLUMN_MAPPINGS.vmName,
    },
    memoryUnit: "MB",
    derive: {
      // ADS reports memory USED, in megabytes. The optimizer needs a percentage,
      // and (used ÷ total) × 100 is that percentage. Without this an ADS file
      // could only ever be CPU-optimized: memory would be left at its current
      // size for every VM in the fleet, silently forgoing most of the saving.
      //
      // The source columns are found by NORMALIZED name, like everything else in
      // this file. Reading them as literal strings would mean that an export
      // varying only in case or punctuation — while still being detected as ADS —
      // yielded NaN, and the derivation would return "" for every row: no error,
      // no failing test, and memory-based right-sizing quietly switched off for
      // the whole fleet. That is precisely the failure this preset exists to
      // prevent, so it must not be reintroduced by the fix for it.
      [COLUMN_MAPPINGS.memoryUtilization]: (row, headers) => {
        const column = (normalized) =>
          headers.find((h) => normalizeHeader(h) === normalized);

        const total = parseFloat(row[column("ramtotalsizeinmb")]);
        const used = parseFloat(row[column("ramusedsizeinmbavg")]);
        if (!isFinite(total) || total <= 0 || !isFinite(used) || used < 0) {
          return ""; // absent, not zero — a zero would read as "0% used"
        }
        return String(Math.round((used / total) * 1000) / 10);
      },
    },
  },
];

// A preset may DERIVE a canonical column the format does not carry directly.
// Derived columns are added as ordinary columns before the mapping runs, so
// everything downstream — the panel, the engine, the exports — sees them as if
// the file had always had them.
//
// A column the file already provides is never overwritten: the user's own data
// outranks anything computed from it.
function applyPresetDerivations(headers, rows, preset) {
  if (!preset || !preset.derive) return { headers, rows };

  const derivations = Object.entries(preset.derive).filter(
    ([canonical]) => !headers.includes(canonical),
  );
  if (!derivations.length) return { headers, rows };

  return {
    headers: [...headers, ...derivations.map(([canonical]) => canonical)],
    rows: rows.map((row) => {
      const derived = { ...row };
      for (const [canonical, compute] of derivations) {
        // The file's own headers are passed in so a derivation can find its
        // source columns by normalized name rather than by literal string.
        derived[canonical] = compute(row, headers);
      }
      return derived;
    }),
  };
}

function detectImportPreset(headers) {
  const norm = new Set(headers.map(normalizeHeader));
  return IMPORT_PRESETS.find((preset) => preset.detect(norm)) || null;
}

// Matches uploaded headers to the canonical COLUMN_MAPPINGS names.
// Per canonical, candidates come from: exact (case-insensitive) → normalized
// equality → synonym table. A bare "Region" column counts as the page's
// provider region on single-provider pages only. Only CPU Count and Memory
// (GB) are required; the rest (VM Name, App Name, region cols) are optional.
// Returns { mapping (source→canonical), renames, unmatchedRequired,
// ambiguous, needsReview }.
function autoMatchHeaders(headers, preset = detectImportPreset(headers)) {
  const canonicals = pageCanonicals();
  const required = REQUIRED_CANONICALS;
  const providers = getPageProviders();
  const claimed = new Set();
  const mapping = {};
  const ambiguous = [];
  const unmatchedRequired = [];

  // A preset's columns are settled before the matcher runs, and the headers it
  // took are claimed — that is what stops RVTools' "Host" from competing for
  // VM Name once "VM" has it.
  if (preset) {
    for (const [normSource, canonical] of Object.entries(preset.columns)) {
      const header = headers.find((h) => normalizeHeader(h) === normSource);
      if (header) {
        mapping[header] = canonical;
        claimed.add(header);
      }
    }
  }

  for (const canonical of canonicals) {
    if (Object.values(mapping).includes(canonical)) continue;
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
    preset,
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

// Above this, a memory figure starts to look more like MiB than GB. It is NOT a
// licence to convert: a real fleet of 512 GB–1 TB machines exists, and dividing
// it by 1024 would be the same class of silent corruption as leaving RVTools'
// MiB alone. So this only ever raises the question — see reportInputHygiene.
// The median (not the max, not the mean) keeps one genuine outlier from
// speaking for the file.
const MEMORY_LOOKS_LIKE_MB = 1024;

function medianMemory(rows, column) {
  const values = rows
    .map((row) => parseFloat(row[column]))
    .filter((v) => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  return values[Math.floor(values.length / 2)];
}

// Memory unit detection for a mapping: an MB source is converted to GB on
// ingest. Only EXPLICIT evidence counts here — a header that says MB, or an
// import preset that knows the format's convention. The values alone are never
// enough to convert on: they are enough to ask, and asking is what the input
// check does.
function detectMemoryUnit(mapping) {
  const source = Object.keys(mapping).find(
    (s) => mapping[s] === COLUMN_MAPPINGS.memory,
  );
  if (!source) return {};
  return isMbHeader(source) ? { [COLUMN_MAPPINGS.memory]: "MB" } : {};
}

// Saved mappings: { headerSignature: { v: 2, mapping: {source: canonical},
// units: {canonical: "MB"|"GB"} } }.
//
// A saved mapping short-circuits everything downstream — the preset, the synonym
// table, the unit inference — because the user already answered for these exact
// headers. That makes an entry saved by an OLDER version actively dangerous: one
// written before 3.7 could name `Host` (the hypervisor) as the VM, or record no
// unit for a MiB column, and it would keep reapplying that answer forever, past
// the very fixes meant to prevent it. So entries are versioned, and anything
// older is dropped rather than trusted: the file simply asks again, and now gets
// the right answer. Units are recorded explicitly, GB included, so "no unit
// recorded" can never again be mistaken for "GB".
const SAVED_MAPPING_VERSION = 2;

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
  if (!entry || entry.v !== SAVED_MAPPING_VERSION || !entry.mapping)
    return null;
  return { mapping: entry.mapping, units: entry.units || {} };
}

function saveColumnMapping(signature, mapping, units) {
  const recorded = { ...(units || {}) };
  // Record the unit even when it is the default. An absent unit is ambiguous —
  // it could mean "GB" or "nobody ever decided" — and that ambiguity is what let
  // a MiB column be reapplied as GB.
  if (Object.values(mapping).includes(COLUMN_MAPPINGS.memory)) {
    recorded[COLUMN_MAPPINGS.memory] =
      recorded[COLUMN_MAPPINGS.memory] === "MB" ? "MB" : "GB";
  }

  const all = loadColumnMappings();
  all[signature] = { v: SAVED_MAPPING_VERSION, mapping, units: recorded };
  writeColumnMappings(all);
  renderSavedMappings();
}

function writeColumnMappings(all) {
  try {
    localStorage.setItem(
      "cloudInstanceRecommenderColumnMaps",
      JSON.stringify(all),
    );
    return true;
  } catch (e) {
    console.warn("Could not persist column mappings:", e);
    return false;
  }
}

// ─── Saved-mapping manager ───────────────────────────────────────────────────
// Confirming the mapping panel once saves that answer against the file's header
// signature, and every later file with the same headers is mapped that way
// without asking again. That is the point — but it also means a mistake made
// once is repeated silently forever, and until now there was nowhere to see it,
// let alone undo it. Show what is remembered, and allow forgetting it.

// Entries written by an older version are ignored on ingest (see
// readSavedMapping), so they must be ignored here too — counting them in the
// heading while rendering nothing for them would show "3 remembered" above a
// list of one. Dropping them from storage as well means they stop being counted
// by anything, ever, rather than lingering as invisible dead weight.
function pruneLegacySavedMappings() {
  const all = loadColumnMappings();
  const live = {};
  let dropped = 0;
  for (const [signature, entry] of Object.entries(all)) {
    if (readSavedMapping(entry)) live[signature] = entry;
    else dropped++;
  }
  if (dropped) writeColumnMappings(live);
  return live;
}

function renderSavedMappings() {
  const el = document.getElementById("savedMappingsSection");
  if (!el) return;

  const all = pruneLegacySavedMappings();
  const signatures = Object.keys(all);

  if (!signatures.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }

  // The signature is built from the file's own headers, so it is attacker-
  // controlled text. It must never be interpolated into an inline handler:
  // escapeHtml turns a quote into &quot;, which the HTML parser decodes back to
  // a quote INSIDE the onclick attribute, closing the string and running
  // whatever follows. Hand the handler an index instead — an integer we
  // generated — and look the signature up here.
  window._savedMappingSignatures = signatures;

  const entries = signatures
    .map((signature, index) => {
      const saved = readSavedMapping(all[signature]);
      if (!saved) return "";

      // The signature is a sorted, lowercased join of the headers — fine as a
      // key, unreadable as a label. Show the renames, which is what the user
      // actually agreed to; a mapping that renamed nothing is shown as such
      // rather than as an empty row.
      const renames = Object.entries(saved.mapping)
        .filter(([source, canonical]) => source !== canonical)
        .map(
          ([source, canonical]) =>
            `${escapeHtml(source)} → ${escapeHtml(canonical)}`,
        );
      const unit = saved.units && saved.units[COLUMN_MAPPINGS.memory];
      const unitNote = unit === "MB" ? " · memory read as MB" : "";
      const columnCount = signature.split(SIGNATURE_SEPARATOR).length;

      return `
        <li style="margin-bottom: 8px;">
          <div style="font-size: 13px;">
            <strong>${columnCount} columns</strong>${escapeHtml(unitNote)}<br>
            <span style="color: var(--text-muted);">${
              renames.length
                ? renames.join(", ")
                : "no columns renamed — the headers already matched"
            }</span>
          </div>
          <button onclick="forgetColumnMapping(${index})"
            title="Forget this mapping — the next file with these headers will ask again"
            style="margin-top: 4px; padding: 2px 10px; font-size: 12px; border: 1px solid var(--border-slate); border-radius: 6px; background: var(--surface-alt); color: var(--text-body); cursor: pointer;">🗑️ Forget</button>
        </li>`;
    })
    .join("");

  el.className = "alert alert-info";
  el.innerHTML = `
    <strong>💾 Remembered column mappings (${signatures.length})</strong><br>
    <span style="font-size: 13px; color: var(--text-muted);">A file whose headers match one of these is mapped this way without asking.</span>
    <ul style="margin: 8px 0 0 18px; list-style: none; padding: 0;">${entries}</ul>
    <button onclick="forgetAllColumnMappings()" style="margin-top: 4px; padding: 2px 10px; font-size: 12px; border: 1px solid var(--border-slate); border-radius: 6px; background: var(--surface-alt); color: var(--text-body); cursor: pointer;">Forget all</button>`;
  el.classList.remove("hidden");
}

// Takes the INDEX rendered into the button, not the signature itself — see
// renderSavedMappings. The signature never crosses into markup.
function forgetColumnMapping(index) {
  const signature = (window._savedMappingSignatures || [])[index];
  if (signature === undefined) return;

  const all = loadColumnMappings();
  if (!(signature in all)) return;
  delete all[signature];

  if (!writeColumnMappings(all)) {
    showToast(
      "Could not update saved mappings — storage is unavailable",
      "warning",
    );
    return;
  }
  showToast(
    "Mapping forgotten — a file with those headers will ask again",
    "success",
  );
  renderSavedMappings();
}

function forgetAllColumnMappings() {
  if (!writeColumnMappings({})) {
    showToast(
      "Could not clear saved mappings — storage is unavailable",
      "warning",
    );
    return;
  }
  showToast("All remembered column mappings cleared", "success");
  renderSavedMappings();
}

// Entry point for parsed uploads (CSV and, later, xlsx). Applies column
// mapping silently when unambiguous; otherwise defers the whole pipeline
// (csvData stays empty) until the user confirms in the mapping panel.
function ingestRows(headers, rows) {
  console.log(`Parsed ${rows.length} rows with ${headers.length} columns`);

  // The signature identifies the FILE, so it is taken from the headers the file
  // actually has — before anything is derived. Sign the derived headers instead
  // and you save a mapping under a key no later upload of that same file can
  // produce: saved, and never replayed.
  //
  // Kept on the window because every path that SAVES a mapping needs it, and the
  // edit path rebuilds _pendingIngest from _lastIngest, whose headers are already
  // post-derivation.
  const signature = headerSignature(headers);
  window._fileSignature = signature;

  const preset = detectImportPreset(headers);

  // A recognised format may carry a canonical column only implicitly: ADS reports
  // memory used in megabytes, and the optimizer needs the percentage that is.
  // Derive it BEFORE anything else looks at these rows — the matcher, the panel,
  // the engine and the exports must all see the column as though the file had
  // always had it. Doing this after the match left the match ignorant of a column
  // that was about to exist, and doing it after the saved-mapping branch skipped
  // it altogether for any file the user had already answered for.
  ({ headers, rows } = applyPresetDerivations(headers, rows, preset));

  // A mapping the user previously confirmed for this exact file wins
  const saved = readSavedMapping(loadColumnMappings()[signature]);
  if (saved && Object.keys(saved.mapping).every((s) => headers.includes(s))) {
    console.log("Applying saved column mapping");
    applyIngest(headers, rows, saved.mapping, saved.units);
    return;
  }

  const match = autoMatchHeaders(headers, preset);

  if (match.needsReview) {
    csvData = [];
    columnHeaders = [];
    window._pendingIngest = { headers, rows, match, signature };
    showColumnMappingPanel(headers, match);
    return;
  }

  if (match.preset) {
    // Say so. A file that was silently reinterpreted is the thing the user goes
    // looking for later when a number seems wrong.
    const presetNote = `Recognised as a ${match.preset.name} export`;
    window._uploadNote = window._uploadNote
      ? `${window._uploadNote}. ${presetNote}`
      : presetNote;
  }

  applyIngest(
    headers,
    rows,
    match.mapping,
    presetUnits(match.preset, match.mapping) || detectMemoryUnit(match.mapping),
  );
}

// A preset knows its own units; nothing needs to be inferred from a file whose
// format we have already identified.
function presetUnits(preset, mapping) {
  if (!preset || !preset.memoryUnit) return null;
  const hasMemory = Object.values(mapping).includes(COLUMN_MAPPINGS.memory);
  return hasMemory ? { [COLUMN_MAPPINGS.memory]: preset.memoryUnit } : null;
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
  // Bumped on every ingest, from any route. Results carry the token they ran
  // against, so replacing the data under an existing set of results is visible
  // even when the new data has the same shape as the old.
  window._ingestToken = (window._ingestToken || 0) + 1;
  // A dismissal belongs to the file it was made about: answering "different VMs"
  // or "these really are GB" for one upload must not silence the question for
  // the next.
  window._duplicatesAcknowledged = false;
  window._memoryUnitAcknowledged = false;
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

  // Say what is wrong with the input before it is used, not after
  reportInputHygiene();

  // Check region names against the manifests, then start loading the region
  // data this CSV needs in the background (skipping unknown regions)
  validateCsvRegions();
  prefetchCsvRegions();

  // If the file groups VMs by application but has no per-row Workload, offer
  // the app→workload mapping panel so those VMs can inherit a workload.
  maybeShowAppMappingPanel();

  // Any results still on screen were generated from the data this just replaced.
  // They are not cleared — the user may want to look at them — but they must not
  // go on presenting themselves as describing what is now loaded.
  updateStaleResultsNotice();
}

// ─── Input hygiene ───────────────────────────────────────────────────────────
// A bad row does not announce itself. A VM with no CPU count still gets a
// recommendation, a VM listed twice is sized twice and counted twice in the
// totals, and both come back looking as reasonable as everything else. So say
// what is wrong with the input, with the row numbers, before the run — the
// alternative is a report that is quietly wrong and gets forwarded.

// Row numbers as a spreadsheet shows them: the header is row 1, so the first
// data row is row 2. Anything else sends the user hunting in the wrong place.
const dataRowNumber = (index) => index + 2;

// Not "unusual" — impossible. These sit far above the largest instance any of
// the three providers offers, so a row beyond them is a data-entry error (or a
// unit that was never converted), not a very large machine.
const IMPLAUSIBLE_CPU = 512;
const IMPLAUSIBLE_MEMORY_GB = 24576; // 24 TB

function analyzeInputHygiene(rows) {
  const CPU = COLUMN_MAPPINGS.cpu;
  const MEM = COLUMN_MAPPINGS.memory;
  const NAME = COLUMN_MAPPINGS.vmName;

  const present = (col) =>
    rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], col);

  // Row numbers whose value in `col` satisfies `test(numeric, raw)`
  const rowsWhere = (col, test) =>
    rows.reduce((hits, row, i) => {
      if (test(parseFloat(row[col]), String(row[col] ?? "").trim()))
        hits.push(dataRowNumber(i));
      return hits;
    }, []);

  const issues = [];
  const note = (severity, label, rowNumbers) => {
    if (rowNumbers.length) issues.push({ severity, label, rowNumbers });
  };

  if (present(CPU)) {
    note(
      "error",
      "CPU count is missing or zero",
      rowsWhere(CPU, (v) => isNaN(v) || v <= 0),
    );
    note(
      "error",
      `CPU count above ${IMPLAUSIBLE_CPU}`,
      rowsWhere(CPU, (v) => v > IMPLAUSIBLE_CPU),
    );
    note(
      "warning",
      "CPU count is not a whole number",
      rowsWhere(CPU, (v) => !isNaN(v) && v > 0 && !Number.isInteger(v)),
    );
  }
  if (present(MEM)) {
    note(
      "error",
      "Memory is missing or zero",
      rowsWhere(MEM, (v) => isNaN(v) || v <= 0),
    );
    note(
      "error",
      `Memory above ${IMPLAUSIBLE_MEMORY_GB} GB — check the unit`,
      rowsWhere(MEM, (v) => v > IMPLAUSIBLE_MEMORY_GB),
    );
  }
  for (const [col, label] of [
    [COLUMN_MAPPINGS.cpuUtilization, "CPU utilization"],
    [COLUMN_MAPPINGS.memoryUtilization, "Memory utilization"],
  ]) {
    if (present(col)) {
      note(
        "warning",
        `${label} outside 0–100%`,
        rowsWhere(col, (v) => !isNaN(v) && (v < 0 || v > 100)),
      );
    }
  }
  if (present(NAME)) {
    note(
      "warning",
      "VM name is blank",
      rowsWhere(NAME, (_v, raw) => raw === ""),
    );
  }

  // Duplicates are a question, not a defect: the same name twice may be one VM
  // exported twice, or two VMs that genuinely share a name across clusters.
  // Only the user knows, so ask instead of picking.
  const duplicates = [];
  if (present(NAME)) {
    const byName = new Map();
    rows.forEach((row, i) => {
      const key = String(row[NAME] ?? "")
        .trim()
        .toLowerCase();
      if (!key) return;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(dataRowNumber(i));
    });
    for (const rowNumbers of byName.values()) {
      if (rowNumbers.length > 1) {
        duplicates.push({
          name: String(rows[rowNumbers[0] - 2][NAME]).trim(),
          rowNumbers,
        });
      }
    }
  }

  // Not a defect, and NOT something to act on unasked: a fleet of 512 GB–1 TB
  // machines is real, and dividing it by 1024 would corrupt it exactly as surely
  // as leaving a MiB column alone. Only the user knows which they have.
  const memoryUnit =
    present(MEM) && (medianMemory(rows, MEM) || 0) >= MEMORY_LOOKS_LIKE_MB
      ? { median: medianMemory(rows, MEM) }
      : null;

  return { issues, duplicates, memoryUnit };
}

// The user confirmed the values are MiB. Re-derive from the untouched source
// rows with the unit set, rather than dividing csvData in place — that way the
// mapping, the region chips and everything else downstream are rebuilt from one
// path, and the recorded unit survives a later edit of the mapping.
function convertMemoryToGb() {
  const last = window._lastIngest;
  if (!last) return;

  // applyIngest clears the per-file acknowledgements, because it is normally the
  // arrival of a NEW file. This is not that: it is a remediation of the file
  // already loaded. Dividing a memory column by 1024 cannot change which VM
  // names repeat, so an answer already given to the duplicate question still
  // holds — and re-asking it would look like the answer had not registered.
  //
  // Re-mapping columns is different and correctly does reset it: choosing a
  // different column as the VM name genuinely changes which rows are duplicates.
  const duplicatesAnswered = window._duplicatesAcknowledged;

  applyIngest(last.headers, last.rows, last.mapping, {
    ...(last.units || {}),
    [COLUMN_MAPPINGS.memory]: "MB",
  });

  window._duplicatesAcknowledged = duplicatesAnswered;
  reportInputHygiene();
  showToast("Memory values converted from MB to GB", "success");
}

function keepMemoryAsGb() {
  window._memoryUnitAcknowledged = true;
  reportInputHygiene();
  showToast("Leaving memory values as GB", "info");
}

// At most a handful of row numbers inline — a list of four hundred is not a
// message, it is a wall, and the user cannot act on it either way.
function formatRowNumbers(rowNumbers, limit = 8) {
  const shown = rowNumbers.slice(0, limit).join(", ");
  const rest = rowNumbers.length - limit;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

function reportInputHygiene() {
  const el = document.getElementById("inputHygieneSection");
  if (!el) return;

  const report = analyzeInputHygiene(csvData);
  // The report is recomputed from the data every time, so a dismissal has to
  // live outside it — clearing the list in place would just be regenerated.
  if (window._duplicatesAcknowledged) report.duplicates = [];
  if (window._memoryUnitAcknowledged) report.memoryUnit = null;
  window._inputHygiene = report;

  if (
    !report.issues.length &&
    !report.duplicates.length &&
    !report.memoryUnit
  ) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }

  const errors = report.issues.filter((i) => i.severity === "error");
  const lines = report.issues
    .map(
      (i) =>
        `<li>${i.severity === "error" ? "❌" : "⚠️"} ${escapeHtml(i.label)} — ${
          i.rowNumbers.length
        } row${i.rowNumbers.length === 1 ? "" : "s"} (${escapeHtml(
          formatRowNumbers(i.rowNumbers),
        )})</li>`,
    )
    .join("");

  let dupBlock = "";
  if (report.duplicates.length) {
    const total = report.duplicates.reduce(
      (n, d) => n + d.rowNumbers.length - 1,
      0,
    );
    const examples = report.duplicates
      .slice(0, 5)
      .map(
        (d) =>
          `<li>“${escapeHtml(d.name)}” — rows ${escapeHtml(formatRowNumbers(d.rowNumbers))}</li>`,
      )
      .join("");
    const more =
      report.duplicates.length > 5
        ? `<li>…and ${report.duplicates.length - 5} more repeated names</li>`
        : "";
    dupBlock = `
      <p style="margin-top: 10px;"><strong>🔁 ${report.duplicates.length} VM name${
        report.duplicates.length === 1 ? " is" : "s are"
      } used more than once</strong> (${total} extra row${total === 1 ? "" : "s"}).
      Are these the same VM listed twice, or different VMs that share a name?</p>
      <ul style="margin: 6px 0 10px 18px;">${examples}${more}</ul>
      <button onclick="mergeDuplicateVmNames()" title="Keep the first row for each repeated name and drop the rest">🔗 Same VM — keep the first of each</button>
      <button onclick="keepDuplicateVmNames()" title="Leave every row in place" style="margin-left: 8px;">↔️ Different VMs — keep them all</button>`;
  }

  let unitBlock = "";
  if (report.memoryUnit) {
    const median = report.memoryUnit.median;
    unitBlock = `
      <p style="margin-top: 10px;"><strong>📐 Is the memory column in MB?</strong>
      The typical VM here reports ${escapeHtml(String(median))}, which is a lot of gigabytes
      but an ordinary number of mebibytes. Some inventory tools report memory in MiB without
      saying so in the header. If yours does, convert; if these really are ${escapeHtml(String(median))} GB
      machines, leave them.</p>
      <button onclick="convertMemoryToGb()" title="Divide the memory column by 1024">📐 They are MB — convert to GB</button>
      <button onclick="keepMemoryAsGb()" title="Leave the memory values exactly as they are" style="margin-left: 8px;">✔️ They are GB — leave them</button>`;
  }

  el.className = `alert alert-${errors.length ? "warning" : "info"}`;
  el.innerHTML = `
    <strong>🩺 Input check</strong> — ${
      lines
        ? "the file loaded, but some rows look wrong."
        : "the file loaded. One thing is worth confirming."
    }
    ${errors.length ? "Rows with a ❌ will not size sensibly." : ""}
    ${lines ? `<ul style="margin: 6px 0 0 18px;">${lines}</ul>` : ""}
    ${unitBlock}
    ${dupBlock}`;
  el.classList.remove("hidden");
}

// Same VM listed twice: keep the first occurrence of each name.
//
// csvData and _lastIngest.rows are parallel — the former is the latter with the
// column mapping applied — so both must be pruned, by the same indexes. Pruning
// only csvData left the source rows intact, and anything that re-derives from
// them (editing the mapping, converting a unit) resurrected every duplicate.
function mergeDuplicateVmNames() {
  const NAME = COLUMN_MAPPINGS.vmName;
  const seen = new Set();
  const keep = [];

  csvData.forEach((row, index) => {
    const key = String(row[NAME] ?? "")
      .trim()
      .toLowerCase();
    if (!key) {
      keep.push(index); // blank names are reported separately, not merged
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    keep.push(index);
  });

  const removed = csvData.length - keep.length;
  if (!removed) return;

  const kept = new Set(keep);
  csvData = csvData.filter((_row, index) => kept.has(index));
  if (window._lastIngest && Array.isArray(window._lastIngest.rows)) {
    window._lastIngest.rows = window._lastIngest.rows.filter((_row, index) =>
      kept.has(index),
    );
  }

  showToast(
    `Removed ${removed} duplicate row${removed === 1 ? "" : "s"}`,
    "success",
  );

  // The rows changed, so everything derived from them has to be redone — the
  // region chips and the app→workload panel described the old set.
  showFileStatistics();
  reportInputHygiene();
  validateCsvRegions();
  maybeShowAppMappingPanel();
  updateStaleResultsNotice();
}

// Different VMs that share a name: leave the rows alone, and stop asking.
function keepDuplicateVmNames() {
  window._duplicatesAcknowledged = true;
  reportInputHygiene();
  showToast("Keeping every row — repeated names left as they are", "info");
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

  // Memory unit prefill, in order of authority: units already applied (edit
  // mode), then the recognised format, then the header name.
  //
  // The preset must be consulted HERE, not only on the silent path. A recognised
  // RVTools file can still need review — some other column is ambiguous — and it
  // then arrives at this panel, where the header alone says "Memory" and means
  // GB. Prefilling GB for a file we have already identified as MiB invites the
  // user to confirm a 1024x error, with only the median-based hygiene question
  // left to catch it.
  const memUnit =
    (match.units ||
      presetUnits(match.preset, match.mapping) ||
      detectMemoryUnit(match.mapping))[COLUMN_MAPPINGS.memory] === "MB"
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
      showToast(
        `Column "${source}" is assigned to more than one field. Each column can map to only one field.`,
        "warning",
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
    showToast(
      `Please assign a column for: ${missingRequired.join(", ")}`,
      "warning",
    );
    return;
  }

  // Memory unit: explicit dropdown choice wins; auto-detect otherwise
  const units = {};
  if (Object.values(mapping).includes(COLUMN_MAPPINGS.memory)) {
    const unitSelect = document.getElementById("colmap_unit_mem");
    if (unitSelect && unitSelect.value === "MB") {
      units[COLUMN_MAPPINGS.memory] = "MB";
    } else if (!unitSelect || !unitSelect.value) {
      // No dropdown to speak for the user (a page without the panel): fall back
      // to the recognised format before the header name, for the same reason the
      // prefill does.
      const preset = pending.match && pending.match.preset;
      Object.assign(
        units,
        presetUnits(preset, mapping) || detectMemoryUnit(mapping),
      );
    }
  }

  // The signature of the FILE, captured before any derived column was added.
  // Signing pending.headers would include the derived column and produce a key
  // that no later upload of the same file could ever match — the mapping would be
  // saved and never replayed.
  saveColumnMapping(
    pending.signature ||
      window._fileSignature ||
      headerSignature(pending.headers),
    mapping,
    units,
  );
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
function parseCSVLine(line, delimiter = ",") {
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
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// Copying cells out of Excel or Google Sheets gives tab-separated text; copying
// out of a CSV gives commas. Let the header line decide — whichever character
// actually divides it is the delimiter. A single-column file has neither, and
// falls to the comma, which splits it into the one column it has.
//
// Only delimiters OUTSIDE quotes are counted. A header like
//   "VM, display name"<TAB>CPU Count
// has one comma and one tab, and counting naively would call it comma-separated
// and shred every row in the file — but the comma is inside a quoted cell and
// divides nothing.
function sniffDelimiter(headerLine) {
  let tabs = 0;
  let commas = 0;
  let inQuotes = false;

  for (let i = 0; i < headerLine.length; i++) {
    const char = headerLine[i];
    if (char === '"') {
      // A doubled quote is an escaped literal, not a boundary
      if (inQuotes && headerLine[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === "\t") tabs++;
      else if (char === ",") commas++;
    }
  }
  return tabs > commas ? "\t" : ",";
}

// Text (a file's contents, or a paste) → { headers, rows }. The one place that
// turns delimited text into rows; both the upload and the paste path use it, so
// they cannot drift apart in how they read a quoted field.
function parseDelimitedText(text) {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };

  const delimiter = sniffDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      // Same normalization as the workbook path: a CSV exported from a
      // spreadsheet carries the same "16,384" cells, quoted.
      row[header] = normalizeCellValue(values[index]);
    });
    return row;
  });
  return { headers, rows };
}

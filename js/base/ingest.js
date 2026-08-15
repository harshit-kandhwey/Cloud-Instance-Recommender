// Ingestion: file upload (CSV/xlsx), parsing, column auto-mapping,
// mapping panel, and MB→GB unit conversion.

// Download sample CSV
function downloadSampleCSV() {
  const csvContent = `VM Name,App Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region,ENV,OS,Workload,Compliance,AWS Min Gen,Azure Min Gen,GCP Min Gen,Exclude,Current Instance Type
web-server-01,Storefront,4,16,45,60,us-east-1,East US,us-central1-a,Production,Linux,Web Server,,,,,,m5.xlarge
db-server-02,Billing,8,32,70,80,us-west-2,West US 2,us-west1-b,Production,Windows,Database,PCI,,,,"Burstable,GPU",m5.2xlarge
app-server-03,Billing,2,8,35,45,eu-west-1,North Europe,europe-west1-c,Dev,Linux,General,,,,,,t3.large
cache-server-04,Storefront,2,4,25,30,us-east-1,East US,us-central1-a,Staging,Linux,Cache,,,,,Burstable,t3.medium
api-server-05,Storefront,4,8,65,55,us-west-1,West US,us-west1-b,Production,Linux,Web Server,,6,4,n4,,c5.xlarge
microservice-06,Analytics,1,2,15,20,us-east-1,East US,us-central1-a,Dev,Linux,General,,,,,,t3.small
worker-node-07,Analytics,8,16,85,75,us-west-2,West US 2,us-west1-b,Production,Linux,ML/AI,HIPAA,7,5,n4,,c5.2xlarge
frontend-08,Storefront,2,4,40,50,eu-west-1,North Europe,europe-west1-c,Staging,Windows,Web Server,,,,,,t3.medium`;

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

// Loads the vendored SheetJS parser on first use only (~900KB; Excel uploads
// are rare).
//
// SECURITY — must be the FULL build, never the styling fork. Both vendored
// bundles define window.XLSX with read(), but xlsx-js-style forks SheetJS
// 0.18.x and predates the read-path fixes for CVE-2023-30533 (prototype
// pollution) and CVE-2024-22363 (ReDoS). A prior Excel export can leave that
// fork in window.XLSX, so an `if (window.XLSX)` guard would parse a later
// untrusted upload with the unpatched engine. Capture the full build's own
// reference and read through THAT, never the bare global.
function ensureXlsxLoaded() {
  if (window._xlsxParser) return Promise.resolve();
  if (!window._xlsxLoadPromise) {
    window._xlsxLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "js/vendor/xlsx.full.min.js";
      script.onload = () => {
        // Whatever the global held before, the parser is this build.
        window._xlsxParser = window.XLSX;
        resolve();
      };
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

// A spreadsheet writes 16384 as "16,384" with a thousands separator — RVTools
// does this for Memory in every export seen. parseFloat("16,384") === 16 (a
// plausible wrong answer, not NaN): a 16 GiB VM's MiB / 1024 then arrives as
// 0.02 GB, sizing every machine to the smallest instance, and nothing catches it
// (0.02 isn't zero, and the median stays below the MiB threshold). Strip only
// strictly-grouped thousands: "1,234" / "1,234,567.8" are unambiguous; "3,5" is
// left alone (three and a half in much of the world — guessing a locale starts
// this class of bug).
const GROUPED_THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

function normalizeCellValue(value) {
  const text = String(value ?? "").trim();
  return GROUPED_THOUSANDS.test(text) ? text.replace(/,/g, "") : text;
}

// Rows are built by header NAME, so two identically-named columns collapse into
// one (the later silently overwrites the earlier) and the mapping panel offers
// two entries that are secretly the same column. Rename repeats so nothing is
// lost and the panel's choice is real. Blank headers name no column — left alone.
function dedupeHeaders(headers) {
  const used = new Set();
  return headers.map((header) => {
    if (!header) return header;
    if (!used.has(header)) {
      used.add(header);
      return header;
    }
    let n = 2;
    while (used.has(`${header} (${n})`)) n++;
    const unique = `${header} (${n})`;
    used.add(unique);
    return unique;
  });
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

// Routes an uploaded file by CONTENT: a ZIP → SheetJS (picks the inventory-like
// sheet), text → the delimited-text parser, anything else rejected. Extension
// only decides when the bytes are unavailable.
async function ingestFile(file) {
  // Nothing is torn down until the new file is known usable: resetting first left
  // a rejected upload having removed the previous workbook's sheet picker while
  // its rows were still loaded and generatable.
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
    // Through the captured full build, never the bare global — see
    // ensureXlsxLoaded: the global may be the unpatched styling fork.
    const workbook = window._xlsxParser.read(new Uint8Array(buffer), {
      type: "array",
    });

    const sheets = workbook.SheetNames.map((name) =>
      readWorkbookSheet(workbook, name),
    ).filter(Boolean);
    if (!sheets.length) throw new Error("The workbook has no sheets with data");

    const chosen = pickBestSheet(sheets);
    window._uploadedSheets = sheets;
    // The file-level note ("named .csv but is a workbook") survives a sheet
    // switch, so keep it to re-apply — _uploadNote is consumed per ingest.
    window._uploadFileNote = window._uploadNote;

    // A page with no picker can't show or change the choice, so it must at least
    // say what it opened.
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
// Workbooks are rarely single-sheet: an RVTools export keeps the inventory in a
// "vInfo" tab; hand-kept sheets often lead with a cover note or pivot. Reading
// SheetNames[0] gets those wrong, so read every sheet, open the most inventory-
// like one, and keep the choice visible/changeable.

// Returns null for a sheet with no data or no header row — an empty tab and a
// notes tab are not candidates, and must not be offered as one.
function readWorkbookSheet(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) return null;

  // raw:false → formatted strings, matching what CSV parsing produces
  const rows2d = window._xlsxParser.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (!rows2d.length) return null;

  const headers = dedupeHeaders(rows2d[0].map((h) => String(h).trim()));
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

  // A sheet with headers and no rows is a template, not an inventory — exclude it
  // rather than rank it low: scoring weighs recognised columns above row count, so
  // a blank template with a full canonical header set would outrank the populated
  // sheet and open empty.
  if (!rows.length) return null;

  return { name, headers, rows };
}

// A sheet an import preset RECOGNISES is the inventory — that beats generic
// column counting, which gets real files wrong: an RVTools workbook's `vHost`
// (the ESXi servers) can map more canonical-looking columns than `vInfo` (the
// VMs), so the picker opened vHost — the wrong machines, and without VM/Powerstate
// the RVTools preset then didn't fire. Ask the preset first; fall back to counting
// only when nothing is recognised.
function scoreSheet(sheet) {
  const match = autoMatchHeaders(sheet.headers);
  return {
    recognised: !!match.preset,
    hasRequired: match.unmatchedRequired.length === 0,
    mapped: Object.keys(match.mapping).length,
    rows: sheet.rows.length,
  };
}

// In order: a preset-recognised sheet, then one with every required column, then
// the most recognised columns, then the biggest. Ties fall back to workbook order
// (a workbook of look-alike sheets opens its first).
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
  const { headers, rows, unterminatedQuote } = parseDelimitedText(csvText);
  if (unterminatedQuote) warnUnterminatedQuote();
  ingestRows(headers, rows);
}

// ─── Sample datasets ─────────────────────────────────────────────────────────
// The eight-row sample shows the format but not a large run or a WRONG file (most
// real inventories). These load through the normal pipeline, so they demonstrate
// actual behaviour, not a description of it.

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

// Loaded through parseCSV, exactly as an upload — so the messy sample really trips
// the input check.
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
// A few dozen rows copied from Excel go through the same pipeline as an upload
// (same mapping, hygiene check, region validation) — a second route into the data
// must not be a second route to get it wrong.

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

  const { headers, rows, unterminatedQuote } = parseDelimitedText(text);
  if (unterminatedQuote) warnUnterminatedQuote();
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

  // A file name left in the picker would describe data no longer on screen;
  // clearing it also lets the same file be re-selected.
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

// Shared separator, not assumed: the saved-mapping manager counts columns by
// splitting a signature back apart, so changing the join here without the split
// would miscount (a header containing this char miscounts too).
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

// Returns false if storage is unavailable (quota, private-browsing) so callers
// can tell the user rather than claim a save that was discarded.
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
// Presets for the tools people inventory with. A preset exists only to settle what
// the generic matcher can't and to name units a header hides.
//
// RVTools' vInfo ships both "VM" (guest) and "Host" (the ESXi box), both VM-name
// synonyms, so the matcher finds two candidates and stalls on every RVTools file;
// the preset says which is the VM.
//
// `detect` keys only on headers that tool ships (so a preset never claims an
// unrecognised file) and names as few columns as possible; the rest go through the
// normal matcher. Keys are normalized (normalizeHeader).
const IMPORT_PRESETS = [
  {
    name: "RVTools",
    // A preset that claims a file it doesn't recognise is worse than none: this
    // one divides memory by 1024, so a false positive corrupts every row.
    // VM/Powerstate/CPUs alone aren't enough (any hand-rolled vSphere export has
    // those, memory in GB). RVTools' MiB-suffixed sizing columns are the
    // distinguishing mark — and the evidence for the MiB convention: a file
    // reporting storage in MiB reports memory in MiB too.
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
      // Provisioned, not "In Use": the bulk template asks what to provision.
      provisionedmib: COLUMN_MAPPINGS.disk,
      provisionedmb: COLUMN_MAPPINGS.disk,
    },
    // vInfo's "Memory" is MiB, and says so nowhere in the header
    memoryUnit: "MB",
  },
  {
    name: "AWS Application Discovery Service",
    // ADS namespaces its columns ("CPU.NumberOfLogicalCores", "RAM.TotalSizeInMB").
    // Nothing else writes headers like that and the generic matcher recognises
    // none, so an ADS file otherwise stalls at the mapping panel with both required
    // columns unmatched.
    detect: (norm) =>
      norm.has("cpunumberoflogicalcores") &&
      norm.has("ramtotalsizeinmb") &&
      norm.has("cpuusagepctavg"),
    columns: {
      // Logical cores, not sockets ("NumberOfProcessors") or physical cores
      // ("NumberOfCores"): a cloud vCPU matches what the guest OS sees. The other
      // two stay available in the panel.
      cpunumberoflogicalcores: COLUMN_MAPPINGS.cpu,
      ramtotalsizeinmb: COLUMN_MAPPINGS.memory,
      cpuusagepctavg: COLUMN_MAPPINGS.cpuUtilization,
      // "HostName" already maps on its own, but naming it here keeps the VM name
      // from drifting to some other column as the synonym table grows.
      hostname: COLUMN_MAPPINGS.vmName,
    },
    memoryUnit: "MB",
    derive: {
      // ADS reports memory USED in MB; the optimizer needs a percentage:
      // (used ÷ total) × 100. Without it an ADS file could only be CPU-optimized —
      // memory left at current size for every VM, forgoing most of the saving.
      //
      // Source columns are found by NORMALIZED name (like everything here). Reading
      // them as literal strings would let an export varying only in case/punctuation
      // — still detected as ADS — yield NaN, returning "" for every row: no error,
      // no failing test, memory right-sizing silently off. That is the failure this
      // preset exists to prevent.
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

// A preset may DERIVE a canonical column the file doesn't carry. Derived columns
// are added before mapping, so everything downstream sees them as if the file had
// them. A column the file already provides is never overwritten (user data
// outranks computed).
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
        // Pass the file's headers so a derivation finds source columns by
        // normalized name, not literal string.
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

  // A preset's columns are settled before the matcher runs and their headers
  // claimed — that stops RVTools' "Host" competing for VM Name once "VM" has it.
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

// Above this, a memory figure looks more like MiB than GB. NOT a licence to
// convert — a real fleet of 512 GB–1 TB machines exists, and dividing it by 1024
// is the same silent corruption as leaving MiB alone — only to raise the question
// (see reportInputHygiene). Median (not max/mean) keeps one outlier from speaking
// for the file.
const MEMORY_LOOKS_LIKE_MB = 1024;

function medianMemory(rows, column) {
  const values = rows
    .map((row) => parseFloat(row[column]))
    .filter((v) => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  return values[Math.floor(values.length / 2)];
}

// Size columns (values in GB) that convert from MB/MiB on ingest. Only EXPLICIT
// evidence converts — a header that says MB, or a preset that knows the format's
// convention; values alone are enough to ask, not to convert. Disk shares
// memory's list (not a parallel path) so a new size column can't silently skip
// the conversion.
const SIZE_COLUMNS = [COLUMN_MAPPINGS.memory, COLUMN_MAPPINGS.disk];

// Per-size-column unit dropdown ids, keyed by canonical (not a mem/disk ternary)
// so a third SIZE_COLUMN can't collide on the disk id — it just needs an entry.
const SIZE_UNIT_IDS = {
  [COLUMN_MAPPINGS.memory]: "colmap_unit_mem",
  [COLUMN_MAPPINGS.disk]: "colmap_unit_disk",
};

function detectSizeUnits(mapping) {
  const units = {};
  for (const canonical of SIZE_COLUMNS) {
    const source = Object.keys(mapping).find((s) => mapping[s] === canonical);
    if (source && isMbHeader(source)) units[canonical] = "MB";
  }
  return units;
}

// Saved mappings: { headerSignature: { v: 2, mapping: {source: canonical},
// units: {canonical: "MB"|"GB"} } }.
//
// A saved mapping short-circuits the preset, synonym table, and unit inference
// (the user already answered for these exact headers), which makes an entry from
// an OLDER version dangerous: one written before 3.7 could name `Host` as the VM
// or record no unit for a MiB column, reapplying that answer past the fixes for
// it. So entries are versioned and anything older is dropped — the file asks
// again. Units are recorded explicitly (GB included) so "no unit recorded" can't
// be mistaken for "GB".
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
  // Record the unit even when it's the default, for every size column: an absent
  // unit is ambiguous ("GB" vs "nobody decided"), and that ambiguity let a MiB
  // column be reapplied as GB.
  for (const canonical of SIZE_COLUMNS) {
    if (Object.values(mapping).includes(canonical)) {
      recorded[canonical] = recorded[canonical] === "MB" ? "MB" : "GB";
    }
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
// Confirming the panel once saves that answer against the file's header signature,
// and every later file with the same headers is mapped that way without asking —
// which also means a mistake is repeated silently. This shows what's remembered
// and allows forgetting it.

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

  // The signature is built from the file's headers — attacker-controlled text. It
  // must never be interpolated into an inline handler: escapeHtml turns a quote
  // into &quot;, which the parser decodes back to a quote INSIDE onclick, closing
  // the string. Hand the handler an index instead and look the signature up here.
  window._savedMappingSignatures = signatures;

  const entries = signatures
    .map((signature, index) => {
      const saved = readSavedMapping(all[signature]);
      if (!saved) return "";

      // The signature is a sorted, lowercased header join — fine as a key,
      // unreadable as a label. Show the renames the user actually agreed to; a
      // rename-nothing mapping is labelled as such, not shown as an empty row.
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

  // The signature identifies the FILE, so it's taken from the headers the file
  // actually has, before anything is derived — signing derived headers saves a
  // mapping under a key no later upload can reproduce. Kept on window because every
  // save path needs it, and the edit path rebuilds _pendingIngest from _lastIngest
  // (post-derivation headers).
  const signature = headerSignature(headers);
  window._fileSignature = signature;

  const preset = detectImportPreset(headers);

  // A recognised format may carry a canonical column only implicitly (ADS reports
  // memory used in MB; the optimizer needs the percentage). Derive it BEFORE the
  // matcher/panel/engine/exports look, so they see it as though the file had it.
  // After the match left the match ignorant of it; after the saved-mapping branch
  // skipped it for files already answered for.
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
    // Say so — a silently reinterpreted file is what the user goes looking for
    // when a number seems wrong.
    const presetNote = `Recognised as a ${match.preset.name} export`;
    window._uploadNote = window._uploadNote
      ? `${window._uploadNote}. ${presetNote}`
      : presetNote;
  }

  applyIngest(
    headers,
    rows,
    match.mapping,
    presetUnits(match.preset, match.mapping) || detectSizeUnits(match.mapping),
  );
}

// A preset knows its own units — nothing to infer once the format is identified.
function presetUnits(preset, mapping) {
  if (!preset || !preset.memoryUnit) return null;
  // A MiB-memory format reports disk in MiB too — the convention the RVTools
  // preset is keyed on.
  const mapped = Object.values(mapping);
  const units = {};
  for (const canonical of SIZE_COLUMNS) {
    if (mapped.includes(canonical)) units[canonical] = preset.memoryUnit;
  }
  return Object.keys(units).length ? units : null;
}

// Applies a mapping and runs the normal post-upload pipeline
function applyIngest(headers, rows, mapping, units = {}) {
  const finalHeaders = headers.map((h) => mapping[h] || h);
  columnHeaders = finalHeaders;
  csvData = rewriteRowKeys(rows, mapping);

  // Unit conversion: MB (RVTools-style) → GB, same for every size column; collect
  // the ones that converted so the note can name each. Keyed on every size column,
  // not memory alone — a disk rescaled 1024× with no mention is the silent surprise
  // this note prevents.
  const convertedCols = [];
  for (const col of SIZE_COLUMNS) {
    if (!units || units[col] !== "MB") continue;
    convertedCols.push(col);
    csvData = csvData.map((row) => {
      const v = parseFloat(row[col]);
      if (isNaN(v)) return row;
      return { ...row, [col]: String(Math.round((v / 1024) * 100) / 100) };
    });
  }

  window._pendingIngest = null;
  // Bumped on every ingest. Results carry the token they ran against, so replacing
  // the data under existing results is visible even when the new data has the same
  // shape.
  window._ingestToken = (window._ingestToken || 0) + 1;
  // A dismissal belongs to the file it was made about: answering "different VMs" or
  // "these really are GB" for one upload must not silence the question for the next.
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
  const sizeNote = convertedCols.length
    ? `<br>📐 ${convertedCols.join(" and ")} values converted from MB to GB`
    : "";
  const editBtn = ` <button onclick="editColumnMapping()" title="Change which of your columns map to the CPU, memory, name, and region fields" style="margin-left: 8px; padding: 2px 10px; font-size: 12px; border: 1px solid var(--border-slate); border-radius: 6px; background: var(--surface-alt); color: var(--text-body); cursor: pointer;">✏️ Edit mapping</button>`;
  const okLabel = window._ingestLabel || "File loaded successfully";
  if (missingColumns.length > 0) {
    fileStatus.className = "alert alert-warning";
    fileStatus.innerHTML = `⚠️ Missing required columns: ${missingColumns
      .map(escapeHtml)
      .join(
        ", ",
      )}. Please check your file format.${renameNote}${uploadNote}${sizeNote}${editBtn}`;
    console.warn("Missing required columns:", missingColumns);
  } else {
    fileStatus.className = "alert alert-success";
    fileStatus.innerHTML = `✅ ${okLabel}: ${csvData.length} rows, ${finalHeaders.length} columns${renameNote}${uploadNote}${sizeNote}${editBtn}`;
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

  // Re-check the "Size against" hint against the columns just loaded. The hint
  // only refreshes on the select's own onchange, so a p95/Peak choice made for
  // an earlier file would otherwise keep reading "Sizing against p95" over a
  // new upload that carries no p95 columns — the exact stale state it warns of.
  if (typeof onUtilizationStatisticChange === "function") {
    onUtilizationStatisticChange();
  }

  // Results still on screen were generated from the data just replaced. Not cleared
  // (the user may want them) but must stop presenting themselves as current.
  updateStaleResultsNotice();
}

// ─── Input hygiene ───────────────────────────────────────────────────────────
// A bad row doesn't announce itself: a VM with no CPU still gets a recommendation,
// a VM listed twice is sized and counted twice, both looking reasonable. So say
// what's wrong, with row numbers, before the run.

// Row numbers as a spreadsheet shows them: the header is row 1, so the first
// data row is row 2. Anything else sends the user hunting in the wrong place.
const dataRowNumber = (index) => index + 2;

// Not "unusual" — impossible: far above the largest instance any provider offers,
// so a row beyond these is a data-entry error or an unconverted unit.
const IMPLAUSIBLE_CPU = 512;
const IMPLAUSIBLE_MEMORY_GB = 24576; // 24 TB

// ─── End-of-life OS advisory (step 10) ───────────────────────────────────────
// A curated, deliberately CONSERVATIVE table of OSes well past vendor end-of-life,
// each with a modern landing OS. The ONE place OS is read (the unrecognised-value
// scan skips it): fires only on a POSITIVELY-recognised EOL string, never on an
// unknown or current one, so it stays silent on ordinary Linux-distro strings.
// Advisory only — sizing is driven by CPU/memory, never the OS string. Kept small:
// a false "you are on EOL" is worse than a missed one, so anything in support or
// ambiguous is left out. Each regex is validated against real inventory strings
// (current OSes must NOT match) in ingest/eol-os-test.js. First match wins.
const EOL_OS_RULES = [
  // Windows Server 2012/2012 R2 (EOL Oct 2023) and older. 2016+ still in support,
  // omitted.
  {
    re: /windows\s*server\s*(?:2003|2008|2012)(?:\s*r2)?/i,
    suggest: "Windows Server 2022",
  },
  // Windows client editions, occasionally carried in inventories.
  { re: /windows\s*(?:xp|vista|7|8(?:\.1)?)(?!\d)/i, suggest: "Windows 11" },
  // CentOS 6/7/8 (8 EOL Dec 2021, 7 EOL Jun 2024). CentOS Stream is a separate,
  // current product and must NOT match.
  {
    re: /centos(?!\s*stream)\D*(?:6|7|8)(?!\d)/i,
    suggest: "Rocky Linux 9 or RHEL 9",
  },
  // RHEL / Red Hat Enterprise Linux 5/6/7 (7 EOL Jun 2024).
  {
    re: /(?:rhel|red\s*hat(?:\s+enterprise)?(?:\s+linux)?)\D*(?:5|6|7)(?!\d)/i,
    suggest: "RHEL 9",
  },
  // Oracle Linux 5/6/7.
  { re: /oracle\s*linux\D*(?:5|6|7)(?!\d)/i, suggest: "Oracle Linux 9" },
  // Ubuntu 10.04–18.04 (18.04 standard support ended May 2023). 20.04+ omitted.
  {
    re: /ubuntu\D*(?:1[0-8])\.(?:04|10)(?!\d)/i,
    suggest: "Ubuntu 22.04 LTS or newer",
  },
  // Debian 8/9/10 (10 EOL 2024). 11+ omitted.
  { re: /debian\D*(?:8|9|10)(?!\d)/i, suggest: "Debian 12" },
  // SUSE Linux Enterprise 9/10/11/12 (12 EOL Oct 2024). 15 omitted.
  {
    re: /(?:sles|suse[\w ]*?)\D*(?:9|10|11|12)(?!\d)/i,
    suggest: "SLES 15",
  },
  // Amazon Linux AMI (AL1, EOL Dec 2023) and Amazon Linux 2 (EOL Jun 2025).
  // "Amazon Linux 2023" is current and must NOT match (the 2 is followed by 0).
  { re: /amazon\s*linux\s*ami/i, suggest: "Amazon Linux 2023" },
  { re: /amazon\s*linux\s*2(?!\d)/i, suggest: "Amazon Linux 2023" },
];

// Return a suggested modern landing OS if `raw` names an OS past its standard
// end-of-life, or null for anything current/unknown/blank. Some flagged releases
// can still carry paid extended support (ESU/ESM), so the advisory asks the user
// to verify coverage rather than assert unsupported. Pure — a table lookup.
function classifyEolOs(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  for (const rule of EOL_OS_RULES) {
    if (rule.re.test(s)) return rule.suggest;
  }
  return null;
}

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

  // Unrecognised rule-engine values: a Workload/ENV/Compliance cell the engine
  // doesn't know matches no rule and is silently treated as default, so the
  // constraint the user believed they set never applied. Name it, with rows. Blank
  // is the documented default, never flagged. Vocabularies are read LIVE from the
  // engine, so this can't drift from apply().
  //
  // OS is deliberately NOT scanned: the engine acts only on "windows"/"macos" and
  // treats everything else (every Linux distro string) as the Linux default, which
  // is correct — an "unrecognised" OS is no lost constraint, and flagging it would
  // fire on nearly every real row. (See RuleEngine.RECOGNIZED.os.)
  const RECOGNIZED =
    (typeof RuleEngine !== "undefined" && RuleEngine.RECOGNIZED) || null;
  if (RECOGNIZED) {
    const RULE_DIMENSIONS = [
      {
        label: "Workload",
        rule: "workload",
        cols: ["Workload"],
        allow: RECOGNIZED.workload,
      },
      {
        label: "ENV",
        rule: "environment",
        cols: ["ENV", "Environment"],
        allow: RECOGNIZED.env,
      },
      {
        label: "Compliance",
        rule: "compliance",
        cols: ["Compliance"],
        allow: RECOGNIZED.compliance,
      },
    ];
    for (const dim of RULE_DIMENSIONS) {
      // Scan EVERY present synonym column, not just the first: a file with both
      // "ENV" and "Environment" can hide a typo in the second, and a lost
      // constraint in a skipped column is what this check exists to surface.
      const presentCols = dim.cols.filter((c) => present(c));
      if (presentCols.length === 0) continue;
      const allowed = new Set(dim.allow.map((v) => v.toLowerCase()));
      const byValue = new Map(); // distinct raw value → the rows carrying it
      rows.forEach((row, i) => {
        // The same value in two synonym columns of one row names that row once.
        const seen = new Set();
        for (const col of presentCols) {
          const raw = String(row[col] ?? "").trim();
          if (!raw || allowed.has(raw.toLowerCase()) || seen.has(raw)) continue;
          seen.add(raw);
          if (!byValue.has(raw)) byValue.set(raw, []);
          byValue.get(raw).push(dataRowNumber(i));
        }
      });
      for (const [raw, rowNumbers] of byValue) {
        note(
          "warning",
          `${dim.label} "${raw}" not recognized (no ${dim.rule} rule applied)`,
          rowNumbers,
        );
      }
    }
  }

  // End-of-life OS advisory: fires only on an OS positively recognised as past
  // vendor end-of-life (classifyEolOs), never on unknown/current, so reading the OS
  // column here avoids the "fires on nearly every row" noise that keeps OS out of
  // the scan above. Advisory only; suggests a landing OS, never affects sizing.
  if (present("OS") && typeof classifyEolOs === "function") {
    const byOs = new Map(); // distinct EOL raw value → { suggest, rows: [] }
    rows.forEach((row, i) => {
      const raw = String(row["OS"] ?? "").trim();
      if (!raw) return;
      const suggest = classifyEolOs(raw);
      if (!suggest) return;
      if (!byOs.has(raw)) byOs.set(raw, { suggest, rows: [] });
      byOs.get(raw).rows.push(dataRowNumber(i));
    });
    for (const [raw, info] of byOs) {
      note(
        "advisory",
        `OS "${raw}" is past standard end-of-life — verify any extended support (ESU / ESM) coverage, then consider ${info.suggest}`,
        info.rows,
      );
    }
  }

  // Duplicates are a question, not a defect: the same name twice may be one VM
  // exported twice or two VMs sharing a name across clusters. Ask, don't pick.
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

  // Not a defect, and NOT to act on unasked: a fleet of 512 GB–1 TB machines is
  // real, and dividing it by 1024 corrupts it as surely as leaving a MiB column
  // alone. Only the user knows which they have.
  const memoryUnit =
    present(MEM) && (medianMemory(rows, MEM) || 0) >= MEMORY_LOOKS_LIKE_MB
      ? { median: medianMemory(rows, MEM) }
      : null;

  return { issues, duplicates, memoryUnit };
}

// The user confirmed the values are MiB. Re-derive from the untouched source rows
// with the unit set, not by dividing csvData in place, so everything downstream is
// rebuilt from one path and the recorded unit survives a later mapping edit.
function convertMemoryToGb() {
  const last = window._lastIngest;
  if (!last) return;

  // applyIngest clears the per-file acknowledgements (normally a NEW file
  // arriving). This is a remediation of the loaded file instead: dividing memory by
  // 1024 can't change which VM names repeat, so a duplicate answer already given
  // still holds — re-asking would look like it hadn't registered. Re-mapping
  // columns correctly does reset it (a different VM-name column changes duplicates).
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

// At most a handful of row numbers inline — a list of four hundred is a wall, not
// a message.
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
  const severityIcon = (s) =>
    s === "error" ? "❌" : s === "advisory" ? "🗓️" : "⚠️";
  const lines = report.issues
    .map(
      (i) =>
        `<li>${severityIcon(i.severity)} ${escapeHtml(i.label)} — ${
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
// csvData and _lastIngest.rows are parallel (the former is the latter mapped), so
// both must be pruned by the same indexes — pruning only csvData left the source
// rows intact, and re-deriving from them resurrected every duplicate.
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

  // Rows changed, so everything derived from them is redone (region chips,
  // app→workload panel described the old set).
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

// Renders the mapping panel: one dropdown per canonical, prefilled with auto-match
// guesses; pipeline stays deferred until Confirm. opts.isEdit reopens over
// already-applied data — nothing changes unless the user confirms; Cancel closes.
function showColumnMappingPanel(headers, match, opts = {}) {
  const panel = document.getElementById("columnMappingSection");

  if (!panel) {
    // Page has no panel placeholder — apply best-effort mapping. Consult the
    // preset (as below): a recognised MiB format may have needed review for some
    // OTHER column, and there's no unit dropdown here — trusting the header name
    // alone would call MiB "GB", a silent 1024x.
    if (!opts.isEdit) {
      applyIngest(
        headers,
        window._pendingIngest.rows,
        match.mapping,
        match.units ||
          presetUnits(match.preset, match.mapping) ||
          detectSizeUnits(match.mapping),
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

  // Memory unit prefill, in order of authority: units already applied (edit mode),
  // then the recognised format, then the header name.
  //
  // The preset must be consulted HERE, not only on the silent path: a recognised
  // RVTools file can still reach this panel (another column ambiguous), where the
  // header alone says "Memory" and means GB. Prefilling GB for a file identified as
  // MiB invites confirming a 1024x error, with only the median hygiene question to
  // catch it.
  const prefillUnits =
    match.units ||
    presetUnits(match.preset, match.mapping) ||
    detectSizeUnits(match.mapping);
  const unitFor = (canonical) =>
    prefillUnits[canonical] === "MB" ? "MB" : "GB";

  const selectRows = canonicals
    .map((canonical, idx) => {
      const isSize = SIZE_COLUMNS.includes(canonical);
      const isMemory = canonical === COLUMN_MAPPINGS.memory;
      const unitId = SIZE_UNIT_IDS[canonical];
      const sizeNoun = isMemory ? "memory" : "disk";
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
      const syncAttr = isSize
        ? ` onchange="window._syncSizeUnit('${unitId}', this)"`
        : "";
      const unitSelect = isSize
        ? ` <select id="${unitId}" class="form-control" style="max-width: 190px;" aria-label="Unit of the ${sizeNoun} values in your file" title="RVTools-style exports list ${sizeNoun} in MB — pick MB to convert to GB automatically">
            <option value="GB"${unitFor(canonical) === "GB" ? " selected" : ""}>values are GB</option>
            <option value="MB"${unitFor(canonical) === "MB" ? " selected" : ""}>values are MB → ÷1024</option>
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
      <p style="font-size: 12px; margin-top: 8px;">Other columns (ENV, OS, Workload, Compliance, Min Gen, Exclude) are used as-is when present. On multi-cloud sheets, Min Gen is per provider: AWS Min Gen, Azure Min Gen, GCP Min Gen.</p>
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

// Keeps a size-unit dropdown (memory or disk) in step with the chosen source
// column: picking a column whose name ends in MB/MiB flips that unit to MB.
window._syncSizeUnit = function (unitId, select) {
  const unitSelect = document.getElementById(unitId);
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

  // Size-column units (memory AND disk). Start from what the recognised format or
  // header names imply for every size column (so a MiB disk isn't left unconverted
  // because memory resolved first), then let each manual dropdown override its own
  // column. Writing "GB" explicitly overrides an auto-detected "MB" and is a no-op
  // in the conversion below.
  const preset = pending.match && pending.match.preset;
  const units = presetUnits(preset, mapping) || detectSizeUnits(mapping) || {};
  for (const [canonical, id] of Object.entries(SIZE_UNIT_IDS)) {
    if (!Object.values(mapping).includes(canonical)) {
      delete units[canonical];
      continue;
    }
    const sel = document.getElementById(id);
    if (sel && sel.value) units[canonical] = sel.value === "MB" ? "MB" : "GB";
  }

  // The FILE signature, captured before any derived column was added. Signing
  // pending.headers would include the derived column and produce a key no later
  // upload could match — saved and never replayed.
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
// Appears after ingest when the file has "App Name" but no per-row "Workload":
// assigning a workload per application lets every VM in that app inherit it at
// generation. Optional — the panel only persists the map; generation reads it
// (resolveRowWorkload in the factory).
function maybeShowAppMappingPanel() {
  const panel = document.getElementById("appMappingSection");
  if (!panel) return;

  const hasApp = columnHeaders.includes(APP_NAME_CANONICAL);
  const hasWorkload = columnHeaders.includes("Workload");
  // Dedupe case-insensitively (the map keys on the lowercased name), keeping
  // first-seen casing for the label, else "Billing"/"billing" render as two rows
  // that save to the same key.
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
    // Base color is success green; recolor on failure so the warning doesn't read
    // as success.
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

// Copying from Excel/Sheets gives tab-separated text; from a CSV, commas. Let the
// header line decide by whichever character divides it; a single-column file has
// neither and falls to the comma.
//
// Only delimiters OUTSIDE quotes count: a header like
//   "VM, display name"<TAB>CPU Count
// has one comma and one tab, but the comma is inside a quoted cell — counting it
// naively would call the file comma-separated and shred every row.
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

// Split delimited text into RECORDS, honouring quotes. A newline ends a record
// only OUTSIDE a quoted field; a newline INSIDE quotes is a data character of a
// multi-line cell (RFC-4180) and is kept. Splitting on "\n" first (as this used
// to) tore such a cell across records before parseCSVLine ever ran. Every char is
// preserved verbatim so parseCSVLine re-parses each record as one physical line.
// A doubled quote inside a field is one escaped literal, not a state toggle.
function splitRecords(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const records = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        current += '""'; // escaped quote pair — kept for parseCSVLine to collapse
        i++;
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
    } else if (char === "\n" && !inQuotes) {
      records.push(current);
      current = "";
    } else {
      current += char; // includes a newline when inQuotes — the multi-line cell
    }
  }
  if (current.length) records.push(current);
  // A quote left open at end-of-input means malformed: every record after the
  // stray quote was absorbed into this last one (state never reset, so no later
  // "\n" was a boundary). Expose it so the caller can warn rather than ship one row.
  records.unterminatedQuote = inQuotes;
  return records;
}

// Text (file contents or a paste) → { headers, rows }. The one place that turns
// delimited text into rows; upload and paste both use it, so they can't drift.
function parseDelimitedText(text) {
  // Capture the malformed-quote flag BEFORE filtering — .filter() drops the
  // property splitRecords hung on the array.
  const raw = splitRecords(text);
  const unterminatedQuote = raw.unterminatedQuote === true;
  const records = raw.filter((record) => record.trim() !== "");
  if (!records.length) return { headers: [], rows: [], unterminatedQuote };

  const delimiter = sniffDelimiter(records[0]);
  const headers = dedupeHeaders(parseCSVLine(records[0], delimiter));
  const rows = records.slice(1).map((record) => {
    const values = parseCSVLine(record, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      // Same normalization as the workbook path: a spreadsheet-exported CSV
      // carries the same "16,384" cells, quoted.
      row[header] = normalizeCellValue(values[index]);
    });
    return row;
  });
  return { headers, rows, unterminatedQuote };
}

// Shared warning for an unclosed quote. Kept out of parseDelimitedText so that
// stays pure/node-testable; the toast is browser-only.
function warnUnterminatedQuote() {
  showToast(
    "A quoted value was never closed — every row after the stray double-quote " +
      'was merged into one. Check the file for an unbalanced " character.',
    "warning",
  );
}

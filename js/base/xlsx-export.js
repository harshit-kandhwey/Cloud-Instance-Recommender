// Styled .xlsx export of the results grid (companion to the CSV download).
//
// The same rows/columns as downloadResults(), written as a single-sheet
// workbook with a styled header row, autofilter, and auto column widths.
// Only the header row is styled — data cells stay plain so large exports
// stay small and fast. The spreadsheet engine is lazy-loaded on first click:
// the xlsx-js-style fork if available (enables the header fill/bold), else the
// plain community build already vendored for uploads (valid, unstyled).
//
// The sheet-model builder and cell-type detection are pure and unit-tested;
// the write step is a thin adapter over SheetJS.

const RESULTS_XLSX_HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: "4C63D2" } },
  alignment: { horizontal: "left", vertical: "center" },
};

// 0-based column index → A1 column letters (0→A, 26→AA).
function resultsColToA1(c) {
  let s = "";
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// Excel treats clean integer/decimal strings as numbers so they sort and
// filter numerically. Bounded digit count avoids float-precision loss on long
// id-like values; leaves anything else (instance names, regions, …) as text.
function resultsCellType(v) {
  if (v === null || v === undefined || v === "") return { t: "s", v: "" };
  // NaN/Infinity aren't valid OOXML numeric cells — keep them as text.
  if (typeof v === "number")
    return Number.isFinite(v) ? { t: "n", v } : { t: "s", v: String(v) };
  const s = String(v);
  if (/^-?\d{1,15}(\.\d+)?$/.test(s)) return { t: "n", v: Number(s) };
  return { t: "s", v: s };
}

// Pure neutral model: header row + raw data rows + column widths + filter ref.
function buildResultsSheetModel(results) {
  const headers = results && results.length ? Object.keys(results[0]) : [];
  const rows = (results || []).map((r) => headers.map((h) => r[h] ?? ""));
  const cols = headers.map((h, c) => {
    let max = String(h).length;
    for (let i = 0; i < rows.length; i++) {
      const len = String(rows[i][c] ?? "").length;
      if (len > max) max = len;
    }
    return { wch: Math.min(60, Math.max(8, max + 2)) };
  });
  const lastCol = headers.length ? resultsColToA1(headers.length - 1) : "A";
  const autofilter = `A1:${lastCol}${rows.length + 1}`;
  return { headers, rows, cols, autofilter };
}

// The alternative-strategy sheets, in order. Each is a focused view: the VM
// identity/size columns plus every provider's pick for that one strategy.
const STRATEGY_SHEET_NAMES = [
  "Most Cost Optimized",
  "Workload Based",
  "Newest Generation",
];

// Identity/size columns to lead each strategy sheet (those actually present).
function strategyIdColumns(results) {
  const keys = results && results.length ? Object.keys(results[0]) : [];
  return [
    "VM Name",
    "App Name",
    "CPU Count",
    "Memory (GB)",
    "Current Instance Type",
  ].filter((c) => keys.includes(c));
}

// Providers that carry alternative columns, in first-seen order.
function providersWithAlternatives(results) {
  const keys = results && results.length ? Object.keys(results[0]) : [];
  const provs = [];
  keys.forEach((k) => {
    const m = k.match(/^(.*) Most Cost Optimized$/);
    if (m && !provs.includes(m[1])) provs.push(m[1]);
  });
  return provs;
}

// Pure: a per-strategy sheet model (identity columns + one pick column per
// provider). null when the run carries no alternative columns.
function buildStrategySheetModel(results, strategy) {
  const provs = providersWithAlternatives(results);
  if (!provs.length) return null;
  const keys = Object.keys(results[0]);
  const cols = [
    ...strategyIdColumns(results),
    ...provs.map((p) => `${p} ${strategy}`),
  ].filter((c) => keys.includes(c));
  const projected = results.map((r) => {
    const o = {};
    cols.forEach((c) => (o[c] = r[c] ?? ""));
    return o;
  });
  return buildResultsSheetModel(projected);
}

// A neutral sheet model → a SheetJS worksheet. Header styling applied only when
// the fork is the active engine (plain build ignores `.s`, still valid).
function sheetFromResultsModel(model, styled, XLSX) {
  const ws = {};
  const ncols = model.headers.length;

  model.headers.forEach((h, c) => {
    const cell = { t: "s", v: String(h) };
    if (styled) cell.s = RESULTS_XLSX_HEADER_STYLE;
    ws[XLSX.utils.encode_cell({ r: 0, c })] = cell;
  });
  model.rows.forEach((row, r) => {
    for (let c = 0; c < ncols; c++) {
      ws[XLSX.utils.encode_cell({ r: r + 1, c })] = resultsCellType(row[c]);
    }
  });

  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: model.rows.length, c: Math.max(0, ncols - 1) },
  });
  ws["!cols"] = model.cols;
  if (ncols) ws["!autofilter"] = { ref: model.autofilter };
  return ws;
}

// Neutral model → SheetJS workbook. The main "Recommendations" sheet, then one
// sheet per alternative strategy (extraSheets = [{ name, model }]).
function buildResultsWorkbook(model, styled, XLSX, extraSheets) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromResultsModel(model, styled, XLSX),
    "Recommendations",
  );
  (extraSheets || []).forEach(({ name, model: m }) => {
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromResultsModel(m, styled, XLSX),
      name,
    );
  });
  return wb;
}

// Lazy engine load: styling fork first, plain community build as fallback.
let _resultsXlsxPromise = null;
function loadResultsXlsxScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error("failed to load " + src));
    };
    document.head.appendChild(s);
  });
}
function ensureResultsXlsx() {
  if (_resultsXlsxPromise) return _resultsXlsxPromise;
  // Reuse an already-loaded engine only if it can style (the fork sets
  // style_version). If just the plain upload build is present we still load the
  // fork, since the results export is meant to be styled.
  if (window.XLSX && window.XLSX.style_version != null) {
    window._xlsxWriter = window.XLSX;
    _resultsXlsxPromise = Promise.resolve({ styled: true });
    return _resultsXlsxPromise;
  }
  // Capture the engine this path loaded. The bare global is not stable: an
  // .xlsx UPLOAD loads the full build (the only one safe to parse with — see
  // ensureXlsxLoaded in ingest.js) and overwrites window.XLSX, which would
  // silently strip the styling from a later export.
  _resultsXlsxPromise = loadResultsXlsxScript("js/vendor/xlsx-js-style.min.js")
    .then(() => {
      window._xlsxWriter = window.XLSX;
      return { styled: true };
    })
    .catch(() =>
      loadResultsXlsxScript("js/vendor/xlsx.full.min.js").then(() => {
        window._xlsxWriter = window.XLSX;
        return { styled: false };
      }),
    )
    .catch((err) => {
      // Both engines failed — drop the cached rejection so a later click retries.
      _resultsXlsxPromise = null;
      throw err;
    });
  return _resultsXlsxPromise;
}

function downloadResultsXlsx() {
  if (typeof processedResults === "undefined" || !processedResults.length) {
    showToast(
      "No results to download. Please generate recommendations first.",
      "warning",
    );
    return;
  }
  const btn = document.getElementById("downloadResultsXlsxBtn");
  const restore = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Building…";
  }
  ensureResultsXlsx()
    .then((info) => {
      const XLSXW = window._xlsxWriter || window.XLSX;
      if (!XLSXW) throw new Error("spreadsheet engine unavailable");
      const ordered = resultsInPreviewOrder(processedResults);
      const extraSheets = STRATEGY_SHEET_NAMES.map((name) => {
        const model = buildStrategySheetModel(ordered, name);
        return model ? { name, model } : null;
      }).filter(Boolean);
      const wb = buildResultsWorkbook(
        buildResultsSheetModel(ordered),
        !!info.styled,
        XLSXW,
        extraSheets,
      );
      const fname = exportFilename("instance_recommendations", "xlsx");
      XLSXW.writeFile(wb, fname);
    })
    .catch((e) => {
      console.error("Results Excel export failed:", e);
      showToast(
        "Sorry — building the Excel file failed: " +
          (e && e.message ? e.message : e),
        "error",
      );
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = restore;
      }
    });
}

// ─── Input template (.xlsx) ─────────────────────────────────────────────────
// A ready-to-fill workbook for building an inventory: the canonical column
// headers (so an upload maps with nothing to fix), two example rows, and an
// "Allowed values" sheet documenting the closed-enum vocabularies the rule
// engine recognises. The vocabularies are read LIVE from RuleEngine.RECOGNIZED,
// so the documentation can never drift from what apply() actually matches.
//
// Why documentation and not in-cell dropdowns: a write/read round-trip spike
// confirmed the vendored SheetJS builds (Community 0.20.3 and the xlsx-js-style
// fork 0.18.5) silently DROP a `!dataValidation` on write — data-validation is a
// SheetJS Pro feature. So the closed enums are DOCUMENTED on their own sheet
// rather than enforced in-cell; step 1's upload-time hygiene warning is what
// actually catches an unrecognised value, template or not.

// The canonical input columns, in authoring order. Mirrors downloadSampleCSV's
// column set (ingest.js) with the per-row Include Only allow-list added — the
// input-template suite asserts the two stay in step.
const INPUT_TEMPLATE_COLUMNS = [
  "VM Name",
  "App Name",
  "CPU Count",
  "Memory (GB)",
  "CPU Utilization",
  "Memory Utilization",
  "AWS Region",
  "Azure Region",
  "GCP Region",
  "ENV",
  "OS",
  "Workload",
  "Compliance",
  "AWS Min Gen",
  "Azure Min Gen",
  "GCP Min Gen",
  "Exclude",
  "Include Only",
  "Current Instance Type",
];

// Two example rows. Every closed-enum cell uses a recognised value (the suite
// checks this against RuleEngine.RECOGNIZED), and the second row demonstrates a
// Compliance tag, a multi-token Exclude, and the new Include Only allow-list.
const INPUT_TEMPLATE_EXAMPLES = [
  {
    "VM Name": "web-server-01",
    "App Name": "Storefront",
    "CPU Count": 4,
    "Memory (GB)": 16,
    "CPU Utilization": 45,
    "Memory Utilization": 60,
    "AWS Region": "us-east-1",
    "Azure Region": "East US",
    "GCP Region": "us-central1-a",
    ENV: "Production",
    OS: "Linux",
    Workload: "Web Server",
    Compliance: "",
    "AWS Min Gen": "",
    "Azure Min Gen": "",
    "GCP Min Gen": "",
    Exclude: "",
    "Include Only": "",
    "Current Instance Type": "m5.xlarge",
  },
  {
    "VM Name": "db-server-02",
    "App Name": "Billing",
    "CPU Count": 8,
    "Memory (GB)": 32,
    "CPU Utilization": 70,
    "Memory Utilization": 80,
    "AWS Region": "us-west-2",
    "Azure Region": "West US 2",
    "GCP Region": "us-west1-b",
    ENV: "Production",
    OS: "Windows",
    Workload: "Database",
    Compliance: "PCI",
    "AWS Min Gen": "6",
    "Azure Min Gen": "",
    "GCP Min Gen": "",
    Exclude: "Burstable,GPU",
    "Include Only": "m5,m6",
    "Current Instance Type": "m5.2xlarge",
  },
];

// The closed-enum columns and their recognised values, read LIVE from the rule
// engine so the "Allowed values" sheet cannot drift from what the engine
// matches. Only the four dimensions the hygiene check validates are enumerated;
// Exclude / Include Only and Min Gen carry a descriptive note instead (their
// vocabularies are open token sets, not a closed RECOGNIZED enum).
function buildInputTemplateAllowedValues() {
  const R = (typeof RuleEngine !== "undefined" && RuleEngine.RECOGNIZED) || {};
  return [
    { column: "ENV", values: (R.env || []).slice() },
    { column: "OS", values: (R.os || []).slice() },
    { column: "Workload", values: (R.workload || []).slice() },
    { column: "Compliance", values: (R.compliance || []).slice() },
  ];
}

// Neutral builders → a two-sheet SheetJS workbook. Header styling applied only
// when the fork is the active engine (the plain build ignores `.s`, still valid).
function buildInputTemplateWorkbook(XLSX, styled) {
  const styleHeader = (ws, ref) => {
    if (styled && ws[ref]) ws[ref].s = RESULTS_XLSX_HEADER_STYLE;
  };
  const wb = XLSX.utils.book_new();

  // Sheet 1 — the inventory grid: headers, then the example rows.
  const invAoa = [INPUT_TEMPLATE_COLUMNS];
  INPUT_TEMPLATE_EXAMPLES.forEach((ex) =>
    invAoa.push(INPUT_TEMPLATE_COLUMNS.map((c) => ex[c] ?? "")),
  );
  const inv = XLSX.utils.aoa_to_sheet(invAoa);
  INPUT_TEMPLATE_COLUMNS.forEach((_, c) =>
    styleHeader(inv, XLSX.utils.encode_cell({ r: 0, c })),
  );
  inv["!cols"] = INPUT_TEMPLATE_COLUMNS.map((h) => ({
    wch: Math.max(12, h.length + 2),
  }));
  XLSX.utils.book_append_sheet(wb, inv, "Inventory");

  // Sheet 2 — documented allowed values for the closed-enum columns.
  const docAoa = [["Column", "Recognised values (any case; blank = default)"]];
  buildInputTemplateAllowedValues().forEach(({ column, values }) =>
    docAoa.push([column, values.join(", ")]),
  );
  docAoa.push([]);
  docAoa.push([
    "Exclude / Include Only",
    "Family names (m5, c5) or classifiers: burstable, graviton, gpu, fpga, mac, previous generation. Comma-separated.",
  ]);
  docAoa.push([
    "Min Gen (per provider)",
    "Generation floor, native to each cloud: AWS a family generation number (6 keeps m6/c6/r6 and newer), Azure a v-number (4 keeps v4 and newer), GCP a family name (n4). A prefixed AWS or Azure value like m6 or Dsv4 is read as no floor at all, so give the bare number.",
  ]);
  const doc = XLSX.utils.aoa_to_sheet(docAoa);
  styleHeader(doc, "A1");
  styleHeader(doc, "B1");
  doc["!cols"] = [{ wch: 24 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, doc, "Allowed values");

  return wb;
}

function downloadInputTemplate() {
  const btn = document.getElementById("downloadInputTemplateBtn");
  const restore = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Building…";
  }
  ensureResultsXlsx()
    .then((info) => {
      const XLSXW = window._xlsxWriter || window.XLSX;
      if (!XLSXW) throw new Error("spreadsheet engine unavailable");
      const wb = buildInputTemplateWorkbook(XLSXW, !!info.styled);
      XLSXW.writeFile(wb, "cloud_instance_recommender_template.xlsx");
    })
    .catch((e) => {
      console.error("Template Excel export failed:", e);
      showToast(
        "Sorry — building the Excel template failed: " +
          (e && e.message ? e.message : e),
        "error",
      );
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = restore;
      }
    });
}

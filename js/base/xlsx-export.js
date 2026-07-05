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

// Neutral model → SheetJS workbook. Header styling applied only when the fork
// is the active engine (plain build silently ignores the `.s`, still valid).
function buildResultsWorkbook(model, styled, XLSX) {
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

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recommendations");
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
    _resultsXlsxPromise = Promise.resolve({ styled: true });
    return _resultsXlsxPromise;
  }
  _resultsXlsxPromise = loadResultsXlsxScript("js/vendor/xlsx-js-style.min.js")
    .then(() => ({ styled: true }))
    .catch(() =>
      loadResultsXlsxScript("js/vendor/xlsx.full.min.js").then(() => ({
        styled: false,
      })),
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
    alert("No results to download. Please generate recommendations first.");
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
      if (!window.XLSX) throw new Error("spreadsheet engine unavailable");
      const wb = buildResultsWorkbook(
        buildResultsSheetModel(processedResults),
        !!info.styled,
        window.XLSX,
      );
      const fname = `instance_recommendations_${new Date().toISOString().split("T")[0]}.xlsx`;
      window.XLSX.writeFile(wb, fname);
    })
    .catch((e) => {
      console.error("Results Excel export failed:", e);
      alert(
        "Sorry — building the Excel file failed: " +
          (e && e.message ? e.message : e),
      );
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = restore;
      }
    });
}

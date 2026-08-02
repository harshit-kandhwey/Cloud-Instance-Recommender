// Shared helpers for the end-to-end specs: the CSV export flow, a minimal CSV
// parser, and a provider-agnostic "was this row actually sized?" check.

const { expect } = require("@playwright/test");

// A recommendation cell that means "the engine did NOT size a box" — the
// sample-data / no-match / error sentinels the factory writes, plus blank.
// Anything else is a real instance (AWS m6g.xlarge, Azure d4sv5, GCP
// n2-standard-4 — too varied per provider for one positive regex, so we assert
// the negative instead: not one of these, and not empty).
const NOT_SIZED =
  /^(?:no data available|missing data|error|n\/a|no match.*|[—-]|)$/i;

function expectSized(cell) {
  expect(cell, `expected a sized instance, got "${cell}"`).toBeTruthy();
  expect(cell).not.toMatch(NOT_SIZED);
}

// Minimal RFC-4180-ish CSV parse — quoted fields, doubled quotes, embedded
// commas/newlines; strips a leading BOM. Returns row objects keyed by header.
function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows
    .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// From a generated page: open the CSV menu (Results is pre-checked), download,
// and return the parsed rows plus the suggested filename.
async function exportResultsCsv(page) {
  await page.click("#csvMenuBtn");
  const downloadPromise = page.waitForEvent("download");
  await page.click(".csv-menu-go");
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  return { filename: download.suggestedFilename(), rows: parseCsv(csv) };
}

module.exports = { NOT_SIZED, expectSized, parseCsv, exportResultsCsv };

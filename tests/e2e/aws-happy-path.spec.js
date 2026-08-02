// First end-to-end path: aws.html, Chromium, the whole real pipeline in a real
// browser — upload a CSV, read the region-validation chips, generate, and export
// the results CSV, asserting the downloaded file.
//
// This is the standing manual browser-smoke debt starting to be paid down in an
// automated form (PLAN 3.10.3): the Node suites drive functions in a vm; this
// drives the shipped page, the Web Worker, and the download path as a user does.
//
// Like every guard in this minor, it must be plant-confirmed: break the app
// (e.g. make the engine emit no instance, or the chip renderer drop the fuzzy
// arrow) and this spec must go RED. A green E2E that would pass against a broken
// app is the defect this whole minor exists to eliminate.

const path = require("path");
const { test, expect } = require("@playwright/test");

const FIXTURE = path.join(__dirname, "fixtures", "aws-sample.csv");
// A real AWS instance type: family letter+gen, optional suffix, a dotted size.
// Matches m6g.xlarge, t4g.small, r8i-flex.2xlarge — but never a bare region or
// VM name. Its presence in a recommendation cell proves the engine sized a box
// rather than falling back to echoing the input (the sample-data failure mode).
const AWS_INSTANCE =
  /^[a-z]\d[a-z]*(?:-[a-z]+)?\.(?:nano|micro|small|medium|large|\d*xlarge)\b/;

// Minimal RFC-4180-ish CSV parse — enough for this export: quoted fields,
// doubled quotes, embedded commas/newlines. Strips a leading BOM. Returns an
// array of row objects keyed by the header row.
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

test("aws.html: upload → region chips → generate → export results CSV", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/aws.html");

  // The manifest sets this once the region catalogue is available; validation
  // and generation both depend on it, so wait rather than race the upload.
  await page.waitForFunction(() => window.AWS_DATA_READY === true);

  // Upload the fixture. The input is visually a styled label, but setInputFiles
  // drives the underlying <input type=file> directly.
  await page.setInputFiles("#csvFile", FIXTURE);

  // ── Region validation chips ────────────────────────────────────────────────
  const chips = page.locator("#regionValidationSection");
  await expect(chips).toBeVisible();
  // Exact regions carry a check; the AZ-suffixed one is fuzzy-resolved and shows
  // the arrow to the region it snapped to. Asserting the arrow specifically is
  // what makes a broken fuzzy-resolver fail here.
  await expect(chips).toContainText("us-east-1 ✓");
  await expect(chips).toContainText("us-west-2 ✓");
  await expect(chips).toContainText("us-east-1a → us-east-1");

  // ── Generate ───────────────────────────────────────────────────────────────
  await page.click("button.generate-btn");

  // The download section unhides only after a successful run.
  const downloadSection = page.locator("#downloadSection");
  await expect(downloadSection).toBeVisible({ timeout: 15000 });

  // ── Export the results CSV ───────────────────────────────────────────────────
  // "Results CSV" is checked by default in the CSV menu; open it and download.
  await page.click("#csvMenuBtn");
  const downloadPromise = page.waitForEvent("download");
  await page.click(".csv-menu-go");
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(
    /^instance_recommendations_.*\.csv$/,
  );

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");

  const rows = parseCsv(csv);
  const names = rows.map((r) => r["VM Name"]);
  // Every input row survived the round trip.
  expect(names).toEqual(["web-server-01", "db-server-02", "app-server-03"]);

  // The load-bearing assertion: the recommendation column for a known row holds
  // a real sized instance, proving the engine ran end to end rather than echoing
  // sample data. Read the exact cell, not "an instance somewhere in the file" —
  // a coarse match would pass even if this column were blanked while a sibling
  // strategy column still emitted one.
  const web01 = rows.find((r) => r["VM Name"] === "web-server-01");
  expect(web01["AWS Like-to-Like Instance"]).toMatch(AWS_INSTANCE);

  // The shipped page must load and run clean.
  expect(consoleErrors).toEqual([]);
});

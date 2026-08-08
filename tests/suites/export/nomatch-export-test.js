// No-match remediation export.
const { buildContext } = require("../harness");

// Full app on the AWS page. The shared harness captures downloads (Blob +
// URL.createObjectURL, the filename filled in when the <a> is clicked), toasts,
// and native alert()s — so this suite asserts against `downloads`, `toasts` and
// `alerts` instead of a real disk or a rendered toast stack.
const { ctx, run, elements, toasts, alerts, downloads } = buildContext();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

// Engineered results: 2 of 5 rows fully unmatched, 1 partially matched (AWS
// no-match but Azure matched — must NOT export), 2 fully matched
const results = [
  {
    "VM Name": "ok-1",
    "CPU Count": "2",
    "AWS Like-to-Like Instance": "m5.large",
    "AZURE Like-to-Like Instance": "D2s_v5",
    "AWS No Match Reason": "",
    "AZURE No Match Reason": "",
    "AWS Rules Applied": "1a",
    "AZURE Rules Applied": "",
  },
  {
    "VM Name": "bad-1",
    "CPU Count": "=2+2",
    "AWS Like-to-Like Instance": "No data available",
    "AZURE Like-to-Like Instance": "Missing data",
    "AWS No Match Reason": "Region 'narnia' not found",
    "AZURE No Match Reason": "No AZURE region specified in CSV",
    "AWS Rules Applied": "",
    "AZURE Rules Applied": "",
  },
  {
    "VM Name": "partial-1",
    "CPU Count": "4",
    "AWS Like-to-Like Instance": "No data available",
    "AZURE Like-to-Like Instance": "D4s_v5",
    "AWS No Match Reason": "x",
    "AZURE No Match Reason": "",
    "AWS Rules Applied": "",
    "AZURE Rules Applied": "",
  },
  {
    "VM Name": "bad-2",
    "CPU Count": "8",
    "AWS Like-to-Like Instance": "Error",
    "AZURE Like-to-Like Instance": "Error",
    "AWS No Match Reason": "Error: boom",
    "AZURE No Match Reason": "Error: boom",
    "AWS Rules Applied": "",
    "AZURE Rules Applied": "",
  },
  {
    "VM Name": "ok-2",
    "CPU Count": "2",
    "AWS Like-to-Like Instance": "m5.large",
    "AZURE Like-to-Like Instance": "D2s_v5",
    "AWS No Match Reason": "",
    "AZURE No Match Reason": "",
    "AWS Rules Applied": "",
    "AZURE Rules Applied": "",
  },
];

run(`
  columnHeaders = ["VM Name", "CPU Count"];
  processedResults = ${JSON.stringify(results)};
`);

console.log("[getNoMatchRows]");
const rows = run("getNoMatchRows(processedResults)");
check(
  "2 of 5 rows qualify",
  rows.length === 2,
  JSON.stringify(rows.map((r) => r["VM Name"])),
);
check(
  "partially-matched row excluded",
  !rows.some((r) => r["VM Name"] === "partial-1"),
);

console.log("[CSV menu state]");
run("renderCsvMenu(processedResults)");
check(
  "No-Match item listed with count",
  elements.csvMenu.innerHTML.includes("No-Match Rows CSV (2)"),
  elements.csvMenu.innerHTML,
);

run(`renderCsvMenu([${JSON.stringify(results[0])}])`);
check(
  "No-Match item absent on an all-match run",
  !elements.csvMenu.innerHTML.includes("No-Match Rows CSV"),
  elements.csvMenu.innerHTML,
);

console.log("[download selected CSVs]");
run("renderCsvMenu(processedResults)");
// Simulate the two checked boxes the browser's ':checked' selector would return.
elements.csvMenu.querySelectorAll = () => [
  { value: "results" },
  { value: "nomatch" },
];
downloads.length = 0;
run("downloadSelectedCsvs()");
check(
  "exactly the checked exports fire (results + no-match, not app summary)",
  downloads.length === 2 &&
    downloads.some((d) =>
      (d.name || "").includes("instance_recommendations"),
    ) &&
    downloads.some((d) => (d.name || "").includes("no_match_rows")),
  downloads.map((d) => d.name).join(", "),
);
// Nothing checked → a warning, no downloads. Assert BOTH halves: the toast is
// the user-visible half, and checking only downloads.length would pass even if
// the warning quietly stopped firing.
elements.csvMenu.querySelectorAll = () => [];
downloads.length = 0;
toasts.length = 0;
run("downloadSelectedCsvs()");
check("an empty selection downloads nothing", downloads.length === 0);
check(
  "an empty selection warns the user",
  toasts.length > 0,
  JSON.stringify(toasts),
);

console.log("[export content]");
run("downloadNoMatchRows()");
check(
  "file named no_match_rows_<date>.csv",
  downloads.length === 1 &&
    /^no_match_rows_\d{4}-\d{2}-\d{2}\.csv$/.test(downloads[0].name),
  JSON.stringify(downloads.map((d) => d.name)),
);
// Guard the deref: if downloadNoMatchRows() posted nothing, the check above
// already recorded a failure — reading .blob.content unguarded would then throw
// and abort every later assertion (the all-match guard, the alerts check).
const raw = downloads[0]?.blob?.content ?? "";
// Excel needs the BOM to read the file as UTF-8; everything else ignores it
check("CSV starts with a UTF-8 BOM", raw.charCodeAt(0) === 0xfeff);
// ﻿, not a literal BOM: an invisible U+FEFF in the pattern is unreviewable
// in a diff, and any "strip zero-width characters" formatter would turn it into
// /^/ — which strips nothing and makes the header assertion below fail for a
// reason no one could see.
const csv = raw.replace(/^\uFEFF/, "");
const lines = csv.split("\n");
check(
  "header = input cols + diagnostics",
  lines[0] ===
    "VM Name,CPU Count,AWS No Match Reason,AZURE No Match Reason,AWS Rules Applied,AZURE Rules Applied",
  lines[0],
);
check("2 data rows", lines.length === 3);
check(
  "exact rows exported",
  lines[1].startsWith("bad-1") && lines[2].startsWith("bad-2"),
);
check("formula-injection hardened", lines[1].includes("'=2+2"), lines[1]);
check("reasons included", lines[1].includes("Region 'narnia' not found"));

console.log("[all-match export guard]");
// toasts still holds the empty-selection warning from the block above; clear it
// so this assertion reads only the toast (if any) from the call under test.
toasts.length = 0;
run(
  `processedResults = [${JSON.stringify(results[0])}]; downloadNoMatchRows();`,
);
check(
  "toast instead of empty file",
  toasts.some((t) => /nothing to export/.test(t.message)),
  JSON.stringify(toasts),
);
check("no second download", downloads.length === 1);

// The harness captures alert() so a stray native dialog from a loaded module
// does not vanish silently — but capturing is only worth it if we assert it.
check(
  "no module reached for a native alert()",
  alerts.length === 0,
  alerts.join(" | "),
);

// process.exitCode, not process.exit(): exit() can truncate buffered stdout when
// it is a pipe — exactly the CI case — losing the FAIL: lines this suite emits.
process.exitCode = failures ? 1 : 0;

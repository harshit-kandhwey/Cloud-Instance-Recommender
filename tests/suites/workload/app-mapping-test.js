// App→workload mapping verification (batch item 4, commit A):
//   - App Name column detection + synonym recognition
//   - resolveRowWorkload precedence (Workload cell > app map > default > General)
//   - app→workload map persistence round-trip
//   - the app mapping panel (shown only with App Name + no Workload)
const { buildContext } = require("../harness");

// Full app on the AWS page. localStorage is the harness's real Map-backed store,
// so the app→workload map round-trips; a block below swaps in a throwing setItem
// to prove a failed save is surfaced, then restores it. A mapping panel's <select>
// list is simulated by reassigning an element's querySelectorAll.
const { ctx, run, elements } = buildContext();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("[App Name is a mappable canonical]");
check(
  "App Name offered in the mapping panel (pageCanonicals)",
  run('pageCanonicals().includes("App Name")'),
);
check(
  '"Application" auto-maps to App Name',
  run(
    'autoMatchHeaders(["VM Name","Application","CPU Count"]).mapping["Application"]',
  ) === "App Name",
);
check(
  '"service name" auto-maps to App Name',
  run('autoMatchHeaders(["Server","service name"]).mapping["service name"]') ===
    "App Name",
);
check(
  'exact "App Name" maps to itself',
  run('autoMatchHeaders(["App Name","CPU Count"]).mapping["App Name"]') ===
    "App Name",
);
check(
  '"App Name" is optional — its absence does not force the panel',
  run('autoMatchHeaders(["VM Name","CPU Count","Memory (GB)"]).needsReview') ===
    false,
);
check(
  "unusual header (Business Unit) does NOT auto-map to App Name",
  run(
    'Object.values(autoMatchHeaders(["VM Name","Business Unit","CPU Count"]).mapping).includes("App Name")',
  ) === false,
);

console.log("[resolveRowWorkload precedence]");
check(
  "row Workload cell wins over app map + default",
  run(
    'resolveRowWorkload({ "Workload": "Database", "App Name": "x" }, { appWorkloadMap: { x: "Cache" }, ruleDefaultWorkload: "Web Server" })',
  ) === "Database",
);
check(
  "app map used when no Workload cell",
  run(
    'resolveRowWorkload({ "App Name": "Billing App" }, { appWorkloadMap: { "billing app": "Cache" }, ruleDefaultWorkload: "HPC" })',
  ) === "Cache",
);
check(
  "app match is case-insensitive",
  run(
    'resolveRowWorkload({ "App Name": "BILLING" }, { appWorkloadMap: { billing: "Batch" } })',
  ) === "Batch",
);
check(
  "page default when no cell/app match",
  run('resolveRowWorkload({}, { ruleDefaultWorkload: "HPC" })') === "HPC",
);
check(
  'built-in "General" fallback',
  run("resolveRowWorkload({}, {})") === "General",
);
// App Name is untrusted CSV data — inherited Object.prototype keys must not
// leak through the map lookup (would be a truthy function → .trim() throws).
check(
  'app name "constructor" does not crash the lookup',
  run(
    'resolveRowWorkload({ "App Name": "constructor" }, { appWorkloadMap: {} })',
  ) === "General",
);
check(
  'app name "hasOwnProperty" does not crash the lookup',
  run(
    'resolveRowWorkload({ "App Name": "hasOwnProperty" }, { appWorkloadMap: {} })',
  ) === "General",
);
// The guard must not over-block: an app genuinely named "constructor" with its
// own mapping entry should still resolve to that workload.
check(
  'app name "constructor" resolves its own mapped workload',
  run(
    'resolveRowWorkload({ "App Name": "constructor" }, { appWorkloadMap: { constructor: "Database" } })',
  ) === "Database",
);

console.log("[map persistence round-trip]");
run('saveAppWorkloadMap({ billing: "Database", web: "Web Server" })');
check(
  "load returns saved map",
  run(
    'JSON.stringify(loadAppWorkloadMap()) === JSON.stringify({ billing: "Database", web: "Web Server" })',
  ),
  run("localStorage.getItem('cloudInstanceRecommenderAppMap')"),
);

console.log("[panel visibility]");
run(`
  columnHeaders = ["VM Name", "App Name", "CPU Count"];
  csvData = [
    { "VM Name": "a", "App Name": "Billing", "CPU Count": "2" },
    { "VM Name": "b", "App Name": "Web Portal", "CPU Count": "4" },
    { "VM Name": "c", "App Name": "Billing", "CPU Count": "2" },
  ];
  maybeShowAppMappingPanel();
`);
check(
  "panel shown with App Name + no Workload",
  !elements.appMappingSection.classes.has("hidden"),
);
check(
  "panel lists both distinct apps",
  elements.appMappingSection.innerHTML.includes("Billing") &&
    elements.appMappingSection.innerHTML.includes("Web Portal"),
);
check(
  "panel has a Save button and a select per app",
  elements.appMappingSection.innerHTML.includes("applyAppMapping()") &&
    (elements.appMappingSection.innerHTML.match(/data-app=/g) || []).length ===
      2,
);

run(`
  columnHeaders = ["VM Name", "App Name", "CPU Count"];
  csvData = [
    { "VM Name": "a", "App Name": "Billing", "CPU Count": "2" },
    { "VM Name": "b", "App Name": "billing", "CPU Count": "4" },
  ];
  maybeShowAppMappingPanel();
`);
check(
  "case-variant app names dedupe to one row",
  (elements.appMappingSection.innerHTML.match(/data-app=/g) || []).length === 1,
  elements.appMappingSection.innerHTML,
);

run(`
  columnHeaders = ["VM Name", "App Name", "Workload"];
  csvData = [{ "VM Name": "a", "App Name": "Billing", "Workload": "Database" }];
  maybeShowAppMappingPanel();
`);
check(
  "panel hidden when a Workload column exists",
  elements.appMappingSection.classes.has("hidden"),
);

run(`
  columnHeaders = ["VM Name", "CPU Count"];
  csvData = [{ "VM Name": "a", "CPU Count": "2" }];
  maybeShowAppMappingPanel();
`);
check(
  "panel hidden when no App Name column",
  elements.appMappingSection.classes.has("hidden"),
);

console.log("[applyAppMapping]");
// Start from a known map, then simulate the panel's selects
run('saveAppWorkloadMap({ web: "Cache" })');
elements.appMappingSection.querySelectorAll = () => [
  { getAttribute: () => "Billing", value: "Database" },
  { getAttribute: () => "Web", value: "" }, // blank clears the app
];
run("applyAppMapping()");
check(
  "selected app persisted, blank app cleared",
  run(
    'JSON.stringify(loadAppWorkloadMap()) === JSON.stringify({ billing: "Database" })',
  ),
  run("localStorage.getItem('cloudInstanceRecommenderAppMap')"),
);

console.log("[persistence failure is surfaced, not reported as saved]");
// Simulate storage being unavailable (quota exceeded / private browsing):
// saveAppWorkloadMap must report failure and applyAppMapping must say so.
const realSetItem = ctx.localStorage.setItem;
ctx.localStorage.setItem = () => {
  throw new Error("storage unavailable");
};
try {
  check(
    "saveAppWorkloadMap returns false when storage throws",
    run('saveAppWorkloadMap({ x: "Cache" })') === false,
  );
  elements.appMappingSection.querySelectorAll = () => [
    { getAttribute: () => "Billing", value: "Database" },
  ];
  run("applyAppMapping()");
  check(
    "applyAppMapping shows a failure notice, not '✓ Saved'",
    /could not save/i.test(elements.appMappingStatus.textContent) &&
      !elements.appMappingStatus.textContent.includes("✓"),
    elements.appMappingStatus.textContent,
  );
} finally {
  // Restore even if a check throws, so later suites see a working setItem.
  ctx.localStorage.setItem = realSetItem;
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = failures ? 1 : 0;

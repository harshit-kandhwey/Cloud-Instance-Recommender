// App Portfolio analytics engine verification (App Portfolio, commit 2):
//   - buildPortfolioModel grouping (named apps + Unassigned bucket)
//   - per-app resource totals, ENV/OS/workload/compliance mixes, regions
//   - recommended-family extraction per provider (AWS/AZURE/GCP naming)
//   - match health + top no-match reasons
//   - right-sizing counts (Optimized runs, vCPU-based)
//   - estate totals, rankings, workload totals
// portfolio.js gets isNoMatchValue/getInstanceColumns/PORTFOLIO_STORAGE_KEY
// from app-core.js (shared), so this loads only app-core.js + portfolio.js —
// the tool-page modules (preview.js/downloads.js) aren't needed here.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");

const els = {};
function fakeEl(id) {
  if (!els[id])
    els[id] = {
      id,
      innerHTML: "",
      classes: new Set(id === "portfolioContent" ? ["hidden"] : []),
      classList: {
        add: (c) => els[id].classes.add(c),
        remove: (c) => els[id].classes.delete(c),
        contains: (c) => els[id].classes.has(c),
      },
    };
  return els[id];
}

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  location: { origin: "https://x.test", pathname: "/app-portfolio.html" },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
sandbox.window = sandbox;
sandbox.window.opener = null;
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
// Records the data-row of the last .pf-row-toggle focused, so the focus
// restoration in togglePortfolioAppRow can be asserted.
let lastFocusedRow = null;
sandbox.document = {
  readyState: "complete",
  documentElement: { dataset: {} },
  getElementById: (id) => fakeEl(id),
  addEventListener: () => {},
  querySelector: (sel) => {
    const m = /\.pf-row-toggle\[data-row="(\d+)"\]/.exec(sel || "");
    if (m)
      return {
        focus() {
          lastFocusedRow = m[1];
        },
      };
    return null;
  },
  querySelectorAll: () => [],
  head: { appendChild() {} },
  body: { appendChild() {} },
};
const ctx = vm.createContext(sandbox);
const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
load("js/base/app-core.js");
load("js/base/portfolio.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}
const run = (expr) => vm.runInContext(expr, ctx);

// AWS + AZURE, "both" recommendation types (Optimized present → right-sizing).
const payload = {
  version: 1,
  generatedAt: "2026-07-05T00:00:00.000Z",
  sourcePage: "multicloud",
  providers: ["aws", "azure"],
  columnHeaders: ["VM Name", "App Name", "CPU Count", "Memory (GB)"],
  dataDates: { AWS: "2026-06-27", AZURE: "2026-06-27" },
  hasOptimized: true,
  hasLikeToLike: true,
  results: [
    // Billing — 2 matched VMs, multi-region, PCI on one
    {
      "VM Name": "b1",
      "App Name": "Billing",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "AWS Region": "us-east-1",
      "Azure Region": "East US",
      ENV: "Production",
      OS: "Linux",
      Workload: "Web Server",
      Compliance: "",
      "AWS Like-to-Like Instance": "m6g.xlarge",
      "AWS Optimized Instance": "m5.large",
      "AWS Optimized vCPUs": "2",
      "AWS No Match Reason": "",
      "AZURE Like-to-Like Instance": "d4psv6",
      "AZURE Optimized Instance": "d4psv6",
      "AZURE Optimized vCPUs": "4",
      "AZURE No Match Reason": "",
    },
    {
      "VM Name": "b2",
      "App Name": "Billing",
      "CPU Count": "8",
      "Memory (GB)": "32",
      "AWS Region": "us-west-2",
      "Azure Region": "West US 2",
      ENV: "Production",
      OS: "Windows",
      Workload: "Database",
      Compliance: "PCI",
      "AWS Like-to-Like Instance": "r5a.2xlarge",
      "AWS Optimized Instance": "r5a.2xlarge",
      "AWS Optimized vCPUs": "8",
      "AWS No Match Reason": "",
      "AZURE Like-to-Like Instance": "e8asv5",
      "AZURE Optimized Instance": "e8asv5",
      "AZURE Optimized vCPUs": "8",
      "AZURE No Match Reason": "",
    },
    // Analytics — 1 fully-unmatched VM (both providers no-match)
    {
      "VM Name": "an1",
      "App Name": "Analytics",
      "CPU Count": "2",
      "Memory (GB)": "8",
      ENV: "Dev",
      OS: "Linux",
      Workload: "General",
      Compliance: "",
      "AWS Like-to-Like Instance": "No data available",
      "AWS Optimized Instance": "No data available",
      "AWS Optimized vCPUs": "",
      "AWS No Match Reason": "No instances in region",
      "AZURE Like-to-Like Instance": "No data available",
      "AZURE Optimized Instance": "No data available",
      "AZURE Optimized vCPUs": "",
      "AZURE No Match Reason": "No instances in region",
    },
    // Unassigned (blank App Name) — 1 matched VM
    {
      "VM Name": "u1",
      "App Name": "",
      "CPU Count": "16",
      "Memory (GB)": "64",
      ENV: "Staging",
      OS: "Linux",
      "AWS Like-to-Like Instance": "m6i.4xlarge",
      "AWS Optimized Instance": "m6i.4xlarge",
      "AWS Optimized vCPUs": "16",
      "AWS No Match Reason": "",
      "AZURE Optimized Instance": "No data available",
      "AZURE Optimized vCPUs": "",
      "AZURE No Match Reason": "",
    },
  ],
};
run(`__payload = ${JSON.stringify(payload)};`);
run("__m = buildPortfolioModel(__payload);");

console.log("[grouping + estate]");
check("2 named apps", run("__m.apps.length") === 2);
check(
  "apps sorted alphabetically (Analytics, Billing)",
  run('__m.apps.map(a => a.app).join(",")') === "Analytics,Billing",
);
check("Unassigned bucket present (1 VM)", run("__m.unassigned.vms") === 1);
check(
  "estate apps=2 vms=4",
  run("__m.estate.apps") === 2 && run("__m.estate.vms") === 4,
);
check("estate vcpus = 30", run("__m.estate.vcpus") === 30);
check("estate memory = 120", run("__m.estate.memory") === 120);
check(
  "estate matched=3 noMatch=1 matchRate=75",
  run("__m.estate.matched") === 3 &&
    run("__m.estate.noMatch") === 1 &&
    run("__m.estate.matchRate") === 75,
);

console.log("[estate distribution aggregates]");
// ENV / OS are per-VM tallies summed across named apps + Unassigned, so each
// reconciles to estate.vms (4). Billing 2×Production, Analytics 1×Dev,
// Unassigned 1×Staging; OS: Linux b1/an1/u1 (3), Windows b2 (1).
check(
  "estate envMix {Production:2, Dev:1, Staging:1}",
  run("__m.estate.envMix.Production") === 2 &&
    run("__m.estate.envMix.Dev") === 1 &&
    run("__m.estate.envMix.Staging") === 1,
  run("JSON.stringify(__m.estate.envMix)"),
);
check(
  "estate osMix {Linux:3, Windows:1}",
  run("__m.estate.osMix.Linux") === 3 && run("__m.estate.osMix.Windows") === 1,
  run("JSON.stringify(__m.estate.osMix)"),
);
// AWS: Billing 1 downsize + 1 same, Unassigned u1 same → downsize 1, same 2.
// AZURE: Billing 2 same → same 2. (Analytics is all no-match, contributes none.)
check(
  "estate rightSizing.aws downsize 1 / same 2 / upsize 0",
  run("__m.estate.rightSizing.aws.downsize") === 1 &&
    run("__m.estate.rightSizing.aws.same") === 2 &&
    run("__m.estate.rightSizing.aws.upsize") === 0,
  run("JSON.stringify(__m.estate.rightSizing.aws)"),
);
check(
  "estate rightSizing.azure same 2",
  run("__m.estate.rightSizing.azure.same") === 2 &&
    run("__m.estate.rightSizing.azure.downsize") === 0,
  run("JSON.stringify(__m.estate.rightSizing.azure)"),
);
check(
  "estate rightSizing is null when no Optimized picks ran",
  run(
    '__lo = buildPortfolioModel({ providers: ["aws"], hasOptimized: false, results: [{ "App Name": "A", "CPU Count": "2", "Memory (GB)": "4", "AWS Like-to-Like Instance": "t3.small" }] }); __lo.estate.rightSizing',
  ) === null,
);

console.log("[per-app: Billing]");
check(
  "Billing 2 VMs / 12 vCPUs / 48 GB",
  run(
    '__b = __m.apps.find(a=>a.app==="Billing"); [__b.vms,__b.vcpus,__b.memory].join(",")',
  ) === "2,12,48",
);
check(
  "Billing fully matched (100%)",
  run("__b.matched") === 2 && run("__b.matchRate") === 100,
);
check("Billing ENV mix {Production:2}", run("__b.envMix.Production") === 2);
check(
  "Billing OS mix Linux+Windows",
  run("__b.osMix.Linux") === 1 && run("__b.osMix.Windows") === 1,
);
check(
  "Billing workload mix Web Server + Database",
  run('__b.workloadMix["Web Server"]') === 1 &&
    run("__b.workloadMix.Database") === 1,
);
check(
  "Billing compliance {PCI:1}, flagged",
  run("__b.compliance.PCI") === 1 && run("__b.hasCompliance") === true,
);
check(
  "Billing multi-region (4 distinct)",
  run("__b.regions.length") === 4 && run("__b.multiRegion") === true,
);

console.log("[family extraction]");
check(
  "Billing AWS families m5 + r5a",
  run("__b.families.aws.m5") === 1 && run("__b.families.aws.r5a") === 1,
);
check(
  "Billing AZURE families D + E",
  run("__b.families.azure.D") === 1 && run("__b.families.azure.E") === 1,
);
check(
  'extractFamily aws "m6g.xlarge" → m6g',
  run('extractFamily("aws","m6g.xlarge")') === "m6g",
);
check(
  'extractFamily azure "d4psv6" → D',
  run('extractFamily("azure","d4psv6")') === "D",
);
check(
  'extractFamily gcp "e2-standard-4" → e2',
  run('extractFamily("gcp","e2-standard-4")') === "e2",
);
check(
  "extractFamily ignores no-match sentinel",
  run('extractFamily("aws","No data available")') === null,
);

console.log("[right-sizing (vCPU-based, Optimized)]");
check(
  "Billing AWS right-sizing: 1 downsize, 1 same",
  run("__b.rightSizing.aws.downsize") === 1 &&
    run("__b.rightSizing.aws.same") === 1 &&
    run("__b.rightSizing.aws.upsize") === 0,
);
check(
  "Billing AZURE right-sizing: 2 same",
  run("__b.rightSizing.azure.same") === 2 &&
    run("__b.rightSizing.azure.downsize") === 0,
);

console.log("[match health: Analytics]");
check(
  "Analytics 0 matched / 1 no-match / 0%",
  run(
    '__a = __m.apps.find(a=>a.app==="Analytics"); [__a.matched,__a.noMatch,__a.matchRate].join(",")',
  ) === "0,1,0",
);
check(
  "Analytics top no-match reason counted per provider (x2)",
  run("__a.noMatchReasons.length") === 1 &&
    run("__a.noMatchReasons[0].reason") === "No instances in region" &&
    run("__a.noMatchReasons[0].count") === 2,
  run("JSON.stringify(__a.noMatchReasons)"),
);

console.log("[rankings + workload totals]");
check(
  "bySize ranks Billing first",
  run("__m.rankings.bySize[0].app") === "Billing",
);
check(
  "worstMatchRate surfaces Analytics",
  run("__m.rankings.worstMatchRate[0].app") === "Analytics",
);
check(
  "complianceSensitive = [Billing]",
  run("__m.rankings.complianceSensitive.length") === 1 &&
    run("__m.rankings.complianceSensitive[0].app") === "Billing",
);
check(
  "workload totals across estate (incl. Unassigned 'Unspecified')",
  run('__m.workloadTotals["Web Server"]') === 1 &&
    run("__m.workloadTotals.Database") === 1 &&
    run("__m.workloadTotals.General") === 1 &&
    run("__m.workloadTotals.Unspecified") === 1,
  run("JSON.stringify(__m.workloadTotals)"),
);

console.log("[predicate parity + edge cases]");
check(
  "isNoMatchValue parity",
  run('isNoMatchValue("No data available")') === true &&
    run('isNoMatchValue("m5.large")') === false &&
    run('isNoMatchValue("")') === true,
);
check(
  "empty payload → zeroed model, no throw",
  run(
    "__e = buildPortfolioModel({ results: [], providers: [] }); __e.estate.apps === 0 && __e.apps.length === 0 && __e.unassigned === null",
  ),
);
check(
  "no App Name column → everything Unassigned, 0 named apps",
  run(
    '__n = buildPortfolioModel({ providers: ["aws"], results: [{ "CPU Count": "2", "Memory (GB)": "4", "AWS Optimized Instance": "t3.small" }] }); __n.apps.length === 0 && __n.unassigned.vms === 1',
  ),
);

console.log("[UI render]");
run("receivePortfolio(__payload)");
const cHtml = els.portfolioContent.innerHTML;
check(
  "empty state hidden once data renders",
  els.portfolioEmpty.classes.has("hidden"),
);
check(
  "Overview + per-app + Unassigned tabs rendered",
  /📊 Overview/.test(cHtml) &&
    /data-tab="app-0"/.test(cHtml) &&
    />Billing</.test(cHtml) &&
    />Analytics</.test(cHtml) &&
    /data-tab="unassigned"/.test(cHtml),
);
check("overview KPI shows 4 VMs", /counter-number">4</.test(cHtml));
check(
  "app table body lists apps",
  els["pf-app-tbody"] &&
    /Billing/.test(els["pf-app-tbody"].innerHTML) &&
    /Analytics/.test(els["pf-app-tbody"].innerHTML),
  els["pf-app-tbody"] && els["pf-app-tbody"].innerHTML,
);
check(
  "per-app panels render VM detail + recommended families",
  /VM detail/.test(cHtml) && /Recommended families/.test(cHtml),
);
check("right-sizing block present (Optimized run)", /Right-sizing/.test(cHtml));
check(
  "overview renders the estate distribution charts (doughnuts + verdict bar)",
  /Estate distribution/.test(cHtml) &&
    /Environment mix/.test(cHtml) &&
    /<svg/.test(cHtml) &&
    /Right-sizing verdict/.test(cHtml),
);

console.log("[UI interactions]");
run('filterPortfolioApps("bill")');
check(
  "filter narrows the app table to Billing",
  /Billing/.test(els["pf-app-tbody"].innerHTML) &&
    !/Analytics/.test(els["pf-app-tbody"].innerHTML),
);
run('filterPortfolioApps("")');
run(
  "togglePortfolioAppRow(portfolioModel.apps.findIndex(a=>a.app==='Billing'))",
);
check(
  "expanding a row reveals its VM table",
  /pf-detail-row/.test(els["pf-app-tbody"].innerHTML),
);
check(
  "toggling a row restores focus to its toggle button",
  lastFocusedRow ===
    String(run("portfolioModel.apps.findIndex(a=>a.app==='Billing')")),
  `lastFocusedRow=${lastFocusedRow}`,
);

console.log("[sheet-name sanitization]");
check(
  "strips illegal chars : \\ / ? * [ ]",
  run(`sanitizeSheetName("A/B:C[D]*?")`) === "A_B_C_D",
);
check(
  "truncates to 31 chars",
  run(`sanitizeSheetName("x".repeat(40)).length`) === 31,
);
check('blank → "Sheet"', run(`sanitizeSheetName("   ")`) === "Sheet");
check('all-illegal → "Sheet"', run(`sanitizeSheetName("[]")`) === "Sheet");
check(
  "dedupes case-insensitively with numeric suffixes",
  run(
    `(function(){var u=new Set();return [uniqueSheetName("App",u),uniqueSheetName("app",u),uniqueSheetName("APP",u)].join("|");})()`,
  ) === "App|app (2)|APP (3)",
);

console.log("[workbook model]");
const wbModel = run("buildPortfolioWorkbookModel(__m)");
check(
  "sheets: Summary, Contents, 2 apps, Unassigned, About",
  wbModel.sheets.map((s) => s.name).join("|") ===
    "Portfolio Summary|Contents|Analytics|Billing|Unassigned|About",
  wbModel.sheets.map((s) => s.name).join("|"),
);
const summarySheet = wbModel.sheets[0];
check(
  "summary title merged across 13 columns",
  summarySheet.merges[0].e.c === 12,
);
check(
  "summary autofilter spans header + 2 apps + Unassigned",
  summarySheet.autofilter === "A4:M7",
);
check(
  "summary includes an Unassigned row (reconciles to TOTAL)",
  summarySheet.rows.some((r) => r[0] === "Unassigned (no App Name)"),
);
const totalRow = summarySheet.rows[summarySheet.rows.length - 1];
check(
  "summary TOTAL row is present and styled",
  totalRow[0].v === "TOTAL (estate)" &&
    totalRow[0].s === "total" &&
    totalRow[2].v === 30,
);
const contentsLinks = wbModel.sheets[1].rows
  .filter((r) => r[0] && r[0].l)
  .map((r) => r[0].l.Target);
check(
  "contents links target every sheet",
  contentsLinks.includes("#'Portfolio Summary'!A1") &&
    contentsLinks.includes("#'Billing'!A1") &&
    contentsLinks.includes("#'Unassigned'!A1") &&
    contentsLinks.includes("#'About'!A1"),
  contentsLinks.join(", "),
);
const billingSheet = wbModel.sheets.find((s) => s.name === "Billing");
check(
  "app sheet: title + back-to-Contents link + autofilter",
  billingSheet?.rows?.[0]?.[0]?.v === "Billing" &&
    billingSheet?.rows?.[1]?.[0]?.l?.Target === "#'Contents'!A1" &&
    /^A\d+:[A-Z]+\d+$/.test(billingSheet?.autofilter || ""),
  JSON.stringify(billingSheet?.rows?.slice(0, 2)),
);
// Find the About sheet by name rather than a fixed index, and guard the deref:
// a dropped row or a changed sheet count should be one named FAIL, not a throw
// that aborts the xlsx write smoke, the reuse checks and the per-app CSV export.
const aboutSheet = wbModel.sheets.find((s) => s.name === "About");
check(
  "About sheet notes pricing is excluded",
  JSON.stringify(aboutSheet?.rows || []).includes("Intentionally excluded"),
);

console.log("[xlsx write smoke — vendored styling fork]");
load("js/vendor/xlsx-js-style.min.js");
check(
  "styling fork loaded (XLSX.utils + style_version)",
  !!(sandbox.XLSX && sandbox.XLSX.utils) && sandbox.XLSX.style_version != null,
);

// The reuse short-circuit in ensurePortfolioXlsx: when an engine that can
// already style is present (the fork sets style_version — e.g. the results
// export loaded it earlier), the portfolio loader adopts it as the writer
// instead of loading a second copy. The load path assigns _xlsxWriter only
// AFTER an async script load, so a synchronous writer assignment right after
// the call is the tell that the short-circuit fired (loadScriptOnce is never
// reached — document.head.appendChild here is a no-op that would never resolve).
run("window._xlsxWriter = null;");
run("__pfReuse = ensurePortfolioXlsx();");
check(
  "reuse: an already-styling engine becomes the writer without loading a second copy",
  run("window._xlsxWriter === window.XLSX"),
);
check(
  "reuse: the resolved promise is cached (a second call returns the same one)",
  run("ensurePortfolioXlsx() === __pfReuse"),
);

run("__wb = writeWorkbook(buildPortfolioWorkbookModel(__m), true);");
check(
  "workbook carries all sheet names",
  run(`__wb.SheetNames.join("|")`) ===
    "Portfolio Summary|Contents|Analytics|Billing|Unassigned|About",
);
check(
  "workbook serializes to xlsx bytes",
  run(`XLSX.write(__wb, { type: "base64", bookType: "xlsx" }).length`) > 1000,
);

// ── Overview filters: name search + no-match-only + compliance-only ────────────
// Billing: 2 matched VMs, one PCI (compliance, no no-match).
// Analytics: 1 fully-unmatched VM (no-match, no compliance).
console.log("[overview filters]");
run("__flt = (st) => portfolioFilterApps(__m.apps, st).map((a) => a.app);");
check(
  "no-match-only keeps just the app with an unmatched VM",
  JSON.stringify(run("__flt({ noMatchOnly: true })")) ===
    JSON.stringify(["Analytics"]),
  run("JSON.stringify(__flt({ noMatchOnly: true }))"),
);
check(
  "compliance-only keeps just the compliance-sensitive app",
  JSON.stringify(run("__flt({ complianceOnly: true })")) ===
    JSON.stringify(["Billing"]),
  run("JSON.stringify(__flt({ complianceOnly: true }))"),
);
check(
  "the name search still narrows by substring",
  JSON.stringify(run("__flt({ filter: 'bill' })")) ===
    JSON.stringify(["Billing"]),
);
check(
  "combined toggles AND together (no app is both here)",
  run("__flt({ noMatchOnly: true, complianceOnly: true }).length") === 0,
);
check("no filters returns every app", run("__flt({}).length") === 2);

// ── Per-app CSV export (buildAppCsv) ───────────────────────────────────────────
console.log("[per-app CSV export]");
run("__billing = __m.apps.find((a) => a.app === 'Billing');");
run("__cols = vmDetailColumns(__m, __billing);");
run("__csv = buildAppCsv(__billing, __cols);");
check(
  "the CSV header is the detail columns and starts with VM Name",
  run('__csv.split("\\n")[0].startsWith("VM Name")'),
  run('__csv.split("\\n")[0]'),
);
check(
  "one header row plus one row per VM (2 VMs → 3 lines)",
  run('__csv.split("\\n").length') === 3,
  run('String(__csv.split("\\n").length)'),
);
check(
  "both Billing VMs are written",
  run('__csv.includes("b1") && __csv.includes("b2")'),
);
// Injection + comma hardening, via the shared escapeCsvCell.
run(
  '__evil = buildAppCsv({ rows: [{ "VM Name": "=HYPERLINK(1)", "App Name": "a,b" }] }, ["VM Name", "App Name"]);',
);
check(
  "a leading = is neutralised and a comma-bearing cell is quoted",
  run('__evil.includes("\'=HYPERLINK(1)")') &&
    run("__evil.includes('\"a,b\"')"),
  run("__evil"),
);

process.exitCode = failures ? 1 : 0;

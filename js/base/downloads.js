// Downloads & stats: results CSV, no-match remediation export, AWS bulk
// template, and usage statistics.

function downloadResults() {
  if (!processedResults || processedResults.length === 0) {
    alert("No results to download. Please generate recommendations first.");
    return;
  }

  console.log("Downloading results with", processedResults.length, "rows");

  // Every row, in the order the preview is currently sorted by
  const rows = resultsInPreviewOrder(processedResults);
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvCell(row[header] ?? "")).join(","),
    ),
  ].join("\n");

  // Download
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = exportFilename("instance_recommendations", "csv");
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  console.log("CSV download completed");
}

// getInstanceColumns / isNoMatchValue are defined in app-core.js (shared with
// the preview and the App Portfolio page).

// ─── No-match remediation export ──────────────────────────────────────────────
// A row qualifies when EVERY instance column present is a no-match.
function getNoMatchRows(results) {
  if (!results || !results.length) return [];
  const instCols = getInstanceColumns(results);
  if (!instCols.length) return [];
  return results.filter((row) => instCols.every((c) => isNoMatchValue(row[c])));
}

// Exports the fully-unmatched rows with their original input columns plus
// the diagnostic columns (No Match Reason / Rules Applied) — a remediation
// worksheet: fix these rows, re-upload, re-generate.
function downloadNoMatchRows() {
  const noMatch = getNoMatchRows(resultsInPreviewOrder(processedResults));
  if (!noMatch.length) {
    alert(
      "Every row received at least one recommendation — nothing to export.",
    );
    return;
  }

  const resultKeys = Object.keys(processedResults[0]);
  const inputHeaders = columnHeaders.filter((h) => resultKeys.includes(h));
  const diagCols = resultKeys.filter(
    (k) =>
      (k.includes("No Match Reason") || k.includes("Rules Applied")) &&
      !inputHeaders.includes(k),
  );
  const headers = [...inputHeaders, ...diagCols];

  const csvContent = [
    headers.map(escapeCsvCell).join(","),
    ...noMatch.map((row) =>
      headers.map((h) => escapeCsvCell(row[h] ?? "")).join(","),
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = exportFilename("no_match_rows", "csv");
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  console.log(`No-match export completed: ${noMatch.length} rows`);
}

// Shows the no-match button with a count badge, or hides it on all-match runs
function updateNoMatchButton(results) {
  const btn = document.getElementById("downloadNoMatchBtn");
  if (!btn) return;
  const count = getNoMatchRows(results).length;
  if (count > 0) {
    btn.textContent = `⚠️ No-Match Rows CSV (${count})`;
    btn.title = `${count} row(s) got no recommendation from any provider — download them with reasons to fix and re-upload`;
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
  updateAnalysisGroupVisibility();
}

// The three Analysis buttons toggle independently; hide their labeled cluster
// when none of them is visible so the label never sits over an empty group.
function updateAnalysisGroupVisibility() {
  const group = document.getElementById("analysisGroup");
  if (!group) return;
  const anyVisible = [
    "downloadNoMatchBtn",
    "downloadAppSummaryBtn",
    "openAppPortfolioBtn",
  ].some((id) => {
    const btn = document.getElementById(id);
    return btn && !btn.classList.contains("hidden");
  });
  if (anyVisible) group.classList.remove("hidden");
  else group.classList.add("hidden");
}

// ─── Per-app rollup / App Summary export ──────────────────────────────────────
// Aggregates the per-VM results by App Name: VM count, total vCPUs / memory,
// and how many VMs did / didn't get a recommendation. Recommendations stay
// per-VM in the main export — this is a reporting rollup on top. Returns [] when
// there is no App Name column. VMs with a blank App Name belong to no app and
// are skipped, so the count matches the "N apps" chip in the stats bar.
function getAppSummary(results) {
  if (!results || !results.length) return [];
  const keys = Object.keys(results[0]);
  if (!keys.includes("App Name")) return [];
  const instCols = getInstanceColumns(results);
  const byApp = new Map();
  results.forEach((row) => {
    const app = String(row["App Name"] || "").trim();
    if (!app) return; // VMs with no app aren't part of any app rollup
    if (!byApp.has(app)) {
      byApp.set(app, {
        app,
        vms: 0,
        vcpus: 0,
        memory: 0,
        matched: 0,
        noMatch: 0,
      });
    }
    const s = byApp.get(app);
    s.vms++;
    s.vcpus += parseInt(row["CPU Count"], 10) || 0;
    s.memory += parseFloat(row["Memory (GB)"]) || 0;
    const hasMatch =
      instCols.length > 0 && instCols.some((c) => !isNoMatchValue(row[c]));
    if (hasMatch) s.matched++;
    else s.noMatch++;
  });
  return [...byApp.values()].sort((a, b) => a.app.localeCompare(b.app));
}

// Exports the per-app rollup as its own CSV — resource totals + match counts.
function downloadAppSummary() {
  const summary = getAppSummary(processedResults);
  if (!summary.length) {
    const hasAppNameCol =
      processedResults &&
      processedResults.length &&
      Object.keys(processedResults[0]).includes("App Name");
    alert(
      hasAppNameCol
        ? "The App Name column is empty for every row — fill it in to get an app summary."
        : "No App Name column in the results — add one to your file to get an app summary.",
    );
    return;
  }

  const headers = [
    "App Name",
    "VMs",
    "Total vCPUs",
    "Total Memory (GB)",
    "Matched VMs",
    "No-Match VMs",
  ];
  const csvContent = [
    headers.map(escapeCsvCell).join(","),
    ...summary.map((s) =>
      [
        s.app,
        s.vms,
        s.vcpus,
        Math.round(s.memory * 100) / 100,
        s.matched,
        s.noMatch,
      ]
        .map(escapeCsvCell)
        .join(","),
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = exportFilename("app_summary", "csv");
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  console.log(`App summary export completed: ${summary.length} apps`);
}

// Shows the app-summary button (with app count) only when results carry an
// App Name column; hidden otherwise.
function updateAppSummaryButton(results) {
  const btn = document.getElementById("downloadAppSummaryBtn");
  if (!btn) return;
  const summary = getAppSummary(results);
  if (summary.length > 0) {
    btn.textContent = `🧩 App Summary CSV (${summary.length})`;
    btn.title = `Per-application rollup of ${summary.length} app(s): VM count, total vCPUs/memory, and match counts`;
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
  updateAnalysisGroupVisibility();
}

// ─── App Portfolio handoff ────────────────────────────────────────────────────
// The dedicated App Portfolio page (app-portfolio.html) renders an
// application-centric dashboard and an executive Excel from a generated result
// set. There is no backend: the data is handed over in-browser via postMessage
// (primary, same-origin, no size cap) with a localStorage copy as a cold-open
// fallback. Shown only when the results carry at least one named app.
// PORTFOLIO_STORAGE_KEY is defined in app-core.js (shared with portfolio.js).

// Which tool page this run originated on — drives the portfolio's About sheet
// and provider inference. Derived from the filename, falling back to the
// selected providers.
function currentSourcePage() {
  const file = (location.pathname.split("/").pop() || "").toLowerCase();
  if (file.includes("multicloud")) return "multicloud";
  if (file.includes("aws")) return "aws";
  if (file.includes("azure")) return "azure";
  if (file.includes("gcp")) return "gcp";
  return selectedProviders.length > 1
    ? "multicloud"
    : selectedProviders[0] || "aws";
}

// Assembles the handoff payload (see the portfolio page's data contract).
// Everything is plain, structured-cloneable data so it survives postMessage.
function buildPortfolioPayload() {
  if (!processedResults || !processedResults.length) return null;
  const keys = Object.keys(processedResults[0]);
  const dataDates = {};
  ["AWS", "AZURE", "GCP"].forEach((p) => {
    if (window[`${p}_DATA_DATE`]) dataDates[p] = window[`${p}_DATA_DATE`];
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourcePage: currentSourcePage(),
    providers: selectedProviders.slice(),
    columnHeaders: columnHeaders.slice(),
    dataDates,
    hasOptimized: keys.some((k) => k.includes("Optimized Instance")),
    hasLikeToLike: keys.some((k) => k.includes("Like-to-Like Instance")),
    results: processedResults,
  };
}

// Opens the App Portfolio page and hands it the current results.
function openAppPortfolio() {
  const payload = buildPortfolioPayload();
  if (!payload) {
    alert("Generate recommendations first, then open the App Portfolio.");
    return;
  }

  // Best-effort localStorage copy for cold opens / reloads. postMessage is the
  // primary channel and has no practical cap, so very large estates skip the
  // copy (localStorage is ~5 MB) rather than throwing.
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= 4 * 1024 * 1024) {
      localStorage.setItem(PORTFOLIO_STORAGE_KEY, serialized);
    } else {
      localStorage.removeItem(PORTFOLIO_STORAGE_KEY);
    }
  } catch (e) {
    console.warn("Portfolio localStorage copy skipped:", e);
  }

  const child = window.open("app-portfolio.html");
  if (!child) {
    alert(
      "The App Portfolio page was blocked by a popup blocker. Allow popups for this site and try again.",
    );
    return;
  }

  // Deliver the payload as soon as the child announces it's ready. postMessage
  // is same-origin (CSP-safe) and uncapped, so it carries large estates the
  // localStorage copy couldn't.
  let readyTimeout = null;
  const onReady = (event) => {
    if (event.origin !== location.origin) return;
    if (event.source !== child) return;
    if (!event.data || event.data.type !== "portfolio-ready") return;
    child.postMessage({ type: "portfolio-data", payload }, location.origin);
    window.removeEventListener("message", onReady);
    clearTimeout(readyTimeout);
  };
  window.addEventListener("message", onReady);
  // Don't leak the listener if the child never announces readiness (popup
  // blocked mid-load, tab closed, page error). The localStorage copy still
  // lets the opened page load its data on its own.
  readyTimeout = setTimeout(() => {
    window.removeEventListener("message", onReady);
  }, 15000);
}

// Shows the "Open App Portfolio" button (with app count) only when results
// carry at least one named app; hidden otherwise.
function updateAppPortfolioButton(results) {
  const btn = document.getElementById("openAppPortfolioBtn");
  if (!btn) return;
  const named = getAppSummary(results).length;
  if (named > 0) {
    btn.textContent = `📊 Open App Portfolio (${named})`;
    btn.title = `Open an interactive, per-application dashboard for ${named} app(s) — with an executive Excel export`;
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
  updateAnalysisGroupVisibility();
}

// AWS Pricing Calculator Bulk Template download
// Generates a CSV matching the EC2 Instances BulkUpload Template format.
// type = 'l2l' | 'optimized' — always one type per file to avoid double-counting.
// If omitted and only one type exists, that type is used automatically.
function downloadAWSBulkTemplate(type) {
  if (!processedResults || processedResults.length === 0) {
    alert("No results to download. Please generate recommendations first.");
    return;
  }

  const sampleRow = processedResults[0];
  const hasL2L = Object.keys(sampleRow).some((k) =>
    k.includes("AWS Like-to-Like Instance"),
  );
  const hasOpt = Object.keys(sampleRow).some((k) =>
    k.includes("AWS Optimized Instance"),
  );

  if (!hasL2L && !hasOpt) {
    alert(
      "No AWS recommendations found. Please select AWS as a provider and regenerate.",
    );
    return;
  }

  // Resolve which type to use for this file
  const useL2L = type === "l2l" || (!type && hasL2L);
  const useOpt = type === "optimized" || (!type && !hasL2L && hasOpt);

  if (!useL2L && !useOpt) {
    alert("Unknown bulk template type. Use 'l2l' or 'optimized'.");
    return;
  }

  const bulkHeaders = [
    "Group",
    "Description",
    "AWS Region",
    "Operating System",
    "Instance Type",
    "Tenancy",
    "Number of Instances",
    "Assumed Usage",
    "Usage Type",
    "Purchasing Options",
    "Storage Type",
    "Storage amount per Instance (GB)",
    "Provisioning IOPS per instance (gp3, io1, io2)",
    "EBS Throughput per Instance (Mbps)",
    "Snapshot Frequency",
    "EBS Snapshot amount per Instance (GB/snapshot)",
  ];

  const osSelector = document.querySelector('input[name="targetOS"]:checked');
  const pageOS = osSelector ? osSelector.value : "Linux";

  const rows = [];

  resultsInPreviewOrder(processedResults).forEach((row) => {
    const vmName = row["VM Name"] || row["Server Name"] || "VM";
    const region = row["AWS Region"] || "";
    const env = row["ENV"] || row["Environment"] || "Default";
    const sanitize = (s) => {
      const clean = String(s).replace(/[><&]/g, "");
      return /^[=+\-@|\t\r]/.test(clean) ? `'${clean}` : clean;
    };

    // Per-row OS overrides the page-level default
    const rowOS = (row["OS"] || row["Operating System"] || pageOS).trim();
    const templateOS = rowOS.toLowerCase().includes("windows")
      ? "Windows Server"
      : "Linux";

    const buildRow = (instanceType) => {
      if (
        !instanceType ||
        instanceType === "Missing data" ||
        instanceType === "Error" ||
        instanceType === "No utilization data"
      ) {
        return null;
      }
      return [
        sanitize(env), // Group
        sanitize(vmName), // Description — just the VM name, no type label
        region, // AWS Region
        templateOS, // Operating System (per-row)
        instanceType, // Instance Type
        "Shared Instances", // Tenancy
        "1", // Number of Instances
        "", // Assumed Usage (blank = Always On)
        "Always On", // Usage Type
        "On-Demand", // Purchasing Options
        "", // Storage Type
        "", // Storage amount
        "", // Provisioning IOPS
        "", // EBS Throughput
        "", // Snapshot Frequency
        "", // EBS Snapshot amount
      ];
    };

    if (useL2L) {
      const r = buildRow(row["AWS Like-to-Like Instance"]);
      if (r) rows.push(r);
    } else {
      const r = buildRow(row["AWS Optimized Instance"]);
      if (r) rows.push(r);
    }
  });

  if (rows.length === 0) {
    alert(
      "No valid AWS instance recommendations to export. Check that your results contain successful matches.",
    );
    return;
  }

  const escapeCell = (v) => {
    const s = String(v == null ? "" : v);
    const safe = /^[=+\-@|\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  const csvContent = [
    bulkHeaders.map(escapeCell).join(","),
    ...rows.map((r) => r.map(escapeCell).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  const suffix = useL2L ? "like_to_like" : "optimized";
  a.download = exportFilename(`aws_pricing_calculator_bulk_${suffix}`, "csv");
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  console.log(`AWS bulk template exported: ${rows.length} rows`);
}

// Enhanced usage statistics management
let usageStats = {
  toolUses: 0,
  totalVMs: 0,
  lastUpdated: new Date().toISOString(),
  gravitonRecommendations: 0,
  intelRecommendations: 0,
  averageCostSavings: 0,
};

// Load usage statistics from localStorage
function loadUsageStatistics() {
  try {
    const stored = localStorage.getItem("cloudInstanceRecommenderStats");
    if (stored) {
      usageStats = { ...usageStats, ...JSON.parse(stored) };
      updateUsageCounters();
      console.log("Loaded usage statistics:", usageStats);
    }
  } catch (e) {
    console.error("Error loading statistics:", e);
  }
}

// Enhanced save usage statistics
function saveUsageStatistics() {
  try {
    // Update timestamp
    usageStats.lastUpdated = new Date().toISOString();

    // Save to localStorage
    localStorage.setItem(
      "cloudInstanceRecommenderStats",
      JSON.stringify(usageStats),
    );

    console.log("Saved usage statistics:", usageStats);
  } catch (e) {
    console.error("Error saving statistics:", e);
  }
}

// Enhanced update usage statistics
function updateUsageStatistics(vmCount) {
  usageStats.toolUses++;
  usageStats.totalVMs += vmCount;

  updateUsageCounters();
  saveUsageStatistics();

  console.log(
    `Updated statistics: ${usageStats.toolUses} tool uses, ${usageStats.totalVMs} total VMs processed`,
  );
}

// Update usage counter display
function updateUsageCounters() {
  const toolUsageElement = document.getElementById("toolUsageCount");
  const totalVMsElement = document.getElementById("totalVMsProcessed");

  if (toolUsageElement) toolUsageElement.textContent = usageStats.toolUses;
  if (totalVMsElement) totalVMsElement.textContent = usageStats.totalVMs;
}

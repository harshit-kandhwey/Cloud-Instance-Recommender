// Generation: option gathering, progress bar, worker-based batch runner
// with main-thread fallback, and exclusion helpers.

// Generate recommendations
function generateRecommendations() {
  console.log(
    "Starting recommendation generation with modular selector system",
  );

  // If the provider data files haven't finished parsing yet, queue this run
  // and auto-execute it the moment they are ready — no blocking, no alert.
  if (!allDataReady(selectedProviders)) {
    _generateQueued = true;
    showDataToast(
      "⏳ Instance data still loading — will start automatically when ready…",
    );
    watchForDataThenRun(selectedProviders);
    return;
  }

  // Validation
  if (csvData.length === 0) {
    showToast(
      window._pendingIngest
        ? "Please confirm the column mapping first (see the panel above)."
        : "Please upload a CSV file first.",
      "warning",
    );
    return;
  }

  if (selectedProviders.length === 0) {
    showToast("Please select at least one cloud provider.", "warning");
    return;
  }

  // Non-blocking heads-up if any selected provider has unrecognized regions
  if (window._regionValidation) {
    let unknowns = 0;
    for (const provider of selectedProviders) {
      const validation = window._regionValidation[provider];
      if (!validation) continue;
      unknowns += Object.values(validation).filter(
        (r) => r.status === "unknown",
      ).length;
    }
    if (unknowns > 0) {
      showDataToast(
        `⚠️ ${unknowns} unrecognized region name(s) — those rows will use sample data`,
      );
      setTimeout(hideDataToast, 6000);
    }
  }

  // Check if modular system is available
  if (typeof getInstanceRecommendationWithSelector === "undefined") {
    showToast(
      "The instance selector system failed to load. Please reload the page.",
      "error",
    );
    return;
  }

  // Check required input columns. Normally CPU Count and Memory (GB). In
  // cloud-to-cloud mode a row may instead be sized from its Current Instance Type, so
  // a file naming only that column is valid — accept EITHER (per-row precedence, where
  // explicit CPU/Memory win, is handled in the factory). A typical inventory export
  // names just the instance type, which the old gate rejected before the mode could run.
  const cloudToCloudOn =
    document.getElementById("cloudToCloudMode")?.checked || false;
  const hasSizeColumns =
    columnHeaders.includes(COLUMN_MAPPINGS.cpu) &&
    columnHeaders.includes(COLUMN_MAPPINGS.memory);
  if (cloudToCloudOn) {
    if (!hasSizeColumns && !columnHeaders.includes("Current Instance Type")) {
      showToast(
        "Cloud-to-cloud sizing needs either CPU Count and Memory (GB) columns, or a Current Instance Type column.",
        "warning",
      );
      return;
    }
  } else {
    const missingColumns = [COLUMN_MAPPINGS.cpu, COLUMN_MAPPINGS.memory].filter(
      (col) => !columnHeaders.includes(col),
    );
    if (missingColumns.length > 0) {
      showToast(
        `Missing required columns: ${missingColumns.join(", ")}`,
        "warning",
      );
      return;
    }
  }

  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked',
  );
  if (!recommendationType) {
    showToast("Please select a recommendation type.", "warning");
    return;
  }

  console.log(
    "Validation passed, starting processing with type:",
    recommendationType.value,
  );

  // Show processing status — progress is now driven by the batch runner
  // (worker messages, or the chunked main-thread fallback)
  const processingStatus = document.getElementById("processingStatus");
  processingStatus.classList.remove("hidden");
  updateProgressBar(0, csvData.length);

  processRecommendations();
}

// Real progress bar driven by onProgress(done, total) callbacks
function updateProgressBar(done, total) {
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (progressFill) progressFill.style.width = pct + "%";
  if (progressText) {
    progressText.textContent =
      total && done >= total
        ? "Complete!"
        : `Processing row ${done} of ${total} for ${selectedProviders.length} provider(s)… ${pct}%`;
  }
}

// Enhanced process recommendations with modular system and recommendation type control
async function processRecommendations() {
  console.log(
    "Processing recommendations with modular selector system and N/2, N, N+1 optimization strategy",
  );

  // Pin what this run describes — the selection, the token, AND the rows — for its
  // whole duration. The batch below is awaited, so a mid-run upload/paste/sample/
  // manual-apply that reassigns csvData would otherwise let buildDerivedSpecs and
  // runRecommendationBatch read different arrays (mixing datasets) and stamp the
  // finished batch with the NEW token. rowsForRun is a per-row snapshot that
  // isolates the run from any in-flight change; the token is still recorded so the
  // stale-results notice can flag a later drift.
  const providersForRun = selectedProviders.slice();
  const ingestTokenForRun = window._ingestToken;
  const rowsForRun = csvData.map((row) => ({ ...row }));

  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked',
  ).value;

  // Determine which recommendation types to generate
  const generateLikeToLike =
    recommendationType === "like-to-like" || recommendationType === "both";
  const generateOptimized =
    recommendationType === "optimized" || recommendationType === "both";

  console.log("Recommendation generation plan:", {
    type: recommendationType,
    generateLikeToLike,
    generateOptimized,
  });

  // Read the persisted app→workload map once (used in the options spread below)
  const appWorkloadMap = loadAppWorkloadMap();

  // Likewise the rule defaults: each getter does several DOM reads, and the spread
  // below tests then reads eight fields — sixteen re-scans per generate for one
  // snapshot that can't change mid-read.
  const ruleDefaults = getRuleDefaults();

  // User-defined rules for this page (conditional per-row Exclude / Include Only).
  // Snapshotted once and passed to the worker in options.userRules; the factory
  // evaluates them per row. Empty when the user has authored none.
  const userRules = typeof loadUserRules === "function" ? loadUserRules() : [];

  // Prepare options with comprehensive filtering and recommendation type control
  const options = {
    // **NEW: Recommendation type control**
    generateLikeToLike: generateLikeToLike,
    generateOptimized: generateOptimized,

    // Cloud-to-cloud mode: a row with no CPU/Memory is sized from its Current Instance
    // Type (specs resolved below into derivedSpecs, passed to the factory). Off by
    // default and absent without the toggle, so an ordinary run is unaffected.
    cloudToCloud: document.getElementById("cloudToCloudMode")?.checked || false,

    // Optimization strategy parameters (only used if generateOptimized is true)
    // Which utilization statistic sizes each row; "avg" is the historical
    // behaviour and the default when the control is absent.
    utilizationStatistic:
      document.getElementById("utilizationStatistic")?.value || "avg",
    cpuBased: document.getElementById("cpuBased")?.checked || false,
    memoryBased: document.getElementById("memoryBased")?.checked || false,
    cpuDownsizeMax: parseInt(
      document.getElementById("cpuDownsizeMax")?.value || 40,
    ),
    cpuUpsizeMin: parseInt(
      document.getElementById("cpuUpsizeMin")?.value || 80,
    ),
    memoryDownsizeMax: parseInt(
      document.getElementById("memoryDownsizeMax")?.value || 40,
    ),
    memoryUpsizeMin: parseInt(
      document.getElementById("memoryUpsizeMin")?.value || 80,
    ),

    // Comprehensive AWS filtering options (only if AWS functions are available)
    currentGenerationOnly:
      document.getElementById("currentGenerationOnly")?.checked || false,
    restrictInstanceFamilyNames:
      document.getElementById("restrictInstanceFamilyNames")?.checked || false,
    selectedInstanceFamilyNames:
      typeof getSelectedInstanceFamilyNames !== "undefined"
        ? getSelectedInstanceFamilyNames()
        : [],
    restrictProcessorManufacturers:
      document.getElementById("restrictProcessorManufacturers")?.checked ||
      false,
    selectedProcessorManufacturers:
      typeof getSelectedProcessorManufacturers !== "undefined"
        ? getSelectedProcessorManufacturers()
        : [],
    restrictMainFamilies:
      document.getElementById("restrictMainFamilies")?.checked || false,
    selectedMainFamilies:
      typeof getSelectedMainFamilies !== "undefined"
        ? getSelectedMainFamilies()
        : [],
    excludeTypes: getExcludedTypes(),

    // Legacy Graviton exclusion support (derived from exclude types)
    excludeGraviton: getExcludeGravitonSetting(),

    // **FIXED: Azure-specific options**
    selectedAzureSeries: getSelectedAzureSeries(),
    selectedAzureProcessors: getSelectedAzureProcessors(),
    selectedAzureVMFamilies: getSelectedAzureVMFamilies(),

    // **FIXED: GCP-specific options**
    selectedGCPFamilies: getSelectedGCPFamilies(),
    selectedGCPProcessors: getSelectedGCPProcessors(),
    selectedGCPMachineTypes: getSelectedGCPMachineTypes(),

    // Rule Engine page-level defaults (overridden per-row by CSV columns)
    ...(ruleDefaults.env ? { ruleDefaultEnv: ruleDefaults.env } : {}),
    ...(ruleDefaults.os ? { ruleDefaultOS: ruleDefaults.os } : {}),
    ...(ruleDefaults.workload
      ? { ruleDefaultWorkload: ruleDefaults.workload }
      : {}),
    ...(ruleDefaults.compliance
      ? { ruleDefaultCompliance: ruleDefaults.compliance }
      : {}),
    ...(ruleDefaults.minGen ? { ruleDefaultMinGen: ruleDefaults.minGen } : {}),
    // Per-provider MinGen (multi-cloud page). Each is native to its own cloud,
    // and overrides the shared default for that provider only.
    ...(ruleDefaults.minGenAws
      ? { ruleDefaultMinGenAws: ruleDefaults.minGenAws }
      : {}),
    ...(ruleDefaults.minGenAzure
      ? { ruleDefaultMinGenAzure: ruleDefaults.minGenAzure }
      : {}),
    ...(ruleDefaults.minGenGcp
      ? { ruleDefaultMinGenGcp: ruleDefaults.minGenGcp }
      : {}),

    // App→workload inheritance: VMs with an App Name but no Workload cell take the
    // workload assigned to their app (plain object, safe to postMessage). Omitted when empty.
    ...(Object.keys(appWorkloadMap).length ? { appWorkloadMap } : {}),

    // User-defined conditional rules (plain objects, safe to postMessage into the
    // worker). Omitted when none are authored, so an ordinary run is unaffected.
    ...(userRules.length ? { userRules } : {}),
  };

  console.log("Processing options:", {
    recommendationTypes: { generateLikeToLike, generateOptimized },
    filtering: {
      currentGenOnly: options.currentGenerationOnly,
      familyNames: options.selectedInstanceFamilyNames.length,
      processors: options.selectedProcessorManufacturers.length,
      mainFamilies: options.selectedMainFamilies.length,
      excludeTypes: options.excludeTypes.length,
      // Azure options
      azureSeries: options.selectedAzureSeries.length,
      azureProcessors: options.selectedAzureProcessors.length,
      azureVMFamilies: options.selectedAzureVMFamilies.length,
      // GCP options
      gcpFamilies: options.selectedGCPFamilies.length,
      gcpProcessors: options.selectedGCPProcessors.length,
      gcpMachineTypes: options.selectedGCPMachineTypes.length,
    },
    optimization: {
      cpuBased: options.cpuBased,
      memoryBased: options.memoryBased,
      ranges: `CPU(${options.cpuDownsizeMax}-${options.cpuUpsizeMin}), Memory(${options.memoryDownsizeMax}-${options.memoryUpsizeMin})`,
    },
  });

  try {
    // Cloud-to-cloud: resolve the source specs on the MAIN thread, where region
    // scripts can be injected (the worker can't fetch), and pass them as
    // options.derivedSpecs. Only spec-less rows naming a Current Instance Type need it;
    // the source provider is inferred per type and need not be a selected TARGET — the
    // point of the mode. Inside the try so a resolver failure surfaces the error toast
    // and the finally still hides the processing status.
    if (options.cloudToCloud) {
      options.derivedSpecs = await buildDerivedSpecs(rowsForRun);
    }

    // Use the modular instance selector system (worker when possible)
    console.log("Running recommendation batch (worker with fallback)");
    processedResults = await runRecommendationBatch(
      rowsForRun,
      providersForRun,
      options,
    );

    console.log("Recommendations processed successfully:", {
      totalRows: processedResults.length,
      sampleColumns: Object.keys(processedResults[0] || {}).filter(
        (key) => key.includes("Like-to-Like") || key.includes("Optimized"),
      ),
    });

    // What these results describe: the selection they ran with and the ingest they ran
    // against. Both are compared with live state to warn on drift
    // (updateStaleResultsNotice) — the data half matters because loading a new
    // file/paste/sample doesn't clear the results, and a same-shape replacement looks
    // like nothing happened.
    window._resultsProviders = providersForRun;
    window._resultsIngestToken = ingestTokenForRun;
    updateStaleResultsNotice();

    // Update usage statistics and show download section
    updateUsageStatistics(rowsForRun.length);
    document.getElementById("downloadSection").classList.remove("hidden");

    // Show inline results preview
    showResultsPreview(processedResults);

    // Summary charts above the table. Guarded: a page that hasn't loaded charts.js
    // loses the charts, not the results.
    if (typeof renderResultsCharts === "function")
      renderResultsCharts(processedResults);

    // Pre-build the hidden executive print report from the same run, so "Print report"
    // and Ctrl+P have it ready. Guarded like the charts.
    if (typeof renderExecutiveReport === "function")
      renderExecutiveReport(processedResults);

    // Offer the single filter change that would rescue the most unmatched rows
    updateRelaxSuggestion(processedResults);

    // AWS page: sync the calculator bulk-template button(s) with the run types
    updateDownloadButtons(processedResults);

    // CSV multiselect dropdown (Results always; No-Match / App Summary when they
    // have rows). Excel is the primary one-click download beside it.
    renderCsvMenu(processedResults);

    // "Open App Portfolio" handoff button (hidden when there's no named app)
    updateAppPortfolioButton(processedResults);

    // Reveal the scenario-comparison bar so this run can be pinned/compared
    if (typeof updateScenarioCompare === "function") updateScenarioCompare();

    // Log what was actually generated
    if (processedResults.length > 0) {
      const sampleResult = processedResults[0];
      const generatedColumns = Object.keys(sampleResult).filter(
        (key) => key.includes("Like-to-Like") || key.includes("Optimized"),
      );
      console.log("Generated columns:", generatedColumns);
    }
  } catch (error) {
    console.error("Error processing recommendations:", error);
    showToast(
      `An error occurred while processing recommendations: ${error.message}`,
      "error",
    );
  } finally {
    const processingStatus = document.getElementById("processingStatus");
    if (processingStatus) processingStatus.classList.add("hidden");
  }
}

// ─── Worker-based batch runner ────────────────────────────────────────────────
// Cloud-to-cloud spec resolution (main thread). For every row with NO CPU Count and
// NO Memory (GB) but a Current Instance Type, infer the type's cloud
// (inferInstanceTypeProvider), load that provider's default region once, and reverse-
// look-up its vCPU/memory (getSpecsForInstanceType). Returns a plain
// { typeLower: { cpu, memory } } map — safe to postMessage as options.derivedSpecs.
// The source provider need not be a selected target; specs are region-independent, so
// one default region answers. A type nobody carries is absent → the factory makes it a
// No-Match naming the type.
async function buildDerivedSpecs(csvData) {
  const specs = {};
  if (
    !Array.isArray(csvData) ||
    typeof inferInstanceTypeProvider !== "function"
  )
    return specs;

  // Group the distinct spec-less source types by their inferred provider, so each
  // provider's data is loaded at most once.
  const needed = new Map();
  for (const row of csvData) {
    const cpu = parseInt(row && row["CPU Count"]) || 0;
    const memory = parseFloat(row && row["Memory (GB)"]) || 0;
    if (cpu !== 0 || memory !== 0) continue;
    const type = String((row && row["Current Instance Type"]) || "").trim();
    if (!type) continue;
    const provider = inferInstanceTypeProvider(type);
    if (!provider) continue;
    if (!needed.has(provider)) needed.set(provider, new Set());
    needed.get(provider).add(type);
  }

  for (const [provider, types] of needed) {
    let selector;
    try {
      selector =
        (window._prewarmedSelectors && window._prewarmedSelectors[provider]) ||
        InstanceSelectorFactory.createSelector(provider);
      // Cache it the same way collectRegionDataForWorker does, so a later phase (or a
      // provider that's also a selected target) reuses the parsed region data.
      // initialize is additive — never resets instanceData — so a reused selector only
      // gains the default region.
      window._prewarmedSelectors = window._prewarmedSelectors || {};
      window._prewarmedSelectors[provider] = selector;
      const def = InstanceSelectorFactory.getProviderDefaultRegion(provider);
      await selector.initialize([], [def]);
    } catch (e) {
      console.warn(
        `[CloudToCloud] could not load ${provider} data for spec lookup:`,
        e,
      );
      continue;
    }
    for (const type of types) {
      const found = selector.getSpecsForInstanceType(type);
      if (found && found.vCpus > 0 && found.memory > 0) {
        specs[type.toLowerCase()] = { cpu: found.vCpus, memory: found.memory };
      }
    }
  }
  return specs;
}

async function collectRegionDataForWorker(providers) {
  const regionData = {};
  const flags = {};

  for (const provider of providers) {
    const prefix = provider.toUpperCase();
    flags[`${prefix}_DATA_READY`] = window[`${prefix}_DATA_READY`] === true;
    if (window[`${prefix}_REGION_KEYS`]) {
      flags[`${prefix}_REGION_KEYS`] = window[`${prefix}_REGION_KEYS`];
    }
    if (window[`${prefix}_DATA_DATE`]) {
      flags[`${prefix}_DATA_DATE`] = window[`${prefix}_DATA_DATE`];
    }

    // Resolved regions for this provider: validation map when present,
    // otherwise resolve on the fly from the CSV
    let entries =
      (window._regionValidation && window._regionValidation[provider]) || null;
    if (!entries) {
      entries = {};
      const regionColumn =
        InstanceSelectorFactory.getProviderRegionColumn(provider);
      csvData.forEach((row) => {
        const raw = (row[regionColumn] || "").trim();
        if (raw && !entries[raw]) entries[raw] = resolveRegion(provider, raw);
      });
    }
    // No regions in the CSV → the factory will use the provider default
    if (!Object.keys(entries).length) {
      const def = InstanceSelectorFactory.getProviderDefaultRegion(provider);
      entries = { [def]: resolveRegion(provider, def) };
    }

    const selector =
      window._prewarmedSelectors[provider] ||
      InstanceSelectorFactory.createSelector(provider);
    window._prewarmedSelectors[provider] = selector;

    for (const resolution of Object.values(entries)) {
      if (!resolution || !resolution.key || resolution.status === "unknown") {
        continue; // worker will use its sample-data fallback for these rows
      }
      if (!window[resolution.key]) {
        try {
          await selector.ensureRegionScriptLoaded(resolution.key);
        } catch (e) {
          console.warn(`[Worker] could not load region ${resolution.key}:`, e);
        }
      }
      if (window[resolution.key]) {
        regionData[resolution.key] = window[resolution.key];
      }
    }
  }

  return { regionData, flags };
}

// Runs the batch in a Web Worker (real progress, UI stays responsive); on any worker
// failure (file:// pages, CSP oddities, runtime errors) falls back ONCE to the chunked
// main-thread path with the same progress reporting.
async function runRecommendationBatch(rows, providers, options) {
  let worker = null;
  try {
    if (typeof Worker !== "undefined") {
      worker = new Worker("js/base/recommendation-worker.js");
    }
  } catch (e) {
    console.warn("[Worker] construction failed — using main thread:", e);
  }

  if (worker) {
    try {
      const payload = await collectRegionDataForWorker(providers);
      // Watchdog: any worker message counts as liveness (progress arrives at least
      // every yieldEvery rows). Prolonged silence → reject → the catch terminates the
      // worker and runs the main-thread fallback.
      const watchdogMs = window._workerWatchdogMs || 20000;
      const results = await new Promise((resolve, reject) => {
        let watchdog = null;
        const armWatchdog = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(
            () =>
              reject(
                new Error(
                  `Worker sent no messages for ${watchdogMs}ms — assuming it stalled`,
                ),
              ),
            watchdogMs,
          );
        };
        armWatchdog();
        worker.onmessage = (event) => {
          const msg = event.data || {};
          if (msg.type === "progress") {
            armWatchdog();
            updateProgressBar(msg.done, msg.total);
          } else if (msg.type === "result") {
            clearTimeout(watchdog);
            resolve(msg.results);
          } else if (msg.type === "error") {
            clearTimeout(watchdog);
            reject(new Error(msg.message));
          }
        };
        worker.onerror = (event) => {
          clearTimeout(watchdog);
          reject(new Error(event.message || "Worker error"));
        };
        worker.postMessage({
          type: "run",
          csvData: rows,
          providers: providers,
          options: options,
          regionData: payload.regionData,
          flags: payload.flags,
        });
      });
      console.log("[Worker] batch completed in worker");
      return results;
    } catch (e) {
      console.warn("[Worker] failed — falling back to main thread:", e);
      updateProgressBar(0, rows.length);
    } finally {
      worker.terminate();
    }
  }

  return await getInstanceRecommendationWithSelector(rows, providers, options, {
    onProgress: updateProgressBar,
    yieldEvery: 25,
  });
}

// Get Graviton exclusion setting from the new exclude types UI
function getExcludeGravitonSetting() {
  console.log("getExcludeGravitonSetting called");

  // Check if Graviton exclusion is selected in the new exclude types section
  const gravitonCheckboxes = [
    document.getElementById("exclude_aws_Graviton"),
    document.getElementById("exclude_azure_ARM"),
    document.getElementById("exclude_gcp_ARM"),
  ].filter((cb) => cb !== null);

  console.log(
    "Found graviton checkboxes:",
    gravitonCheckboxes.map((cb) => (cb ? cb.id : "null")),
  );

  // Return true if ANY Graviton exclusion checkbox is checked
  const isExcluded = gravitonCheckboxes.some((checkbox) => checkbox.checked);
  console.log("Graviton exclusion setting:", isExcluded);

  return isExcluded;
}

// Get comprehensive excluded types (including Graviton, Mac, Nitro)
function getExcludedTypes() {
  const excludedTypes = [];

  selectedProviders.forEach((provider) => {
    const checkboxes = document.querySelectorAll(
      `input[id^="exclude_${provider}_"]:checked`,
    );
    checkboxes.forEach((checkbox) => {
      excludedTypes.push({
        provider: provider,
        type: checkbox.value,
      });
    });
  });

  console.log("Excluded types:", excludedTypes);
  return excludedTypes;
}

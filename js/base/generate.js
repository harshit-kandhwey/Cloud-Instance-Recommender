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

  // Check if required columns exist
  const requiredColumns = [COLUMN_MAPPINGS.cpu, COLUMN_MAPPINGS.memory];
  const missingColumns = requiredColumns.filter(
    (col) => !columnHeaders.includes(col),
  );

  if (missingColumns.length > 0) {
    showToast(
      `Missing required columns: ${missingColumns.join(", ")}`,
      "warning",
    );
    return;
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

  // Pin the selection for the whole run. The batch below is awaited, so a
  // checkbox toggled while it is in flight would otherwise leave the results
  // describing one selection and _resultsProviders recording another — making
  // the stale-results notice wrong in exactly the case it exists for.
  const providersForRun = selectedProviders.slice();

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

  // Prepare options with comprehensive filtering and recommendation type control
  const options = {
    // **NEW: Recommendation type control**
    generateLikeToLike: generateLikeToLike,
    generateOptimized: generateOptimized,

    // Optimization strategy parameters (only used if generateOptimized is true)
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
    ...(getRuleDefaults().env ? { ruleDefaultEnv: getRuleDefaults().env } : {}),
    ...(getRuleDefaults().os ? { ruleDefaultOS: getRuleDefaults().os } : {}),
    ...(getRuleDefaults().workload
      ? { ruleDefaultWorkload: getRuleDefaults().workload }
      : {}),
    ...(getRuleDefaults().compliance
      ? { ruleDefaultCompliance: getRuleDefaults().compliance }
      : {}),
    ...(getRuleDefaults().minGen
      ? { ruleDefaultMinGen: getRuleDefaults().minGen }
      : {}),

    // App→workload inheritance: VMs with an App Name but no Workload cell take
    // the workload assigned to their app in the mapping panel (plain object,
    // safe to postMessage into the worker). Omitted when the map is empty.
    ...(Object.keys(appWorkloadMap).length ? { appWorkloadMap } : {}),
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
    // Use the modular instance selector system (worker when possible)
    console.log("Running recommendation batch (worker with fallback)");
    processedResults = await runRecommendationBatch(
      csvData,
      providersForRun,
      options,
    );

    console.log("Recommendations processed successfully:", {
      totalRows: processedResults.length,
      sampleColumns: Object.keys(processedResults[0] || {}).filter(
        (key) => key.includes("Like-to-Like") || key.includes("Optimized"),
      ),
    });

    // The selection these results describe — compared against the live
    // checkboxes to warn when they drift apart (see updateStaleResultsNotice)
    window._resultsProviders = providersForRun;
    updateStaleResultsNotice();

    // Update usage statistics and show download section
    updateUsageStatistics(csvData.length);
    document.getElementById("downloadSection").classList.remove("hidden");

    // Show inline results preview
    showResultsPreview(processedResults);

    // AWS page: sync the calculator bulk-template button(s) with the run types
    updateDownloadButtons(processedResults);

    // No-match remediation export button (hidden when everything matched)
    updateNoMatchButton(processedResults);

    // Per-app summary export button (hidden when there's no App Name column)
    updateAppSummaryButton(processedResults);

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
// Snapshots the region data the CSV needs (injecting any region scripts not
// yet loaded) so it can be posted to the worker, which cannot fetch under CSP.
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

// Runs the batch in a Web Worker (real progress, UI stays responsive); on any
// worker failure — file:// pages, CSP oddities, runtime errors — falls back
// ONCE to the chunked main-thread path with the same progress reporting.
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
      // Watchdog: any worker message counts as liveness (progress arrives at
      // least every `yieldEvery` rows). Prolonged silence → reject → the
      // catch below terminates the worker and runs the main-thread fallback.
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

// Form controls: file stats/preview panels, provider checkboxes,
// recommendation type + optimization inputs, rule engine UI, filter
// toggles, and the getSelected* option readers.

// Show file statistics
function showFileStatistics() {
  const statsSection = document.getElementById("fileStatsSection");
  if (!statsSection) return;

  const stats = {
    totalRows: csvData.length,
    totalColumns: columnHeaders.length,
    hasRequiredColumns: [COLUMN_MAPPINGS.cpu, COLUMN_MAPPINGS.memory].every(
      (col) => columnHeaders.includes(col),
    ),
    hasUtilizationData: [
      COLUMN_MAPPINGS.cpuUtilization,
      COLUMN_MAPPINGS.memoryUtilization,
    ].every((col) => columnHeaders.includes(col)),
  };

  statsSection.innerHTML = `
    <div class="stats-info">
      <p><strong>📊 Data Summary:</strong></p>
      <ul>
        <li>Total Rows: ${stats.totalRows}</li>
        <li>Total Columns: ${stats.totalColumns}</li>
        <li>Required Columns: ${
          stats.hasRequiredColumns ? "✅ Present" : "❌ Missing"
        }</li>
        <li>Utilization Data: ${
          stats.hasUtilizationData ? "✅ Available" : "⚠️ Not Available"
        }</li>
      </ul>
    </div>
  `;
  statsSection.classList.remove("hidden");

  // Show data preview
  showDataPreview();
}

// Show data preview
function showDataPreview() {
  const previewSection = document.getElementById("dataPreviewSection");
  if (!previewSection || csvData.length === 0) return;

  const previewData = csvData.slice(0, 5);
  const headers = columnHeaders;

  let tableHTML = `
    <p><strong>👁️ Data Preview (first 5 rows):</strong></p>
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="background: var(--surface-alt);">
            ${headers
              .map(
                (h) =>
                  `<th style="padding: 8px; border: 1px solid var(--border-mid); text-align: left;">${escapeHtml(h)}</th>`,
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
  `;

  previewData.forEach((row, i) => {
    const bgColor = i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)";
    tableHTML += `<tr style="background: ${bgColor};">`;
    headers.forEach((header) => {
      const value = row[header] || "";
      const displayValue =
        value.length > 20 ? value.substring(0, 20) + "..." : value;
      tableHTML += `<td style="padding: 8px; border: 1px solid var(--border-mid);">${escapeHtml(displayValue)}</td>`;
    });
    tableHTML += `</tr>`;
  });

  tableHTML += `
        </tbody>
      </table>
    </div>
  `;

  previewSection.innerHTML = tableHTML;
  previewSection.classList.remove("hidden");
}

// Toggle cloud provider
function toggleCloudProvider(provider) {
  const checkbox = document.getElementById(provider);

  if (checkbox.checked) {
    selectedProviders.push(provider);
  } else {
    selectedProviders = selectedProviders.filter((p) => p !== provider);
  }

  console.log("Selected providers:", selectedProviders);

  // Validate providers if modular system is available
  if (typeof validateProviderSupport !== "undefined") {
    const isValid = validateProviderSupport(selectedProviders);
    if (!isValid) {
      console.warn(
        "Some selected providers are not supported by the modular system",
      );
    }
  }

  // Update exclude controls when providers change
  const excludeCheckbox = document.getElementById("excludeTypes");
  if (excludeCheckbox && excludeCheckbox.checked) {
    updateExcludeControls();
  }

  // Any already-generated results now describe a selection the user has changed
  if (typeof updateStaleResultsNotice === "function") {
    updateStaleResultsNotice();
  }
}

// Handle recommendation type change - Updated for modular system
function handleRecommendationTypeChange() {
  const optimizationControls = document.getElementById("optimizationControls");
  const selectedType = document.querySelector(
    'input[name="recommendationType"]:checked',
  );

  if (!selectedType) return;

  console.log("Recommendation type changed to:", selectedType.value);

  // Show/hide optimization controls based on recommendation type
  if (selectedType.value === "optimized" || selectedType.value === "both") {
    optimizationControls.classList.remove("hidden");
  } else {
    optimizationControls.classList.add("hidden");
  }

  // Log what will be generated
  const willGenerateLikeToLike =
    selectedType.value === "like-to-like" || selectedType.value === "both";
  const willGenerateOptimized =
    selectedType.value === "optimized" || selectedType.value === "both";

  console.log("Recommendation generation plan:", {
    likeToLike: willGenerateLikeToLike,
    optimized: willGenerateOptimized,
  });
}

// Toggle optimization mode
function toggleOptimizationMode() {
  const cpuBased = document.getElementById("cpuBased").checked;
  const memoryBased = document.getElementById("memoryBased").checked;

  const cpuRanges = document.getElementById("cpuUtilizationRanges");
  const memoryRanges = document.getElementById("memoryUtilizationRanges");

  if (cpuBased) {
    cpuRanges.classList.remove("hidden");
    updateCpuRanges();
  } else {
    cpuRanges.classList.add("hidden");
  }

  if (memoryBased) {
    memoryRanges.classList.remove("hidden");
    updateMemoryRanges();
  } else {
    memoryRanges.classList.add("hidden");
  }

  // The statistic hint is scoped to the enabled axes, so re-evaluate it when
  // the axes change — otherwise disabling Memory-Based would leave a stale
  // "the other dimension falls back" warning about a dimension no longer read.
  if (typeof onUtilizationStatisticChange === "function") {
    onUtilizationStatisticChange();
  }
}

// Update CPU range inputs
function updateCpuRanges() {
  const cpuDownsizeMax = document.getElementById("cpuDownsizeMax");
  const cpuKeepMin = document.getElementById("cpuKeepMin");
  const cpuKeepMax = document.getElementById("cpuKeepMax");
  const cpuUpsizeMin = document.getElementById("cpuUpsizeMin");

  if (!cpuDownsizeMax || !cpuKeepMin || !cpuKeepMax || !cpuUpsizeMin) return;

  const downsizeMaxVal = parseInt(cpuDownsizeMax.value);
  const keepMaxVal = parseInt(cpuKeepMax.value);

  cpuKeepMin.value = downsizeMaxVal;
  cpuUpsizeMin.value = keepMaxVal;

  // Disable upsizing if keepMax is 100
  const upsizeLabel = cpuUpsizeMin.parentElement;
  if (keepMaxVal >= 100) {
    upsizeLabel.style.opacity = "0.5";
    const spans = upsizeLabel.querySelectorAll("span");
    spans[spans.length - 1].textContent = "% - Disabled (upper limit is 100%)";
  } else {
    upsizeLabel.style.opacity = "1";
    const spans = upsizeLabel.querySelectorAll("span");
    spans[spans.length - 1].textContent = "% to 100%";
  }
}

// Update Memory range inputs
function updateMemoryRanges() {
  const memoryDownsizeMax = document.getElementById("memoryDownsizeMax");
  const memoryKeepMin = document.getElementById("memoryKeepMin");
  const memoryKeepMax = document.getElementById("memoryKeepMax");
  const memoryUpsizeMin = document.getElementById("memoryUpsizeMin");

  if (
    !memoryDownsizeMax ||
    !memoryKeepMin ||
    !memoryKeepMax ||
    !memoryUpsizeMin
  )
    return;

  const downsizeMaxVal = parseInt(memoryDownsizeMax.value);
  const keepMaxVal = parseInt(memoryKeepMax.value);

  memoryKeepMin.value = downsizeMaxVal;
  memoryUpsizeMin.value = keepMaxVal;

  // Disable upsizing if keepMax is 100
  const upsizeLabel = memoryUpsizeMin.parentElement;
  if (keepMaxVal >= 100) {
    upsizeLabel.style.opacity = "0.5";
    const spans = upsizeLabel.querySelectorAll("span");
    spans[spans.length - 1].textContent = "% - Disabled (upper limit is 100%)";
  } else {
    upsizeLabel.style.opacity = "1";
    const spans = upsizeLabel.querySelectorAll("span");
    spans[spans.length - 1].textContent = "% to 100%";
  }
}

// Toggle current generation filter
function toggleCurrentGenerationFilter() {
  const checkbox = document.getElementById("currentGenerationOnly");
  checkRuleConflicts();
  console.log(
    "Current generation filter:",
    checkbox.checked ? "Enabled" : "Disabled",
  );
}

// ─── Rule Engine UI helpers ────────────────────────────────────────────────

function getRuleDefaults() {
  return {
    env: (document.getElementById("ruleDefaultEnv")?.value || "").trim(),
    os: (document.getElementById("ruleDefaultOS")?.value || "").trim(),
    workload: (
      document.getElementById("ruleDefaultWorkload")?.value || ""
    ).trim(),
    compliance: (
      document.getElementById("ruleDefaultCompliance")?.value || ""
    ).trim(),
    // A MinGen value is native to one cloud, so each page supplies its own: the
    // single-provider pages have one #ruleDefaultMinGen, and the multi-cloud
    // page has three (one per provider) rather than a cross-provider scale that
    // would have to be translated. A page only has the controls it has — the
    // rest read back "".
    minGen: (document.getElementById("ruleDefaultMinGen")?.value || "").trim(),
    minGenAws: (
      document.getElementById("ruleDefaultMinGenAws")?.value || ""
    ).trim(),
    minGenAzure: (
      document.getElementById("ruleDefaultMinGenAzure")?.value || ""
    ).trim(),
    minGenGcp: (
      document.getElementById("ruleDefaultMinGenGcp")?.value || ""
    ).trim(),
  };
}

function onRuleChange() {
  checkRuleConflicts();
}

// Picking p95 or Peak when the upload carries no such columns is the quiet
// failure worth catching: every row would fall back to the average and the run
// would look like a p95 sizing while being nothing of the sort. Say so at the
// moment of choosing, against the headers actually uploaded.
function onUtilizationStatisticChange() {
  const sel = document.getElementById("utilizationStatistic");
  const hint = document.getElementById("utilizationStatisticHint");
  if (!sel || !hint) return;
  const stat =
    typeof UTILIZATION_STATISTICS !== "undefined"
      ? UTILIZATION_STATISTICS[sel.value]
      : null;
  hint.classList.remove("hint-warning");
  if (!stat || sel.value === "avg") {
    hint.innerHTML = hint.dataset.defaultHtml || hint.innerHTML;
    return;
  }
  // Snapshot as HTML, not text: the default hint carries a <strong>Sized On</strong>
  // emphasis, and capturing it with textContent would strip the markup for good —
  // the first excursion away from Average and back would leave a plain-text hint.
  // Safe to restore via innerHTML because it is the hint's OWN static markup; the
  // dynamic warnings below stay on textContent since they interpolate a header name.
  if (!hint.dataset.defaultHtml) {
    hint.dataset.defaultHtml = hint.innerHTML;
  }
  // No file yet: nothing to check against, so leave the guidance alone.
  const headers = typeof columnHeaders !== "undefined" ? columnHeaders : [];
  if (!headers.length) {
    hint.innerHTML = hint.dataset.defaultHtml;
    return;
  }
  // Only the enabled optimization axes matter. With Memory-Based off, a file
  // carrying CPU alone fully supports the run — warning that "the other
  // dimension falls back" would be a false alarm about a dimension the run
  // never consults. So judge the selected statistic against the ACTIVE axes'
  // columns, not both unconditionally.
  const axisColumn = (id, col) =>
    document.getElementById(id)?.checked ? col : null;
  const active = [
    axisColumn("cpuBased", stat.cpu),
    axisColumn("memoryBased", stat.memory),
  ].filter(Boolean);
  if (!active.length) {
    // No axis enabled — the generate flow blocks that separately; keep the
    // guidance neutral rather than warn about a column the run won't read.
    hint.innerHTML = hint.dataset.defaultHtml;
    return;
  }
  const missing = active.filter((c) => !headers.includes(c));
  if (missing.length === active.length) {
    hint.classList.add("hint-warning");
    hint.textContent =
      `The uploaded file has no ${stat.label} column${active.length > 1 ? "s" : ""} ` +
      `(${active.join(" / ")}) for the enabled optimization ${active.length > 1 ? "axes" : "axis"}, ` +
      `so every row falls back to the utilization it does carry. Map ${active.length > 1 ? "them" : "it"} ` +
      `in the column panel, or leave this on Average.`;
  } else if (missing.length) {
    hint.classList.add("hint-warning");
    hint.textContent =
      `"${missing.join('", "')}" ${missing.length > 1 ? "are" : "is"} missing, so ` +
      `${missing.length > 1 ? "those dimensions fall" : "that dimension falls"} back ` +
      `for every row. The basis used is reported per row in the "Sized On" column.`;
  } else {
    hint.textContent = `Sizing against ${stat.label} utilization. Rows missing it fall back, and the basis is reported in the "Sized On" column.`;
  }
}

function checkRuleConflicts() {
  const rules = getRuleDefaults();
  const env = rules.env.toLowerCase();
  const os = rules.os.toLowerCase();

  // ── Reset all rule group borders and conflict messages ──────────────────
  const ruleGroupIds = [
    "ruleGroupEnv",
    "ruleGroupOS",
    "ruleGroupWorkload",
    "ruleGroupCompliance",
    "ruleGroupMinGen",
  ];
  const conflictIds = [
    "conflictEnv",
    "conflictOS",
    "conflictWorkload",
    "conflictCompliance",
    "conflictMinGen",
  ];
  ruleGroupIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.border = "1.5px solid var(--border-slate)";
      el.style.background = "white";
    }
  });
  conflictIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "none";
      el.textContent = "";
    }
  });

  function flagConflict(groupId, msgId, msg) {
    const g = document.getElementById(groupId);
    const m = document.getElementById(msgId);
    if (g) {
      g.style.border = "1.5px solid var(--red-strong)";
      g.style.background = "var(--danger-bg-soft)";
    }
    if (m) {
      m.style.display = "block";
      m.textContent = "⚠ " + msg;
    }
  }

  // ── Conflict 1: OS=Windows + Graviton/ARM-only processor filter ─────────
  if (os === "windows") {
    const procRestrict = document.getElementById(
      "restrictProcessorManufacturers",
    )?.checked;
    if (procRestrict) {
      const procBoxes = document.querySelectorAll(
        "#processorCheckboxes input[type=checkbox]:checked",
      );
      const selected = Array.from(procBoxes).map((cb) =>
        cb.value.toLowerCase(),
      );
      const hasARM = selected.some(
        (v) => v === "aws" || v === "arm" || v === "graviton",
      );
      const hasIntel = selected.some((v) => v === "intel");
      const hasAMD = selected.some((v) => v === "amd");
      if (hasARM && !hasIntel && !hasAMD) {
        flagConflict(
          "ruleGroupOS",
          "conflictOS",
          "Windows needs Intel/AMD — contradicts Graviton-only processor filter",
        );
      }
    }
  }

  // ── Conflict 2: ENV=Production/Compliance + burstable-only family filter ─
  const isProdOrCompliance =
    env === "production" || env === "prod" || rules.compliance;
  if (isProdOrCompliance) {
    const mainRestrict = document.getElementById(
      "restrictMainFamilies",
    )?.checked;
    if (mainRestrict) {
      const famBoxes = document.querySelectorAll(
        "#mainFamiliesCheckboxes input[type=checkbox]:checked",
      );
      const selected = Array.from(famBoxes).map((cb) => cb.value.toLowerCase());
      const burstable = ["t", "b", "e2"]; // AWS t, Azure B, GCP e2
      const onlyBurst =
        selected.length > 0 &&
        selected.every((f) => burstable.some((b) => f.startsWith(b)));
      if (onlyBurst) {
        const conflictGroup = rules.compliance
          ? "ruleGroupCompliance"
          : "ruleGroupEnv";
        const conflictMsg = rules.compliance
          ? "conflictCompliance"
          : "conflictEnv";
        flagConflict(
          conflictGroup,
          conflictMsg,
          `${rules.compliance || rules.env} excludes burstable — contradicts restriction to burstable-only families`,
        );
      }
    }
  }

  // ── Conflict 3: Min Gen + Current Gen Only = redundant but not a conflict ─
  // (both restrict the pool, no contradiction — skip)

  // ── Conflict 4: Workload=ML/AI + processor filter = Intel/AMD only ───────
  if (rules.workload.toLowerCase() === "ml/ai") {
    const procRestrict = document.getElementById(
      "restrictProcessorManufacturers",
    )?.checked;
    if (procRestrict) {
      const procBoxes = document.querySelectorAll(
        "#processorCheckboxes input[type=checkbox]:checked",
      );
      const selected = Array.from(procBoxes).map((cb) =>
        cb.value.toLowerCase(),
      );
      const hasGPU = selected.some((v) => v === "aws" || v === "arm");
      if (selected.length > 0 && !hasGPU) {
        flagConflict(
          "ruleGroupWorkload",
          "conflictWorkload",
          "ML/AI prefers GPU families (Graviton/ARM accelerated) — Intel/AMD-only filter may exclude them",
        );
      }
    }
  }

  // ── Conflict 5: macOS + non-AWS providers selected ───────────────────────
  if (os === "macos" || os === "mac") {
    const nonAWS = (
      typeof selectedProviders !== "undefined" ? selectedProviders : []
    ).filter((p) => p !== "aws");
    if (nonAWS.length > 0) {
      flagConflict(
        "ruleGroupOS",
        "conflictOS",
        `macOS is AWS-only — ${nonAWS.map((p) => p.toUpperCase()).join(" & ")} will return no results for this OS`,
      );
    }
  }
}

// Toggle instance family name filter
function toggleInstanceFamilyNameFilter() {
  const controls = document.getElementById("instanceFamilyNameControls");
  const checkbox = document.getElementById("restrictInstanceFamilyNames");

  if (checkbox && controls) {
    if (checkbox.checked) {
      controls.classList.remove("hidden");
    } else {
      controls.classList.add("hidden");
    }
    console.log(
      "Instance family name filter:",
      checkbox.checked ? "Enabled" : "Disabled",
    );
  }
}

// Toggle processor manufacturer filter
function toggleProcessorManufacturerFilter() {
  const controls = document.getElementById("processorManufacturerControls");
  const checkbox = document.getElementById("restrictProcessorManufacturers");

  if (checkbox && controls) {
    if (checkbox.checked) {
      controls.classList.remove("hidden");
    } else {
      controls.classList.add("hidden");
    }
    console.log(
      "Processor manufacturer filter:",
      checkbox.checked ? "Enabled" : "Disabled",
    );
  }
}

// Toggle main families filter
function toggleMainFamiliesFilter() {
  const controls = document.getElementById("mainFamiliesControls");
  const checkbox = document.getElementById("restrictMainFamilies");

  if (checkbox && controls) {
    if (checkbox.checked) {
      controls.classList.remove("hidden");
    } else {
      controls.classList.add("hidden");
    }
    console.log(
      "Main families filter:",
      checkbox.checked ? "Enabled" : "Disabled",
    );
  }
}

// Toggle exclude types
function toggleExcludeTypes() {
  console.log("toggleExcludeTypes called");
  const excludeControls = document.getElementById("excludeControls");
  const checkbox = document.getElementById("excludeTypes");

  if (!excludeControls || !checkbox) {
    console.error("Required elements not found:", {
      excludeControls,
      checkbox,
    });
    return;
  }

  console.log("Exclude checkbox checked:", checkbox.checked);

  if (checkbox.checked) {
    excludeControls.classList.remove("hidden");
    updateExcludeControls();
  } else {
    excludeControls.classList.add("hidden");
  }
}

// Enhanced exclude controls with debugging
function updateExcludeControls() {
  console.log("updateExcludeControls called");
  console.log("Selected providers:", selectedProviders);

  const excludeControls = document.getElementById("excludeTypeControls");
  console.log("excludeTypeControls element:", excludeControls);

  if (!excludeControls) {
    console.error("excludeTypeControls element not found!");
    return;
  }

  excludeControls.innerHTML = "";

  if (selectedProviders.length === 0) {
    console.log("No providers selected, showing message");
    excludeControls.innerHTML =
      "<p style='color: var(--text-muted); font-style: italic; padding: 15px;'>Please select cloud providers first to see exclusion options.</p>";
    return;
  }

  console.log("Processing providers:", selectedProviders);
  console.log("Exclude types data:", excludeTypesData);

  selectedProviders.forEach((provider) => {
    console.log(`Creating exclude options for ${provider}`);

    if (
      !excludeTypesData[provider] ||
      excludeTypesData[provider].length === 0
    ) {
      console.error(`No exclude data found for provider: ${provider}`);
      return;
    }

    const div = document.createElement("div");
    div.innerHTML = `
      <div class="form-group">
        <label class="form-label">${provider.toUpperCase()} Exclude Options:</label>
        <div class="filter-checkbox-grid">
          ${excludeTypesData[provider]
            .map(
              (type) => `
              <div class="filter-checkbox-item">
                <input type="checkbox" id="exclude_${provider}_${type}" value="${type}">
                <label for="exclude_${provider}_${type}">
                  <strong>${type}</strong>
                  <span class="filter-description">${getExcludeTypeDescription(
                    provider,
                    type,
                  )}</span>
                </label>
              </div>
            `,
            )
            .join("")}
        </div>
      </div>
    `;
    excludeControls.appendChild(div);
    console.log(`Added exclude options for ${provider}`);
  });

  console.log("updateExcludeControls completed");
}

// Get exclude type descriptions - now routes to provider-specific functions
function getExcludeTypeDescription(provider, type) {
  // Try to use provider-specific description functions if available
  if (
    provider === "aws" &&
    typeof getAWSExcludeTypeDescription !== "undefined"
  ) {
    return getAWSExcludeTypeDescription(type);
  }
  if (
    provider === "azure" &&
    typeof getAzureExcludeTypeDescription !== "undefined"
  ) {
    return getAzureExcludeTypeDescription(type);
  }
  if (
    provider === "gcp" &&
    typeof getGCPExcludeTypeDescription !== "undefined"
  ) {
    return getGCPExcludeTypeDescription(type);
  }

  // Fallback to generic description
  return `Exclude ${type} instance types`;
}

// Fallback getter functions - these will be overridden by provider-specific files if available
function getSelectedInstanceFamilyNames() {
  const selected = [];
  // Look for checked checkboxes with pattern familyName_, azureSeries_, gcpFamily_
  const checkboxes = document.querySelectorAll(
    'input[id^="familyName_"]:checked, input[id^="azureSeries_"]:checked, input[id^="gcpFamily_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedProcessorManufacturers() {
  const selected = [];
  // Look for checked checkboxes with pattern processor_, azureProcessor_, gcpProcessor_
  const checkboxes = document.querySelectorAll(
    'input[id^="processor_"]:checked, input[id^="azureProcessor_"]:checked, input[id^="gcpProcessor_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedMainFamilies() {
  const selected = [];
  // Look for checked checkboxes with pattern mainFamily_, azureFamily_, gcpType_
  const checkboxes = document.querySelectorAll(
    'input[id^="mainFamily_"]:checked, input[id^="azureFamily_"]:checked, input[id^="gcpType_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

// Azure-specific fallback getter functions
function getSelectedAzureSeries() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="azureSeries_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedAzureProcessors() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="azureProcessor_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedAzureVMFamilies() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="azureFamily_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

// GCP-specific fallback getter functions
function getSelectedGCPFamilies() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="gcpFamily_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedGCPProcessors() {
  const selected = [];
  const checkboxes = document.querySelectorAll(
    'input[id^="gcpProcessor_"]:checked',
  );
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

function getSelectedGCPMachineTypes() {
  const selected = [];
  const checkboxes = document.querySelectorAll('input[id^="gcpType_"]:checked');
  checkboxes.forEach((checkbox) => {
    if (checkbox.value) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

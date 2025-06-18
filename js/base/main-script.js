// Main script for Cloud Instance Recommender
// Core functionality that works across all cloud providers

// Global variables
let csvData = [];
let columnHeaders = [];
let selectedProviders = [];
let processedResults = null;

// Enhanced exclude types data - now references provider-specific data
const excludeTypesData = {
  aws: [], // Will be populated from aws-specific.js
  azure: [], // Will be populated from azure-specific.js
  gcp: [], // Will be populated from gcp-specific.js
};

// Instance families data - now references provider-specific data
const familyData = {
  aws: [], // Will be populated from aws-specific.js
  azure: [], // Will be populated from azure-specific.js
  gcp: [], // Will be populated from gcp-specific.js
};

// Hardcoded column mappings
const COLUMN_MAPPINGS = {
  cpu: "CPU Count",
  memory: "Memory (GB)",
  cpuUtilization: "CPU Utilization",
  memoryUtilization: "Memory Utilization",
  vmName: "VM Name",
  awsRegion: "AWS Region",
  azureRegion: "Azure Region",
  gcpRegion: "GCP Region",
};

// Initialize page
document.addEventListener("DOMContentLoaded", function () {
  console.log("Initializing Cloud Instance Recommender with Modular Selectors");

  // Load provider-specific data if available
  loadProviderSpecificData();

  // Check if modular selector system is available
  if (typeof InstanceSelectorFactory !== "undefined") {
    console.log("✅ Modular Instance Selector System detected");
    console.log(
      "Supported providers:",
      InstanceSelectorFactory.getSupportedProviders()
    );
  } else {
    console.warn(
      "⚠️ Modular Instance Selector System not found. Please include the selector files."
    );
  }

  // Add file upload event handler
  const fileInput = document.getElementById("csvFile");
  if (fileInput) {
    fileInput.addEventListener("change", handleFileUpload);
  }

  // Initialize range inputs
  updateCpuRanges();
  updateMemoryRanges();

  // Load usage statistics
  loadUsageStatistics();

  // Initialize optimization controls
  toggleOptimizationMode();

  // Initialize AWS filter controls (if AWS-specific functions are available)
  if (typeof initializeAWSFilters !== "undefined") {
    initializeAWSFilters();
  }

  // Initialize recommendation type handlers
  initializeRecommendationTypeHandlers();
});

// Load provider-specific data
function loadProviderSpecificData() {
  // Load AWS data if available
  if (typeof awsExcludeTypesData !== "undefined") {
    excludeTypesData.aws = awsExcludeTypesData;
  }
  if (typeof awsFamilyData !== "undefined") {
    familyData.aws = awsFamilyData;
  }

  // Load Azure data if available
  if (typeof azureExcludeTypesData !== "undefined") {
    excludeTypesData.azure = azureExcludeTypesData;
  }
  if (typeof azureFamilyData !== "undefined") {
    familyData.azure = azureFamilyData;
  }

  // Load GCP data if available
  if (typeof gcpExcludeTypesData !== "undefined") {
    excludeTypesData.gcp = gcpExcludeTypesData;
  }
  if (typeof gcpFamilyData !== "undefined") {
    familyData.gcp = gcpFamilyData;
  }

  console.log("Loaded provider-specific data:", {
    aws: excludeTypesData.aws.length + " exclude types",
    azure: excludeTypesData.azure.length + " exclude types",
    gcp: excludeTypesData.gcp.length + " exclude types",
  });
}

// Initialize recommendation type handlers
function initializeRecommendationTypeHandlers() {
  const recommendationTypeInputs = document.querySelectorAll(
    'input[name="recommendationType"]'
  );
  recommendationTypeInputs.forEach((input) => {
    input.addEventListener("change", handleRecommendationTypeChange);
  });

  // Trigger initial setup
  handleRecommendationTypeChange();
}

// Toggle section collapse
function toggleSection(header) {
  const section = header.parentElement;
  section.classList.toggle("collapsed");
}

// Download sample CSV
function downloadSampleCSV() {
  const csvContent = `VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region
web-server-01,4,16,45,60,us-east-1,East US,us-central1-a
db-server-02,8,32,70,80,us-west-2,West US 2,us-west1-b
app-server-03,2,8,35,45,eu-west-1,North Europe,europe-west1-c
cache-server-04,2,4,25,30,us-east-1,East US,us-central1-a
api-server-05,4,8,65,55,us-west-1,West US,us-west1-b
microservice-06,1,2,15,20,us-east-1,East US,us-central1-a
worker-node-07,8,16,85,75,us-west-2,West US 2,us-west1-b
frontend-08,2,4,40,50,eu-west-1,North Europe,europe-west1-c`;

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "sample_instance_data.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Handle file upload using the integrated file handler
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  console.log("File upload started:", file.name);

  // Use the integrated file handler if available
  if (window.integrationManager && window.integrationManager.isReady) {
    // Let the FileHandlerIntegration handle it
    return;
  }

  // Fallback to simple parsing if integrated handler not available
  const reader = new FileReader();
  reader.onload = function (e) {
    const csv = e.target.result;
    parseCSV(csv);
  };
  reader.readAsText(file);
}

// Parse CSV
function parseCSV(csvText) {
  console.log("Parsing CSV data");
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());

  columnHeaders = headers;
  csvData = lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });

  console.log(`Parsed ${csvData.length} rows with ${headers.length} columns`);

  // Validate required columns
  const requiredColumns = Object.values(COLUMN_MAPPINGS).slice(0, 2); // CPU and Memory
  const missingColumns = requiredColumns.filter(
    (col) => !headers.includes(col)
  );

  const fileStatus = document.getElementById("fileStatus");
  if (missingColumns.length > 0) {
    fileStatus.className = "alert alert-warning";
    fileStatus.innerHTML = `⚠️ Missing required columns: ${missingColumns.join(
      ", "
    )}. Please check your CSV format.`;
    console.warn("Missing required columns:", missingColumns);
  } else {
    fileStatus.className = "alert alert-success";
    fileStatus.innerHTML = `✅ File loaded successfully: ${csvData.length} rows, ${headers.length} columns`;
    console.log("File validation successful");
  }
  fileStatus.classList.remove("hidden");

  // Show file statistics
  showFileStatistics();
}

// Parse CSV line handling quoted values
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// Show file statistics
function showFileStatistics() {
  const statsSection = document.getElementById("fileStatsSection");
  if (!statsSection) return;

  const stats = {
    totalRows: csvData.length,
    totalColumns: columnHeaders.length,
    hasRequiredColumns: [COLUMN_MAPPINGS.cpu, COLUMN_MAPPINGS.memory].every(
      (col) => columnHeaders.includes(col)
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
          <tr style="background: #f8f9fa;">
            ${headers
              .map(
                (h) =>
                  `<th style="padding: 8px; border: 1px solid #dee2e6; text-align: left;">${h}</th>`
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
  `;

  previewData.forEach((row, i) => {
    const bgColor = i % 2 === 0 ? "#ffffff" : "#f8f9fa";
    tableHTML += `<tr style="background: ${bgColor};">`;
    headers.forEach((header) => {
      const value = row[header] || "";
      const displayValue =
        value.length > 20 ? value.substring(0, 20) + "..." : value;
      tableHTML += `<td style="padding: 8px; border: 1px solid #dee2e6;">${displayValue}</td>`;
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
        "Some selected providers are not supported by the modular system"
      );
    }
  }

  // Update exclude controls when providers change
  const excludeCheckbox = document.getElementById("excludeTypes");
  if (excludeCheckbox && excludeCheckbox.checked) {
    updateExcludeControls();
  }
}

// Handle recommendation type change - Updated for modular system
function handleRecommendationTypeChange() {
  const optimizationControls = document.getElementById("optimizationControls");
  const selectedType = document.querySelector(
    'input[name="recommendationType"]:checked'
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
      "<p style='color: #666; font-style: italic; padding: 15px;'>Please select cloud providers first to see exclusion options.</p>";
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
                    type
                  )}</span>
                </label>
              </div>
            `
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

// Generate recommendations
function generateRecommendations() {
  console.log(
    "Starting recommendation generation with modular selector system"
  );

  // Validation
  if (csvData.length === 0) {
    alert("Please upload a CSV file first.");
    return;
  }

  if (selectedProviders.length === 0) {
    alert("Please select at least one cloud provider.");
    return;
  }

  // Check if modular system is available
  if (typeof getInstanceRecommendationWithSelector === "undefined") {
    alert(
      "Modular Instance Selector system not found. Please include the required files:\n- base-instance-selector.js\n- aws-instance-selector.js\n- azure-instance-selector.js\n- gcp-instance-selector.js\n- instance-selector-factory.js"
    );
    return;
  }

  // Check if required columns exist
  const requiredColumns = [COLUMN_MAPPINGS.cpu, COLUMN_MAPPINGS.memory];
  const missingColumns = requiredColumns.filter(
    (col) => !columnHeaders.includes(col)
  );

  if (missingColumns.length > 0) {
    alert(`Missing required columns: ${missingColumns.join(", ")}`);
    return;
  }

  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked'
  );
  if (!recommendationType) {
    alert("Please select a recommendation type.");
    return;
  }

  console.log(
    "Validation passed, starting processing with type:",
    recommendationType.value
  );

  // Show processing status
  const processingStatus = document.getElementById("processingStatus");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");

  processingStatus.classList.remove("hidden");

  // Simulate processing
  let progress = 0;
  const progressInterval = setInterval(() => {
    progress += Math.random() * 15 + 5;
    if (progress > 100) progress = 100;

    progressFill.style.width = progress + "%";
    progressText.textContent = `Processing ${csvData.length} rows for ${
      selectedProviders.length
    } providers... ${Math.round(progress)}%`;

    if (progress >= 100) {
      clearInterval(progressInterval);
      progressText.textContent = "Complete!";

      setTimeout(() => {
        processingStatus.classList.add("hidden");
        processRecommendations();
      }, 1000);
    }
  }, 300);
}

// Enhanced process recommendations with modular system and recommendation type control
async function processRecommendations() {
  console.log(
    "Processing recommendations with modular selector system and N/2, N, N+1 optimization strategy"
  );

  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked'
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

  // Prepare options with comprehensive filtering and recommendation type control
  const options = {
    // **NEW: Recommendation type control**
    generateLikeToLike: generateLikeToLike,
    generateOptimized: generateOptimized,

    // Optimization strategy parameters (only used if generateOptimized is true)
    cpuBased: document.getElementById("cpuBased")?.checked || false,
    memoryBased: document.getElementById("memoryBased")?.checked || false,
    cpuDownsizeMax: parseInt(
      document.getElementById("cpuDownsizeMax")?.value || 50
    ),
    cpuUpsizeMin: parseInt(
      document.getElementById("cpuUpsizeMin")?.value || 80
    ),
    memoryDownsizeMax: parseInt(
      document.getElementById("memoryDownsizeMax")?.value || 50
    ),
    memoryUpsizeMin: parseInt(
      document.getElementById("memoryUpsizeMin")?.value || 80
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

    // Azure-specific options
    selectedAzureSeries:
      typeof getSelectedAzureSeries !== "undefined"
        ? getSelectedAzureSeries()
        : [],
    selectedAzureProcessors:
      typeof getSelectedAzureProcessors !== "undefined"
        ? getSelectedAzureProcessors()
        : [],
    selectedAzureVMFamilies:
      typeof getSelectedAzureVMFamilies !== "undefined"
        ? getSelectedAzureVMFamilies()
        : [],

    // GCP-specific options
    selectedGCPFamilies:
      typeof getSelectedGCPFamilies !== "undefined"
        ? getSelectedGCPFamilies()
        : [],
    selectedGCPProcessors:
      typeof getSelectedGCPProcessors !== "undefined"
        ? getSelectedGCPProcessors()
        : [],
    selectedGCPMachineTypes:
      typeof getSelectedGCPMachineTypes !== "undefined"
        ? getSelectedGCPMachineTypes()
        : [],
  };

  console.log("Processing options:", {
    recommendationTypes: { generateLikeToLike, generateOptimized },
    filtering: {
      currentGenOnly: options.currentGenerationOnly,
      familyNames: options.selectedInstanceFamilyNames.length,
      processors: options.selectedProcessorManufacturers.length,
      mainFamilies: options.selectedMainFamilies.length,
      excludeTypes: options.excludeTypes.length,
    },
    optimization: {
      cpuBased: options.cpuBased,
      memoryBased: options.memoryBased,
      ranges: `CPU(${options.cpuDownsizeMax}-${options.cpuUpsizeMin}), Memory(${options.memoryDownsizeMax}-${options.memoryUpsizeMin})`,
    },
  });

  try {
    // Use the modular instance selector system
    console.log(
      "Calling getInstanceRecommendationWithSelector with modular system"
    );
    processedResults = await getInstanceRecommendationWithSelector(
      csvData,
      selectedProviders,
      options
    );

    console.log("Recommendations processed successfully:", {
      totalRows: processedResults.length,
      sampleColumns: Object.keys(processedResults[0] || {}).filter(
        (key) => key.includes("Like-to-Like") || key.includes("Optimized")
      ),
    });

    // Update usage statistics and show download section
    updateUsageStatistics(csvData.length);
    document.getElementById("downloadSection").classList.remove("hidden");

    // Log what was actually generated
    if (processedResults.length > 0) {
      const sampleResult = processedResults[0];
      const generatedColumns = Object.keys(sampleResult).filter(
        (key) => key.includes("Like-to-Like") || key.includes("Optimized")
      );
      console.log("Generated columns:", generatedColumns);
    }
  } catch (error) {
    console.error("Error processing recommendations:", error);
    alert(
      `An error occurred while processing recommendations: ${error.message}`
    );
  }
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
    gravitonCheckboxes.map((cb) => (cb ? cb.id : "null"))
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
      `input[id^="exclude_${provider}_"]:checked`
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

// Download results
function downloadResults() {
  if (!processedResults || processedResults.length === 0) {
    alert("No results to download. Please generate recommendations first.");
    return;
  }

  console.log("Downloading results with", processedResults.length, "rows");

  // Use the file handler if available
  if (
    window.integrationManager &&
    window.integrationManager.exportRecommendations
  ) {
    window.integrationManager.exportRecommendations(processedResults);
    return;
  }

  // Fallback to simple CSV export
  const headers = Object.keys(processedResults[0]);
  const csvContent = [
    headers.join(","),
    ...processedResults.map((row) =>
      headers
        .map((header) => {
          const value = row[header] || "";
          return value.toString().includes(",") ? `"${value}"` : value;
        })
        .join(",")
    ),
  ].join("\n");

  // Download
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = `instance_recommendations_${
    new Date().toISOString().split("T")[0]
  }.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  console.log("CSV download completed");
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
      JSON.stringify(usageStats)
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
    `Updated statistics: ${usageStats.toolUses} tool uses, ${usageStats.totalVMs} total VMs processed`
  );
}

// Update usage counter display
function updateUsageCounters() {
  const toolUsageElement = document.getElementById("toolUsageCount");
  const totalVMsElement = document.getElementById("totalVMsProcessed");

  if (toolUsageElement) toolUsageElement.textContent = usageStats.toolUses;
  if (totalVMsElement) totalVMsElement.textContent = usageStats.totalVMs;
}

// Export function to get instance recommendation (for integration with file handler)
window.getInstanceRecommendation = function (
  provider,
  cpu,
  memory,
  cpuUtil,
  memoryUtil,
  recommendationType
) {
  let result = {
    instanceType: "Not found",
    status: "No match",
    hourlyCost: "0",
    vcpus: 0,
    memory: 0,
  };

  // Try to use the modular selector system
  if (typeof InstanceSelectorFactory !== "undefined") {
    try {
      const selector = InstanceSelectorFactory.createSelector(provider);
      const options = {
        currentGenerationOnly: true,
      };

      // This would need the selector to be initialized first
      // For now, return the fallback result
      console.log(
        "Modular selector available but not initialized for single recommendation"
      );
    } catch (error) {
      console.warn(
        "Error using modular selector for single recommendation:",
        error
      );
    }
  }

  return result;
};

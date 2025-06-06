// Global variables
let csvData = [];
let columnHeaders = [];
let selectedProviders = [];
let processedResults = null;

// Sample instance data (simplified for demo)
const instanceData = {
  aws: {
    "t3.micro": { cpu: 2, memory: 1, price: 0.0104 },
    "t3.small": { cpu: 2, memory: 2, price: 0.0208 },
    "t3.medium": { cpu: 2, memory: 4, price: 0.0416 },
    "t3.large": { cpu: 2, memory: 8, price: 0.0832 },
    "m5.large": { cpu: 2, memory: 8, price: 0.096 },
    "m5.xlarge": { cpu: 4, memory: 16, price: 0.192 },
    "m5.2xlarge": { cpu: 8, memory: 32, price: 0.384 },
    "c5.large": { cpu: 2, memory: 4, price: 0.085 },
    "c5.xlarge": { cpu: 4, memory: 8, price: 0.17 },
    "r5.large": { cpu: 2, memory: 16, price: 0.126 },
  },
  azure: {
    Standard_B1s: { cpu: 1, memory: 1, price: 0.0104 },
    Standard_B2s: { cpu: 2, memory: 4, price: 0.0416 },
    Standard_D2s_v3: { cpu: 2, memory: 8, price: 0.096 },
    Standard_D4s_v3: { cpu: 4, memory: 16, price: 0.192 },
  },
  gcp: {
    "e2-micro": { cpu: 1, memory: 1, price: 0.0063 },
    "e2-small": { cpu: 1, memory: 2, price: 0.0126 },
    "e2-medium": { cpu: 1, memory: 4, price: 0.0252 },
    "n1-standard-1": { cpu: 1, memory: 3.75, price: 0.0475 },
    "n1-standard-2": { cpu: 2, memory: 7.5, price: 0.095 },
    "n1-standard-4": { cpu: 4, memory: 15, price: 0.19 },
  },
};

// Exclude types data
const excludeTypesData = {
  aws: ["Graviton", "Mac", "Nitro", "GPU", "FPGA"],
  azure: ["Promo", "GPU", "HPC", "Memory Optimized"],
  gcp: ["N2D", "TPU", "GPU", "Preemptible"],
};

// Instance families data
const familyData = {
  aws: ["t3", "m5", "c5", "r5", "m4", "c4", "r4"],
  azure: ["Standard_B", "Standard_D", "Standard_E", "Standard_F"],
  gcp: ["e2", "n1", "n2", "c2", "m1"],
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
});

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
app-server-03,2,8,35,45,eu-west-1,North Europe,europe-west1-c`;

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
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());

  columnHeaders = headers;
  csvData = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });

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
  } else {
    fileStatus.className = "alert alert-success";
    fileStatus.innerHTML = `✅ File loaded successfully: ${csvData.length} rows, ${headers.length} columns`;
  }
  fileStatus.classList.remove("hidden");

  // Show file statistics
  showFileStatistics();
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

  updateExcludeControls();
  updateFamilyControls();
}

// Handle recommendation type change
function handleRecommendationTypeChange() {
  const optimizationControls = document.getElementById("optimizationControls");
  const selectedType = document.querySelector(
    'input[name="recommendationType"]:checked'
  ).value;

  if (selectedType === "optimized" || selectedType === "both") {
    optimizationControls.classList.remove("hidden");
  } else {
    optimizationControls.classList.add("hidden");
  }
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
  const excludeControls = document.getElementById("excludeControls");
  const checkbox = document.getElementById("excludeTypes");

  if (checkbox.checked) {
    excludeControls.classList.remove("hidden");
    updateExcludeControls();
  } else {
    excludeControls.classList.add("hidden");
  }
}

// Update exclude controls
function updateExcludeControls() {
  const excludeControls = document.getElementById("excludeTypeControls");
  if (!excludeControls) return;

  excludeControls.innerHTML = "";

  selectedProviders.forEach((provider) => {
    const div = document.createElement("div");
    div.innerHTML = `
      <div class="form-group">
        <label class="form-label">${provider.toUpperCase()} Exclude:</label>
        ${excludeTypesData[provider]
          .map(
            (type) => `
            <div class="checkbox-item" style="margin-bottom: 10px;">
              <input type="checkbox" id="exclude_${provider}_${type}" value="${type}">
              <label for="exclude_${provider}_${type}">${type}</label>
            </div>
          `
          )
          .join("")}
      </div>
    `;
    excludeControls.appendChild(div);
  });
}

// Toggle restrict families
function toggleRestrictFamilies() {
  const familyControls = document.getElementById("familyControls");
  const checkbox = document.getElementById("restrictFamilies");

  if (checkbox.checked) {
    familyControls.classList.remove("hidden");
    updateFamilyControls();
  } else {
    familyControls.classList.add("hidden");
  }
}

// Update family controls
function updateFamilyControls() {
  const familyControls = document.getElementById("familyTypeControls");
  if (!familyControls) return;

  familyControls.innerHTML = "";

  selectedProviders.forEach((provider) => {
    const div = document.createElement("div");
    div.innerHTML = `
      <div class="form-group">
        <label class="form-label">${provider.toUpperCase()} Families:</label>
        <select class="form-control" id="family_${provider}" multiple style="height: 120px;">
          ${familyData[provider]
            .map((family) => `<option value="${family}">${family}</option>`)
            .join("")}
        </select>
      </div>
    `;
    familyControls.appendChild(div);
  });
}

// Generate recommendations
function generateRecommendations() {
  // Validation
  if (csvData.length === 0) {
    alert("Please upload a CSV file first.");
    return;
  }

  if (selectedProviders.length === 0) {
    alert("Please select at least one cloud provider.");
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

  // Show processing status
  const processingStatus = document.getElementById("processingStatus");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");

  processingStatus.classList.remove("hidden");

  // Simulate processing
  let progress = 0;
  const progressInterval = setInterval(() => {
    progress += Math.random() * 20;
    if (progress > 100) progress = 100;

    progressFill.style.width = progress + "%";
    progressText.textContent = `Processing... ${Math.round(progress)}%`;

    if (progress >= 100) {
      clearInterval(progressInterval);
      progressText.textContent = "Complete!";

      setTimeout(() => {
        processingStatus.classList.add("hidden");
        processRecommendations();
      }, 1000);
    }
  }, 200);
}

// Process recommendations
function processRecommendations() {
  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked'
  ).value;

  // Process each row
  processedResults = csvData.map((row, index) => {
    const result = { ...row };

    selectedProviders.forEach((provider) => {
      const cpu = parseInt(row[COLUMN_MAPPINGS.cpu]) || 0;
      const memory = parseInt(row[COLUMN_MAPPINGS.memory]) || 0;
      const cpuUtil = parseFloat(row[COLUMN_MAPPINGS.cpuUtilization]) || 0;
      const memoryUtil =
        parseFloat(row[COLUMN_MAPPINGS.memoryUtilization]) || 0;

      if (cpu === 0 || memory === 0) {
        result[`${provider.toUpperCase()} Recommendation`] =
          "Invalid CPU or Memory data";
        result[`${provider.toUpperCase()} Status`] = "Error";
        result[`${provider.toUpperCase()} Monthly Cost (USD)`] = "N/A";
        return;
      }

      let recommendation = "";
      let status = "";
      let monthlyCost = "N/A";

      if (
        recommendationType === "like-to-like" ||
        recommendationType === "both"
      ) {
        const likeToLike = findLikeToLikeRecommendation(provider, cpu, memory);
        recommendation = likeToLike.instanceType;
        status = "Like-to-Like";
        monthlyCost = likeToLike.monthlyCost;
      }

      if (recommendationType === "optimized" || recommendationType === "both") {
        if (cpuUtil > 0 || memoryUtil > 0) {
          const optimized = findOptimizedRecommendation(
            provider,
            cpu,
            memory,
            cpuUtil,
            memoryUtil
          );
          if (recommendationType === "both" && recommendation) {
            recommendation += " | " + optimized.instanceType;
            status += " | Optimized";
            monthlyCost += " | " + optimized.monthlyCost;
          } else {
            recommendation = optimized.instanceType;
            status = "Optimized";
            monthlyCost = optimized.monthlyCost;
          }
        } else if (recommendationType === "optimized") {
          recommendation = "No utilization data";
          status = "Missing Data";
        }
      }

      result[`${provider.toUpperCase()} Recommendation`] = recommendation;
      result[`${provider.toUpperCase()} Status`] = status;
      result[`${provider.toUpperCase()} Monthly Cost (USD)`] = monthlyCost;
    });

    return result;
  });

  // Update usage statistics
  updateUsageStatistics(csvData.length);

  // Show download section
  document.getElementById("downloadSection").classList.remove("hidden");
}

// Find like-to-like recommendation
function findLikeToLikeRecommendation(provider, cpu, memory) {
  const instances = instanceData[provider];
  const suitable = Object.entries(instances)
    .filter(([name, specs]) => specs.cpu >= cpu && specs.memory >= memory)
    .sort((a, b) => a[1].price - b[1].price);

  if (suitable.length > 0) {
    const [instanceName, specs] = suitable[0];
    return {
      instanceType: instanceName,
      monthlyCost: (specs.price * 730).toFixed(2), // 730 hours per month
    };
  }

  return {
    instanceType: "No suitable instance found",
    monthlyCost: "N/A",
  };
}

// Find optimized recommendation
function findOptimizedRecommendation(
  provider,
  cpu,
  memory,
  cpuUtil,
  memoryUtil
) {
  const cpuBased = document.getElementById("cpuBased").checked;
  const memoryBased = document.getElementById("memoryBased").checked;

  let targetCpu = cpu;
  let targetMemory = memory;

  // CPU-based optimization
  if (cpuBased && cpuUtil > 0) {
    const cpuDownsizeMax = parseInt(
      document.getElementById("cpuDownsizeMax").value
    );
    const cpuKeepMax = parseInt(document.getElementById("cpuKeepMax").value);

    if (cpuUtil <= cpuDownsizeMax) {
      const downsizing = document.querySelector(
        'input[name="downsizing"]:checked'
      ).value;
      targetCpu =
        downsizing === "half"
          ? Math.max(1, Math.ceil(cpu * 0.5))
          : Math.max(1, cpu - 1);
    } else if (cpuUtil > cpuKeepMax) {
      targetCpu = Math.ceil(cpu * 1.5);
    }
  }

  // Memory-based optimization
  if (memoryBased && memoryUtil > 0) {
    const memoryDownsizeMax = parseInt(
      document.getElementById("memoryDownsizeMax").value
    );
    const memoryKeepMax = parseInt(
      document.getElementById("memoryKeepMax").value
    );

    if (memoryUtil <= memoryDownsizeMax) {
      const downsizing = document.querySelector(
        'input[name="downsizing"]:checked'
      ).value;
      targetMemory =
        downsizing === "half"
          ? Math.max(1, Math.ceil(memory * 0.5))
          : Math.max(1, memory - 1);
    } else if (memoryUtil > memoryKeepMax) {
      targetMemory = Math.ceil(memory * 1.5);
    }
  }

  return findLikeToLikeRecommendation(provider, targetCpu, targetMemory);
}

// Download results
function downloadResults() {
  if (!processedResults || processedResults.length === 0) {
    alert("No results to download. Please generate recommendations first.");
    return;
  }

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
  a.download = "instance_recommendations.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Usage statistics management
let usageStats = {
  toolUses: 0,
  totalVMs: 0,
};

// Load usage statistics from localStorage (simulating file storage)
function loadUsageStatistics() {
  try {
    const stored = localStorage.getItem("cloudInstanceRecommenderStats");
    if (stored) {
      usageStats = JSON.parse(stored);
      updateUsageCounters();
    }
  } catch (e) {
    console.error("Error loading statistics:", e);
  }
}

// Save usage statistics
function saveUsageStatistics() {
  try {
    localStorage.setItem(
      "cloudInstanceRecommenderStats",
      JSON.stringify(usageStats)
    );
  } catch (e) {
    console.error("Error saving statistics:", e);
  }
}

// Update usage statistics
function updateUsageStatistics(vmCount) {
  usageStats.toolUses++;
  usageStats.totalVMs += vmCount;
  updateUsageCounters();
  saveUsageStatistics();
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
    monthlyCost: "0",
    vcpus: 0,
    memory: 0,
  };

  if (recommendationType === "like-to-like" || recommendationType === "both") {
    const recommendation = findLikeToLikeRecommendation(provider, cpu, memory);
    const instance = instanceData[provider][recommendation.instanceType];
    if (instance) {
      result = {
        instanceType: recommendation.instanceType,
        status: "Like-to-Like",
        monthlyCost: recommendation.monthlyCost,
        vcpus: instance.cpu,
        memory: instance.memory,
      };
    }
  }

  if (recommendationType === "optimized" && (cpuUtil > 0 || memoryUtil > 0)) {
    const recommendation = findOptimizedRecommendation(
      provider,
      cpu,
      memory,
      cpuUtil,
      memoryUtil
    );
    const instance = instanceData[provider][recommendation.instanceType];
    if (instance) {
      result = {
        instanceType: recommendation.instanceType,
        status: "Optimized",
        monthlyCost: recommendation.monthlyCost,
        vcpus: instance.cpu,
        memory: instance.memory,
      };
    }
  }

  return result;
};

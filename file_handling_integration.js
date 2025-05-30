// Complete Integration script to replace the existing file handling in your HTML
// This should be added after the FileHandler class definition

// Global variables for integration
let fileHandlerIntegration = null;
let processedData = null;
let columnMappings = null;

// Initialize the file handler when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  initializeFileHandler();
});

function initializeFileHandler() {
  // Create file handler integration instance
  fileHandlerIntegration = new FileHandlerIntegration();

  // Set up callbacks
  fileHandlerIntegration.onFileProcessed = handleFileProcessed;
  fileHandlerIntegration.onError = handleFileError;

  // Initialize file upload
  fileHandlerIntegration.initializeFileUpload("csvFile", "fileStatus");

  // Add drag and drop functionality
  setupDragAndDrop();

  // Add file validation UI enhancements
  enhanceFileUploadUI();
}

// Handle successful file processing
function handleFileProcessed(result, mappings, validationIssues) {
  // Store processed data globally
  processedData = result.data;
  csvData = result.data; // Update existing global variable
  columnHeaders = result.headers; // Update existing global variable

  // Set hardcoded column mappings
  setColumnMappings();

  // Show processing results
  showProcessingResults(validationIssues);

  // Update file statistics
  updateFileStatistics(result.metadata);

  // Enable recommendation generation if data is valid
  enableRecommendationGeneration();

  // Show data preview
  showDataPreview(result.data.slice(0, 5)); // Show first 5 rows
}

// Handle file processing errors
function handleFileError(error) {
  console.error("File processing error:", error);

  // Reset UI state
  resetFileUploadState();

  // Show specific error guidance
  showErrorGuidance(error.message);
}

// Set hardcoded column mappings in variables
function setColumnMappings() {
  const defaultMappings = {
    cpu: "CPU Count", // Default CPU column name
    memory: "Memory (GB)", // Default Memory column name
    cpuUtilization: "CPU Utilization (%)", // Default CPU utilization column name
    memoryUtilization: "Memory Utilization (%)", // Default Memory utilization column name
    vmName: "VM Name", // Default VM name column name
    awsRegion: "AWS Region", // Default AWS region column name
    azureRegion: "Azure Region", // Default Azure region column name
    gcpRegion: "GCP Region", // Default GCP region column name
  };

  // Store mappings globally for later use
  columnMappings = {};

  // Check if each default column exists in the CSV headers
  Object.entries(defaultMappings).forEach(([key, defaultValue]) => {
    if (columnHeaders.includes(defaultValue)) {
      columnMappings[key] = defaultValue;
    } else {
      columnMappings[key] = null; // Column not found
    }
  });

  console.log("Column Mappings Set:", columnMappings);
}

// Show processing results and validation issues
function showProcessingResults(validationIssues) {
  const mappingAlert = document.getElementById("mappingAlert");
  if (!mappingAlert) return;

  let message = "";
  let alertType = "alert-info";

  // Show file processed successfully message
  message = "✅ File processed successfully. ";
  alertType = "alert-success";

  // Add validation issues
  if (validationIssues.length > 0) {
    const criticalIssues = validationIssues.filter(
      (issue) => issue.includes("not found") || issue.includes("missing")
    );

    if (criticalIssues.length > 0) {
      message += `⚠️ Critical issues found: ${criticalIssues
        .slice(0, 2)
        .join(", ")}`;
      alertType = "alert-warning";
    } else {
      message += `ℹ️ ${validationIssues.length} data quality issues detected.`;
    }
  }

  // Add data quality score
  const dataQuality = fileHandlerIntegration.fileHandler.calculateDataQuality();
  message += ` Data Quality Score: ${dataQuality}%`;

  if (message) {
    mappingAlert.className = `alert ${alertType}`;
    mappingAlert.innerHTML = message;
    mappingAlert.classList.remove("hidden");

    // Auto-hide after 10 seconds if successful
    if (alertType === "alert-success") {
      setTimeout(() => {
        mappingAlert.classList.add("hidden");
      }, 10000);
    }
  }
}

// Update file statistics display
function updateFileStatistics(metadata) {
  const stats = {
    fileName: metadata.name,
    fileSize: `${(metadata.size / 1024).toFixed(1)} KB`,
    rowCount: metadata.rowCount,
    columnCount: metadata.columnCount,
    lastModified: new Date(metadata.lastModified).toLocaleString(),
  };

  console.log("File Statistics:", stats);

  // Update file status display
  const fileStatus = document.getElementById("fileStatus");
  if (fileStatus) {
    const currentContent = fileStatus.innerHTML;
    fileStatus.innerHTML =
      currentContent +
      `<br><small><strong>File:</strong> ${stats.fileName} | <strong>Size:</strong> ${stats.fileSize} | <strong>Rows:</strong> ${stats.rowCount} | <strong>Columns:</strong> ${stats.columnCount}</small>`;
  }

  // Create or update file stats section
  createFileStatsSection(stats);
}

// Create file statistics section
function createFileStatsSection(stats) {
  let statsSection = document.getElementById("fileStatsSection");
  if (!statsSection) {
    // Create stats section if it doesn't exist
    const container = document.querySelector(".container") || document.body;
    statsSection = document.createElement("div");
    statsSection.id = "fileStatsSection";
    statsSection.className = "file-stats-section";
    statsSection.style.cssText = `
            margin: 10px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #007bff;
            font-size: 14px;
        `;

    // Insert after file upload section
    const fileUploadSection =
      document.querySelector(".file-upload-section") ||
      document.querySelector('[class*="upload"]') ||
      container.firstElementChild;

    if (
      fileUploadSection &&
      container.contains(fileUploadSection) &&
      fileUploadSection.nextSibling &&
      container.contains(fileUploadSection.nextSibling)
    ) {
      container.insertBefore(statsSection, fileUploadSection.nextSibling);
    } else {
      container.appendChild(statsSection);
    }
  }

  statsSection.innerHTML = `
        <h6 style="margin: 0 0 10px 0; color: #495057;">📊 File Statistics</h6>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
            <div><strong>File Name:</strong> ${stats.fileName}</div>
            <div><strong>File Size:</strong> ${stats.fileSize}</div>
            <div><strong>Total Rows:</strong> ${stats.rowCount}</div>
            <div><strong>Total Columns:</strong> ${stats.columnCount}</div>
            <div><strong>Last Modified:</strong> ${stats.lastModified}</div>
        </div>
    `;
}

// Setup drag and drop functionality
function setupDragAndDrop() {
  const fileUploadLabel =
    document.querySelector(".file-upload-label") ||
    document.querySelector('label[for="csvFile"]') ||
    document.querySelector("#csvFile").parentElement;

  if (!fileUploadLabel) return;

  // Prevent default drag behaviors
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    fileUploadLabel.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  // Highlight drop area when item is dragged over it
  ["dragenter", "dragover"].forEach((eventName) => {
    fileUploadLabel.addEventListener(eventName, highlight, false);
  });

  ["dragleave", "drop"].forEach((eventName) => {
    fileUploadLabel.addEventListener(eventName, unhighlight, false);
  });

  // Handle dropped files
  fileUploadLabel.addEventListener("drop", handleDrop, false);

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function highlight(e) {
    fileUploadLabel.style.backgroundColor = "#e8ebff";
    fileUploadLabel.style.borderColor = "#4c63d2";
    fileUploadLabel.style.transform = "scale(1.02)";
    fileUploadLabel.style.transition = "all 0.2s ease";
  }

  function unhighlight(e) {
    fileUploadLabel.style.backgroundColor = "";
    fileUploadLabel.style.borderColor = "";
    fileUploadLabel.style.transform = "";
  }

  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length > 0) {
      const file = files[0];

      // Validate file type before processing
      if (!file.name.toLowerCase().endsWith(".csv")) {
        alert("Please drop a CSV file.");
        return;
      }

      const fileInput = document.getElementById("csvFile");
      if (fileInput) {
        // Create a new FileList and assign to input
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        // Trigger change event
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
      }
    }
  }
}

// Show data preview
function showDataPreview(previewData) {
  let previewSection = document.getElementById("dataPreviewSection");
  if (!previewSection) {
    // Create preview section
    const container = document.querySelector(".container") || document.body;
    previewSection = document.createElement("div");
    previewSection.id = "dataPreviewSection";
    previewSection.className = "data-preview-section";
    previewSection.style.cssText = `
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #28a745;
        `;

    // Insert after file stats section
    const fileStatsSection = document.getElementById("fileStatsSection");
    if (
      fileStatsSection &&
      container.contains(fileStatsSection) &&
      fileStatsSection.nextSibling &&
      container.contains(fileStatsSection.nextSibling)
    ) {
      container.insertBefore(previewSection, fileStatsSection.nextSibling);
    } else {
      container.appendChild(previewSection);
    }
  }

  let tableHTML = `
        <h6 style="margin: 0 0 10px 0; color: #495057;">👁️ Data Preview (First 5 rows)</h6>
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background-color: #e9ecef;">
    `;

  // Add headers
  if (previewData.length > 0) {
    Object.keys(previewData[0]).forEach((header) => {
      tableHTML += `<th style="padding: 8px; border: 1px solid #dee2e6; text-align: left;">${header}</th>`;
    });
  }

  tableHTML += `</tr></thead><tbody>`;

  // Add data rows
  previewData.forEach((row, index) => {
    tableHTML += `<tr style="background-color: ${
      index % 2 === 0 ? "#ffffff" : "#f8f9fa"
    };">`;
    Object.values(row).forEach((value) => {
      const displayValue =
        value && value.toString().length > 20
          ? value.toString().substring(0, 20) + "..."
          : value || "";
      tableHTML += `<td style="padding: 8px; border: 1px solid #dee2e6;">${displayValue}</td>`;
    });
    tableHTML += `</tr>`;
  });

  tableHTML += `</tbody></table></div>`;
  previewSection.innerHTML = tableHTML;
}

// Enhanced file upload handler (backward compatibility)
function handleFileUpload(event) {
  console.log("File upload handled by FileHandlerIntegration");
}

// Data validation before recommendation generation
function validateDataForRecommendations() {
  if (!processedData || processedData.length === 0) {
    return {
      isValid: false,
      error: "No data loaded. Please upload a CSV file first.",
    };
  }

  if (!columnMappings.cpu || !columnMappings.memory) {
    return {
      isValid: false,
      error:
        "Required columns (CPU Count, Memory (GB)) not found in CSV. Please check your column headers.",
    };
  }

  // Check if required columns have valid data
  const validationIssues =
    fileHandlerIntegration.fileHandler.validateRequiredData({
      cpu: columnMappings.cpu,
      memory: columnMappings.memory,
    });

  if (validationIssues.length > 0) {
    const criticalIssues = validationIssues.filter(
      (issue) => issue.includes("not found") || issue.includes("missing")
    );

    if (criticalIssues.length > 0) {
      return {
        isValid: false,
        error: `Data validation failed: ${criticalIssues[0]}`,
      };
    }
  }

  return { isValid: true };
}

// Enhanced recommendation generation
function generateRecommendations() {
  // Validate data first
  const validation = validateDataForRecommendations();
  if (!validation.isValid) {
    showAlert(validation.error, "error");
    return;
  }

  // Validate cloud provider selection
  if (!window.selectedProviders || selectedProviders.length === 0) {
    showAlert("Please select at least one cloud provider.", "warning");
    return;
  }

  // Validate recommendation type
  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked'
  );
  if (!recommendationType) {
    showAlert("Please select a recommendation type.", "warning");
    return;
  }

  // Clean data before processing using stored mappings
  const cleanedData =
    fileHandlerIntegration.fileHandler.cleanData(columnMappings);

  // Show processing status
  showProcessingStatus(cleanedData.length, selectedProviders.length);

  // Process recommendations with cleaned data
  setTimeout(() => {
    processRecommendationsWithCleanData(cleanedData, columnMappings);
  }, 1000);
}

// Show processing status
function showProcessingStatus(totalRows, totalProviders) {
  const processingStatus = document.getElementById("processingStatus");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");

  if (processingStatus) {
    processingStatus.classList.remove("hidden");

    const estimatedTime = Math.max(2000, totalRows * totalProviders * 50);

    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 15 + 5;
      if (progress > 100) progress = 100;

      if (progressFill) progressFill.style.width = progress + "%";
      if (progressText) {
        progressText.textContent = `Processing ${totalRows} rows for ${totalProviders} providers... ${Math.round(
          progress
        )}%`;
      }

      if (progress >= 100) {
        clearInterval(progressInterval);
        if (progressText) progressText.textContent = "Complete!";

        setTimeout(() => {
          processingStatus.classList.add("hidden");
        }, 1000);
      }
    }, estimatedTime / 20);
  }
}

// Process recommendations with cleaned data
function processRecommendationsWithCleanData(cleanedData, mappings) {
  try {
    const recommendationType = document.querySelector(
      'input[name="recommendationType"]:checked'
    ).value;

    // Process each row with cleaned data
    window.processedResults = cleanedData.map((row, index) => {
      const result = { ...row };

      // Add row identifier
      if (mappings.vmName && row[mappings.vmName]) {
        result["VM/Server Name"] = row[mappings.vmName];
      } else {
        result["Row Number"] = index + 1;
      }

      selectedProviders.forEach((provider) => {
        const cpu = parseInt(row[mappings.cpu]) || 0;
        const memory = parseInt(row[mappings.memory]) || 0;
        const cpuUtil = mappings.cpuUtilization
          ? parseFloat(row[mappings.cpuUtilization]) || 0
          : 0;
        const memoryUtil = mappings.memoryUtilization
          ? parseFloat(row[mappings.memoryUtilization]) || 0
          : 0;

        if (cpu === 0 || memory === 0) {
          result[`${provider.toUpperCase()} Recommendation`] =
            "Invalid CPU or Memory data";
          result[`${provider.toUpperCase()} Status`] = "Error - Missing Data";
          result[`${provider.toUpperCase()} Monthly Cost (USD)`] = "N/A";
          return;
        }

        // Get instance recommendation based on your existing logic
        const recommendation = getInstanceRecommendation(
          provider,
          cpu,
          memory,
          cpuUtil,
          memoryUtil,
          recommendationType
        );

        result[`${provider.toUpperCase()} Recommendation`] =
          recommendation.instanceType;
        result[`${provider.toUpperCase()} Status`] = recommendation.status;
        result[`${provider.toUpperCase()} Monthly Cost (USD)`] =
          recommendation.monthlyCost;
        result[`${provider.toUpperCase()} vCPUs`] = recommendation.vcpus;
        result[`${provider.toUpperCase()} Memory (GB)`] = recommendation.memory;
      });

      return result;
    });

    // Display results
    displayResults();

    // Show success message
    showAlert(
      `Successfully generated recommendations for ${cleanedData.length} rows across ${selectedProviders.length} cloud providers.`,
      "success"
    );
  } catch (error) {
    console.error("Error processing recommendations:", error);
    showAlert(
      "An error occurred while processing recommendations. Please check your data and try again.",
      "error"
    );
  }
}

// Enhanced alert system
function showAlert(message, type = "info") {
  // Remove existing alerts
  const existingAlerts = document.querySelectorAll(".temp-alert");
  existingAlerts.forEach((alert) => alert.remove());

  // Create new alert
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${
    type === "error" ? "danger" : type
  } temp-alert`;
  alertDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1050;
        max-width: 400px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    `;

  const icons = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  };

  alertDiv.innerHTML = `
        ${icons[type]} ${message}
        <button type="button" class="close" onclick="this.parentElement.remove()">
            <span>&times;</span>
        </button>
    `;

  document.body.appendChild(alertDiv);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (alertDiv.parentElement) {
      alertDiv.remove();
    }
  }, 5000);
}

// Reset file upload state
function resetFileUploadState() {
  // Clear global variables
  processedData = null;
  columnMappings = null;
  if (window.csvData) window.csvData = [];
  if (window.columnHeaders) window.columnHeaders = [];

  // Clear file input
  const fileInput = document.getElementById("csvFile");
  if (fileInput) fileInput.value = "";

  // Hide alerts and sections
  const hideElements = [
    "mappingAlert",
    "fileStatsSection",
    "dataPreviewSection",
  ];
  hideElements.forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.classList.add("hidden");
  });

  // Disable recommendation generation
  disableRecommendationGeneration();
}

// Enable recommendation generation
function enableRecommendationGeneration() {
  const generateBtn =
    document.querySelector('button[onclick="generateRecommendations()"]') ||
    document.querySelector("#generateBtn") ||
    document.querySelector(".generate-btn");

  if (generateBtn) {
    generateBtn.disabled = false;
    generateBtn.style.opacity = "1";
    generateBtn.title = "Generate recommendations based on uploaded data";
  }
}

// Disable recommendation generation
function disableRecommendationGeneration() {
  const generateBtn =
    document.querySelector('button[onclick="generateRecommendations()"]') ||
    document.querySelector("#generateBtn") ||
    document.querySelector(".generate-btn");

  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.style.opacity = "0.5";
    generateBtn.title = "Please upload and map data first";
  }
}

// Show error guidance
function showErrorGuidance(errorMessage) {
  const guidance = {
    "Invalid file type":
      "Please upload a CSV file. Supported formats: .csv, text/csv",
    "File size too large":
      "File size exceeds 10MB limit. Please reduce file size or split into smaller files.",
    "Empty row": "Your CSV contains empty rows. This may affect data quality.",
    "Duplicate headers":
      "Your CSV has duplicate column headers. Please ensure all headers are unique.",
    "CSV parsing failed":
      "The CSV format appears to be corrupted. Please check for special characters or formatting issues.",
  };

  let specificGuidance = "Please check your CSV file format and try again.";

  Object.keys(guidance).forEach((key) => {
    if (errorMessage.includes(key)) {
      specificGuidance = guidance[key];
    }
  });

  showAlert(`${errorMessage}. ${specificGuidance}`, "error");
}

// Enhance file upload UI
function enhanceFileUploadUI() {
  const fileInput = document.getElementById("csvFile");
  if (!fileInput) return;

  // Add file format hints
  const parent = fileInput.parentElement;
  if (parent && !parent.querySelector(".file-format-hint")) {
    const hint = document.createElement("small");
    hint.className = "file-format-hint text-muted";
    hint.innerHTML = "📁 Supported: CSV files up to 10MB | Drag & drop enabled";
    hint.style.cssText = "display: block; margin-top: 5px; font-size: 12px;";
    parent.appendChild(hint);
  }
}

// Export enhanced data with recommendations
function exportRecommendations() {
  if (!processedResults || processedResults.length === 0) {
    showAlert(
      "No recommendations to export. Please generate recommendations first.",
      "warning"
    );
    return;
  }

  try {
    const success =
      fileHandlerIntegration.exportRecommendations(processedResults);
    if (success) {
      showAlert("Recommendations exported successfully!", "success");
    }
  } catch (error) {
    console.error("Export error:", error);
    showAlert("Failed to export recommendations. Please try again.", "error");
  }
}

// Utility function to check if file handler is ready
function isFileHandlerReady() {
  return fileHandlerIntegration && processedData && processedData.length > 0;
}

// Get file handler statistics
function getFileHandlerStats() {
  if (!fileHandlerIntegration) return null;

  return fileHandlerIntegration.fileHandler.getFileStats();
}

// Initialize on page load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeFileHandler);
} else {
  initializeFileHandler();
}

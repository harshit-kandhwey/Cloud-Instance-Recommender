// Optimized File Handling System for Cloud Instance Recommender
// Enhanced performance, reduced duplication, improved maintainability

class FileHandler {
  constructor() {
    this.csvData = [];
    this.columnHeaders = [];
    this.validationErrors = [];
    this.fileMetadata = {};

    // Consolidated configuration with hardcoded mappings
    this.config = {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      allowedTypes: ["text/csv", "application/csv", "text/plain"],
      dataQualityThreshold: 0.9,
      defaultMappings: {
        cpu: "CPU Count",
        memory: "Memory (GB)",
        cpuUtilization: "CPU Utilization",
        memoryUtilization: "Memory Utilization",
        vmName: "VM Name",
        awsRegion: "AWS Region",
        azureRegion: "Azure Region",
        gcpRegion: "GCP Region",
      },
    };

    // Pre-compile regex patterns for better performance
    this.patterns = {
      numeric: /[^\d.]/g,
      csvLine: /,(?=(?:[^"]*"[^"]*")*[^"]*$)/,
      percentage: /[^\d.]/g,
    };
  }

  // Enhanced CSV parsing with streaming for large files
  async parseCSV(file) {
    const validation = this._validateFile(file);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const result = this._processCSVText(e.target.result);
          this._updateMetadata(file, result);

          resolve({
            success: true,
            data: this.csvData,
            headers: this.columnHeaders,
            metadata: this.fileMetadata,
            errors: this.validationErrors,
          });
        } catch (error) {
          reject(new Error(`CSV parsing failed: ${error.message}`));
        }
      };

      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  // Optimized file validation
  _validateFile(file) {
    const checks = [
      {
        condition: !file,
        error: "No file provided",
      },
      {
        condition: !this._isValidFileType(file),
        error: "Invalid file type. Please upload a CSV file.",
      },
      {
        condition: file.size > this.config.maxFileSize,
        error: "File size too large. Maximum allowed size is 10MB.",
      },
      {
        condition: file.size === 0,
        error: "File is empty. Please upload a valid CSV file.",
      },
    ];

    const failedCheck = checks.find((check) => check.condition);
    return failedCheck
      ? { isValid: false, error: failedCheck.error }
      : { isValid: true };
  }

  _isValidFileType(file) {
    const extension = file.name.toLowerCase().split(".").pop();
    return this.config.allowedTypes.includes(file.type) || extension === "csv";
  }

  // Optimized CSV text processing
  _processCSVText(csvText) {
    const lines = csvText
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim());

    if (lines.length < 2) {
      throw new Error(
        "CSV must contain at least a header row and one data row"
      );
    }

    const headers = this._parseCSVLine(lines[0]);
    const headerValidation = this._validateHeaders(headers);
    const errors = [...headerValidation.errors];

    const data = this._parseDataRows(lines.slice(1), headers, errors);

    return { headers, data, errors };
  }

  // Enhanced CSV line parsing with better quote handling
  _parseCSVLine(line) {
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

  // Optimized data row parsing
  _parseDataRows(dataLines, headers, errors) {
    return dataLines.map((line, index) => {
      try {
        const values = this._parseCSVLine(line);
        const row = this._createRowObject(headers, values);

        const rowValidation = this._validateRow(row, index + 2);
        errors.push(...rowValidation.errors);

        return row;
      } catch (error) {
        errors.push(`Row ${index + 2}: ${error.message}`);
        return this._createEmptyRowObject(headers);
      }
    });
  }

  _createRowObject(headers, values) {
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  }

  _createEmptyRowObject(headers) {
    return headers.reduce((row, header) => {
      row[header] = "";
      return row;
    }, {});
  }

  // Consolidated validation methods
  _validateHeaders(headers) {
    const errors = [];
    const seen = new Set();

    headers.forEach((header, index) => {
      if (!header || !header.trim()) {
        errors.push(`Empty header at column ${index + 1}`);
      }

      const normalized = header.toLowerCase().trim();
      if (seen.has(normalized)) {
        errors.push(`Duplicate header: ${header}`);
      } else {
        seen.add(normalized);
      }
    });

    return { errors };
  }

  _validateRow(row, rowNumber) {
    const errors = [];
    const hasData = Object.values(row).some((value) => value && value.trim());

    if (!hasData) {
      errors.push(`Row ${rowNumber}: Empty row`);
    }

    return { errors };
  }

  // Optimized data validation with batch processing
  validateRequiredData() {
    const issues = [];
    const mappings = this.config.defaultMappings;

    // Check required columns existence
    const missingColumns = ["cpu", "memory"].filter(
      (key) => !this.columnHeaders.includes(mappings[key])
    );

    missingColumns.forEach((key) => {
      issues.push(
        `Required ${key.toUpperCase()} column '${
          mappings[key]
        }' not found in CSV`
      );
    });

    // Validate numeric columns in batch
    ["cpu", "memory"].forEach((key) => {
      if (this.columnHeaders.includes(mappings[key])) {
        issues.push(
          ...this._validateNumericColumn(mappings[key], key.toUpperCase())
        );
      }
    });

    return issues;
  }

  _validateNumericColumn(columnName, fieldName) {
    const issues = [];
    let validCount = 0;

    this.csvData.forEach((row, index) => {
      const value = row[columnName];

      if (!value || !value.toString().trim()) {
        issues.push(`${fieldName} missing in row ${index + 1}`);
      } else {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue <= 0) {
          issues.push(
            `Invalid ${fieldName} value in row ${index + 1}: "${value}"`
          );
        } else {
          validCount++;
        }
      }
    });

    // Check data quality threshold
    const qualityRatio = validCount / this.csvData.length;
    if (qualityRatio < this.config.dataQualityThreshold) {
      issues.unshift(
        `Warning: ${fieldName} column has ${
          this.csvData.length - validCount
        } invalid entries out of ${this.csvData.length} total rows`
      );
    }

    return issues;
  }

  // Optimized data cleaning with parallel processing simulation
  cleanData() {
    const mappings = this.config.defaultMappings;

    return this.csvData.map((row) => {
      const cleanedRow = { ...row };

      // Batch clean numeric fields
      ["cpu", "memory"].forEach((field) => {
        if (mappings[field] && row[mappings[field]]) {
          cleanedRow[mappings[field]] = this._cleanNumericValue(
            row[mappings[field]]
          );
        }
      });

      // Batch clean utilization fields
      ["cpuUtilization", "memoryUtilization"].forEach((field) => {
        if (mappings[field] && row[mappings[field]]) {
          cleanedRow[mappings[field]] = this._cleanPercentageValue(
            row[mappings[field]]
          );
        }
      });

      return cleanedRow;
    });
  }

  _cleanNumericValue(value) {
    if (!value || typeof value !== "string") return value;

    const cleaned = value.replace(this.patterns.numeric, "");
    const numValue = parseFloat(cleaned);

    return isNaN(numValue) ? value : numValue.toString();
  }

  _cleanPercentageValue(value) {
    if (!value || typeof value !== "string") return value;

    const cleaned = value.replace(this.patterns.percentage, "");
    const numValue = parseFloat(cleaned);

    if (isNaN(numValue)) return value;
    return numValue > 100 ? value : numValue.toString();
  }

  // Optimized metadata management
  _updateMetadata(file, result) {
    this.csvData = result.data;
    this.columnHeaders = result.headers;
    this.validationErrors = result.errors;
    this.fileMetadata = {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      rowCount: result.data.length,
      columnCount: result.headers.length,
    };
  }

  // Enhanced export with better error handling
  exportToCSV(data, filename = "processed_data.csv") {
    if (!data?.length) {
      throw new Error("No data to export");
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((header) => this._escapeCSVValue(row[header] || ""))
          .join(",")
      ),
    ].join("\n");

    return this._downloadCSV(csvContent, filename);
  }

  _escapeCSVValue(value) {
    const strValue = value.toString();
    return strValue.includes(",") ||
      strValue.includes('"') ||
      strValue.includes("\n")
      ? `"${strValue.replace(/"/g, '""')}"`
      : strValue;
  }

  _downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    Object.assign(link, {
      href: url,
      download: filename,
      style: { display: "none" },
    });

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return true;
  }

  // Consolidated getters
  getColumnMappings() {
    return { ...this.config.defaultMappings };
  }

  getFileStats() {
    return {
      ...this.fileMetadata,
      validationErrors: this.validationErrors.length,
      hasRequiredColumns: ["cpu", "memory"].every((key) =>
        this.columnHeaders.includes(this.config.defaultMappings[key])
      ),
      dataQuality: this._calculateDataQuality(),
    };
  }

  _calculateDataQuality() {
    if (!this.csvData.length) return 0;

    let score = 100;
    const mappings = this.config.defaultMappings;

    // Deduct for missing required columns
    if (!this.columnHeaders.includes(mappings.cpu)) score -= 30;
    if (!this.columnHeaders.includes(mappings.memory)) score -= 30;

    // Deduct for validation errors
    const errorRatio = this.validationErrors.length / this.csvData.length;
    score -= Math.min(errorRatio * 40, 40);

    return Math.max(0, Math.round(score));
  }

  reset() {
    Object.assign(this, {
      csvData: [],
      columnHeaders: [],
      validationErrors: [],
      fileMetadata: {},
    });
  }
}

// Enhanced Integration Class with optimized UI management
class FileHandlerIntegration {
  constructor() {
    this.fileHandler = new FileHandler();
    this.callbacks = {
      onFileProcessed: null,
      onError: null,
    };
    this.uiElements = new Map();
    this.state = {
      isProcessing: false,
      hasValidData: false,
    };
  }

  // Initialize with enhanced error handling
  initializeFileUpload(fileInputId, statusElementId) {
    const fileInput = this._getElement(fileInputId);
    if (!fileInput) return false;

    this.uiElements.set("fileInput", fileInput);
    this.uiElements.set("statusElement", this._getElement(statusElementId));

    fileInput.addEventListener("change", this._handleFileChange.bind(this));
    this._setupDragAndDrop(fileInput);

    return true;
  }

  async _handleFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    this.state.isProcessing = true;
    this._showStatus("Processing file...", "info");

    try {
      const result = await this.fileHandler.parseCSV(file);
      await this._processSuccessfulUpload(result);
    } catch (error) {
      this._processFailedUpload(error);
    } finally {
      this.state.isProcessing = false;
    }
  }

  async _processSuccessfulUpload(result) {
    const validationIssues = this.fileHandler.validateRequiredData();

    const statusType = validationIssues.length > 0 ? "warning" : "success";
    const message = this._createStatusMessage(result, validationIssues);

    this._showStatus(message, statusType);
    this.state.hasValidData = true;

    // Execute callback with hardcoded mappings
    const mappings = this.fileHandler.getColumnMappings();
    this.callbacks.onFileProcessed?.(result, mappings, validationIssues);
  }

  _processFailedUpload(error) {
    this._showStatus(`Error: ${error.message}`, "error");
    this.state.hasValidData = false;
    this.callbacks.onError?.(error);
  }

  _createStatusMessage(result, issues) {
    const baseMessage = `File processed successfully: ${result.metadata.rowCount} rows, ${result.metadata.columnCount} columns`;

    if (issues.length === 0) return `✅ ${baseMessage}`;

    const criticalIssues = issues.filter(
      (issue) => issue.includes("not found") || issue.includes("missing")
    );

    const warningText =
      criticalIssues.length > 0
        ? `Critical issues: ${criticalIssues.slice(0, 2).join(", ")}`
        : `${issues.length} data quality issues detected`;

    return `⚠️ ${baseMessage}. ${warningText}`;
  }

  // Enhanced drag and drop with better visual feedback
  _setupDragAndDrop(fileInput) {
    const dropZone = fileInput.closest("label") || fileInput.parentElement;
    if (!dropZone) return;

    const events = ["dragenter", "dragover", "dragleave", "drop"];
    events.forEach((event) => {
      dropZone.addEventListener(event, this._preventDefaults);
      document.body.addEventListener(event, this._preventDefaults);
    });

    ["dragenter", "dragover"].forEach((event) =>
      dropZone.addEventListener(event, () => this._highlightDropZone(dropZone))
    );

    ["dragleave", "drop"].forEach((event) =>
      dropZone.addEventListener(event, () =>
        this._unhighlightDropZone(dropZone)
      )
    );

    dropZone.addEventListener("drop", (e) => this._handleDrop(e, fileInput));
  }

  _preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  _highlightDropZone(element) {
    Object.assign(element.style, {
      backgroundColor: "#e8ebff",
      borderColor: "#4c63d2",
      transform: "scale(1.02)",
      transition: "all 0.2s ease",
    });
  }

  _unhighlightDropZone(element) {
    Object.assign(element.style, {
      backgroundColor: "",
      borderColor: "",
      transform: "",
    });
  }

  _handleDrop(e, fileInput) {
    const files = e.dataTransfer.files;
    if (!files.length) return;

    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".csv")) {
      this._showStatus("Please drop a CSV file.", "error");
      return;
    }

    // Update file input
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Optimized status display
  _showStatus(message, type) {
    const statusElement = this.uiElements.get("statusElement");
    if (!statusElement) return;

    const config = {
      info: { class: "alert alert-info", icon: "📄" },
      success: { class: "alert alert-success", icon: "✅" },
      warning: { class: "alert alert-warning", icon: "⚠️" },
      error: { class: "alert alert-danger", icon: "❌" },
    };

    const { class: alertClass, icon } = config[type] || config.info;

    statusElement.className = alertClass;
    statusElement.innerHTML = `${icon} ${message}`;
    statusElement.classList.remove("hidden");
  }

  _getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      console.error(`Element with id '${id}' not found`);
    }
    return element;
  }

  // Public API methods
  getData() {
    return this.fileHandler.csvData;
  }
  getHeaders() {
    return this.fileHandler.columnHeaders;
  }
  getMappings() {
    return this.fileHandler.getColumnMappings();
  }
  getFileStats() {
    return this.fileHandler.getFileStats();
  }
  getDataQuality() {
    return this.fileHandler._calculateDataQuality();
  }
  getCleanedData() {
    return this.fileHandler.cleanData();
  }
  validateRequiredData() {
    return this.fileHandler.validateRequiredData();
  }
  isReady() {
    return this.state.hasValidData && !this.state.isProcessing;
  }

  exportRecommendations(recommendations) {
    return this.fileHandler.exportToCSV(
      recommendations,
      "instance_recommendations.csv"
    );
  }

  // Enhanced callback system
  on(event, callback) {
    if (
      this.callbacks.hasOwnProperty(
        `on${event.charAt(0).toUpperCase()}${event.slice(1)}`
      )
    ) {
      this.callbacks[`on${event.charAt(0).toUpperCase()}${event.slice(1)}`] =
        callback;
    }
  }
}

// Optimized Integration Manager
class IntegrationManager {
  constructor() {
    this.fileHandler = null;
    this.processedData = null;
    this.columnMappings = null;
    this.uiManager = new UIManager();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    this.fileHandler = new FileHandlerIntegration();
    this._setupEventHandlers();
    this._enhanceUI();

    this.initialized = true;
  }

  _setupEventHandlers() {
    this.fileHandler.on("fileProcessed", this._handleFileProcessed.bind(this));
    this.fileHandler.on("error", this._handleFileError.bind(this));

    if (!this.fileHandler.initializeFileUpload("csvFile", "fileStatus")) {
      console.warn("File upload initialization failed");
    }
  }

  _handleFileProcessed(result, mappings, validationIssues) {
    this.processedData = result.data;
    // Use hardcoded mappings directly
    this.columnMappings = mappings;

    // Update global variables for backward compatibility
    if (window.csvData !== undefined) window.csvData = result.data;
    if (window.columnHeaders !== undefined)
      window.columnHeaders = result.headers;

    this.uiManager.showProcessingResults(
      validationIssues,
      this.fileHandler.getDataQuality()
    );
    this.uiManager.updateFileStatistics(result.metadata);
    this.uiManager.showDataPreview(result.data.slice(0, 5));
    this.uiManager.enableRecommendationGeneration();
  }

  _handleFileError(error) {
    console.error("File processing error:", error);
    this.uiManager.resetState();
    this.uiManager.showErrorGuidance(error.message);
  }

  _enhanceUI() {
    this.uiManager.enhanceFileUploadUI();
  }

  // Public API
  validateDataForRecommendations() {
    if (!this.processedData?.length) {
      return {
        isValid: false,
        error: "No data loaded. Please upload a CSV file first.",
      };
    }

    if (!this.columnMappings.cpu || !this.columnMappings.memory) {
      return {
        isValid: false,
        error:
          "Required columns (CPU Count, Memory (GB)) not found in CSV. Please check your column headers.",
      };
    }

    return { isValid: true };
  }

  getCleanedData() {
    return this.fileHandler.getCleanedData();
  }

  exportRecommendations(recommendations) {
    return this.fileHandler.exportRecommendations(recommendations);
  }

  isReady() {
    return this.fileHandler?.isReady() && this.processedData?.length > 0;
  }
}

// Optimized UI Manager
class UIManager {
  constructor() {
    this.alertTimeout = null;
  }

  showProcessingResults(validationIssues, dataQuality) {
    const { message, alertType } = this._createProcessingMessage(
      validationIssues,
      dataQuality
    );

    // Show in file status area instead of mapping alert
    const fileStatus = document.getElementById("fileStatus");
    if (fileStatus) {
      fileStatus.className = `alert ${alertType}`;
      fileStatus.innerHTML = message;
      fileStatus.classList.remove("hidden");
    }
  }

  _createProcessingMessage(issues, quality) {
    let message = "✅ File processed successfully. ";
    let alertType = "alert-success";

    if (issues.length > 0) {
      const criticalIssues = issues.filter(
        (issue) => issue.includes("not found") || issue.includes("missing")
      );

      if (criticalIssues.length > 0) {
        message += `⚠️ Critical issues found: ${criticalIssues
          .slice(0, 2)
          .join(", ")}`;
        alertType = "alert-warning";
      } else {
        message += `ℹ️ ${issues.length} data quality issues detected.`;
      }
    }

    message += ` Data Quality Score: ${quality}%`;
    return { message, alertType };
  }

  updateFileStatistics(metadata) {
    const stats = {
      fileName: metadata.name,
      fileSize: `${(metadata.size / 1024).toFixed(1)} KB`,
      rowCount: metadata.rowCount,
      columnCount: metadata.columnCount,
      lastModified: new Date(metadata.lastModified).toLocaleString(),
    };

    this._updateFileStatus(stats);
    this._createOrUpdateStatsSection(stats);
  }

  _updateFileStatus(stats) {
    const fileStatus = document.getElementById("fileStatus");
    if (!fileStatus) return;

    const statsText = `<br><small><strong>File:</strong> ${stats.fileName} | <strong>Size:</strong> ${stats.fileSize} | <strong>Rows:</strong> ${stats.rowCount} | <strong>Columns:</strong> ${stats.columnCount}</small>`;
    fileStatus.innerHTML += statsText;
  }

  _createOrUpdateStatsSection(stats) {
    let statsSection = document.getElementById("fileStatsSection");

    if (!statsSection) {
      statsSection = this._createStatsSection();
    }

    statsSection.innerHTML = this._generateStatsHTML(stats);
    statsSection.classList.remove("hidden");
  }

  _createStatsSection() {
    const fileUploadSection = document.querySelector(".section:nth-child(2)");
    if (!fileUploadSection) return null;

    const statsSection = document.createElement("div");
    Object.assign(statsSection, {
      id: "fileStatsSection",
      className: "stats-info",
    });

    const sectionContent = fileUploadSection.querySelector(".section-content");
    if (sectionContent) {
      sectionContent.appendChild(statsSection);
    }

    return statsSection;
  }

  _generateStatsHTML(stats) {
    return `
      <h6 style="margin: 15px 0 10px 0; color: #495057;">📊 File Statistics</h6>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        ${Object.entries(stats)
          .map(
            ([key, value]) =>
              `<div><strong>${this._formatStatLabel(
                key
              )}:</strong> ${value}</div>`
          )
          .join("")}
      </div>
    `;
  }

  _formatStatLabel(key) {
    const labels = {
      fileName: "File Name",
      fileSize: "File Size",
      rowCount: "Total Rows",
      columnCount: "Total Columns",
      lastModified: "Last Modified",
    };
    return labels[key] || key;
  }

  showDataPreview(previewData) {
    if (!previewData.length) return;

    let previewSection = document.getElementById("dataPreviewSection");
    if (!previewSection) {
      previewSection = this._createPreviewSection();
    }

    previewSection.innerHTML = this._generatePreviewHTML(previewData);
    previewSection.classList.remove("hidden");
  }

  _createPreviewSection() {
    const fileUploadSection = document.querySelector(".section:nth-child(2)");
    if (!fileUploadSection) return null;

    const previewSection = document.createElement("div");
    Object.assign(previewSection, {
      id: "dataPreviewSection",
      className: "data-preview-section",
    });

    previewSection.style.cssText = `
      margin: 20px 0 0 0; padding: 15px; background: #f8f9fa; 
      border-radius: 8px; border-left: 4px solid #28a745;
    `;

    const sectionContent = fileUploadSection.querySelector(".section-content");
    if (sectionContent) {
      sectionContent.appendChild(previewSection);
    }

    return previewSection;
  }

  _generatePreviewHTML(previewData) {
    const headers = Object.keys(previewData[0]);

    const headerHTML = headers
      .map(
        (header) =>
          `<th style="padding: 8px; border: 1px solid #dee2e6; text-align: left; background-color: #f8f9fa;">${header}</th>`
      )
      .join("");

    const rowsHTML = previewData
      .map((row, index) => {
        const cellsHTML = Object.values(row)
          .map((value) => {
            const displayValue =
              value && value.toString().length > 20
                ? value.toString().substring(0, 20) + "..."
                : value || "";
            return `<td style="padding: 8px; border: 1px solid #dee2e6;">${displayValue}</td>`;
          })
          .join("");

        const bgColor = index % 2 === 0 ? "#ffffff" : "#f8f9fa";
        return `<tr style="background-color: ${bgColor};">${cellsHTML}</tr>`;
      })
      .join("");

    return `
      <h6 style="margin: 0 0 10px 0; color: #495057;">👁️ Data Preview (First 5 rows)</h6>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead><tr>${headerHTML}</tr></thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>
    `;
  }

  showAlert(message, type = "info", duration = 5000) {
    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
    }

    // Remove existing alerts
    document.querySelectorAll(".temp-alert").forEach((alert) => alert.remove());

    const alertDiv = this._createAlertElement(message, type);
    document.body.appendChild(alertDiv);

    this.alertTimeout = setTimeout(() => {
      if (alertDiv.parentElement) alertDiv.remove();
    }, duration);
  }

  _createAlertElement(message, type) {
    const alertDiv = document.createElement("div");
    const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
    const alertType = type === "error" ? "danger" : type;

    alertDiv.className = `alert alert-${alertType} temp-alert`;
    alertDiv.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 1050; 
      max-width: 400px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    `;

    alertDiv.innerHTML = `
      ${icons[type]} ${message}
      <button type="button" class="close" onclick="this.parentElement.remove()">
        <span>&times;</span>
      </button>
    `;

    return alertDiv;
  }

  showErrorGuidance(errorMessage) {
    const guidance = {
      "Invalid file type":
        "Please upload a CSV file. Supported formats: .csv, text/csv",
      "File size too large":
        "File size exceeds 10MB limit. Please reduce file size or split into smaller files.",
      "Empty row":
        "Your CSV contains empty rows. This may affect data quality.",
      "Duplicate headers":
        "Your CSV has duplicate column headers. Please ensure all headers are unique.",
      "CSV parsing failed":
        "The CSV format appears to be corrupted. Please check for special characters or formatting issues.",
    };

    const specificGuidance = Object.keys(guidance).find((key) =>
      errorMessage.includes(key)
    );
    const guideText = specificGuidance
      ? guidance[specificGuidance]
      : "Please check your CSV file format and try again.";

    this.showAlert(`${errorMessage}. ${guideText}`, "error");
  }

  enhanceFileUploadUI() {
    const fileInput = document.getElementById("csvFile");
    if (!fileInput) return;

    const parent = fileInput.parentElement;
    if (parent && !parent.querySelector(".file-format-hint")) {
      const hint = document.createElement("small");
      hint.className = "file-format-hint text-muted";
      hint.innerHTML =
        "📁 Supported: CSV files up to 10MB | Drag & drop enabled";
      hint.style.cssText = "display: block; margin-top: 5px; font-size: 12px;";
      parent.appendChild(hint);
    }
  }

  enableRecommendationGeneration() {
    this._toggleRecommendationButton(
      false,
      "Generate recommendations based on uploaded data"
    );
  }

  disableRecommendationGeneration() {
    this._toggleRecommendationButton(true, "Please upload and map data first");
  }

  _toggleRecommendationButton(disabled, title) {
    const generateBtn =
      document.querySelector('button[onclick="generateRecommendations()"]') ||
      document.querySelector("#generateBtn") ||
      document.querySelector(".generate-btn");

    if (generateBtn) {
      generateBtn.disabled = disabled;
      generateBtn.style.opacity = disabled ? "0.5" : "1";
      generateBtn.title = title;
    }
  }

  resetState() {
    // Clear sections
    ["fileStatsSection", "dataPreviewSection"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.classList.add("hidden");
    });

    // Clear file input
    const fileInput = document.getElementById("csvFile");
    if (fileInput) fileInput.value = "";

    this.disableRecommendationGeneration();
  }
}

// Global Integration Manager Instance
let integrationManager = null;

// Enhanced initialization with better error handling
async function initializeFileHandler() {
  try {
    integrationManager = new IntegrationManager();
    await integrationManager.initialize();
    console.log("File handler initialized successfully");
  } catch (error) {
    console.error("Failed to initialize file handler:", error);
    showFallbackError();
  }
}

function showFallbackError() {
  const fileStatus = document.getElementById("fileStatus");
  if (fileStatus) {
    fileStatus.innerHTML =
      "❌ Failed to initialize file handler. Please refresh the page.";
    fileStatus.className = "alert alert-danger";
    fileStatus.classList.remove("hidden");
  }
}

// Enhanced API Functions for backward compatibility
function generateRecommendations() {
  if (!integrationManager?.isReady()) {
    integrationManager?.uiManager.showAlert(
      "Please upload and validate data first.",
      "warning"
    );
    return;
  }

  const validation = integrationManager.validateDataForRecommendations();
  if (!validation.isValid) {
    integrationManager.uiManager.showAlert(validation.error, "error");
    return;
  }

  // Validate cloud provider selection
  if (!window.selectedProviders?.length) {
    integrationManager.uiManager.showAlert(
      "Please select at least one cloud provider.",
      "warning"
    );
    return;
  }

  // Validate recommendation type
  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked'
  );
  if (!recommendationType) {
    integrationManager.uiManager.showAlert(
      "Please select a recommendation type.",
      "warning"
    );
    return;
  }

  // Process recommendations
  try {
    const cleanedData = integrationManager.getCleanedData();
    showProcessingStatus(cleanedData.length, window.selectedProviders.length);

    setTimeout(() => {
      processRecommendationsWithCleanData(
        cleanedData,
        integrationManager.columnMappings
      );
    }, 1000);
  } catch (error) {
    console.error("Error generating recommendations:", error);
    integrationManager.uiManager.showAlert(
      "Failed to generate recommendations. Please try again.",
      "error"
    );
  }
}

function exportRecommendations() {
  if (!window.processedResults?.length) {
    integrationManager?.uiManager.showAlert(
      "No recommendations to export. Please generate recommendations first.",
      "warning"
    );
    return;
  }

  try {
    const success = integrationManager.exportRecommendations(
      window.processedResults
    );
    if (success) {
      integrationManager.uiManager.showAlert(
        "Recommendations exported successfully!",
        "success"
      );
    }
  } catch (error) {
    console.error("Export error:", error);
    integrationManager.uiManager.showAlert(
      "Failed to export recommendations. Please try again.",
      "error"
    );
  }
}

function showProcessingStatus(totalRows, totalProviders) {
  const processingStatus = document.getElementById("processingStatus");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");

  if (!processingStatus) return;

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
      setTimeout(() => processingStatus.classList.add("hidden"), 1000);
    }
  }, estimatedTime / 20);
}

function processRecommendationsWithCleanData(cleanedData, mappings) {
  try {
    const recommendationType = document.querySelector(
      'input[name="recommendationType"]:checked'
    ).value;

    window.processedResults = cleanedData.map((row, index) => {
      const result = { ...row };

      // Add row identifier
      if (mappings.vmName && row[mappings.vmName]) {
        result["VM/Server Name"] = row[mappings.vmName];
      } else {
        result["Row Number"] = index + 1;
      }

      window.selectedProviders.forEach((provider) => {
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

        // Get instance recommendation
        const recommendation = window.getInstanceRecommendation(
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

    // Show download section
    const downloadSection = document.getElementById("downloadSection");
    if (downloadSection) {
      downloadSection.classList.remove("hidden");
    }

    // Update usage statistics
    if (window.updateUsageStatistics) {
      window.updateUsageStatistics(cleanedData.length);
    }

    integrationManager.uiManager.showAlert(
      `Successfully generated recommendations for ${cleanedData.length} rows across ${window.selectedProviders.length} cloud providers.`,
      "success"
    );
  } catch (error) {
    console.error("Error processing recommendations:", error);
    integrationManager.uiManager.showAlert(
      "An error occurred while processing recommendations. Please check your data and try again.",
      "error"
    );
  }
}

// Utility functions
function isFileHandlerReady() {
  return integrationManager?.isReady() || false;
}

function getFileHandlerStats() {
  return integrationManager?.fileHandler.getFileStats() || null;
}

// Auto-initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeFileHandler);
} else {
  initializeFileHandler();
}

// Export for module systems
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FileHandler,
    FileHandlerIntegration,
    IntegrationManager,
    UIManager,
  };
} else {
  // Browser environment - make functions available globally
  window.FileHandler = FileHandler;
  window.FileHandlerIntegration = FileHandlerIntegration;
  window.IntegrationManager = IntegrationManager;
  window.UIManager = UIManager;
  window.generateRecommendations = generateRecommendations;
  window.exportRecommendations = exportRecommendations;
  window.showProcessingStatus = showProcessingStatus;
  window.processRecommendationsWithCleanData =
    processRecommendationsWithCleanData;
  window.isFileHandlerReady = isFileHandlerReady;
  window.getFileHandlerStats = getFileHandlerStats;
}

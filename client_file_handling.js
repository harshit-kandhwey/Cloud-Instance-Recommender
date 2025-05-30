// File Handling System for AWS Instance Recommender
// All operations are client-side only with hardcoded column mappings

class FileHandler {
  constructor() {
    this.csvData = [];
    this.columnHeaders = [];
    this.validationErrors = [];
    this.fileMetadata = {};

    // Hardcoded default column mappings
    this.defaultMappings = {
      cpu: "CPU Count",
      memory: "Memory (GB)",
      cpuUtilization: "CPU_Utilization",
      memoryUtilization: "Memory_Utilization",
      vmName: "VM_Name",
      awsRegion: "AWS_Region",
      azureRegion: "Azure_Region",
      gcpRegion: "GCP_Region",
    };
  }

  // Enhanced CSV parsing with robust error handling
  async parseCSV(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("No file provided"));
        return;
      }

      // File validation
      const validationResult = this.validateFile(file);
      if (!validationResult.isValid) {
        reject(new Error(validationResult.error));
        return;
      }

      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const csvText = e.target.result;
          const parsedData = this.processCSVText(csvText);

          this.csvData = parsedData.data;
          this.columnHeaders = parsedData.headers;
          this.validationErrors = parsedData.errors;
          this.fileMetadata = {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            rowCount: this.csvData.length,
            columnCount: this.columnHeaders.length,
          };

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

      reader.onerror = () => {
        reject(new Error("Failed to read file"));
      };

      reader.readAsText(file);
    });
  }

  // File validation before processing
  validateFile(file) {
    // Check file type
    const allowedTypes = ["text/csv", "application/csv", "text/plain"];
    const fileExtension = file.name.toLowerCase().split(".").pop();

    if (!allowedTypes.includes(file.type) && fileExtension !== "csv") {
      return {
        isValid: false,
        error: "Invalid file type. Please upload a CSV file.",
      };
    }

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return {
        isValid: false,
        error: "File size too large. Maximum allowed size is 10MB.",
      };
    }

    // Check if file is empty
    if (file.size === 0) {
      return {
        isValid: false,
        error: "File is empty. Please upload a valid CSV file.",
      };
    }

    return { isValid: true };
  }

  // Process CSV text with advanced parsing
  processCSVText(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    const errors = [];

    if (lines.length < 2) {
      throw new Error(
        "CSV must contain at least a header row and one data row"
      );
    }

    // Parse headers
    const headers = this.parseCSVLine(lines[0]);

    // Validate headers
    const headerValidation = this.validateHeaders(headers);
    if (headerValidation.errors.length > 0) {
      errors.push(...headerValidation.errors);
    }

    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue; // Skip empty lines

      try {
        const values = this.parseCSVLine(line);
        const row = {};

        // Map values to headers
        headers.forEach((header, index) => {
          row[header] = values[index] || "";
        });

        // Validate row data
        const rowValidation = this.validateRow(row, i + 1);
        if (rowValidation.errors.length > 0) {
          errors.push(...rowValidation.errors);
        }

        data.push(row);
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    return {
      headers: headers,
      data: data,
      errors: errors,
    };
  }

  // Advanced CSV line parsing (handles quotes, commas, etc.)
  parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === "," && !inQuotes) {
        // Field separator
        result.push(current.trim());
        current = "";
        i++;
      } else {
        current += char;
        i++;
      }
    }

    // Add the last field
    result.push(current.trim());
    return result;
  }

  // Header validation
  validateHeaders(headers) {
    const errors = [];
    const duplicates = [];
    const seen = new Set();

    headers.forEach((header, index) => {
      // Check for empty headers
      if (!header || header.trim() === "") {
        errors.push(`Empty header at column ${index + 1}`);
      }

      // Check for duplicates
      const normalizedHeader = header.toLowerCase().trim();
      if (seen.has(normalizedHeader)) {
        duplicates.push(header);
      } else {
        seen.add(normalizedHeader);
      }
    });

    if (duplicates.length > 0) {
      errors.push(`Duplicate headers found: ${duplicates.join(", ")}`);
    }

    return { errors };
  }

  // Row data validation
  validateRow(row, rowNumber) {
    const errors = [];

    // Check for completely empty rows
    const hasData = Object.values(row).some(
      (value) => value && value.trim() !== ""
    );
    if (!hasData) {
      errors.push(`Row ${rowNumber}: Empty row`);
    }

    return { errors };
  }

  // Get hardcoded column mappings
  getColumnMappings() {
    return { ...this.defaultMappings };
  }

  // Data validation for specific requirements using hardcoded mappings
  validateRequiredData() {
    const issues = [];
    const mappings = this.defaultMappings;

    // Check if required columns exist in the CSV
    if (!this.columnHeaders.includes(mappings.cpu)) {
      issues.push(`Required CPU column '${mappings.cpu}' not found in CSV`);
    }

    if (!this.columnHeaders.includes(mappings.memory)) {
      issues.push(
        `Required Memory column '${mappings.memory}' not found in CSV`
      );
    }

    // Check if mapped columns have valid data
    if (this.columnHeaders.includes(mappings.cpu)) {
      const cpuIssues = this.validateNumericColumn(mappings.cpu, "CPU");
      issues.push(...cpuIssues);
    }

    if (this.columnHeaders.includes(mappings.memory)) {
      const memoryIssues = this.validateNumericColumn(
        mappings.memory,
        "Memory"
      );
      issues.push(...memoryIssues);
    }

    return issues;
  }

  // Validate numeric columns
  validateNumericColumn(columnName, fieldName) {
    const issues = [];
    let validCount = 0;
    let totalCount = 0;

    this.csvData.forEach((row, index) => {
      const value = row[columnName];
      totalCount++;

      if (!value || value.trim() === "") {
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

    // If more than 10% of data is invalid, flag as major issue
    if (validCount / totalCount < 0.9) {
      issues.unshift(
        `Warning: ${fieldName} column has ${
          totalCount - validCount
        } invalid entries out of ${totalCount} total rows`
      );
    }

    return issues;
  }

  // Data cleaning and normalization using hardcoded mappings
  cleanData() {
    const mappings = this.defaultMappings;
    const cleanedData = this.csvData.map((row, index) => {
      const cleanedRow = { ...row };

      // Clean CPU data
      if (mappings.cpu && row[mappings.cpu]) {
        cleanedRow[mappings.cpu] = this.cleanNumericValue(row[mappings.cpu]);
      }

      // Clean Memory data
      if (mappings.memory && row[mappings.memory]) {
        cleanedRow[mappings.memory] = this.cleanNumericValue(
          row[mappings.memory]
        );
      }

      // Clean utilization data
      if (mappings.cpuUtilization && row[mappings.cpuUtilization]) {
        cleanedRow[mappings.cpuUtilization] = this.cleanPercentageValue(
          row[mappings.cpuUtilization]
        );
      }

      if (mappings.memoryUtilization && row[mappings.memoryUtilization]) {
        cleanedRow[mappings.memoryUtilization] = this.cleanPercentageValue(
          row[mappings.memoryUtilization]
        );
      }

      return cleanedRow;
    });

    return cleanedData;
  }

  // Clean numeric values
  cleanNumericValue(value) {
    if (!value || typeof value !== "string") return value;

    // Remove common non-numeric characters but keep decimal points
    const cleaned = value.replace(/[^\d.]/g, "");
    const numValue = parseFloat(cleaned);

    return isNaN(numValue) ? value : numValue.toString();
  }

  // Clean percentage values
  cleanPercentageValue(value) {
    if (!value || typeof value !== "string") return value;

    // Remove % sign and other non-numeric characters
    const cleaned = value.replace(/[^\d.]/g, "");
    const numValue = parseFloat(cleaned);

    if (isNaN(numValue)) return value;

    // If value is greater than 100, assume it's not a percentage
    return numValue > 100 ? value : numValue.toString();
  }

  // Export processed data
  exportToCSV(data, filename = "processed_data.csv") {
    if (!data || data.length === 0) {
      throw new Error("No data to export");
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((header) => {
            const value = row[header] || "";
            // Escape values containing commas or quotes
            if (
              typeof value === "string" &&
              (value.includes(",") || value.includes('"'))
            ) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(",")
      ),
    ].join("\n");

    return this.downloadCSV(csvContent, filename);
  }

  // Download CSV file
  downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(url);
    return true;
  }

  // Get file statistics
  getFileStats() {
    const mappings = this.defaultMappings;
    return {
      ...this.fileMetadata,
      validationErrors: this.validationErrors.length,
      hasRequiredColumns:
        this.columnHeaders.includes(mappings.cpu) &&
        this.columnHeaders.includes(mappings.memory),
      dataQuality: this.calculateDataQuality(),
    };
  }

  // Calculate data quality score
  calculateDataQuality() {
    if (this.csvData.length === 0) return 0;

    let score = 100;
    const mappings = this.defaultMappings;

    // Deduct points for missing required columns
    if (!this.columnHeaders.includes(mappings.cpu)) score -= 30;
    if (!this.columnHeaders.includes(mappings.memory)) score -= 30;

    // Deduct points for validation errors
    const errorRatio = this.validationErrors.length / this.csvData.length;
    score -= Math.min(errorRatio * 40, 40);

    return Math.max(0, Math.round(score));
  }

  // Clear all data
  reset() {
    this.csvData = [];
    this.columnHeaders = [];
    this.validationErrors = [];
    this.fileMetadata = {};
  }
}

// Usage example and integration helper
class FileHandlerIntegration {
  constructor() {
    this.fileHandler = new FileHandler();
    this.onFileProcessed = null;
    this.onError = null;
  }

  // Initialize file upload handling
  initializeFileUpload(fileInputId, statusElementId) {
    const fileInput = document.getElementById(fileInputId);
    const statusElement = document.getElementById(statusElementId);

    if (!fileInput) {
      console.error(`File input element with id '${fileInputId}' not found`);
      return;
    }

    fileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        this.showStatus(statusElement, "Processing file...", "info");

        const result = await this.fileHandler.parseCSV(file);

        if (result.success) {
          const mappings = this.fileHandler.getColumnMappings();
          const validationIssues = this.fileHandler.validateRequiredData();

          if (validationIssues.length > 0) {
            this.showStatus(
              statusElement,
              `File processed with warnings: ${validationIssues
                .slice(0, 3)
                .join(", ")}`,
              "warning"
            );
          } else {
            this.showStatus(
              statusElement,
              `File processed successfully: ${result.metadata.rowCount} rows, ${result.metadata.columnCount} columns`,
              "success"
            );
          }

          // Callback for successful processing
          if (this.onFileProcessed) {
            this.onFileProcessed(result, mappings, validationIssues);
          }
        } else {
          throw new Error("File processing failed");
        }
      } catch (error) {
        this.showStatus(statusElement, `Error: ${error.message}`, "error");
        if (this.onError) {
          this.onError(error);
        }
      }
    });
  }

  // Show status messages
  showStatus(element, message, type) {
    if (!element) return;

    const alertClasses = {
      info: "alert alert-info",
      success: "alert alert-success",
      warning: "alert alert-warning",
      error: "alert alert-danger",
    };

    const icons = {
      info: "📄",
      success: "✅",
      warning: "⚠️",
      error: "❌",
    };

    element.className = alertClasses[type] || alertClasses.info;
    element.innerHTML = `${icons[type]} ${message}`;
    element.classList.remove("hidden");
  }

  // Get processed data
  getData() {
    return this.fileHandler.csvData;
  }

  // Get column headers
  getHeaders() {
    return this.fileHandler.columnHeaders;
  }

  // Get hardcoded mappings
  getMappings() {
    return this.fileHandler.getColumnMappings();
  }

  // Export recommendations
  exportRecommendations(recommendations) {
    return this.fileHandler.exportToCSV(
      recommendations,
      "instance_recommendations.csv"
    );
  }
}

// Export for use in the main application
if (typeof module !== "undefined" && module.exports) {
  module.exports = { FileHandler, FileHandlerIntegration };
} else {
  // Browser environment
  window.FileHandler = FileHandler;
  window.FileHandlerIntegration = FileHandlerIntegration;
}

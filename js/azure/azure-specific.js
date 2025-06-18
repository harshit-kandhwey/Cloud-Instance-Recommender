// Azure-specific functionality for Cloud Instance Recommender
// Enhanced with advanced filtering capabilities

// Azure comprehensive filter data
const azureAdvancedFilterData = {
  instanceSeries: [
    "A-series",
    "B-series",
    "D-series",
    "E-series",
    "F-series",
    "G-series",
    "H-series",
    "L-series",
    "M-series",
    "N-series",
  ],

  vmFamilies: [
    "Standard_A",
    "Standard_B",
    "Standard_D",
    "Standard_DS",
    "Standard_E",
    "Standard_ES",
    "Standard_F",
    "Standard_FS",
    "Standard_G",
    "Standard_GS",
    "Standard_H",
    "Standard_L",
    "Standard_LS",
    "Standard_M",
    "Standard_MS",
    "Standard_N",
    "Standard_NC",
    "Standard_ND",
    "Standard_NV",
  ],

  processorArchitectures: [
    "Intel Xeon",
    "AMD EPYC",
    "ARM Ampere Altra",
    "Intel Ice Lake",
    "Intel Cascade Lake",
  ],
};

// Updated with enhanced exclude types
const azureExcludeTypesData = [
  "ARM",
  "GPU",
  "HPC",
  "Promo",
  "Spot",
  "Burstable",
  "Previous Generation",
];

// Enhanced Azure instance families data
const azureFamilyData = azureAdvancedFilterData.vmFamilies;

// Azure filter data (enhanced)
const azureFilterData = {
  instanceSeries: azureAdvancedFilterData.instanceSeries,
  vmSizes: ["Basic", "Standard", "Premium"],
  diskTypes: ["Standard HDD", "Standard SSD", "Premium SSD", "Ultra SSD"],
  processorArchitectures: azureAdvancedFilterData.processorArchitectures,
};

// Initialize Azure filter controls with advanced capabilities
function initializeAzureFilters() {
  console.log("Azure filters initialized with advanced capabilities");

  // Initialize instance series checkboxes
  const seriesContainer = document.getElementById("familyNameCheckboxes");
  if (seriesContainer) {
    azureAdvancedFilterData.instanceSeries.forEach((series, index) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="azureSeries_${index}" value="${series}">
        <label for="azureSeries_${index}">
          <strong>${series}</strong>
          <span class="filter-description">${getAzureSeriesDescription(
            series
          )}</span>
        </label>
      `;
      seriesContainer.appendChild(div);
    });
  }

  // Initialize processor architecture checkboxes
  const processorContainer = document.getElementById("processorCheckboxes");
  if (processorContainer) {
    azureAdvancedFilterData.processorArchitectures.forEach(
      (processor, index) => {
        const div = document.createElement("div");
        div.className = "filter-checkbox-item";
        div.innerHTML = `
        <input type="checkbox" id="azureProcessor_${index}" value="${processor}">
        <label for="azureProcessor_${index}">
          <strong>${processor}</strong>
          <span class="filter-description">${getAzureProcessorDescription(
            processor
          )}</span>
        </label>
      `;
        processorContainer.appendChild(div);
      }
    );
  }

  // Initialize VM families checkboxes
  const familiesContainer = document.getElementById("mainFamiliesCheckboxes");
  if (familiesContainer) {
    azureAdvancedFilterData.vmFamilies.forEach((family, index) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="azureFamily_${index}" value="${family}">
        <label for="azureFamily_${index}">
          <strong>${family}</strong>
          <span class="filter-description">${getAzureVMFamilyDescription(
            family
          )}</span>
        </label>
      `;
      familiesContainer.appendChild(div);
    });
  }

  // Update labels to be Azure-specific
  updateAzureFilterLabels();
}

// Update HTML labels for Azure
function updateAzureFilterLabels() {
  // Update processor label
  const processorLabel = document.querySelector(
    "#processorManufacturerControls .form-label"
  );
  if (processorLabel) {
    processorLabel.textContent = "Azure Processor Architectures:";
  }

  // Update family label
  const familyLabel = document.querySelector(
    "#instanceFamilyNameControls .form-label"
  );
  if (familyLabel) {
    familyLabel.textContent = "Azure Instance Series:";
  }

  // Update main families label
  const mainLabel = document.querySelector("#mainFamiliesControls .form-label");
  if (mainLabel) {
    mainLabel.textContent = "Azure VM Families:";
  }
}

// Enhanced Azure series descriptions
function getAzureSeriesDescription(series) {
  const descriptions = {
    "A-series": "Basic compute needs, entry-level workloads",
    "B-series": "Burstable performance, variable workloads",
    "D-series": "General purpose with fast processors and SSD storage",
    "E-series": "Memory optimized for in-memory applications",
    "F-series": "Compute optimized with high CPU-to-memory ratio",
    "G-series": "Memory and storage optimized for big data",
    "H-series": "High performance computing workloads",
    "L-series": "Storage optimized with high disk throughput",
    "M-series": "Memory optimized for large in-memory workloads",
    "N-series": "GPU enabled instances for AI/ML and graphics",
  };
  return descriptions[series] || "Specialized Azure VM series";
}

// Enhanced Azure processor descriptions
function getAzureProcessorDescription(processor) {
  const descriptions = {
    "Intel Xeon": "High-performance x86-64 processors",
    "AMD EPYC": "High core count processors with excellent price-performance",
    "ARM Ampere Altra": "ARM-based processors for cloud-native workloads",
    "Intel Ice Lake": "Latest generation Intel with enhanced performance",
    "Intel Cascade Lake": "Intel processors optimized for cloud workloads",
  };
  return descriptions[processor] || "Specialized processor architecture";
}

// Azure VM family descriptions
function getAzureVMFamilyDescription(family) {
  const descriptions = {
    Standard_A: "Basic general purpose VMs",
    Standard_B: "Burstable performance VMs",
    Standard_D: "General purpose with premium storage",
    Standard_DS: "General purpose with premium SSD storage",
    Standard_E: "Memory optimized VMs",
    Standard_ES: "Memory optimized with premium storage",
    Standard_F: "Compute optimized VMs",
    Standard_FS: "Compute optimized with premium storage",
    Standard_G: "Memory and storage optimized",
    Standard_GS: "Memory and storage optimized with premium storage",
    Standard_H: "High performance computing",
    Standard_L: "Storage optimized",
    Standard_LS: "Storage optimized with premium storage",
    Standard_M: "Large memory optimized",
    Standard_MS: "Large memory optimized with premium storage",
    Standard_N: "GPU enabled VMs",
    Standard_NC: "GPU optimized for compute workloads",
    Standard_ND: "GPU optimized for deep learning",
    Standard_NV: "GPU optimized for visualization",
  };
  return descriptions[family] || "Specialized VM family";
}

// Azure-specific exclude type descriptions
function getAzureExcludeTypeDescription(type) {
  const descriptions = {
    ARM: "ARM-based instances (Dps, Eps series) - Cost-effective for cloud-native apps",
    GPU: "Graphics processing instances for AI/ML and rendering workloads",
    HPC: "High-performance computing instances for scientific workloads",
    Promo: "Promotional pricing instances with limited availability",
    Spot: "Low-cost preemptible instances for fault-tolerant workloads",
    Burstable: "B-series VMs with variable performance capabilities",
    "Previous Generation": "Older generation VMs (A-series, some D-series)",
  };
  return descriptions[type] || `Exclude ${type} instance types`;
}

// Get selected Azure series
function getSelectedAzureSeries() {
  const selected = [];
  azureAdvancedFilterData.instanceSeries.forEach((series, index) => {
    const checkbox = document.getElementById(`azureSeries_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(series);
    }
  });
  return selected;
}

// Get selected Azure processors
function getSelectedAzureProcessors() {
  const selected = [];
  azureAdvancedFilterData.processorArchitectures.forEach((processor, index) => {
    const checkbox = document.getElementById(`azureProcessor_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(processor);
    }
  });
  return selected;
}

// Get selected Azure VM families
function getSelectedAzureVMFamilies() {
  const selected = [];
  azureAdvancedFilterData.vmFamilies.forEach((family, index) => {
    const checkbox = document.getElementById(`azureFamily_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(family);
    }
  });
  return selected;
}

// Get Azure instance series description
function getAzureSeriesDescription(series) {
  const descriptions = {
    "A-series": "Basic compute needs, development/test",
    "B-series": "Burstable performance instances",
    "D-series": "General purpose with fast processors",
    "E-series": "Memory optimized for in-memory applications",
    "F-series": "Compute optimized with high CPU-to-memory ratio",
    "G-series": "Memory and storage optimized",
    "H-series": "High performance computing",
    "L-series": "Storage optimized with high disk throughput",
    "M-series": "Memory optimized for large in-memory workloads",
    "N-series": "GPU enabled instances",
  };
  return descriptions[series] || "Specialized Azure instance series";
}

// Azure region mapping and validation
const azureRegions = {
  "East US": "eastus",
  "East US 2": "eastus2",
  "West US": "westus",
  "West US 2": "westus2",
  "West US 3": "westus3",
  "Central US": "centralus",
  "North Central US": "northcentralus",
  "South Central US": "southcentralus",
  "North Europe": "northeurope",
  "West Europe": "westeurope",
  "UK South": "uksouth",
  "UK West": "ukwest",
  "France Central": "francecentral",
  "Germany West Central": "germanywestcentral",
  "Switzerland North": "switzerlandnorth",
  "Norway East": "norwayeast",
};

// Validate Azure region
function validateAzureRegion(region) {
  return (
    Object.keys(azureRegions).includes(region) ||
    Object.values(azureRegions).includes(region)
  );
}

// Get Azure region code
function getAzureRegionCode(regionName) {
  return (
    azureRegions[regionName] || regionName.toLowerCase().replace(/\s+/g, "")
  );
}

// Azure pricing zones
function getAzurePricingZone(region) {
  const zone1Regions = [
    "East US",
    "East US 2",
    "West US",
    "West US 2",
    "North Europe",
    "West Europe",
  ];
  const zone2Regions = [
    "Central US",
    "South Central US",
    "UK South",
    "France Central",
  ];
  const zone3Regions = [
    "West US 3",
    "Germany West Central",
    "Switzerland North",
    "Norway East",
  ];

  if (zone1Regions.includes(region)) return "Zone 1";
  if (zone2Regions.includes(region)) return "Zone 2";
  if (zone3Regions.includes(region)) return "Zone 3";
  return "Zone 1"; // Default
}

// Download Azure sample CSV
function downloadAzureSampleCSV() {
  const csvContent = `VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,Azure Region
web-server-01,4,16,45,60,East US
db-server-02,8,32,70,80,West US 2
app-server-03,2,8,35,45,North Europe
cache-server-04,2,4,25,30,East US
api-server-05,4,8,65,55,West US
microservice-06,1,2,15,20,East US
worker-node-07,8,16,85,75,West US 2
frontend-08,2,4,40,50,North Europe`;

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "Azure_sample_instance_data.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Azure-specific cost optimization recommendations
function getAzureCostOptimizationTips() {
  return [
    "Consider Reserved Instances for 1-3 year commitments (up to 72% savings)",
    "Use Azure Hybrid Benefit if you have Windows Server licenses",
    "Leverage Spot Instances for fault-tolerant workloads (up to 90% savings)",
    "Right-size instances based on actual utilization metrics",
    "Use Dps and Eps series (ARM-based) for cost-effective compute",
    "Consider B-series for variable workloads with burstable performance",
    "Implement auto-scaling to match demand patterns",
    "Use Azure Advisor recommendations for optimization insights",
  ];
}

// Export Azure-specific functions and data
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    azureAdvancedFilterData,
    azureFamilyData,
    azureExcludeTypesData,
    azureFilterData,
    azureRegions,
    getAzureExcludeTypeDescription,
    initializeAzureFilters,
    getAzureSeriesDescription,
    getAzureProcessorDescription,
    getAzureVMFamilyDescription,
    validateAzureRegion,
    getAzureRegionCode,
    getAzurePricingZone,
    downloadAzureSampleCSV,
    getAzureCostOptimizationTips,
    getSelectedAzureSeries,
    getSelectedAzureProcessors,
    getSelectedAzureVMFamilies,
    updateAzureFilterLabels,
  };
}

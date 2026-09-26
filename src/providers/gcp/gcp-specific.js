// GCP-specific functionality for Cloud Instance Recommender
// Enhanced with advanced filtering capabilities

// GCP comprehensive filter data
const gcpAdvancedFilterData = {
  machineFamilies: [
    "E2",
    "N1",
    "N2",
    "N2D",
    "N4",
    "N4D",
    "N4A",
    "T2D",
    "T2A",
    "C2",
    "C2D",
    "C3",
    "C3D",
    "C4",
    "C4A",
    "C4D",
    "C4N",
    "M1",
    "M2",
    "M3",
    "M4",
    "M4N",
    "A2",
    "A3",
    "G2",
    "H3",
    "H4D",
    "Z3",
  ],

  // "custom" is deliberately absent: getMachineTypeCategory() only ever returns
  // standard/highmem/highcpu/shared-core, so listing "custom" here let a user
  // pick a filter value nothing could ever match — custom shapes are handled
  // separately by customFitSuggestion, not by this category filter.
  machineTypes: ["standard", "highmem", "highcpu", "shared-core"],

  // Must equal the cpuPlatform values the shipped records carry: the engine
  // compares a ticked value to instance.processor by equality.
  processorPlatforms: ["Intel", "AMD", "ARM"],
};

// Updated with enhanced exclude types
const gcpExcludeTypesData = [
  "ARM",
  "GPU",
  "TPU",
  "Preemptible",
  "Shared-Core",
  "Previous Generation",
  "Custom",
  "Bare Metal",
];

// Enhanced GCP instance families data
const gcpFamilyData = gcpAdvancedFilterData.machineFamilies;

// Initialize GCP filter controls with advanced capabilities
function initializeGCPFilters() {
  console.log("GCP filters initialized with advanced capabilities");

  initializeInstanceFamilyNameFilter(
    distinctSpecValues(window.GCP_SPECS, "seriesName"),
  );

  // Initialize machine families checkboxes
  const familiesContainer = document.getElementById("seriesCheckboxes");
  if (familiesContainer) {
    gcpAdvancedFilterData.machineFamilies.forEach((family) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="${filterOptionId("gcpFamily_", family)}" value="${family}">
        <label for="${filterOptionId("gcpFamily_", family)}">
          <strong>${family}</strong>
          <span class="filter-description">${getGCPFamilyAdvancedDescription(
            family,
          )}</span>
        </label>
      `;
      familiesContainer.appendChild(div);
    });
  }

  // Initialize processor platforms checkboxes
  const processorContainer = document.getElementById("processorCheckboxes");
  if (processorContainer) {
    gcpAdvancedFilterData.processorPlatforms.forEach((processor) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="${filterOptionId("gcpProcessor_", processor)}" value="${processor}">
        <label for="${filterOptionId("gcpProcessor_", processor)}">
          <strong>${processor}</strong>
          <span class="filter-description">${getGCPProcessorDescription(
            processor,
          )}</span>
        </label>
      `;
      processorContainer.appendChild(div);
    });
  }

  // Initialize machine types checkboxes
  const typesContainer = document.getElementById("mainFamiliesCheckboxes");
  if (typesContainer) {
    gcpAdvancedFilterData.machineTypes.forEach((type) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="${filterOptionId("gcpType_", type)}" value="${type}">
        <label for="${filterOptionId("gcpType_", type)}">
          <strong>${type}</strong>
          <span class="filter-description">${getGCPMachineTypeDescription(
            type,
          )}</span>
        </label>
      `;
      typesContainer.appendChild(div);
    });
  }

  // Update labels to be GCP-specific
  updateGCPFilterLabels();
}

// Update HTML labels for GCP
function updateGCPFilterLabels() {
  // Update processor label
  const processorLabel = document.querySelector(
    "#processorManufacturerControls .form-label",
  );
  if (processorLabel) {
    processorLabel.textContent = "GCP Processor Platforms:";
  }

  // Update family label
  const familyLabel = document.querySelector(
    "#instanceFamilyNameControls .form-label",
  );
  if (familyLabel) {
    familyLabel.textContent = "GCP Instance Family Names:";
  }

  // Update main families label
  const mainLabel = document.querySelector("#mainFamiliesControls .form-label");
  if (mainLabel) {
    mainLabel.textContent = "GCP Machine Types:";
  }
}

// Enhanced GCP machine family descriptions
function getGCPFamilyAdvancedDescription(family) {
  const descriptions = {
    E2: "Cost-optimized with flexible vCPU and memory (up to 20% savings)",
    N1: "First generation general-purpose with proven reliability",
    N2: "Second generation general-purpose with 20% better performance",
    N2D: "AMD-based general-purpose with excellent price-performance",
    N4: "4th gen Intel general-purpose (Emerald Rapids)",
    N4D: "4th gen AMD general-purpose (Genoa-X)",
    N4A: "ARM-based general-purpose on Google Axion (Neoverse N3)",
    T2D: "AMD-based cost-optimized for scale-out workloads",
    T2A: "ARM-based cost-optimized (up to 20% cost savings)",
    C2: "2nd gen Intel compute-optimized (Cascade Lake)",
    C2D: "AMD-based compute-optimized with high core counts",
    C3: "3rd gen Intel compute-optimized (Sapphire Rapids)",
    C3D: "AMD-based compute-optimized (Genoa)",
    C4: "4th gen Intel compute-optimized (Emerald Rapids)",
    C4A: "ARM-based compute-optimized on Google Axion (Neoverse V2)",
    C4D: "4th gen AMD compute-optimized (Turin)",
    C4N: "Network-optimized Intel (Emerald Rapids) for high-bandwidth workloads",
    M1: "First generation memory-optimized Intel for SAP HANA and large in-memory databases",
    M2: "Ultra-high memory Intel (Cascade Lake) for the largest SAP HANA deployments",
    M3: "Memory-optimized Intel (Ice Lake) for SAP and in-memory workloads",
    M4: "Memory-optimized Intel (Sapphire Rapids) ultra-high memory",
    M4N: "Network-optimized memory Intel (Emerald Rapids) for high-bandwidth in-memory workloads",
    A2: "GPU instances with NVIDIA A100 for ML training and HPC",
    A3: "Latest GPU instances with NVIDIA H100 for AI/ML",
    G2: "GPU instances with NVIDIA L4 for AI inference and graphics",
    H3: "HPC-optimized Intel Sapphire Rapids for tightly-coupled workloads",
    H4D: "HPC-optimized AMD (Turin) for tightly-coupled workloads",
    Z3: "Storage-optimized with local NVMe SSDs for high IOPS",
  };
  return descriptions[family] || "Specialized GCP machine family";
}

// Enhanced GCP processor descriptions
function getGCPProcessorDescription(processor) {
  const descriptions = {
    Intel: "x86-64 Xeon processors, widely compatible",
    AMD: "x86-64 EPYC processors, high core counts",
    ARM: "Arm-based processors (Tau T2A, Axion) for cloud-native workloads",
  };
  return descriptions[processor] || "Specialized processor platform";
}

// GCP machine type descriptions
function getGCPMachineTypeDescription(type) {
  const descriptions = {
    standard: "Balanced CPU and memory for general workloads",
    highmem: "High memory-to-CPU ratio for memory-intensive apps",
    highcpu: "High CPU-to-memory ratio for compute-intensive tasks",
    "shared-core":
      "Cost-effective micro and small instances for light workloads",
    custom: "Tailored CPU and memory configurations for specific needs",
  };
  return descriptions[type] || "Specialized machine type";
}

// GCP-specific exclude type descriptions
function getGCPExcludeTypeDescription(type) {
  const descriptions = {
    ARM: "ARM-based instances (T2A series) - Up to 20% cost savings for cloud-native apps",
    GPU: "Graphics processing instances for AI/ML and rendering workloads",
    TPU: "Tensor Processing Units optimized for machine learning",
    Preemptible:
      "Short-lived instances with up to 80% savings for fault-tolerant workloads",
    "Shared-Core": "Micro and small instances sharing physical CPU cores",
    "Previous Generation":
      "Older generation instances (N1, some specialized types)",
    Custom: "Custom machine types with non-standard CPU/memory ratios",
  };
  return descriptions[type] || `Exclude ${type} instance types`;
}

// Get GCP machine family description (legacy support)
function getGCPFamilyDescription(family) {
  return getGCPFamilyAdvancedDescription(String(family || "").toUpperCase());
}

// Download GCP sample CSV
function downloadGCPSampleCSV() {
  const csvContent = `VM Name,App Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,GCP Region,ENV,OS,Workload,Compliance,Min Gen,Exclude,Include Only,Current Instance Type
web-server-01,Storefront,4,16,45,60,us-central1,Production,Linux,Web Server,,,,,n2-standard-4
db-server-02,Billing,8,32,70,80,us-west1,Production,Windows,Database,PCI,,"Burstable,GPU",,n2-standard-8
app-server-03,Billing,2,8,35,45,europe-west1,Dev,Linux,General,,,,,e2-standard-2
cache-server-04,Storefront,2,4,25,30,us-central1,Staging,Linux,Cache,,,Burstable,,e2-medium
api-server-05,Storefront,4,8,65,55,us-west1,Production,Linux,Web Server,,n2,,,n2-highcpu-4
microservice-06,Analytics,1,2,15,20,us-central1,Dev,Linux,General,,,,"n2,e2",e2-small
worker-node-07,Analytics,8,16,85,75,us-west1,Production,Linux,ML/AI,HIPAA,n4,,,n2-highcpu-8
frontend-08,Storefront,2,4,40,50,europe-west1,Staging,Windows,Web Server,,,,,e2-medium`;

  downloadCsv(csvContent, "GCP_sample_instance_data.csv");
}

// Node-side consumers (the data-integrity suite) read the filter list directly.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { gcpAdvancedFilterData };
}

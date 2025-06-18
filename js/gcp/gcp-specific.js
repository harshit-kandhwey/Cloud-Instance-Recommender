// GCP-specific functionality for Cloud Instance Recommender
// Enhanced with advanced filtering capabilities

// GCP comprehensive filter data
const gcpAdvancedFilterData = {
  machineFamilies: [
    "E2",
    "N1",
    "N2",
    "N2D",
    "T2D",
    "T2A",
    "C2",
    "C2D",
    "M1",
    "M2",
    "A2",
    "A3",
  ],

  machineTypes: ["standard", "highmem", "highcpu", "shared-core", "custom"],

  processorPlatforms: [
    "Intel Skylake",
    "Intel Broadwell",
    "Intel Haswell",
    "Intel Ice Lake",
    "Intel Cascade Lake",
    "AMD Rome",
    "AMD Milan",
    "ARM Ampere Altra",
  ],

  cpuPlatforms: ["Intel", "AMD", "ARM"],
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
];

// Enhanced GCP instance families data
const gcpFamilyData = gcpAdvancedFilterData.machineFamilies;

// GCP filter data (enhanced)
const gcpFilterData = {
  machineTypes: gcpAdvancedFilterData.machineTypes,
  machineFamilies: gcpAdvancedFilterData.machineFamilies,
  processors: gcpAdvancedFilterData.processorPlatforms,
};

// Initialize GCP filter controls with advanced capabilities
function initializeGCPFilters() {
  console.log("GCP filters initialized with advanced capabilities");

  // Initialize machine families checkboxes
  const familiesContainer = document.getElementById("familyNameCheckboxes");
  if (familiesContainer) {
    gcpAdvancedFilterData.machineFamilies.forEach((family, index) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="gcpFamily_${index}" value="${family}">
        <label for="gcpFamily_${index}">
          <strong>${family}</strong>
          <span class="filter-description">${getGCPFamilyAdvancedDescription(
            family
          )}</span>
        </label>
      `;
      familiesContainer.appendChild(div);
    });
  }

  // Initialize processor platforms checkboxes
  const processorContainer = document.getElementById("processorCheckboxes");
  if (processorContainer) {
    gcpAdvancedFilterData.processorPlatforms.forEach((processor, index) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="gcpProcessor_${index}" value="${processor}">
        <label for="gcpProcessor_${index}">
          <strong>${processor}</strong>
          <span class="filter-description">${getGCPProcessorDescription(
            processor
          )}</span>
        </label>
      `;
      processorContainer.appendChild(div);
    });
  }

  // Initialize machine types checkboxes
  const typesContainer = document.getElementById("mainFamiliesCheckboxes");
  if (typesContainer) {
    gcpAdvancedFilterData.machineTypes.forEach((type, index) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="gcpType_${index}" value="${type}">
        <label for="gcpType_${index}">
          <strong>${type}</strong>
          <span class="filter-description">${getGCPMachineTypeDescription(
            type
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
    "#processorManufacturerControls .form-label"
  );
  if (processorLabel) {
    processorLabel.textContent = "GCP Processor Platforms:";
  }

  // Update family label
  const familyLabel = document.querySelector(
    "#instanceFamilyNameControls .form-label"
  );
  if (familyLabel) {
    familyLabel.textContent = "GCP Machine Families:";
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
    T2D: "AMD-based cost-optimized for scale-out workloads",
    T2A: "ARM-based cost-optimized (up to 20% cost savings)",
    C2: "Compute-optimized with highest per-core performance",
    C2D: "AMD-based compute-optimized with high core counts",
    M1: "Memory-optimized for SAP and in-memory databases",
    M2: "Ultra-high memory for the largest in-memory workloads",
    A2: "GPU instances for ML training and HPC workloads",
    A3: "Latest GPU instances with NVIDIA H100 for AI/ML",
  };
  return descriptions[family] || "Specialized GCP machine family";
}

// Enhanced GCP processor descriptions
function getGCPProcessorDescription(processor) {
  const descriptions = {
    "Intel Skylake": "Balanced performance for general workloads",
    "Intel Broadwell": "Proven platform for enterprise applications",
    "Intel Haswell": "Cost-effective option for basic workloads",
    "Intel Ice Lake": "Latest Intel with enhanced AI acceleration",
    "Intel Cascade Lake": "High-performance Intel for demanding workloads",
    "AMD Rome": "High core count processors with excellent value",
    "AMD Milan": "Latest AMD with improved performance per dollar",
    "ARM Ampere Altra": "Energy-efficient ARM processors for cloud-native apps",
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

// Get selected GCP machine families
function getSelectedGCPFamilies() {
  const selected = [];
  gcpAdvancedFilterData.machineFamilies.forEach((family, index) => {
    const checkbox = document.getElementById(`gcpFamily_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(family);
    }
  });
  return selected;
}

// Get selected GCP processors
function getSelectedGCPProcessors() {
  const selected = [];
  gcpAdvancedFilterData.processorPlatforms.forEach((processor, index) => {
    const checkbox = document.getElementById(`gcpProcessor_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(processor);
    }
  });
  return selected;
}

// Get selected GCP machine types
function getSelectedGCPMachineTypes() {
  const selected = [];
  gcpAdvancedFilterData.machineTypes.forEach((type, index) => {
    const checkbox = document.getElementById(`gcpType_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(type);
    }
  });
  return selected;
}

// Get selected GCP exclude types (ADDED - was missing)
function getSelectedGCPExcludeTypes() {
  const selected = [];
  gcpExcludeTypesData.forEach((type, index) => {
    const checkbox = document.getElementById(`gcpExclude_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(type);
    }
  });
  return selected;
}

// Initialize GCP exclude types with enhanced options (ADDED - was missing)
function initializeGCPExcludeTypes() {
  const excludeContainer = document.getElementById("excludeTypeControls");
  if (!excludeContainer) return;

  // Clear existing content
  excludeContainer.innerHTML = "";

  // Create GCP exclude section
  const gcpSection = document.createElement("div");
  gcpSection.className = "provider-exclude-section";
  gcpSection.innerHTML = `
    <div class="form-group">
      <label class="form-label">GCP Exclude Options:</label>
      <div class="filter-checkbox-grid" id="gcpExcludeCheckboxes">
        <!-- Will be populated below -->
      </div>
    </div>
  `;
  excludeContainer.appendChild(gcpSection);

  // Populate GCP exclude checkboxes
  const gcpExcludeContainer = document.getElementById("gcpExcludeCheckboxes");
  if (gcpExcludeContainer) {
    gcpExcludeTypesData.forEach((type, index) => {
      const div = document.createElement("div");
      div.className = "exclude-checkbox-item";
      div.innerHTML = `
        <div class="checkbox-item">
          <input type="checkbox" id="gcpExclude_${index}" value="${type}">
          <label for="gcpExclude_${index}">
            <strong>❌ ${type}</strong>
            <small style="display: block; color: #666;">
              ${getGCPExcludeTypeDescription(type)}
            </small>
          </label>
        </div>
      `;
      gcpExcludeContainer.appendChild(div);
    });
  }
}

// Get GCP machine family description (legacy support)
function getGCPFamilyDescription(family) {
  return getGCPFamilyAdvancedDescription(family.toLowerCase());
}

// GCP region mapping and validation
const gcpRegions = {
  "us-central1": "Iowa",
  "us-east1": "South Carolina",
  "us-east4": "Northern Virginia",
  "us-west1": "Oregon",
  "us-west2": "Los Angeles",
  "us-west3": "Salt Lake City",
  "us-west4": "Las Vegas",
  "europe-west1": "Belgium",
  "europe-west2": "London",
  "europe-west3": "Frankfurt",
  "europe-west4": "Netherlands",
  "europe-west6": "Zurich",
  "europe-north1": "Finland",
  "asia-east1": "Taiwan",
  "asia-east2": "Hong Kong",
  "asia-northeast1": "Tokyo",
  "asia-northeast2": "Osaka",
  "asia-northeast3": "Seoul",
  "asia-south1": "Mumbai",
  "asia-southeast1": "Singapore",
  "australia-southeast1": "Sydney",
};

// Validate GCP region
function validateGCPRegion(region) {
  return (
    Object.keys(gcpRegions).includes(region) ||
    Object.values(gcpRegions).includes(region)
  );
}

// Get GCP region location
function getGCPRegionLocation(regionCode) {
  return gcpRegions[regionCode] || regionCode;
}

// GCP pricing tiers
function getGCPPricingTier(region) {
  const tier1Regions = ["us-central1", "us-east1", "us-west1", "europe-west1"];
  const tier2Regions = [
    "us-east4",
    "us-west2",
    "europe-west2",
    "europe-west3",
    "asia-east1",
  ];
  const tier3Regions = [
    "us-west3",
    "us-west4",
    "europe-west4",
    "europe-west6",
    "asia-northeast1",
  ];

  if (tier1Regions.includes(region)) return "Tier 1";
  if (tier2Regions.includes(region)) return "Tier 2";
  if (tier3Regions.includes(region)) return "Tier 3";
  return "Tier 1"; // Default
}

// GCP zone suffixes
function getGCPZones(region) {
  // Most GCP regions have zones a, b, c, and sometimes d, f
  const zones = ["a", "b", "c"];

  // Some regions have additional zones
  const extendedZoneRegions = [
    "us-central1",
    "us-east1",
    "europe-west1",
    "asia-east1",
  ];

  if (extendedZoneRegions.includes(region)) {
    zones.push("d");
  }

  return zones.map((zone) => `${region}-${zone}`);
}

// Download GCP sample CSV
function downloadGCPSampleCSV() {
  const csvContent = `VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,GCP Region
web-server-01,4,16,45,60,us-central1-a
db-server-02,8,32,70,80,us-west1-b  
app-server-03,2,8,35,45,europe-west1-c
cache-server-04,2,4,25,30,us-central1-a
api-server-05,4,8,65,55,us-west1-b
microservice-06,1,2,15,20,us-central1-a
worker-node-07,8,16,85,75,us-west1-b
frontend-08,2,4,40,50,europe-west1-c`;

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "GCP_sample_instance_data.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// GCP-specific cost optimization recommendations (ENHANCED with emojis)
function getGCPCostOptimizationTips() {
  return [
    "🔹 Use Committed Use Discounts for 1-3 year commitments (up to 57% savings)",
    "🔹 Leverage Preemptible instances for fault-tolerant workloads (up to 80% savings)",
    "🔹 Consider T2A (ARM-based) instances for up to 20% cost savings",
    "🔹 Right-size instances using GCP Recommender suggestions",
    "🔹 Use Sustained Use Discounts (automatic discounts for long-running instances)",
    "🔹 Implement custom machine types to match exact resource needs",
    "🔹 Use E2 instances for cost-optimized general-purpose workloads",
    "🔹 Consider AMD-based N2D and T2D instances for better price-performance",
    "🔹 Implement auto-scaling to match demand patterns",
    "🔹 Use per-second billing to optimize for short-running workloads",
    "🔹 Enable Cloud Billing Budget alerts for cost monitoring",
    "🔹 Use resource labels for detailed cost tracking and optimization",
  ];
}

// GCP performance optimization recommendations (ADDED - was missing)
function getGCPPerformanceOptimizationTips() {
  return [
    "⚡ Use C2 instances for highest single-threaded performance",
    "🧠 Choose M1/M2 for memory-intensive workloads",
    "🔧 Consider N2 for balanced price-performance improvements",
    "💾 Use Local SSD for high-performance storage needs",
    "🌐 Select regions closest to your users for lower latency",
    "📊 Monitor performance with Cloud Monitoring",
    "🔄 Use managed instance groups for auto-scaling",
    "🚀 Implement Global Load Balancer for worldwide performance",
    "💿 Use Persistent Disk with appropriate performance tiers",
    "🔗 Enable Premium Network Tier for improved connectivity",
  ];
}

// GCP sustainability and green computing tips (ADDED - was missing)
function getGCPSustainabilityTips() {
  return [
    "🌱 GCP runs on renewable energy in many regions",
    "⚡ Use E2 instances for energy-efficient computing",
    "🌍 Choose regions with high renewable energy percentage",
    "📊 Monitor carbon footprint with Google Cloud Carbon Footprint",
    "🔄 Use auto-scaling to reduce idle resource consumption",
    "♻️ Implement rightsizing to minimize resource waste",
    "🌿 Consider carbon-neutral regions for environmentally conscious deployments",
    "🔋 Use scheduled scaling to reduce off-hours energy consumption",
  ];
}

// GCP machine type naming convention helper
function parseGCPMachineType(machineType) {
  // Example: e2-standard-4, n1-highmem-2, c2-standard-8
  const parts = machineType.split("-");

  return {
    family: parts[0], // e2, n1, c2, etc.
    type: parts[1], // standard, highmem, highcpu
    vcpus: parseInt(parts[2]) || 0, // number of vCPUs
    fullType: machineType,
  };
}

// Export GCP-specific functions and data
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    gcpAdvancedFilterData,
    gcpFamilyData,
    gcpExcludeTypesData,
    gcpFilterData,
    gcpRegions,
    getGCPExcludeTypeDescription,
    initializeGCPFilters,
    initializeGCPExcludeTypes,
    getGCPFamilyDescription,
    getGCPFamilyAdvancedDescription,
    getGCPProcessorDescription,
    getGCPMachineTypeDescription,
    validateGCPRegion,
    getGCPRegionLocation,
    getGCPPricingTier,
    getGCPZones,
    downloadGCPSampleCSV,
    getGCPCostOptimizationTips,
    getGCPPerformanceOptimizationTips,
    getGCPSustainabilityTips,
    parseGCPMachineType,
    getSelectedGCPFamilies,
    getSelectedGCPProcessors,
    getSelectedGCPMachineTypes,
    getSelectedGCPExcludeTypes,
    updateGCPFilterLabels,
  };
}

// AWS-specific functionality for Cloud Instance Recommender

// AWS Filter Data based on actual CSV structure
const awsFilterData = {
  instanceFamilyNames: [
    "General purpose",
    "Micro instances",
    "Compute optimized",
    "Storage optimized",
    "Memory optimized",
    "GPU instance",
    "Machine Learning ASIC Instances",
    "FPGA Instances",
    "Media Accelerator Instances",
  ],
  processorManufacturers: [
    "Intel",
    "AWS", // Graviton
    "AMD",
    "Apple",
  ],
  // Main instance families (simplified)
  mainFamilies: [
    "t",
    "m",
    "c",
    "r",
    "a",
    "x",
    "z",
    "i",
    "d",
    "h",
    "f",
    "g",
    "p",
    "inf",
    "trn",
    "dl",
    "vt",
  ],
};

// AWS instance families data
const awsFamilyData = [
  "t3",
  "t4g",
  "m5",
  "m6g",
  "c5",
  "c6g",
  "r5",
  "r6g",
  "t2",
  "m4",
  "c4",
  "r4",
];

// AWS exclude types data
const awsExcludeTypesData = [
  "Graviton",
  "Mac",
  "Nitro",
  "GPU",
  "FPGA",
  "Burstable",
];

// Initialize AWS filter controls
function initializeAWSFilters() {
  // Initialize instance family name checkboxes
  const familyNameContainer = document.getElementById("familyNameCheckboxes");
  if (familyNameContainer) {
    awsFilterData.instanceFamilyNames.forEach((familyName, index) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="familyName_${index}" value="${familyName}">
        <label for="familyName_${index}">
          <strong>${familyName}</strong>
          <span class="filter-description">${getFamilyNameDescription(
            familyName
          )}</span>
        </label>
      `;
      familyNameContainer.appendChild(div);
    });
  }

  // Initialize processor manufacturer checkboxes
  const processorContainer = document.getElementById("processorCheckboxes");
  if (processorContainer) {
    awsFilterData.processorManufacturers.forEach((processor, index) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="processor_${index}" value="${processor}">
        <label for="processor_${index}">
          <strong>${processor}</strong>
          <span class="filter-description">${getProcessorDescription(
            processor
          )}</span>
        </label>
      `;
      processorContainer.appendChild(div);
    });
  }

  // Initialize main families checkboxes
  const mainFamiliesContainer = document.getElementById(
    "mainFamiliesCheckboxes"
  );
  if (mainFamiliesContainer) {
    awsFilterData.mainFamilies.forEach((family, index) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="mainFamily_${index}" value="${family}">
        <label for="mainFamily_${index}">
          <strong>${family.toUpperCase()}</strong>
          <span class="filter-description">${getMainFamilyDescription(
            family
          )}</span>
        </label>
      `;
      mainFamiliesContainer.appendChild(div);
    });
  }
}

// Get family name descriptions
function getFamilyNameDescription(familyName) {
  const descriptions = {
    "General purpose": "Balanced compute, memory, and networking",
    "Micro instances": "Low-cost, low-throughput applications",
    "Compute optimized": "High-performance processors",
    "Storage optimized": "High sequential read/write",
    "Memory optimized": "Fast performance for in-memory databases",
    "GPU instance": "Accelerated computing workloads",
    "Machine Learning ASIC Instances": "Machine learning inference",
    "FPGA Instances": "Hardware acceleration",
    "Media Accelerator Instances": "Video processing workloads",
  };
  return descriptions[familyName] || "Specialized instance type";
}

// Get processor descriptions
function getProcessorDescription(processor) {
  const descriptions = {
    Intel: "x86-64 architecture, widely compatible",
    AWS: "Graviton ARM-based, up to 40% better price performance",
    AMD: "x86-64 EPYC processors, high core counts",
    Apple: "Mac instances for iOS/macOS development",
  };
  return descriptions[processor] || "Specialized processor";
}

// Get main family descriptions
function getMainFamilyDescription(family) {
  const descriptions = {
    t: "Burstable performance instances",
    m: "General purpose instances",
    c: "Compute optimized instances",
    r: "Memory optimized instances",
    a: "ARM-based general purpose",
    x: "Memory optimized with high memory-to-vCPU ratios",
    z: "High frequency instances",
    i: "Storage optimized with NVMe SSD",
    d: "Dense storage instances",
    h: "High disk throughput",
    f: "FPGA instances",
    g: "Graphics workloads",
    p: "GPU instances for ML/AI",
    inf: "Machine learning inference",
    trn: "Machine learning training",
    dl: "Deep learning instances",
    vt: "Video transcoding instances",
  };
  return descriptions[family] || "Specialized instance family";
}

// Toggle current generation filter
function toggleCurrentGenerationFilter() {
  const checkbox = document.getElementById("currentGenerationOnly");
  console.log(
    "Current generation filter:",
    checkbox.checked ? "Enabled" : "Disabled"
  );
}

// Toggle instance family name filter
function toggleInstanceFamilyNameFilter() {
  const controls = document.getElementById("instanceFamilyNameControls");
  const checkbox = document.getElementById("restrictInstanceFamilyNames");

  if (checkbox.checked) {
    controls.classList.remove("hidden");
  } else {
    controls.classList.add("hidden");
  }
}

// Toggle processor manufacturer filter
function toggleProcessorManufacturerFilter() {
  const controls = document.getElementById("processorManufacturerControls");
  const checkbox = document.getElementById("restrictProcessorManufacturers");

  if (checkbox.checked) {
    controls.classList.remove("hidden");
  } else {
    controls.classList.add("hidden");
  }
}

// Toggle main families filter
function toggleMainFamiliesFilter() {
  const controls = document.getElementById("mainFamiliesControls");
  const checkbox = document.getElementById("restrictMainFamilies");

  if (checkbox.checked) {
    controls.classList.remove("hidden");
  } else {
    controls.classList.add("hidden");
  }
}

// Get selected instance family names
function getSelectedInstanceFamilyNames() {
  const selected = [];
  awsFilterData.instanceFamilyNames.forEach((familyName, index) => {
    const checkbox = document.getElementById(`familyName_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(familyName);
    }
  });
  return selected;
}

// Get selected processor manufacturers
function getSelectedProcessorManufacturers() {
  const selected = [];
  awsFilterData.processorManufacturers.forEach((processor, index) => {
    const checkbox = document.getElementById(`processor_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(processor);
    }
  });
  return selected;
}

// Get selected main families
function getSelectedMainFamilies() {
  const selected = [];
  awsFilterData.mainFamilies.forEach((family, index) => {
    const checkbox = document.getElementById(`mainFamily_${index}`);
    if (checkbox && checkbox.checked) {
      selected.push(family);
    }
  });
  return selected;
}

// AWS-specific exclude type descriptions
function getAWSExcludeTypeDescription(type) {
  const descriptions = {
    Graviton:
      "ARM-based instances (t4g, m6g, c6g, r6g, etc.) - Often 10-20% cheaper",
    Mac: "macOS instances for iOS/macOS development",
    Nitro: "Latest generation with enhanced networking",
    GPU: "Graphics processing instances",
    FPGA: "Field-programmable gate array instances",
    Burstable: "Variable performance instances (t2, t3, t4g)",
  };
  return descriptions[type] || `Exclude ${type} instance types`;
}

// Download AWS sample CSV
function downloadAWSSampleCSV() {
  const csvContent = `VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region
web-server-01,4,16,45,60,us-east-1
db-server-02,8,32,70,80,us-west-2
app-server-03,2,8,35,45,eu-west-1
cache-server-04,2,4,25,30,us-east-1
api-server-05,4,8,65,55,us-west-1
microservice-06,1,2,15,20,us-east-1
worker-node-07,8,16,85,75,us-west-2
frontend-08,2,4,40,50,eu-west-1`;

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "AWS_sample_instance_data.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Export AWS-specific functions and data
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    awsFilterData,
    awsFamilyData,
    awsExcludeTypesData,
    initializeAWSFilters,
    getFamilyNameDescription,
    getProcessorDescription,
    getMainFamilyDescription,
    toggleCurrentGenerationFilter,
    toggleInstanceFamilyNameFilter,
    toggleProcessorManufacturerFilter,
    toggleMainFamiliesFilter,
    getSelectedInstanceFamilyNames,
    getSelectedProcessorManufacturers,
    getSelectedMainFamilies,
    getAWSExcludeTypeDescription,
    downloadAWSSampleCSV,
  };
}

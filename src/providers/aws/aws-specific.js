// AWS-specific functionality for Cloud Instance Recommender

// AWS Filter Data based on actual CSV structure
const awsFilterData = {
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
  "Bare Metal",
];

// Initialize AWS filter controls
function initializeAWSFilters() {
  initializeInstanceFamilyNameFilter(
    distinctSpecValues(window.AWS_SPECS, "instanceFamilyName"),
  );

  // Initialize processor manufacturer checkboxes
  const processorContainer = document.getElementById("processorCheckboxes");
  if (processorContainer) {
    awsFilterData.processorManufacturers.forEach((processor) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="${filterOptionId("processor_", processor)}" value="${processor}">
        <label for="${filterOptionId("processor_", processor)}">
          <strong>${processor}</strong>
          <span class="filter-description">${getProcessorDescription(
            processor,
          )}</span>
        </label>
      `;
      processorContainer.appendChild(div);
    });
  }

  // Initialize main families checkboxes
  const mainFamiliesContainer = document.getElementById(
    "mainFamiliesCheckboxes",
  );
  if (mainFamiliesContainer) {
    awsFilterData.mainFamilies.forEach((family) => {
      const div = document.createElement("div");
      div.className = "filter-checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="${filterOptionId("mainFamily_", family)}" value="${family}">
        <label for="${filterOptionId("mainFamily_", family)}">
          <strong>${family.toUpperCase()}</strong>
          <span class="filter-description">${getMainFamilyDescription(
            family,
          )}</span>
        </label>
      `;
      mainFamiliesContainer.appendChild(div);
    });
  }
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

// AWS-specific exclude type descriptions
function getAWSExcludeTypeDescription(type) {
  const descriptions = {
    Graviton:
      "ARM-based instances (t4g, m6g, c6g, r6g, etc.) - Often 10-20% cheaper",
    Mac: "macOS instances for iOS/macOS development",
    Nitro: "Latest generation with enhanced networking",
    GPU: "GPU & accelerator instances (also drops FPGA, ML ASIC, media)",
    FPGA: "FPGA instances only — narrower than GPU/accelerator",
    Burstable: "Variable performance instances (t2, t3, t4g)",
  };
  return descriptions[type] || `Exclude ${type} instance types`;
}

// Download AWS sample CSV
function downloadAWSSampleCSV() {
  const csvContent = `VM Name,App Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,ENV,OS,Workload,Compliance,Min Gen,Exclude,Include Only,Current Instance Type
web-server-01,Storefront,4,16,45,60,us-east-1,Production,Linux,Web Server,,,,,m5.xlarge
db-server-02,Billing,8,32,70,80,us-west-2,Production,Windows,Database,"current-generation hardware,aws nitro enclaves",,"Burstable,GPU",,m5.2xlarge
app-server-03,Billing,2,8,35,45,eu-west-1,Dev,Linux,General,,,,,t3.large
cache-server-04,Storefront,2,4,25,30,us-east-1,Staging,Linux,Cache,,,Burstable,,t3.medium
api-server-05,Storefront,4,8,65,55,us-west-1,Production,Linux,Web Server,,6,,,c5.xlarge
microservice-06,Analytics,1,2,15,20,us-east-1,Dev,Linux,General,,,,"t3,m5",t3.small
worker-node-07,Analytics,8,16,85,75,us-west-2,Production,Linux,ML/AI,"current-generation hardware,aws nitro enclaves",7,,,c5.2xlarge
frontend-08,Storefront,2,4,40,50,eu-west-1,Staging,Windows,Web Server,,,,,t3.medium`;

  downloadCsv(csvContent, "AWS_sample_instance_data.csv");
}

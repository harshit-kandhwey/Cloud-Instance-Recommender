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

// Region data
const regionData = {
  aws: [
    "us-east-1",
    "us-west-1",
    "us-west-2",
    "eu-west-1",
    "eu-central-1",
    "ap-southeast-1",
  ],
  azure: [
    "East US",
    "West US 2",
    "North Europe",
    "Southeast Asia",
    "Australia East",
  ],
  gcp: ["us-central1-a", "us-west1-b", "europe-west1-c", "asia-southeast1-a"],
};

// Exclude types data
const excludeTypesData = {
  aws: ["Graviton", "Mac", "Nitro", "GPU", "FPGA"],
  azure: ["Promo", "GPU", "HPC", "Memory Optimized"],
  gcp: ["N2D", "TPU", "GPU", "Preemptible"],
};

// Initialize page
document.addEventListener("DOMContentLoaded", function () {
  // Initialize range inputs when page loads
  updateCpuRanges();
  updateMemoryRanges();
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

// Handle file upload
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const csv = e.target.result;
    parseCSV(csv);
  };
  reader.readAsText(file);

  // Show file status
  const fileStatus = document.getElementById("fileStatus");
  fileStatus.className = "alert alert-info";
  fileStatus.innerHTML = `📄 File uploaded: <strong>${file.name}</strong> (${(
    file.size / 1024
  ).toFixed(1)} KB)`;
  fileStatus.classList.remove("hidden");
}

// Parse CSV and populate dropdowns
function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());

  columnHeaders = headers;
  csvData = lines.slice(1).map((line) => {
    const values = line.split(",");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ? values[index].trim() : "";
    });
    return row;
  });

  populateColumnMappings();
  checkAutoMapping();
}

function applyRegionAutoMappings() {
  if (!window.columnHeaders || columnHeaders.length === 0) return;

  const regionMap = {
    awsRegionMapping: ["aws region", "aws"],
    azureRegionMapping: ["azure region", "azure"],
    gcpRegionMapping: ["gcp region", "gcp", "google"],
  };

  Object.entries(regionMap).forEach(([selectId, patterns]) => {
    const select = document.getElementById(selectId);
    if (!select) return;

    const matched = columnHeaders.find((header) => {
      const lower = header.toLowerCase();
      return patterns.some((p) => lower.includes(p));
    });

    if (matched) {
      select.value = matched;
      select.style.backgroundColor = "#e8f5e8";
    }
  });
}

// Populate column mapping dropdowns
function populateColumnMappings() {
  const mappingSelects = [
    "cpuMapping",
    "memoryMapping",
    "cpuUtilMapping",
    "memoryUtilMapping",
  ];

  mappingSelects.forEach((selectId) => {
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">Select column...</option>';

    columnHeaders.forEach((header) => {
      const option = document.createElement("option");
      option.value = header;
      option.textContent = header;
      select.appendChild(option);
    });
  });
}

// Check for auto-mapping
function checkAutoMapping() {
  const standardHeaders = {
    "CPU Count": "cpuMapping",
    "Memory (GB)": "memoryMapping",
    "CPU Utilization": "cpuUtilMapping",
    "Memory Utilization": "memoryUtilMapping",
  };

  let autoMapped = 0;
  Object.entries(standardHeaders).forEach(([standardName, selectId]) => {
    const matchingHeader = columnHeaders.find((h) =>
      h.toLowerCase().includes(standardName.toLowerCase().replace(/[()]/g, ""))
    );

    if (matchingHeader) {
      document.getElementById(selectId).value = matchingHeader;
      autoMapped++;
    }
  });

  if (autoMapped > 0) {
    const mappingAlert = document.getElementById("mappingAlert");
    mappingAlert.className = "alert alert-success";
    mappingAlert.innerHTML = `✅ Detected standard CSV format. Auto-mapped ${autoMapped} column headers.`;
    mappingAlert.classList.remove("hidden");
  }
}

// Toggle cloud provider
function toggleCloudProvider(provider) {
  const checkbox = document.getElementById(provider);
  const regionSelection = document.getElementById("regionSelection");

  if (checkbox.checked) {
    selectedProviders.push(provider);
  } else {
    selectedProviders = selectedProviders.filter((p) => p !== provider);
  }

  if (selectedProviders.length > 0) {
    regionSelection.classList.remove("hidden");
    updateRegionControls();
  } else {
    regionSelection.classList.add("hidden");
  }

  updateExcludeControls();
  updateFamilyControls();
}

// Update region controls
// function updateRegionControls() {
//   const regionControls = document.getElementById("regionControls");
//   regionControls.innerHTML = "";

//   selectedProviders.forEach((provider) => {
//     const div = document.createElement("div");
//     div.innerHTML = `
//               <div class="form-group">
//                   <label class="form-label">${provider.toUpperCase()} Region:</label>
//                   <select class="form-control" id="${provider}Region">
//                       <option value="">Select from CSV column</option>
//                       ${regionData[provider]
//                         .map(
//                           (region) =>
//                             `<option value="${region}">${region}</option>`
//                         )
//                         .join("")}
//                   </select>
//               </div>
//           `;
//     regionControls.appendChild(div);
//   });
// }
// function updateRegionControls() {
//   const regionControls = document.getElementById("regionControls");
//   regionControls.innerHTML = "";

//   selectedProviders.forEach((provider) => {
//     const regionSelectId = `${provider}Region`;
//     const regionMappingId = `${provider}RegionMapping`;

//     const div = document.createElement("div");
//     div.innerHTML = `
//         <div class="form-group">
//           <label class="form-label">${provider.toUpperCase()} Region:</label>
//           <select class="form-control" id="${regionSelectId}">
//             <option value="fromCSV">Select from CSV column</option>
//             ${regionData[provider]
//               .map((region) => `<option value="${region}">${region}</option>`)
//               .join("")}
//           </select>
//         </div>

//         <div class="form-group region-mapping" id="${regionMappingId}Wrapper" style="display: none;">
//           <label class="form-label" for="${regionMappingId}">Map ${provider.toUpperCase()} Region Column:</label>
//           <select class="form-control" id="${regionMappingId}">
//             <option value="">Select column...</option>
//           </select>
//         </div>
//       `;

//     regionControls.appendChild(div);

//     // Show mapping dropdown if "fromCSV" is selected
//     setTimeout(() => {
//       const regionSelect = document.getElementById(regionSelectId);
//       const mappingWrapper = document.getElementById(
//         `${regionMappingId}Wrapper`
//       );

//       regionSelect.addEventListener("change", () => {
//         mappingWrapper.style.display =
//           regionSelect.value === "fromCSV" ? "block" : "none";
//       });
//     }, 0);
//   });

//   populateColumnMappings(); // Ensure region dropdowns are filled
// }
function updateRegionControls() {
  const regionControls = document.getElementById("regionControls");
  regionControls.innerHTML = "";

  selectedProviders.forEach((provider) => {
    const regionSelectId = `${provider}Region`;
    const regionMappingId = `${provider}RegionMapping`;

    const div = document.createElement("div");
    div.innerHTML = `
        <div class="form-group">
          <label class="form-label">${provider.toUpperCase()} Region:</label>
          <select class="form-control" id="${regionSelectId}">
            <option value="fromCSV">Select from CSV column</option>
            ${regionData[provider]
              .map((region) => `<option value="${region}">${region}</option>`)
              .join("")}
          </select>
        </div>
  
        <div class="form-group" id="${regionMappingId}Wrapper" style="display: none;">
          <label class="form-label">Map ${provider.toUpperCase()} Region Column:</label>
          <select class="form-control" id="${regionMappingId}">
            <option value="">Select column...</option>
          </select>
        </div>
      `;

    regionControls.appendChild(div);

    // Set up change listener
    setTimeout(() => {
      const regionSelect = document.getElementById(regionSelectId);
      const mappingWrapper = document.getElementById(
        `${regionMappingId}Wrapper`
      );

      regionSelect.addEventListener("change", () => {
        if (regionSelect.value === "fromCSV") {
          mappingWrapper.style.display = "block";
        } else {
          mappingWrapper.style.display = "none";
        }
      });
    }, 0);
  });

  // Ensure headers are available before populating mappings
  setTimeout(() => {
    populateColumnMappings();
    applyRegionAutoMappings(); // new function
  }, 10);
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
  familyControls.innerHTML = "";

  const familyData = {
    aws: ["t3", "m5", "c5", "r5", "m4", "c4", "r4"],
    azure: ["Standard_B", "Standard_D", "Standard_E", "Standard_F"],
    gcp: ["e2", "n1", "n2", "c2", "m1"],
  };

  selectedProviders.forEach((provider) => {
    const div = document.createElement("div");
    div.innerHTML = `
              <div class="form-group">
                  <label class="form-label">${provider.toUpperCase()} Families:</label>
                  <select class="form-control" id="family_${provider}" multiple style="height: 120px;">
                      ${familyData[provider]
                        .map(
                          (family) =>
                            `<option value="${family}">${family}</option>`
                        )
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

  const cpuColumn = document.getElementById("cpuMapping").value;
  const memoryColumn = document.getElementById("memoryMapping").value;

  if (!cpuColumn || !memoryColumn) {
    alert("Please map CPU Count and Memory columns.");
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
  const cpuColumn = document.getElementById("cpuMapping").value;
  const memoryColumn = document.getElementById("memoryMapping").value;
  const cpuUtilColumn = document.getElementById("cpuUtilMapping").value;
  const memoryUtilColumn = document.getElementById("memoryUtilMapping").value;
  const recommendationType = document.querySelector(
    'input[name="recommendationType"]:checked'
  ).value;

  // Process each row
  processedResults = csvData.map((row) => {
    const result = { ...row };

    selectedProviders.forEach((provider) => {
      const cpu = parseInt(row[cpuColumn]) || 0;
      const memory = parseInt(row[memoryColumn]) || 0;
      const cpuUtil = parseFloat(row[cpuUtilColumn]) || 0;
      const memoryUtil = parseFloat(row[memoryUtilColumn]) || 0;

      if (cpu === 0 || memory === 0) {
        result[`${provider.toUpperCase()} Recommendation`] =
          "Data not present in required column";
        return;
      }

      let recommendation = "";

      if (
        recommendationType === "like-to-like" ||
        recommendationType === "both"
      ) {
        const likeToLike = findLikeToLikeRecommendation(provider, cpu, memory);
        recommendation += `Like-to-Like: ${likeToLike}`;
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
          if (recommendation) recommendation += " | ";
          recommendation += `Optimized: ${optimized}`;
        } else {
          if (recommendation) recommendation += " | ";
          recommendation += "Optimized: Utilization data not available";
        }
      }

      result[`${provider.toUpperCase()} Recommendation`] = recommendation;
    });

    return result;
  });

  // Show download section
  document.getElementById("downloadSection").classList.remove("hidden");
}

// Find like-to-like recommendation
function findLikeToLikeRecommendation(provider, cpu, memory) {
  const instances = instanceData[provider];
  const suitable = Object.entries(instances)
    .filter(([name, specs]) => specs.cpu >= cpu && specs.memory >= memory)
    .sort((a, b) => a[1].price - b[1].price);

  return suitable.length > 0 ? suitable[0][0] : "No suitable instance found";
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
      // Downsize CPU
      targetCpu = Math.max(1, Math.ceil(cpu * 0.5));
    } else if (cpuUtil > cpuKeepMax) {
      // Upsize CPU
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
      // Downsize Memory
      targetMemory = Math.max(1, Math.ceil(memory * 0.5));
    } else if (memoryUtil > memoryKeepMax) {
      // Upsize Memory
      targetMemory = Math.ceil(memory * 1.5);
    }
  }

  return findLikeToLikeRecommendation(provider, targetCpu, targetMemory);
}

// Download results
function downloadResults() {
  if (!processedResults) return;

  // Convert to CSV
  const headers = Object.keys(processedResults[0]);
  const csvContent = [
    headers.join(","),
    ...processedResults.map((row) =>
      headers
        .map((header) => {
          const value = row[header] || "";
          return value.includes(",") ? `"${value}"` : value;
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

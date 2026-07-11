// UI shell: page initialization (DOMContentLoaded), sticky generate
// button, section toggles, and accessibility enhancements.

// ─── Sticky floating Generate button ──────────────────────────────────────────
function setupStickyGenerate() {
  const originalBtn = document.querySelector(".generate-btn");
  if (!originalBtn) return;

  const bar = document.createElement("div");
  bar.id = "_stickyGenerateBar";
  bar.innerHTML = `<button class="btn btn-primary" onclick="generateRecommendations()" style="padding:10px 32px;font-size:1rem;box-shadow:0 4px 12px rgba(0,0,0,0.15);">🔄 Generate Recommendations</button>`;
  Object.assign(bar.style, {
    position: "fixed",
    bottom: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "999",
    display: "none",
    pointerEvents: "auto",
  });
  document.body.appendChild(bar);

  const observer = new IntersectionObserver(
    ([entry]) => {
      bar.style.display = entry.isIntersecting ? "none" : "block";
    },
    { threshold: 0.1 },
  );
  observer.observe(originalBtn);
}

document.addEventListener("DOMContentLoaded", function () {
  console.log("Initializing Cloud Instance Recommender with Modular Selectors");

  // Keyboard + screen-reader affordances for interactive elements
  enhanceAccessibility();

  // Sticky floating generate button
  setupStickyGenerate();

  // Start watching for data readiness; auto-fires any queued generate request
  watchForDataThenRun();

  // Load provider-specific data if available
  loadProviderSpecificData();

  // Check if modular selector system is available
  if (typeof InstanceSelectorFactory !== "undefined") {
    console.log("✅ Modular Instance Selector System detected");
    console.log(
      "Supported providers:",
      InstanceSelectorFactory.getSupportedProviders(),
    );
  } else {
    console.warn(
      "⚠️ Modular Instance Selector System not found. Please include the selector files.",
    );
  }

  // Add file upload event handler
  const fileInput = document.getElementById("csvFile");
  if (fileInput) {
    fileInput.addEventListener("change", handleFileUpload);
    setupFileDragAndDrop(fileInput);
  }

  // Initialize range inputs
  updateCpuRanges();
  updateMemoryRanges();

  // Load usage statistics
  loadUsageStatistics();

  // Initialize optimization controls
  toggleOptimizationMode();

  // Initialize ALL provider filter controls
  initializeAllProviderFilters();

  // Initialize recommendation type handlers
  initializeRecommendationTypeHandlers();
});

// Initialize all provider filter controls
function initializeAllProviderFilters() {
  console.log("Initializing all provider filter controls");

  // Initialize AWS filter controls (if AWS-specific functions are available)
  if (typeof initializeAWSFilters !== "undefined") {
    try {
      initializeAWSFilters();
      console.log("✅ AWS filters initialized");
    } catch (error) {
      console.error("❌ Error initializing AWS filters:", error);
    }
  }

  // Initialize Azure filter controls (if Azure-specific functions are available)
  if (typeof initializeAzureFilters !== "undefined") {
    try {
      initializeAzureFilters();
      console.log("✅ Azure filters initialized");
    } catch (error) {
      console.error("❌ Error initializing Azure filters:", error);
    }
  }

  // Initialize GCP filter controls (if GCP-specific functions are available)
  if (typeof initializeGCPFilters !== "undefined") {
    try {
      initializeGCPFilters();
      console.log("✅ GCP filters initialized");
    } catch (error) {
      console.error("❌ Error initializing GCP filters:", error);
    }
  }
}

// Load provider-specific data
function loadProviderSpecificData() {
  // Load AWS data if available
  if (typeof awsExcludeTypesData !== "undefined") {
    excludeTypesData.aws = awsExcludeTypesData;
  }
  if (typeof awsFamilyData !== "undefined") {
    familyData.aws = awsFamilyData;
  }

  // Load Azure data if available
  if (typeof azureExcludeTypesData !== "undefined") {
    excludeTypesData.azure = azureExcludeTypesData;
  }
  if (typeof azureFamilyData !== "undefined") {
    familyData.azure = azureFamilyData;
  }

  // Load GCP data if available
  if (typeof gcpExcludeTypesData !== "undefined") {
    excludeTypesData.gcp = gcpExcludeTypesData;
  }
  if (typeof gcpFamilyData !== "undefined") {
    familyData.gcp = gcpFamilyData;
  }

  console.log("Loaded provider-specific data:", {
    aws: excludeTypesData.aws.length + " exclude types",
    azure: excludeTypesData.azure.length + " exclude types",
    gcp: excludeTypesData.gcp.length + " exclude types",
  });
}

// Initialize recommendation type handlers
function initializeRecommendationTypeHandlers() {
  const recommendationTypeInputs = document.querySelectorAll(
    'input[name="recommendationType"]',
  );
  recommendationTypeInputs.forEach((input) => {
    input.addEventListener("change", handleRecommendationTypeChange);
  });

  // Trigger initial setup
  handleRecommendationTypeChange();
}

// Toggle section collapse
function toggleSection(header) {
  const section = header.parentElement;
  section.classList.toggle("collapsed");
  header.setAttribute(
    "aria-expanded",
    section.classList.contains("collapsed") ? "false" : "true",
  );
}

// Makes the clickable-div section headers keyboard-operable and wires the
// dynamic status areas as live regions. Runs once on DOMContentLoaded.
function enhanceAccessibility() {
  document.querySelectorAll(".section-header[onclick]").forEach((header) => {
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    const section = header.parentElement;
    header.setAttribute(
      "aria-expanded",
      section && section.classList.contains("collapsed") ? "false" : "true",
    );
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        header.click();
      }
    });
  });

  const fileStatus = document.getElementById("fileStatus");
  if (fileStatus) fileStatus.setAttribute("aria-live", "polite");
  const progressText = document.getElementById("progressText");
  if (progressText) progressText.setAttribute("aria-live", "polite");
}

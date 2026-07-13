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

// ─── Back to top ──────────────────────────────────────────────────────────────
// The tool pages run long once results are rendered, and the controls all live
// at the top.
//
// Bottom-LEFT on purpose. The three floating things each own a corner: the
// toast stack is bottom-right, the sticky Generate bar is bottom-centre, and
// toasts (z-index 9999) would otherwise cover this button (998).
function setupBackToTop() {
  if (!document.body) return;

  const button = document.createElement("button");
  button.id = "_backToTop";
  button.type = "button";
  button.setAttribute("aria-label", "Back to top");
  button.title = "Back to top";
  button.textContent = "↑";
  Object.assign(button.style, {
    position: "fixed",
    bottom: "20px",
    left: "20px",
    zIndex: "998",
    display: "none",
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    border: "1px solid var(--border-slate)",
    background: "var(--surface)",
    color: "var(--text-body)",
    fontSize: "1.1rem",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
  });
  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.body.appendChild(button);

  const sync = () => {
    button.style.display = window.scrollY > 400 ? "block" : "none";
  };
  window.addEventListener("scroll", sync, { passive: true });
  sync();
}

document.addEventListener("DOMContentLoaded", function () {
  console.log("Initializing Cloud Instance Recommender with Modular Selectors");

  // Collapse/expand state first, so enhanceAccessibility reads the settled
  // aria-expanded rather than the markup's default
  restoreSectionStates();

  // Keyboard + screen-reader affordances for interactive elements
  enhanceAccessibility();

  // Sticky floating generate button
  setupStickyGenerate();

  // Back-to-top affordance for the long results view
  setupBackToTop();

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

  // The paste control is rendered rather than written into each page, so the
  // four pages cannot drift apart in what it offers
  renderPasteControl();

  // Anything already remembered from a previous visit should be visible on
  // arrival — it will be applied on the next matching upload either way
  renderSavedMappings();

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

// ─── Section collapse state ───────────────────────────────────────────────────
// Sections you rarely touch start collapsed, so the page opens on the parts that
// matter; every section then remembers whatever the user last did with it.
//
// Keyed by `data-section-id` on the header, NOT by its heading text: keying off
// rendered copy means renaming a heading silently discards everyone's saved
// state and quietly stops the default from applying.
const SECTIONS_STORAGE_KEY = "cloudInstanceRecommenderSections";

// The ids of the sections that start collapsed. Only headers carrying
// `onclick="toggleSection(this)"` are collapsible at all — currently the sample
// template and the advanced filters.
const DEFAULT_COLLAPSED_SECTIONS = ["sample-template", "advanced-filters"];

// Falls back to the heading text so a section without an id still persists
// (it just inherits the old fragility).
function sectionKey(header) {
  const id = header.getAttribute && header.getAttribute("data-section-id");
  if (id) return id;
  const title = header.querySelector && header.querySelector(".section-title");
  return title ? title.textContent.replace(/\s+/g, " ").trim() : "";
}

function loadSectionStates() {
  try {
    const all = JSON.parse(localStorage.getItem(SECTIONS_STORAGE_KEY)) || {};
    return safeMapGet(all, currentSourcePage()) || {};
  } catch {
    return {};
  }
}

function saveSectionState(key, collapsed) {
  if (!key) return;
  try {
    const all = JSON.parse(localStorage.getItem(SECTIONS_STORAGE_KEY)) || {};
    const page = currentSourcePage();
    const forPage = safeMapGet(all, page) || {};
    forPage[key] = collapsed ? "collapsed" : "open";
    all[page] = forPage;
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("Could not persist section state:", e);
  }
}

// Applies the remembered state, falling back to the defaults on a first visit.
// A section the user has opened stays open even if it is a default-collapsed one.
function restoreSectionStates() {
  const saved = loadSectionStates();
  document.querySelectorAll(".section-header[onclick]").forEach((header) => {
    const section = header.parentElement;
    if (!section) return;
    const key = sectionKey(header);
    const remembered = key ? saved[key] : undefined;
    const collapsed =
      remembered !== undefined
        ? remembered === "collapsed"
        : DEFAULT_COLLAPSED_SECTIONS.includes(key);

    section.classList.toggle("collapsed", collapsed);
    header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
}

// Toggle section collapse
function toggleSection(header) {
  const section = header.parentElement;
  section.classList.toggle("collapsed");
  const collapsed = section.classList.contains("collapsed");
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  saveSectionState(sectionKey(header), collapsed);
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

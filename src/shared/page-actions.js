// One delegated listener per event type for the tool pages' controls.
// A control names the global function to run in data-on-click or data-on-change.
// Arguments come from data-args, a JSON array, so numbers stay numbers. An object
// marker stands in for a value only the browser knows: {"$":"this"} the element,
// {"$":"value"} its value, {"$":"checked"} its checked state, {"$":"event"} the event.
// A user's text is never an object, so it cannot be mistaken for a marker. The older
// data-this and data-arg forms are still read. data-then runs a second global after
// the first. Inline handler attributes are not used, so the CSP can drop
// 'unsafe-inline' for scripts.
// Applies data-style declarations to a node and its descendants. A MutationObserver
// runs it for every inserted node before the next paint, so no renderer has to call it.
function applyDataStyles(node) {
  if (!node || node.nodeType !== 1) return;
  var targets = node.hasAttribute("data-style") ? [node] : [];
  targets = targets.concat(
    Array.prototype.slice.call(node.querySelectorAll("[data-style]")),
  );
  targets.forEach(function (el) {
    // One malformed value must not leave the rest of the batch unstyled.
    var decls;
    try {
      decls = JSON.parse(el.getAttribute("data-style"));
    } catch (e) {
      return;
    }
    if (!decls || typeof decls !== "object") return;
    Object.keys(decls).forEach(function (k) {
      el.style.setProperty(k, decls[k]);
    });
  });
}

if (typeof MutationObserver === "function") {
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      Array.prototype.forEach.call(r.addedNodes, applyDataStyles);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// The only functions a control may name. A name outside this list is not called, so
// markup that reaches the page unescaped cannot invoke an arbitrary global with
// attacker-chosen arguments. Every name a page or a src/ renderer writes into
// data-on-* or data-then-* is listed; a test derives that set from the markup and the
// source and fails on any difference in either direction (CANONICAL-SOURCES.md).
const PAGE_ACTION_NAMES = new Set([
  "_previewClearColumnFilters",
  "_previewColumnFilterChanged",
  "_previewFilterChanged",
  "_previewGoToPage",
  "_previewSetPageSize",
  "_previewToggleColumn",
  "_previewToggleNoMatch",
  "_sortPreview",
  "_syncSizeUnit",
  "addUserRuleFromForm",
  "applyAppMapping",
  "applyColumnMapping",
  "applyRelaxSuggestion",
  "applySelectedPreset",
  "cancelColumnMapping",
  "cancelSavePreset",
  "checkRuleConflicts",
  "clearScenarios",
  "compareScenarios",
  "confirmSavePreset",
  "convertMemoryToGb",
  "copyPreviewToClipboard",
  "copyTextToClipboard",
  "deleteSelectedPreset",
  "deleteUserRule",
  "disarmPresetButton",
  "dismissToast",
  "downloadAWSBulkTemplate",
  "downloadAWSSampleCSV",
  "downloadAppCsv",
  "downloadAzureSampleCSV",
  "downloadGCPSampleCSV",
  "downloadResultsXlsx",
  "downloadSampleCSV",
  "downloadScenarioComparison",
  "downloadSelectedCsvs",
  "editColumnMapping",
  "exportPortfolioWorkbook",
  "exportPresets",
  "exportUserRules",
  "filterPortfolioApps",
  "forgetAllColumnMappings",
  "forgetColumnMapping",
  "generateRecommendations",
  "handlePresetImportFile",
  "handleRecommendationTypeChange",
  "handleUserRulesImportFile",
  "importPresets",
  "importUserRules",
  "ingestPastedData",
  "keepDuplicateVmNames",
  "keepMemoryAsGb",
  "loadSampleDataset",
  "manualAddVM",
  "manualApplyVMs",
  "manualCancelClear",
  "manualCancelEdit",
  "manualClearVMs",
  "manualConfirmClear",
  "manualEditVM",
  "manualRemoveVM",
  "manualSaveEdit",
  "mergeDuplicateVmNames",
  "onPresetNameKeydown",
  "onPresetSelectChange",
  "onRuleChange",
  "onUtilizationStatisticChange",
  "openAppPortfolio",
  "pinScenarioFromInput",
  "printExecutiveReport",
  "removeScenario",
  "renameScenario",
  "savePresetAs",
  "selectSheet",
  "sortPortfolioApps",
  "switchPortfolioTab",
  "toggleCloudProvider",
  "toggleCsvMenu",
  "toggleCurrentGenerationFilter",
  "toggleExcludeTypes",
  "toggleInstanceFamilyNameFilter",
  "toggleMainFamiliesFilter",
  "toggleManualEntry",
  "toggleOptimizationMode",
  "togglePastePanel",
  "togglePortfolioAppRow",
  "togglePortfolioFilter",
  "toggleProcessorManufacturerFilter",
  "toggleSection",
  "toggleTheme",
  "updateCpuRanges",
  "updateMemoryRanges",
  "updateSelectedPreset",
]);

(function () {
  function resolve(arg, el, event) {
    if (arg !== null && typeof arg === "object" && "$" in arg) {
      if (arg.$ === "this") return el;
      if (arg.$ === "value") return el.value;
      if (arg.$ === "checked") return el.checked;
      if (arg.$ === "event") return event;
    }
    return arg;
  }

  ["click", "change", "input", "keydown", "blur"].forEach(function (type) {
    var attr = "data-on-" + type;
    // blur does not bubble, so it is caught in the capture phase.
    document.addEventListener(
      type,
      /** @param {Event & { key?: string }} event */
      function (event) {
        var target = /** @type {Element | null} */ (event.target);
        var el =
          target && target.closest ? target.closest("[" + attr + "]") : null;
        if (!el) return;
        var sfx = "-" + type;
        if (el.hasAttribute("data-keys" + sfx)) {
          var keys = JSON.parse(
            /** @type {string} */ (el.getAttribute("data-keys" + sfx)),
          );
          if (keys.indexOf(event.key) === -1) return;
        }
        var name = String(el.getAttribute(attr));
        if (!PAGE_ACTION_NAMES.has(name)) {
          console.warn("Action is not registered: " + name);
          return;
        }
        /** @type {Function | undefined} */
        var fn = window[name];
        if (typeof fn !== "function") return;
        if (el.hasAttribute("data-prevent" + sfx)) event.preventDefault();
        if (el.hasAttribute("data-stop" + sfx)) event.stopPropagation();
        if (el.hasAttribute("data-args" + sfx)) {
          var list = JSON.parse(
            /** @type {string} */ (el.getAttribute("data-args" + sfx)),
          );
          fn.apply(
            el,
            list.map(function (a) {
              return resolve(a, el, event);
            }),
          );
        } else if (el.hasAttribute("data-this")) fn.call(el, el);
        else if (el.hasAttribute("data-arg"))
          fn.call(el, el.getAttribute("data-arg"));
        else fn.call(el);
        var then = el.getAttribute("data-then" + sfx);
        if (
          then &&
          PAGE_ACTION_NAMES.has(then) &&
          typeof window[then] === "function"
        )
          window[then]();
      },
      type === "blur",
    );
  });
})();

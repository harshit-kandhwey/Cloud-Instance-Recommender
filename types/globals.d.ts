// Ambient declarations for this project's "module system": modules are plain
// classic scripts that share one global scope and hang their public surface off
// `window` (and off `self` inside the worker). tsc can't infer those cross-file
// globals, so declare the ones that `// @ts-check`ed modules read or assign here.
// Add an entry when a newly type-checked module needs a global that isn't listed.

export {};

declare global {
  interface Window {
    /** ENV/OS/Workload/Compliance/MinGen rule engine (js/base/rule-engine.js). */
    RuleEngine: {
      apply: Function;
      getPreferredFamilies: Function;
      isBurstable: Function;
      isCurrentGen: Function;
      isARM: Function;
      meetsMinGeneration: Function;
    };
  }
}

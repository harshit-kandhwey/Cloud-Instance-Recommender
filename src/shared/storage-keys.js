// Every localStorage key the app owns. Loads before any module that reads a key at
// top level, so every key string lives here and nowhere else in src/.
const STORAGE_KEYS = Object.freeze({
  appMap: "cloudInstanceRecommenderAppMap",
  columnMaps: "cloudInstanceRecommenderColumnMaps",
  filterPresets: "cloudInstanceRecommenderFilterPresets",
  fleetSnapshots: "cloudInstanceRecommenderFleetSnapshots",
  manualVMs: "cloudInstanceRecommenderManualVMs",
  portfolioData: "cloudInstanceRecommenderPortfolioData",
  sections: "cloudInstanceRecommenderSections",
  sizingPolicies: "cloudInstanceRecommenderSizingPolicies",
  stats: "cloudInstanceRecommenderStats",
  theme: "cloudInstanceRecommenderTheme",
  userRules: "cloudInstanceRecommenderUserRules",
});

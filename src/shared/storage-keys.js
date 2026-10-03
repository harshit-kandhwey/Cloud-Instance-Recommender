// Every localStorage key the app owns. Loads before any module that reads a key at
// top level, so every key string lives here and nowhere else in src/.
const STORAGE_KEYS = Object.freeze({
  appMap: "cloudInstanceRecommenderAppMap",
  columnMaps: "cloudInstanceRecommenderColumnMaps",
  filterPresets: "cloudInstanceRecommenderFilterPresets",
  manualVMs: "cloudInstanceRecommenderManualVMs",
  portfolioData: "cloudInstanceRecommenderPortfolioData",
  sections: "cloudInstanceRecommenderSections",
  stats: "cloudInstanceRecommenderStats",
  userRules: "cloudInstanceRecommenderUserRules",
});

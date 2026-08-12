// Web Worker: runs recommendation generation off the main thread so large
// CSVs don't freeze the UI. Code files are pulled in via importScripts
// (same-origin, CSP-compatible); region DATA arrives via postMessage because
// the CSP blocks fetch/XHR and region files are only injectable as <script>
// tags on the main thread.
//
// Message in : { type: "run", csvData, providers, options, regionData, flags }
// Messages out: { type: "progress", done, total }
//               { type: "result", results }
//               { type: "error", message }

// The selector/factory files expect a `window` global
self.window = self;

importScripts(
  "rule-engine.js",
  "user-rules.js",
  "base-instance-selector.js",
  "../aws/aws-instance-selector.js",
  "../azure/azure-instance-selector.js",
  "../gcp/gcp-instance-selector.js",
  "instance-selector-factory.js",
);

self.onmessage = async function (event) {
  const msg = event.data;
  if (!msg || msg.type !== "run") return;

  try {
    // Region globals (window.us_east_1 = {...}) and readiness flags
    // ({P}_DATA_READY / {P}_REGION_KEYS / {P}_DATA_DATE), as collected on
    // the main thread. Any region missing here falls back to sample data —
    // the main thread is responsible for sending everything resolvable.
    Object.entries(msg.regionData || {}).forEach(([key, data]) => {
      self[key] = data;
    });
    Object.entries(msg.flags || {}).forEach(([key, value]) => {
      self[key] = value;
    });

    const results = await self.getInstanceRecommendationWithSelector(
      msg.csvData,
      msg.providers,
      msg.options,
      {
        yieldEvery: 25,
        onProgress: (done, total) =>
          self.postMessage({ type: "progress", done, total }),
      },
    );

    self.postMessage({ type: "result", results });
  } catch (err) {
    self.postMessage({
      type: "error",
      message: String((err && err.message) || err),
    });
  }
};

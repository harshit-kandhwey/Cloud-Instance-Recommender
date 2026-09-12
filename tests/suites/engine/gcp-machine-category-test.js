// getMachineTypeCategory: classifies a GCP instance type name into standard /
// highmem / highcpu / shared-core for the machine-category filter and the
// portfolio's category breakdown stats. Specific categories must win over the
// generic "standard" test — several real shapes (z3-highmem-*-standardlssd)
// contain "standard" only as a substring of their storage suffix, not as
// their actual category.
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx, run } = buildEngineContext({
  scripts: [
    "src/core/rules/rule-engine.js",
    "src/core/engine/base-instance-selector.js",
    "src/providers/gcp/gcp-instance-selector.js",
  ],
  label: "gcp-machine-category",
});
run(`__gcp = new GCPInstanceSelector();`);
const category = (t) =>
  run(`__gcp.getMachineTypeCategory(${JSON.stringify(t)})`);

check(
  "an ordinary standard shape stays standard",
  category("n2-standard-4") === "standard",
  category("n2-standard-4"),
);
check(
  "a highmem shape is highmem",
  category("n2-highmem-4") === "highmem",
  category("n2-highmem-4"),
);
check(
  "a highcpu shape is highcpu",
  category("n2-highcpu-4") === "highcpu",
  category("n2-highcpu-4"),
);
check(
  "a highmem shape whose name ALSO contains the substring 'standard' (a real GCP shape) is still highmem, not standard",
  category("z3-highmem-14-standardlssd") === "highmem",
  category("z3-highmem-14-standardlssd"),
);
check(
  "a micro/small shape is shared-core",
  category("e2-micro") === "shared-core" &&
    category("f1-small") === "shared-core",
  `${category("e2-micro")}, ${category("f1-small")}`,
);

console.log(
  state.failures === 0
    ? "gcp-machine-category: all checks passed"
    : `gcp-machine-category: ${state.failures} check(s) FAILED`,
);
// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

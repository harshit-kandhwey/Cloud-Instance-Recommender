// Each provider turns a region cell from the uploaded file into a global name.
// Azure looks the display name up in a table; on a plain object a cell reading
// "constructor" resolved to an inherited function, not a region name.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx, run } = buildContext();
const norm = (cls, region) => {
  ctx.__region = region;
  return run(`new ${cls}().normalizeRegionForJS(__region)`);
};

console.log("[Azure]");
check(
  "a display name maps through the table",
  norm("AzureInstanceSelector", "East US 2") === "eastus2",
);
check(
  "an unlisted name is lower-cased and stripped of spaces and dashes",
  norm("AzureInstanceSelector", "Some-New Region") === "somenewregion",
);
for (const hostile of [
  "constructor",
  "toString",
  "hasOwnProperty",
  "__proto__",
]) {
  const out = norm("AzureInstanceSelector", hostile);
  check(
    `"${hostile}" stays a string`,
    typeof out === "string" && out === hostile.toLowerCase(),
    String(out),
  );
}

console.log("[AWS and GCP]");
check(
  "AWS swaps dashes for underscores",
  norm("AWSInstanceSelector", "us-east-1") === "us_east_1",
);
check(
  "GCP strips a zone suffix",
  norm("GCPInstanceSelector", "us-central1-a") === "us_central1",
);
check(
  "GCP keeps a numeric region suffix",
  norm("GCPInstanceSelector", "europe-west10") === "europe_west10",
);

if (state.failures) {
  console.error(`\nprovider-region-names: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nprovider-region-names: all checks passed");
  process.exitCode = 0;
}

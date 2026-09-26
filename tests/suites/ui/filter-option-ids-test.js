// A filter checkbox is identified by its VALUE, not its position in the list.
// Presets and the scenario diff refer to a checkbox by its id, and the option
// lists change as the data does: a positional id ("processor_1") re-points a
// saved preset at a different option the day one is added mid-list, and two
// values that slug to one id would leave one checkbox unreachable. This drives
// each provider's real initialize*Filters() and reads back what it rendered.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

console.log("[filterOptionId keys an id on the option's value]");
{
  const { ctx } = buildContext();
  const id = (prefix, value) =>
    vm.runInContext(
      `filterOptionId(${JSON.stringify(prefix)}, ${JSON.stringify(value)})`,
      ctx,
    );
  check(
    "lower-cases the value",
    id("processor_", "Intel") === "processor_intel",
  );
  check(
    "a run of non-alphanumerics becomes one underscore",
    id("gcpType_", "shared-core") === "gcpType_shared_core" &&
      id("x_", "a  b--c") === "x_a_b_c",
    `${id("gcpType_", "shared-core")} ${id("x_", "a  b--c")}`,
  );
  check(
    "the id does not depend on where the option sits in a list",
    id("azureSeries_", "Dsv5") === id("azureSeries_", "Dsv5") &&
      !/\d$/.test(id("azureSeries_", "Dsv")),
  );
  check(
    "a non-string value is read as text",
    id("p_", 7) === "p_7",
    id("p_", 7),
  );
}

const PROVIDERS = [
  {
    name: "AWS",
    file: "src/providers/aws/aws-specific.js",
    init: "initializeAWSFilters",
    lists: [
      [
        "processorCheckboxes",
        "processor_",
        "awsFilterData.processorManufacturers",
      ],
      ["mainFamiliesCheckboxes", "mainFamily_", "awsFilterData.mainFamilies"],
    ],
  },
  {
    name: "Azure",
    file: "src/providers/azure/azure-specific.js",
    init: "initializeAzureFilters",
    lists: [
      [
        "seriesCheckboxes",
        "azureSeries_",
        "azureAdvancedFilterData.instanceSeries",
      ],
      [
        "processorCheckboxes",
        "azureProcessor_",
        "azureAdvancedFilterData.processorArchitectures",
      ],
      [
        "mainFamiliesCheckboxes",
        "azureFamily_",
        "azureAdvancedFilterData.vmFamilies",
      ],
    ],
  },
  {
    name: "GCP",
    file: "src/providers/gcp/gcp-specific.js",
    init: "initializeGCPFilters",
    lists: [
      [
        "seriesCheckboxes",
        "gcpFamily_",
        "gcpAdvancedFilterData.machineFamilies",
      ],
      [
        "processorCheckboxes",
        "gcpProcessor_",
        "gcpAdvancedFilterData.processorPlatforms",
      ],
      [
        "mainFamiliesCheckboxes",
        "gcpType_",
        "gcpAdvancedFilterData.machineTypes",
      ],
    ],
  },
];

for (const p of PROVIDERS) {
  console.log(
    `[${p.name}: every rendered checkbox id is value-keyed and unique]`,
  );
  const { ctx } = buildContext();
  vm.runInContext(fs.readFileSync(path.join(REPO, p.file), "utf8"), ctx, {
    filename: p.file,
  });

  // Capture what each container is given; the harness element ignores appendChild.
  const rendered = {};
  const realGet = ctx.document.getElementById;
  ctx.document.getElementById = (elId) => {
    if (!p.lists.some((l) => l[0] === elId)) return realGet(elId);
    return (rendered[elId] ||= {
      id: elId,
      children: [],
      appendChild(div) {
        this.children.push(div.innerHTML);
      },
    });
  };
  // The family-name panel is built separately (and needs a richer DOM than the
  // harness has); only the provider's own option lists are under test here.
  vm.runInContext("initializeInstanceFamilyNameFilter = function () {};", ctx);
  vm.runInContext(`${p.init}()`, ctx);

  for (const [container, prefix, dataExpr] of p.lists) {
    const values = vm.runInContext(dataExpr, ctx);
    const html = (rendered[container] || { children: [] }).children;
    const boxes = html.map((h) => ({
      id: (/<input type="checkbox" id="([^"]+)"/.exec(h) || [])[1],
      value: (/ value="([^"]*)"/.exec(h) || [])[1],
      forId: (/<label for="([^"]+)"/.exec(h) || [])[1],
    }));
    check(
      `${p.name} ${prefix}: one checkbox per option (${values.length})`,
      boxes.length === values.length && values.length > 0,
      `rendered ${boxes.length} of ${values.length}`,
    );
    check(
      `${p.name} ${prefix}: each id is the value's own id, in any order`,
      boxes.every(
        (b, i) =>
          b.value === values[i] &&
          b.id ===
            vm.runInContext(
              `filterOptionId(${JSON.stringify(prefix)}, ${JSON.stringify(values[i])})`,
              ctx,
            ),
      ),
      JSON.stringify(boxes.slice(0, 3)),
    );
    check(
      `${p.name} ${prefix}: no id ends in a list position`,
      boxes.every((b) => !/_\d+$/.test(b.id) || /\d/.test(b.value)),
      JSON.stringify(boxes.filter((b) => /_\d+$/.test(b.id)).slice(0, 3)),
    );
    check(
      `${p.name} ${prefix}: ids are unique, so no option is unreachable`,
      new Set(boxes.map((b) => b.id)).size === boxes.length,
      JSON.stringify(
        boxes.map((b) => b.id).filter((x, i, a) => a.indexOf(x) !== i),
      ),
    );
    check(
      `${p.name} ${prefix}: each label points at its own checkbox`,
      boxes.every((b) => b.forId === b.id),
    );
  }
}

if (state.failures) {
  console.error(`\nfilter-option-ids: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nfilter-option-ids: all checks passed");
  process.exitCode = 0;
}

// hostile-values suite: text from an uploaded cell is a key, never a member name.
// A table indexed by a cell read on a plain object resolves "constructor" and
// "__proto__" to an inherited member instead of a miss, so a Workload of
// "constructor" failed every such row with "preferred.some is not a function" and a
// Region of "constructor" threw out of the region lookup. Covered: every cell the
// engine uses to index a table (Workload, ENV, OS, Compliance, Criticality, Region)
// with each inherited member name, through the real factory and the real selector,
// plus the rule-engine lookup on its own. A row with such a cell must be sized like
// any row with an unrecognised value: no throw, no "Error" result.
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const ENGINE_SCRIPTS = [
  "src/shared/storage-keys.js",
  "src/core/rules/rule-engine.js",
  "src/core/engine/base-instance-selector.js",
  "src/providers/aws/aws-instance-selector.js",
  "src/core/engine/instance-selector-factory.js",
];

const HOSTILE = [
  "constructor",
  "__proto__",
  "toString",
  "hasOwnProperty",
  "valueOf",
];

(async () => {
  // ── the rule-engine lookup alone ────────────────────────────────────────────────
  {
    const { run } = buildEngineContext({
      scripts: ["src/core/rules/rule-engine.js"],
      label: "hostile-values-rules",
    });
    for (const wl of HOSTILE) {
      check(
        `getPreferredFamilies(${JSON.stringify(wl)}) is a list`,
        run(
          `Array.isArray(RuleEngine.getPreferredFamilies(${JSON.stringify(wl)}, "aws"))`,
        ) === true,
      );
    }
    check(
      "an unknown workload falls back to the general list",
      JSON.stringify(
        run(`RuleEngine.getPreferredFamilies("nonsense", "aws")`),
      ) ===
        JSON.stringify(
          run(`RuleEngine.getPreferredFamilies("general", "aws")`),
        ),
    );
    check(
      "a real workload still resolves to its own list",
      JSON.stringify(
        run(`RuleEngine.getPreferredFamilies("Database", "aws")`),
      ) !==
        JSON.stringify(
          run(`RuleEngine.getPreferredFamilies("general", "aws")`),
        ),
    );
  }

  // ── through the real selector and factory ───────────────────────────────────────
  const { ctx, run } = buildEngineContext({
    scripts: ENGINE_SCRIPTS,
    label: "hostile-values-run",
  });
  run(`
    __sel = new AWSInstanceSelector();
    __sel.instanceData = { "us-east-1": [
      { instanceType: "m5.large", vCpus: 2, memory: 8, price: 0.1, family: "m5", familyName: "General purpose", processor: "Intel", generation: 1, isGraviton: 0 },
      { instanceType: "c5.large", vCpus: 2, memory: 8, price: 0.12, family: "c5", familyName: "Compute optimized", processor: "Intel", generation: 1, isGraviton: 0 },
    ] };
    __sel.initialize = async function () {};
    window._prewarmedSelectors = { aws: __sel };
  `);
  const base = {
    "VM Name": "vm1",
    "CPU Count": "2",
    "Memory (GB)": "8",
    "AWS Region": "us-east-1",
  };
  async function sized(overrides) {
    ctx.rows = [{ ...base, ...overrides }];
    ctx.opts = { generateLikeToLike: true, generateOptimized: true };
    try {
      const out = await run(
        `window.getInstanceRecommendationWithSelector(rows, ["aws"], opts)`,
      );
      return { row: out[0] };
    } catch (e) {
      return { thrown: String(e && e.message) };
    }
  }
  const isError = (r) =>
    r.thrown !== undefined ||
    String(r.row["AWS Like-to-Like Instance"]) === "Error" ||
    String(r.row["AWS Optimized Instance"]) === "Error" ||
    String(r.row["AWS No Match Reason"] || "").startsWith("Error");

  check(
    "control: an ordinary row sizes",
    !isError(await sized({ Workload: "Database" })) &&
      (await sized({})).row["AWS Like-to-Like Instance"] === "m5.large",
  );

  for (const column of [
    "Workload",
    "ENV",
    "OS",
    "Compliance",
    "Criticality",
    "AWS Region",
  ]) {
    const failures = [];
    for (const value of HOSTILE) {
      const r = await sized({ [column]: value });
      if (isError(r)) {
        failures.push(
          `${value}: ${r.thrown || r.row["AWS No Match Reason"] || "Error"}`,
        );
      }
    }
    check(
      `a ${column} cell of each inherited member name sizes like an unrecognised value`,
      failures.length === 0,
      failures.join(" | "),
    );
  }

  // ── region tables written under a region name ────────────────────────────────────
  {
    const sel = run(`(() => {
      const s = new AWSInstanceSelector();
      s._setRegionData("__proto__", [{ instanceType: "x" }]);
      s._setRegionData("constructor", [{ instanceType: "y" }]);
      return s;
    })()`);
    ctx.__s = sel;
    check(
      'a region named "__proto__" is stored as a key, not as the table prototype',
      run(
        `Object.getPrototypeOf(__s.instanceData) === Object.prototype && Object.prototype.hasOwnProperty.call(__s.instanceData, "__proto__")`,
      ) === true,
    );
    check(
      'a region named "constructor" is stored as an own key',
      run(
        `Object.prototype.hasOwnProperty.call(__s.instanceData, "constructor") && Array.isArray(__s.instanceData.constructor)`,
      ) === true,
    );
    const loader = run(
      "AWSInstanceSelector.prototype.loadRegionData.toString()",
    );
    check(
      "both the loaded and the fallback region go through that write, never an assignment",
      loader.split("_setRegionData(").length - 1 === 2 &&
        !/instanceData\[region\]\s*=/.test(loader),
      loader.slice(0, 120),
    );
  }

  // ── the file-status label is text ────────────────────────────────────────────────
  {
    const { buildContext } = require("../harness");
    const { run: page, elements } = buildContext();
    page(`window._ingestLabel = "<img src=x onerror=alert(1)>"`);
    page(
      `applyIngest(["CPU Count", "Memory (GB)"], [{ "CPU Count": "2", "Memory (GB)": "4" }], {})`,
    );
    const html = elements.fileStatus ? elements.fileStatus.innerHTML : "";
    check(
      "the status shows the label",
      html.includes("rows") && html.includes("&lt;img"),
      html.slice(0, 200),
    );
    check(
      "and no raw tag from the label reaches the status",
      !html.includes("<img"),
    );
  }

  // ── keys written back to storage (F-13) ─────────────────────────────────────────
  {
    const { buildContext } = require("../harness");
    const { run: page, store } = buildContext();
    page(`saveColumnMapping("__proto__", { "VM Name": "VM Name" }, {})`);
    const raw = store.get("cloudInstanceRecommenderColumnMaps");
    let parsed = null;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {}
    check(
      'a file whose header signature is "__proto__" is remembered under that key',
      parsed !== null &&
        Object.prototype.hasOwnProperty.call(parsed, "__proto__"),
      String(raw),
    );
    check(
      "setOwnKey writes an own key even for a prototype name",
      page(
        `(() => { const o = {}; setOwnKey(o, "__proto__", 1); setOwnKey(o, "constructor", 2); return Object.prototype.hasOwnProperty.call(o, "__proto__") && Object.prototype.hasOwnProperty.call(o, "constructor") && Object.getPrototypeOf(o) === Object.prototype; })()`,
      ) === true,
    );
    check(
      "the app-mapping save goes through the same own-key write",
      page("applyAppMapping.toString()").includes("setOwnKey("),
    );
  }

  if (state.failures) {
    console.error(`\nhostile-values: ${state.failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\nhostile-values: all checks passed");
    process.exitCode = 0;
  }
})();

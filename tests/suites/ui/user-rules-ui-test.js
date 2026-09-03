// User-defined rules — the authoring UI (user-rules-ui.js). Drives the panel the
// way a user would: render it, fill the add-form, Add, then Delete — asserting
// each step persists through the real storage (saveUserRules/loadUserRules) and
// re-renders. The model/evaluator/factory are covered by engine/user-rules-test.js;
// this covers the DOM surface those tests do not touch.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx, run, elements, downloads } = buildContext();

// handleUserRulesImportFile creates a FileReader and reads reader.result. The
// harness FileReader passes the text via the event arg instead, so override it
// with a synchronous stub that sets result (the same one presets-test uses) —
// this also lets the value-reset line right after readAsText be observed at once.
ctx.FileReader = class {
  readAsText(file) {
    const t = file && typeof file.text === "function" ? file.text() : "";
    this.result = t;
    if (this.onload) this.onload({ target: { result: t } });
  }
};

const panel = () => elements.userRulesPanel.innerHTML;
// Set an <input>/<select> value the way the form reads it.
const setField = (id, value) => {
  ctx.document.getElementById(id).value = value;
};

console.log("[the panel renders empty, with the add-form]");
{
  ctx.renderUserRulesPanel();
  check("the empty-state line is shown", /No custom rules yet/.test(panel()));
  check(
    "the add-form fields are present",
    ["urDimension", "urEquals", "urAction", "urTokens"].every((id) =>
      panel().includes(`id="${id}"`),
    ),
    panel(),
  );

  // The dropdowns are DERIVED from user-rules.js's own canonical arrays, not a
  // second, independent copy — the shape of the bug found and fixed in 3.15
  // (this exact file used to hand-list ["workload","env","os","compliance"]
  // and ["exclude","includeOnly"] literally, so a dimension or action added to
  // USER_RULE_DIMENSIONS/USER_RULE_ACTIONS would never have reached this UI).
  // Assert every canonical value has an <option>, not the reverse, so this
  // still passes if a future value's label formatting changes.
  const dims = run("USER_RULE_DIMENSIONS");
  const actions = run("USER_RULE_ACTIONS");
  check(
    "every USER_RULE_DIMENSIONS value has a dropdown option",
    dims.every((d) => panel().includes(`<option value="${d}">`)),
    JSON.stringify(dims),
  );
  check(
    "every USER_RULE_ACTIONS value has a dropdown option",
    actions.every((a) => panel().includes(`<option value="${a}">`)),
    JSON.stringify(actions),
  );
}

console.log("[Add persists a valid rule and lists it]");
{
  setField("urDimension", "workload");
  setField("urEquals", "database");
  setField("urAction", "includeOnly");
  setField("urTokens", "r5, r6");
  ctx.addUserRuleFromForm();

  const stored = ctx.loadUserRules();
  check(
    "the rule is stored, normalised",
    stored.length === 1 &&
      stored[0].dimension === "workload" &&
      stored[0].action === "includeOnly" &&
      stored[0].tokens.join(",") === "r5,r6",
    JSON.stringify(stored),
  );
  check(
    "the panel now lists the rule in words",
    /User: Workload=database → include only r5, r6/.test(panel()),
    panel(),
  );
  check(
    "a confirmation is shown",
    /Added —/.test(elements.userRulesStatus.textContent || ""),
    elements.userRulesStatus.textContent,
  );
}

console.log("[an invalid rule is refused, with a message, and nothing stored]");
{
  const before = ctx.loadUserRules().length;
  setField("urDimension", "env");
  setField("urEquals", "production");
  setField("urAction", "exclude");
  setField("urTokens", "   "); // no tokens
  ctx.addUserRuleFromForm();
  check(
    "no rule was added",
    ctx.loadUserRules().length === before,
    JSON.stringify(ctx.loadUserRules()),
  );
  check(
    "the form reports why",
    /at least one family or type/.test(
      elements.userRulesStatus.textContent || "",
    ),
    elements.userRulesStatus.textContent,
  );
}

console.log("[Delete removes the rule by id and re-renders]");
{
  const id = ctx.loadUserRules()[0].id;
  ctx.deleteUserRule(id);
  check("storage is now empty", ctx.loadUserRules().length === 0);
  check(
    "the panel returns to the empty state",
    /No custom rules yet/.test(panel()),
    panel(),
  );
}

console.log("[the panel offers export and import controls]");
{
  ctx.renderUserRulesPanel();
  check(
    "export and import buttons are present",
    /exportUserRules\(\)/.test(panel()) && /importUserRules\(\)/.test(panel()),
    panel(),
  );
  check(
    "the hidden import file input is present",
    /id="userRulesImportInput"/.test(panel()),
    panel(),
  );
}

console.log("[validateUserRulesImport gates the payload]");
{
  const good = ctx.buildUserRulesExport("aws", [
    { dimension: "env", equals: "prod", action: "exclude", tokens: ["t3"] },
  ]);
  check(
    "a well-formed export validates and normalises its rules",
    ctx.validateUserRulesImport(good).ok === true &&
      ctx.validateUserRulesImport(good).rules.length === 1,
    JSON.stringify(ctx.validateUserRulesImport(good)),
  );
  check(
    "a non-object payload is refused",
    ctx.validateUserRulesImport([1, 2, 3]).ok === false,
  );
  check(
    "a payload without a rules array is refused",
    ctx.validateUserRulesImport({ page: "aws" }).ok === false,
  );
  check(
    "a payload whose rules are all malformed is refused",
    ctx.validateUserRulesImport({ rules: [null, { dimension: "nope" }] }).ok ===
      false,
  );
}

console.log("[mergeImportedUserRules dedups by meaning and re-ids]");
{
  const existing = [
    {
      id: "keep-1",
      dimension: "env",
      equals: "prod",
      action: "exclude",
      tokens: ["t3"],
    },
  ];
  const imported = [
    // Same meaning as the existing rule (different case/id) — must be skipped.
    {
      id: "dup",
      dimension: "env",
      equals: "PROD",
      action: "exclude",
      tokens: ["T3"],
    },
    // Genuinely new — must be added.
    {
      id: "keep-1",
      dimension: "workload",
      equals: "database",
      action: "includeOnly",
      tokens: ["r5"],
    },
  ]
    .map(ctx.normalizeUserRule)
    .filter(Boolean);
  const { merged, added, skipped } = ctx.mergeImportedUserRules(
    existing,
    imported,
  );
  check(
    "the duplicate is skipped and the new rule is added",
    added === 1 && skipped === 1 && merged.length === 2,
    JSON.stringify({ added, skipped, len: merged.length }),
  );
  check(
    "the appended rule got a fresh id, not the colliding imported one",
    merged[1].id !== "keep-1" && merged[0].id === "keep-1",
    JSON.stringify(merged.map((r) => r.id)),
  );
}

console.log("[import round-trips through storage and re-renders the panel]");
{
  ctx.saveUserRules([]);
  const payloadText = JSON.stringify(
    ctx.buildUserRulesExport("aws", [
      {
        dimension: "workload",
        equals: "cache",
        action: "includeOnly",
        tokens: ["r6"],
      },
    ]),
  );
  ctx.applyUserRulesImportText(payloadText);
  check(
    "the imported rule is now in storage",
    ctx.loadUserRules().length === 1 &&
      ctx.loadUserRules()[0].tokens.join(",") === "r6",
    JSON.stringify(ctx.loadUserRules()),
  );
  check(
    "the panel lists the imported rule",
    /User: Workload=cache → include only r6/.test(panel()),
    panel(),
  );
  check(
    "importing the same file again adds nothing (dedup)",
    (ctx.applyUserRulesImportText(payloadText), ctx.loadUserRules().length) ===
      1,
    JSON.stringify(ctx.loadUserRules()),
  );
  check(
    "an invalid import reports why and leaves storage untouched",
    (ctx.applyUserRulesImportText("{ not json"),
    ctx.loadUserRules().length === 1 &&
      /Import failed/.test(elements.userRulesStatus.textContent || "")),
    elements.userRulesStatus.textContent,
  );
}

console.log("[exportUserRules writes a JSON download of this page's rules]");
{
  ctx.saveUserRules([
    { dimension: "env", equals: "prod", action: "exclude", tokens: ["t3"] },
  ]);
  const before = downloads.length;
  ctx.exportUserRules();
  const dl = downloads[downloads.length - 1];
  check(
    "a download was produced with a custom_rules_*.json name",
    downloads.length === before + 1 && /custom_rules_.*\.json$/.test(dl.name),
    dl && dl.name,
  );
  let parsed = null;
  try {
    parsed = JSON.parse(dl.blob.content);
  } catch {
    /* leaves parsed null → the check below fails with the raw content */
  }
  check(
    "the file carries the stored rule under a rules array",
    parsed &&
      Array.isArray(parsed.rules) &&
      parsed.rules.length === 1 &&
      parsed.rules[0].tokens.join(",") === "t3",
    dl && dl.blob && dl.blob.content,
  );
}

// handleUserRulesImportFile is the FileReader wrapper the picker fires; driven
// with a fake event + the synchronous FileReader stub above. (importUserRules,
// the raw input.click() picker trigger, is browser-only and is waived like
// importPresets; every parse/merge/apply path it leads to is covered above.)
console.log("[handleUserRulesImportFile reads a file end to end]");
{
  ctx.saveUserRules([]);
  const payloadText = JSON.stringify(
    ctx.buildUserRulesExport("aws", [
      {
        dimension: "workload",
        equals: "batch",
        action: "exclude",
        tokens: ["t3"],
      },
    ]),
  );
  const ev = {
    target: {
      files: [{ text: () => payloadText }],
      value: "C:/fake/rules.json",
    },
  };
  ctx.handleUserRulesImportFile(ev);
  check(
    "the file's rule was imported through the reader wrapper",
    ctx.loadUserRules().length === 1 &&
      ctx.loadUserRules()[0].equals === "batch",
    JSON.stringify(ctx.loadUserRules()),
  );
  check(
    "the input value is reset so the same file re-fires change",
    ev.target.value === "",
    ev.target.value,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

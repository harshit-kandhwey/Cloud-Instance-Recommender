// User-defined rules — the authoring UI (user-rules-ui.js). Drives the panel the
// way a user would: render it, fill the add-form, Add, then Delete — asserting
// each step persists through the real storage (saveUserRules/loadUserRules) and
// re-renders. The model/evaluator/factory are covered by engine/user-rules-test.js;
// this covers the DOM surface those tests do not touch.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx, elements } = buildContext();

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

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;

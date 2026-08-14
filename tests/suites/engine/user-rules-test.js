// User-defined rules (user-rules.js + instance-selector-factory.js): conditional
// per-row filters the user authors ("if Workload = database, Include Only r5").
// Three layers:
//   - the model: normalizeUserRule validates/normalises; bad rules become null;
//   - the evaluator: evaluateUserRules matches a row's dimensions and returns the
//     Exclude / Include Only tokens plus the labels of the rules that fired;
//   - storage: saveUserRules / loadUserRules round-trip (normalised) per page;
//   - the factory: a fired rule actually steers the recommendation and is named
//     in the Rules Applied column (goldens carry no rules, so this is the guard
//     on that wiring).
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { ctx, run } = buildContext();

// ── The model: normalizeUserRule ────────────────────────────────────────────
console.log(
  "[normalizeUserRule accepts the good and rejects the untrustworthy]",
);
{
  const norm = (r) => ctx.normalizeUserRule(r);
  check(
    "a well-formed rule normalises",
    !!norm({
      dimension: "workload",
      equals: "database",
      action: "exclude",
      tokens: ["m5"],
    }),
  );
  check(
    "an unknown dimension is rejected",
    norm({
      dimension: "region",
      equals: "x",
      action: "exclude",
      tokens: ["m5"],
    }) === null,
  );
  check(
    "an unknown action is rejected",
    norm({
      dimension: "env",
      equals: "prod",
      action: "prefer",
      tokens: ["m5"],
    }) === null,
  );
  check(
    "a blank equals is rejected",
    norm({
      dimension: "env",
      equals: "  ",
      action: "exclude",
      tokens: ["m5"],
    }) === null,
  );
  check(
    "an empty token list is rejected",
    norm({
      dimension: "env",
      equals: "prod",
      action: "exclude",
      tokens: [],
    }) === null,
  );
  check(
    "a comma string of tokens is split into a list",
    norm({
      dimension: "env",
      equals: "prod",
      action: "exclude",
      tokens: "m5, c5",
    })?.tokens.join("|") === "m5|c5",
  );
  check(
    "a pipe in equals is stripped so it can't break the Rules Applied column",
    norm({
      dimension: "env",
      equals: "pr|od",
      action: "exclude",
      tokens: ["m5"],
    })?.equals === "pr od",
  );
  check(
    "a missing id is assigned one",
    !!norm({
      dimension: "env",
      equals: "prod",
      action: "exclude",
      tokens: ["m5"],
    })?.id,
  );
  // Security: the id is rendered into an inline onclick="deleteUserRule('<id>')"
  // handler, where HTML-escaping does not protect the nested JS-string context.
  // An imported rule with a crafted id (quotes, parens, slashes) must be stripped
  // to a safe charset at the model gate, or it breaks out of the string literal.
  {
    const evil = norm({
      id: "');alert(document.cookie)//",
      dimension: "env",
      equals: "prod",
      action: "exclude",
      tokens: ["m5"],
    });
    check(
      "a crafted id is stripped to a safe charset (no quote/paren/slash/space)",
      !!evil && /^[A-Za-z0-9_-]+$/.test(evil.id),
      evil && JSON.stringify(evil.id),
    );
    check(
      "a normal hyphenated id is preserved unchanged",
      norm({
        id: "ur-abc-123",
        dimension: "env",
        equals: "prod",
        action: "exclude",
        tokens: ["m5"],
      })?.id === "ur-abc-123",
    );
  }
}

// ── The evaluator ───────────────────────────────────────────────────────────
console.log("[evaluateUserRules fires only on a dimension match]");
{
  const rules = [
    {
      dimension: "workload",
      equals: "database",
      action: "exclude",
      tokens: ["t3"],
    },
    {
      dimension: "env",
      equals: "production",
      action: "includeOnly",
      tokens: ["m5", "r5"],
    },
  ];
  const ev = (dims) => ctx.evaluateUserRules(dims, rules);

  let r = ev({ workload: "Database", env: "Dev" });
  check(
    "a matching workload rule contributes its exclude token",
    r.excludeTokens.join(",") === "t3",
    JSON.stringify(r),
  );
  check(
    "the non-matching env rule contributes nothing",
    r.includeOnlyTokens.length === 0,
  );
  check(
    "the fired label names the rule in words",
    r.fired.some((f) => f === "User: Workload=database → exclude t3"),
    JSON.stringify(r.fired),
  );

  r = ev({ workload: "Web Server", env: "Production" });
  check(
    "the includeOnly rule fires on an env match",
    r.includeOnlyTokens.join(",") === "m5,r5",
    JSON.stringify(r),
  );
  check("the workload rule does not fire", r.excludeTokens.length === 0);

  r = ev({ workload: "database", env: "production" });
  check(
    "both rules fire when both dimensions match",
    r.excludeTokens.length === 1 &&
      r.includeOnlyTokens.length === 2 &&
      r.fired.length === 2,
    JSON.stringify(r),
  );

  check(
    "matching is case-insensitive",
    ev({ workload: "DATABASE" }).excludeTokens.length === 1,
  );
  check(
    "a malformed rule in the list is skipped, not fatal",
    ctx
      .evaluateUserRules({ env: "prod" }, [
        null,
        { dimension: "env", equals: "prod", action: "exclude", tokens: ["t3"] },
      ])
      .excludeTokens.join(",") === "t3",
  );
}

// ── Storage round-trip ──────────────────────────────────────────────────────
console.log("[saveUserRules / loadUserRules round-trip normalised rules]");
{
  ctx.saveUserRules([
    {
      dimension: "workload",
      equals: "database",
      action: "exclude",
      tokens: ["t3"],
    },
  ]);
  const back = ctx.loadUserRules();
  check(
    "a saved rule loads back normalised",
    back.length === 1 &&
      back[0].dimension === "workload" &&
      back[0].tokens.join(",") === "t3",
    JSON.stringify(back),
  );
  ctx.saveUserRules([
    { dimension: "nope" },
    { dimension: "env", equals: "prod", action: "exclude", tokens: ["t3"] },
  ]);
  check(
    "saving drops the rules that fail validation",
    ctx.loadUserRules().length === 1,
    JSON.stringify(ctx.loadUserRules()),
  );
}

// ── Factory integration: a rule actually steers the run ──────────────────────
console.log(
  "[a fired rule steers the recommendation and is named in Rules Applied]",
);
{
  ctx.rowsUR = [
    {
      "VM Name": "db",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "AWS Region": "us-east-1",
      Workload: "Database",
    },
    {
      "VM Name": "web",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "AWS Region": "us-east-1",
      Workload: "Web Server",
    },
  ];
  (async () => {
    try {
      const results = await run(
        `getInstanceRecommendationWithSelector(rowsUR, ['aws'], { generateLikeToLike: true, userRules: [{ dimension: "workload", equals: "database", action: "includeOnly", tokens: ["r5"] }] })`,
      );
      check(
        "the matching row is restricted to the rule's allow-list family",
        /^r5/.test(results[0]["AWS Like-to-Like Instance"]),
        results[0]["AWS Like-to-Like Instance"],
      );
      check(
        "the fired rule is named in the matching row's Rules Applied",
        /User: Workload=database → include only r5/.test(
          results[0]["AWS Rules Applied"] || "",
        ),
        results[0]["AWS Rules Applied"],
      );
      check(
        "a row the rule does not match is untouched by it",
        !/User:/.test(results[1]["AWS Rules Applied"] || ""),
        results[1]["AWS Rules Applied"],
      );
    } catch (e) {
      check(
        "the factory run completes without throwing",
        false,
        e && e.message,
      );
    }
    // process.exitCode inside the async IIFE so it reflects the factory checks
    // (they resolve after the synchronous ones above).
    process.exitCode = state.failures ? 1 : 0;
  })();
}

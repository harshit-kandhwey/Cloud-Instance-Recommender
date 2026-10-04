// The Criticality column (3.21 phase 6): its vocabulary, how a header maps to it,
// how an unrecognised value is named at upload, and the manual-entry dropdown.
// Nothing sizes on it yet, so this suite pins the input side only: a value that
// would later steer a sizing policy must arrive spelled the way the engine reads it.
const vm = require("vm");
const { buildContext, makeChecker, parse } = require("../harness");

const { check, state } = makeChecker();

console.log("[the vocabulary is the engine's own]");
{
  const { ctx } = buildContext();
  const run = (expr) => vm.runInContext(expr, ctx);
  check(
    "RECOGNIZED.criticality lists the four levels",
    run("String(RuleEngine.RECOGNIZED.criticality)") ===
      "critical,high,medium,low",
    run("String(RuleEngine.RECOGNIZED.criticality)"),
  );
  check(
    "Criticality is a mappable canonical column on the tool pages",
    run("pageCanonicals()").includes("Criticality"),
  );
}

console.log("[header auto-mapping]");
{
  const { ctx } = buildContext();
  ctx.__h = ["Business Criticality", "Priority", "Tier", "Criticality Level"];
  const first = vm.runInContext("autoMatchHeaders(__h, null)", ctx);
  // Two headers claim Criticality, so the matcher must refuse to guess between them.
  check(
    "two headers that both name criticality are left ambiguous, not guessed",
    first.ambiguous.some(
      (a) => a.canonical === "Criticality" && a.candidates.length === 2,
    ) && !Object.values(first.mapping).includes("Criticality"),
    JSON.stringify(first),
  );
  ctx.__h = ["Business Criticality", "Priority", "Tier"];
  const m = vm.runInContext("autoMatchHeaders(__h, null)", ctx).mapping;
  check(
    "a qualified header maps to Criticality",
    m["Business Criticality"] === "Criticality",
    JSON.stringify(m),
  );
  check(
    "bare Priority and Tier do not map: they name other things in real inventories",
    m["Priority"] === undefined && m["Tier"] === undefined,
    JSON.stringify(m),
  );
  ctx.__h = ["Criticality"];
  check(
    "the literal header maps to itself",
    vm.runInContext("autoMatchHeaders(__h, null)", ctx).mapping[
      "Criticality"
    ] === "Criticality",
  );
}

console.log("[an unrecognised value is named at upload]");
{
  const { ctx, elements } = buildContext();
  parse(
    ctx,
    `VM Name,CPU Count,Memory (GB),AWS Region,Criticality
a,4,16,us-east-1,Critical
b,4,16,us-east-1,HIGH
c,4,16,us-east-1,Hgih
d,4,16,us-east-1,
e,4,16,us-east-1,Mission Critical`,
  );
  const html = elements.inputHygieneSection.innerHTML;
  check(
    "a misspelled level is named with its row number",
    /Criticality &quot;Hgih&quot; not recognized[^<]*1 row \(4\)/.test(html),
    html,
  );
  check(
    "a level outside the vocabulary is named too",
    /Criticality &quot;Mission Critical&quot; not recognized[^<]*1 row \(6\)/.test(
      html,
    ),
    html,
  );
  check(
    "recognised levels in any case, and an empty cell, are not flagged",
    !/Criticality &quot;(Critical|HIGH)&quot;/.test(html) &&
      !/Criticality &quot;&quot;/.test(html),
    html,
  );
}

console.log("[the manual-entry dropdown]");
{
  const { ctx, elements } = buildContext();
  ctx.toggleManualEntry();
  const defs = ctx.manualFieldDefs();
  const last = defs[defs.length - 1];
  check(
    "Criticality is the last field, so no existing field position moves",
    last.key === "Criticality" &&
      defs
        .slice(0, 5)
        .map((d) => d.key)
        .join(",") ===
        "VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization",
    defs.map((d) => d.key).join(","),
  );
  check(
    "its options are the engine's levels, capitalised",
    last.options.join(",") === "Critical,High,Medium,Low",
    String(last.options),
  );
  const html = elements.manualEntrySection.innerHTML;
  check(
    "it renders as a select with an empty choice, not a free-text box",
    new RegExp(
      `<select id="manual_${defs.length - 1}"[^>]*><option value="">`,
    ).test(html) && html.includes('<option value="Critical">'),
    html.slice(-600),
  );
}

process.exitCode = state.failures ? 1 : 0;

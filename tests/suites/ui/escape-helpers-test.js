// escape-helpers suite: the three functions every generated attribute and text node
// passes through, asserted by name. Other suites exercise them only in passing, so a
// weakened escape could still satisfy the page-level checks. Covered: each of the five
// characters, order of replacement, coercion, that a value cannot close its attribute,
// and that the JSON an attribute carries decodes back to exactly what went in.
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { run, ctx } = buildEngineContext({
  scripts: ["src/shared/storage-keys.js", "src/shared/app-core.js"],
  label: "escape-helpers",
});

// What an HTML parser does to an attribute value, for the five characters escapeHtml emits.
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attr = (out, name) => {
  const m = out.match(new RegExp(` ${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};

// ── escapeHtml ───────────────────────────────────────────────────────────────────
for (const [ch, want] of [
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]) {
  ctx.__v = ch;
  check(
    `escapeHtml turns ${JSON.stringify(ch)} into ${want}`,
    run("escapeHtml(__v)") === want,
  );
}
ctx.__v = "abc 123 m5.large";
check(
  "escapeHtml leaves a string with none of them unchanged",
  run("escapeHtml(__v)") === "abc 123 m5.large",
);
ctx.__v = "&lt;";
check(
  "ampersand goes first, so an existing entity is escaped rather than reused",
  run("escapeHtml(__v)") === "&amp;lt;",
);
check(
  "a number and null are coerced to text, not thrown on",
  run("escapeHtml(42)") === "42" && run("escapeHtml(null)") === "null",
);
ctx.__v = "\"><img src=x onerror=alert(1)>'";
check(
  "a markup breakout leaves no raw angle bracket or quote",
  !/[<>"']/.test(run("escapeHtml(__v)")),
  run("escapeHtml(__v)"),
);

// ── dataStyleAttr ────────────────────────────────────────────────────────────────
{
  ctx.__d = { width: '10px" onclick="x', color: "<red>" };
  const out = run("dataStyleAttr(__d)");
  check(
    "dataStyleAttr is one attribute whose value cannot be closed from inside",
    out.startsWith(' data-style="') &&
      out.endsWith('"') &&
      (out.match(/"/g) || []).length === 2 &&
      !/[<>]/.test(out),
    out,
  );
  const back = JSON.parse(attr(out, "data-style"));
  check(
    "and the declarations decode back to exactly what went in",
    back.width === ctx.__d.width && back.color === ctx.__d.color,
    JSON.stringify(back),
  );
}

// ── actionAttrs ──────────────────────────────────────────────────────────────────
{
  ctx.__a = [{ k: "<v>" }, "a\"b'c&d"];
  const out = run(
    `actionAttrs("click", 'a"b', __a, { then: 'c"d', keys: ["Enter"] })`,
  );
  check(
    "the function name and the then-name are escaped into their attributes",
    attr(out, "data-on-click") === 'a"b' &&
      out.includes('data-on-click="a&quot;b"') &&
      attr(out, "data-then-click") === 'c"d' &&
      out.includes('data-then-click="c&quot;d"'),
    out,
  );
  const args = JSON.parse(attr(out, "data-args-click"));
  check(
    "the args decode back to what went in and carry no raw angle bracket",
    JSON.stringify(args) === JSON.stringify(ctx.__a) && !/[<>]/.test(out),
    out,
  );
  check(
    "keys travel as JSON in their own attribute",
    JSON.stringify(JSON.parse(attr(out, "data-keys-click"))) ===
      JSON.stringify(["Enter"]),
  );
  check(
    "no attribute value is closed early (even number of raw quotes)",
    (out.match(/"/g) || []).length % 2 === 0,
    out,
  );
}
{
  const bare = run('actionAttrs("change", "doIt")');
  check(
    "with no args and no options only the name attribute is written",
    bare === ' data-on-change="doIt"',
    bare,
  );
  const flags = run(
    'actionAttrs("click", "doIt", [], { stop: true, prevent: true })',
  );
  check(
    "stop and prevent are bare flag attributes",
    flags === ' data-on-click="doIt" data-stop-click data-prevent-click',
    flags,
  );
  const self = run('actionAttrs("click", "doIt", [{ x: 1 }], { self: true })');
  check(
    "self puts the element reference first in the args",
    JSON.stringify(JSON.parse(attr(self, "data-args-click"))) ===
      JSON.stringify([{ $: "this" }, { x: 1 }]),
    self,
  );
}

if (state.failures) {
  console.error(`\nescape-helpers: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nescape-helpers: all checks passed");
  process.exitCode = 0;
}

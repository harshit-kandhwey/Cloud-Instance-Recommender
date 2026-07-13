// The saved-mapping manager: a column mapping confirmed once is reapplied to
// every later file with the same headers, silently. That is the point — and it
// is also why a mistake made once repeats forever. It must be visible, and it
// must be possible to forget.
const { buildContext, makeChecker, rowsOf, parse } = require("./harness");

const KEY = "cloudInstanceRecommenderColumnMaps";
const { check, state } = makeChecker();
const ingest = parse;
const rows = rowsOf;
const panel = (elements) => elements.savedMappingsSection;
const saved = (store) => JSON.parse(store.get(KEY) || "{}");

// Ambiguous on purpose: "VM" and "Host" are both VM-name synonyms and nothing
// identifies the tool, so the mapping panel opens and an answer must be given.
const AMBIGUOUS = `VM,CPUs,Memory (GB),Host
web-01,4,16,esxi-07
web-02,8,32,esxi-07`;

// Answer the open mapping panel the way a user would: pick the source column for
// each canonical, then confirm. Each select is keyed by the canonical's position
// and carries the source header's INDEX as its value, not its name.
function confirmMapping(ctx, choices) {
  const pending = ctx.window._pendingIngest;
  const canonicals = ctx.pageCanonicals();
  for (const [canonical, source] of Object.entries(choices)) {
    const select = ctx.document.getElementById(
      `colmap_${canonicals.indexOf(canonical)}`,
    );
    select.value = String(pending.headers.indexOf(source));
  }
  ctx.applyColumnMapping();
}

// A later visit: a fresh page that shares the same browser storage.
function buildContextFrom(store) {
  return buildContext({ seedStorage: Object.fromEntries(store) });
}

console.log("[nothing remembered, nothing shown]");
{
  const { ctx, elements } = buildContext();
  ctx.renderSavedMappings();
  check(
    "no panel when there is nothing to forget",
    panel(elements).classes.has("hidden") && panel(elements).innerHTML === "",
  );
}

console.log("[an answer is remembered, and reapplied without asking]");
{
  const { ctx, elements, store } = buildContext();
  ingest(ctx, AMBIGUOUS);
  check(
    "the ambiguous file stops to ask",
    !elements.columnMappingSection.classes.has("hidden") &&
      rows(ctx).length === 0,
  );

  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });
  check(
    "confirming applies it",
    rows(ctx).length === 2 && rows(ctx)[0]["VM Name"] === "web-01",
    JSON.stringify(rows(ctx)[0]),
  );
  check(
    "and it is written to storage",
    Object.keys(saved(store)).length === 1,
    store.get(KEY),
  );

  // The whole reason the manager has to exist: this file never asks again.
  const second = buildContextFrom(store);
  ingest(second.ctx, AMBIGUOUS);
  check(
    "a later file with the same headers is mapped silently, without asking",
    second.elements.columnMappingSection.classes.has("hidden") &&
      rows(second.ctx).length === 2 &&
      rows(second.ctx)[0]["VM Name"] === "web-01",
    JSON.stringify(rows(second.ctx)),
  );
}

console.log("[what is remembered is visible]");
{
  const { ctx, elements } = buildContext();
  ingest(ctx, AMBIGUOUS);
  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });

  const html = panel(elements).innerHTML;
  check(
    "the panel appears once something is remembered",
    !panel(elements).classes.has("hidden"),
  );
  check(
    "and names the renames the user actually agreed to",
    /VM → VM Name/.test(html) && /CPUs → CPU Count/.test(html),
    html,
  );
  check("with a way to forget it", /forgetColumnMapping\(/.test(html), html);
}

console.log("[forgetting means the next file asks again]");
{
  const { ctx, elements, store, toasts } = buildContext();
  ingest(ctx, AMBIGUOUS);
  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });
  // Forget takes the rendered button's INDEX, not the signature: the signature
  // is built from the file's own headers, so it is attacker-controlled text and
  // must never be interpolated into an inline handler.
  ctx.forgetColumnMapping(0);
  check("it is gone from storage", Object.keys(saved(store)).length === 0);
  check(
    "the panel goes away with it",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );
  check(
    "and the user is told what that means",
    toasts.some((t) => /ask again/.test(t.message)),
    JSON.stringify(toasts),
  );

  // The point of forgetting: the mistake is not repeated.
  const after = buildContextFrom(store);
  ingest(after.ctx, AMBIGUOUS);
  check(
    "the same file now stops to ask once more",
    !after.elements.columnMappingSection.classes.has("hidden") &&
      rows(after.ctx).length === 0,
  );
}

console.log("[entries from an older version are not counted or kept]");
{
  // What a real user upgrading actually has: storage holding a pre-3.7 entry
  // that the ingest path now ignores. Counting it in the heading while rendering
  // nothing for it would show "1 remembered" above an empty list.
  const legacySignature = ["memory (gb)", "vcpu", "vm name"].sort().join("|");
  const { ctx, elements, store } = buildContext({
    seedStorage: {
      [KEY]: JSON.stringify({
        [legacySignature]: { "VM Name": "VM Name", vCPU: "CPU Count" },
      }),
    },
  });

  ctx.renderSavedMappings();
  check(
    "nothing is shown, because nothing is usable",
    panel(elements).classes.has("hidden"),
    panel(elements).innerHTML,
  );
  check(
    "and the dead entry is dropped from storage rather than left invisible",
    Object.keys(saved(store)).length === 0,
    store.get(KEY),
  );
}
{
  // One live entry alongside one dead one: the heading must count the live one.
  const { ctx, elements, store } = buildContext();
  ingest(ctx, AMBIGUOUS);
  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });

  const withLegacy = saved(store);
  withLegacy["old|headers|here"] = { "VM Name": "VM Name" }; // no v — pre-3.7
  store.set(KEY, JSON.stringify(withLegacy));

  ctx.renderSavedMappings();
  const html = panel(elements).innerHTML;
  check(
    "the heading counts what is actually listed",
    /Remembered column mappings \(1\)/.test(html),
    html,
  );
  check(
    "and the column count comes from the signature's own separator",
    /<strong>4 columns<\/strong>/.test(html),
    html,
  );
}

console.log("[a header cannot smuggle script into the Forget button]");
{
  // The signature is built from the file's own headers, so it is text an
  // attacker controls. escapeHtml is NOT enough inside an inline handler: it
  // turns a quote into &quot;, which the HTML parser decodes back to a real
  // quote INSIDE the onclick attribute, closing the string and running whatever
  // follows. The handler must therefore never receive the signature at all.
  const { ctx, elements, store } = buildContext();
  ingest(
    ctx,
    `VM,CPUs,Memory (GB),Host,x&quot;);alert(1);//\nweb-01,4,16,esxi-07,y`,
  );
  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });

  const html = panel(elements).innerHTML;
  const handler = (html.match(/onclick="forgetColumnMapping\([^)]*\)"/) ||
    [])[0];
  check("the mapping was still saved", Object.keys(saved(store)).length === 1);
  check(
    "the handler is given an index, never the header text",
    /onclick="forgetColumnMapping\(\d+\)"/.test(html),
    handler,
  );
  check(
    "no fragment of the hostile header reaches the handler",
    !/forgetColumnMapping\([^)]*alert/.test(html),
    handler,
  );
  ctx.forgetColumnMapping(0);
  check(
    "and the index still resolves to the right entry",
    Object.keys(saved(store)).length === 0,
  );
}

console.log("[forget-all clears every remembered mapping]");
{
  const { ctx, elements, store } = buildContext();
  ingest(ctx, AMBIGUOUS);
  confirmMapping(ctx, {
    "VM Name": "VM",
    "CPU Count": "CPUs",
    "Memory (GB)": "Memory (GB)",
  });
  // A different header set, also ambiguous ("Server" and "Host" both look like a
  // VM name), so it too has to be answered — and so it too is remembered.
  ingest(
    ctx,
    `Server,Host,vCPUs,RAM
db-01,esxi-09,8,32`,
  );
  confirmMapping(ctx, {
    "VM Name": "Server",
    "CPU Count": "vCPUs",
    "Memory (GB)": "RAM",
  });
  check(
    "two mappings remembered",
    Object.keys(saved(store)).length === 2,
    store.get(KEY),
  );

  ctx.forgetAllColumnMappings();
  check("all cleared", Object.keys(saved(store)).length === 0);
  check("and the panel is gone", panel(elements).classes.has("hidden"));
}

process.exit(state.failures ? 1 : 0);

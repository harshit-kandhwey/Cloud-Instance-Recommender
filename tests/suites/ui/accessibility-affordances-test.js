// Accessibility affordances.
const fs = require("fs");
const path = require("path");
const { buildContext, REPO } = require("../harness");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

// ── DOM stub with attribute support ─────────────────────────────────────────
function makeAttrElement(extra = {}) {
  const el = {
    attrs: {},
    listeners: {},
    innerHTML: "",
    className: "",
    style: {},
    value: "",
    classes: new Set(),
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    getAttribute(k) {
      return el.attrs[k] ?? null;
    },
    addEventListener(t, fn) {
      (el.listeners[t] = el.listeners[t] || []).push(fn);
    },
    click() {
      (el.listeners.click || []).forEach((f) => f({}));
      if (el.onclick) el.onclick();
    },
    classList: {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
      // The real classList.toggle takes an optional force argument, and
      // restoreSectionStates relies on it to SET rather than flip
      toggle: (c, force) => {
        if (force === undefined) {
          return el.classes.has(c) ? el.classes.delete(c) : el.classes.add(c);
        }
        return force ? el.classes.add(c) : el.classes.delete(c);
      },
      contains: (c) => el.classes.has(c),
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    focus: () => {},
    setSelectionRange: () => {},
    scrollIntoView: () => {},
    ...extra,
  };
  return el;
}

// Two collapsible sections: one open, one collapsed
const sectionOpen = makeAttrElement();
const headerOpen = makeAttrElement();
headerOpen.parentElement = sectionOpen;
const sectionCollapsed = makeAttrElement();
sectionCollapsed.classes.add("collapsed");
const headerCollapsed = makeAttrElement();
headerCollapsed.parentElement = sectionCollapsed;
// The section list the fake document reports; swapped out by the collapse tests
let sectionHeaders = [headerOpen, headerCollapsed];

// Full app on the AWS page. The by-id elements the app looks up come from the
// shared harness (their .attrs are all these checks read); the section-header
// list is reported through a querySelectorAll override, and location.pathname
// keys the stored collapse state under "aws".
const { ctx, run, elements } = buildContext();
ctx.location = { pathname: "/aws.html" };
const baseQSA = ctx.document.querySelectorAll;
ctx.document.querySelectorAll = (sel) =>
  sel === ".section-header[onclick]" ? sectionHeaders : baseQSA(sel);

// Wired now that ctx exists: enhanceAccessibility's keydown handler clicks the
// header, and click() fires this onclick.
headerOpen.onclick = () => ctx.toggleSection(headerOpen);
headerCollapsed.onclick = () => ctx.toggleSection(headerCollapsed);

console.log("[section headers]");
ctx.enhanceAccessibility();
check(
  "role=button set",
  headerOpen.attrs.role === "button" && headerCollapsed.attrs.role === "button",
);
check("tabindex=0 set", headerOpen.attrs.tabindex === "0");
check(
  "open section aria-expanded=true",
  headerOpen.attrs["aria-expanded"] === "true",
);
check(
  "collapsed section aria-expanded=false",
  headerCollapsed.attrs["aria-expanded"] === "false",
);

// Keyboard: Enter on open header collapses it and syncs aria-expanded.
// Look the handler up defensively: if enhanceAccessibility() ever stops
// attaching a keydown listener, indexing [0] on an empty list throws and aborts
// the run with a stack trace instead of a readable FAIL, skipping every check
// below.
let prevented = 0;
const onKeydown = (headerOpen.listeners.keydown || [])[0];
check("keydown handler attached", typeof onKeydown === "function");
const fireKey = (key) =>
  onKeydown && onKeydown({ key, preventDefault: () => prevented++ });
fireKey("Enter");
check("Enter triggers toggle", sectionOpen.classes.has("collapsed"));
check(
  "aria-expanded synced after toggle",
  headerOpen.attrs["aria-expanded"] === "false",
);
check("default prevented", prevented === 1);
fireKey(" ");
check(
  "Space toggles back",
  !sectionOpen.classes.has("collapsed") &&
    headerOpen.attrs["aria-expanded"] === "true",
);
fireKey("a");
check("other keys ignored", prevented === 2);

console.log("[live regions]");
check(
  "fileStatus aria-live",
  elements.fileStatus.attrs["aria-live"] === "polite",
);
check(
  "progressText aria-live",
  elements.progressText.attrs["aria-live"] === "polite",
);
// Stub's getElementById auto-creates, so the creation branch can't run here —
// verify the toast attributes at source level instead
const src = read("js/base/app-core.js");
check(
  "toast sets role=status + aria-live in source",
  /toast\.setAttribute\("role", "status"\)/.test(src) &&
    /toast\.setAttribute\("aria-live", "polite"\)/.test(src),
);

console.log("[preview table a11y]");
const results = [
  {
    "VM Name": "b",
    "CPU Count": "2",
    "AWS Rules Applied": "",
    "AWS No Match Reason": "",
    "AWS Like-to-Like Instance": "m5.large",
  },
  {
    "VM Name": "a",
    "CPU Count": "4",
    "AWS Rules Applied": "",
    "AWS No Match Reason": "",
    "AWS Like-to-Like Instance": "r6i.large",
  },
];
run(`showResultsPreview(${JSON.stringify(results)})`);
const container = elements.resultsPreviewSection;
check(
  "th has tabindex + aria-sort=none initially",
  container.innerHTML.includes('tabindex="0" aria-sort="none"'),
);
check("th has keydown handler", container.innerHTML.includes("onkeydown="));
check(
  "search input labelled",
  container.innerHTML.includes('aria-label="Filter preview rows"'),
);
check(
  "copy button labelled",
  container.innerHTML.includes('aria-label="Copy row 1"'),
);
ctx._sortPreview(0);
check(
  "sorted col aria-sort=ascending",
  container.innerHTML.includes('aria-sort="ascending"'),
);
ctx._sortPreview(0);
check(
  "re-sort flips to descending",
  container.innerHTML.includes('aria-sort="descending"'),
);

console.log("[page wiring]");
for (const f of [
  "index.html",
  "aws.html",
  "azure.html",
  "gcp.html",
  "multicloud.html",
]) {
  const c = read(f);
  check(
    `${f}: skip link + main id`,
    c.includes('class="skip-link" href="#main"') && c.includes('id="main"'),
  );
  check(
    `${f}: header emoji aria-hidden`,
    c.includes('<span aria-hidden="true">🌐</span>'),
  );
}
check(
  "theme.css has :focus-visible + .skip-link",
  read("css/theme.css").includes(":focus-visible") &&
    read("css/theme.css").includes(".skip-link"),
);
check(
  "user-guide has :focus-visible",
  read("user-guide.html").includes(":focus-visible"),
);

// ─── Floating controls don't overlap ──────────────────────────────────────────
// Three things float at the bottom of a tool page. They must each own a corner:
// toasts are bottom-right (z 9999), the sticky Generate bar is bottom-centre,
// and back-to-top is bottom-left — put it bottom-right and a toast hides it.
console.log("[floating controls]");
{
  const shell = read("js/base/ui-shell.js");
  // Bound the slice to this function: running to end-of-file would drag in
  // unrelated code and could fail (or pass) for reasons that have nothing to do
  // with the button
  const start = shell.indexOf("function setupBackToTop");
  // Fail on the missing anchor itself: if the function is renamed, indexOf
  // returns -1, slice(-1, …) yields a bogus tail fragment, and the position
  // check below fails blaming CSS placement rather than the absent function.
  check("setupBackToTop found in ui-shell.js", start !== -1);
  const end = shell.indexOf("\nfunction ", start + 1);
  const backToTop = shell.slice(start, end === -1 ? undefined : end);
  check(
    "back-to-top is bottom-left, clear of the toast stack",
    /left: "20px"/.test(backToTop) && !/right: "20px"/.test(backToTop),
  );
  const toastStackMarkup = read("aws.html");
  check(
    "the toast stack owns bottom-right",
    /id="toastStack"[\s\S]{0,400}right: 20px/.test(toastStackMarkup),
  );
}

// ─── Section collapse state ───────────────────────────────────────────────────
// Rarely-used sections start collapsed; every section then remembers what the
// user last did with it.
console.log("[section collapse state]");
{
  // id is the stable key; the title is only a fallback for a header without one
  const makeSection = (id, title) => {
    const section = makeAttrElement();
    const header = makeAttrElement({
      querySelector: (sel) =>
        sel === ".section-title" ? { textContent: title } : null,
    });
    if (id) header.attrs["data-section-id"] = id;
    header.parentElement = section;
    return { section, header, id, title };
  };

  const upload = makeSection("upload", "Upload CSV File");
  const sample = makeSection("sample-template", "Sample CSV Template");
  const advanced = makeSection(
    "advanced-filters",
    "\n  Advanced Instance Filtering (Optional)\n",
  );
  sectionHeaders = [upload.header, sample.header, advanced.header];

  ctx.restoreSectionStates();
  check(
    "a section you always use stays open",
    !upload.section.classes.has("collapsed"),
  );
  check(
    "rarely-used sections start collapsed",
    sample.section.classes.has("collapsed") &&
      advanced.section.classes.has("collapsed"),
  );
  check(
    "the key is the stable id, not the heading text",
    ctx.sectionKey(advanced.header) === "advanced-filters",
    ctx.sectionKey(advanced.header),
  );
  check(
    "a header with no id falls back to its whitespace-collapsed title",
    ctx.sectionKey(makeSection(null, "\n  Some Section\n").header) ===
      "Some Section",
  );
  // Per element, not per count: equal totals would still pass if one header had
  // an onclick with no id and another had an id with no onclick.
  //
  // Match every <div> and interrogate its attributes, rather than pinning the
  // shape of the tag. A header that reorders its attributes or carries a second
  // class is still a header, and a matcher that skipped it would report success
  // by never looking at it. The attribute run tolerates quoted ">" and, since
  // Prettier reflows multi-attribute tags, arbitrary whitespace.
  const OPEN_DIV = /<div\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attr = (attrs, name) =>
    (attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) || [])[1] ??
    "";
  const hasClass = (attrs, cls) =>
    attr(attrs, "class").split(/\s+/).includes(cls);

  for (const page of [
    "aws.html",
    "azure.html",
    "gcp.html",
    "multicloud.html",
  ]) {
    const headers = [...read(page).matchAll(OPEN_DIV)]
      .map((m) => m[1])
      .filter((a) => hasClass(a, "section-header"));
    const collapsible = headers.filter((a) =>
      /\btoggleSection\s*\(/.test(attr(a, "onclick")),
    );
    const idless = collapsible.filter((a) => !attr(a, "data-section-id"));
    check(
      `${page}: every collapsible header carries its own data-section-id`,
      collapsible.length > 0 && idless.length === 0,
      `${idless.length} of ${collapsible.length} collapsible headers without an id`,
    );
  }
  // The four tool pages are four separate files, and every panel added since the
  // upload section was written had to be pasted into each of them by hand. A
  // panel missing from one page does not throw: the renderer looks its element
  // up, does not find it, and returns — so that page quietly loses the feature.
  // 3.7 alone added five of these.
  const TOOL_PAGES = ["aws.html", "azure.html", "gcp.html", "multicloud.html"];
  const REQUIRED_PANELS = [
    "manualEntrySection",
    "pasteDataSection",
    "savedMappingsSection",
    "sampleGallery",
    "fileStatus",
    "sheetPickerSection",
    "columnMappingSection",
    "fileStatsSection",
    "inputHygieneSection",
    "regionValidationSection",
    "appMappingSection",
    "dataPreviewSection",
    "resultsChartsSection",
  ];
  // The id has to be found on a real ELEMENT in the document body, not merely
  // somewhere in the file's bytes. A substring search would be satisfied by the
  // id appearing inside an HTML comment — so a panel commented OUT of a page
  // would still "pass", which is the one state this guard exists to catch — or
  // inside a <script>, where `getElementById("sheetPickerSection")` names every
  // one of these panels without any of them existing.
  //
  // So: drop the parts of the file that are not markup, then require an element
  // that actually carries the attribute.
  const elementsOf = (page) =>
    read(page)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "");

  // Escaped, though every id today is a plain identifier: an id containing a dot
  // or a bracket would otherwise change what the pattern means, silently.
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const hasPanel = (page, panel) =>
    new RegExp(`<[a-z][^>]*\\bid=["']${escapeRegex(panel)}["']`, "i").test(
      elementsOf(page),
    );
  for (const panel of REQUIRED_PANELS) {
    const missing = TOOL_PAGES.filter((page) => !hasPanel(page, panel));
    check(
      `every tool page has #${panel}`,
      missing.length === 0,
      `missing from ${missing.join(", ")}`,
    );
  }

  check(
    "aria-expanded matches the collapsed state",
    sample.header.attrs["aria-expanded"] === "false" &&
      upload.header.attrs["aria-expanded"] === "true",
  );

  // Open the default-collapsed one and collapse the default-open one
  ctx.toggleSection(sample.header);
  ctx.toggleSection(upload.header);
  check(
    "toggling flips both",
    !sample.section.classes.has("collapsed") &&
      upload.section.classes.has("collapsed"),
  );

  // "Reload": drop the classes and restore from storage alone
  sample.section.classes.delete("collapsed");
  upload.section.classes.delete("collapsed");
  advanced.section.classes.delete("collapsed");
  ctx.restoreSectionStates();
  check(
    "the user's choice beats the default after a reload",
    !sample.section.classes.has("collapsed") &&
      upload.section.classes.has("collapsed"),
    `sample collapsed=${sample.section.classes.has("collapsed")}, upload collapsed=${upload.section.classes.has("collapsed")}`,
  );
  check(
    "a section never touched keeps its default",
    advanced.section.classes.has("collapsed"),
  );

  check(
    "state is stored per page, under the stable id",
    JSON.parse(ctx.localStorage.getItem("cloudInstanceRecommenderSections"))
      .aws["sample-template"] === "open",
  );
}

process.exit(failures ? 1 : 0);

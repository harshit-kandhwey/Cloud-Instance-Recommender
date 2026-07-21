// Step 6 verification: preview search filter — filtering, counts, sort
// interaction, focus restore, debounce.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Remove comments the way JavaScript actually reads them, tracking strings,
// template literals AND regex literals as it goes.
//
// A regex-based stripper cannot do this, and failing at it is not academic. Two
// ways it reports safety it never checked:
//
//   const help = "https://example.test"; alert("boom");
//     — `.replace(/\/\/.*$/gm, "")` fires on the "//" inside the URL, truncates
//       the line there, and the banned call disappears from the scan.
//
//   const s = url.replace(/\/\//g, "/"); alert(1);
//     — the regex literal's own slashes sit next to each other outside any
//       string, so even a string-aware scanner reads them as a line comment and
//       eats the rest of the line.
//
// In both cases the guard PASSES, and passes *because* of the very thing it
// failed to parse. A scanner that only half-understands the language is worse
// than no scanner at all.

// Whether a "/" here opens a regex literal or is a division sign. Decided by the
// last significant character, which is what the language itself does.
const KEYWORDS_BEFORE_REGEX = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

function regexCanStartHere(emitted) {
  let i = emitted.length - 1;
  while (i >= 0 && /\s/.test(emitted[i])) i--;
  if (i < 0) return true; // start of file

  const c = emitted[i];
  if (/[\w$]/.test(c)) {
    // An identifier or number means division (`a / b`) — unless it is one of the
    // keywords a regex may follow (`return /x/.test(s)`).
    let j = i;
    while (j >= 0 && /[\w$]/.test(emitted[j])) j--;
    return KEYWORDS_BEFORE_REGEX.has(emitted.slice(j + 1, i + 1));
  }
  // `)` and `]` close a value, so what follows divides it. Everything else —
  // `(`, `,`, `=`, `:`, `!`, `&`, `|`, `?`, `{`, `;`, an operator — is a place a
  // value may begin, so a regex may begin there.
  return c !== ")" && c !== "]";
}

function stripComments(source) {
  let out = "";
  let i = 0;

  // Reading the literal text of a template, as opposed to code. A single flag is
  // enough however deeply templates nest, because closing a template always
  // returns to code and closing a substitution always returns to template text.
  let inTemplate = false;
  let braceDepth = 0;
  // The brace depth each open "${" was seen at, innermost last.
  const substitutions = [];

  while (i < source.length) {
    if (inTemplate) {
      const ch = source[i];
      if (ch === "\\") {
        out += ch + (source[i + 1] || "");
        i += 2;
        continue;
      }
      if (ch === "`") {
        out += ch;
        i++;
        inTemplate = false; // back to code
        continue;
      }
      if (ch === "$" && source[i + 1] === "{") {
        // A substitution is code. Leaving it as opaque string content is how a
        // scanner goes blind: `${cond ? `//` : `q`}` has a backtick inside it,
        // which a scanner looking only for the next backtick reads as the END of
        // the template — resuming at top level in the middle of a substitution,
        // where a nested template's literal "//" then eats the rest of the line,
        // banned call and all.
        out += "${";
        i += 2;
        substitutions.push(braceDepth);
        braceDepth++;
        inTemplate = false;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    const c = source[i];
    const next = source[i + 1];

    // Comments first: "//" is always a comment (an empty regex is not legal) and
    // "/*" cannot open a regex either, so neither can be mistaken for one.
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/"))
        i++;
      i += 2;
      out += " "; // keep the tokens either side apart
      continue;
    }

    if (c === "/" && regexCanStartHere(out)) {
      out += c;
      i++;
      let inCharClass = false;
      while (i < source.length) {
        const ch = source[i];
        if (ch === "\\") {
          out += ch + (source[i + 1] || "");
          i += 2;
          continue;
        }
        if (ch === "\n") break; // unterminated — do not eat the rest of the file
        out += ch;
        i++;
        if (ch === "[") inCharClass = true;
        else if (ch === "]") inCharClass = false;
        else if (ch === "/" && !inCharClass) break; // a "/" inside [...] is literal
      }
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          // An escape consumes the next character, whatever it is — including a
          // quote, which would otherwise look like the end of the string.
          out += source[i] + (source[i + 1] || "");
          i += 2;
          continue;
        }
        out += source[i];
        const ended = source[i] === quote;
        i++;
        if (ended) break;
      }
      continue;
    }

    // A template opens literal text, which the block at the top of the loop
    // reads. Its `${…}` substitutions are not part of that text: they are code,
    // and they come back through this same loop.
    if (c === "`") {
      out += c;
      i++;
      inTemplate = true;
      continue;
    }

    if (c === "{") {
      braceDepth++;
      out += c;
      i++;
      continue;
    }
    if (c === "}") {
      // The "}" that returns brace depth to what it was when a "${" opened is
      // that substitution's closer, and puts us back in template text — not in
      // ordinary code, where a following "`" would look like an OPENING quote.
      if (
        substitutions.length &&
        braceDepth - 1 === substitutions[substitutions.length - 1]
      ) {
        substitutions.pop();
        braceDepth--;
        inTemplate = true;
      } else if (braceDepth > 0) {
        braceDepth--;
      }
      out += c;
      i++;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

const REPO = path.resolve(__dirname, "..", "..");

const elements = {};
let focusCalls = 0;
function fakeElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      innerHTML: "",
      dataset: {},
      className: "",
      style: {},
      value: "",
      selectionStart: null,
      classes: new Set(["hidden"]),
      classList: {
        add: (c) => elements[id].classes.add(c),
        remove: (c) => elements[id].classes.delete(c),
        toggle: () => {},
        contains: (c) => elements[id].classes.has(c),
      },
      addEventListener: () => {},
      querySelectorAll: () => [],
      focus: () => focusCalls++,
      setSelectionRange: (a) => (elements[id]._cursor = a),
      scrollIntoView: () => {},
    };
  }
  return elements[id];
}

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  alert: () => {},
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
sandbox.window = sandbox;
sandbox.document = {
  createElement: (tag) => ({ tag, style: {} }),
  getElementById: (id) => fakeElement(id),
  querySelectorAll: (sel) =>
    sel === "script[src]" ? [{ src: "js/aws/aws-data.js" }] : [],
  addEventListener: () => {},
  head: { appendChild: () => {} },
  body: { appendChild: () => {}, removeChild: () => {} },
};
const ctx = vm.createContext(sandbox);
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}
load("js/aws/aws-data.js");
for (const f of [
  "js/base/rule-engine.js",
  "js/base/base-instance-selector.js",
  "js/aws/aws-instance-selector.js",
  "js/azure/azure-instance-selector.js",
  "js/gcp/gcp-instance-selector.js",
  "js/base/instance-selector-factory.js",
  "js/base/app-core.js",
  "js/base/ui-shell.js",
  "js/base/ingest.js",
  "js/base/manual-entry.js",
  "js/base/form-controls.js",
  "js/base/generate.js",
  "js/base/preview.js",
  "js/base/downloads.js",
])
  load(f);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

(async () => {
  // 25 result rows: web-01..web-20 (m5.large), db-01..db-05 (r6i.xlarge)
  const results = [];
  for (let i = 1; i <= 20; i++) {
    results.push({
      "VM Name": `web-${String(i).padStart(2, "0")}`,
      "CPU Count": "2",
      "Memory (GB)": "8",
      "AWS Rules Applied": "",
      "AWS No Match Reason": "",
      "AWS Like-to-Like Instance": "m5.large",
      "AWS Like-to-Like vCPUs": 2,
      "AWS Like-to-Like Memory (GiB)": 8,
    });
  }
  for (let i = 1; i <= 5; i++) {
    results.push({
      "VM Name": `db-${String(i).padStart(2, "0")}`,
      "CPU Count": "4",
      "Memory (GB)": "32",
      "AWS Rules Applied": "",
      "AWS No Match Reason": "",
      "AWS Like-to-Like Instance": "r6i.xlarge",
      "AWS Like-to-Like vCPUs": 4,
      "AWS Like-to-Like Memory (GiB)": 32,
    });
  }

  vm.runInContext(`showResultsPreview(${JSON.stringify(results)})`, ctx);
  const container = elements.resultsPreviewSection;

  console.log("[initial render]");
  check(
    "search input rendered",
    container.innerHTML.includes('id="previewSearch"'),
  );
  check("unfiltered count", container.innerHTML.includes("1–25 of 25 rows"));

  console.log("[filtering]");
  ctx._previewFilterChanged("db-");
  await new Promise((r) => setTimeout(r, 250)); // wait out the 150ms debounce
  check(
    "filtered count line",
    container.innerHTML.includes("1–5 of 5 matching rows (25 total)"),
    container.innerHTML.match(/Results Preview \([^)]*\)/)?.[0],
  );
  check(
    "only db rows shown",
    !container.innerHTML.includes("web-01") &&
      container.innerHTML.includes("db-05"),
  );
  check("input value restored", elements.previewSearch.value === "db-");
  check("focus restored", focusCalls > 0);

  console.log("[debounce coalesces]");
  const renders0 = focusCalls;
  ctx._previewFilterChanged("r");
  ctx._previewFilterChanged("r6");
  ctx._previewFilterChanged("r6i");
  await new Promise((r) => setTimeout(r, 250));
  check(
    "three keystrokes → one re-render",
    focusCalls === renders0 + 1,
    `focusCalls=${focusCalls}`,
  );
  check(
    "value filter matches instance col",
    container.innerHTML.includes("1–5 of 5 matching rows"),
  );

  console.log("[sort while filtered]");
  ctx._sortPreview(0); // sort by VM Name
  check(
    "filter survives sort",
    container.innerHTML.includes("matching rows (25 total)"),
  );
  check(
    "sorted + filtered rows",
    container.innerHTML.indexOf("db-01") < container.innerHTML.indexOf("db-05"),
  );
  check("input value survives sort", elements.previewSearch.value === "r6i");

  console.log("[no matches]");
  ctx._previewFilterChanged("zzz-nothing");
  await new Promise((r) => setTimeout(r, 250));
  check("no-match message", container.innerHTML.includes("No rows match"));
  check(
    "zero count",
    container.innerHTML.includes("no matching rows (25 total)"),
  );

  console.log("[clear filter]");
  ctx._previewFilterChanged("");
  await new Promise((r) => setTimeout(r, 250));
  check("back to unfiltered", container.innerHTML.includes("1–25 of 25 rows"));

  // A download must never silently disagree with the screen: it follows the
  // preview's sort, ignores its filter, and says so while a filter is active.
  console.log("[exports vs preview state]");
  ctx._sortPreview(0); // toggles the existing VM Name ascending sort → descending
  ctx._previewFilterChanged("db-");
  await new Promise((r) => setTimeout(r, 250));

  check(
    "filtered preview discloses the full download size",
    container.innerHTML.includes(
      "Downloads always contain the full 25-row dataset",
    ),
    container.innerHTML.slice(-300),
  );

  const ordered = ctx.resultsInPreviewOrder(results);
  check("export keeps every row despite the filter", ordered.length === 25);
  check(
    "export follows the preview's sort order",
    ordered[0]["VM Name"] === "web-20" &&
      ordered[ordered.length - 1]["VM Name"] === "db-01",
    `${ordered[0]["VM Name"]} … ${ordered[ordered.length - 1]["VM Name"]}`,
  );
  check("source results not mutated", results[0]["VM Name"] === "web-01");

  // Results describe the providers selected when Generate ran; changing the
  // checkboxes afterwards re-runs nothing, so the drift has to be surfaced.
  console.log("[stale results notice]");
  // `processedResults` and `selectedProviders` are `let` bindings in app-core.js,
  // so they must be assigned inside the context — a property on the sandbox
  // object would just sit there, shadowed.
  const setProviders = (list) =>
    vm.runInContext(`selectedProviders = ${JSON.stringify(list)}`, ctx);
  vm.runInContext(`processedResults = ${JSON.stringify(results)}`, ctx);
  setProviders(["aws", "azure"]);
  ctx._resultsProviders = ["aws", "azure"];
  ctx.updateStaleResultsNotice();
  check(
    "selection unchanged → no notice",
    elements.resultsStaleNotice.classes.has("hidden"),
  );

  setProviders(["aws"]);
  ctx.updateStaleResultsNotice();
  check(
    "provider removed after generating → notice shown",
    !elements.resultsStaleNotice.classes.has("hidden") &&
      elements.resultsStaleNotice.innerHTML.includes("AWS, Azure"),
    elements.resultsStaleNotice.innerHTML,
  );

  setProviders(["aws", "azure", "gcp"]);
  ctx.updateStaleResultsNotice();
  check(
    "provider added after generating → notice shown",
    !elements.resultsStaleNotice.classes.has("hidden"),
  );

  setProviders(["azure", "aws"]);
  ctx.updateStaleResultsNotice();
  check(
    "same providers reordered → no notice",
    elements.resultsStaleNotice.classes.has("hidden"),
  );

  vm.runInContext("processedResults = null", ctx);
  setProviders(["gcp"]);
  ctx.updateStaleResultsNotice();
  check(
    "no results yet → no notice",
    elements.resultsStaleNotice.classes.has("hidden"),
  );

  // Toasts replaced window.alert everywhere the app talks to the user.
  console.log("[toasts]");
  // fakeElement() creates on first lookup, so ask for it rather than reaching
  // into the map before anything has rendered
  const stack = ctx.document.getElementById("toastStack");

  const infoId = ctx.showToast("Saved the thing", "success", 0);
  check(
    "toast renders its message and is revealed",
    stack.innerHTML.includes("Saved the thing") && !stack.classes.has("hidden"),
    stack.innerHTML,
  );
  check(
    "success tone uses the theme token, not a hardcoded colour",
    stack.innerHTML.includes("var(--good-strong)"),
    stack.innerHTML,
  );

  ctx.showToast("Something broke", "error", 0);
  check(
    "a second toast stacks rather than replacing the first",
    stack.innerHTML.includes("Saved the thing") &&
      stack.innerHTML.includes("Something broke"),
  );
  check(
    "error tone is announced assertively enough to differ from info",
    stack.innerHTML.includes("var(--red-strong)"),
  );

  ctx.dismissToast(infoId);
  check(
    "dismissing one leaves the other",
    !stack.innerHTML.includes("Saved the thing") &&
      stack.innerHTML.includes("Something broke"),
    stack.innerHTML,
  );

  // A message is user data — a VM named `<img onerror=...>` must not execute
  ctx.showToast('<img src=x onerror="boom">', "info", 0);
  check(
    "message is escaped, not injected",
    !stack.innerHTML.includes("<img src=x") &&
      stack.innerHTML.includes("&lt;img"),
    stack.innerHTML,
  );

  // Auto-dismiss
  // Generous margin: a 30ms timeout with an 80ms wait is only 50ms of slack, and
  // a loaded CI box will lose that
  const tempId = ctx.showToast("Briefly", "info", 20);
  check("timed toast shown", stack.innerHTML.includes("Briefly"));
  await new Promise((r) => setTimeout(r, 250));
  check(
    "timed toast auto-dismisses",
    !stack.innerHTML.includes("Briefly"),
    stack.innerHTML,
  );
  check(
    "dismissing an already-gone toast is a no-op",
    (() => {
      ctx.dismissToast(tempId);
      return true;
    })(),
  );

  // Every CSV export goes through downloadCsv, which prepends a BOM so Excel
  // reads the file as UTF-8 instead of the local ANSI codepage
  console.log("[csv encoding]");
  {
    // This suite's fake DOM has no URL/Blob and its nodes have no click(),
    // since nothing else here downloads anything
    const captured = [];
    const realCreateElement = ctx.document.createElement;
    ctx.Blob = class {
      constructor(parts) {
        this.content = parts.join("");
        captured.push(this.content);
      }
    };
    ctx.URL = { createObjectURL: () => "blob:x", revokeObjectURL: () => {} };
    ctx.document.createElement = (tag) => ({ tag, style: {}, click() {} });

    ctx.downloadCsv("VM Name\nweb-münchen-01\n日本-db-02", "x.csv");
    const out = captured[0];
    check("BOM is the first character", out.charCodeAt(0) === 0xfeff);
    check(
      "non-ASCII names survive intact",
      out.includes("web-münchen-01") && out.includes("日本-db-02"),
      out,
    );

    // The AWS bulk template is parsed by the Pricing Calculator, not opened in
    // Excel — a BOM would corrupt the first header it reads
    captured.length = 0;
    ctx.downloadCsv("Service Name,Region\nEC2,us-east-1", "bulk.csv", {
      bom: false,
    });
    check(
      "bom:false omits it, so a machine-read file starts at its header",
      captured[0].startsWith("Service Name"),
      JSON.stringify(captured[0].slice(0, 20)),
    );

    ctx.document.createElement = realCreateElement;

    // Round trip: users are told to fix the no-match export and re-upload it, so
    // our own parser must cope with the BOM we now write
    vm.runInContext(
      'parseCSV("\\uFEFFVM Name,CPU Count,Memory (GB)\\nweb-1,2,8")',
      ctx,
    );
    const reHeaders = vm.runInContext("columnHeaders", ctx);
    check(
      "re-uploading our own BOM'd CSV keeps the first header intact",
      reHeaders[0] === "VM Name",
      JSON.stringify(reHeaders),
    );
  }

  // Copy-to-clipboard: must agree with the screen, like the exports do
  console.log("[copy to clipboard]");
  {
    let copied = null;
    ctx.navigator = {
      clipboard: {
        writeText: (t) => {
          copied = t;
          return Promise.resolve();
        },
      },
    };

    // Filter to the 5 db rows, sorted descending by VM Name
    ctx._previewFilterChanged("db-");
    await new Promise((r) => setTimeout(r, 250));
    ctx.copyPreviewToClipboard();
    await new Promise((r) => setTimeout(r, 20));

    const lines = copied.split("\n");
    check(
      "tab-separated, so it pastes into spreadsheet cells",
      lines[0].includes("\t") && !lines[0].includes(","),
      lines[0],
    );
    check(
      "copies every matching row, not just the 20 rendered",
      lines.length === 6, // header + 5 db rows
      `${lines.length} lines`,
    );
    check(
      "respects the filter (no web- rows)",
      !copied.includes("web-"),
      copied.slice(0, 120),
    );
    check(
      "follows the preview's sort order",
      lines[1].startsWith("db-05") && lines[5].startsWith("db-01"),
      `${lines[1].split("\t")[0]} … ${lines[5].split("\t")[0]}`,
    );

    ctx._previewFilterChanged("");
    await new Promise((r) => setTimeout(r, 250));
    ctx.copyPreviewToClipboard();
    await new Promise((r) => setTimeout(r, 20));
    check(
      "unfiltered copy takes all 25 rows",
      copied.split("\n").length === 26,
      `${copied.split("\n").length} lines`,
    );

    // A pasted cell lands in a spreadsheet exactly like a downloaded one, so the
    // clipboard needs the same formula-injection guard the CSV export has. The
    // value comes from an uploaded file.
    const evil = [
      { "VM Name": "=cmd|'/c calc'!A1", "CPU Count": "2" },
      { "VM Name": "+1+1", "CPU Count": "2" },
      { "VM Name": "safe-01", "CPU Count": "2" },
    ];
    const tsv = ctx.buildPreviewTsv(evil, ["VM Name", "CPU Count"]);
    const cells = tsv.split("\n").map((l) => l.split("\t")[0]);
    check(
      "a formula cell is neutralised in the clipboard, not just in the CSV",
      cells[1] === "'=cmd|'/c calc'!A1" && cells[2] === "'+1+1",
      JSON.stringify(cells),
    );
    check("an ordinary name is left alone", cells[3] === "safe-01");
  }

  // What optimizing bought, per provider — never summed across providers, since
  // the same VM appears once per provider
  console.log("[sizing savings]");
  {
    const rows = [
      {
        "VM Name": "a",
        "CPU Count": "8",
        "Memory (GB)": "32",
        "AWS Like-to-Like Instance": "m5.2xlarge",
        "AWS Like-to-Like vCPUs": 8,
        "AWS Like-to-Like Memory (GiB)": 32,
        "AWS Optimized Instance": "m5.xlarge",
        "AWS Optimized vCPUs": 4,
        "AWS Optimized Memory (GiB)": 16,
      },
      {
        "VM Name": "b",
        "CPU Count": "2",
        "Memory (GB)": "8",
        "AWS Like-to-Like Instance": "m5.large",
        "AWS Like-to-Like vCPUs": 2,
        "AWS Like-to-Like Memory (GiB)": 8,
        "AWS Optimized Instance": "m5.xlarge", // upsized
        "AWS Optimized vCPUs": 4,
        "AWS Optimized Memory (GiB)": 16,
      },
      {
        "VM Name": "c", // no match — must not contribute
        "CPU Count": "2",
        "Memory (GB)": "8",
        "AWS Like-to-Like Instance": "No data available",
        "AWS Like-to-Like vCPUs": "",
        "AWS Like-to-Like Memory (GiB)": "",
        "AWS Optimized Instance": "No data available",
        "AWS Optimized vCPUs": "",
        "AWS Optimized Memory (GiB)": "",
      },
    ];
    const saved = ctx.computeSizingSavings(rows);
    check(
      "nets downsizing against upsizing, skipping no-match rows",
      saved.length === 1 &&
        saved[0].provider === "AWS" &&
        saved[0].vcpus === 2 && // (8-4) + (2-4)
        saved[0].memory === 8 && // (32-16) + (8-16)
        saved[0].rows === 2,
      JSON.stringify(saved),
    );
    check(
      "baseline is the like-for-like recommendation when there is one",
      saved[0].baseline === "like-for-like",
    );

    // Optimized-only run: nothing to compare against but the current size
    const optOnly = [
      {
        "VM Name": "a",
        "CPU Count": "8",
        "Memory (GB)": "32",
        "AWS Optimized Instance": "m5.xlarge",
        "AWS Optimized vCPUs": 4,
        "AWS Optimized Memory (GiB)": 16,
      },
    ];
    const savedOpt = ctx.computeSizingSavings(optOnly);
    check(
      "falls back to the current size when there is no like-for-like column",
      savedOpt.length === 1 &&
        savedOpt[0].vcpus === 4 &&
        savedOpt[0].memory === 16 &&
        savedOpt[0].baseline === "current size",
      JSON.stringify(savedOpt),
    );

    check(
      "a like-for-like-only run has no savings to report",
      ctx.computeSizingSavings([
        {
          "AWS Like-to-Like Instance": "m5.large",
          "AWS Like-to-Like vCPUs": 2,
        },
      ]).length === 0,
    );
  }

  // One-click relax: turn the Nearest Miss diagnosis into an action
  console.log("[relax suggestion]");
  {
    const NM = "AWS Nearest Miss";
    const INST = "AWS Like-to-Like Instance";
    const row = (name, miss) => ({
      "VM Name": name,
      [INST]: "No data available",
      [NM]: miss,
    });

    check(
      "parses the labels back out of the cell",
      JSON.stringify(
        ctx.parseRelaxLabels(
          "m7i.large (2 vCPU / 8 GB) — relax: current-generation only, exclude types",
        ),
      ) === JSON.stringify(["current-generation only", "exclude types"]),
    );
    check(
      "a miss with no blocker yields no labels",
      ctx.parseRelaxLabels("m7i.large (2 vCPU / 8 GB)").length === 0,
    );

    // 3 rows blocked by current-gen alone, 1 by exclude types alone, and 1 by
    // BOTH — the last cannot be rescued by a single change and must not count.
    const results = [
      row("a", "m7i.large (2 vCPU / 8 GB) — relax: current-generation only"),
      row("b", "m7i.large (2 vCPU / 8 GB) — relax: current-generation only"),
      row("c", "m7i.large (2 vCPU / 8 GB) — relax: current-generation only"),
      row("d", "m7i.large (2 vCPU / 8 GB) — relax: exclude types"),
      row(
        "e",
        "m7i.large (2 vCPU / 8 GB) — relax: current-generation only, exclude types",
      ),
    ];
    const suggestion = ctx.computeRelaxSuggestion(results);
    check(
      "picks the filter that rescues the most rows",
      suggestion &&
        suggestion.label === "current-generation only" &&
        suggestion.rescues === 3,
      JSON.stringify(suggestion),
    );
    check(
      "a row blocked by two filters is not counted as rescuable",
      suggestion.rescues === 3 && suggestion.unmatched === 5,
      JSON.stringify(suggestion),
    );
    check(
      "maps the label to the checkbox that turns it off",
      suggestion.control.id === "currentGenerationOnly",
    );

    // A matched row means nothing to relax
    check(
      "no suggestion when everything matched",
      ctx.computeRelaxSuggestion([
        { "VM Name": "ok", [INST]: "m5.large", [NM]: "" },
      ]) === null,
    );

    ctx.updateRelaxSuggestion(results);
    const panel = ctx.document.getElementById("relaxSuggestion");
    check(
      "panel offers the action",
      !panel.classes.has("hidden") &&
        panel.innerHTML.includes("current-generation only") &&
        panel.innerHTML.includes("applyRelaxSuggestion()"),
      panel.innerHTML,
    );

    // Applying it unchecks the box; regenerate is gated elsewhere (no csvData)
    const box = ctx.document.getElementById("currentGenerationOnly");
    box.checked = true;
    ctx.applyRelaxSuggestion();
    check("applying unchecks the filter", box.checked === false);

    ctx.updateRelaxSuggestion([
      { "VM Name": "ok", [INST]: "m5.large", [NM]: "" },
    ]);
    check(
      "panel hides when there is nothing to suggest",
      panel.classes.has("hidden"),
    );
  }

  // Guard the migration away from native dialogs: they block the page, ignore
  // the theme, and cannot be styled or dismissed by code.
  //
  // Every first-party module, discovered rather than listed — a hand-written list
  // silently stops covering whatever is added next (it had already missed the
  // three provider-specific files, which is exactly where alert() lived).
  //
  // ALL THREE are banned, not just alert(). Banning only alert() is how a
  // confirm() in the manual-entry list survived the 3.5 migration and lived
  // until 3.7: the guard was never looking for it.
  const productSources = [];
  for (const dir of ["js/base", "js/aws", "js/azure", "js/gcp"]) {
    for (const file of fs.readdirSync(path.join(REPO, dir))) {
      if (file.endsWith(".js") && !file.endsWith("-data.js")) {
        productSources.push(`${dir}/${file}`);
      }
    }
  }
  // The guard is only as honest as its stripper, so test the stripper. Each of
  // these is a way the previous regex version reported safety it had not checked
  // — or condemned code that was never there.
  const sees = (src) => /\balert\s*\(/.test(stripComments(src));
  check(
    "a URL in a string does not hide a call on the same line",
    sees(`const help = "https://example.test"; alert("boom");`),
  );
  check(
    "nor does a URL in a template literal",
    sees("const help = `https://example.test`; alert('boom');"),
  );
  check(
    "comment-like text inside a string is not treated as a comment",
    sees(`const s = "/* not a comment */"; alert(1);`),
  );
  check(
    "an escaped quote does not end the string early",
    sees(`const s = "he said \\"//\\""; alert(1);`),
  );
  check(
    "a line comment is still removed",
    !sees(`// alert(1) — removed in 3.6\nconst x = 1;`),
  );
  check(
    "a block comment is still removed",
    !sees(`/* alert(1) lived here once */\nconst x = 1;`),
  );
  check(
    "and a call mentioned only in a comment is not condemned",
    !sees(`/*\n * Do not use alert( — see showToast.\n */\nshowToast("hi");`),
  );
  // A regex literal's own slashes sit next to each other outside any string, so
  // a string-aware-but-regex-blind scanner reads them as a line comment and eats
  // the rest of the line — taking the banned call with it.
  check(
    "a regex literal containing slashes does not hide a call after it",
    sees(`const s = url.replace(/\\/\\//g, "/"); alert(1);`),
  );
  check(
    "nor does a slash inside a character class",
    sees(`const s = url.split(/[/]/); alert(1);`),
  );
  check(
    "a regex is still recognised after a keyword",
    sees(`function f(s) { return /x/.test(s); } alert(1);`),
  );
  // The other half of the judgement: division must NOT be read as a regex, or
  // the scanner swallows real code looking for a closing slash that never comes.
  check(
    "division is not mistaken for a regex",
    sees(`const half = total / 2; const q = a / b; alert(1);`),
  );
  check(
    "and a comment after a division is still stripped",
    !sees(`const half = total / 2; // alert(1)\nconst x = 1;`),
  );
  // A template's ${…} is code, not string content — and code may contain another
  // template. A scanner that ends the literal at the next backtick it sees ends
  // it on the NESTED one, resumes at top level mid-substitution, and reads that
  // template's text as source: a "//" in there then eats the rest of the line.
  check(
    "a template nested inside a substitution does not hide a call after it",
    sees("const a = `${cond ? `//` : `q`}`; alert(1);"),
  );
  check(
    "nor does a substitution nested two deep",
    sees("const a = `${x ? `${y ? `//` : `z`}` : ``}`; alert(1);"),
  );
  check(
    "an object literal inside a substitution does not end it early",
    sees("const a = `${JSON.stringify({ u: `//` })}`; alert(1);"),
  );
  // The inverse: a substitution is real code, so a real comment inside one must
  // still be stripped — otherwise the guard condemns a call that was commented out.
  check(
    "a comment inside a substitution is still stripped",
    !sees("const a = `${/* alert(1) */ x}`;"),
  );

  for (const dialog of ["alert", "confirm", "prompt"]) {
    // \b, not [^.\w]: the latter treats the dot as a word character, so
    // `window.alert(` — the very thing being banned — would slip through.
    const pattern = new RegExp(`\\b${dialog}\\s*\\(`);
    const offenders = productSources.filter((rel) => {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      return pattern.test(stripComments(src));
    });
    check(
      `no window.${dialog}() left in the product`,
      offenders.length === 0,
      `still calling ${dialog}(): ${offenders.join(", ")}`,
    );
  }

  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// The storage panel's markup builder (src/ui/storage-manager-ui.js, 3.21 phase 1).
// Covered here: byte formatting, one row per owned key with the right state and
// enabled control, escaping of any text that reaches the markup, and no inline
// handler attributes (CLAUDE rule 5). The two-step clear flow needs a live DOM and
// is covered by the e2e suite instead.
const { REPO, buildEngineContext, makeChecker } = require("../harness");

const ctx = buildEngineContext({
  scripts: [
    "src/shared/storage-keys.js",
    "src/shared/storage-manager.js",
    "src/shared/app-core.js",
  ],
  label: "storage-manager-ui",
});
ctx.ctx.document = {
  addEventListener() {},
  getElementById() {
    return null;
  },
};
ctx.load("src/ui/storage-manager-ui.js");

const { check, state } = makeChecker();
const { run } = ctx;

check(
  "formats bytes below one KB as bytes",
  run("formatStorageBytes(0)") === "0 B" &&
    run("formatStorageBytes(1023)") === "1023 B",
);
check(
  "formats KB and MB at their thresholds",
  run("formatStorageBytes(1024)") === "1.0 KB" &&
    run("formatStorageBytes(1048576)") === "1.00 MB",
);

const owned = Object.keys(run("STORAGE_KEYS"));
const usage = {
  items: owned.map((id, i) => ({
    id,
    key: run(`STORAGE_KEYS.${id}`),
    present: i === 0,
    bytes: i === 0 ? 2048 : 0,
  })),
  totalBytes: 2048,
};
const html = run("renderStorageRows")(usage);

check(
  "renders one table row per owned key",
  (html.match(/<tr>/g) || []).length === owned.length,
);
check(
  "a stored key shows as stored with an enabled Clear button",
  /stored<\/td>[\s\S]*?<td>2\.0 KB<\/td>[\s\S]*?data-storage-id="[^"]+">Clear</.test(
    html,
  ) && !/data-storage-id="[^"]+" disabled/.test(html.split("<tr>")[1]),
);
check(
  "an empty key shows as empty with a disabled Clear button",
  html.split("<tr>")[2].includes("empty") &&
    html.split("<tr>")[2].includes(" disabled>"),
);

const hostile = run("renderStorageRows")({
  items: [
    {
      id: '"><img src=x onerror=alert(1)>',
      key: "<img src=x onerror=alert(2)>",
      present: true,
      bytes: 0,
    },
  ],
  totalBytes: 0,
});
check(
  "escapes a hostile key and id before they reach the markup",
  !hostile.includes("<img") && hostile.includes("&lt;img"),
);
const attrNamesOnly = (s) => s.replace(/="[^"]*"/g, '=""');
const inTagHandler = /<[^>]*\son[a-z]+\s*=/i;
check(
  "emits no inline event handler attributes on any tag",
  !inTagHandler.test(attrNamesOnly(html)) &&
    !inTagHandler.test(attrNamesOnly(hostile)),
);

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("storage-manager-ui-test: all checks passed");
}

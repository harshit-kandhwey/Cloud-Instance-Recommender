// json-download suite: the one place a JSON document becomes a downloaded file
// (downloadJson, used by the snapshot export). The e2e spec drives it in a browser; this
// runs it in the sandbox so the function is executed and its output asserted: file name,
// content byte for byte, a JSON type, and no byte-order mark (a program reads it back).
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { run, ctx, downloads } = buildContext();

downloads.length = 0;
ctx.__text = JSON.stringify({ format: "x", rows: [{ "VM Name": 'a, "b"' }] });
run('downloadJson(__text, "fleet_snapshot_q4.json")');

const d = downloads[0];
check("one file is offered", downloads.length === 1, String(downloads.length));
check(
  "it carries the name it was given",
  d && d.name === "fleet_snapshot_q4.json",
  d && d.name,
);
check(
  "its content is the text exactly, with no byte-order mark",
  d && d.blob.content === ctx.__text && d.blob.content.charCodeAt(0) !== 0xfeff,
);
check(
  "its type is JSON",
  d && /^application\/json/.test(d.blob.type),
  d && d.blob.type,
);

if (state.failures) {
  console.error(`\njson-download: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\njson-download: all checks passed");
  process.exitCode = 0;
}

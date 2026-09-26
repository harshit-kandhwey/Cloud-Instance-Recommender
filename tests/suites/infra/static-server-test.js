// The E2E rig serves the site through scripts/testing/static-server.js. A bad
// port must fail loudly at startup (a silent bind on some other port shows up
// as an unexplained Playwright timeout), and a request must never read outside
// the served root.
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { makeChecker } = require("../harness");
const {
  createServer,
  parseArgs,
} = require("../../../scripts/testing/static-server");

const { check, state } = makeChecker();

function throwsMessage(fn) {
  try {
    fn();
    return "";
  } catch (err) {
    return String(err.message);
  }
}

function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: rawPath }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            type: res.headers["content-type"],
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      })
      .on("error", reject);
  });
}

async function main() {
  const savedPort = process.env.PORT;
  delete process.env.PORT;

  console.log("[parseArgs: port]");
  check("defaults to 8080", parseArgs([]).port === 8080);
  check("--port is applied", parseArgs(["--port", "9123"]).port === 9123);
  for (const bad of ["abc", "0", "65536", "-1", "1.5", "", "  "]) {
    check(
      `--port ${JSON.stringify(bad)} is rejected`,
      /invalid port/.test(throwsMessage(() => parseArgs(["--port", bad]))),
    );
  }
  check(
    "a bare trailing --port is rejected",
    /invalid port/.test(throwsMessage(() => parseArgs(["--port"]))),
  );
  process.env.PORT = "7001";
  check("PORT is the fallback", parseArgs([]).port === 7001);
  check(
    "an explicit --port beats PORT",
    parseArgs(["--port", "7002"]).port === 7002,
  );
  process.env.PORT = "nope";
  check(
    "an invalid PORT is rejected",
    /invalid port/.test(throwsMessage(() => parseArgs([]))),
  );
  check(
    "an explicit --port ignores an invalid PORT",
    parseArgs(["--port", "7003"]).port === 7003,
  );
  delete process.env.PORT;

  console.log("[parseArgs: root]");
  check(
    "--root is resolved to an absolute path",
    parseArgs(["--root", "."]).root === path.resolve("."),
  );
  for (const argv of [
    ["--root"],
    ["--root", "--port", "9000"],
    ["--root", ""],
  ]) {
    check(
      `${JSON.stringify(argv)} is rejected as a missing root`,
      /invalid root/.test(throwsMessage(() => parseArgs(argv))),
    );
  }

  console.log("[createServer]");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cir-static-"));
  const root = path.join(base, "site");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "index.html"), "<p>home</p>");
  fs.writeFileSync(path.join(root, "app.js"), "var a = 1;");
  fs.writeFileSync(path.join(root, "data.unknownext"), "x");
  fs.writeFileSync(path.join(base, "secret.txt"), "outside the root");
  fs.mkdirSync(path.join(root, "dir"));

  let symlinked = false;
  try {
    fs.symlinkSync(
      path.join(base, "secret.txt"),
      path.join(root, "link.txt"),
      "file",
    );
    symlinked = true;
  } catch {
    // Windows without symlink privilege: the symlink case is skipped, not faked.
  }

  const server = createServer(root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const js = await get(port, "/app.js");
    check(
      "a file is served with 200",
      js.status === 200 && js.body === "var a = 1;",
    );
    check(
      "a .js file gets the javascript type",
      /^text\/javascript/.test(js.type),
    );
    const root200 = await get(port, "/");
    check(
      "a trailing slash serves index.html",
      root200.status === 200 && root200.body === "<p>home</p>",
    );
    const unk = await get(port, "/data.unknownext");
    check(
      "an unknown extension is octet-stream, not executable",
      unk.type === "application/octet-stream",
    );
    check(
      "a missing file is 404",
      (await get(port, "/nope.js")).status === 404,
    );
    check(
      "a directory without a trailing slash is 404",
      (await get(port, "/dir")).status === 404,
    );
    const trav = await get(port, "/..%2fsecret.txt");
    check(
      "an encoded ../ traversal is refused and leaks nothing",
      trav.status === 403 && !trav.body.includes("outside the root"),
      `${trav.status} ${trav.body}`,
    );
    check(
      "a NUL byte is refused",
      (await get(port, "/app.js%00")).status === 403,
    );
    check(
      "a malformed escape is 400",
      (await get(port, "/%E0%A4%A")).status === 400,
    );
    if (symlinked) {
      const link = await get(port, "/link.txt");
      check(
        "a symlink pointing outside the root is refused",
        link.status === 403 && !link.body.includes("outside the root"),
        `${link.status} ${link.body}`,
      );
    } else {
      console.log("  (symlink case skipped: symlink creation not permitted)");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
    if (savedPort === undefined) delete process.env.PORT;
    else process.env.PORT = savedPort;
  }
}

main().then(
  () => {
    if (state.failures) {
      console.error(`\nstatic-server: ${state.failures} check(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log("\nstatic-server: all checks passed");
      process.exitCode = 0;
    }
  },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);

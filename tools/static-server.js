// Minimal zero-dependency static file server for the Playwright E2E rig.
//
// Why this exists: the E2E specs need the site served over HTTP (a `new Worker`
// and the region scripts fail on file://), and CI has no Python — so the usual
// `python -m http.server` is not available there. This is Node-only, no deps,
// and it is a *test-time* tool: nothing here ships to the served page, so it
// does not touch the no-build-step rule.
//
//   node tools/static-server.js [--port 8080] [--root .]
//
// Playwright's `webServer` block launches and tears it down; run it by hand for
// a manual smoke. Root is the repo root by default; paths are resolved inside
// it and traversal outside it is refused.

const http = require("http");
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = { port: 8080, root: path.join(__dirname, "..") };
  // Reject a non-integer port up front: Number(undefined)/Number("abc") is NaN,
  // and listen(NaN) silently binds an arbitrary free port — so Playwright's
  // webServer URL would point at a port nothing serves and fail as a timeout.
  const setPort = (v) => {
    // Reject a missing/blank value first: Number("") and Number("  ") are 0,
    // which would pass the integer check and bind an arbitrary ephemeral port.
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`static-server: invalid port ${JSON.stringify(v)}`);
    }
    const n = Number(v);
    // Reject 0 too: listen(0) selects an arbitrary ephemeral port, so Playwright
    // (and any caller using the configured URL) would probe a port nothing serves.
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`static-server: invalid port ${JSON.stringify(v)}`);
    }
    out.port = n;
  };
  let portFromFlag = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") {
      setPort(argv[++i]);
      portFromFlag = true;
    } else if (argv[i] === "--root") {
      // Validate as strictly as --port: a bare `--root` with no value would call
      // path.resolve(undefined) and throw an opaque TypeError, and later a
      // nonexistent dir fails deep in fs.realpathSync — both surface to
      // Playwright as an unexplained webServer startup timeout. A recognized flag
      // in the value slot (`--root --port 9000`) is a missing value too, not a
      // directory literally named "--port".
      const v = argv[++i];
      if (
        typeof v !== "string" ||
        v.trim() === "" ||
        v === "--port" ||
        v === "--root"
      ) {
        throw new Error(`static-server: invalid root ${JSON.stringify(v)}`);
      }
      out.root = path.resolve(v);
    }
  }
  // PORT is a fallback only: an explicit --port on the command line wins over
  // the environment, not the other way round.
  if (!portFromFlag && process.env.PORT) setPort(process.env.PORT);
  return out;
}

// Only the content types this static site actually serves. Unknown extensions
// fall back to octet-stream, which the browser will not execute — deliberate.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

function createServer(root) {
  // Resolve the root once so the per-request symlink check compares canonical
  // paths. If root itself is a symlink, its real location is the boundary.
  const realRoot = fs.realpathSync(root);
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";

    // Resolve inside root and refuse anything that escapes it (path traversal).
    // A NUL byte survives decodeURIComponent and the traversal check but makes
    // fs.stat throw synchronously in current Node — refuse it here so a crafted
    // request can't take the server down mid-run.
    const filePath = path.join(root, pathname);
    const relative = path.relative(root, filePath);
    if (
      pathname.includes("\0") ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    // The lexical check above is on the requested path; it cannot see where a
    // symlink INSIDE root points. Resolve the real path and confirm it still
    // sits under the real root, then stat/stream that canonical path — otherwise
    // a symlink to /etc/passwd (or the repo's own .git) would be served.
    fs.realpath(filePath, (rpErr, realPath) => {
      if (rpErr) {
        res.writeHead(404).end("Not found");
        return;
      }
      const relReal = path.relative(realRoot, realPath);
      if (
        relReal === ".." ||
        relReal.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relReal)
      ) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      fs.stat(realPath, (err, stat) => {
        if (err || !stat.isFile()) {
          res.writeHead(404).end("Not found");
          return;
        }
        const type =
          MIME[path.extname(realPath).toLowerCase()] ||
          "application/octet-stream";
        res.writeHead(200, { "Content-Type": type });
        // Without an error listener, a read failure after stat (file removed, a
        // disk error) emits 'error' with no handler and takes the process down —
        // which would fail every remaining spec with an opaque connection error.
        const stream = fs.createReadStream(realPath);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      });
    });
  });
}

if (require.main === module) {
  const { port, root } = parseArgs(process.argv.slice(2));
  // Bind to loopback only: this is a test-time server that serves readable files
  // under root, so it must not accept connections from other hosts on the network.
  createServer(root).listen(port, "127.0.0.1", () => {
    console.log(`static-server: serving ${root} at http://localhost:${port}`);
  });
}

module.exports = { createServer, parseArgs, MIME };

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
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new Error(`static-server: invalid port ${JSON.stringify(v)}`);
    }
    out.port = n;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") setPort(argv[++i]);
    else if (argv[i] === "--root") out.root = path.resolve(argv[++i]);
  }
  if (process.env.PORT) setPort(process.env.PORT);
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
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      const type =
        MIME[path.extname(filePath).toLowerCase()] ||
        "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      // Without an error listener, a read failure after stat (file removed, a
      // disk error) emits 'error' with no handler and takes the process down —
      // which would fail every remaining spec with an opaque connection error.
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    });
  });
}

if (require.main === module) {
  const { port, root } = parseArgs(process.argv.slice(2));
  createServer(root).listen(port, () => {
    console.log(`static-server: serving ${root} at http://localhost:${port}`);
  });
}

module.exports = { createServer, parseArgs, MIME };

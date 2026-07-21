# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest  | ✅ Yes    |

## Reporting a Vulnerability

This is a **client-side only** static web application. All data processing happens entirely in your browser — no data is sent to any server.

### What to Report

- Vulnerabilities in the HTML/JavaScript that could affect users (e.g., XSS through crafted CSV input)
- Sensitive data exposure in the codebase (API keys, credentials)
- Issues that allow malicious CSV files to execute arbitrary code

### How to Report

Please **do not** open a public issue for security vulnerabilities.

Use GitHub's **Private Vulnerability Reporting** feature:

1. Go to the [Security tab](../../security) of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details

Alternatively, email: **harshitkandhwey@gmail.com** with the subject line `[SECURITY] Cloud Instance Recommender`.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

| Stage            | Timeline                               |
| ---------------- | -------------------------------------- |
| Acknowledgement  | Within 48 hours                        |
| Status update    | Within 7 days                          |
| Fix / Resolution | Within 30 days (depending on severity) |

### Scope

**In scope:**

- XSS vulnerabilities from CSV parsing
- Data leakage through third-party script injection
- Content Security Policy bypasses

**Out of scope:**

- GitHub Pages infrastructure vulnerabilities (report to GitHub)
- Browser-specific security bugs (report to browser vendors)
- Social engineering attacks

## Third-Party Dependencies

Nothing is fetched from a CDN at runtime — the app's only third-party code is
vendored into the repository and served from our own origin, which is what lets
the pages keep a restrictive Content Security Policy.

| Library                                                    | Version | Vendored as                      | Used for                       |
| ---------------------------------------------------------- | ------- | -------------------------------- | ------------------------------ |
| [SheetJS (xlsx)](https://cdn.sheetjs.com/)                 | 0.20.3  | `js/vendor/xlsx.full.min.js`     | Reading uploaded `.xlsx` files |
| [xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) | 0.18.5  | `js/vendor/xlsx-js-style.min.js` | Writing styled Excel exports   |

**The vendored artifacts are the source of truth for what version is deployed** —
not a lockfile, since these are not npm dependencies at runtime. Each build's
version is in its header comment and in `XLSX.version` at runtime.

### Artifact integrity

These files are **executable code shipped to every visitor**, so a tampered
download would become client-side code under our own origin — which is also
where the CSP trusts it from. The checksums of what is committed:

| File                             | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `js/vendor/xlsx.full.min.js`     | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |
| `js/vendor/xlsx-js-style.min.js` | `af16b32bf790003c0a6bc912c70706396ec495cf64dfa144c607e7b705bd12c0` |

These are the checksums of the bytes **as committed**. `.gitattributes` marks
`js/vendor/**` as `-text`, so git performs no line-ending translation on these
files. Without that, a checkout on Windows rewrites their newlines, and a
checksum recorded from such a working copy matches on no other machine.

Verify at any time:

```bash
sha256sum js/vendor/*.js              # macOS: shasum -a 256 js/vendor/*.js
```

(Every `.js` under `js/vendor/`, not just `*.min.js` — the integrity test checks
them all, and a future unminified bundle must not slip past the manual check.)

**Replacing a vendored bundle** — never skip a step:

1. Download only from the upstream project's own distribution
   ([cdn.sheetjs.com](https://cdn.sheetjs.com/) for SheetJS; the GitHub release
   assets for `xlsx-js-style`). Not from a mirror, a package aggregator, or a
   search result.
2. **Record the exact upstream URL and the checksum you downloaded** in the pull
   request, and paste the `sha256sum` output of the file you are committing. A
   reviewer must be able to re-download the same URL and reproduce the hash.
3. Update the table above with the new version and checksum in the same commit as
   the file, so the two can never drift apart.
4. Run `node tests/run-all.js` — the upload and Excel-export suites exercise both
   libraries.

If a checksum cannot be reproduced from the upstream URL, treat the artifact as
compromised and do not commit it.

The dev dependencies in `package.json` (TypeScript, Prettier) never reach a
user's browser; they exist only for type-checking and formatting.

### CVE watch

Checked **monthly, and again before each release**:

1. Read the deployed versions out of the vendored files (see the table above).
2. Check for advisories against those versions — [GitHub Advisory Database](https://github.com/advisories?query=sheetjs),
   the [SheetJS release notes](https://cdn.sheetjs.com/), and the
   [xlsx-js-style releases](https://github.com/gitbrent/xlsx-js-style/releases).
   Note that `xlsx-js-style` is a fork of an older SheetJS (0.18.x), so a SheetJS
   advisory can apply to it even when `xlsx.full` is already patched.
3. If a fix is needed, download the new build from the vendor, replace the file,
   run `node tests/run-all.js` (the xlsx upload and Excel export suites cover
   both libraries), and update the table above.

#### Assessment of record — 2026-07-19 (pre-3.8 release)

| Bundle                           | Version | CVE-2023-30533<br>(prototype pollution,<br>fixed 0.19.3) | CVE-2024-22363<br>(ReDoS, fixed 0.20.2) |
| -------------------------------- | ------- | -------------------------------------------------------- | --------------------------------------- |
| `js/vendor/xlsx.full.min.js`     | 0.20.3  | patched                                                  | patched                                 |
| `js/vendor/xlsx-js-style.min.js` | 0.18.5  | **below the fix**                                        | **below the fix**                       |

Both advisories are in the **read** path — they need a maliciously crafted file
to be parsed. `xlsx-js-style` is a fork of SheetJS 0.18.x and predates both
fixes, so it must never parse input. It does not: it is a **writer only**.

That is not merely a convention, because it very nearly failed. Both bundles
define `window.XLSX` **and both expose `read()`**, so whichever loaded last owned
the global — and `ensureXlsxLoaded()` short-circuited on `if (window.XLSX)`. This
ordinary sequence therefore parsed an untrusted upload with the unpatched fork:

> upload a CSV → generate → **Download Results (Excel)** (loads 0.18.5) →
> **upload an .xlsx** (guard sees a truthy `window.XLSX`, parses with 0.18.5)

Fixed by pinning each side to the engine it loaded, which the two bundles allow
because they are separate objects: `window._xlsxParser` is always the full build
and every read goes through it; `window._xlsxWriter` is the styling engine and
every write goes through that. Neither path reads the bare global any more.
`tests/suites/xlsx-engine-isolation-test.js` pins this, including that the two
bundles genuinely collide — so the day that stops being true, the guard says so
rather than quietly becoming decorative.

**Residual risk:** the styling fork is unpatched and upstream is dormant, so its
safety here rests on it never parsing input. Until it is replaced, any change
that gives it a file to read reintroduces both CVEs — the rule contributors need
is in [CONTRIBUTING.md](CONTRIBUTING.md) under Code Style ("Only one engine may
parse a file"). Replacing it is scheduled in **[ROADMAP.md](ROADMAP.md) § 3.11 —
"Replace the unpatched styling engine"**, which also lists the dependent work
(both styled writers, this assessment and the checksum table, the isolation
suite, and a `sw.js` `CACHE` bump for the removed bundle).

Never run a formatter over `js/vendor/` — the files must stay byte-identical to
the upstream artifact so they can be diffed against it.

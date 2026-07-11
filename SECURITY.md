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

Never run a formatter over `js/vendor/` — the files must stay byte-identical to
the upstream artifact so they can be diffed against it.

# Contributing to Cloud Instance Recommender

Thank you for your interest in contributing! This document explains how to get involved.

## Ways to Contribute

- **Bug reports** — Found something broken? Open an issue using the bug report template.
- **Feature requests** — Have an idea? Open an issue using the feature request template.
- **Data updates** — Cloud instance data changes with new generation releases. PRs to refresh instance data are welcome.
- **UI/UX improvements** — Suggest or implement better user experience.
- **Documentation** — Improve the README, user guide, or inline code comments.

## Getting Started

This is a **pure static website** — the site itself has no build step and no
compilation. What you clone is what gets served, so you can open any HTML file
in a browser and it works.

```bash
git clone https://github.com/harshit-kandhwey/Cloud-Instance-Recommender.git
cd Cloud-Instance-Recommender
# Open any HTML file directly in a browser, or serve with:
python -m http.server 8080
# Then visit http://localhost:8080
```

npm is used **only for development tooling** — Prettier and the TypeScript
checker, both of which CI runs. Nothing from `node_modules` ever reaches a
user's browser, and no npm step is needed to run the site. To use the tooling:

```bash
npm ci                      # install the dev dependencies (Prettier, TypeScript)
npm run format              # or format:check — CI fails on unformatted files
npm run typecheck
```

## Project Structure

```
├── index.html              # Landing page
├── aws.html                # AWS recommender
├── azure.html              # Azure recommender
├── gcp.html                # GCP recommender
├── multicloud.html         # Multi-cloud comparison
├── app-portfolio.html      # App Portfolio dashboard + executive Excel
├── user-guide.html         # Interactive user guide
│
├── manifest.json           # PWA manifest (installable app)
├── sw.js                   # Service worker (offline cache) — see note below
├── icon.svg                # App icon
│
├── assets/
│   └── templates/aws/      # AWS Pricing Calculator bulk upload templates
│
├── css/
│   ├── theme.css           # Light/dark theme tokens — new colors go here
│   ├── style.css           # Main styles (uses var(--token) only)
│   ├── portfolio.css       # App Portfolio dashboard styles
│   └── index_style.css     # Landing page styles
│
├── logos/                  # Cloud provider logos
│
├── tools/
│   └── split-data.js       # Splits monolithic data files into per-region files
│
├── tests/                  # Plain-Node suites + golden compare (see tests/README.md)
│
└── js/
    ├── pwa-register.js     # Service-worker registration (loaded by every page)
    ├── base/               # Shared logic (modules load in the order listed
    │   │                     in the HTML pages; they share the global scope)
    │   ├── base-instance-selector.js       # + lazy region loading
    │   ├── instance-selector-factory.js
    │   ├── rule-engine.js
    │   ├── recommendation-worker.js        # Web Worker batch processing
    │   ├── app-core.js                     # State, mapping tables, readiness, regions
    │   ├── ui-shell.js                     # Page init + accessibility
    │   ├── ingest.js                       # Upload (incl. drag & drop), parsing, column mapping
    │   ├── manual-entry.js
    │   ├── form-controls.js                # Filters + option readers
    │   ├── generate.js                     # Worker batch runner
    │   ├── preview.js
    │   ├── downloads.js                    # + App Portfolio handoff
    │   ├── presets.js                      # Filter presets (save/apply, localStorage)
    │   ├── xlsx-export.js                  # Styled results .xlsx export
    │   ├── scenario-compare.js             # Pin + diff two generation runs
    │   └── portfolio.js                    # App Portfolio (loaded only on app-portfolio.html)
    ├── vendor/             # Vendored libs + licenses. TWO SheetJS builds, and the
    │                       #   split matters: xlsx.full (patched) PARSES uploads,
    │                       #   xlsx-js-style (0.18.x fork) only WRITES styled Excel.
    │                       #   Keep byte-identical to upstream — never format them.
    ├── aws/                # Selector, UI, manifest + regions/ data (35 files)
    ├── azure/              # Selector, UI, manifest + regions/ data (60 files)
    └── gcp/                # Selector, UI, manifest + regions/ data (46 files)
```

## Updating Instance Data

Instance data is auto-generated from provider APIs — do not edit it manually. Each provider has a small manifest (`js/{p}/{p}-data.js` with the data date and region key list) plus one file per region under `js/{p}/regions/`.

To refresh the data:

1. Generate the fresh **monolithic** `{provider}-data.js` as before (PowerShell scripts documented in the internal wiki) and drop it in place of the manifest at `js/{provider}/{provider}-data.js` — the site keeps working in this state, so you can verify it before splitting
2. Run `node tools/split-data.js` — it rewrites the manifest and regenerates `js/{provider}/regions/`, removing region files that no longer exist upstream. The tool is idempotent (skips providers already in manifest form) and hard-fails rather than writing anything if the input doesn't parse cleanly
3. Verify with spot-checks on known instance types, then commit the manifest **and** the regenerated `regions/` files together

If the refresh **adds** a region, also add it to the hardcoded list the provider's selector filters through (`awsRegions` in `js/aws/aws-instance-selector.js`, the display-name map in `js/azure/azure-instance-selector.js`). Those lists feed the manual-entry region autocomplete, while the upload's region chips validate straight against the manifest — so a region that is only in the manifest is accepted from a CSV but never suggested for manual entry. `tests/suites/lazy-test.js` fails when the two disagree. If the refresh **removes** a region, bump `CACHE` in `sw.js` (see "Service Worker" below).

## Service Worker (offline support)

`sw.js` precaches the app shell (HTML + CSS + manifest + icon) and runtime-caches everything else same-origin with stale-while-revalidate, so code and data changes reach users automatically on their next online visit — ordinary changes need no service-worker action.

Three cases do need one:

- **Adding an HTML page or stylesheet** — add it to the `PRECACHE` list in `sw.js` so it works offline from the first install.
- **Forcing a clean re-precache** (e.g. after renaming or deleting shell files) — bump the `CACHE` version string in `sw.js`.
- **A data refresh that removes or renames region files** — bump `CACHE`. Ordinary data refreshes need no bump: changed manifests and region files are picked up by stale-while-revalidate (returning users see the previous data for one visit, then the new data). A _deleted_ file is the exception — revalidating it 404s, so the cache keeps serving the old copy indefinitely, and only a new `CACHE` evicts it. `tools/split-data.js` prints a warning naming every region file it prunes; if that warning appears, bump.

Note the service worker only registers on a secure context (GitHub Pages, `localhost`) — pages opened via `file://` simply skip it.

## Running Tests

```bash
node tests/run-all.js       # all suites + golden byte-compare
node tests/syntax-check.js  # syntax check over first-party JS
```

No framework or npm install needed — see [tests/README.md](tests/README.md) for how the harness works and when to regenerate goldens.

## Versioning and Releases

Versions live only in [CHANGELOG.md](CHANGELOG.md) and git tags — never in the pages, the README, or `package.json`. Every commit on `main` gets a version, a changelog row, and an annotated tag; releases are published per minor line. [RELEASING.md](RELEASING.md) is the full process, including the pre-publish checklist.

## Pull Request Guidelines

1. **Fork** the repository and create a branch from `main`
2. **Describe** what you changed and why in the PR description
3. **Test** your changes: run `node tests/run-all.js` (all suites + golden compare must pass — CI enforces this on every PR), and check the full flow in a browser with a sample CSV
4. **Keep PRs focused** — one logical change per PR
5. **Do not** commit generated data files unless you are refreshing instance data

## Code Style

- Plain HTML5, CSS3, and vanilla JavaScript (ES6+)
- No frameworks and no build step — the shipped site is raw HTML/CSS/JS. (npm exists for dev tooling only; see [Getting Started](#getting-started).)
- Keep functions small and focused
- Prefer `const` over `let`; avoid `var`
- Use descriptive variable names
- No comments explaining _what_ the code does — only add a comment when the _why_ is non-obvious

**Only one engine may parse a file.** Two SheetJS builds are vendored and both
define `window.XLSX` and both expose `read()`, but `xlsx-js-style` is a fork of
SheetJS 0.18.x that sits below the fixes for CVE-2023-30533 and CVE-2024-22363 —
both read-path issues. So the two are pinned apart:

- **Reading anything a user supplied** goes through `window._xlsxParser`
  (`ensureXlsxLoaded()` in `ingest.js`), which is always the patched full build.
- **Writing** goes through `window._xlsxWriter`, whichever engine that path
  loaded.

Never read through the bare `window.XLSX` — whichever bundle loaded last owns it,
so an export earlier in the session would decide which engine parses the next
upload. `tests/suites/xlsx-engine-isolation-test.js` enforces this; the reasoning
is in [SECURITY.md](SECURITY.md).

Formatting is Prettier's job, not yours: run `npm run format` before you commit (`npm run format:check` shows what it would change). CI runs the same check on every push and pull request and fails if anything is unformatted. `.prettierignore` keeps Prettier away from the vendored SheetJS builds and the generated region data — never reformat those.

## Input Format

The accepted input format includes these optional columns:
`App Name`, `ENV`, `OS`, `Workload`, `Compliance`, `Min Gen`, `Exclude`

`App Name` groups VMs by application (App Summary CSV + App Portfolio) and lets VMs inherit a workload from the app→workload mapping panel.

Any sample CSV templates in the repo or in the HTML `<pre>` previews should include all columns.

**Header matching.** Common variants (`vCPUs`, `RAM`, `Hostname`, …) are auto-mapped to the canonical names; the synonym table is `COLUMN_SYNONYMS` in `js/base/app-core.js`. Anything ambiguous or missing opens the mapping panel rather than being guessed at.

**Excel.** A multi-sheet workbook opens the sheet whose headers best look like an inventory — scored with `autoMatchHeaders`, see `pickBestSheet` in `js/base/ingest.js` — and a picker lets the user switch.

**Import presets** (`IMPORT_PRESETS`, `js/base/ingest.js`) auto-map a known tool's export — RVTools and AWS Application Discovery Service today. A preset identifies the format by headers that _only_ that tool ships, then names just what the generic matcher cannot work out for itself: the columns it would find ambiguous, the units the header hides, and (via `derive`) any canonical column the format carries only implicitly. ADS, for instance, reports memory _used_ in megabytes; the optimizer needs a percentage on a 0–100 scale, so the derivation is (used ÷ total) × 100.

Keep presets narrow — a preset that claims a file it has not really recognised will mis-map it silently, which is worse than falling back to the mapping panel.

**Build a preset against a real export, never against documentation.** Both existing presets exist because a real file contradicted what a specification would have told you: RVTools writes `Memory` with a thousands separator, so `parseFloat` silently returned a number 1000× too small; and its workbook's `vHost` sheet (the ESXi servers) outscored `vInfo` (the VMs) on generic column counting, so the wrong machines were loaded. Neither is discoverable by reasoning. If you cannot get a genuine export, do not write the preset.

**Memory units are converted only on explicit evidence:** a header that says so (`Memory (MB)`), or an import preset that knows the format's convention. When neither does, the values may only raise the _question_ — a fleet whose median memory is implausible as GB is reported in the input check with both answers offered (`convertMemoryToGb` / `keepMemoryAsGb`), and nothing is touched until one is given.

Do not add a code path that converts on the values alone. A real fleet of 512 GB–1 TB machines exists, and dividing it by 1024 corrupts it exactly as badly as leaving RVTools' MiB alone.

## Reporting Bugs

Please use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include:

- Browser and OS
- Steps to reproduce
- What you expected vs. what happened
- A sample CSV if relevant (anonymize sensitive data)

## License of Contributions

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). By submitting a pull request, you agree that:

1. Your contribution is provided under the project's license, and
2. You grant the maintainer a perpetual, worldwide, royalty-free right to use, modify, and **relicense** your contribution as part of this project (this keeps a future move to a more permissive license possible without tracking down every past contributor).

## Questions?

Open a [Discussion](../../discussions) or reach out at harshitkandhwey@gmail.com.

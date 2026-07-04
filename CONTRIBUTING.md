# Contributing to Cloud Instance Recommender

Thank you for your interest in contributing! This document explains how to get involved.

## Ways to Contribute

- **Bug reports** — Found something broken? Open an issue using the bug report template.
- **Feature requests** — Have an idea? Open an issue using the feature request template.
- **Data updates** — Cloud instance data changes with new generation releases. PRs to refresh instance data are welcome.
- **UI/UX improvements** — Suggest or implement better user experience.
- **Documentation** — Improve the README, user guide, or inline code comments.

## Getting Started

This is a **pure static website** — no build tools, no npm, no compilation.

```bash
git clone https://github.com/harshit-kandhwey/Cloud-Instance-Recommender.git
cd Cloud-Instance-Recommender
# Open any HTML file directly in a browser, or serve with:
python -m http.server 8080
# Then visit http://localhost:8080
```

## Project Structure

```
├── index.html              # Landing page
├── aws.html                # AWS recommender
├── azure.html              # Azure recommender
├── gcp.html                # GCP recommender
├── multicloud.html         # Multi-cloud comparison
├── user-guide.html         # Interactive user guide
│
├── docs/
│   └── user-guide.pdf      # PDF user guide
│
├── assets/
│   └── templates/aws/      # AWS Pricing Calculator bulk upload templates
│
├── css/
│   ├── theme.css           # Light/dark theme tokens — new colors go here
│   ├── style.css           # Main styles (uses var(--token) only)
│   └── index_style.css     # Landing page styles
│
├── tools/
│   └── split-data.js       # Splits monolithic data files into per-region files
│
└── js/
    ├── base/               # Shared logic (modules load in the order listed
    │   │                     in the HTML pages; they share the global scope)
    │   ├── base-instance-selector.js       # + lazy region loading
    │   ├── instance-selector-factory.js
    │   ├── rule-engine.js
    │   ├── recommendation-worker.js        # Web Worker batch processing
    │   ├── file-handler.js
    │   ├── app-core.js                     # State, mapping tables, readiness, regions
    │   ├── ui-shell.js                     # Page init + accessibility
    │   ├── ingest.js                       # Upload, parsing, column mapping
    │   ├── manual-entry.js
    │   ├── form-controls.js                # Filters + option readers
    │   ├── generate.js                     # Worker batch runner
    │   ├── preview.js
    │   └── downloads.js
    ├── vendor/             # Vendored third-party libs (SheetJS) + licenses
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

## Running Tests

```bash
node tests/run-all.js       # all suites + golden byte-compare
node tests/syntax-check.js  # syntax check over first-party JS
```

No framework or npm install needed — see [tests/README.md](tests/README.md) for how the harness works and when to regenerate goldens.

## Pull Request Guidelines

1. **Fork** the repository and create a branch from `main`
2. **Describe** what you changed and why in the PR description
3. **Test** your changes: run `node tests/run-all.js` (all suites + golden compare must pass — CI enforces this on every PR), and check the full flow in a browser with a sample CSV
4. **Keep PRs focused** — one logical change per PR
5. **Do not** commit generated data files unless you are refreshing instance data

## Code Style

- Plain HTML5, CSS3, and vanilla JavaScript (ES6+)
- No frameworks, no build steps, no npm
- Keep functions small and focused
- Prefer `const` over `let`; avoid `var`
- Use descriptive variable names
- No comments explaining _what_ the code does — only add a comment when the _why_ is non-obvious

## Input Format

The accepted input format includes these optional columns:
`ENV`, `OS`, `Workload`, `Compliance`, `Min Gen`, `Exclude`

Any sample CSV templates in the repo or in the HTML `<pre>` previews should include all columns. `.xlsx` uploads (first sheet) are also accepted, and common header variants (`vCPUs`, `RAM`, `Hostname`, …) are auto-mapped to the canonical names — the synonym table lives in `COLUMN_SYNONYMS` in `js/base/main-script.js`.

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

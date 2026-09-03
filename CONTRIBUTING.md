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
├── docs/                   # Data-source provenance (see DATA-SOURCES.md)
│
├── tools/                  # Node build tooling (never shipped to the page)
│   ├── refresh-local.js                   # npm run refresh: the whole pipeline, in order
│   ├── fetch-official-{aws,azure,gcp}.js  # Official provider pricing APIs
│   ├── fetch-vantage.js                   # Specs + families (Vantage API)
│   ├── reconcile-data.js                  # Merge; official API wins, rest flagged UNVERIFIED
│   ├── data-diff.js                       # Old vs new data, as a refresh-PR report
│   ├── recommendation-diff.js             # Recommendation flips across the golden scenarios
│   ├── split-data.js                      # Monolith to manifest + per-region files
│   ├── lib/build-env.js                   # Generic Node/CI primitives (argv, atomic write, sandboxed loaders)
│   ├── lib/record-schema.js               # Shipped record shape (FIELD_ORDER, round8, region loaders)
│   ├── build-coverage-inventory.js        # npm run coverage:check gate
│   └── static-server.js                   # Zero-dep static server for the Playwright rig
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
    │   ├── user-rules.js                   # User-defined conditional rules — model, evaluator, storage
    │   ├── user-rules-ui.js                # User-defined rules panel (add/list/delete)
    │   ├── xlsx-export.js                  # Styled results .xlsx export
    │   ├── scenario-compare.js             # Pin + diff two generation runs
    │   ├── charts.js                       # Inline-SVG result charts, no library
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

Instance data is auto-generated from provider APIs — do not edit it manually. Each provider has a small manifest (`js/{p}/{p}-data.js` with the data date, each type's specifications, and the region key list) plus one file per region under `js/{p}/regions/` carrying that region's prices. A type's specs are stored once, in the manifest; the loaders merge the two halves back together at read time, so nothing above a loader sees that the data is stored in two pieces.

To refresh the data, run the pipeline — never hand-edit a region file:

1. Put `VANTAGE_API_KEY` in a gitignored `.env` at the repo root — always required. Add `GCP_BILLING_API_KEY` too unless running with `--specs-only` (below), which skips the official pricing fetch and needs it not at all. The run fails early, naming any key it is missing
2. Run `npm run refresh` — add `-- --specs-only` to skip the official pricing fetch and reconcile, or `-- --date YYYY-MM-DD` to stamp a specific snapshot date. Each step consumes what the one before it produced: `fetch-official-{aws,azure,gcp}` → `fetch-vantage` → `reconcile-data` → `data-diff` → `recommendation-diff` → `split-data`. Only `split-data` writes into the shipped `js/` tree; everything upstream reads it and writes to the gitignored `.refresh-cache/`, where the fresh data waits as `{provider}-monolith.js`. That is what lets both diffs read the old data — specs included — while the new data sits beside it. Reports land in `.refresh-cache/` too
3. Review `.refresh-cache/diff-report.md` and `rec-flips-report.md` (plus `reconcile-report.md` on a pricing run), spot-check known instance types, then commit the manifest **and** the regenerated `regions/` files together, with a CHANGELOG row. Re-baseline any golden a price move shifted
4. **Open a pull request** — refreshed data reaches `main` through review, never a direct push. The scheduled `.github/workflows/data-refresh.yml` runs this same pipeline and opens the same kind of PR, but follows [RELEASING.md](RELEASING.md#merge-policy-fast-forward-only-never-squash-or-rebase)'s generated-data exception rather than step 3 above: no CHANGELOG row, no annotated tag, and squash-merge from GitHub's button is fine

On a no-op diff nothing downstream runs, so `split-data` never fires and the shipped `js/` tree is left untouched — there is nothing to discard. `tools/split-data.js` can also be run alone against a monolith dropped by hand at `.refresh-cache/{provider}-monolith.js`: it reads that file and writes the manifest and region files, and is idempotent (input and output are different files, so a re-run rebuilds the same manifest). Every validation it performs — the region-set cross-check, the region-invariant specs check, and the full round-trip — runs **before any file is written**, so a rejected monolith changes nothing on disk. That is not the same as a transaction: each file is replaced atomically, but they are replaced one at a time, so an interruption partway (disk full, kill) can still leave some region files new and some old. Re-run it; the result is deterministic.

Where each field comes from, why the official provider APIs outrank the specs source, and which GCP series stay unverified are documented in [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

If the refresh **adds** a region, also add it to the hardcoded list the provider's selector filters through (`awsRegions` in `js/aws/aws-instance-selector.js`, the display-name map in `js/azure/azure-instance-selector.js`). Those lists feed the manual-entry region autocomplete, while the upload's region chips validate straight against the manifest — so a region that is only in the manifest is accepted from a CSV but never suggested for manual entry. `tests/suites/lazy-test.js` fails when the two disagree. If the refresh **removes** a region, bump `CACHE` in `sw.js` (see "Service Worker" below).

## Service Worker (offline support)

`sw.js` precaches the app shell (HTML + CSS + manifest + icon) and runtime-caches everything else same-origin with stale-while-revalidate, so code and data changes reach users automatically on their next online visit — ordinary changes need no service-worker action.

Four cases do need one:

- **Adding an HTML page or stylesheet** — add it to the `PRECACHE` list in `sw.js` so it works offline from the first install.
- **Forcing a clean re-precache** (e.g. after renaming or deleting shell files) — bump the `CACHE` version string in `sw.js`.
- **A data refresh that removes or renames region files** — bump `CACHE`. Ordinary data refreshes need no bump: changed manifests and region files are picked up by stale-while-revalidate (returning users see the previous data for one visit, then the new data). A _deleted_ file is the exception — revalidating it 404s, so the cache keeps serving the old copy indefinitely, and only a new `CACHE` evicts it. `tools/split-data.js` prints a warning naming every region file it prunes; if that warning appears, bump.
- **A change to the SHAPE of the shipped data** — bump `CACHE`. Stale-while-revalidate can hand a client that already has the new loader a region file in the old format. The loader is written so that merges harmlessly to itself, but that is accidental resilience rather than a property anyone is maintaining, and it costs one line to not depend on it.

Note the service worker only registers on a secure context (GitHub Pages, `localhost`) — pages opened via `file://` simply skip it.

## Running Tests

```bash
node tests/run-all.js       # all suites + golden byte-compare — no install needed
```

That is the quick loop, **not** the full bar. Eight commands across six CI jobs gate every pull request, and the rest need `npm ci` first. [tests/README.md](tests/README.md) is the single source of truth for testing: the gate list, how to run each one, what the coverage policy requires, what is deliberately left uncovered, and when to regenerate goldens. Check your work against the gate table there before opening a PR rather than against the one command above.

## Versioning and Releases

Versions live only in [CHANGELOG.md](CHANGELOG.md) and git tags — never in the pages, the README, or `package.json`. Every commit gets a version, a changelog row, and an annotated tag; releases are published per minor line, from a dedicated `release/<minor>` branch. [RELEASING.md](RELEASING.md) is the full process, opening a minor through publishing it.

## Pull Request Guidelines

1. **Fork** the repository and create a branch from `main`
2. **Describe** what you changed and why in the PR description
3. **Test** your changes against every gate in [tests/README.md](tests/README.md#the-gates) — CI runs the tabled gates on every PR; `npm run test:mutation` is the one gate outside CI, run periodically by hand — and check the full flow in a browser with a sample CSV. If you added a guard, plant the bug it exists to catch and watch it go red before trusting it
4. **If an automated review tool comments on the PR, answer every finding it raises individually** — fixed, confirmed stale, rejected with a stated reason, or knowingly deferred. Triaging by which _file_ a finding sits in is not the same as triaging the finding: a file already addressed for one comment can still carry others that were never read.
5. **Keep PRs focused** — one logical change per PR
6. **Do not** commit generated data files unless you are refreshing instance data

## Code Style

- Plain HTML5, CSS3, and vanilla JavaScript (ES6+)
- No frameworks and no build step — the shipped site is raw HTML/CSS/JS. (npm exists for dev tooling only; see [Getting Started](#getting-started).)
- Keep functions small and focused
- Prefer `const` over `let`; avoid `var`
- Use descriptive variable names
- No comments explaining _what_ the code does — only add a comment when the _why_ is non-obvious

**Before hand-listing a fact that names real fields, values, or files, check
whether it already has a canonical source — and if it does, derive from that
source instead of retyping it.** Two 3.15 bugs shared one root cause: a second,
independent copy of a list that already existed elsewhere (`FIELD_ORDER` in
`tools/lib/record-schema.js`) silently fell behind the original when a field was added
to one and not the other, and nothing caught it because nothing checked the
two against each other. Prefer `specFields(name)` / `priceFields(name)` (or
the equivalent for whatever list you're touching) over writing the field names
out again. If no canonical source exists yet and you're about to create a
second copy of one, that's the signal to introduce one instead.

**[CANONICAL-SOURCES.md](CANONICAL-SOURCES.md) is the registry** — check it
before adding a new consumer of a shared fact, or before deciding a fact needs
a canonical source it doesn't have yet.

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

Formatting is Prettier's job, not yours: run `npm run format` before you commit (`npm run format:check` shows what it would change, and is one of the CI gates). `.prettierignore` keeps Prettier away from the vendored SheetJS builds and the generated region data — never reformat those.

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

# Changelog

All notable changes to Cloud Instance Recommender, newest first. The
repository has no git tags; versions match the labels used in the README and
user guide, with the date range of the commits that shipped them.

## Unreleased — 2026-07-10

UI polish and housekeeping batch.

- **Download section grouping** — the post-generation buttons now sit in
  labeled clusters (Results / AWS Pricing Calculator / Analysis) instead of a
  flat button run; the Analysis cluster hides itself when empty. Also fixed
  the Results Excel button being destroyed on the AWS page after every
  generation.
- **Scenario comparison config diff** — comparing two pinned runs now shows a
  "Configuration changes (A → B)" table of every setting that differed
  (recommendation type, providers, filters, thresholds, rule defaults, and
  per-provider filter selections). Comparison outcomes are announced to
  screen readers via a polite live region, and the changed-rows table scrolls
  under a sticky header.
- **Preset inline dialogs** — saving a preset uses an inline name form and
  overwrite/update/delete use two-step confirm buttons (arm on first click,
  auto-reset), replacing the native `prompt()`/`confirm()` dialogs.
- **Preset export/import** — a page's presets can be downloaded as a JSON
  file and imported elsewhere; imports validate the file shape and merge
  without overwriting (name collisions get an " (imported)" suffix).
- **Offline indicator** — every page shows a small banner while the
  connection is down and a short "Back online" notice on reconnect.
- **Nearest-miss probe coupling test** — a source-scan test now enforces that
  every filter option a provider's `applyFilters` reads has a matching
  nearest-miss probe, so the Nearest Miss column can't silently under-report.
- **Housekeeping** — project history moved to this CHANGELOG; per-feature
  version tags dropped from the README; unused `docs/user-guide.pdf` removed
  (the interactive `user-guide.html` is the user guide).

## v3.4 — 2026-07-05 → 2026-07-10

- **Filter presets** — save/apply/update/delete named filter configurations
  per tool page (localStorage).
- **Results Excel export** — the results grid as a styled single-sheet
  `.xlsx` (formatted header, autofilter, fitted widths, typed numeric
  columns), engine lazy-loaded on first click.
- **Nearest-miss diagnostics** — no-match rows get a per-provider "Nearest
  Miss" column naming the closest size-fitting instance and the filter
  group(s) that excluded it.
- **Scenario comparison** — pin two generation runs and diff them: summary
  KPIs (VMs changed, match rate A → B, newly matched/unmatched) plus a
  changed-rows table with old → new values.
- **PWA install + offline support** — web app manifest, icon, and a service
  worker precaching the app shell with stale-while-revalidate runtime
  caching; the tool works offline for pages and regions already visited.
- Docs pass bringing README, CONTRIBUTING, and the user guide up to v3.4.

## v3.3 — 2026-07-04 → 2026-07-05

- **App grouping** — optional `App Name` column groups the estate by
  application, with an app → workload mapping panel whose assignments VMs
  inherit at generation.
- **App Summary CSV** — per-application rollup export (VM count, total
  vCPUs/memory, matched vs no-match).
- **App Portfolio page** — a dedicated dashboard (`app-portfolio.html`) fed
  by an in-browser handoff: overview tab with sortable app table, rankings,
  and data-hygiene callouts, plus one tab per app; fully keyboard- and
  screen-reader-accessible.
- **Executive Excel** — styled workbook with a Portfolio Summary, Contents
  sheet, one sheet per app (plus Unassigned), and an About sheet, via the
  vendored `xlsx-js-style` fork with a plain-SheetJS fallback.
- Under the hood: relicensed to PolyForm Noncommercial 1.0.0; added the
  in-repo plain-Node test harness with golden-output compare and CI; split
  the monolithic `main-script.js` into 8 feature modules; added opt-in JSDoc
  type checking (`tsc --checkJs`, no build step).

## v3.2 — 2026-07-03 → 2026-07-04

Nine upgrades in one release:

- **Lazy per-region data loading** — instance data split into one file per
  region (141 files); pages load a tiny manifest and fetch only the regions
  the uploaded CSV references (initial download ~25 MB → a few KB).
- **Web Worker processing** — batches run off the main thread with a real
  progress bar ("Processing row 250 of 1000") and an automatic chunked
  main-thread fallback with identical output.
- **Region validation panel** — per-region chips after upload: recognized,
  auto-resolved (`us-east-1a → us-east-1`), or unknown.
- **Column auto-mapping** — exact/synonym/normalized header matching with a
  mapping panel for ambiguous cases, an Edit-mapping button, MB→GB memory
  conversion, and per-header-set persistence.
- **Excel upload** — `.xlsx` files parse in-browser via vendored SheetJS,
  loaded only when needed.
- **Manual VM entry** — form-based entry (with region autocomplete) feeding
  the same pipeline as uploads.
- **Results preview search** — live filter box over the preview table.
- **No-match remediation export** — export exactly the rows no provider
  matched, with reasons, to fix and re-upload.
- **Dark mode + accessibility pass** — theme tokens with a persistent toggle
  (follows the OS until overridden), keyboard operation end to end, live
  regions, skip links, and visible focus outlines.

## v3.1 — 2026-06-28

- Ten UX/feature enhancements across the tool pages.
- Fixed the Azure VM series / VM family and GCP machine series / category
  filters (previously checked options that didn't exist) and added the
  missing Azure/GCP processor filters with platform-name normalization.
- Safer fuzzy region resolution (single-prefix matches only) and an XSS fix
  in the preview copy button.
- Fixed CSP blocking inline onclick handlers; restructured the repository and
  removed dead code.

## v3.0 — 2026-06-28

- **Rule Engine UI** — five dropdowns (ENV, OS, Workload incl. SAP,
  Compliance, Min Gen) set batch-wide defaults, with per-row CSV overrides
  and conflict detection that flags contradictory filter combinations.
- Multicloud filter redesign and a round of review fixes (burstable
  exclusion, file handler, security).

## v2.0 — 2026-06-27

- **Rule engine core** — ENV/OS/Workload/Compliance rules for burstable
  exclusion, size floors, OS compatibility, and workload-aware family
  preference.
- Removed pricing columns from the output CSV (price stays internal for
  ranking only) and added the AWS Pricing Calculator bulk-template export
  with reference templates.
- Refreshed instance data (AWS 35, Azure 63, GCP 47 regions; new GCP machine
  families) and updated right-sizing defaults (downsize threshold 50% → 40%).
- Added community standards: security policy, code of conduct, contributing
  guide, and issue/PR templates.

## v1.0 — 2025-05-30 → 2025-06-20

- Initial release: AWS, Azure, GCP, and multi-cloud recommender pages with
  like-to-like and utilization-based optimized sizing, CSV upload/download,
  and advanced per-provider filtering.
- Refactored the codebase for modularity and per-cloud separation; added
  exclude-type controls and cost/performance tips for Azure/GCP.
- Published on GitHub Pages, added the LICENSE, and shipped the first user
  guide.

# Roadmap

Planned improvements for Cloud Instance Recommender, organized by release. This
is a living document — items are candidates, not commitments, and priorities
shift as the tool evolves. For what has already shipped, see
[CHANGELOG.md](CHANGELOG.md).

## How this roadmap is versioned

The project follows [Semantic Versioning](https://semver.org). This roadmap
plans **feature releases only**:

- **Minor releases** (`3.6`, `3.7`, …) group related features under a theme.
- The **next major** (`4.0`) collects the platform-defining changes — the ones
  that alter what the tool fundamentally does or how it is built.
- **Patches** — individual fixes, small tweaks, and review rounds — are not
  scheduled here; they land continuously between releases and are recorded in
  the [changelog](CHANGELOG.md).

Effort is a rough t-shirt size: **S** (hours), **M** (a few days), **L** (a
week or more). Dependencies are called out where one item needs another first.

## Engineering practices (continuous)

Not tied to any release — adopted once, then maintained every cycle:

- **Formatting gate in CI** — run `prettier --check` on every push and pull
  request, failing the build on anything unformatted. Auto-formatting and
  committing the fix from CI was considered and rejected: a bot commit would
  land without a changelog row or a version tag, putting holes in the
  per-commit version map. `npm run format` fixes it locally instead. (S)
- **Dependency-CVE watch** — monthly, and before each release, check the
  vendored SheetJS builds under `js/vendor/` for advisories, treating the
  versions embedded in those artifacts as the source of truth (today `xlsx.full`
  0.20.3 and `xlsx-js-style` 0.18.5); refresh `SECURITY.md`, and keep an
  explicit "nothing leaves your browser" privacy statement current on the
  landing page. (S)
- **Release hygiene** — keep [RELEASING.md](RELEASING.md) current: it is the
  release process (versioning, changelog, tagging, the pre-publish checklist)
  and it points at the service-worker cache rules in
  [CONTRIBUTING.md](CONTRIBUTING.md). (S)
- **Planning in the open** — track the adopted backlog on a public GitHub
  Project board and keep the issue templates current. (S)

## Minor releases

### 3.6 — Output fidelity & UI polish

Small, high-frequency wins that improve everyday use.

- Replace the remaining native `alert()` dialogs with the themed toast/status
  pattern for consistent styling and screen-reader behavior. (S)
- Add a UTF-8 BOM to CSV downloads so Excel opens non-ASCII VM and application
  names correctly. (S)
- Nearest-miss **one-click relax** — apply the single filter change that
  rescues the most no-match rows (the data is already computed). (S)
- Stats bar showing the total vCPU and RAM saved by optimized sizing. (S)
- Copy-to-clipboard buttons on each results group. (S)
- Collapse rarely-used filter sections by default and remember the state. (S)
- Anchor navigation / back-to-top on long tool pages. (S)
- Landing page feature-overview cards plus a "what's new" teaser linked to the
  changelog. (S)
- Strip the PDF-era page numbers from the user-guide table of contents —
  meaningless in HTML. (S)

### 3.7 — Ingestion & input quality

Meet users where their inventory actually comes from, and catch bad input early.

- Import presets for the formats target users already have — **RVTools**
  (auto-map vInfo headers), **Azure Migrate**, and **AWS ADS** exports. (L)
- **Input hygiene report** after upload: duplicate VM names, zero or absurd
  values, and unit sniffing, each with row numbers. Duplicates prompt the user
  to decide whether same-named rows are distinct VMs or a single VM. (M)
- Multi-sheet `.xlsx` picker (today only the first sheet is read). (M)
- "Current instance type" input column, so a row can carry the size it runs on
  today. (M) _Foundation for cloud-to-cloud mode in 4.0._
- Paste-from-clipboard input, routed through the same pipeline as file upload. (S)
- Sample dataset gallery — small, large, and deliberately messy examples. (S)
- Column-mapping manager UI to view and edit the saved header-signature
  mappings that are invisible in localStorage today. (S)
- Manual entry: bulk-add several similar VMs at once, and edit rows in place. (S)

### 3.8 — Results, visualization & reporting

Turn the results grid into something you can explore and present.

- Full results table beyond the 20-row preview — pagination or virtualization,
  column show/hide, per-column filters, and a "no-match only" toggle. (M)
- Inline SVG charts (CSP-safe, no libraries): match-rate donut, family
  distribution, and vCPU/RAM before→after. (M)
- Top-3 alternatives per row — the engine already ranks candidates internally. (M)
- Fit / headroom indicator per recommendation, flagging over-provisioned
  matches. (M)
- Scenario comparison v2 — named scenarios, saved across sessions (session-only
  today), and N-way compare. (M)
- Export a scenario's changed rows and its configuration diff as CSV. (S)
- App Portfolio: in-dashboard filters, cross-app search, and per-app CSV, plus
  the deferred cosmetic pass. (M)
- Executive print report — a print-optimized page ("Save as PDF" in the
  browser) with charts and a per-application rollup. (L) _Needs the charts
  above._

### 3.9 — Recommendation intelligence

Deeper, more accurate right-sizing.

- **Metadata enrichment** — ARM beyond Graviton (Ampere, Tau T2A), GPU flags,
  network class, and a SAP-certified flag. (M) _Unlocks the items below._
- GPU workload support. (M) _Needs metadata enrichment._
- Storage-aware pass-through — carry disk GB/IOPS columns into the outputs and
  the currently-blank storage fields of the AWS bulk template. (M)
- Percentile utilization — p95/peak columns alongside the average. (M)
- Burstable-preference rule for Dev/Test at low utilization (the inverse of the
  production exclusion). (M)
- SQL Server workload rule enforcing minimum core counts. (S)
- Multicloud family-equivalence explainers (for example, m5 ≈ Dsv5 ≈
  n2-standard). (M)

### 3.10 — Accessibility, hardening & documentation

Broaden reach and shore up quality.

- Mobile / responsive audit — the PWA is installable, so phones are real users
  now. (M)
- Dedicated security regression suite: CSV-cell XSS into the preview and
  portfolio, formula-injection round-trip, prototype pollution (extending the
  recent fix), and localStorage tampering. (M)
- Storage manager — view and clear all app localStorage, with runtime quota
  detection and quota-pressure handling. Browser localStorage limits vary by
  browser, origin, and mode; the portfolio copy alone has been observed near
  ~4 MB, close to the commonly seen ~5 MB ceiling, so the manager should measure
  actual usage rather than assume a fixed budget. Doubles as a privacy
  feature. (M)
- Golden-test expansion: Azure-only, GCP-only, and nearest-miss goldens, plus a
  structural compare for xlsx. (M)
- `docs/ARCHITECTURE.md` — module map, data flow, worker protocol, storage
  keys. (M)
- Screenshots and short GIFs in the README and user guide (text-only today). (M)
- Troubleshooting section (worker unavailable, `file://`, blocked popups,
  storage full). (S)
- SEO / OpenGraph tags and a Lighthouse ≥ 95 target. (S)

## Next major

### 4.0 — Platform expansion

Changes that redefine what the tool does or how it is built.

- **Cloud-to-cloud mode** — accept a current instance type as input, derive its
  specs from our own data, and right-size across providers. The biggest missing
  use case. (L) _Needs the "current instance type" column from 3.7._
- **GCP custom machine types** — recommend custom vCPU/RAM shapes when standard
  sizes waste resources. (L)
- **User-defined rules UI** — "if ENV = X, exclude family Y", stored and
  exported like presets. (L)
- **Strict CSP migration** — replace the generated HTML's inline
  `onclick`/`oninput` handlers with delegated listeners, then drop
  `script-src 'unsafe-inline'` (and evaluate the same for styles). The single
  biggest remaining hardening step. (L)

## Known issues (patch-level)

Tracked and fixed continuously rather than scheduled into a release. **The list
is currently empty** — everything on it has shipped (see the changelog for what
each fix did).

## Suggesting an item

Ideas are welcome — open an issue or a discussion (see
[CONTRIBUTING.md](CONTRIBUTING.md)). Concrete, self-contained proposals are the
easiest to pick up.

# 🌐 Cloud Instance Recommender

A comprehensive web-based tool for generating optimal cloud instance recommendations across AWS, Azure, and Google Cloud Platform (GCP). Upload a VM inventory CSV and get right-sized instance recommendations — all processing happens entirely in your browser, no data is ever sent to a server.

![Cloud Instance Recommender](https://img.shields.io/badge/Cloud-Instance%20Recommender-blue)
![License](https://img.shields.io/badge/License-PolyForm_Noncommercial-orange)

> **🌐 Live Demo**: [https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/](https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/)

---

## 🚀 Features

### 📊 Multi-Cloud Support

- **AWS** — EC2 instance recommendations with Graviton (ARM) support
- **Azure** — Virtual Machine sizing with ARM (Ampere Altra) instances
- **GCP** — Compute Engine optimization with T2A (ARM) instances
- **Multi-Cloud** — Side-by-side comparison across all three providers in one run

### 🎯 Recommendation Types

- **Like-to-Like** — Cheapest instance that meets or exceeds current vCPUs and memory
- **Optimized** — Smart right-sizing based on actual CPU/memory utilization (N/2, N, N+1 strategy)
- **Both** — Generate like-to-like and optimized simultaneously; AWS produces two separate bulk template files

### 🧠 Rule Engine

Five interactive dropdowns set global defaults for the entire batch without editing your CSV:

| Dropdown       | Purpose                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ENV**        | Production / Staging / Dev / Test — tightens generation and burstable rules; Dev/Test at low utilization _prefers_ burstable                                                                                                                      |
| **OS**         | Linux / Windows / macOS — affects ARM eligibility                                                                                                                                                                                                 |
| **Workload**   | General / Database / **SQL Server** / Web Server / Cache / ML/AI (GPU) / Batch / HPC / **SAP** — sorts preferred families first; **ML/AI requires an accelerator, every other workload excludes one; SQL Server enforces a 4-vCPU licence floor** |
| **Compliance** | PCI / HIPAA / SOC2 / FIPS — enforces current-gen; Nitro Enclaves required for PCI/HIPAA (AWS)                                                                                                                                                     |
| **Min Gen**    | Minimum generation number/family, native to each cloud — excludes older instance generations                                                                                                                                                      |

Per-row CSV column values always override these global defaults.

### ⚠️ Conflict Detection

The Rule Engine highlights contradicting filter combinations in red and explains the conflict:

- Current-Gen Only + Previous-Gen preference
- Burstable excluded (Prod ENV) + Burstable family selected
- Min Gen + Current Gen Only (redundant but not conflicting)
- macOS selected + Azure/GCP providers active (macOS is AWS-only)

### 🔧 Advanced Filtering

- **Current Generation Only** — Exclude end-of-life families
- **Minimum Generation** — Per-row CSV column or dropdown. Every value is native to its own cloud (AWS family number, Azure v-number, GCP family name): single-provider pages take one `Min Gen`, multi-cloud takes `AWS Min Gen` / `Azure Min Gen` / `GCP Min Gen` so nothing is translated between clouds.
- **Processor Types** — Intel / AMD / ARM; Azure and GCP accept full platform names (e.g. "Intel Xeon", "AMD EPYC") and normalize them automatically
- **Instance Categories** (multi-cloud) — General Purpose, Burstable, Memory Optimized, Compute Optimized, Storage Optimized, GPU, HPC
- **AWS Instance Families** — Filter by family prefix (m, r, c, …)
- **Azure Filters** — VM Series (D-series, E-series, …), Processor Architecture, VM Family prefix (Standard_D, …)
- **GCP Filters** — Machine Series (N2, E2, C3D, …), Machine Type Category (standard, highmem, highcpu, …), Processor Platform
- **Exclude Specific Types** — GPU, Burstable, ARM/Graviton, FPGA, Previous Generation, etc. per provider; also settable per row via the `Exclude` CSV column

### 📦 AWS Pricing Calculator Bulk Template

AWS-only export that generates a CSV matching the EC2 Instances worksheet for the AWS Pricing Calculator Bulk Import. When both recommendation types are generated, **two separate files** are produced (Like-to-Like and Optimized) to prevent double-counting.

### ⚡ Lazy Per-Region Data Loading

Instance data is split into one file per region (141 files across the three providers). A page load fetches only a tiny manifest per provider; the region files your CSV actually references are fetched in the background right after upload, and anything still missing is loaded on demand during generation. Initial data download dropped from ~25 MB to a few KB. If Generate is clicked before data is ready, the request is queued and fires automatically.

### 🧵 Web Worker Processing with Real Progress

Recommendation batches run in a Web Worker, so large CSVs never freeze the page — with a progress bar that reports actual rows processed ("Processing row 250 of 1000"). If the worker can't start (e.g. opening the page from `file://`) or stalls, processing falls back automatically to a chunked main-thread run with the same progress reporting and identical output.

### 🌍 Region Validation

After upload, a Region Check panel shows one chip per unique region in your CSV: green = recognized, amber = auto-resolved (e.g. `us-east-1a → us-east-1`), red = unknown (those rows would fall back to built-in sample data). A non-blocking warning also appears at Generate time if unknown regions remain.

### 🔗 Column Auto-Mapping

Headers like `vCPUs`, `RAM`, or `Hostname` are automatically matched to the canonical columns (`CPU Count`, `Memory (GB)`, `VM Name`, …) via exact, normalized, and synonym matching. Unambiguous matches apply silently with a note; ambiguous or missing required columns open a mapping panel with one dropdown per field. The applied mapping can be reviewed and changed anytime via the **✏️ Edit mapping** button.

A confirmed mapping is remembered per header set and replayed on the next file with the same headers — so it is also **listed, with a Forget button**, because a mapping confirmed once would otherwise be reapplied silently forever.

Two inventory-tool exports are recognised on sight and need no mapping at all:

- **RVTools** — the `vInfo` sheet is found (not `vHost`, which lists the ESXi servers the VMs run _on_), `VM` is used for the VM name (not `Host`), and `Memory` — MiB, though the header never says so, and written with a thousands separator — is read and converted correctly.
- **AWS Application Discovery Service** — its import template maps straight through: logical cores become the vCPU count, `RAM.TotalSizeInMB` becomes memory, and memory _utilization_, which ADS does not report, is worked out as (used ÷ total) × 100. Without that, an ADS file could only be sized on CPU.

Both presets were built against real exports, because both formats hide something a specification would not tell you.

Memory in **MB/MiB** is converted when the header says so, or when a recognised format says so. When neither does but the values look like MiB, you are **asked** rather than second-guessed: a fleet of genuine 512 GB machines exists, and dividing it by 1024 would be its own kind of corruption.

### 🩺 Input Check

After the data loads, rows that will not size sensibly are named with the row numbers your spreadsheet shows: missing or zero CPU and memory, figures no provider sells, utilization outside 0–100%, blank names. A repeated VM name is a **question** — one VM listed twice, or two VMs sharing a name? — and nothing is dropped until you answer. It is a report, not a gate.

### ⌨️ Four ways to get data in

Upload a file, **paste rows straight from a spreadsheet**, **enter VMs by hand** (with a copies count for a row of near-identical machines, and in-place editing), or **load one of three sample datasets** — small, 500-VM, or deliberately messy. All four go through the same pipeline, so the mapping, the unit handling and the input check apply identically to each.

### 📗 Excel Upload

Upload `.xlsx` files directly. In a multi-sheet workbook the sheet whose columns best match an inventory is opened, and a picker lets you switch. Parsing runs fully in-browser via a vendored SheetJS; the ~930 KB parser script is loaded only when an Excel file is actually selected.

Uploads are routed by their **content**, not their file extension: a workbook saved as `.csv` (or a CSV saved as `.xlsx`) is still read correctly, and you are told it happened. A legacy `.xls` or a file that is neither is rejected with an explanation rather than parsed into nonsense.

### ✍️ Manual VM Entry

For small inventories, skip the file entirely: "Or enter VMs manually" opens a form (name, CPU, memory, utilization, region with autocomplete) where you add and remove VMs one by one. The list persists across reloads and feeds the exact same pipeline as uploads — region validation, worker processing, preview, and exports all behave identically. Enterprise-scale bulk upload via CSV/xlsx remains the primary path.

### 🧾 No-Match Remediation Export

When some rows get no recommendation from any provider, the **CSV ▾** menu offers a **No-Match Rows** export (with count) — exactly those rows together with their `No Match Reason` and `Rules Applied` diagnostics, to fix and re-upload.

### 🧩 App Grouping, Portfolio & Executive Excel

Add an optional **`App Name`** column and the tool groups your estate by application:

- **App → Workload mapping** — when a file has `App Name` but no `Workload` column, a panel lets you assign a workload per application; every VM in that app inherits it at generation (a row's own `Workload` cell still takes precedence).
- **App Summary CSV** — a per-application rollup (VM count, total vCPUs/memory, matched vs no-match) exported alongside the results.
- **📊 App Portfolio page** — after generating, **Open App Portfolio** hands the results to a dedicated `app-portfolio.html` (entirely in-browser — nothing is uploaded) with an **Overview** tab (sortable app table with a name search plus **No-match only** and **Compliance only** filters, rankings, and data-hygiene callouts) and **one tab per app** (KPIs, ENV/OS/workload mini-bars, compliance and region chips, recommended-family distribution, match health with top no-match reasons, and right-sizing counts on Optimized runs). Each app tab has an **⬇️ App CSV** button that exports just that application's VM rows, and the whole portfolio downloads as an executive Excel workbook.
- **Executive Excel** — a styled `.xlsx` download: a **Portfolio Summary** (one row per app + an estate TOTALS row), a **Contents** sheet with links, one **sheet per app** (plus **Unassigned**), and an **About** sheet. Styling comes from the vendored `xlsx-js-style` fork, falling back to the plain SheetJS build if it can't load — same workbook, unstyled.

Everything runs client-side, and no pricing appears in any view or sheet.

### ⭐ Filter Presets

Save the current filter configuration — recommendation type, optimization thresholds, Rule Engine defaults, provider filters, and exclude selections — under a name and re-apply it in two clicks from the bar above the Generate button. Presets are scoped per tool page (an AWS preset won't appear on Azure), stored in your browser's localStorage, and can be updated or deleted in place. Nothing is applied automatically — a preset takes effect only when you click Apply.

### 🎛️ Alternative recommendations (per row)

Beside the primary **Best Match** (like-to-like) and utilization-based **Optimized** picks, each row carries three labeled alternatives per provider — every one a genuinely deployable instance drawn from the same valid candidate pool, differing only in what it optimizes for:

- **Most Cost Optimized** — the cheapest instance that still meets the requirement, ignoring the workload family.
- **Workload Based** — the cheapest instance in the workload-appropriate family (e.g. memory-optimized for Cache/Database), even if it over-provisions; blank when there's no workload or no member exists in the preferred family.
- **Newest Generation** — the newest hardware that fits, kept close to the requested size.

They appear as separate columns in the results grid/CSV and preview (hideable like any column), and the **Excel export adds one sheet per strategy**. Pricing is only ever used to rank internally — never shown.

### 📈 Size against an average, p95, or peak

Averages hide bursts. A VM averaging 20% CPU looks like an obvious downsize; the
same VM with a p95 of 85% is not one, and shipping that downsize under-provisions
it in production. **Size against** in Optimization Settings picks which statistic
drives the N/2 / N / N+1 rules — **Average** (the default, and the historical
behaviour), **p95**, or **Peak** — reading the matching `… p95` / `… Peak`
columns when present.

Resolution is **per row, not per run**: fleet exports routinely carry p95 for
monitored VMs and only an average for the rest, so a row missing the requested
statistic falls back to what it does have rather than dropping to "no utilization
data". The fallback prefers the _higher_ remaining statistic, because sizing
against a lower number than you asked for under-provisions. Every row reports the
basis actually used in a **`Sized On`** column (`p95`, `Average (fallback)`, …),
so a recommendation can be traced to the number behind it. If you pick p95 or
Peak and the upload has no such columns, the control says so at that moment
instead of letting the run look like something it isn't.

### 📗 Downloads — Excel first, CSVs on demand

The results area leads with a single primary **📊 Download Results (Excel)** button: a styled `.xlsx` with a **Recommendations** sheet (formatted header row, autofilter, fitted column widths, numeric columns typed as real numbers so sorting/filtering behave with no import dialog) plus one sheet per alternative strategy (Most Cost Optimized / Workload Based / Newest Generation). The spreadsheet engine is lazy-loaded on first click.

The flat CSV exports live behind an inline **CSV ▾** checklist next to it: **Results** (always), plus **No-Match Rows** and **App Summary** when they have rows (each with its count). Tick the ones you want and click **Download selected** — each is the same file its single download would produce.

### 🧭 Nearest-Miss Diagnostics

When a row gets no recommendation, a per-provider **Nearest Miss** column shows the closest instance that satisfied the CPU/memory requirement and names the filter group(s) that excluded it — e.g. `m7i.large (2 vCPU / 8 GB) — relax: current-generation only` — so you know exactly which filter to relax instead of guessing.

### 🔀 Scenario Comparison

Pin a generation run, tweak filters, re-generate, and pin again — runs are **named** (default "Run N", editable in place) and any number can be pinned (up to 6). **Two runs** get a detailed pairwise view: a summary (VMs changed, match rate A → B, newly matched / newly unmatched), the configuration settings that differed, and a table of only the changed rows with old → new values per recommendation column. **Three or more runs** get an **N-way matrix** — one column per run over the rows that differ across the whole set, with each value that departs from the first run's highlighted, plus a per-run match rate. Rows pair by VM Name (or by position when names aren't unique), so use the same input file across runs. Either view exports to CSV. Scenarios live in memory for the session only.

### 🖨️ Executive Print Report

After a run, **🖨️ Print Report** opens a print-ready (or save-as-PDF) one-page summary: a titled header with the generation date and data vintage, headline stat tiles (VMs assessed, matched with rate, no-match, applications), a per-provider right-sizing line, and the three on-screen charts — the match-rate meter, recommended-family distribution, and vCPU/RAM before → after — reused unchanged. It is built from the same numbers the preview shows, so the printed figures always agree with the screen. Nothing leaves the page: the report lives hidden in the page and the button reveals only it while printing, forcing a light background so a dark-theme screen never prints an ink-heavy page. A plain Ctrl+P still prints the page as you see it.

### 📲 Install & Offline (PWA)

The site is an installable Progressive Web App. A service worker precaches the app shell and keeps everything you've used — pages, scripts, region data — cached with a stale-while-revalidate policy, so after the first visit the tool works offline for the regions you've already loaded and silently picks up updates on the next online visit.

### 🌓 Dark Mode & Accessibility

A theme toggle in the nav switches light/dark instantly (no flash on load); your choice persists across pages and reloads, and with no saved choice the site follows the OS setting. The UI is keyboard-operable end to end — collapsible sections and sortable table headers work with Enter/Space, status updates are announced to screen readers, and every page has a skip-to-content link and visible focus outlines.

---

## 📁 Project Structure

```
Cloud-Instance-Recommender/
├── index.html               # Landing page
├── aws.html                 # AWS recommendations
├── azure.html               # Azure recommendations
├── gcp.html                 # GCP recommendations
├── multicloud.html          # Multi-cloud comparison
├── app-portfolio.html       # App-centric dashboard + executive Excel (fed by a handoff)
├── user-guide.html          # Full user guide
│
├── manifest.json            # PWA manifest (installable app)
├── sw.js                    # Service worker — offline cache (stale-while-revalidate)
├── icon.svg                 # App icon
│
├── assets/
│   └── templates/
│       └── aws/             # AWS Pricing Calculator bulk upload templates (.xlsx)
│
├── css/
│   ├── theme.css            # Light/dark theme tokens (CSS custom properties)
│   ├── style.css            # Main application styles
│   ├── portfolio.css        # App Portfolio dashboard styles
│   └── index_style.css      # Landing page styles
│
├── logos/                   # Cloud provider logos
│
├── docs/                    # Data-source provenance (see DATA-SOURCES.md)
│
├── tools/                   # Node build tooling (never shipped to the page)
│   ├── refresh-local.js                   # npm run refresh: the whole pipeline, in order
│   ├── fetch-official-{aws,azure,gcp}.js  # Official provider pricing APIs
│   ├── fetch-vantage.js                   # Specs + families (Vantage API)
│   ├── reconcile-data.js                  # Merge; official API wins, rest flagged UNVERIFIED
│   ├── data-diff.js                       # Old vs new data, as a refresh-PR report
│   ├── recommendation-diff.js             # Recommendation flips across the golden scenarios
│   ├── split-data.js                      # Monolith to manifest + per-region files
│   ├── lib/util.js                        # Shared helpers (round8, atomic write, loaders)
│   ├── build-coverage-inventory.js        # npm run coverage:check gate
│   └── static-server.js                   # Zero-dep static server for the Playwright rig
│
├── tests/                   # Plain-Node test harness: suites + golden compare (see tests/README.md)
│
└── js/
    ├── pwa-register.js                     # Service-worker registration (loaded by every page)
    │
    ├── base/
    │   ├── base-instance-selector.js       # Abstract base class + lazy region loading
    │   ├── instance-selector-factory.js    # Provider factory + recommendation orchestration
    │   ├── rule-engine.js                  # ENV/OS/Workload/Compliance/MinGen rule logic
    │   ├── recommendation-worker.js        # Web Worker running batches off the main thread
    │   ├── app-core.js                     # Shared state, mapping tables, data readiness, region validation
    │   ├── ui-shell.js                     # Page init, sticky button, accessibility
    │   ├── ingest.js                       # Upload (incl. drag & drop), parsing, column mapping, MB→GB
    │   ├── manual-entry.js                 # Form-based VM entry
    │   ├── form-controls.js                # Filters, rule engine UI, option readers
    │   ├── generate.js                     # Option gathering + worker batch runner
    │   ├── preview.js                      # Stats bar + results preview table
    │   ├── downloads.js                    # CSV exports, bulk template, portfolio handoff
    │   ├── presets.js                      # Filter presets (save/apply, localStorage)
    │   ├── xlsx-export.js                  # Styled results .xlsx export
    │   ├── scenario-compare.js             # Pin + diff two generation runs
    │   └── portfolio.js                    # App Portfolio: analytics, dashboard, executive Excel
    │
    ├── vendor/
    │   ├── xlsx.full.min.js                # SheetJS (Excel parsing/upload, lazy-loaded)
    │   ├── XLSX-LICENSE.txt                # Apache-2.0 license for SheetJS
    │   ├── xlsx-js-style.min.js            # SheetJS styling fork (portfolio Excel export)
    │   └── XLSX-JS-STYLE-LICENSE.txt       # Apache-2.0 license for xlsx-js-style
    │
    ├── aws/
    │   ├── aws-instance-selector.js        # AWS-specific logic
    │   ├── aws-specific.js                 # AWS filter UI and sample CSV
    │   ├── aws-data.js                     # Manifest: data date + region key list
    │   └── regions/                        # One data file per region (35 files)
    │
    ├── azure/
    │   ├── azure-instance-selector.js      # Azure-specific logic
    │   ├── azure-specific.js               # Azure filter UI and sample CSV
    │   ├── azure-data.js                   # Manifest: data date + region key list
    │   └── regions/                        # One data file per region (60 files)
    │
    └── gcp/
        ├── gcp-instance-selector.js        # GCP-specific logic
        ├── gcp-specific.js                 # GCP filter UI and sample CSV
        ├── gcp-data.js                     # Manifest: data date + region key list
        └── regions/                        # One data file per region (46 files)
```

### Instance data layout

Each provider ships a small **manifest** (`js/{provider}/{provider}-data.js`) declaring the data date, each instance type's specifications, and the list of available region keys, plus one file per region under `js/{provider}/regions/` carrying that region's prices. A type's specs are identical in every region that offers it, so they are stored once rather than repeated per region; the loader merges the two halves back together as it reads, and nothing above it sees the split. Pages load only the manifest up front; region files are `<script>`-injected on demand (the CSP forbids `fetch`). A monolithic data file dropped in place of the manifest also works — the loader detects it and behaves as before. The data is regenerated at build time from provider APIs, entirely outside the shipped tree until the last step, so a refresh is never half-applied on disk; [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) records every source, why the official provider APIs take precedence over the aggregated specs feed, and the known coverage gaps. The served page never fetches anything external.

---

## 🚀 Quick Start

### 1. Access the Application

[https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/](https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/)

Or run locally (no build tools needed):

```bash
git clone https://github.com/harshit-kandhwey/Cloud-Instance-Recommender.git
cd Cloud-Instance-Recommender
python -m http.server 8080
# Open http://localhost:8080
```

### 2. Prepare Your CSV (or Excel file)

Download the sample CSV from any provider page and fill in your VM inventory. `.xlsx` workbooks are also accepted, and a multi-sheet workbook opens the sheet that looks most like an inventory, with a picker to switch. Column names don't have to match exactly — common variants like `vCPUs`, `RAM`, or `Hostname` are auto-mapped, and anything ambiguous opens a mapping panel.

**Required columns:**

| Column              | Description                                     |
| ------------------- | ----------------------------------------------- |
| `VM Name`           | Identifier for the VM                           |
| `CPU Count`         | Number of vCPUs                                 |
| `Memory (GB)`       | RAM in gigabytes                                |
| `[Provider] Region` | e.g. `AWS Region`, `Azure Region`, `GCP Region` |

**Optional columns (enable rule-based filtering per row):**

| Column                                           | Values                                                                           | Effect                                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `App Name`                                       | Any text                                                                         | Groups VMs by application for the App Summary CSV and the App Portfolio; enables app→workload inheritance                                                                |
| `CPU Utilization`                                | 0–100                                                                            | Average CPU; drives N/2 / N / N+1 optimization                                                                                                                           |
| `Memory Utilization`                             | 0–100                                                                            | Average memory; drives N/2 / N / N+1 optimization                                                                                                                        |
| `CPU Utilization p95` `Memory Utilization p95`   | 0–100                                                                            | p95 readings, used when the run sizes against p95 (see below)                                                                                                            |
| `CPU Utilization Peak` `Memory Utilization Peak` | 0–100                                                                            | Peak/max readings, used when the run sizes against Peak                                                                                                                  |
| `Disk (GB)`                                      | Number (MB/MiB headers convert automatically)                                    | Optional provisioned disk; carried through to the outputs after any MB/MiB→GB conversion, and rounded up to a whole GB for the AWS bulk template. Does not affect sizing |
| `ENV`                                            | Production / Staging / Dev / Test                                                | Tightens burstable and generation rules                                                                                                                                  |
| `OS`                                             | Linux / Windows / macOS                                                          | Affects ARM/Graviton eligibility                                                                                                                                         |
| `Workload`                                       | General / Database / SQL Server / Web Server / Cache / ML/AI / Batch / HPC / SAP | Sorts preferred families first; `ML/AI` (or `GPU`) requires an accelerator, every other value excludes one; `SQL Server` enforces a 4-vCPU licence floor                 |
| `Compliance`                                     | PCI / HIPAA / SOC2 / FIPS                                                        | Enforces current-gen; Nitro Enclaves for PCI/HIPAA (AWS)                                                                                                                 |
| `Min Gen`                                        | AWS: 5/6/7 · Azure: 3/4/5 · GCP: n2/n2d/n4                                       | Minimum instance generation to include (single-provider pages)                                                                                                           |
| `AWS Min Gen` `Azure Min Gen` `GCP Min Gen`      | as above, per cloud                                                              | Multi-cloud sheets: one column per provider, each in that cloud's own scale                                                                                              |
| `Exclude`                                        | Comma-separated type names (e.g. `Burstable,GPU`)                                | Exclude specific instance types for this row only                                                                                                                        |

**`Current Instance Type`** (optional, not a rule column) — if your VMs already run in a cloud, this carries what they run on today (`m5.xlarge`, `Standard_D4s_v3`, `n2-standard-4`) through the preview and every export untouched, sitting immediately left of the recommendations so each one can be read against what it replaces. Also recognised as `Instance Type`, `VM Size`, `Machine Type` or `Current Size`. **It does not affect sizing** — CPU Count and Memory (GB) still drive that.

**Example (multi-cloud):**

```csv
VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region,ENV,OS,Workload,Compliance,AWS Min Gen,Azure Min Gen,GCP Min Gen,Exclude,Current Instance Type
web-server-01,4,16,45,60,us-east-1,East US,us-central1-a,Production,Linux,Web Server,,,,,,m5.xlarge
db-server-02,8,32,70,80,us-west-2,West US 2,us-west1-b,Production,Windows,Database,PCI,,,,"Burstable,GPU",m5.2xlarge
worker-node-07,8,16,85,75,us-west-2,West US 2,us-west1-b,Production,Linux,ML/AI,HIPAA,7,5,n4,,c5.2xlarge
```

### 3. Generate Recommendations

1. Upload your CSV file
2. Select recommendation type (Like-to-Like / Optimized / Both)
3. Configure optimization thresholds (optional)
4. Set Rule Engine defaults in Advanced Filtering (optional)
5. Click **Generate Recommendations**
6. Click **📊 Download Results (Excel)** — or pick flat CSVs from the **CSV ▾** checklist beside it (and the AWS Bulk Template if on the AWS page)

---

## 📊 Output Format

The results CSV contains your original columns plus per-provider recommendation columns:

| Column                                            | Description                                                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS Like-to-Like Instance`                       | Recommended EC2 type                                                                                                                         |
| `AWS Like-to-Like Family`                         | Family category of that instance — `General purpose`, `Compute optimized`, …                                                                 |
| `AWS Like-to-Like vCPUs`                          | vCPU count of recommended instance                                                                                                           |
| `AWS Like-to-Like Memory (GiB)`                   | Memory of recommended instance                                                                                                               |
| `AWS Optimized Instance`                          | Optimized EC2 type (if selected)                                                                                                             |
| `AWS Optimized Family`                            | Family category of the optimized instance                                                                                                    |
| `AWS Rules Applied`                               | Which ENV/OS/Workload/Compliance/MinGen rules fired                                                                                          |
| `AWS No Match Reason`                             | Explains why no instance was found (when applicable)                                                                                         |
| `AWS Nearest Miss`                                | On no-match rows: closest instance that met CPU/memory, and which filters to relax                                                           |
| _(Azure and GCP columns follow the same pattern)_ |                                                                                                                                              |
| `Sized On`                                        | _Optimized runs:_ which utilization statistic sized the row — `Average`, `p95`, `Peak`, `… (fallback)`, or split per axis (`CPU: …, Mem: …`) |
| `Family Equivalence`                              | _Multi-cloud runs:_ whether the clouds landed on the same family class — `General purpose on AWS, AZURE, GCP`, or `Differs — AWS …, GCP …`   |

The in-browser **results preview** table includes sortable columns, a live search filter, a per-row copy button, vCPU diff highlighting (green = smaller / amber = larger vs Like-to-Like), a **fit/headroom flag** (a ▲% beside a like-for-like match, showing how far the chosen instance over-provisions its worst axis versus the requested size — the discrete-sizing and ratio-mismatch waste), and a stats bar showing match rate, rules fired, and data freshness date. Rows that got no recommendation from any provider can be exported separately via the **CSV ▾** menu's **No-Match Rows** item for fix-and-re-upload remediation. The grid downloads primarily as a styled Excel workbook (**📊 Download Results (Excel)**, with a sheet per alternative strategy) — with the flat CSVs behind the **CSV ▾** checklist — and any two runs can be pinned and diffed with **Scenario comparison** to see exactly what a filter change did — including a one-click **Export comparison CSV** that writes the configuration changes and the changed recommendation rows to a single file. A **🖨️ Print Report** button opens a print-ready one-page executive summary (headline stats plus the match-rate, family, and before → after charts) to print or save as PDF.

> **Pricing is intentionally excluded from output.** Cloud pricing depends on region, OS, discounts, Reserved Instances, Savings Plans, and enterprise agreements — a static price in the CSV would be misleading within weeks. Use the provider's pricing calculator with the recommended instance types for authoritative cost figures.

### AWS Bulk Template

Available only on the AWS page. Produces a CSV matching the Amazon EC2 Instances worksheet format for [AWS Pricing Calculator Bulk Import](https://calculator.aws/#/bulk-import). When both L2L and Optimized are generated, two separate files appear — import only one per estimate to avoid double-counting.

If your upload carried a `Disk (GB)` column, a positive value is written to **Storage amount per Instance (GB)**, rounded up to a whole GB (minimum 1 GB); missing, zero, negative, and non-numeric values are left blank. **Storage Type, IOPS and throughput are always left blank** for the calculator to default — the bulk importer parses this file strictly, and a wrong value in those fields fails the whole import rather than one column.

---

## 🔧 N/2, N, N+1 Optimization Strategy

Industry-standard thresholds (fully editable in the UI):

| Utilization | CPU action      | Memory action   |
| ----------- | --------------- | --------------- |
| ≤ 40%       | Downsize to N/2 | Downsize to N/2 |
| 40–80%      | Keep same (N)   | Keep same (N)   |
| > 80%       | Upsize to N+1   | Upsize to N+1   |

> AWS, Azure, and GCP cost advisors consistently flag resources with sustained average utilization below 40% as over-provisioned. The 80% upsize trigger aligns with SRE practice of maintaining headroom below 80% peak.

---

## 🔌 API / Programmatic Usage

```javascript
// Create and initialize a provider selector
const awsSelector = InstanceSelectorFactory.createSelector("aws");
await awsSelector.initialize(csvData, regions);

// Like-to-Like
const l2l = awsSelector.getLikeToLikeInstance("us-east-1", 4, 16, options);

// Optimized
const optimized = awsSelector.getOptimizedInstance(
  "us-east-1",
  4,
  16,
  45,
  60,
  options,
);

// Batch — process full CSV across multiple providers
const results = await getInstanceRecommendationWithSelector(
  csvData,
  ["aws", "azure", "gcp"],
  {
    generateLikeToLike: true,
    generateOptimized: true,
    currentGenerationOnly: true,
    ruleDefaultEnv: "Production",
    ruleDefaultWorkload: "Database",
  },
);
```

---

## 🔒 Security & Privacy

- **Client-Side Only** — All processing runs in your browser
- **No Data Transmission** — CSV files never leave your machine
- **No Authentication** — No login, fully anonymous
- **Local Storage** — Only preferences and any manually entered VM list are stored locally (usage statistics, theme choice, confirmed column mappings, saved filter presets, manual VM entries); uploaded CSV/xlsx inventory is never stored
- **Offline Cache** — The service worker caches the app's own static files (pages, scripts, instance data) for offline use; your uploads and results are never cached

---

## 🛠️ Architecture

The application uses a modular, class-based architecture:

- **`BaseInstanceSelector`** — Abstract base with common region loading, data parsing, and filtering
- **`AWSInstanceSelector` / `AzureInstanceSelector` / `GCPInstanceSelector`** — Provider-specific field mappings, region normalization, and generation detection
- **`RuleEngine`** — Pure function that applies ENV/OS/Workload/Compliance/MinGen rules to the filtered candidate list
- **`InstanceSelectorFactory`** — Creates the right selector per provider and orchestrates per-row processing
- **`main-script.js`** — Application controller: file handling, UI events, download generation

---

## 📄 License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE):

- **Free for any noncommercial purpose** — personal use, education, research, and hobby projects, including modifying the code, self-hosting, and sharing forks (with the license and [NOTICE](NOTICE) preserved).
- **Charitable organizations, educational institutions, government institutions, and public research organizations** may use the code for permitted purposes regardless of their source of funding, per the license's noncommercial-organization provision.
- **The hosted application is free for everyone**, including commercial users — the license governs the source code, not visiting the site.
- **Other commercial use of the code** (for-profit self-hosting, embedding in commercial products or services, commercial redistribution) requires written permission — reach out at harshitkandhwey@gmail.com.

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## 📞 Contact & Support

- **Live Demo**: [https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/](https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/)
- **User Guide**: See `user-guide.html` in this repository
- **Version History**: See [CHANGELOG.md](CHANGELOG.md)
- **Roadmap**: See [ROADMAP.md](ROADMAP.md)
- **Data Sources**: See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)
- **Release Process**: See [RELEASING.md](RELEASING.md)
- **Bugs / Requests**: Open an issue on GitHub
- **Email**: harshitkandhwey@gmail.com

---

_Made with ❤️ for cloud infrastructure optimization_

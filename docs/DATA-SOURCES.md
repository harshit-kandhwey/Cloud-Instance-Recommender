# Data sources

The instance specs and the internal ranking pricing are refreshed at **build time**
by the `tools/fetch-*.js` scripts and the scheduled data-refresh workflow (3.14). The
shipped app never fetches anything — the served page keeps `connect-src 'none'`, and
these sources are read only by CI/build tooling.

Pricing is used **internally for ranking only** and is never printed in any output
(decision D8).

## Sources

| Purpose        | Source                        | Endpoint                                             | Auth                        | Key location                                        |
| -------------- | ----------------------------- | ---------------------------------------------------- | --------------------------- | --------------------------------------------------- |
| Specs/families | Vantage instances API         | `instances-api.vantage.sh` (`getAllGlobalInstances`) | Email-generated API key     | `VANTAGE_API_KEY` (`.env` local / GH secret in CI)  |
| AWS pricing    | AWS Price List Bulk API       | public bulk offer files over HTTPS GET               | none                        | —                                                   |
| Azure pricing  | Azure Retail Prices API       | `prices.azure.com/api/retail/prices`                 | none (unauthenticated)      | —                                                   |
| GCP pricing    | GCP Cloud Billing Catalog API | `cloudbilling.googleapis.com/v1/services/*/skus`     | API key (Cloud Billing API) | `GCP_BILLING_API_KEY` (`.env` local / GH secret CI) |

**Reconciliation:** both the specs source and each provider's pricing API are fetched
and merged with the **official provider API as the superior precedence** on every
field it carries. A field the official API does not carry is taken from Vantage but
flagged UNVERIFIED in the refresh diff. This keeps a scraped/aggregated error from
entering the region files unchallenged.

**Cadence:** specs monthly; pricing on a longer (~quarterly) cadence, since provider
list prices change rarely. An empty diff opens no pull request.

**GCP series coverage.** GCP pricing is composed per machine type from the catalogue's
series SKUs (`tools/fetch-official-gcp.js`): vCPU × core-hour + memory-GiB × RAM-hour
(`SERIES_SKU_NAME`), plus, since 3.15.7, attached local SSD × GiB-month ÷ 730
(`LOCAL_SSD_SKU_NAME`). Local SSD is quoted per gibibyte-**month** while cores and RAM
are per hour, which is why the conversion is explicit.

Which SKU a series uses is a **table, not a rule**. Some series have a per-series local-SSD
SKU (`c4`, `c4a`, `h4d`); others have none and are priced from the generic
"SSD backed Local Storage" SKU (`a2`, `a3`, `c3`, `c3d`). `z3` is the reason the distinction
is a table: it _has_ a per-series SKU that does **not** reproduce its published price, so it
is deliberately mapped to the generic one. A new series must be verified against published
prices before it is added, never inferred from the naming pattern.

Anything that does not reproduce the published price is left **unmapped/UNVERIFIED** — the
Vantage price is kept — rather than reconciled to a wrong composed value, because reconcile
prefers the official value and would otherwise overwrite a correct price with a confidently
wrong one. Currently UNVERIFIED: `m1`/`m2` (indistinguishable "Memory-optimized" templates),
`n1` and `c4d` (no usable catalogue SKU), and the single type `m4-ultramem-224` (composes
24.5% low in all 46 regions, with an unexplained 6.008% gap even against its own
per-type SKUs). A refresh that adds such a family surfaces it as UNVERIFIED in the reconcile
report for review.

## Windows pricing

Every record carries a Windows price beside the Linux one, and the recommender ranks a
Windows row on the Windows price (3.15.x). The three providers supply it differently, and
the differences matter when reading a refresh diff:

- **AWS** — vendor-published, `pricing[slug].mswin.ondemand` from Vantage. A **zero** means
  the machine is not sold with Windows (all Graviton, plus the Inferentia, GPU and FPGA
  families), and the recommender treats it that way.
- **Azure** — vendor-published, `pricing[slug].windows.ondemand`. Zero carries the same
  meaning as on AWS.
- **GCP** — **composed by us**, not published per type: `hourly + vCPUs × licensing`
  (`tools/fetch-official-gcp.js`). It is therefore **never zero**, and carries no
  information about whether a machine can run Windows. GCP's Arm types (`c4a`, `t2a`) get a
  synthetic Windows price like every other type despite not being able to run Windows at
  all, which is why the rule engine's Arm exclusion has to stay: for GCP it is the only
  real signal.

**Known limitation — AWS Windows prices that equal the Linux price.** 29.2% of AWS records
(6,840 of 23,429, across 821 types including much of `c5`/`c5a`/`c5ad`, `r6a` and the
`-flex` families) report a Windows price _exactly_ equal to the Linux price. That cannot be
right: AWS charges Windows licensing per vCPU, and the neighbouring types show it — in
`us-west-2` the 8-vCPU `r5a.2xlarge` prices Windows **81% above** its Linux rate, the
per-vCPU licence arithmetic accounting for the difference exactly, while the comparable
`r6a.2xlarge` reports a **0%** premium. The value comes through the vendor feed unmodified —
`fetch-vantage.js` reads `mswin.ondemand` directly and falls back to 0, never to the Linux
price — so this is an upstream gap, not a transformation of ours. The effect is that those
types are understated on Windows and win Windows rows more often than they should; Azure
(3.2% equal) and GCP (0%) are not materially affected. Not yet corrected, because the only
fixes available are to invent the licensing arithmetic ourselves or to distrust a price the
vendor states plainly.

## Key handling

- **Local:** copy `.env.example` to `.env` (gitignored) and fill in `VANTAGE_API_KEY`
  and `GCP_BILLING_API_KEY`. Never commit `.env`.
- **CI:** the same names are GitHub Actions secrets, exposed to the data-refresh
  workflow as environment variables. AWS and Azure need no key.

## Running a refresh

Two paths, same pipeline (the "CI + local runbook" model):

- **CI (default):** the `.github/workflows/data-refresh.yml` schedule (monthly specs;
  pricing on the quarter) or a manual `workflow_dispatch` (`refresh_pricing`, `dry_run`).
  It opens a reviewed PR; a human merges it with the CHANGELOG row + tag.
- **Local, by hand:** `npm run refresh` (specs + pricing) or `npm run refresh -- --specs-only`.
  Needs `VANTAGE_API_KEY` in `.env` (plus `GCP_BILLING_API_KEY` for a pricing run); the
  script loads `.env` itself and never prints a key. It regenerates the `js/` tree, writes
  the diff and reconcile reports under the gitignored `.refresh-cache/`, and prints the
  diff — it does **not** touch git. You then review, re-baseline any shifted goldens (bump
  `sw.js` `CACHE` if a region was pruned), commit `js/` **with** a CHANGELOG version-map
  row + annotated tag, and open the PR. A no-op diff never reaches `split-data`, so the
  shipped tree is untouched and there is nothing to discard.

**Each step consumes what the one before it produced** (both paths):
`official fetch → fetch-vantage → reconcile-data → data-diff → recommendation-diff → split-data`.
Only `split-data` writes into the shipped `js/` tree; everything upstream reads it and
writes to the gitignored `.refresh-cache/`, where the fresh data waits as
`{p}-monolith.js`. That is what lets both diffs read the old data — including each type's
specs, which live in the shipped manifest — while the new data sits beside it, and what
stops a run that dies part-way from leaving a new manifest against old region files.
The recommendation-diff step runs the engine over the old and new data for the sample
inputs and flags any refresh that flips a recommended instance, loudly, in the PR body.

**Records priced for no operating system.** The diff report carries a standing section
listing records the feed supplies with no price for any OS. The recommender drops these
— it cannot rank what it cannot price — and this section is the only place that says so.
It is **not** a change: it is rendered on every run, including a no-change one, and never
on its own opens a PR, because the gaps outlive any single refresh. Each entry names the
regions with no price and counts the regions that do have one; a type priced elsewhere is
a publication lag rather than a withdrawal, since a feed says "not offered here" by
omitting the record entirely. As of 2026-09-03 this is 19 records across 11 types — five
AWS GPU sizes and the six Azure `l*asv3` sizes in `spaincentral`.

## Vetting log

Each refresh is reviewed via pull request (never a bot push to `main`), and the
source data is spot-checked against the providers' own documentation before the
automation is trusted. Record each vetting pass here.

| Date       | Checked                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-21 | Vantage bulk specs + pricing for AWS/Azure/GCP vs shipped data           | Live-fetched all three bulk sources with the provisioned key and mapped every field against the committed region data. AWS and GCP reproduce exactly; Azure generation is absent from Vantage and is carried forward from shipped data. A live fetch→split→integrity dry run passed on all three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-30 | CPU-vendor classification tables for Azure and GCP; full refresh capture | Every Azure family→vendor and GCP series→platform mapping was cross-checked against the vendors' own per-series documentation, not inferred from naming: Azure's feed carries no CPU-vendor field and GCP's carries no architecture field, so the tables are the only available source. `c4n` and `m4n` were confirmed as Intel Emerald Rapids from Google's network-optimized machine-family document. The full three-provider capture ran with reconcile CLEAN and region counts unchanged at 35/60/46. The Azure naming tripwire fired on seven families it could not classify (`nca10v4`, `nccadsh100v5`, `ngadsv620`, `nmadsma35d`, `laosv5`, `lasv5`, `ndamsrv4`); all seven were checked against Microsoft Learn and **deliberately left unclassified** — no `Lasv5` or `Laosv5` page exists, and the naming pattern that would suggest a vendor is exactly the inference the tripwire design forbids. Re-check when the vendor publishes those pages. |

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

**GCP series coverage (known limitation).** GCP pricing is composed per machine type as
vCPU × core-hour + memory-GiB × RAM-hour from the catalogue's series Core/Ram SKUs
(`tools/fetch-official-gcp.js` `SERIES_SKU_NAME`). This does **not** account for local-SSD
or storage-optimized cost, so machine types that bundle local SSD — the `-lssd` variants of
`c4a`/`c4d`/`h4d` and storage/compute-optimized `z3`/`c4` — compose 6–33% below the Vantage
price. Those families are therefore left **unmapped/UNVERIFIED** (Vantage price kept) rather
than reconciled to a wrong composed value, and `m1`/`m2` (indistinguishable "Memory-optimized"
templates) and `n1` (no catalogue SKU) are UNVERIFIED too. A refresh that adds such a family
surfaces it as UNVERIFIED in the reconcile report for review; composing local-SSD cost is a
possible future improvement.

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

## Vetting log

Each refresh is reviewed via pull request (never a bot push to `main`), and the
source data is spot-checked against the providers' own documentation before the
automation is trusted. Record each vetting pass here.

| Date       | Checked                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-21 | Vantage bulk specs + pricing for AWS/Azure/GCP vs shipped data           | Live-fetched all three bulk sources with the provisioned key and mapped every field against the committed region data. AWS and GCP reproduce exactly; Azure generation is absent from Vantage and is carried forward from shipped data. A live fetch→split→integrity dry run passed on all three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-30 | CPU-vendor classification tables for Azure and GCP; full refresh capture | Every Azure family→vendor and GCP series→platform mapping was cross-checked against the vendors' own per-series documentation, not inferred from naming: Azure's feed carries no CPU-vendor field and GCP's carries no architecture field, so the tables are the only available source. `c4n` and `m4n` were confirmed as Intel Emerald Rapids from Google's network-optimized machine-family document. The full three-provider capture ran with reconcile CLEAN and region counts unchanged at 35/60/46. The Azure naming tripwire fired on seven families it could not classify (`nca10v4`, `nccadsh100v5`, `ngadsv620`, `nmadsma35d`, `laosv5`, `lasv5`, `ndamsrv4`); all seven were checked against Microsoft Learn and **deliberately left unclassified** — no `Lasv5` or `Laosv5` page exists, and the naming pattern that would suggest a vendor is exactly the inference the tripwire design forbids. Re-check when the vendor publishes those pages. |

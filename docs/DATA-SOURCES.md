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

## Key handling

- **Local:** copy `.env.example` to `.env` (gitignored) and fill in `VANTAGE_API_KEY`
  and `GCP_BILLING_API_KEY`. Never commit `.env`.
- **CI:** the same names are GitHub Actions secrets, exposed to the data-refresh
  workflow as environment variables. AWS and Azure need no key.

## Vetting log

Each refresh is reviewed via pull request (never a bot push to `main`), and the
source data is spot-checked against the providers' own documentation before the
automation is trusted. Record each vetting pass here.

| Date       | Checked                                                        | Notes                                                                                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-21 | Vantage bulk specs + pricing for AWS/Azure/GCP vs shipped data | Live-fetched all three bulk sources with the provisioned key and mapped every field against the committed region data. AWS and GCP reproduce exactly; Azure generation is absent from Vantage and is carried forward from shipped data. A live fetch→split→integrity dry run passed on all three. |

# AI cost controls — findings and plan

Written 2026-08-20, after the provider abstraction landed. Nothing here is implemented
yet; this is the analysis and the shortlist, parked so it does not block the remaining
build steps.

## Where money can be spent today

Exactly one path: `npm run ai:classify`, run by hand. No API route, no ETL step and no CSV
upload calls a model — `loadAiFindings` (`packages/etl/src/ai/load.ts`) only reads the
committed cache at `data/ai/incident_findings.json`.

That means the useful control is a **ceiling**, not a throttle. There is no traffic to
rate-limit; there is a command that could, under the wrong conditions, cost far more than
intended.

## The three real exposures

### 1. The incident query is unbounded and untenanted — the actual runaway

`loadIncidents()` in `packages/etl/src/ai/classify.ts:58` runs:

```sql
select id, ... from incidents order by incident_date, id
```

No `company_id` filter, no `LIMIT`. On the demo register that is 43 rows, ~6 requests,
pennies. But the API accepts CSV uploads up to 5 MB (`packages/api/src/server.ts:98`) — on
the order of 20,000 incident rows — and every tenant's rows land in the same table. One
upload turns a $0.20 command into a ~2,500-request run, with no point at which it stops to
ask.

The missing tenant scope is a correctness bug independently of cost: one client's register
should never be classified under another client's run.

### 2. `--force` is full price, one flag away

`npm run ai:classify -- --force` discards the cache and reclassifies everything at full
cost, with no confirmation and no estimate shown first.

### 3. Step 12 — the planned `POST /api/reports/summary`

Not built. This is a paid model behind an HTTP endpoint in a multi-tenant app: every page
refresh bills. It is the one place where per-tenant *rate limiting* (as opposed to a
ceiling) genuinely belongs, and it is much cheaper to design in than to retrofit.

## Shortlist, in order of value

| # | Control | Where | Why |
|---|---|---|---|
| 1 | **Spend ceiling in the batch loop.** Track accumulated tokens; before each request, project the cost of the next batch and abort with a clear message if it would cross `AI_MAX_SPEND_USD` (default ~$2). | `classify.ts` main loop | Catches every runaway regardless of cause, including ones not anticipated here. ~15 lines. |
| 2 | **`MAX_INCIDENTS_PER_RUN`** (~100) plus a `company_id` filter and `LIMIT` on the query. Over the cap, refuse and require an explicit `--max-incidents=`. | `loadIncidents()` | Closes exposure 1 at the source and fixes the tenant leak. |
| 3 | **Cost preview and `--yes`.** Print batches, projected tokens and (where a rate is on file) projected spend; require confirmation for `--force` or any run over the cap. | `classify.ts` | Makes the expensive action deliberate rather than incidental. |
| 4 | **Vendor-side budget caps.** Anthropic Console → Billing → spend limit; OpenAI → project budget limits. Use a **separate project and key for this repo**. | Not code | The only control that cannot be bypassed by a path nobody thought of, and the only one that survives a leaked key. |
| 5 | **Per-workspace rate limit + result cache** — `@fastify/rate-limit`, and cache the summary per (workspace, period) so repeats are free. | Only once step 12 exists | Without it, refreshing the dashboard is a billable event. |

Recommended minimum: **1, 2 and 4.** Item 4 costs two minutes in a browser and is the only
actual guarantee; 1 and 2 stop the plausible accident.

## Deliberately not doing

- **Concurrency limits.** The batch loop is already strictly sequential — one request in
  flight at a time. There is no burst to cap.
- **Retry backoff.** The regrounding round is bounded to one retry per batch by
  construction, so it cannot loop.

## Adjacent: cost reduction, not a limit

`SYSTEM_PROMPT` is roughly 900 tokens and is re-sent on every batch. Anthropic prompt
caching (`cache_control` on the system block) would cut input cost on any run longer than a
few batches. Worth doing at the same time as item 1, since both touch the same call site.

# Ironbark Ridge

Emissions, safety and data quality intelligence over 18 months of operational data from a
fictional Queensland open-cut mine.

Built for the ESGAgent.ai take-home challenge. See [`ASSIGNMENT.md`](./ASSIGNMENT.md) for
the brief and [`WRITEUP.md`](./WRITEUP.md) for the decisions behind every part of it.

## What it does

- **Cleans the export and says what it did.** 22 rules, 99 findings, each one recorded
  against the source file and line with an action of fixed, flagged or rejected. Nothing
  is dropped silently, and every corrected value keeps the original beside it.
- **Computes Scope 1 and Scope 2 in SQL views**, so the numbers on screen and the numbers
  in a `psql` session cannot drift apart.
- **Reads the free text incident descriptions with an LLM**, finds psychosocial hazards
  whatever code they were filed under, and flags incidents whose description does not
  support the recorded severity. Every finding quotes the source text word for word, and a
  finding whose quote is not in the record is rejected before it is stored.
- **Writes a cited compliance summary.** Every sentence carries citations to figures the
  database computed, and any sentence stating a number the cited facts do not contain is
  discarded before it is shown.
- **Explains March 2026**, the month where the headline total falls and the picture is
  actually worse. The API detects that month rather than being told which it is.
- **Is multi-tenant.** A company signs up, uploads its own five CSVs, and sees only its own
  data.

## Layout

```
data/raw/          the client export, never modified
data/ai/           committed model output, so the app runs with no API key
packages/shared/   domain types used by every layer
packages/db/       connection pool and schema migrations
packages/etl/      parse, clean, load, classify
packages/api/      Fastify read API, upload, compliance summary
packages/web/      Vue 3 dashboard
```

## Quickstart

Requires Node 22 or later and Docker.

```bash
cp .env.example .env
npm install
npm run db:up          # Postgres 16 in Docker, waits until healthy
npm run db:migrate     # 9 SQL migrations, checksum verified
npm run etl            # clean and load data/raw/
npm run api            # http://localhost:4000  (OpenAPI at /api/docs)
npm run web            # http://localhost:5173
```

Then sign in as **`demo@ironbarkridge.com.au` / `demo1234`**. That workspace is seeded by
migration `0007_tenancy.sql` and `npm run etl` loads the export into it.

You can also register a new company from the sign-in screen and upload the five CSVs from
`data/raw/` through the UI. Uploads run the same pipeline as the command line, so a
cleaning rule cannot apply in one place and quietly not apply in the other.

Postgres binds to host port **5433** rather than 5432 so it will not collide with a local
install. Change `POSTGRES_PORT` in `.env` if that port is taken too. `npm run db:down`
stops the container and `npm run db:reset` also destroys the volume.

**No API key is needed.** Both AI outputs are committed, so the whole application runs
without buying inference.

## Checks

```bash
npm test          # 265 tests; the database suites skip if Postgres is down
npm run typecheck
npm run writeup   # regenerate the data-quality tables in WRITEUP.md from the rule engine
```

CI runs the same sequence on every push against a real Postgres service container,
including the pipeline over the actual export.

## Re-running the AI layer

Both commands need a key and neither is required to run the app.

```bash
npm run ai:classify                        # classify anything not already cached
npm run ai:classify -- --force             # reclassify everything
npm run ai:report                          # regenerate the cited compliance summary
npm run ai:report -- --provider=openai     # pick the vendor for this run
```

Either vendor works. Set one key in `.env` and the provider is inferred. Set both and the
run stops and asks which to use, because the model that produced a finding is part of its
audit trail and is not something to leave to whichever key happened to be exported.
Findings are stamped with the model that produced them, so switching vendor reclassifies
from scratch rather than merging two models' output under one label.

The grounding gate, the prompt and the batching are identical either way. A provider only
makes the wire call, so nothing about which findings are acceptable can change with the
vendor.

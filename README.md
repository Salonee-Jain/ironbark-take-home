# Ironbark Ridge

Emissions, safety and data-quality intelligence over 18 months of operational data from a
fictional Queensland open-cut mine.

Built for the ESGAgent.ai take-home challenge — see [`ASSIGNMENT.md`](./ASSIGNMENT.md) for
the brief.

## Layout

```
data/raw/          the client export, never modified
packages/shared/   domain types used by every layer
packages/db/       connection pool and schema migrations
packages/etl/      parse, clean, load  (steps 3-4)
packages/api/      read API            (step 6)
packages/web/      Vue dashboard       (step 9)
```

## Quickstart

```bash
cp .env.example .env
npm install
npm run db:up          # Postgres 16 in Docker, waits until healthy
npm run db:check       # confirm the host can connect
npm run etl            # clean and load the source files
npm run api            # http://localhost:4000 (docs at /docs)
npm run web            # http://localhost:5173
```

Postgres binds to host port **5433**, not 5432, so it will not collide with a local
install. Change `POSTGRES_PORT` in `.env` if that port is taken too. `npm run db:down`
stops the container; `npm run db:reset` also destroys the volume.

Requires Node 22+ and Docker. An API key is optional — the AI findings are committed, so
the app runs without one.

## Re-running the AI classification

Classification works against either Anthropic or OpenAI. Set one key in `.env` and the
provider is inferred:

```bash
npm run ai:classify                        # anything not already cached
npm run ai:classify -- --force             # reclassify everything
npm run ai:classify -- --provider=openai   # pick the vendor for this run
```

With both keys present, the run stops and asks which to use — set `AI_PROVIDER` or pass
`--provider=`. Findings are stamped with the model that produced them, so switching vendor
reclassifies from scratch rather than merging two models' output under one label. Model
choice is `ANTHROPIC_MODEL` / `OPENAI_MODEL`; see `.env.example` for the rest.

The grounding gate, the prompt, and the batching are identical either way — a provider
only makes the wire call, so nothing about which findings are acceptable can change with
the vendor.

## Where to look

[`WRITEUP.md`](./WRITEUP.md) is the document to read: how to run it, every data problem
found and what was done about each, the March 2026 cross-dataset finding, an account of
how AI tools were used and what they got wrong, and what would come next.

```bash
npm test          # 228 tests; the database suites skip if Postgres is down
npm run writeup   # regenerate the data-quality tables from the rule engine
```

# Ironbark Ridge

Emissions, safety and data-quality intelligence over 18 months of operational data from a
fictional Queensland open-cut mine.

Built for the ESGAgent.ai take-home challenge — see [`ASSIGNMENT.md`](./ASSIGNMENT.md) for
the brief and [`PLAN.md`](./PLAN.md) for the build plan.

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

Requires Node 22+ and Docker. An `ANTHROPIC_API_KEY` is optional — the AI findings are
committed, so the app runs without one.

> Work in progress. The full run-and-verify instructions land with the write-up in step 14.

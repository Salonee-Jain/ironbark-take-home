# Ironbark Ridge — Build Plan

18 steps, each ending in a commit. Order is dependency-driven: nothing downstream is
blocked waiting on the AI layer or the frontend.

## Step 0 — Repo skeleton
`git init` (this folder is not yet a repo), `.gitignore`, `.env.example`, npm workspaces:
`packages/etl`, `packages/api`, `packages/web`, `packages/shared`. Node 22, TypeScript strict.
Move `data/` to `data/raw/` untouched — raw files are never edited in place.
**Commit:** `chore: scaffold monorepo`

## Step 1 — Docker Compose + Postgres
`docker-compose.yml` with Postgres 16 + healthcheck, `DATABASE_URL` in `.env.example`.
Verify `docker compose up -d` then a connection smoke test.
**Commit:** `chore: postgres via docker compose`

## Step 2 — Schema and migrations
Plain SQL migrations (no ORM lock-in). Tables:

- `fuel_deliveries` — invoice_no, delivery_date, `date_precision` ('day'|'month'), fuel_type,
  quantity_l (normalised), original_quantity + original_unit (audit trail), cost_aud,
  site_area_id, is_credit_note, source_row_number
- `electricity_readings` — meter_id, period (date, 1st of month), consumption_kwh,
  original_consumption, unit_correction_applied bool
- `meters` — meter_id, description, first_seen, last_seen
- `incidents` — incident_id, source_incident_id (dupes keep the original), incident_date,
  location, type_code, severity_raw, severity_normalised 1-3, description, source_row_number
- `suppliers` — supplier_name, name_canonical, abn, abn_valid, category, category_canonical,
  fy_spend_aud, duplicate_of_id
- `emission_factors` — activity, scope, unit, kg_co2e_per_unit, source
- `data_quality_issues` — **the spine**: id, source_file, source_row_number, record_key,
  rule_id, severity ('error'|'warning'|'info'), category, description, original_value,
  resolved_value, action ('fixed'|'flagged'|'rejected'), detected_at
- `ai_incident_findings` — incident_id, category, is_psychosocial, severity_assessment,
  severity_mismatch bool, confidence, `evidence_quote` (must appear verbatim in the
  description), rationale, model, prompt_version, created_at

Views: `v_monthly_emissions` (scope 1 + 2 by month), `v_incident_monthly`.

**Rationale to write down:** every normalisation keeps the original value alongside it, so
any number on screen can be traced back to a raw cell. That's the compliance requirement.
**Commit:** `feat(db): schema and migrations`

## Step 3 — ETL: parsers + normalisers (pure functions, no DB)
`packages/etl/src/normalise/`:
- `date.ts` — handles `YYYY-MM-DD`, `DD/MM/YYYY`, `Mon-YY`. Returns `{date, precision}`.
  `Mon-YY` → 1st of month, precision `'month'`. **Never** guess a day.
- `quantity.ts` — `L|litres|Litres` → ×1, `kL` → ×1000. Cross-check: implied $/L must land
  in $1.60–2.10, else raise a DQ warning instead of trusting the conversion.
- `currency.ts` — strips `$` and thousands separators, keeps sign.
- `severity.ts` — `Low→1, Medium→2, High→3`, numerics pass through, anything else rejected.
- `abn.ts` — 11 digits + the ATO modulus-89 checksum.
- `entityName.ts` — canonicalises `Pty Ltd`/`P/L`, collapses whitespace, fuzzy match
  (Levenshtein) + exact-ABN match for supplier dedup.

This is where the tests go first (Step 8).
**Commit:** `feat(etl): normalisation primitives`

## Step 4 — ETL: loaders + the DQ rule engine
One loader per file. Every rule emits a `data_quality_issues` row with an explicit action.
Nothing is ever dropped silently.

| Rule | Finding | Action |
|---|---|---|
| DUP-FUEL-01 | 7 duplicate invoices (40497, 40349, 40715, 40292, 40962, 40357, 40266) | **fixed** — keep first, second `rejected` with a pointer to the survivor |
| NEG-FUEL-01 | INV-41777 −12,500 L, out-of-sequence invoice no. | **flagged** — loaded as `is_credit_note`, nets off the total, surfaced for client confirmation |
| UNIT-FUEL-01 | 11 rows in kL | **fixed** — ×1000, original retained |
| DATE-FUEL-01 | 29 rows month-only | **flagged** — precision recorded; safe for monthly totals, unsafe for daily |
| SITE-FUEL-01 | 74,883 L diesel billed to "Light Vehicles" | **flagged** — plausible miscoding, not auto-corrected |
| UNIT-ELEC-01 | MTR-07 ÷1000 from 2025-10 (9 months) | **fixed** — ×1000, with the level-shift evidence recorded; this materially raises Scope 2 |
| GAP-ELEC-01 | No MTR-06 anywhere in 18 months | **flagged** — unexplained meter gap, possible unreported load |
| ANOM-ELEC-01 | 2026-03 all meters ~35% of normal | **flagged, NOT corrected** — real event (see Step 11) |
| DUP-INC-01 | INC-2025-011 used for two incidents | **fixed** — second gets a suffixed surrogate key, original preserved |
| SCALE-INC-01 | Mixed `Low/Medium` and `1/2/3` severity scales | **fixed** — normalised, both stored |
| LOC-INC-01 | Description contradicts location (crusher → "Haul Fleet") | **flagged** |
| DUP-SUP-01 | Ironline ×2, Blackwood ×2 (same ABN, spelling variant) | **fixed** — merged; true spend $10.15M / $2.57M |
| ABN-SUP-01 | TerraForm ABN is 7 digits; 2 blanks | **flagged** — invalid, never silently zeroed |
| CAT-SUP-01 | "Fuel supply" vs "Fuel" | **fixed** — canonical category |

`npm run etl` is idempotent: truncate + reload, deterministic output.
**Commit:** `feat(etl): loaders and data-quality rules`

## Step 5 — Emissions calculation
In SQL, not application code, so the numbers are inspectable:
Scope 1 = (diesel L × 2.70) + (petrol L × 2.31), Scope 2 = kWh × 0.71.
Month-precision fuel rows land in their month. Credit notes net off. Every monthly figure
carries `contributing_records` and a `has_quality_flags` bit — a chart that can't tell you
which numbers are shaky is a liability.
**Commit:** `feat(db): emissions views`

## Step 6 — API (Fastify + zod)
- `GET /api/emissions/monthly?from=&to=` — scope 1/2 split, kg CO2e, activity breakdown, flags
- `GET /api/emissions/summary` — totals, intensity, MoM/YoY
- `GET /api/incidents?month=&type=&severity=` and `/api/incidents/trends`
- `GET /api/data-quality` — grouped by file/severity/action, with row-level drilldown
- `GET /api/incidents/:id` — record + its AI findings + its DQ issues (the traceability endpoint)
- `GET /api/suppliers`
- `GET /health`
OpenAPI via `@fastify/swagger` at `/docs`.
**Commit:** `feat(api): core endpoints`

## Step 7 — AI layer (Anthropic, `claude-sonnet-5`)
`packages/etl/src/ai/classify.ts`, batched ~10 incidents per call, tool-use for a forced
JSON schema. Per incident, the model returns: category, `is_psychosocial`,
`severity_assessment`, `severity_mismatch`, confidence, `evidence_quote`, rationale.

**Grounding gate** — a post-processor rejects any finding whose `evidence_quote` is not a
verbatim substring of that incident's description, and any `incident_id` not in the DB.
Rejections are logged, not silently dropped. This is the single most important guard in the
project and it gets its own test.

Output cached to `data/ai/incident_findings.json`, committed, so the app runs with no API
key. `npm run ai:classify -- --force` re-runs. Cost: well under $1.

**Expected catches:** the 4 psychosocial records mis-coded `OTH`
(INC-2025-127, INC-2025-152, INC-2026-109, INC-2026-134), and the severity contradictions
INC-2025-118 (fractured forearm, surgery → severity 1) and INC-2025-141 (LTI, sutures →
severity 1).
**Commit:** `feat(ai): grounded incident classification`

## Step 8 — Tests (Vitest)
Test what would cause a wrong compliance number, not everything:
1. **Normalisers** — every date format, `kL`, `$`-currency, severity scales, ABN checksum.
   Property test: normalisation never loses the original value.
2. **Emissions golden test** — hand-computed month checked against the SQL, including the
   MTR-07 correction and the credit note.
3. **DQ engine** — a fixture CSV carrying every known defect; assert all 14 rules fire with
   the right action. Regression net for the whole cleaning layer.
4. **AI grounding validator** — a fabricated `evidence_quote` must be rejected; a valid one
   must pass. Prove hallucinations can't reach the UI.
5. **API integration** — endpoints against a seeded test DB.
`WRITEUP.md` explains *why these five*.
**Commit:** `test: normalisers, emissions, dq rules, ai grounding`

## Step 9 — Frontend shell
Vue 3 + Vite + TS + Pinia + Tailwind + ECharts. Router, API client, loading/error states,
dark-mode-aware palette.
**Commit:** `feat(web): app shell`

## Step 10 — The main screen
One screen, done properly. Top to bottom:
1. **KPI row** — total CO2e, Scope 1/2 split, incidents, open DQ issues (each clickable)
2. **Monthly emissions stacked bar**, Scope 1 vs Scope 2, with **March 2026 annotated** —
   the visual payoff of Step 11
3. **Safety panel** — incidents by month/type, with AI-identified psychosocial hazards called
   out separately and severity-mismatch records badged
4. **Data quality panel** — issues by severity and action, drill-down to the raw row
Every AI-derived element shows its evidence quote and links back to the source record.
**Commit:** `feat(web): operations dashboard`

## Step 11 — The March 2026 event (the differentiator)
A correlation view that stitches the three datasets into one narrative:
grid supply collapses (−65% kWh, all 6 meters) → diesel generation substitutes in
(5 deliveries >100,000 L, ~2.5× baseline) → Scope 2 falls, **Scope 1 rises harder**, because
diesel is the dirtier factor → the safety tail lands as INC-2026-134, crew fatigue from
generator operations. Root cause is INC-2026-131, the substation failure.

Shown as an event-anchored timeline with the causal chain drawn explicitly, plus a
counterfactual: what March 2026 emissions *would* have been on grid supply. The
lesson — "our emissions fell in March" is exactly wrong, and no single dataset can tell you
that.
**Commit:** `feat: outage correlation analysis`

## Step 12 — AI compliance summary with citations
`POST /api/reports/summary` — a narrative period summary where every claim carries an
inline citation to a record ID or an aggregate query. Same grounding gate as Step 7:
unciteable claims are stripped before rendering.
**Commit:** `feat(ai): cited compliance summary`

## Step 13 — CI
GitHub Actions: lint → typecheck → test → build, Postgres service container, ETL run on the
real data as a smoke test.
**Commit:** `ci: github actions pipeline`

## Step 14 — WRITEUP.md
Covers all five required sections. The data-problems table comes straight out of
`data_quality_issues` (generated, not hand-typed — so it can't drift from the code). The
unasked-for insight is Step 11. The AI section is honest about what the model got wrong:
what the grounding gate caught, any mis-categorisations, and how the batch prompt was
revised. "Next week" = NL query interface, supplier Scope 3 estimation, alerting.
**Commit:** `docs: writeup`

## Step 15 — Final pass
`.env.example` complete, no secrets in history (`git log -p | grep -i` for key patterns),
`docker compose up` verified from a clean clone, README quickstart, screenshots.
**Commit:** `docs: readme and quickstart`

---

### Stretch (only if time remains)
- **NL query over the DB** — LLM emits SQL against a read-only role, allowlisted views,
  the generated SQL shown to the user before it runs.
- Supplier-spend-based Scope 3 estimate.
- Anomaly detection generalised beyond the March event (z-score per meter per site area).

### Sequencing notes
Steps 3–5 are the load-bearing ones; the API, AI and UI are all thin on top. If time runs
short, cut Step 12 first, then Step 13. Do **not** cut Step 8.

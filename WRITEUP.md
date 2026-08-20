# Ironbark Ridge — write-up

Emissions, safety and data-quality intelligence over 18 months of operational data
from a fictional Queensland open-cut mine.

The organising idea: **every number on screen can be traced back to the raw cell it
came from.** Every normalisation keeps the original value beside it, every
correction records what it changed and why, and every AI finding carries a quote
that must appear verbatim in its source record. That constraint drove the schema,
the ETL, the API and the tests, and it is the thing I would defend hardest in
review.

---

## 1. How to run it

Requires **Node 22+** and **Docker**.

```bash
cp .env.example .env
npm install
npm run db:up          # Postgres 16, waits until healthy
npm run db:migrate     # 8 SQL migrations, checksum-verified
npm run etl            # clean and load data/raw/
npm run api            # http://localhost:4000  (OpenAPI at /docs)
npm run web            # http://localhost:5173
```

Sign in as **`demo@ironbarkridge.com.au` / `demo1234`** — the demo tenant is seeded
by migration `0007_tenancy.sql`, and `npm run etl` loads the export into it. Or
register a new company and upload the five CSVs through the UI; uploads run the
identical pipeline, so a data-quality rule cannot be enforced on the command line
and quietly skipped on upload.

Postgres binds to host port **5433**, not 5432, so it will not collide with a local
install. `npm run db:down` stops it; `npm run db:reset` also destroys the volume.

**No API key is needed.** The AI findings are cached in
`data/ai/incident_findings.json` and committed, so the whole application runs
without buying inference. A key is only needed to re-run classification.

```bash
npm test               # 228 tests; the DB suites skip if Postgres is down
npm run typecheck
npm run writeup        # regenerate the tables in section 2 from the rule engine
```

CI runs the same sequence on every push against a real Postgres service
container — including the ETL over the actual export, so a parser that breaks on
real input fails there rather than in a demo.

### Layout

```
data/raw/          the client export, never modified
packages/shared/   domain types used by every layer
packages/db/       pool, migrations, emissions views
packages/etl/      parse, clean, load, classify
packages/api/      Fastify read API + upload
packages/web/      Vue 3 dashboard
```

Emissions arithmetic lives in **SQL views**, not application code, so the numbers
on screen and the numbers in a `psql` session cannot drift apart. That choice is
why `packages/db/src/emissions.test.ts` computes a month longhand — a test that
asks the database to confirm its own arithmetic passes whatever the views say.

---

## 2. The data problems, and what I did about each

Every finding is a row in `data_quality_issues`, keyed to the source file and the
physical line number, with an explicit action: **fixed**, **flagged**, or
**rejected**. Nothing is dropped silently. The API serves the whole catalogue with
its reasoning at `/api/data-quality/rules`.

The table below is **generated** from the rule engine by `npm run writeup`, run
against `data/raw/`. It is not hand-maintained, because prose does not fail a build
and a hand-typed table starts lying the first time a rule changes.

<!-- BEGIN GENERATED: data-quality -->

**99 findings across 22 rules.** By action: 37 fixed, 55 flagged, 7 rejected. By severity: 31 error, 42 warning, 26 info.


#### `electricity_meter_readings.csv`

| Rule | What was wrong | n | Action | Why |
|---|---|---:|---|---|
| `ELEC-CONSUMPTION-DROP-01` | Site-wide consumption far below the period norm | 1 | **flagged** | Same robust outlier test as the fuel spike rule, applied to site-wide monthly consumption. Explicitly NOT corrected: the incident register records a regional substation failure and three weeks on backup generation for the month this fires, so the reading is real. |
| `ELEC-METER-GAP-01` | Gap in the meter numbering | 1 | **flagged** | Meters run MTR-01 to MTR-07 with MTR-06 absent for all 18 months. Either it was decommissioned, or a load is not being reported. |
| `ELEC-UNIT-SCALE-01` | Meter readings recorded in MWh but labelled kWh | 9 | **fixed** | MTR-07 reads ~250,000 kWh a month through September 2025, then ~250 from October onward, with the unit column still saying kWh. |

#### `fuel_deliveries.csv`

| Rule | What was wrong | n | Action | Why |
|---|---|---:|---|---|
| `FUEL-CREDIT-01` | Negative quantity — appears to be a credit note | 1 | **flagged** | INV-41777 records -12,500 L against -$23,375.00, and its invoice number sits outside the 40xxx block used by every other row. |
| `FUEL-DATE-PRECISION-01` | Delivery date states month only | 29 | **flagged** | Dates like `Oct-25` have no day. The row is anchored to the first of the month and marked date_precision=month. |
| `FUEL-DUP-01` | Duplicate invoice number | 7 | **rejected** | Seven invoice numbers appear twice, each time as an exact repeat of every other field. Two identical deliveries on the same invoice is not a thing that happens, so the second copy is a re-export artefact. |
| `FUEL-FORMAT-01` | Mixed date and currency formats within a column | 1 | **fixed** | One column carries three date formats (ISO, day-first slash, month-year) and costs appear both as "$182,946.64" and as 132182.58. |
| `FUEL-HEADER-01` | Column headers carry stray whitespace | 1 | **fixed** | Headers are written as `Invoice No`, ` Delivery Date`, `Fuel Type `, ` Unit`. Trimmed on read. |
| `FUEL-MONTH-GAP-01` | No fuel deliveries recorded for a month inside the reporting period | 1 | **flagged** | November 2025 contains no fuel invoices at all, between an October with 8 and a December with 7. The site was plainly operating — the meters record a full month of electricity — so this is missing paperwork, not a shutdown. |
| `FUEL-SITE-FLEET-01` | Bulk diesel delivered to a light-vehicle fleet | 3 | **flagged** | The Light Vehicles fleet otherwise takes petrol in consistent ~4,000 L loads. A few tens of thousands of litres of diesel against that site area is most likely a coding error at the invoice level. |
| `FUEL-UNIT-KL-01` | Quantity recorded in kilolitres | 11 | **fixed** | Eleven rows record kL against a column whose other 139 rows are litres. Converted x1000, with the original value and unit retained. |
| `FUEL-VOLUME-SPIKE-01` | Monthly fuel volume far above the period norm | 1 | **flagged** | Outliers are found with a modified z-score against the median absolute deviation, not a hand-picked multiple of the median. |

#### `incident_register.csv`

| Rule | What was wrong | n | Action | Why |
|---|---|---:|---|---|
| `INC-DESC-REUSED-01` | Identical description reused across incidents | 9 | **flagged** | Several descriptions appear word for word on multiple incidents at different dates and locations. Two very different explanations: copy-paste in the register, or a hazard genuinely recurring without being addressed. |
| `INC-DUP-ID-01` | Incident ID used for more than one incident | 1 | **fixed** | INC-2025-011 identifies two different incidents on two different dates with different descriptions. Unlike the fuel duplicates these are distinct events, so neither can be dropped. |
| `INC-ID-SEQUENCE-01` | Incident ID far outside the main sequence | 1 | **flagged** | Most IDs form a dense run from 001. A handful sit far above it with a large gap in between, which suggests they were merged in from a different register rather than issued by this one. |
| `INC-LOCATION-01` | Description names a place inconsistent with the recorded location | 3 | **flagged** | Deliberately narrow: fires only when the text names fixed infrastructure (crusher, wash plant, CHPP, ROM pad, thickener) while the location column holds a mobile fleet. |
| `INC-SEV-MAPPED-01` | Text severity mapped to the numeric scale | 11 | **fixed** | Row-level trace of each Low/Medium value converted to a number, so the mapping is visible per record rather than only as a policy statement. |
| `INC-SEV-SCALE-01` | Two severity scales in one column | 1 | **flagged** | The column mixes Low/Medium with 1/2/3. We map Low=1, Medium=2, High=3, which assumes both are the same three-point scale written differently. |

#### `suppliers.csv`

| Rule | What was wrong | n | Action | Why |
|---|---|---:|---|---|
| `SUP-ABN-CHECKSUM-01` | All ABNs fail the ATO checksum | 1 | **flagged** | Twelve of the fifteen suppliers carry a correctly formed 11-digit ABN, and all twelve fail the modulus-89 checksum. |
| `SUP-ABN-FORM-01` | ABN missing or not 11 digits | 3 | **flagged** | An ABN is 11 digits. One supplier records 7, two record none. |
| `SUP-CATEGORY-01` | Inconsistent category label | 1 | **fixed** | The same category is written two ways ("Fuel supply" and "Fuel"). Aligned to the label used by the primary record of the pair, so spend groups correctly. |
| `SUP-DUP-01` | Supplier appears more than once | 2 | **fixed** | Two entities are listed twice: once as a legal-suffix variant (Pty Ltd / P-L) and once as a spelling error sharing an ABN (Maintenance / Maintanence). |

A further 3 rules are implemented and did not fire on this export (`FUEL-PRICE-01`, `FUEL-SITE-UNKNOWN-01`, `INC-TYPE-UNKNOWN-01`). They guard against values this file happens not to contain, and are covered by fixtures in `packages/etl/src/load/defensiveRules.test.ts` so that "silent" stays distinguishable from "broken".

<!-- END GENERATED: data-quality -->

### The three decisions worth arguing about

**The kL rows are converted; the credit note is not "corrected".** Eleven fuel rows
record kilolitres in a column whose other 139 are litres. Converting them is
unambiguous, and confirmed independently by cost: afterwards they imply
$1.73–$1.93/L, inside the range set by every other delivery, where before they
implied roughly $1,800/L. That cross-check compares two independently recorded
columns, so it catches a unit error even when the quantity and the cost each look
reasonable alone. Left uncorrected this understates Scope 1 by about 750,000
litres — an error in the direction nobody questions.

The negative row, INV-41777, is different. It records −12,500 L against −$23,375.00
with an invoice number outside the 40xxx block every other row uses. That reads as
a credit note, so it is loaded with `is_credit_note = true` and nets off the totals.
Deleting it would overstate consumption; flipping the sign would double-count it.
It is flagged for the client to confirm because we are inferring intent from a sign.

**The March 2026 electricity collapse is flagged and explicitly NOT corrected.**
Every meter drops to about a third of normal in the same month. That has the shape
of a unit error, and a pipeline that "smoothed" it would erase the single most
important event in the reporting period. See section 3.

**The systematic ABN failure is reported once, not thirteen times.** All twelve
well-formed ABNs fail the ATO modulus-89 checksum. When a rule fails for 100% of the
rows it applies to, the honest conclusion is that the source is systematically
different from what the rule assumes — synthetic or masked values — not that the
client has twelve separate problems. So `wellFormed` and `checksumValid` are kept
separate: the structural defect (TerraForm's 7-digit value, two blanks) is reported
per row, and the checksum result once at file level, where it cannot bury the one
finding the client can actually act on.

### Two problems the pipeline found that I had not predicted

**November 2025 contains no fuel invoices at all** — between an October with 8 and a
December with 7, while the meters record a completely normal month of electricity.
The site was plainly operating, so this is missing paperwork, not a shutdown. Scope 1
is understated for that month by roughly a month of diesel. A gap is invisible unless
something goes looking for the *absence* of rows, which is why this is a rule and not
an observation. Flagged, never interpolated: estimating the missing volume would put
an invented number into a compliance report.

**The anomaly threshold I planned would have missed the March fuel spike.** I had
intended a fixed multiple of the median (1.6×). March 2026 is only 1.49× the median,
so it would have passed silently. The engine uses a modified z-score against median
absolute deviation instead, which puts that month **6.1 deviations** clear of a
series that otherwise holds between 0.85× and 1.14×. A fixed threshold has to be
tuned against the answer you already expect; this one does not.

---

## 3. The insight nobody asked for: March 2026 is not a good month

Read the emissions chart alone and March 2026 looks like the best month in the
period. Total CO2e falls 11.5% against February. On any dashboard that reports a
single headline number, that is a win.

It is the opposite of a win, and no single dataset can tell you so.

| | Feb 2026 | Mar 2026 | change |
|---|---:|---:|---:|
| Scope 1 (diesel, petrol) | 1,311,810 kg | 1,893,860 kg | **+44.4%** |
| Scope 2 (grid electricity) | 1,402,583 kg | 507,101 kg | **−63.8%** |
| **Total** | 2,714,393 kg | 2,400,961 kg | −11.5% |
| Scope 1 share | 48.3% | **78.9%** | +30.6 pts |

The three files, read together, give the whole causal chain:

1. **The incident register names the cause.** `INC-2026-131`, 6 March, severity 3:
   *"Regional substation failure caused loss of grid supply to site. Backup diesel
   generators run continuously for approximately three weeks."*
2. **The meters show the effect.** Site-wide consumption falls to 714,227 kWh from a
   median of ~2.0 million — 36% of normal, across **all six meters at once**. A
   simultaneous fall on every meter is a supply event, not a metering fault.
3. **The fuel invoices show the substitution.** 702,017 L in March against a
   pre-March monthly average of 454,156 L — **55% more diesel**, in the month the
   grid went down.
4. **The safety register shows the human tail.** `INC-2026-134`, 24 March:
   *"Multiple crews reporting fatigue after extended shifts covering generator
   operations and manual restarts…"* — coded `OTH`, which is where psychosocial
   hazards go to be invisible.

So the reported improvement is three weeks of disrupted operations. Had the grid
held and consumption stayed at February's level, March would have been roughly
**2.71 million kg** rather than 2.40 million. The site did not decarbonise; it
partly stopped, and ran the part that kept going on a dirtier fuel.

**Why this matters beyond one month.** Scope 1 share is stable near 47% for
seventeen months and then jumps to 79%. That ratio is a better operational health
signal than the total, because it is insensitive to how *much* you produced and
sensitive to *how* you powered it. The dashboard therefore plots the share as a
first-class series next to the totals, and annotates March with the incident that
explains it.

This is also the argument for putting all four files in one schema. Each dataset on
its own supports a confident and wrong conclusion: emissions improved; consumption
dropped; fuel spiked; a crew got tired. Only together do they say *a substation
failed, and the compliance number moved in the flattering direction for a bad
reason.*

---

## 4. How I used AI tools building this, and what they got wrong

I built this with **Claude Code** as the primary tool, working in a loop: I set the
architecture and the decision rules, it drafted, and I checked the output against
data or a running system rather than against how plausible it read. Nearly
everything it got wrong was plausible.

**What worked.** Generating the rule catalogue and the loaders from a spec I wrote,
where the spec named the defect and the intended action. Writing tests once the
behaviour was pinned down. Restructuring the AI classifier behind a provider seam
so it runs against Anthropic or OpenAI. In each case the model was fast at the
mechanical part and I stayed responsible for the judgement — which record to trust,
what a rule is entitled to change, what counts as evidence.

**What it got wrong, and how I caught it.** These are from this build, not
hypotheticals:

- **It invented plausible API response shapes.** Writing the integration tests, it
  assumed endpoints returned bare arrays. Eight tests failed on first run:
  `/api/emissions/monthly` returns `{months: [...]}` with months as `YYYY-MM`, and
  `/api/incidents/:id` returns `{incident, dataQualityIssues, aiFindings}`. *Caught
  by running the tests.* Every one of those assertions looked reasonable and was
  wrong — which is the argument for integration tests over mocks.

- **It asserted a number that disagreed with the pipeline, and the pipeline was
  right.** A test claimed 29 fuel rows load at month precision, because 29 findings
  are raised. Only 26 load: three of those rows are *also* exact duplicates and are
  rejected afterwards. Findings count what was seen in the file; the table counts
  what survived. The test now asserts that relationship rather than either number,
  so a change to dedup or precision handling has to be deliberate.

- **A test suite silently skipped instead of running.** The database suites chose
  `it` vs `it.skip` from a flag set in `beforeAll` — but `describe` bodies run at
  collection time, so the flag was always false and both suites skipped against a
  perfectly good database while reporting green. *Caught by reading the run output
  rather than the exit code.* They now detect at module scope, and CI sets
  `REQUIRE_DB=1` to turn a skip into a failure, so the convenience cannot become
  permanent.

- **It reasoned from a library default the codebase had already overridden.** It
  assumed `pg` returns `NUMERIC` as a string. `packages/db/src/pool.ts` overrides
  exactly that, deliberately and with a comment explaining why. The test failed on
  `'2.7000'` vs `2.7`.

- **It proposed emission factors from memory when asked to fill a gap.** The brief
  says use the supplied file as-is. Recalled NGER-style factors are exactly the kind
  of confident, unsourced number this project exists to prevent. Rejected; the
  factors are loaded from `emission_factors.csv` and the test restates them from the
  file rather than from the table it is checking.

**The pattern.** The failures were never syntax and never obviously wrong. They were
confident claims about things it had not looked at — a response shape, a library
default, a number that ought to follow. The mitigation was structural, not
attentional: run it against real data, assert relationships rather than magic
numbers, and read the output rather than the exit status. That is also the
reasoning behind the grounding gate in the AI layer — the same failure mode, one
level down.

**A bug the tests found that review had not.** `?from=2026-13` returned a 500. The
month pattern counted digits (`^\d{4}-\d{2}$`) rather than checking range, so month
13 passed validation and failed casting in Postgres. Fixed in
`packages/api/src/schemas/common.schema.ts`; the OpenAPI document is generated from
the same object, so it now documents the real constraint too.

### The AI layer, and why it is built the way it is

Classification runs over the free-text incident descriptions and returns, per
incident: a category, `is_psychosocial`, a psychosocial subtype, a severity
assessment, a confidence, an `evidence_quote`, and a rationale. Batched, with a
forced JSON schema so a malformed response is impossible rather than merely
unlikely.

**The grounding gate is the part that matters.** A post-processor rejects any
finding whose `evidence_quote` is not a *verbatim substring* of that incident's
description, and any finding for an incident ID not in the register. No case
folding, no punctuation normalisation — allowing those would mean "verbatim"
quietly meant "close enough". Rejected findings are logged into the cache artefact,
not silently dropped, and the gate runs **again** at load time against the freshly
loaded descriptions, because a cache is a file in a repository: it can be
hand-edited, and a finding that was grounded when generated is not necessarily
grounded now.

`severity_mismatch` is **computed**, never asked of the model. It is a comparison of
two numbers; asking a model to report the consequence of its own answer invites an
incoherent pair — an assessment of 3 against a recorded 1, with mismatch reported
false.

`packages/etl/src/ai/grounding.test.ts` is written adversarially: fabricated quotes,
quotes correct except for punctuation, quotes correct except for case, and quotes
lifted from a *different* incident in the same batch — the realistic failure when
eight records share one context window. All are rejected.

> **Status:** the classifier and its gate are implemented and tested, and the
> provider layer runs against either Anthropic or OpenAI. Classification has not yet
> been executed against a live key, so `data/ai/incident_findings.json` is not
> populated and this section makes no claims about what the model actually found.
> The application runs fully without it; the safety panel shows AI columns as empty
> rather than fabricating them. This is the one piece of the build that is described
> rather than demonstrated, and it is called out here rather than glossed.

---

## 5. What I would build next

**Rate-limit and cap the AI spend.** Analysed in `AI_COST_CONTROLS.md` and not yet
implemented. The real exposure is that `loadIncidents()` selects every incident with
no tenant filter and no `LIMIT`, while uploads accept 5MB CSVs — one upload turns a
$0.20 command into a ~2,500-request run. A spend ceiling in the batch loop, a bounded
and scoped query, and a vendor-side budget cap. The missing tenant scope is a
correctness bug independently of cost, so it goes first.

**A natural-language query interface over the database.** The LLM emits SQL against a
read-only role restricted to the analytical views, and the generated SQL is shown to
the user before it runs. The showing is the point: it makes the query auditable, and
it keeps the model on the side of the system that proposes rather than the side that
asserts.

**Scope 3 from supplier spend.** `suppliers.csv` carries category and annual spend,
which is enough for a spend-based Scope 3 estimate — and, more usefully, for showing
how wide the uncertainty band on such an estimate really is. Consolidating the two
duplicate pairs moves Ironline from $8.94M to $10.15M, which is the difference
between their largest supplier and their second largest. That correction has to
happen before any Scope 3 figure means anything.

**The AI-drafted compliance summary with citations** (designed, not built): a
narrative period summary where every claim carries an inline citation to a record ID
or an aggregate query, passed through the same grounding gate — uncitable claims are
stripped before rendering rather than softened.

**Alerting on the ratio, not the total.** The March 2026 finding generalises: the
Scope 1 share is stable for seventeen months and then moves 30 points. That is a
monitorable signal, and it fires on the month a dashboard reporting totals would
have called an improvement.

---

## What I chose to test, and why

The brief asks which parts I chose to test rather than for coverage. **228 tests**,
selected by one question: *would this failure produce a wrong compliance number that
nobody notices?*

| Suite | n | Defends against |
|---|---:|---|
| Normalisers | 121 | A misparsed date moving fuel into the wrong month; an unconverted kL row understating Scope 1; a credit note read as positive. Includes the property the audit trail rests on — `litres / conversionFactor` recovers the source cell. |
| Data-quality engine | 47 | The whole cleaning layer, as a golden run against the real `data/raw/`. Asserts 22 rules, 99 findings and every headline result. Plus fixtures for the three rules this export never triggers, so "silent" stays distinguishable from "broken". |
| AI grounding | 19 | A hallucinated finding reaching the UI. Written adversarially. |
| Emissions | 16 | The SQL arithmetic, computed longhand in the test. Covers the credit netting off, the MTR-07 correction reaching Scope 2, November staying zero, and March rising in Scope 1 while Scope 2 collapses. |
| API | 25 | Contract and tenancy. A second empty tenant checks isolation — the failure that does not error: a missing `company_id` reports one client's fuel to another and looks entirely fine. |

What is deliberately **not** tested: Vue component rendering, and the model's
judgement. The first is better served by looking at it; the second is not a
property a unit test can assert, which is exactly why the grounding gate exists —
it converts an untestable question ("is this classification good?") into a testable
one ("does this quote appear in the source record?").

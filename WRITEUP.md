# Ironbark Ridge, write-up

Emissions, safety and data quality intelligence over 18 months of operational data
from a fictional Queensland open-cut mine.

The idea the whole build is organised around: **every number on screen can be traced
back to the raw cell it came from.** Every correction keeps the original value beside
it and records why it was made. Every AI finding carries a quote that must appear
word for word in its source record. Every sentence in the AI written summary carries
citations to figures the database computed. That one constraint drove the schema, the
pipeline, the API, the tests and the UI.

**I own this end to end.** I wrote the build plan, designed the schema, made every
cleaning decision, built the pipeline, the API, the AI layer and the front end, chose
what to test and why, set up CI, and deployed it. I used Claude Code to write code to
my plan, and I reviewed all of it. There is no part of this repository I cannot
explain or change on the spot, and section 4 is an honest account of what the tool got
wrong and how I caught it.

---

## 1. How to run it

**It is already running: https://ironbark-ridge.vercel.app**

Sign in as **`demo@ironbarkridge.com.au` / `demo1234`**. That is the whole demo, with the
real export loaded and both AI layers live.

To run it yourself you need **Node 22 or later** and **Docker**.

```bash
cp .env.example .env
npm install
npm run db:up          # Postgres 16, waits until healthy
npm run db:migrate     # 9 SQL migrations, checksum verified
npm run etl            # clean and load data/raw/
npm run api            # http://localhost:4000  (OpenAPI at /api/docs)
npm run web            # http://localhost:5173
```

Sign in as **`demo@ironbarkridge.com.au` / `demo1234`**. The demo workspace is seeded
by migration `0007_tenancy.sql`, and `npm run etl` loads the export into it. You can
also register a new company and upload the five CSVs through the UI. Uploads run the
identical pipeline, so a cleaning rule cannot apply on the command line and quietly
not apply on upload.

Postgres binds to host port **5433** rather than 5432, so it will not collide with a
local install. `npm run db:down` stops it. `npm run db:reset` also destroys the
volume.

**No API key is needed.** Both AI outputs are committed to the repository: the
incident classifications in `data/ai/incident_findings.json` and the cited compliance
summary in `data/ai/compliance_summary.json`. The whole application runs without
buying inference. A key is only needed to re-run `npm run ai:classify` or
`npm run ai:report`.

```bash
npm test               # 265 tests; the database suites skip if Postgres is down
npm run typecheck
npm run writeup        # regenerate the tables in section 2 from the rule engine
```

CI runs the same sequence on every push against a real Postgres service container,
including the pipeline over the actual export, so a parser that breaks on real input
fails there rather than in a demo. Every push to `main` also rebuilds and redeploys the
hosted app.

### How it is deployed

The static Vue build is served directly and the whole API runs as one function under
`/api/*`, with Neon Postgres behind it and the function pinned to the same region as the
database. The API is bundled at build time, because the platform compiles the function's own
TypeScript but ships workspace packages as raw `.ts`, which Node cannot import at runtime.

**No AI key is set on the server.** Both AI outputs are committed and served from the
repository, so the hosted demo cannot spend money. Generating a new summary is the one paid
path, it is owner-only, and it answers with a clear 503 when no key is configured.

### Layout

```
data/raw/          the client export, never modified
packages/shared/   domain types used by every layer
packages/db/       pool, migrations, emissions views
packages/etl/      parse, clean, load, classify
packages/api/      Fastify read API, upload, compliance summary
packages/web/      Vue 3 dashboard
```

The emissions arithmetic lives in **SQL views**, not in application code, so the
numbers on screen and the numbers in a `psql` session cannot drift apart. That is
also why `packages/db/src/emissions.test.ts` computes a month longhand. A test that
asks the database to confirm its own arithmetic would pass whatever the views say.

---

## 2. The data problems, and what I did about each

Every finding is a row in `data_quality_issues`, keyed to the source file and the
physical line number, with an explicit action: **fixed**, **flagged** or
**rejected**. Nothing is dropped silently. The API serves the whole catalogue with
its reasoning at `/api/data-quality/rules`.

The table below is **generated** from the rule engine by `npm run writeup`, run
against `data/raw/`. It is not maintained by hand, because prose does not fail a
build and a hand typed table starts lying the first time a rule changes.

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
| `FUEL-CREDIT-01` | Negative quantity, appears to be a credit note | 1 | **flagged** | INV-41777 records -12,500 L against -$23,375.00, and its invoice number sits outside the 40xxx block used by every other row. |
| `FUEL-DATE-PRECISION-01` | Delivery date states month only | 29 | **flagged** | Dates like `Oct-25` have no day. The row is anchored to the first of the month and marked date_precision=month. |
| `FUEL-DUP-01` | Duplicate invoice number | 7 | **rejected** | Seven invoice numbers appear twice, each time as an exact repeat of every other field. Two identical deliveries on the same invoice is not a thing that happens, so the second copy is a re-export artefact. |
| `FUEL-FORMAT-01` | Mixed date and currency formats within a column | 1 | **fixed** | One column carries three date formats (ISO, day-first slash, month-year) and costs appear both as "$182,946.64" and as 132182.58. |
| `FUEL-HEADER-01` | Column headers carry stray whitespace | 1 | **fixed** | Headers are written as `Invoice No`, ` Delivery Date`, `Fuel Type `, ` Unit`. Trimmed on read. |
| `FUEL-MONTH-GAP-01` | No fuel deliveries recorded for a month inside the reporting period | 1 | **flagged** | November 2025 contains no fuel invoices at all, between an October with 8 and a December with 7. The site was plainly operating, since the meters record a full month of electricity, so this is missing paperwork, not a shutdown. |
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

**The kilolitre rows are converted. The credit note is not corrected.** Eleven fuel
rows record kilolitres in a column whose other 139 rows are litres. Converting them
is unambiguous, and the cost column confirms it independently: after conversion they
imply $1.73 to $1.93 per litre, inside the range set by every other delivery, where
before they implied roughly $1,800 per litre. That cross check compares two
separately recorded columns, so it catches a unit error even when the quantity and
the cost each look reasonable on their own. Left uncorrected it understates Scope 1
by about 750,000 litres, an error in the direction nobody questions.

The negative row, INV-41777, is a different case. It records minus 12,500 litres
against minus $23,375.00, with an invoice number outside the 40xxx block every other
row uses. That reads as a credit note, so it is loaded with `is_credit_note` set and
nets off the totals. Deleting it would overstate consumption. Flipping the sign would
double count it. It stays flagged for the client to confirm, because we are inferring
intent from a sign.

**The March 2026 electricity collapse is flagged and deliberately not corrected.**
Every meter drops to about a third of normal in the same month. That has the shape of
a unit error, and a pipeline that smoothed it would erase the single most important
event in the reporting period. Section 3 is what it actually was.

**The systematic ABN failure is reported once, not thirteen times.** All twelve well
formed ABNs fail the ATO modulus 89 checksum. When a rule fails for 100% of the rows
it applies to, the honest conclusion is that the source is systematically different
from what the rule assumes, most likely synthetic or masked values, not that the
client has twelve separate problems. So the pipeline keeps two ideas apart: whether
an ABN is well formed, and whether its checksum passes. The structural defect
(TerraForm's 7 digit value, two blanks) is reported per row. The checksum result is
reported once at file level, where it cannot bury the finding the client can actually
act on.

### Two problems the pipeline found that I had not predicted

**November 2025 contains no fuel invoices at all.** October has 8 and December has 7,
and the meters record a completely normal month of electricity, so the site was
plainly operating. This is missing paperwork, not a shutdown, and Scope 1 is
understated for that month by roughly a month of diesel. A gap like this is invisible
unless something goes looking for the absence of rows, which is why it is a rule
rather than an observation. It is flagged and never interpolated: estimating the
missing volume would put an invented number into a compliance report.

**The anomaly threshold I planned would have missed the March fuel spike.** I had
intended a fixed multiple of the median, 1.6 times. March 2026 is only 1.49 times the
median, so it would have passed silently. The engine uses a modified z-score against
the median absolute deviation instead, which puts that month **6.1 deviations** clear
of a series that otherwise stays between 0.85 and 1.14 times the median. A fixed
threshold has to be tuned against the answer you already expect. This one does not.

---

## 3. The insight nobody asked for: March 2026 is not a good month

Read the emissions chart on its own and March 2026 looks like the best month in the
period. Total CO2e falls 11.5% against February. On any dashboard that reports a
single headline number, that is a win.

It is the opposite of a win, and no single dataset can tell you so.

| | Feb 2026 | Mar 2026 | change |
|---|---:|---:|---:|
| Scope 1 (diesel, petrol) | 1,311,810 kg | 1,893,860 kg | **+44.4%** |
| Scope 2 (grid electricity) | 1,402,583 kg | 507,101 kg | **minus 63.8%** |
| **Total** | 2,714,393 kg | 2,400,961 kg | minus 11.5% |
| Scope 1 share | 48.3% | **78.9%** | plus 30.6 points |

The three files, read together, give the whole causal chain:

1. **The incident register names the cause.** `INC-2026-131`, 6 March, severity 3:
   *"Regional substation failure caused loss of grid supply to site. Backup diesel
   generators run continuously for approximately three weeks."*
2. **The meters show the effect.** Site wide consumption falls to 714,227 kWh from a
   median of about 2.0 million, which is 36% of normal, across **all six meters at
   once**. A simultaneous fall on every meter is a supply event, not a metering
   fault.
3. **The fuel invoices show the substitution.** 702,017 litres in March against a pre
   March monthly average of 454,156 litres, which is **55% more diesel**, in the
   month the grid went down.
4. **The safety register shows the human cost.** `INC-2026-134`, 24 March:
   *"Multiple crews reporting fatigue after extended shifts covering generator
   operations and manual restarts."* It is coded `OTH`, which is where psychosocial
   hazards go to be invisible.

So the reported improvement is three weeks of disrupted operations. Had the grid held
and consumption stayed at February's level, March would have been roughly **2.71
million kg** rather than 2.40 million. The site did not decarbonise. It partly
stopped, and ran the part that kept going on a dirtier fuel.

**Why this matters beyond one month.** The Scope 1 share sits near 47% for seventeen
months and then jumps to 79%. That ratio is a better signal of operational health
than the total, because it does not care how much you produced and does care how you
powered it. So the dashboard plots the share as a series of its own next to the
totals, and annotates March with the incident that explains it.

This is also the argument for putting all four files in one schema. Each dataset on
its own supports a confident and wrong conclusion: emissions improved, consumption
dropped, fuel spiked, a crew got tired. Only together do they say that a substation
failed and the compliance number moved in the flattering direction for a bad reason.

**None of it is hard coded.** `GET /api/analysis/outage` finds the month itself, as
the largest downward outlier in site wide grid consumption, using the same robust
test as the pipeline's anomaly rules. The dashboard therefore cannot narrate an event
that the data quality report did not flag. From there it locates the root cause, the
most severe electrical incident inside that month, and the consequences, meaning
anything the AI layer read as a psychosocial hazard in a window that extends past the
month, because a three week outage has effects that land later. Each meter is checked
against **its own** history rather than a site average, since the meters differ by an
order of magnitude and a site wide percentage would hide a small meter inside a large
one's noise. All six are below their own norms, by 63% to 67%.

That distinction matters more than it sounds. A panel with `'2026-03'` and two
incident IDs written into it proves only that someone read the data once. This one
would find the same shape in next year's export, and shows nothing at all for a
company that has no such month.

The counterfactual returns its own `assumption` field rather than burying it in
prose. It compares against a median month, it is not a forecast, and if output was
down that month for an unrelated reason it overstates the gap. The UI renders that
caveat next to the number, because an estimate presented as a measurement is exactly
the failure this project is organised against.

---

## 4. How I used AI tools building this, and what they got wrong

I built this with **Claude Code**, with a fixed division of labour.

**I wrote the plan first**: the steps in order, the schema, the rule table with an
intended action against each known defect, the shape of every layer, and what each
commit should contain. **Claude then wrote code to that plan and that format.** **I
reviewed everything that came back**, against the data or a running system rather
than against how plausible it read. Nearly everything it got wrong was plausible.

That order matters more than the tool does. The decisions this project is judged on,
such as what a rule is entitled to correct, what counts as evidence, and which
numbers a model is allowed to state, were made in the plan before any code existed.
The model was fast at the mechanical half and was never in charge of the judgement.

**What worked.** Generating the rule catalogue and the loaders from the spec, where
the spec named the defect and the intended action. Writing tests once the behaviour
was pinned down. Restructuring the AI classifier behind a provider seam so it runs
against either Anthropic or OpenAI.

**What it got wrong, and how I caught it.** These are all from this build, not
hypotheticals.

- **It invented plausible API response shapes.** Writing the integration tests, it
  assumed endpoints returned bare arrays. Eight tests failed on the first run:
  `/api/emissions/monthly` returns `{months: [...]}` with months as `YYYY-MM`, and
  `/api/incidents/:id` returns `{incident, dataQualityIssues, aiFindings}`. Caught by
  running the tests. Every one of those assertions looked reasonable and was wrong,
  which is the argument for integration tests over mocks.

- **It asserted a number that disagreed with the pipeline, and the pipeline was
  right.** A test claimed 29 fuel rows load at month precision, because 29 findings
  are raised. Only 26 load, because three of those rows are also exact duplicates and
  are rejected afterwards. Findings count what was seen in the file; the table counts
  what survived. The test now asserts that relationship rather than either number, so
  a change to deduplication or precision handling has to be deliberate.

- **A test suite silently skipped instead of running.** The database suites chose
  `it` or `it.skip` from a flag set in `beforeAll`, but `describe` bodies run at
  collection time, so the flag was always false. Both suites skipped against a
  perfectly good database while reporting green. Caught by reading the run output
  rather than the exit code. They now detect the database at module scope, and CI
  sets `REQUIRE_DB=1` so a skip becomes a failure and the local convenience cannot
  become permanent.

- **It reasoned from a library default the codebase had already overridden.** It
  assumed `pg` returns `NUMERIC` as a string. `packages/db/src/pool.ts` overrides
  exactly that, deliberately, with a comment explaining why. The test failed on
  `'2.7000'` against `2.7`.

- **A refactor moved a check in front of the thing that made it work.** Adding the
  provider abstraction, it hoisted the API key check to the top of the classifier so
  that a missing key fails in the first second rather than after loading the
  register. Sound reasoning, and it broke the command. The `.env` file was only ever
  loaded as a side effect of the first database connection, which now happened after
  the check, so a correctly configured key read as absent. `loadEnv()` is now called
  explicitly. Nothing type checked differently and no test covered it. It surfaced
  the first time the command was actually run.

- **It proposed emission factors from memory when asked to fill a gap.** The brief
  says to use the supplied file as is. Recalled NGER style factors are exactly the
  kind of confident, unsourced number this project exists to prevent. I rejected
  them. The factors are loaded from `emission_factors.csv`, and the test restates
  them from the file rather than from the table it is checking.

**The pattern.** The failures were never syntax and never obviously wrong. They were
confident claims about things it had not looked at: a response shape, a library
default, a number that ought to follow. The fix was structural rather than a matter
of paying closer attention. Run it against real data, assert relationships rather
than magic numbers, and read the output rather than the exit status. That is also the
reasoning behind the grounding gate in the AI layer, which is the same failure mode
one level down.

**A bug the tests found that review had not.** `?from=2026-13` returned a 500. The
month pattern counted digits (`^\d{4}-\d{2}$`) rather than checking the range, so
month 13 passed validation and then failed casting in Postgres. Fixed in
`packages/api/src/schemas/common.schema.ts`. The OpenAPI document is generated from
the same object, so it now documents the real constraint too.

### The AI layer, and why it is built the way it is

Classification runs over the free text incident descriptions and returns, for each
incident: a category, whether it is a psychosocial hazard, a psychosocial subtype, a
severity assessment, a confidence, an evidence quote and a rationale. It is batched,
with a forced JSON schema, so a malformed response is impossible rather than merely
unlikely.

**The grounding gate is the part that matters.** A post processor rejects any finding
whose evidence quote is not a word for word substring of that incident's description,
and any finding for an incident ID that is not in the register. No case folding, no
punctuation normalising, because allowing those would mean "word for word" quietly
meant "close enough". Rejected findings are written into the cached artefact rather
than silently dropped, and the gate runs **again** at load time against the freshly
loaded descriptions. A cache is a file in a repository: it can be hand edited, and a
finding that was grounded when it was generated is not necessarily grounded now.

The severity mismatch flag is **computed**, never asked of the model. It is a
comparison of two numbers, and asking a model to report the consequence of its own
answer invites an incoherent pair, such as an assessment of 3 against a recorded 1
with mismatch reported as false.

`packages/etl/src/ai/grounding.test.ts` is written adversarially: fabricated quotes,
quotes correct except for punctuation, quotes correct except for case, and quotes
lifted from a different incident in the same batch, which is the realistic failure
when eight records share one context window. All are rejected.

### What it actually found

Run against **`gpt-5.5`**: 42 incidents in 6 batches, 7,940 input and 6,379 output
tokens. The output is committed at `data/ai/incident_findings.json`.

**Four psychosocial hazards, every one of them coded `OTH` in the register.** This is
the finding the layer exists for. The register has no psychosocial category, so these
were filed in the same bucket as everything else that did not fit.

| Incident | Recorded | Assessed | Subtype | Evidence quote |
|---|---:|---:|---|---|
| `INC-2025-127` | 1 | **3** | Bullying or harassment | *"repeated verbal abuse from supervisor over several weeks, feeling anxious before shift."* |
| `INC-2026-109` | 1 | **3** | Role conflict or lack of clarity | *"exclusion from toolbox talks and rostering decisions after raising a safety concern, describes ongoing stress and poor sleep."* |
| `INC-2025-152` | 2 | 2 | Excessive workload or fatigue | *"feeling overwhelmed by sustained overtime and understaffing on night shift"* |
| `INC-2026-134` | 2 | 2 | Excessive workload or fatigue | *"Multiple crews reporting fatigue after extended shifts"* |

The first two are recorded at the lowest severity on the scale while describing a
sustained pattern of psychological harm. `INC-2026-134` is the human tail of the
March outage from section 3.

**It caught the two severity contradictions I most wanted it to catch, at the highest
confidence it gave anything:**

- `INC-2025-118`: *"Worker fell from ladder in workshop, fractured forearm,
  transported to Mater Hospital for surgery."* Recorded severity **1**, assessed
  **3**, confidence 0.99. It also recategorised the incident from `SLP` to **Fall
  from height**, because `SLP` files a ladder fall alongside tripping on a walkway.
- `INC-2025-141`: *"two fingers lacerated requiring sutures, LTI recorded."* Recorded
  severity **1**, assessed **3**, confidence 0.98. A lost time injury is by
  definition lost time.

### Being honest about the rest of it

**The grounding gate rejected nothing on this run.** Forty two findings, forty two
quotes correct word for word. I am reporting that as the result rather than implying
the gate saved us from something. It does not make the gate ornamental: it is what
makes the output checkable, and the adversarial suite proves it rejects fabricated,
re-punctuated, case shifted and cross contaminated quotes. A guard that fires zero
times against a good run is working.

**It reported 14 severity mismatches, and only about 6 are worth acting on.** The
signal is the jumps from 1 to 3 above, all at confidence 0.94 or higher. The rest is
drift of one level at confidence 0.78 to 0.86: a dust exceedance moved from 1 to 2, a
grazed elbow moved from 2 to 1. Those are judgement calls on a three point scale, and
treating them as findings would bury the six that matter. The UI badges mismatches
but sorts by confidence for exactly this reason, and a next version should either
report a band or only surface disagreements of more than one level.

**On one record I think the model is wrong.** `INC-2026-131` is the substation
failure, three weeks of the site on backup generation. It is recorded at severity 3
and the model assessed 2, at confidence 0.82. It judged the immediate harm, which is
what the prompt asks for, while the register appears to be judging operational
consequence. That is a genuine ambiguity in the severity definition rather than a
model error, and it is the kind of thing to resolve with the client rather than in a
prompt.

**And it cannot settle the question the scale raises.** Both `INC-2025-118` and
`INC-2025-141` sit at severity 1 while describing surgery and a lost time injury.
Either those two records are miscoded, or the numeric scale runs the other way, with
1 as most severe, as many mining registers do, in which case every numeric row is
inverted. The model reading the descriptions is evidence for the first reading, since
the rest of the numeric rows line up sensibly under Low equals 1. It is not proof, so
`INC-SEV-SCALE-01` stays flagged as a question for the client rather than resolved in
code.

### The cited compliance summary

The second AI feature is a period summary an auditor could read, served at
`GET /api/reports/summary` and shown under **Summary** in the app.

Classification had a natural anchor: the source description, which a quote has to
appear in word for word. A narrative has no text to quote, so the anchor had to be
manufactured. The order is inverted instead:

1. The API assembles a **fact pack** first: about 90 pre-computed figures and source
   records, each with an id, built from the same repositories the dashboard reads, so
   the prose cannot disagree with the chart beside it.
2. The model is given that closed set and told to select, order and explain. It is
   told not to calculate: no sums, no ratios, no unit conversions. Both kilograms and
   tonnes are in the pack so it never needs to convert one into the other.
3. The output is a list of **claims** rather than paragraphs. A claim is the unit a
   citation attaches to and the unit the gate can discard on its own, so one bad
   sentence costs one sentence rather than the whole report.
4. The **citation gate** in `packages/etl/src/ai/report/citations.ts` then asks four
   questions of every claim. Does it cite anything? Does every citation name a fact
   that exists? Does it name a record without citing it? And **is every number it
   states present in one of the facts it cited?**

The fourth question is the one that earns its keep. A model that cites correctly and
then misstates the figure produces the most dangerous output this project can emit: a
wrong number wearing a citation, which reads as more trustworthy than an uncited one.
Rounding is allowed to exactly the precision written, so 47 may stand for 47.3. A
change of magnitude is not, so 1.2 may not stand for 1,234,567.

There are two more layers, matching the incident findings. A database trigger refuses
to store a claim that cites a fact absent from the pack saved with it, and **every
claim is re-verified on read** against the facts as they are now. A stored summary
therefore cannot outlive the numbers it describes: reload the data and the claims
that no longer hold are dropped on the way out, with the response saying how many.
The committed artefact is only offered to a dataset whose facts reproduce the
fingerprint it was written against, so a company that uploads its own export gets no
summary rather than somebody else's narrative over its numbers.

**What the gate is not.** It certifies that every figure and every record reference
is traceable. It cannot certify that the interpretation is sound: "Scope 1 rose
51.6%" and "Scope 1 rose 51.6%, which is excellent news" both pass. Mechanical
traceability is what a machine can check. Judgement stays with the reader, which is
why every claim is rendered with its citations visible rather than footnoted away.

**On the run: 21 claims, one rejected.** The rejection was an unsupported number in a
counterfactual sentence, and the corrective round reissued it citing the fact it
needed. The summary opened by refusing to state the headline total without its
caveat, that it rests on 20 corrected activity records and a month with no fuel
invoices, which is the behaviour the prompt asks for and the one a compliance reader
needs.

**And it caught a bug in my own fact pack.** Its watch list reported that diesel and
petrol both showed 0 litres beside 143 loaded invoices and 22,052 tonnes of Scope 1,
and said so as an unresolved contradiction rather than smoothing over it. It was
right. My query filtered on `fuel_type = 'diesel'`, but the source spells the fuel
`Diesel` and `Petrol (ULP)`, and the normalised join key is `factor_key`, which is
what the emissions views use. The fact pack is now built from `factor_key`, with the
emission factor read from the table rather than repeated in a comment. That is the
argument for making a model state its uncertainties against a closed set of facts.
The contradiction was in my data, and the constraint is what surfaced it.

---

## 5. What I would build next

**Rate limit and cap the AI spend.** Analysed in `AI_COST_CONTROLS.md` and not yet
implemented. The real exposure is that the classifier selects every incident with no
workspace filter and no `LIMIT`, while uploads accept 5MB CSVs, so one upload could
turn a $0.20 command into a run of roughly 2,500 requests. The fix is a spend ceiling
in the batch loop, a bounded and scoped query, and a vendor side budget cap. The
missing workspace scope is a correctness bug independently of cost, so it goes first.

**A natural language query interface over the database.** The model emits SQL against
a read only role restricted to the analytical views, and the generated SQL is shown
to the user before it runs. The showing is the point: it makes the query auditable,
and it keeps the model on the side of the system that proposes rather than the side
that asserts.

**Scope 3 from supplier spend.** `suppliers.csv` carries category and annual spend,
which is enough for a spend based Scope 3 estimate and, more usefully, for showing
how wide the uncertainty band on such an estimate really is. Consolidating the two
duplicate pairs moves Ironline from $8.94M to $10.15M, which is the difference
between their largest supplier and their second largest. That correction has to
happen before any Scope 3 figure means anything.

**Regenerate the summary when the data moves.** The summary already detects that its
facts have changed and drops the claims that no longer hold, but somebody still has
to press a button. The next step is a job that regenerates on a load, plus a diff
between consecutive summaries. "This month's report says three things last month's
did not" is the view a sustainability lead would actually open.

**Alert on the ratio, not the total.** The March 2026 finding generalises. The Scope
1 share is stable for seventeen months and then moves 30 points. That is a signal
worth monitoring, and it fires in the month a dashboard reporting totals would have
called an improvement.

---

## What I chose to test, and why

The brief asks which parts I chose to test rather than for a coverage number. There
are **265 tests**, selected by one question: would this failure produce a wrong
compliance number that nobody notices?

| Suite | n | Defends against |
|---|---:|---|
| Normalisers | 121 | A misparsed date moving fuel into the wrong month, an unconverted kilolitre row understating Scope 1, a credit note read as positive. Includes the property the audit trail rests on: dividing the loaded litres by the conversion factor recovers the source cell. |
| Data quality engine | 47 | The whole cleaning layer, as a golden run against the real `data/raw/`. Asserts 22 rules, 99 findings and every headline result. Plus fixtures for the three rules this export never triggers, so "silent" stays distinguishable from "broken". |
| AI grounding | 19 | A hallucinated finding reaching the UI. Written adversarially. |
| Citation gate | 20 | A generated sentence stating a figure the facts do not contain, including the dangerous case of a correct citation attached to a wrong number. Covers the roundings a correct writer may make and the magnitude shifts they may not. |
| Emissions | 16 | The SQL arithmetic, computed longhand in the test. Covers the credit note netting off, the MTR-07 correction reaching Scope 2, November staying at zero, and March rising in Scope 1 while Scope 2 collapses. |
| API | 42 | Contract and tenancy. A second empty workspace checks isolation, which is the failure that does not error: a missing `company_id` reports one client's fuel to another and looks entirely fine. Ten of these cover the correlation endpoint and assert that the month, the meters and both incidents are detected rather than named. |

What is deliberately **not** tested: Vue component rendering, and the model's
judgement. The first is better served by looking at it. The second is not a property
a unit test can assert, which is exactly why the grounding and citation gates exist.
They convert an untestable question, "is this classification good?", into a testable
one, "does this quote appear in the source record?".

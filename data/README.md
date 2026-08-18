# Data

## `raw/`

The client export exactly as received. **These files are never edited.**

Every correction the pipeline makes is applied in transit and recorded as a row in
`data_quality_issues` with the original value attached, so any figure in the app can be
traced back to the cell it came from. Editing the raw files would break that chain.

## `ai/`

Cached output from the AI classification step, committed to the repo so the application
runs end to end without an `ANTHROPIC_API_KEY`. Regenerate with `npm run ai:classify`.

Created in step 7 — see `PLAN.md`.

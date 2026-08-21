# Data

## `raw/`

The client export exactly as received. **These files are never edited.**

Every correction the pipeline makes is applied in transit and recorded as a row in
`data_quality_issues` with the original value attached, so any figure in the app can be
traced back to the cell it came from. Editing the raw files would break that chain.

## `ai/`

Cached output from the AI layer, committed to the repo so the application runs end to end
without an API key.

| File | What it is | Regenerate with |
|---|---|---|
| `incident_findings.json` | Every incident classified, with the verbatim quote each finding rests on | `npm run ai:classify` |
| `compliance_summary.json` | The cited period summary, with the fact pack it was written from | `npm run ai:report` |

Both artefacts record the model and prompt version that produced them, and both are
re-verified when they are loaded rather than trusted because they are committed.

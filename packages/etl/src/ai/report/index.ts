/**
 * The compliance-summary layer, as the API consumes it.
 *
 * The API owns the facts — they are SQL over one tenant's data — and this
 * package owns everything that decides whether a generated sentence is allowed
 * to be shown. Keeping the gate on this side of the boundary is the same
 * decision as the provider seam: the guarantee must not be something a caller
 * can forget to apply.
 */
export {
  factDigest,
  indexFacts,
  renderFacts,
  renderValue,
  type ReportFact,
} from './facts.js';

export {
  verifyClaims,
  type ClaimRejection,
  type RejectionReason,
  type VerificationResult,
  type VerifiedClaim,
} from './citations.js';

export {
  generateReport,
  groupBySection,
  type GeneratedReport,
  type ReportPeriod,
  type ReportRejection,
  type ReportSectionOutput,
} from './generate.js';

export {
  readReportCache,
  writeReportCache,
  REPORT_CACHE_PATH,
  type ReportCache,
} from './cache.js';

export { REPORT_PROMPT_VERSION } from './prompt.js';
export { REPORT_SECTIONS, type Claim, type ReportSection } from './schema.js';

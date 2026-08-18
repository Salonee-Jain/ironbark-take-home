export { err, ok, type Result } from './result.js';
export {
  normaliseDate,
  toMonthStart,
  type DateFormat,
  type NormalisedDate,
} from './date.js';
export { parseAudAmount } from './currency.js';
export {
  impliedPricePerLitre,
  isPricePlausible,
  normaliseQuantity,
  PLAUSIBLE_PRICE_BAND_AUD_PER_LITRE,
  type NormalisedQuantity,
} from './quantity.js';
export {
  normaliseSeverity,
  type NormalisedSeverity,
  type SeverityScale,
} from './severity.js';
export { isAbnChecksumValid, normaliseAbn, type NormalisedAbn } from './abn.js';
export {
  canonicaliseEntityName,
  compareEntities,
  levenshtein,
  type DuplicateMatch,
} from './entityName.js';

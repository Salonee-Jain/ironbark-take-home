import type { DatePrecision } from '@ironbark/shared';
import { readCsv } from '../csv.js';
import type { IssueCollector } from '../issues.js';
import {
  impliedPricePerLitre,
  isPricePlausible,
  normaliseDate,
  normaliseQuantity,
  parseAudAmount,
  toMonthStart,
} from '../normalise/index.js';
import { KNOWN_SITE_AREAS } from '../reference.js';
import { isOutlier, median, modifiedZScore } from '../stats.js';
import { FACTOR_KEY_BY_FUEL_TYPE } from './emissionFactors.js';

export type FuelDeliveryRecord = {
  invoiceNo: string;
  deliveryDate: string;
  datePrecision: DatePrecision;
  fuelType: string;
  factorKey: string;
  quantityL: number;
  costAud: number | null;
  siteArea: string;
  isCreditNote: boolean;
  originalDate: string;
  originalQuantity: string;
  originalUnit: string;
  originalCost: string | null;
  sourceRowNumber: number;
};

/** Site areas whose fuel should be petrol for light vehicles, not bulk diesel. */
const LIGHT_VEHICLE_AREAS = new Set(['Light Vehicles']);

export function loadFuelDeliveries(
  path: string,
  issues: IssueCollector,
): FuelDeliveryRecord[] {
  const file = readCsv(path);

  if (file.hasUntrimmedHeaders) {
    issues.add({
      ruleId: 'FUEL-HEADER-01',
      description: `${file.rawHeaders.filter((h) => h !== h.trim()).length} of ${file.rawHeaders.length} column headers carry leading or trailing whitespace.`,
      field: 'header',
      originalValue: JSON.stringify(file.rawHeaders),
      resolvedValue: JSON.stringify(file.headers),
    });
  }

  const records: FuelDeliveryRecord[] = [];

  // Keyed by invoice number: value is the line that claimed it first, so a
  // duplicate can point at its survivor rather than just saying "duplicate".
  const seenInvoices = new Map<string, { lineNumber: number; signature: string }>();

  const dateFormats = new Map<string, number>();
  let currencyFormatted = 0;

  for (const row of file.rows) {
    const invoiceNo = row.value('Invoice No').trim();
    const rawDate = row.value('Delivery Date').trim();
    const rawFuelType = row.value('Fuel Type').trim();
    const rawQuantity = row.value('Quantity').trim();
    const rawUnit = row.value('Unit').trim();
    const rawCost = row.value('Cost (AUD)').trim();
    const siteArea = row.value('Site Area').trim();

    const context = { sourceRowNumber: row.lineNumber, recordKey: invoiceNo };

    // --- date ---------------------------------------------------------------
    const date = normaliseDate(rawDate);
    if (!date.ok) {
      issues.add({
        ...context,
        ruleId: 'FUEL-FORMAT-01',
        severity: 'error',
        action: 'rejected',
        field: 'Delivery Date',
        description: `Delivery date could not be parsed: ${date.error}. Row excluded — a delivery with no usable date cannot be assigned to a reporting month.`,
        originalValue: rawDate,
      });
      continue;
    }
    dateFormats.set(
      date.value.format,
      (dateFormats.get(date.value.format) ?? 0) + 1,
    );

    if (date.value.precision === 'month') {
      issues.add({
        ...context,
        ruleId: 'FUEL-DATE-PRECISION-01',
        field: 'Delivery Date',
        description: `Delivery date gives month only. Anchored to ${date.value.iso} and marked imprecise; monthly totals are unaffected, day-level analysis must exclude it.`,
        originalValue: rawDate,
      });
    }

    // --- quantity -----------------------------------------------------------
    const quantity = normaliseQuantity(rawQuantity, rawUnit);
    if (!quantity.ok) {
      issues.add({
        ...context,
        ruleId: 'FUEL-FORMAT-01',
        severity: 'error',
        action: 'rejected',
        field: 'Quantity',
        description: `Quantity could not be parsed: ${quantity.error}. Row excluded.`,
        originalValue: `${rawQuantity} ${rawUnit}`,
      });
      continue;
    }

    if (quantity.value.conversionFactor !== 1) {
      issues.add({
        ...context,
        ruleId: 'FUEL-UNIT-KL-01',
        field: 'Quantity',
        description: `Quantity recorded in ${quantity.value.sourceUnit} in a column that is otherwise litres. Converted x${quantity.value.conversionFactor}.`,
        originalValue: `${rawQuantity} ${rawUnit}`,
        resolvedValue: `${quantity.value.litres} L`,
      });
    }

    // --- cost ---------------------------------------------------------------
    let costAud: number | null = null;
    if (rawCost !== '') {
      const cost = parseAudAmount(rawCost);
      if (cost.ok) {
        costAud = cost.value;
        if (/[$,]/.test(rawCost)) currencyFormatted++;
      } else {
        issues.add({
          ...context,
          ruleId: 'FUEL-FORMAT-01',
          severity: 'warning',
          action: 'flagged',
          field: 'Cost (AUD)',
          description: `Cost could not be parsed: ${cost.error}. Loaded without a cost; emissions are unaffected, spend reconciliation is.`,
          originalValue: rawCost,
        });
      }
    }

    // --- credit note --------------------------------------------------------
    const isCreditNote = quantity.value.litres < 0;
    if (isCreditNote) {
      issues.add({
        ...context,
        ruleId: 'FUEL-CREDIT-01',
        field: 'Quantity',
        description:
          `Negative quantity of ${quantity.value.litres} L against ${rawCost || 'no cost'}. ` +
          'Treated as a credit note and loaded so it nets off the totals rather than being dropped. ' +
          'Confirm with the client whether this reverses an earlier delivery.',
        originalValue: `${rawQuantity} ${rawUnit}`,
      });
    }

    // --- price plausibility -------------------------------------------------
    if (costAud !== null) {
      const price = impliedPricePerLitre(costAud, quantity.value.litres);
      if (!isPricePlausible(price)) {
        issues.add({
          ...context,
          ruleId: 'FUEL-PRICE-01',
          field: 'Quantity',
          description:
            `Implied price of $${price?.toFixed(2)}/L is outside the plausible band. ` +
            'Either the quantity or the cost is wrong; the check cannot tell which, so neither is altered.',
          originalValue: `${rawQuantity} ${rawUnit} for ${rawCost}`,
        });
      }
    }

    // --- fuel type ----------------------------------------------------------
    const factorKey = FACTOR_KEY_BY_FUEL_TYPE[rawFuelType];
    if (!factorKey) {
      issues.add({
        ...context,
        ruleId: 'FUEL-FORMAT-01',
        severity: 'error',
        action: 'rejected',
        field: 'Fuel Type',
        description: `Fuel type "${rawFuelType}" has no emission factor. Row excluded rather than assigned a factor by guesswork.`,
        originalValue: rawFuelType,
      });
      continue;
    }

    // --- duplicate invoice --------------------------------------------------
    // Signature covers every field, so "same invoice, different numbers" can be
    // distinguished from "same row twice". They are different problems.
    const signature = [
      rawDate,
      rawFuelType,
      rawQuantity,
      rawUnit,
      rawCost,
      siteArea,
    ].join('|');
    const previous = seenInvoices.get(invoiceNo);

    if (previous) {
      const identical = previous.signature === signature;
      issues.add({
        ...context,
        ruleId: 'FUEL-DUP-01',
        field: 'Invoice No',
        description: identical
          ? `Exact duplicate of the delivery already loaded from line ${previous.lineNumber}. Rejected; the first occurrence is retained.`
          : `Invoice number reused on line ${previous.lineNumber} with different values. Rejected, but this is the more serious case: two different deliveries share one invoice number, and the client should establish which is correct.`,
        severity: 'error',
        action: 'rejected',
        originalValue: invoiceNo,
      });
      continue;
    }
    seenInvoices.set(invoiceNo, { lineNumber: row.lineNumber, signature });

    // --- site area consistency ---------------------------------------------
    if (!KNOWN_SITE_AREAS.has(siteArea)) {
      issues.add({
        ...context,
        ruleId: 'FUEL-SITE-UNKNOWN-01',
        field: 'Site Area',
        description: `Site area "${siteArea}" is not one of the ${KNOWN_SITE_AREAS.size} known areas. Loaded against a placeholder area marked unknown rather than dropped or silently added to the taxonomy.`,
        originalValue: siteArea,
      });
    }

    if (LIGHT_VEHICLE_AREAS.has(siteArea) && rawFuelType === 'Diesel') {
      issues.add({
        ...context,
        ruleId: 'FUEL-SITE-FLEET-01',
        field: 'Site Area',
        description: `${quantity.value.litres.toLocaleString()} L of diesel billed to ${siteArea}, which otherwise receives petrol in ~4,000 L loads. Likely a site-area coding error on the invoice.`,
        originalValue: siteArea,
      });
    }

    records.push({
      invoiceNo,
      deliveryDate: date.value.iso,
      datePrecision: date.value.precision,
      fuelType: rawFuelType,
      factorKey,
      quantityL: quantity.value.litres,
      costAud,
      siteArea,
      isCreditNote,
      originalDate: rawDate,
      originalQuantity: rawQuantity,
      originalUnit: rawUnit,
      originalCost: rawCost === '' ? null : rawCost,
      sourceRowNumber: row.lineNumber,
    });
  }

  // --- file-level formatting summary ----------------------------------------
  if (dateFormats.size > 1 || currencyFormatted > 0) {
    const formatSummary = [...dateFormats.entries()]
      .map(([format, count]) => `${format}: ${count}`)
      .join(', ');
    issues.add({
      ruleId: 'FUEL-FORMAT-01',
      description:
        `Date column carries ${dateFormats.size} formats (${formatSummary}); ` +
        `${currencyFormatted} of ${records.length} costs are written with currency symbols or thousands separators. ` +
        'All normalised on read.',
      originalValue: `${dateFormats.size} date formats, ${currencyFormatted} formatted costs`,
      resolvedValue: 'ISO dates, numeric costs',
    });
  }

  // --- monthly volume anomaly ----------------------------------------------
  // Runs on the deduplicated set, so a spike cannot be an artefact of the
  // duplicates we just rejected.
  const volumeByMonth = new Map<string, number>();
  for (const record of records) {
    const month = toMonthStart(record.deliveryDate);
    volumeByMonth.set(
      month,
      (volumeByMonth.get(month) ?? 0) + Math.max(record.quantityL, 0),
    );
  }

  const monthlyVolumes = [...volumeByMonth.values()];
  const medianVolume = median(monthlyVolumes);

  for (const [month, volume] of [...volumeByMonth].sort()) {
    if (volume > medianVolume && isOutlier(volume, monthlyVolumes)) {
      issues.add({
        ruleId: 'FUEL-VOLUME-SPIKE-01',
        recordKey: month,
        field: 'Quantity',
        description:
          `${month.slice(0, 7)} consumed ${Math.round(volume).toLocaleString()} L, ` +
          `${(volume / medianVolume).toFixed(2)}x the median month of ${Math.round(medianVolume).toLocaleString()} L ` +
          `(modified z-score ${modifiedZScore(volume, monthlyVolumes).toFixed(1)}). ` +
          'Not treated as an error. Cross-reference the electricity readings and the incident register for the same month.',
        originalValue: `${Math.round(volume)} L`,
      });
    }
  }

  // --- months with no deliveries at all -------------------------------------
  // A gap is invisible from the rows that are present: nothing in the file says
  // "November is missing". It only shows up as an absence, so it has to be
  // looked for deliberately, by walking the calendar rather than the data.
  const monthsPresent = [...volumeByMonth.keys()].sort();
  const firstMonth = monthsPresent[0];
  const lastMonth = monthsPresent.at(-1);

  if (firstMonth && lastMonth) {
    const missing: string[] = [];
    const cursor = new Date(`${firstMonth}T00:00:00Z`);
    const end = new Date(`${lastMonth}T00:00:00Z`);

    while (cursor < end) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      const month = cursor.toISOString().slice(0, 10);
      if (cursor < end && !volumeByMonth.has(month)) missing.push(month);
    }

    for (const month of missing) {
      issues.add({
        ruleId: 'FUEL-MONTH-GAP-01',
        recordKey: month.slice(0, 7),
        field: 'Delivery Date',
        description:
          `No fuel deliveries recorded for ${month.slice(0, 7)}, inside an otherwise continuous run from ` +
          `${firstMonth.slice(0, 7)} to ${lastMonth.slice(0, 7)}. The neighbouring months carry a full set of ` +
          'invoices and the meters record a normal month of electricity, so the site was operating. ' +
          'Scope 1 is understated for this month. Not interpolated — an estimated volume in a compliance report is an invented number.',
        originalValue: '0 deliveries',
      });
    }
  }

  return records;
}

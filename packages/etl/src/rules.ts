import type {
  DataQualityAction,
  DataQualitySeverity,
  SourceFile,
} from '@ironbark/shared';

/**
 * The data-quality rule catalogue.
 *
 * This is the single source of truth for *what* counts as a problem, *what we
 * did about it*, and — the part that matters for a compliance product — *why we
 * felt entitled to do that*. The ETL upserts this into `data_quality_rules` so
 * the API can serve a rationale next to every corrected number, without a user
 * having to read the repo.
 *
 * Reporting granularity is a deliberate choice per rule:
 *
 *   row-level   — anything that changes a number, or that a human needs to
 *                 look at record by record.
 *   file-level  — systematic formatting, and rules that fail for essentially
 *                 every row. Emitting those per row buries the rare, genuine
 *                 defects under hundreds of identical lines, which is how a
 *                 data-quality report becomes something nobody reads.
 */

export type RuleId =
  // fuel_deliveries.csv
  | 'FUEL-HEADER-01'
  | 'FUEL-FORMAT-01'
  | 'FUEL-DATE-PRECISION-01'
  | 'FUEL-UNIT-KL-01'
  | 'FUEL-DUP-01'
  | 'FUEL-CREDIT-01'
  | 'FUEL-PRICE-01'
  | 'FUEL-SITE-FLEET-01'
  | 'FUEL-SITE-UNKNOWN-01'
  | 'FUEL-VOLUME-SPIKE-01'
  | 'FUEL-MONTH-GAP-01'
  // electricity_meter_readings.csv
  | 'ELEC-UNIT-SCALE-01'
  | 'ELEC-METER-GAP-01'
  | 'ELEC-CONSUMPTION-DROP-01'
  // incident_register.csv
  | 'INC-DUP-ID-01'
  | 'INC-SEV-SCALE-01'
  | 'INC-SEV-MAPPED-01'
  | 'INC-ID-SEQUENCE-01'
  | 'INC-DESC-REUSED-01'
  | 'INC-LOCATION-01'
  | 'INC-TYPE-UNKNOWN-01'
  // suppliers.csv
  | 'SUP-DUP-01'
  | 'SUP-ABN-FORM-01'
  | 'SUP-ABN-CHECKSUM-01'
  | 'SUP-CATEGORY-01';

export type RuleDefinition = {
  ruleId: RuleId;
  title: string;
  sourceFile: SourceFile;
  category:
    | 'structure'
    | 'formatting'
    | 'duplication'
    | 'units'
    | 'completeness'
    | 'plausibility'
    | 'consistency'
    | 'anomaly';
  defaultSeverity: DataQualitySeverity;
  defaultAction: DataQualityAction;
  rationale: string;
};

function rule(definition: RuleDefinition): RuleDefinition {
  return definition;
}

export const RULES: Record<RuleId, RuleDefinition> = {
  // ---------------------------------------------------------------------------
  // fuel_deliveries.csv
  // ---------------------------------------------------------------------------
  'FUEL-HEADER-01': rule({
    ruleId: 'FUEL-HEADER-01',
    title: 'Column headers carry stray whitespace',
    sourceFile: 'fuel_deliveries.csv',
    category: 'structure',
    defaultSeverity: 'info',
    defaultAction: 'fixed',
    rationale:
      'Headers are written as `Invoice No`, ` Delivery Date`, `Fuel Type `, ` Unit`. Trimmed on read. ' +
      'Cosmetic, but recorded because it is a reliable sign the file was assembled by hand rather than exported, ' +
      'which is context for how much else to trust.',
  }),

  'FUEL-FORMAT-01': rule({
    ruleId: 'FUEL-FORMAT-01',
    title: 'Mixed date and currency formats within a column',
    sourceFile: 'fuel_deliveries.csv',
    category: 'formatting',
    defaultSeverity: 'info',
    defaultAction: 'fixed',
    rationale:
      'One column carries three date formats (ISO, day-first slash, month-year) and costs appear both as ' +
      '"$182,946.64" and as 132182.58. Normalised on read. Reported once for the file rather than on every ' +
      'row: it is systematic, and 150 identical findings would bury the rare ones.',
  }),

  'FUEL-DATE-PRECISION-01': rule({
    ruleId: 'FUEL-DATE-PRECISION-01',
    title: 'Delivery date states month only',
    sourceFile: 'fuel_deliveries.csv',
    category: 'completeness',
    defaultSeverity: 'warning',
    defaultAction: 'flagged',
    rationale:
      'Dates like `Oct-25` have no day. The row is anchored to the first of the month and marked ' +
      'date_precision=month. Monthly emissions stay correct; anything day-level must exclude these, and can now ' +
      'tell which they are. Inventing a plausible day would make an unknown look like a fact.',
  }),

  'FUEL-UNIT-KL-01': rule({
    ruleId: 'FUEL-UNIT-KL-01',
    title: 'Quantity recorded in kilolitres',
    sourceFile: 'fuel_deliveries.csv',
    category: 'units',
    defaultSeverity: 'error',
    defaultAction: 'fixed',
    rationale:
      'Eleven rows record kL against a column whose other 139 rows are litres. Converted x1000, with the original ' +
      'value and unit retained. Confirmed independently by cost: after conversion these rows imply $1.73-$1.93/L, ' +
      'inside the range set by every other delivery; before conversion they imply roughly $1,800/L. ' +
      'Left uncorrected this understates Scope 1 by about 750,000 litres — an error in the direction nobody questions.',
  }),

  'FUEL-DUP-01': rule({
    ruleId: 'FUEL-DUP-01',
    title: 'Duplicate invoice number',
    sourceFile: 'fuel_deliveries.csv',
    category: 'duplication',
    defaultSeverity: 'error',
    defaultAction: 'rejected',
    rationale:
      'Seven invoice numbers appear twice, each time as an exact repeat of every other field. Two identical ' +
      'deliveries on the same invoice is not a thing that happens, so the second copy is a re-export artefact. ' +
      'The first is kept, the copy is rejected and recorded here with a pointer to the survivor. Counting both ' +
      'would inflate Scope 1 by roughly half a million litres.',
  }),

  'FUEL-CREDIT-01': rule({
    ruleId: 'FUEL-CREDIT-01',
    title: 'Negative quantity — appears to be a credit note',
    sourceFile: 'fuel_deliveries.csv',
    category: 'plausibility',
    defaultSeverity: 'warning',
    defaultAction: 'flagged',
    rationale:
      'INV-41777 records -12,500 L against -$23,375.00, and its invoice number sits outside the 40xxx block used ' +
      'by every other row. That reads as a credit note — fuel invoiced then reversed — not as corruption. It is ' +
      'loaded with is_credit_note=true so it nets off the totals, because deleting it would overstate consumption ' +
      'while "correcting" the sign would double-count it. Flagged for the client to confirm.',
  }),

  'FUEL-PRICE-01': rule({
    ruleId: 'FUEL-PRICE-01',
    title: 'Implied price per litre outside the plausible band',
    sourceFile: 'fuel_deliveries.csv',
    category: 'plausibility',
    defaultSeverity: 'error',
    defaultAction: 'flagged',
    rationale:
      'Cross-checks two independently recorded columns against each other, so it catches a unit or magnitude error ' +
      'even when the quantity and the cost each look reasonable alone. Band $1.00-$3.00/L against an observed ' +
      'range of $1.72-$1.94. Flagged rather than fixed: the check can tell that one of the two numbers is wrong, ' +
      'but not which.',
  }),

  'FUEL-SITE-FLEET-01': rule({
    ruleId: 'FUEL-SITE-FLEET-01',
    title: 'Bulk diesel delivered to a light-vehicle fleet',
    sourceFile: 'fuel_deliveries.csv',
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultAction: 'flagged',
    rationale:
      'The Light Vehicles fleet otherwise takes petrol in consistent ~4,000 L loads. A few tens of thousands of ' +
      'litres of diesel against that site area is most likely a coding error at the invoice level. Flagged, not ' +
      'reassigned: we do not know which area it belongs to, and moving fuel between areas on a guess would ' +
      'produce a confident, wrong site breakdown.',
  }),

  'FUEL-SITE-UNKNOWN-01': rule({
    ruleId: 'FUEL-SITE-UNKNOWN-01',
    title: 'Site area not in the known taxonomy',
    sourceFile: 'fuel_deliveries.csv',
    category: 'structure',
    defaultSeverity: 'error',
    defaultAction: 'flagged',
    rationale:
      'Site areas are seeded as reference data, so a value outside that list is a detectable event rather than a ' +
      'silently widened taxonomy. The row still loads, against an area marked category=unknown.',
  }),

  'FUEL-VOLUME-SPIKE-01': rule({
    ruleId: 'FUEL-VOLUME-SPIKE-01',
    title: 'Monthly fuel volume far above the period norm',
    sourceFile: 'fuel_deliveries.csv',
    category: 'anomaly',
    defaultSeverity: 'info',
    defaultAction: 'flagged',
    rationale:
      'Outliers are found with a modified z-score against the median absolute deviation, not a hand-picked multiple ' +
      'of the median. A fixed multiple has to be tuned against the answer you already expect, and would have missed ' +
      'this dataset: the one anomalous month is 1.49x the median, under any round threshold you would have chosen in ' +
      'advance, while sitting about eight deviations clear of a series that otherwise holds between 0.85x and 1.14x. ' +
      'Not a defect — the pipeline noticing something real. Read with ELEC-CONSUMPTION-DROP-01 for the same month.',
  }),

  'FUEL-MONTH-GAP-01': rule({
    ruleId: 'FUEL-MONTH-GAP-01',
    title: 'No fuel deliveries recorded for a month inside the reporting period',
    sourceFile: 'fuel_deliveries.csv',
    category: 'completeness',
    defaultSeverity: 'error',
    defaultAction: 'flagged',
    rationale:
      'November 2025 contains no fuel invoices at all, between an October with 8 and a December with 7. The site was ' +
      'plainly operating — the meters record a full month of electricity — so this is missing paperwork, not a ' +
      'shutdown. Scope 1 is understated for that month by roughly a month of diesel, and nothing else in the file ' +
      'draws attention to it: a gap is invisible unless you go looking for the absence of rows. Flagged rather than ' +
      'interpolated. Estimating the missing volume would put an invented number into a compliance report.',
  }),

  // ---------------------------------------------------------------------------
  // electricity_meter_readings.csv
  // ---------------------------------------------------------------------------
  'ELEC-UNIT-SCALE-01': rule({
    ruleId: 'ELEC-UNIT-SCALE-01',
    title: 'Meter readings recorded in MWh but labelled kWh',
    sourceFile: 'electricity_meter_readings.csv',
    category: 'units',
    defaultSeverity: 'error',
    defaultAction: 'fixed',
    rationale:
      'MTR-07 reads ~250,000 kWh a month through September 2025, then ~250 from October onward, with the unit ' +
      'column still saying kWh. A ventilation and dewatering load does not fall by 99.9% and stay there for nine ' +
      'months. Detected by order of magnitude within each meter, not by hard-coding the meter and date, and ' +
      'corrected x1000 with the factor recorded per row. This is the single largest error in the dataset: ' +
      'uncorrected it understates Scope 2 for half the reporting period.',
  }),

  'ELEC-METER-GAP-01': rule({
    ruleId: 'ELEC-METER-GAP-01',
    title: 'Gap in the meter numbering',
    sourceFile: 'electricity_meter_readings.csv',
    category: 'completeness',
    defaultSeverity: 'warning',
    defaultAction: 'flagged',
    rationale:
      'Meters run MTR-01 to MTR-07 with MTR-06 absent for all 18 months. Either it was decommissioned, or a load ' +
      'is not being reported. Nothing in the export says which, and the difference matters: one is fine, the other ' +
      'is missing Scope 2. Flagged as a question for the client rather than assumed away.',
  }),

  'ELEC-CONSUMPTION-DROP-01': rule({
    ruleId: 'ELEC-CONSUMPTION-DROP-01',
    title: 'Site-wide consumption far below the period norm',
    sourceFile: 'electricity_meter_readings.csv',
    category: 'anomaly',
    defaultSeverity: 'warning',
    defaultAction: 'flagged',
    rationale:
      'Same robust outlier test as the fuel spike rule, applied to site-wide monthly consumption. Explicitly NOT ' +
      'corrected: the incident register records a regional substation failure and three weeks on backup generation ' +
      'for the month this fires, so the reading is real. A pipeline that "smoothed" it would erase the most ' +
      'important event in the period.',
  }),

  // ---------------------------------------------------------------------------
  // incident_register.csv
  // ---------------------------------------------------------------------------
  'INC-DUP-ID-01': rule({
    ruleId: 'INC-DUP-ID-01',
    title: 'Incident ID used for more than one incident',
    sourceFile: 'incident_register.csv',
    category: 'duplication',
    defaultSeverity: 'error',
    defaultAction: 'fixed',
    rationale:
      'INC-2025-011 identifies two different incidents on two different dates with different descriptions. Unlike ' +
      'the fuel duplicates these are distinct events, so neither can be dropped. The later row is given a suffixed ' +
      'surrogate key and the register ID is preserved unchanged in source_incident_id, so a client searching their ' +
      'own system still finds it.',
  }),

  'INC-SEV-SCALE-01': rule({
    ruleId: 'INC-SEV-SCALE-01',
    title: 'Two severity scales in one column',
    sourceFile: 'incident_register.csv',
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultAction: 'flagged',
    rationale:
      'The column mixes Low/Medium with 1/2/3. We map Low=1, Medium=2, High=3, which assumes both are the same ' +
      'three-point scale written differently. That assumption is worth stating rather than burying: many mining ' +
      'registers number severity the other way, with 1 as most severe. If that is the case here, every numeric row ' +
      'is inverted. The AI layer tests the assumption by reading the descriptions.',
  }),

  'INC-SEV-MAPPED-01': rule({
    ruleId: 'INC-SEV-MAPPED-01',
    title: 'Text severity mapped to the numeric scale',
    sourceFile: 'incident_register.csv',
    category: 'consistency',
    defaultSeverity: 'info',
    defaultAction: 'fixed',
    rationale:
      'Row-level trace of each Low/Medium value converted to a number, so the mapping is visible per record rather ' +
      'than only as a policy statement.',
  }),

  'INC-ID-SEQUENCE-01': rule({
    ruleId: 'INC-ID-SEQUENCE-01',
    title: 'Incident ID far outside the main sequence',
    sourceFile: 'incident_register.csv',
    category: 'structure',
    defaultSeverity: 'info',
    defaultAction: 'flagged',
    rationale:
      'Most IDs form a dense run from 001. A handful sit far above it with a large gap in between, which suggests ' +
      'they were merged in from a different register rather than issued by this one. Worth surfacing on its own ' +
      'terms: these records also turn out to be the ones whose severity does not match their description.',
  }),

  'INC-DESC-REUSED-01': rule({
    ruleId: 'INC-DESC-REUSED-01',
    title: 'Identical description reused across incidents',
    sourceFile: 'incident_register.csv',
    category: 'duplication',
    defaultSeverity: 'info',
    defaultAction: 'flagged',
    rationale:
      'Several descriptions appear word for word on multiple incidents at different dates and locations. Two very ' +
      'different explanations: copy-paste in the register, or a hazard genuinely recurring without being addressed. ' +
      'Flagged rather than deduplicated, because the second reading is a finding in its own right — one description ' +
      'here repeats five times across four locations.',
  }),

  'INC-LOCATION-01': rule({
    ruleId: 'INC-LOCATION-01',
    title: 'Description names a place inconsistent with the recorded location',
    sourceFile: 'incident_register.csv',
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultAction: 'flagged',
    rationale:
      'Deliberately narrow: fires only when the text names fixed infrastructure (crusher, wash plant, CHPP, ROM ' +
      'pad, thickener) while the location column holds a mobile fleet. A dust exceedance at the crusher cannot have ' +
      'happened "at" the Haul Fleet. Not corrected — the location column and the description disagree, and the ' +
      'export gives no way to tell which one the client trusts.',
  }),

  'INC-TYPE-UNKNOWN-01': rule({
    ruleId: 'INC-TYPE-UNKNOWN-01',
    title: 'Incident type code not in the known set',
    sourceFile: 'incident_register.csv',
    category: 'structure',
    defaultSeverity: 'error',
    defaultAction: 'flagged',
    rationale:
      'The register ships bare three-letter codes with no code table. The known set is seeded as reference data so ' +
      'an unrecognised code surfaces instead of quietly becoming a new category.',
  }),

  // ---------------------------------------------------------------------------
  // suppliers.csv
  // ---------------------------------------------------------------------------
  'SUP-DUP-01': rule({
    ruleId: 'SUP-DUP-01',
    title: 'Supplier appears more than once',
    sourceFile: 'suppliers.csv',
    category: 'duplication',
    defaultSeverity: 'error',
    defaultAction: 'fixed',
    rationale:
      'Two entities are listed twice: once as a legal-suffix variant (Pty Ltd / P-L) and once as a spelling error ' +
      'sharing an ABN (Maintenance / Maintanence). Both rows are kept and the duplicate points at its primary, ' +
      'rather than being merged away — the client ledger contains both, and reconciling against it later needs ' +
      'both visible. Unmerged, Ironline reads as $8.94M against a true $10.15M, which is the difference between ' +
      'their largest supplier and their second largest.',
  }),

  'SUP-ABN-FORM-01': rule({
    ruleId: 'SUP-ABN-FORM-01',
    title: 'ABN missing or not 11 digits',
    sourceFile: 'suppliers.csv',
    category: 'completeness',
    defaultSeverity: 'warning',
    defaultAction: 'flagged',
    rationale:
      'An ABN is 11 digits. One supplier records 7, two record none. Flagged, never defaulted to zero or guessed: ' +
      'an ABN is how an entity is identified for tax and procurement, and a wrong one is worse than an absent one.',
  }),

  'SUP-ABN-CHECKSUM-01': rule({
    ruleId: 'SUP-ABN-CHECKSUM-01',
    title: 'All ABNs fail the ATO checksum',
    sourceFile: 'suppliers.csv',
    category: 'plausibility',
    defaultSeverity: 'info',
    defaultAction: 'flagged',
    rationale:
      'Twelve of the fifteen suppliers carry a correctly formed 11-digit ABN, and all twelve fail the modulus-89 ' +
      'checksum. When a rule fails for 100% of the rows it applies to, the honest conclusion is that the source is ' +
      'systematically different from what the rule assumes — synthetic or masked values — not that the client has ' +
      'twelve separate problems. Reported once at file level so it does not bury the one genuinely malformed ABN, ' +
      'and no supplier is marked invalid on this basis alone.',
  }),

  'SUP-CATEGORY-01': rule({
    ruleId: 'SUP-CATEGORY-01',
    title: 'Inconsistent category label',
    sourceFile: 'suppliers.csv',
    category: 'consistency',
    defaultSeverity: 'info',
    defaultAction: 'fixed',
    rationale:
      'The same category is written two ways ("Fuel supply" and "Fuel"). Aligned to the label used by the primary ' +
      'record of the pair, so spend groups correctly.',
  }),
};

export const ALL_RULES: RuleDefinition[] = Object.values(RULES);

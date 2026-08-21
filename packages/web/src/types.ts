/** Response shapes from the API. camelCase throughout, per the service layer. */

export type MonthlyEmissions = {
  month: string;
  scope1KgCo2e: number;
  scope2KgCo2e: number;
  totalKgCo2e: number;
  scope1SharePct: number;
  monthOnMonthPct: number | null;
  contributingRecords: number;
  qualityIssueCount: number;
  qualityErrorCount: number;
  hasQualityFlags: boolean;
  hasImpreciseDates: boolean;
};

export type FinancialYear = {
  financialYear: number;
  scope1KgCo2e: number;
  scope2KgCo2e: number;
  totalKgCo2e: number;
  monthsWithData: number;
  isCompleteYear: boolean;
  firstMonth: string;
  lastMonth: string;
};

export type EmissionsSummary = {
  period: {
    firstMonth: string | null;
    lastMonth: string | null;
    months: number;
    scope1KgCo2e: number;
    scope2KgCo2e: number;
    totalKgCo2e: number;
    qualityErrorCount: number;
  };
  financialYears: FinancialYear[];
  extremes: { month: string; totalKgCo2e: number; kind: string }[];
  intensity: { available: boolean; reason: string };
};

export type SiteArea = {
  siteArea: string;
  siteAreaCategory: string;
  fuelType: string;
  litres: number;
  kgCo2e: number;
  deliveryCount: number;
};

export type Incident = {
  id: string;
  sourceIncidentId: string;
  incidentDate: string;
  location: string;
  typeCode: string;
  typeLabel: string | null;
  severity: number | null;
  severityRaw: string;
  description: string;
  sourceRowNumber: number;
  aiIsPsychosocial: boolean;
  aiSeverityMismatch: boolean;
  aiCategory: string | null;
  qualityIssueCount: number;
};

export type IncidentTrends = {
  byMonth: {
    month: string;
    incidentCount: number;
    severity1: number | null;
    severity2: number | null;
    severity3: number | null;
  }[];
  byType: { typeCode: string; typeLabel: string; incidentCount: number }[];
  bySeverity: { severity: number | null; incidentCount: number }[];
};

export type DataQualityRule = {
  ruleId: string;
  title: string;
  sourceFile: string;
  category: string;
  severity: string;
  action: string;
  rationale: string;
  issueCount: number;
};

export type DataQualityOverview = {
  totals: { totalIssues: number; rulesTriggered: number };
  byFile: {
    sourceFile: string;
    issueCount: number;
    errors: number;
    warnings: number;
    infos: number;
  }[];
  bySeverity: { key: string; issueCount: number }[];
  byAction: { key: string; issueCount: number }[];
  byRule: DataQualityRule[];
  actionLegend: Record<string, string>;
};

export type DataQualityIssue = {
  id: number;
  ruleId: string;
  ruleTitle: string;
  rationale: string;
  sourceFile: string;
  sourceRowNumber: number | null;
  recordKey: string | null;
  field: string | null;
  severity: string;
  action: string;
  description: string;
  originalValue: string | null;
  resolvedValue: string | null;
};

export type UserProfile = {
  user: { id: number; email: string; displayName: string; role: 'owner' | 'member' };
  company: { id: number; slug: string; name: string; abn: string | null };
};

export type UploadResult = {
  load: { id: number; issueCount: number; errorCount: number; finishedAt: string | null };
  issuesByRule: [string, number][];
};

/**
 * The cited compliance summary. A claim is the unit that carries citations,
 * because it is the unit the gate can accept or discard on its own. `facts` is
 * the closed set the model was allowed to draw on.
 */
export type ReportFact = {
  id: string;
  kind: 'metric' | 'record';
  label: string;
  value: number | string;
  unit: string | null;
  source: string;
  detail: string | null;
};

export type ReportClaim = { text: string; citations: string[] };

export type ReportSection = { section: string; claims: ReportClaim[] };

export type ClaimRejection = {
  section: string;
  text: string;
  citations: string[];
  reason: string;
  detail: string;
  round?: number;
};

export type ComplianceSummary =
  | { available: false; reason: string; hint: string }
  | {
      available: true;
      source: 'database' | 'cache-file';
      period: { from: string; to: string; company: string };
      generatedAt: string;
      provider: string;
      model: string;
      promptVersion: string;
      sections: ReportSection[];
      facts: ReportFact[];
      verification: {
        claimsChecked: number;
        claimsShown: number;
        claimsRejectedAtGeneration: number;
        claimsDroppedOnRead: number;
        droppedOnRead: ClaimRejection[];
        factsChanged: boolean;
        note: string;
      };
      rejectedAtGeneration: ClaimRejection[];
      usage: {
        inputTokens?: number;
        outputTokens?: number;
        estimatedCostUsd?: number | null;
      };
    };

/**
 * Cross-dataset correlation. A union on `detected`, because "no outage in this
 * data" is a normal answer and a nullable object invites rendering an empty
 * panel instead of saying so.
 */
export type OutageChainLink = {
  step: number;
  source: string;
  title: string;
  detail: string;
  recordId: string | null;
};

export type OutageMeter = {
  meterId: string;
  description: string | null;
  consumptionKwh: number;
  baselineKwh: number;
  changePct: number;
  belowBaseline: boolean;
};

export type OutageIncident = {
  id: string;
  incidentDate: string;
  typeCode: string;
  severity: number | null;
  description: string;
  aiCategory?: string | null;
  aiEvidenceQuote?: string | null;
};

export type OutageAnalysis =
  | { detected: false; reason: string; monthsAnalysed?: number }
  | {
      detected: true;
      month: string;
      window: { from: string; to: string };
      electricity: {
        actualKwh: number;
        baselineKwh: number;
        changePct: number;
        meterCount: number;
        metersBelowBaseline: number;
        meters: OutageMeter[];
      };
      fuel: {
        actualLitres: number;
        baselineLitres: number;
        changePct: number;
        excessLitres: number;
        deliveryCount: number;
      };
      emissions: {
        actual: {
          scope1KgCo2e: number;
          scope2KgCo2e: number;
          totalKgCo2e: number;
          scope1SharePct: number;
        };
        baseline: {
          scope1KgCo2e: number;
          scope2KgCo2e: number;
          totalKgCo2e: number;
          scope1SharePct: number;
        };
        scope1ChangePct: number;
        scope2ChangePct: number;
        totalChangePct: number;
      };
      counterfactual: {
        totalKgCo2e: number;
        reportedMinusCounterfactualKg: number;
        gridFactorKgPerKwh: number | null;
        assumption: string;
      };
      incidents: {
        rootCause: OutageIncident | null;
        consequences: OutageIncident[];
        countInWindow: number;
      };
      chain: OutageChainLink[];
    };

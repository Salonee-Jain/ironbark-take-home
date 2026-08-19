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

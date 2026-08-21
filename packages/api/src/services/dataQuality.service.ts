import * as repository from '../repositories/dataQuality.repository.js';
import { camelCaseRows } from '../utils/case.js';

export type IssueQuery = {
  file?: string;
  severity?: string;
  action?: string;
  rule?: string;
  search?: string;
  limit?: number;
};

const DEFAULT_ISSUE_LIMIT = 200;

export async function getOverview(companyId: number) {
  const [totals, byFile, bySeverity, byAction, byRule] = await Promise.all([
    repository.findTotals(companyId),
    repository.countByFile(companyId),
    repository.countBySeverity(companyId),
    repository.countByAction(companyId),
    repository.countByRule(companyId),
  ]);

  return {
    totals: {
      totalIssues: totals?.total_issues ?? 0,
      rulesTriggered: totals?.rules_triggered ?? 0,
    },
    byFile: camelCaseRows(byFile),
    bySeverity: camelCaseRows(bySeverity),
    byAction: camelCaseRows(byAction),
    byRule: camelCaseRows(byRule),
    // What each action means, served with the data so a client does not have to
    // encode our editorial policy in its own copy.
    actionLegend: {
      fixed: 'Corrected in flight. The original value is retained on the record.',
      flagged:
        'Loaded as-is and surfaced for a human. Used wherever a correction would be a guess.',
      rejected:
        'Excluded from the analytics tables, but recorded here in full with the reason.',
    },
  };
}

export async function listIssues(companyId: number, query: IssueQuery) {
  const limit = query.limit ?? DEFAULT_ISSUE_LIMIT;
  const search = query.search?.trim() ?? '';

  const rows = await repository.findIssues(companyId, {
    sourceFile: query.file ?? null,
    severity: query.severity ?? null,
    action: query.action ?? null,
    ruleId: query.rule ?? null,
    search: search === '' ? null : search,
    limit,
  });

  return { issues: camelCaseRows(rows), returned: rows.length, limit };
}

export async function listRules(companyId: number) {
  const rules = await repository.findAllRules(companyId);

  return {
    rules: camelCaseRows(rules),
    // A rule that fired zero times is not noise, it is evidence the check ran
    // and found nothing, which is exactly what a reviewer wants to know.
    triggered: rules.filter((rule) => rule.issue_count > 0).length,
    silent: rules.filter((rule) => rule.issue_count === 0).length,
  };
}

import type {
  DataQualityAction,
  DataQualitySeverity,
  SourceFile,
} from '@ironbark/shared';
import { RULES, type RuleId } from './rules.js';

/**
 * Collects data-quality findings during a load.
 *
 * Severity and action default to the rule's declared policy, so a loader states
 * only what it observed and cannot accidentally downgrade a finding at the call
 * site. Either can still be overridden where a rule genuinely has two modes.
 */

export type DataQualityIssue = {
  ruleId: RuleId;
  sourceFile: SourceFile;
  sourceRowNumber: number | null;
  recordKey: string | null;
  field: string | null;
  severity: DataQualitySeverity;
  action: DataQualityAction;
  description: string;
  originalValue: string | null;
  resolvedValue: string | null;
};

export type IssueInput = {
  ruleId: RuleId;
  description: string;
  sourceRowNumber?: number;
  recordKey?: string;
  field?: string;
  severity?: DataQualitySeverity;
  action?: DataQualityAction;
  originalValue?: string;
  resolvedValue?: string;
};

export class IssueCollector {
  private readonly issues: DataQualityIssue[] = [];

  add(input: IssueInput): void {
    const rule = RULES[input.ruleId];

    const issue: DataQualityIssue = {
      ruleId: input.ruleId,
      sourceFile: rule.sourceFile,
      sourceRowNumber: input.sourceRowNumber ?? null,
      recordKey: input.recordKey ?? null,
      field: input.field ?? null,
      severity: input.severity ?? rule.defaultSeverity,
      action: input.action ?? rule.defaultAction,
      description: input.description,
      originalValue: input.originalValue ?? null,
      resolvedValue: input.resolvedValue ?? null,
    };

    // The database enforces this too, but failing here names the rule that got
    // it wrong instead of surfacing as a constraint violation at insert time.
    if (issue.action === 'fixed' && issue.resolvedValue === null) {
      throw new Error(
        `${issue.ruleId} recorded a fix without a resolved value. A correction that cannot say what it changed the value to is not auditable.`,
      );
    }

    this.issues.push(issue);
  }

  all(): readonly DataQualityIssue[] {
    return this.issues;
  }

  countByRule(): Map<RuleId, number> {
    const counts = new Map<RuleId, number>();
    for (const issue of this.issues) {
      counts.set(issue.ruleId, (counts.get(issue.ruleId) ?? 0) + 1);
    }
    return counts;
  }

  countBy(key: 'severity' | 'action'): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const issue of this.issues) {
      counts[issue[key]] = (counts[issue[key]] ?? 0) + 1;
    }
    return counts;
  }
}

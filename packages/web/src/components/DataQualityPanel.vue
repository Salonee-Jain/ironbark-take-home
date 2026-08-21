<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DataQualityIssue, DataQualityOverview } from '../types';

/**
 * The data-quality report, organised by decision rather than severity: "what did
 * you do about it" is the question a compliance reviewer actually has. Every
 * issue points at the physical line in the source file.
 */
const props = defineProps<{
  overview: DataQualityOverview;
  issues: DataQualityIssue[];
}>();

const openRule = ref<string | null>(null);

const actionOrder = ['fixed', 'flagged', 'rejected'] as const;

const byAction = computed(() =>
  actionOrder.map((action) => ({
    action,
    count:
      props.overview.byAction.find((a) => a.key === action)?.issueCount ?? 0,
    legend: props.overview.actionLegend[action] ?? '',
  })),
);

const errorCount = computed(
  () => props.overview.bySeverity.find((s) => s.key === 'error')?.issueCount ?? 0,
);

function issuesForRule(ruleId: string): DataQualityIssue[] {
  return props.issues.filter((i) => i.ruleId === ruleId).slice(0, 6);
}

function toggle(ruleId: string): void {
  openRule.value = openRule.value === ruleId ? null : ruleId;
}
</script>

<template>
  <section class="card dq">
    <header>
      <div>
        <h2>Data quality</h2>
        <p class="subtitle">
          {{ overview.totals.totalIssues }} findings from
          {{ overview.totals.rulesTriggered }} rules across
          {{ overview.byFile.length }} source files, {{ errorCount }} of them
          error-severity. Nothing was discarded silently: rejected rows are recorded
          here with the reason.
        </p>
      </div>
    </header>

    <div class="actions">
      <div v-for="a in byAction" :key="a.action" class="action">
        <div class="action-head">
          <span class="action-count">{{ a.count }}</span>
          <span class="action-name">{{ a.action }}</span>
        </div>
        <p>{{ a.legend }}</p>
      </div>
    </div>

    <h3>Findings by rule</h3>
    <ul class="rules">
      <li v-for="rule in overview.byRule" :key="rule.ruleId">
        <button type="button" class="rule-row" :aria-expanded="openRule === rule.ruleId" @click="toggle(rule.ruleId)">
          <span class="chev" :class="{ open: openRule === rule.ruleId }">›</span>
          <span class="count" :class="rule.severity">{{ rule.issueCount }}</span>
          <span class="rule-title">{{ rule.title }}</span>
          <span class="rule-meta">
            <span class="pill" :class="rule.action">{{ rule.action }}</span>
            <code>{{ rule.sourceFile }}</code>
          </span>
        </button>

        <div v-if="openRule === rule.ruleId" class="detail">
          <p class="rationale">{{ rule.rationale }}</p>

          <table v-if="issuesForRule(rule.ruleId).length">
            <thead>
              <tr><th>Line</th><th>Record</th><th>Was</th><th>Became</th><th>Detail</th></tr>
            </thead>
            <tbody>
              <tr v-for="issue in issuesForRule(rule.ruleId)" :key="issue.id">
                <td class="num">{{ issue.sourceRowNumber ?? '—' }}</td>
                <td><code v-if="issue.recordKey">{{ issue.recordKey }}</code><span v-else>—</span></td>
                <td class="was">{{ issue.originalValue ?? '—' }}</td>
                <td class="became">{{ issue.resolvedValue ?? '—' }}</td>
                <td class="detail-text">{{ issue.description }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="rule.issueCount > 6" class="more">
            showing 6 of {{ rule.issueCount }}
          </p>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.dq {
  padding: 18px 20px 20px;
}

h2 {
  font-size: 15px;
  font-weight: 600;
}

h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 22px 0 10px;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 12.5px;
  margin-top: 3px;
  max-width: 82ch;
}

.actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-top: 18px;
}

.action {
  padding: 12px 14px;
  background: var(--surface-sunken);
  border-radius: 8px;
}

.action-head {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.action-count {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.action-name {
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
  color: var(--text-secondary);
}

.action p {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 4px;
}

.rules {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rules li {
  border-top: 1px solid var(--border);
}

.rule-row {
  width: 100%;
  display: grid;
  grid-template-columns: 14px 34px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 9px 2px;
  background: none;
  border: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--text-primary);
}

.rule-row:hover {
  background: var(--surface-sunken);
}

.chev {
  color: var(--text-muted);
  transition: transform 0.12s ease;
  display: inline-block;
}

.chev.open {
  transform: rotate(90deg);
}

.count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 12.5px;
  text-align: right;
}

/* Severity tints the count only, and the pill beside it carries the word, so
   the state is never conveyed by colour alone. */
.count.error {
  color: var(--status-critical);
}

.count.warning {
  color: var(--text-primary);
}

.count.info {
  color: var(--text-muted);
}

.rule-title {
  font-size: 12.5px;
  min-width: 0;
}

.rule-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.pill {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 20px;
  text-transform: capitalize;
  background: var(--surface-sunken);
  color: var(--text-secondary);
}

.pill.rejected {
  background: color-mix(in srgb, var(--status-critical) 15%, transparent);
  color: var(--status-critical);
}

.pill.fixed {
  background: color-mix(in srgb, var(--status-good) 15%, transparent);
  color: var(--status-good);
}

.detail {
  padding: 4px 0 16px 58px;
  overflow-x: auto;
}

.rationale {
  font-size: 12.5px;
  color: var(--text-secondary);
  max-width: 88ch;
  margin-bottom: 12px;
  padding-left: 11px;
  border-left: 2px solid var(--border);
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 11.5px;
}

th,
td {
  text-align: left;
  padding: 5px 12px 5px 0;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

th {
  color: var(--text-muted);
  font-weight: 500;
  white-space: nowrap;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.was {
  color: var(--text-muted);
  text-decoration: line-through;
  max-width: 190px;
}

.became {
  color: var(--text-primary);
  font-weight: 500;
  max-width: 190px;
}

.detail-text {
  color: var(--text-secondary);
  min-width: 260px;
}

.more {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 7px;
}

code {
  font-size: 0.92em;
  background: var(--surface-sunken);
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--text-secondary);
}

@media (max-width: 620px) {
  .dq {
    padding: 16px;
  }

  .actions {
    grid-template-columns: 1fr;
  }

  .rule-row {
    grid-template-columns: 12px 28px minmax(0, 1fr);
    gap: 8px;
  }

  .rule-meta {
    grid-column: 3;
    grid-row: 2;
    margin-top: -5px;
    padding-bottom: 3px;
  }

  .detail {
    padding-left: 0;
  }
}
</style>

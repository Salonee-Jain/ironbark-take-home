<script setup lang="ts">
import { computed } from 'vue';
import { monthLabel, monthLabelLong } from '../format';
import type { Incident, IncidentTrends } from '../types';
import BarList from './BarList.vue';
import ChartFrame from './ChartFrame.vue';

const props = defineProps<{
  trends: IncidentTrends;
  incidents: Incident[];
}>();

const psychosocial = computed(() =>
  props.incidents.filter((i) => i.aiIsPsychosocial),
);
const mismatches = computed(() =>
  props.incidents.filter((i) => i.aiSeverityMismatch),
);
const aiHasRun = computed(() =>
  props.incidents.some((i) => i.aiCategory !== null),
);

/** Incidents filed under the register's catch-all code. */
const uncategorised = computed(() =>
  props.incidents.filter((i) => i.typeCode === 'OTH'),
);

const maxMonth = computed(() =>
  Math.max(...props.trends.byMonth.map((m) => m.incidentCount), 1),
);

const byType = computed(() =>
  props.trends.byType.map((t) => ({
    label: t.typeLabel,
    value: t.incidentCount,
  })),
);
</script>

<template>
  <div class="safety">
    <ChartFrame
      title="Incidents by month"
      subtitle="All severities. The register holds 42 incidents across 18 months."
    >
      <!-- No value on every column: a number beside every mark is chaos and goes
           unread. The hovered column shows its count, and the table view carries
           all of them. Labels appear every third month, horizontally. -->
      <ul class="months">
        <li
          v-for="(m, i) in trends.byMonth"
          :key="m.month"
          tabindex="0"
          :aria-label="`${monthLabelLong(m.month)}: ${m.incidentCount} incidents`"
        >
          <span class="n">{{ m.incidentCount }}</span>
          <div
            class="col"
            :style="{ height: `${(m.incidentCount / maxMonth) * 100}%` }"
          />
          <span class="m">{{ i % 3 === 0 ? monthLabel(m.month) : '' }}</span>
        </li>
      </ul>

      <template #table>
        <table>
          <thead>
            <tr><th>Month</th><th>Incidents</th><th>Sev 1</th><th>Sev 2</th><th>Sev 3</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in trends.byMonth" :key="m.month">
              <td>{{ monthLabelLong(m.month) }}</td>
              <td class="num">{{ m.incidentCount }}</td>
              <td class="num">{{ m.severity1 ?? 0 }}</td>
              <td class="num">{{ m.severity2 ?? 0 }}</td>
              <td class="num">{{ m.severity3 ?? 0 }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </ChartFrame>

    <ChartFrame
      title="Incidents by type"
      subtitle="Type codes come from the register; the labels are inferred — the source ships no code table."
    >
      <BarList :items="byType" color="var(--series-4)" />
      <template #table>
        <table>
          <thead><tr><th>Code</th><th>Label</th><th>Count</th></tr></thead>
          <tbody>
            <tr v-for="t in trends.byType" :key="t.typeCode">
              <td><code>{{ t.typeCode }}</code></td>
              <td>{{ t.typeLabel }}</td>
              <td class="num">{{ t.incidentCount }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </ChartFrame>

    <section class="card ai">
      <header>
        <h2>AI review of incident descriptions</h2>
        <p class="subtitle">
          Every finding quotes the source record verbatim; a finding whose quote is not
          found in the description is rejected before it is stored.
        </p>
      </header>

      <div v-if="!aiHasRun" class="empty">
        <p class="empty-title">Classification has not been run yet.</p>
        <p>
          {{ uncategorised.length }} incidents are filed under the register's catch-all
          code <code>OTH</code>, which is where psychosocial hazards typically hide. The
          AI layer reads every description and categorises it independently of how it was
          coded, and flags descriptions inconsistent with their recorded severity.
        </p>
        <p class="cmd">
          Set <code>ANTHROPIC_API_KEY</code>, then
          <code>npm run ai:classify &amp;&amp; npm run etl</code>
        </p>
      </div>

      <div v-else class="findings">
        <div class="counts">
          <div>
            <span class="big">{{ psychosocial.length }}</span>
            <span class="cap">psychosocial hazards identified</span>
          </div>
          <div>
            <span class="big">{{ mismatches.length }}</span>
            <span class="cap">severity mismatches</span>
          </div>
        </div>

        <ul class="found">
          <li v-for="i in [...psychosocial, ...mismatches.filter((m) => !m.aiIsPsychosocial)]" :key="i.id">
            <div class="found-head">
              <code>{{ i.sourceIncidentId }}</code>
              <span class="date">{{ i.incidentDate }}</span>
              <span v-if="i.aiIsPsychosocial" class="badge psycho">Psychosocial</span>
              <span v-if="i.aiSeverityMismatch" class="badge mismatch">
                Severity {{ i.severity }} disputed
              </span>
              <span class="coded">coded {{ i.typeCode }}</span>
            </div>
            <p class="desc">{{ i.description }}</p>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.safety {
  display: grid;
  gap: var(--gap);
  grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
}

.ai {
  padding: 18px 20px 20px;
  grid-column: 1 / -1;
}

h2 {
  font-size: 15px;
  font-weight: 600;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 12.5px;
  margin-top: 3px;
  max-width: 72ch;
}

.months {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 168px;
}

.months li {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  height: 100%;
  gap: 4px;
  min-width: 0;
  cursor: default;
}

.col {
  width: 100%;
  max-width: 24px;
  background: var(--series-4);
  border-radius: 4px 4px 0 0;
  min-height: 2px;
}

.n {
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.months li:hover .n,
.months li:focus-visible .n {
  opacity: 1;
}

.m {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  height: 12px;
}

.empty {
  margin-top: 16px;
  padding: 16px 18px;
  background: var(--surface-sunken);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  max-width: 80ch;
}

.empty-title {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.cmd {
  margin-top: 10px;
  font-size: 12px;
}

.counts {
  display: flex;
  gap: 34px;
  margin: 16px 0 18px;
}

.big {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
  display: block;
  line-height: 1.1;
}

.cap {
  font-size: 12px;
  color: var(--text-secondary);
}

.found {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.found li {
  padding: 12px 14px;
  background: var(--surface-sunken);
  border-radius: 8px;
}

.found-head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  font-size: 11.5px;
  margin-bottom: 5px;
}

.date,
.coded {
  color: var(--text-muted);
}

.badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 20px;
}

/* Status colours always ship with a word, never colour alone. */
.badge.psycho {
  background: color-mix(in srgb, var(--status-critical) 16%, transparent);
  color: var(--status-critical);
}

.badge.mismatch {
  background: color-mix(in srgb, var(--status-warning) 22%, transparent);
  color: var(--text-primary);
}

.desc {
  font-size: 12.5px;
  color: var(--text-secondary);
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12.5px;
}

th,
td {
  text-align: left;
  padding: 6px 12px 6px 0;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

th {
  color: var(--text-secondary);
  font-weight: 500;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

code {
  font-size: 0.94em;
  background: var(--surface-sunken);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>

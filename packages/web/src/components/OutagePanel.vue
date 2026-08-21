<script setup lang="ts">
import { computed } from 'vue';
import { monthLabelLong, signedPercent, tonnes } from '../format';
import type { OutageAnalysis } from '../types';

/**
 * The cross-dataset finding: the meters show a collapse, the fuel invoices show
 * a spike, the incident register explains both, and the headline total falls.
 *
 * Everything here is computed by GET /api/analysis/outage, including which month
 * it is, so the panel renders whatever was detected rather than this dataset in
 * particular.
 */
const props = defineProps<{ analysis: OutageAnalysis }>();

const found = computed(() => (props.analysis.detected ? props.analysis : null));

const heading = computed(() =>
  found.value ? monthLabelLong(found.value.month) : '',
);

const direction = (value: number) => (value > 0 ? 'up' : value < 0 ? 'down' : 'neutral');
</script>

<template>
  <section v-if="found" class="panel card">
    <header>
      <span class="tag">Cross-dataset finding</span>
      <h2>{{ heading }}: the month emissions “fell”</h2>
      <p class="lede">
        Total emissions moved
        {{ signedPercent(found.emissions.totalChangePct) }} against a median month, which
        reads as the best month of the period. It was not. Grid supply was lost and the
        site ran on backup diesel, so Scope 2 collapsed while Scope 1 rose to its highest
        level, because the load moved onto a fuel with a far heavier factor. The total
        fell only because part of the site stopped.
      </p>
    </header>

    <div class="grid">
      <div class="metric">
        <div class="metric-label"><span class="key scope2" />Scope 2 · grid</div>
        <div class="metric-value">
          {{ tonnes(found.emissions.actual.scope2KgCo2e) }}<span class="u">t</span>
        </div>
        <div class="delta" :class="direction(found.emissions.scope2ChangePct)">
          {{ signedPercent(found.emissions.scope2ChangePct) }}
          <span class="vs">vs median month</span>
        </div>
      </div>

      <div class="metric">
        <div class="metric-label"><span class="key scope1" />Scope 1 · fuel</div>
        <div class="metric-value">
          {{ tonnes(found.emissions.actual.scope1KgCo2e) }}<span class="u">t</span>
        </div>
        <div class="delta" :class="direction(found.emissions.scope1ChangePct)">
          {{ signedPercent(found.emissions.scope1ChangePct) }}
          <span class="vs">vs median month</span>
        </div>
      </div>

      <div class="metric">
        <div class="metric-label">Scope 1 share</div>
        <div class="metric-value">
          {{ found.emissions.actual.scope1SharePct }}<span class="u">%</span>
        </div>
        <div class="delta neutral">
          from {{ found.emissions.baseline.scope1SharePct }}%
          <span class="vs">the signal that moves</span>
        </div>
      </div>

      <div class="metric">
        <div class="metric-label">Had the grid held</div>
        <div class="metric-value">
          {{ tonnes(found.counterfactual.totalKgCo2e) }}<span class="u">t</span>
        </div>
        <div class="delta neutral">
          reported {{ tonnes(found.emissions.actual.totalKgCo2e) }}t
          <span class="vs">counterfactual, not a measurement</span>
        </div>
      </div>
    </div>

    <ol class="chain">
      <li v-for="link in found.chain" :key="link.step">
        <span class="step">{{ link.step }}</span>
        <span>
          <strong>{{ link.title }}</strong>: {{ link.detail }}
          <em class="src">{{ link.source }}</em>
        </span>
      </li>
    </ol>

    <!-- The evidence that this is a supply failure and not a broken meter.
         Each meter against its own history, because they differ by an order of
         magnitude and a site-wide percentage would hide the small ones. -->
    <details class="evidence">
      <summary>
        All {{ found.electricity.metersBelowBaseline }} of
        {{ found.electricity.meterCount }} meters fell at once
      </summary>
      <table>
        <thead>
          <tr><th>Meter</th><th></th><th>This month</th><th>Its norm</th><th>Change</th></tr>
        </thead>
        <tbody>
          <tr v-for="meter in found.electricity.meters" :key="meter.meterId">
            <td><code>{{ meter.meterId }}</code></td>
            <td class="muted">{{ meter.description }}</td>
            <td class="num">{{ Math.round(meter.consumptionKwh).toLocaleString() }}</td>
            <td class="num muted">{{ Math.round(meter.baselineKwh).toLocaleString() }}</td>
            <td class="num">{{ signedPercent(meter.changePct) }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <p v-if="found.incidents.rootCause" class="footnote">
      <strong>Root cause:</strong> <code>{{ found.incidents.rootCause.id }}</code>
      ({{ found.incidents.rootCause.incidentDate }}, severity
      {{ found.incidents.rootCause.severity }}): {{ found.incidents.rootCause.description }}
    </p>

    <p
      v-for="consequence in found.incidents.consequences"
      :key="consequence.id"
      class="footnote"
    >
      <strong>Human cost:</strong> <code>{{ consequence.id }}</code>, coded
      <code>{{ consequence.typeCode }}</code> in the register, identified as
      <strong>{{ consequence.aiCategory }}</strong> by the AI layer, on the evidence
      “{{ consequence.aiEvidenceQuote }}”.
    </p>

    <p class="footnote">
      {{ found.counterfactual.assumption }}
      Fuel volume {{ signedPercent(found.fuel.changePct) }} across
      {{ found.fuel.deliveryCount }} deliveries,
      {{ Math.round(found.fuel.excessLitres).toLocaleString() }} L above a median month.
    </p>
  </section>
</template>

<style scoped>
.panel {
  padding: 22px 24px;
  border-left: 3px solid var(--scope1);
}

.tag {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--scope1);
  margin-bottom: 8px;
}

h2 {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 8px;
}

.lede {
  color: var(--text-secondary);
  font-size: 13.5px;
  max-width: 76ch;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
  gap: 18px;
  margin: 22px 0;
  padding: 18px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.metric-label {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}

.key {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.key.scope1 {
  background: var(--scope1);
}

.key.scope2 {
  background: var(--scope2);
}

.metric-value {
  font-size: 27px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.u {
  font-size: 0.48em;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: 3px;
}

.delta {
  font-size: 12px;
  margin-top: 4px;
  font-weight: 600;
}

/* Direction, not sentiment: down is not automatically good here, that is the
   entire point of the panel. Both are neutral ink with the arrow doing the work. */
.delta.up::before {
  content: '▲ ';
}

.delta.down::before {
  content: '▼ ';
}

.delta.up,
.delta.down,
.delta.neutral {
  color: var(--text-primary);
}

.vs {
  display: block;
  font-weight: 400;
  color: var(--text-muted);
  margin-top: 2px;
}

.chain {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.chain li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  font-size: 13px;
  color: var(--text-secondary);
  max-width: 84ch;
}

.chain strong {
  color: var(--text-primary);
  font-weight: 600;
}

.step {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  display: grid;
  place-items: center;
  margin-top: 1px;
}

/* Each link says which file it rests on, so a reader can check one step without
   accepting the whole story. */
.src {
  display: block;
  font-size: 11px;
  font-style: normal;
  color: var(--text-muted);
  margin-top: 2px;
}

.evidence {
  margin-top: 20px;
  font-size: 12.5px;
}

.evidence summary {
  cursor: pointer;
  color: var(--text-secondary);
  font-weight: 600;
}

.evidence table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

.evidence th {
  text-align: left;
  font-weight: 500;
  color: var(--text-muted);
  font-size: 11px;
  padding: 4px 8px 4px 0;
  border-bottom: 1px solid var(--border);
}

.evidence td {
  padding: 5px 8px 5px 0;
  border-bottom: 1px solid var(--border);
}

.evidence .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.evidence .muted {
  color: var(--text-muted);
}

.footnote {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-muted);
  max-width: 84ch;
}

code {
  font-size: 0.94em;
  background: var(--surface-sunken);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>

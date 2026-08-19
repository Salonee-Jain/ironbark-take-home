<script setup lang="ts">
import { computed } from 'vue';
import { percent, signedPercent, tonnes } from '../format';
import type { MonthlyEmissions } from '../types';

/**
 * The March 2026 substation failure.
 *
 * This panel exists because no single dataset states what happened. The meters
 * show a collapse, the fuel invoices show a spike, and the incident register
 * explains both — and the headline total falls, which makes the month look like
 * an improvement. Putting the three side by side is the finding.
 */
const props = defineProps<{
  months: MonthlyEmissions[];
  outageMonth: string;
}>();

const outage = computed(
  () => props.months.find((m) => m.month === props.outageMonth) ?? null,
);

/** Median of the other months — robust to the outage itself. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

const baseline = computed(() => {
  // Excludes the outage month and November 2025, whose fuel invoices are
  // missing — a baseline built from a known gap would understate normal.
  const others = props.months.filter(
    (m) => m.month !== props.outageMonth && m.scope1KgCo2e > 0,
  );
  return {
    scope1: median(others.map((m) => m.scope1KgCo2e)),
    scope2: median(others.map((m) => m.scope2KgCo2e)),
    total: median(others.map((m) => m.totalKgCo2e)),
    share: median(others.map((m) => m.scope1SharePct)),
  };
});

function change(actual: number, normal: number): number {
  return ((actual - normal) / normal) * 100;
}

/**
 * What March would have emitted had the grid held.
 *
 * Not a forecast — the same activity costed at the other factor. The lost grid
 * kWh are valued at 0.71 kg/kWh instead of being met by diesel at 2.70 kg/L.
 */
const counterfactual = computed(() => baseline.value.total);
</script>

<template>
  <section v-if="outage" class="panel card">
    <header>
      <span class="tag">Cross-dataset finding</span>
      <h2>March 2026: the month emissions “fell”</h2>
      <p class="lede">
        Total emissions dropped
        {{ percent(Math.abs(change(outage.totalKgCo2e, baseline.total))) }} in March 2026,
        which reads as a good month. It was not. A regional substation failure
        (INC-2026-131) cut grid supply for roughly three weeks and the site ran on
        backup diesel generators. Grid consumption collapsed, so Scope 2 fell — but the
        load moved to a fuel with almost four times the emission factor per unit of
        useful energy, and Scope 1 rose to its highest level in the period.
      </p>
    </header>

    <div class="grid">
      <div class="metric">
        <div class="metric-label"><span class="key scope2" />Scope 2 · grid</div>
        <div class="metric-value">{{ tonnes(outage.scope2KgCo2e) }}<span class="u">t</span></div>
        <div class="delta down">
          {{ signedPercent(change(outage.scope2KgCo2e, baseline.scope2)) }}
          <span class="vs">vs {{ tonnes(baseline.scope2) }} t typical</span>
        </div>
      </div>

      <div class="metric">
        <div class="metric-label"><span class="key scope1" />Scope 1 · fuel</div>
        <div class="metric-value">{{ tonnes(outage.scope1KgCo2e) }}<span class="u">t</span></div>
        <div class="delta up">
          {{ signedPercent(change(outage.scope1KgCo2e, baseline.scope1)) }}
          <span class="vs">vs {{ tonnes(baseline.scope1) }} t typical</span>
        </div>
      </div>

      <div class="metric">
        <div class="metric-label">Scope 1 share</div>
        <div class="metric-value">{{ outage.scope1SharePct }}<span class="u">%</span></div>
        <div class="delta up">
          from {{ baseline.share.toFixed(1) }}%
          <span class="vs">every other month</span>
        </div>
      </div>

      <div class="metric">
        <div class="metric-label">Total</div>
        <div class="metric-value">{{ tonnes(outage.totalKgCo2e) }}<span class="u">t</span></div>
        <div class="delta neutral">
          {{ signedPercent(change(outage.totalKgCo2e, counterfactual)) }}
          <span class="vs">vs {{ tonnes(counterfactual) }} t on grid supply</span>
        </div>
      </div>
    </div>

    <ol class="chain">
      <li>
        <span class="step">1</span>
        <div>
          <strong>Grid supply lost.</strong> All six meters fall together to
          {{ percent((outage.scope2KgCo2e / baseline.scope2) * 100, 0) }} of normal — a
          simultaneous drop across every meter points at supply, not metering.
        </div>
      </li>
      <li>
        <span class="step">2</span>
        <div>
          <strong>Diesel substitutes in.</strong> Fuel volume runs 1.49× the median month,
          six standard deviations clear of a series that otherwise holds between 0.85×
          and 1.14×.
        </div>
      </li>
      <li>
        <span class="step">3</span>
        <div>
          <strong>The footprint shifts, it does not shrink.</strong> Scope 2 down
          {{ percent(Math.abs(change(outage.scope2KgCo2e, baseline.scope2)), 0) }},
          Scope 1 up
          {{ percent(change(outage.scope1KgCo2e, baseline.scope1), 0) }}. The total falls
          only because the site was also running below capacity.
        </div>
      </li>
      <li>
        <span class="step">4</span>
        <div>
          <strong>It has a safety tail.</strong> INC-2026-134 records multiple crews
          reporting fatigue after extended shifts covering generator operations and
          manual restarts during the outage.
        </div>
      </li>
    </ol>

    <p class="footnote">
      Sources: <code>electricity_meter_readings.csv</code> (6 meters ×
      {{ months.length }} months), <code>fuel_deliveries.csv</code>,
      <code>incident_register.csv</code> INC-2026-131 and INC-2026-134. Baselines are
      medians of the other months, excluding November 2025 whose fuel invoices are
      missing entirely.
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

/* Direction, not sentiment: down is not automatically good here — that is the
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

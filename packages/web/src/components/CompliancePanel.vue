<script setup lang="ts">
import { computed, ref } from 'vue';
import { monthLabelLong } from '../format';
import type { ComplianceSummary, ReportFact } from '../types';

/**
 * The AI-written period summary. Citations render as chips so a reader can open
 * the evidence behind any figure in one click; a citation nobody can follow is
 * decoration.
 */
const props = defineProps<{
  summary: ComplianceSummary;
  canGenerate: boolean;
  generating: boolean;
  generateError: string | null;
}>();

const emit = defineEmits<{ (event: 'generate'): void }>();

const report = computed(() => (props.summary.available ? props.summary : null));

const factsById = computed(() => {
  const map = new Map<string, ReportFact>();
  for (const fact of report.value?.facts ?? []) map.set(fact.id, fact);
  return map;
});

/** One open fact at a time, keyed by claim index so two claims can't fight over it. */
const openCitation = ref<string | null>(null);

function toggle(key: string): void {
  openCitation.value = openCitation.value === key ? null : key;
}

function factValue(fact: ReportFact): string {
  const value =
    typeof fact.value === 'number' ? fact.value.toLocaleString('en-AU') : fact.value;
  return fact.unit ? `${value} ${fact.unit}` : value;
}

const generatedOn = computed(() => {
  if (!report.value) return '';
  const date = new Date(report.value.generatedAt);
  return Number.isNaN(date.getTime())
    ? report.value.generatedAt
    : date.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
});

const cost = computed(() => {
  const usd = report.value?.usage?.estimatedCostUsd;
  return typeof usd === 'number' ? `~US$${usd.toFixed(3)}` : null;
});
</script>

<template>
  <section class="panel card">
    <header>
      <span class="tag">AI-generated · every claim cited</span>
      <h2 v-if="report">
        Compliance summary, {{ monthLabelLong(report.period.from) }} to
        {{ monthLabelLong(report.period.to) }}
      </h2>
      <h2 v-else>Compliance summary</h2>

      <p v-if="report" class="lede">
        Written by {{ report.model }} from a fact pack of {{ report.facts.length }}
        pre-computed figures and source records. The model selects and explains; it never
        calculates. Any sentence stating a number the cited facts do not contain is
        discarded before it reaches this page.
      </p>

      <div v-if="report" class="meta">
        <span>{{ report.provider }} · {{ report.model }}</span>
        <span>prompt {{ report.promptVersion }}</span>
        <span>generated {{ generatedOn }}</span>
        <span v-if="cost">{{ cost }}</span>
        <span v-if="report.source === 'cache-file'" class="cached">
          served from the committed artefact
        </span>
      </div>
    </header>

    <!-- Nothing generated yet. A workspace without a summary is a normal state,
         so this says what to do rather than reading as a failure. -->
    <div v-if="!report" class="empty">
      <p class="reason">{{ props.summary.available === false ? props.summary.reason : '' }}</p>
      <p class="hint">{{ props.summary.available === false ? props.summary.hint : '' }}</p>
    </div>

    <template v-else>
      <p v-if="report.verification.factsChanged" class="warning">
        {{ report.verification.note }}
      </p>

      <div class="sections">
        <div v-for="section in report.sections" :key="section.section" class="section">
          <h3>{{ section.section }}</h3>
          <ul>
            <li
              v-for="(claim, index) in section.claims"
              :key="`${section.section}-${index}`"
            >
              <p class="claim">{{ claim.text }}</p>
              <div class="citations">
                <button
                  v-for="id in claim.citations"
                  :key="id"
                  type="button"
                  class="chip"
                  :class="{ open: openCitation === `${section.section}-${index}-${id}` }"
                  :aria-expanded="openCitation === `${section.section}-${index}-${id}`"
                  @click="toggle(`${section.section}-${index}-${id}`)"
                >
                  {{ id }}
                </button>
              </div>

              <div
                v-for="id in claim.citations.filter(
                  (c) => openCitation === `${section.section}-${index}-${c}`,
                )"
                :key="`open-${id}`"
                class="evidence"
              >
                <template v-if="factsById.get(id)">
                  <p class="evidence-label">{{ factsById.get(id)!.label }}</p>
                  <p class="evidence-value">{{ factValue(factsById.get(id)!) }}</p>
                  <p v-if="factsById.get(id)!.detail" class="evidence-detail">
                    {{ factsById.get(id)!.detail }}
                  </p>
                  <p class="evidence-source">source: {{ factsById.get(id)!.source }}</p>
                </template>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <footer class="verification">
        <div class="counts">
          <span><strong>{{ report.verification.claimsShown }}</strong> claims shown</span>
          <span>
            <strong>{{ report.verification.claimsRejectedAtGeneration }}</strong>
            discarded by the citation gate when written
          </span>
          <span v-if="report.verification.claimsDroppedOnRead > 0">
            <strong>{{ report.verification.claimsDroppedOnRead }}</strong>
            dropped just now, against current figures
          </span>
        </div>

        <p class="note">{{ report.verification.note }}</p>

        <details v-if="report.rejectedAtGeneration.length > 0">
          <summary>
            What the gate refused ({{ report.rejectedAtGeneration.length }})
          </summary>
          <ul class="rejected">
            <li v-for="(rejection, index) in report.rejectedAtGeneration" :key="index">
              <p class="rejected-text">“{{ rejection.text }}”</p>
              <p class="rejected-reason">
                <code>{{ rejection.reason }}</code>: {{ rejection.detail }}
              </p>
            </li>
          </ul>
        </details>

        <details>
          <summary>The fact pack ({{ report.facts.length }} facts)</summary>
          <table>
            <thead>
              <tr><th>Id</th><th>Fact</th><th>Value</th><th>Source</th></tr>
            </thead>
            <tbody>
              <tr v-for="fact in report.facts" :key="fact.id">
                <td><code>{{ fact.id }}</code></td>
                <td>{{ fact.label }}</td>
                <td class="num">{{ factValue(fact) }}</td>
                <td class="muted">{{ fact.source }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </footer>
    </template>

    <div v-if="canGenerate" class="actions">
      <button type="button" :disabled="generating" @click="emit('generate')">
        {{ generating ? 'Generating…' : report ? 'Regenerate summary' : 'Generate summary' }}
      </button>
      <span class="actions-note">
        Calls the configured model once. Needs an API key on the server.
      </span>
      <p v-if="generateError" class="generate-error">{{ generateError }}</p>
    </div>
  </section>
</template>

<style scoped>
.panel { padding: 22px 24px; border-left: 3px solid var(--series-4); }

.tag {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--series-4);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

h2 { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 8px; }
.lede { max-width: 78ch; color: var(--text-secondary); font-size: 13.5px; }

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 12px;
  color: var(--text-muted);
  font-size: 11.5px;
}
.meta .cached { color: var(--text-secondary); }

.warning {
  margin-top: 16px;
  padding: 10px 13px;
  border-radius: 7px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-size: 12.5px;
}

.sections { display: grid; gap: 22px; margin: 22px 0; padding-top: 18px; border-top: 1px solid var(--border); }

h3 {
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.section ul { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.claim { max-width: 82ch; font-size: 13.5px; line-height: 1.55; }

.citations { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }

.chip {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  cursor: pointer;
}
.chip:hover { color: var(--text-primary); border-color: var(--text-muted); }
.chip.open { background: var(--series-4); border-color: var(--series-4); color: white; }

.evidence {
  margin-top: 8px;
  padding: 11px 13px;
  border-left: 2px solid var(--series-4);
  border-radius: 0 6px 6px 0;
  background: var(--surface-sunken);
  max-width: 82ch;
}
.evidence-label { color: var(--text-secondary); font-size: 11.5px; }
.evidence-value { margin-top: 2px; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.evidence-detail { margin-top: 6px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.evidence-source { margin-top: 6px; color: var(--text-muted); font-size: 11px; }

.verification { padding-top: 16px; border-top: 1px solid var(--border); }
.counts { display: flex; flex-wrap: wrap; gap: 18px; color: var(--text-secondary); font-size: 12px; }
.counts strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.note { margin-top: 8px; max-width: 84ch; color: var(--text-muted); font-size: 11.5px; }

details { margin-top: 14px; font-size: 12px; }
summary { color: var(--text-secondary); font-weight: 600; cursor: pointer; }

.rejected { display: grid; gap: 10px; margin: 10px 0 0; padding: 0; list-style: none; }
.rejected-text { max-width: 82ch; color: var(--text-secondary); font-size: 12.5px; }
.rejected-reason { margin-top: 2px; color: var(--text-muted); font-size: 11.5px; }

table { width: 100%; margin-top: 10px; border-collapse: collapse; }
th { padding: 4px 8px 4px 0; border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 11px; font-weight: 500; text-align: left; }
td { padding: 5px 8px 5px 0; border-bottom: 1px solid var(--border); font-size: 11.5px; vertical-align: top; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
td.muted { color: var(--text-muted); }

.empty { margin: 20px 0; }
.reason { font-size: 13.5px; }
.hint { margin-top: 6px; max-width: 80ch; color: var(--text-muted); font-size: 12.5px; }

.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border); }
.actions button {
  padding: 7px 13px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-1);
  color: var(--text-primary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.actions button:hover:not(:disabled) { background: var(--surface-sunken); }
.actions button:disabled { opacity: 0.6; cursor: default; }
.actions-note { color: var(--text-muted); font-size: 11.5px; }
.generate-error { flex-basis: 100%; color: var(--status-critical); font-size: 12px; }

code { padding: 1px 4px; border-radius: 3px; background: var(--surface-sunken); font-size: 0.94em; }
</style>

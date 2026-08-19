<script setup lang="ts">
import { computed, ref } from 'vue';
import { monthLabel, monthLabelLong } from '../format';
import type { MonthlyEmissions } from '../types';

/**
 * Scope 1 share of the monthly footprint.
 *
 * A separate chart rather than a second axis on the columns. A dual-axis plot
 * aligns two scales arbitrarily and invents a correlation the data does not
 * contain; two charts sharing an x-axis say the same thing honestly.
 *
 * One series, so no legend box — the title names what is plotted. Direct labels
 * are used sparingly: the outage point only.
 */
const props = defineProps<{
  months: MonthlyEmissions[];
  highlightMonth?: string;
}>();

const W = 900;
const H = 150;
const PAD = { top: 18, right: 16, bottom: 26, left: 52 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const ticks = [0, 25, 50, 75, 100];

const points = computed(() =>
  props.months.map((m, i) => ({
    ...m,
    cx: PAD.left + (plotW / Math.max(props.months.length - 1, 1)) * i,
    cy: PAD.top + plotH - (m.scope1SharePct / 100) * plotH,
  })),
);

const path = computed(() =>
  points.value.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.cx} ${p.cy}`).join(' '),
);

const hovered = ref<number | null>(null);
const active = computed(() =>
  hovered.value === null ? null : points.value[hovered.value] ?? null,
);

const bandWidth = computed(() => plotW / Math.max(props.months.length - 1, 1));

function y(value: number): number {
  return PAD.top + plotH - (value / 100) * plotH;
}
</script>

<template>
  <div class="chart">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Scope 1 share of monthly emissions">
      <g class="grid">
        <line
          v-for="tick in ticks"
          :key="tick"
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="y(tick)"
          :y2="y(tick)"
        />
      </g>
      <g class="axis-text">
        <text
          v-for="tick in ticks"
          :key="tick"
          :x="PAD.left - 10"
          :y="y(tick) + 4"
          text-anchor="end"
        >
          {{ tick }}%
        </text>
      </g>

      <path class="series" :d="path" fill="none" />

      <!-- markers carry a 2px surface ring so they stay legible on the line -->
      <g v-for="(p, i) in points" :key="p.month">
        <circle
          v-if="p.month === highlightMonth || hovered === i"
          class="dot"
          :cx="p.cx"
          :cy="p.cy"
          r="4.5"
        />
      </g>

      <text
        v-if="points.find((p) => p.month === highlightMonth)"
        class="point-label"
        :x="points.find((p) => p.month === highlightMonth)!.cx"
        :y="points.find((p) => p.month === highlightMonth)!.cy - 12"
        text-anchor="middle"
      >
        {{ points.find((p) => p.month === highlightMonth)!.scope1SharePct }}%
      </text>

      <g class="axis-text x">
        <text
          v-for="(p, i) in points"
          :key="`x-${p.month}`"
          :x="p.cx"
          :y="H - 8"
          text-anchor="middle"
          :class="{ emphasis: p.month === highlightMonth }"
        >
          {{ i % 2 === 0 || p.month === highlightMonth ? monthLabel(p.month) : '' }}
        </text>
      </g>

      <rect
        v-for="(p, i) in points"
        :key="`hit-${p.month}`"
        class="hit"
        :x="p.cx - bandWidth / 2"
        :y="PAD.top"
        :width="bandWidth"
        :height="plotH"
        tabindex="0"
        role="button"
        :aria-label="`${monthLabelLong(p.month)}: Scope 1 is ${p.scope1SharePct} percent of emissions`"
        @mouseenter="hovered = i"
        @mouseleave="hovered = null"
        @focus="hovered = i"
        @blur="hovered = null"
      />
    </svg>

    <div
      v-if="active"
      class="tooltip"
      :style="{
        left: `${(active.cx / W) * 100}%`,
        transform: active.cx / W > 0.8 ? 'translate(-100%, 0)' : 'translate(-50%, 0)',
      }"
    >
      <strong>{{ monthLabelLong(active.month) }}</strong>
      <span>{{ active.scope1SharePct }}% Scope 1</span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
}

svg {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}

.grid line {
  stroke: var(--gridline);
  stroke-width: 1;
}

.axis-text text {
  fill: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.axis-text.x text.emphasis {
  fill: var(--text-primary);
  font-weight: 600;
}

.series {
  stroke: var(--scope1);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.dot {
  fill: var(--scope1);
  stroke: var(--surface-1);
  stroke-width: 2;
}

.point-label {
  fill: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
}

.hit {
  fill: transparent;
  cursor: pointer;
}

.tooltip {
  position: absolute;
  top: 0;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 7px;
  box-shadow: 0 4px 16px rgba(11, 11, 11, 0.12);
  padding: 6px 10px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 2;
}

.tooltip span {
  color: var(--text-secondary);
}
</style>

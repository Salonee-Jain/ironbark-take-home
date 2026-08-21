<script setup lang="ts">
import { computed, ref } from 'vue';
import { count, monthLabelLong, monthLabel, tonnes } from '../format';
import type { MonthlyEmissions } from '../types';

/**
 * Monthly Scope 1 / Scope 2 columns. Hand-built SVG so the mark specs are exact.
 * Scope 2 sits at the base because it is the stable series; Scope 1 rides on top
 * because it is the one that moves.
 */
const props = defineProps<{
  months: MonthlyEmissions[];
  /**
   * Month to annotate, e.g. the outage. Null when the analysis found
   * nothing to annotate, the caller passes a detection result, not a guess.
   */
  highlightMonth?: string | null;
  highlightNote?: string;
}>();

const W = 900;
const H = 310;
// Extra top padding reserves a lane for the annotation. Placed over the plot it
// collided with the neighbouring column, which is the exact failure the mark
// specs warn about, a label must never be clipped by or overlap another mark.
const PAD = { top: 30, right: 16, bottom: 34, left: 52 };

const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const MAX_BAR = 24;
const SEGMENT_GAP = 2;

const maxTotal = computed(() =>
  Math.max(...props.months.map((m) => m.totalKgCo2e), 0),
);

/** Round the axis top to a clean tonne figure. */
const axisTop = computed(() => {
  const t = maxTotal.value / 1000;
  if (t <= 0) return 1000;
  const step = t > 2000 ? 1000 : 500;
  return Math.ceil(t / step) * step * 1000;
});

const ticks = computed(() => {
  const topT = axisTop.value / 1000;
  const stepT = topT / 4;
  return Array.from({ length: 5 }, (_, i) => i * stepT * 1000);
});

const band = computed(() => plotW / Math.max(props.months.length, 1));
const barW = computed(() => Math.min(MAX_BAR, band.value * 0.55));

function x(index: number): number {
  return PAD.left + band.value * index + band.value / 2 - barW.value / 2;
}

function y(value: number): number {
  return PAD.top + plotH - (value / axisTop.value) * plotH;
}

function h(value: number): number {
  return (value / axisTop.value) * plotH;
}

/** Rect with only the top corners rounded, the data end, square at the base. */
function topRoundedPath(
  px: number,
  py: number,
  width: number,
  height: number,
  radius = 4,
): string {
  const r = Math.min(radius, height, width / 2);
  return [
    `M ${px} ${py + height}`,
    `L ${px} ${py + r}`,
    `Q ${px} ${py} ${px + r} ${py}`,
    `L ${px + width - r} ${py}`,
    `Q ${px + width} ${py} ${px + width} ${py + r}`,
    `L ${px + width} ${py + height}`,
    'Z',
  ].join(' ');
}

const hovered = ref<number | null>(null);
const active = computed(() =>
  hovered.value === null ? null : props.months[hovered.value] ?? null,
);

const highlightIndex = computed(() =>
  props.highlightMonth
    ? props.months.findIndex((m) => m.month === props.highlightMonth)
    : -1,
);

/** Tooltip anchor, flipped near the right edge so it never leaves the card. */
const tooltipStyle = computed(() => {
  if (hovered.value === null) return {};
  const centre = (x(hovered.value) + barW.value / 2) / W;
  return {
    left: `${centre * 100}%`,
    transform: centre > 0.72 ? 'translate(-100%, 0)' : 'translate(-50%, 0)',
  };
});
</script>

<template>
  <div class="chart">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`Monthly emissions by scope, ${months.length} months`">
      <!-- gridlines: solid hairlines, one step off the surface -->
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

      <!-- y axis ticks, tabular figures so they align vertically -->
      <g class="axis-text y">
        <text
          v-for="tick in ticks"
          :key="tick"
          :x="PAD.left - 10"
          :y="y(tick) + 4"
          text-anchor="end"
        >
          {{ count(Math.round(tick / 1000)) }}
        </text>
      </g>

      <!-- outage band, drawn under the marks -->
      <rect
        v-if="highlightIndex >= 0"
        class="highlight-band"
        :x="PAD.left + band * highlightIndex"
        :y="PAD.top"
        :width="band"
        :height="plotH"
      />

      <g v-for="(m, i) in months" :key="m.month">
        <!-- Scope 2 at the base: square bottom, and 2px shorter so the surface
             gap separates it from Scope 1 above. -->
        <rect
          class="seg scope2"
          :x="x(i)"
          :y="y(m.scope2KgCo2e)"
          :width="barW"
          :height="Math.max(h(m.scope2KgCo2e) - SEGMENT_GAP, 0)"
          :opacity="hovered === null || hovered === i ? 1 : 0.45"
        />
        <!-- Scope 1 on top: carries the 4px rounded data end. -->
        <path
          v-if="m.scope1KgCo2e > 0"
          class="seg scope1"
          :d="
            topRoundedPath(
              x(i),
              y(m.totalKgCo2e),
              barW,
              h(m.scope1KgCo2e),
            )
          "
          :opacity="hovered === null || hovered === i ? 1 : 0.45"
        />
      </g>

      <!-- x axis -->
      <line
        class="baseline"
        :x1="PAD.left"
        :x2="W - PAD.right"
        :y1="PAD.top + plotH"
        :y2="PAD.top + plotH"
      />
      <g class="axis-text x">
        <text
          v-for="(m, i) in months"
          :key="m.month"
          :x="x(i) + barW / 2"
          :y="H - 14"
          text-anchor="middle"
          :class="{ emphasis: m.month === highlightMonth }"
        >
          {{ monthLabel(m.month) }}
        </text>
      </g>

      <!-- One selective direct label, on the month the story is about. It sits
           in the reserved lane above the plot with a leader line down to its
           column, so it can never overlap a mark however tall the columns get. -->
      <g v-if="highlightIndex >= 0 && highlightNote" class="callout">
        <line
          :x1="x(highlightIndex) + barW / 2"
          :x2="x(highlightIndex) + barW / 2"
          :y1="PAD.top - 12"
          :y2="y(months[highlightIndex]!.totalKgCo2e) - 4"
        />
        <text
          :x="x(highlightIndex) + barW / 2"
          :y="PAD.top - 17"
          text-anchor="middle"
        >
          {{ highlightNote }}
        </text>
      </g>

      <!-- hit targets: full band width, so hovering never needs precision -->
      <rect
        v-for="(m, i) in months"
        :key="`hit-${m.month}`"
        class="hit"
        :x="PAD.left + band * i"
        :y="PAD.top"
        :width="band"
        :height="plotH"
        tabindex="0"
        role="button"
        :aria-label="`${monthLabelLong(m.month)}: Scope 1 ${tonnes(m.scope1KgCo2e)} tonnes, Scope 2 ${tonnes(m.scope2KgCo2e)} tonnes`"
        @mouseenter="hovered = i"
        @mouseleave="hovered = null"
        @focus="hovered = i"
        @blur="hovered = null"
      />
    </svg>

    <div v-if="active" class="tooltip" :style="tooltipStyle">
      <div class="tt-title">{{ monthLabelLong(active.month) }}</div>
      <dl>
        <div>
          <dt><span class="key scope1" />Scope 1</dt>
          <dd>{{ tonnes(active.scope1KgCo2e) }} t</dd>
        </div>
        <div>
          <dt><span class="key scope2" />Scope 2</dt>
          <dd>{{ tonnes(active.scope2KgCo2e) }} t</dd>
        </div>
        <div class="total">
          <dt>Total</dt>
          <dd>{{ tonnes(active.totalKgCo2e) }} t</dd>
        </div>
        <div class="meta">
          <dt>Scope 1 share</dt>
          <dd>{{ active.scope1SharePct }}%</dd>
        </div>
      </dl>
      <p class="tt-note">
        {{ active.contributingRecords }} source records<span
          v-if="active.qualityErrorCount > 0"
        >
          · {{ active.qualityErrorCount }} corrected</span
        >
      </p>
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

.baseline {
  stroke: var(--baseline);
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

.seg {
  transition: opacity 0.12s ease;
}

.scope1 {
  fill: var(--scope1);
}

.scope2 {
  fill: var(--scope2);
}

.highlight-band {
  fill: var(--surface-sunken);
}

.callout text {
  fill: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
}

.callout line {
  stroke: var(--baseline);
  stroke-width: 1;
}

.hit {
  fill: transparent;
  cursor: pointer;
}

.tooltip {
  position: absolute;
  top: 8px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(11, 11, 11, 0.12);
  padding: 10px 12px;
  min-width: 178px;
  pointer-events: none;
  z-index: 2;
}

.tt-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 7px;
}

dl {
  margin: 0;
  display: grid;
  gap: 3px;
  font-size: 12px;
}

dl > div {
  display: flex;
  justify-content: space-between;
  gap: 18px;
}

dt {
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.total {
  border-top: 1px solid var(--border);
  margin-top: 4px;
  padding-top: 4px;
}

.meta dt,
.meta dd {
  color: var(--text-muted);
  font-weight: 400;
}

.key {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
}

.key.scope1 {
  background: var(--scope1);
}

.key.scope2 {
  background: var(--scope2);
}

.tt-note {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 7px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * Horizontal bars for a ranked list.
 *
 * One series, so one colour for every bar — darkening the bigger bars would
 * double-encode length as hue and burn the only free channel on information the
 * bar length already carries.
 */
const props = defineProps<{
  items: { label: string; value: number; note?: string }[];
  color?: string;
  /** Suffix on the value label, e.g. ' t'. */
  unit?: string;
}>();

const max = computed(() => Math.max(...props.items.map((i) => i.value), 1));

function width(value: number): string {
  return `${Math.max((value / max.value) * 100, 1.5)}%`;
}
</script>

<template>
  <ul class="bars">
    <li v-for="item in items" :key="item.label">
      <div class="row">
        <span class="label">{{ item.label }}</span>
        <span class="value">
          {{ item.value.toLocaleString('en-AU') }}<template v-if="unit">{{ unit }}</template>
        </span>
      </div>
      <div class="track">
        <div
          class="fill"
          :style="{ width: width(item.value), background: color ?? 'var(--scope2)' }"
        />
      </div>
      <p v-if="item.note" class="note">{{ item.note }}</p>
    </li>
  </ul>
</template>

<style scoped>
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 13px;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 5px;
}

.label {
  font-size: 12.5px;
  color: var(--text-primary);
}

.value {
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  flex: none;
}

.track {
  height: 8px;
  background: var(--surface-sunken);
  border-radius: 4px;
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 4px;
}

.note {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 4px;
}
</style>

<script setup lang="ts">
/**
 * Stat tile: label, value, optional unit and note.
 *
 * Proportional figures on the value — `tabular-nums` gives every digit the
 * width of a zero, which makes a number look loose at display sizes. Tabular
 * is for columns that align vertically, not for a headline.
 */
defineProps<{
  label: string;
  value: string;
  unit?: string;
  note?: string;
  /** Colour key rendered as a small mark beside the label, never as text. */
  swatch?: string;
  /** Renders larger. Exactly one per view. */
  hero?: boolean;
}>();
</script>

<template>
  <div class="tile card" :class="{ hero }">
    <div class="label">
      <span v-if="swatch" class="swatch" :style="{ background: swatch }" />
      {{ label }}
    </div>
    <div class="value">
      {{ value }}<span v-if="unit" class="unit">{{ unit }}</span>
    </div>
    <div v-if="note" class="note">{{ note }}</div>
  </div>
</template>

<style scoped>
.tile {
  min-height: 104px;
  padding: 14px 15px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.label {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 7px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}

.value {
  font-size: 23px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.hero .value {
  font-size: 27px;
}

.unit {
  font-size: 0.5em;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: 5px;
}

.note {
  color: var(--text-muted);
  font-size: 12px;
  margin-top: auto;
}
</style>

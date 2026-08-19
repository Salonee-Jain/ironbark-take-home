<script setup lang="ts">
import { ref } from 'vue';

/**
 * The shell every chart sits in: title, subtitle, legend, and a chart/table
 * toggle.
 *
 * The table view is not a nicety. A tooltip must never be the only way to read
 * a value, and colour must never be the only encoding — the table is the
 * WCAG-clean twin that guarantees both.
 */
defineProps<{
  title: string;
  subtitle?: string;
  /** Series keys shown in the legend. Always present for two or more series. */
  legend?: { label: string; color: string }[];
}>();

const view = ref<'chart' | 'table'>('chart');
</script>

<template>
  <section class="frame card">
    <header>
      <div class="titles">
        <h2>{{ title }}</h2>
        <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      </div>

      <div class="controls">
        <ul v-if="legend && legend.length > 1" class="legend">
          <li v-for="entry in legend" :key="entry.label">
            <span class="key" :style="{ background: entry.color }" />
            {{ entry.label }}
          </li>
        </ul>

        <div class="toggle" role="group" aria-label="View as">
          <button
            type="button"
            :aria-pressed="view === 'chart'"
            :class="{ on: view === 'chart' }"
            @click="view = 'chart'"
          >
            Chart
          </button>
          <button
            type="button"
            :aria-pressed="view === 'table'"
            :class="{ on: view === 'table' }"
            @click="view = 'table'"
          >
            Table
          </button>
        </div>
      </div>
    </header>

    <div class="body">
      <slot v-if="view === 'chart'" />
      <div v-else class="table-wrap"><slot name="table" /></div>
    </div>
  </section>
</template>

<style scoped>
.frame {
  padding: 18px 20px 20px;
  min-width: 0;
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

h2 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 12.5px;
  margin-top: 3px;
  max-width: 62ch;
}

.controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.legend {
  display: flex;
  gap: 14px;
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.key {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}

.toggle {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 7px;
  overflow: hidden;
}

.toggle button {
  font: inherit;
  font-size: 11.5px;
  padding: 3px 10px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.toggle button.on {
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-weight: 500;
}

/* Wide tables scroll inside the card; the page never scrolls sideways. */
.table-wrap {
  overflow-x: auto;
}

@media (max-width: 720px) {
  .frame {
    padding: 16px;
  }

  header {
    margin-bottom: 14px;
  }

  .controls {
    width: 100%;
    justify-content: space-between;
    gap: 10px;
  }

  .legend {
    gap: 10px;
    font-size: 11.5px;
  }

  .toggle button {
    padding: 4px 9px;
  }
}

@media (max-width: 390px) {
  .controls {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

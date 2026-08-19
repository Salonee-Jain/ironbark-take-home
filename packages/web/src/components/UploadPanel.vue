<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, ApiError } from '../api/client';
import type { UploadResult } from '../types';

const emit = defineEmits<{ complete: [result: UploadResult] }>();

const requirements = [
  ['emissionFactors', 'Emission factors', 'emission_factors.csv'],
  ['fuelDeliveries', 'Fuel deliveries', 'fuel_deliveries.csv'],
  ['electricityReadings', 'Electricity readings', 'electricity_meter_readings.csv'],
  ['incidentRegister', 'Incident register', 'incident_register.csv'],
  ['suppliers', 'Suppliers', 'suppliers.csv'],
] as const;

const selected = ref<Record<string, File>>({});
const busy = ref(false);
const error = ref<string | null>(null);
const result = ref<UploadResult | null>(null);
const ready = computed(() => requirements.every(([field]) => selected.value[field]));

function select(field: string, event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) selected.value = { ...selected.value, [field]: file };
}

async function submit(): Promise<void> {
  if (!ready.value) return;
  busy.value = true;
  error.value = null;
  result.value = null;
  try {
    result.value = await api.uploadDataset(selected.value);
    emit('complete', result.value);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'The upload could not be completed.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="upload card">
    <header>
      <div>
        <p class="eyebrow">Data management</p>
        <h2>Replace your dataset</h2>
        <p class="subtitle">
          Upload all five source CSVs together. The new load is validated before it replaces the current dataset.
        </p>
      </div>
      <span class="replace-note">Owner only</span>
    </header>

    <div class="warning">
      <strong>This replaces the current dataset.</strong> If a file fails validation, nothing changes.
    </div>

    <form @submit.prevent="submit">
      <label v-for="[field, label, expected] in requirements" :key="field" class="file-row">
        <span class="file-icon">↑</span>
        <span class="file-copy"><strong>{{ label }}</strong><small>{{ selected[field]?.name ?? `CSV · e.g. ${expected}` }}</small></span>
        <span class="choose">Choose file<input type="file" accept=".csv,text/csv" @change="select(field, $event)" /></span>
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="result" class="success" role="status">
        Dataset replaced. {{ result.load.issueCount }} quality findings were recorded.
      </div>
      <button type="submit" :disabled="!ready || busy">{{ busy ? 'Validating & uploading…' : 'Upload and replace dataset' }}</button>
    </form>
  </section>
</template>

<style scoped>
.upload { max-width: 880px; padding: 26px; }
header { display: flex; justify-content: space-between; gap: 16px; }
.eyebrow { color: var(--scope2); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h2 { margin-top: 4px; font-size: 24px; letter-spacing: -.025em; }
.subtitle { color: var(--text-secondary); margin-top: 6px; max-width: 62ch; }
.replace-note { height: fit-content; padding: 3px 8px; background: var(--surface-sunken); border-radius: 20px; color: var(--text-secondary); font-size: 11px; font-weight: 600; }
.warning { margin: 22px 0 16px; padding: 10px 12px; border-left: 3px solid var(--status-warning); background: var(--surface-sunken); color: var(--text-secondary); font-size: 12.5px; }
.warning strong { color: var(--text-primary); }
form { display: grid; gap: 9px; }
.file-row { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 12px; border: 1px dashed var(--border); border-radius: 8px; cursor: pointer; }
.file-row:hover { border-color: var(--scope2); background: var(--surface-sunken); }
.file-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; background: color-mix(in srgb, var(--scope2) 14%, transparent); color: var(--scope2); font-weight: 700; }
.file-copy { display: grid; gap: 1px; min-width: 0; flex: 1; font-size: 12.5px; }
.file-copy small { overflow: hidden; color: var(--text-muted); text-overflow: ellipsis; white-space: nowrap; }
.choose { position: relative; overflow: hidden; padding: 5px 8px; border: 1px solid var(--border); border-radius: 5px; color: var(--text-secondary); font-size: 11.5px; font-weight: 600; }
.choose input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
button { justify-self: start; margin-top: 10px; padding: 10px 14px; border: 0; border-radius: 6px; background: var(--scope2); color: white; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
.error { color: var(--status-critical); font-size: 12px; }.success { color: var(--status-good); font-size: 12px; font-weight: 600; }
@media (max-width: 560px) { .upload { padding: 18px; } header { display: grid; }.file-row { gap: 9px; }.choose { flex: none; } }
</style>

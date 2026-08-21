<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from './api/client';
import BarList from './components/BarList.vue';
import ChartFrame from './components/ChartFrame.vue';
import CompliancePanel from './components/CompliancePanel.vue';
import DataQualityPanel from './components/DataQualityPanel.vue';
import LoginPanel from './components/LoginPanel.vue';
import UploadPanel from './components/UploadPanel.vue';
import OutagePanel from './components/OutagePanel.vue';
import SafetyPanel from './components/SafetyPanel.vue';
import ShareLineChart from './components/ShareLineChart.vue';
import StackedColumnChart from './components/StackedColumnChart.vue';
import StatTile from './components/StatTile.vue';
import { count, monthLabelLong, percent, tonnes } from './format';
import type {
  ComplianceSummary,
  DataQualityIssue,
  DataQualityOverview,
  EmissionsSummary,
  Incident,
  IncidentTrends,
  MonthlyEmissions,
  OutageAnalysis,
  SiteArea,
  UserProfile,
} from './types';

/**
 * The outage month is no longer a constant here.
 *
 * It used to be `'2026-03'`, hard-coded from having read the data. The API now
 * detects it, so the dashboard annotates whatever month the analysis actually
 * finds — and annotates nothing when there is nothing to find, which is what a
 * newly signed-up company should see.
 */
const outage = ref<OutageAnalysis | null>(null);
const outageMonth = computed(() =>
  outage.value?.detected ? outage.value.month : null,
);

const loading = ref(true);
const error = ref<ApiError | null>(null);
const loginError = ref<string | null>(null);
const signingIn = ref(false);
const profile = ref<UserProfile | null>(null);
const section = ref<
  'overview' | 'emissions' | 'safety' | 'quality' | 'report' | 'upload'
>('overview');

const months = ref<MonthlyEmissions[]>([]);
const summary = ref<EmissionsSummary | null>(null);
const siteAreas = ref<SiteArea[]>([]);
const incidents = ref<Incident[]>([]);
const trends = ref<IncidentTrends | null>(null);
const dq = ref<DataQualityOverview | null>(null);
const dqIssues = ref<DataQualityIssue[]>([]);
const compliance = ref<ComplianceSummary | null>(null);
const generatingReport = ref(false);
const reportError = ref<string | null>(null);

const theme = ref<'light' | 'dark'>('light');

function applyTheme(next: 'light' | 'dark'): void {
  theme.value = next;
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ironbark-theme', next);
}

function toggleTheme(): void {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark');
}

/** The complete financial year — the unit an NGER report is filed against. */
const completeFy = computed(
  () => summary.value?.financialYears.find((fy) => fy.isCompleteYear) ?? null,
);

const fuelBySiteArea = computed(() => {
  const totals = new Map<string, number>();
  for (const row of siteAreas.value) {
    totals.set(row.siteArea, (totals.get(row.siteArea) ?? 0) + row.kgCo2e);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, kg]) => ({ label, value: Math.round(kg / 1000) }));
});

const errorIssues = computed(
  () => dq.value?.bySeverity.find((s) => s.key === 'error')?.issueCount ?? 0,
);

async function loadDashboard(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    profile.value = await api.me();
    const [m, s, sa, inc, tr, q, qi, og, cs] = await Promise.all([
      api.monthlyEmissions(),
      api.summary(),
      api.bySiteArea(),
      api.incidents(),
      api.incidentTrends(),
      api.dataQuality(),
      api.dataQualityIssues('?limit=500'),
      api.outageAnalysis(),
      api.complianceSummary(),
    ]);
    months.value = m.months;
    summary.value = s;
    siteAreas.value = sa.siteAreas;
    incidents.value = inc.incidents;
    trends.value = tr;
    dq.value = q;
    dqIssues.value = qi.issues;
    outage.value = og;
    compliance.value = cs;
  } catch (e) {
    error.value = e instanceof ApiError ? e : new ApiError(0, String(e));
  } finally {
    loading.value = false;
  }
}

async function signIn(email: string, password: string): Promise<void> {
  signingIn.value = true;
  loginError.value = null;
  try {
    await api.login(email, password);
    await loadDashboard();
  } catch (e) {
    loginError.value = e instanceof ApiError ? e.message : 'Unable to sign in.';
  } finally {
    signingIn.value = false;
  }
}

async function signOut(): Promise<void> {
  await api.logout();
  profile.value = null;
  section.value = 'overview';
  summary.value = null;
  trends.value = null;
  dq.value = null;
  error.value = new ApiError(401, 'You are not signed in.');
}

/**
 * The one action in this app that spends money, so it is explicit, owner-only,
 * and reports its own failure rather than silently leaving the old summary up.
 */
async function generateComplianceSummary(): Promise<void> {
  generatingReport.value = true;
  reportError.value = null;
  try {
    compliance.value = await api.generateComplianceSummary();
  } catch (e) {
    reportError.value =
      e instanceof ApiError
        ? [e.message, e.hint].filter(Boolean).join(' ')
        : 'Could not generate the summary.';
  } finally {
    generatingReport.value = false;
  }
}

function handleUploadComplete(): void {
  section.value = 'overview';
  void loadDashboard();
}

onMounted(() => {
  // A query-string preference wins over the stored choice, which keeps shared
  // screenshots predictable without adding a third setting to the UI.
  const requested = new URLSearchParams(window.location.search).get('theme');
  const saved = localStorage.getItem('ironbark-theme');

  if (requested === 'light' || requested === 'dark') applyTheme(requested);
  else if (saved === 'light' || saved === 'dark') applyTheme(saved);
  else applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  void loadDashboard();
});
</script>

<template>
  <div class="page">
    <header class="masthead">
      <div>
        <p class="eyebrow">Ironbark Ridge Resources · Central Queensland</p>
        <h1>Operations ESG Overview</h1>
        <p v-if="summary" class="period">
          {{ monthLabelLong(summary.period.firstMonth ?? '') }} —
          {{ monthLabelLong(summary.period.lastMonth ?? '') }}
          <span class="dot">·</span> {{ summary.period.months }} months
        </p>
      </div>

      <div class="head-actions">
      <div v-if="profile" class="user-menu">
        <span class="avatar" aria-hidden="true">{{ profile.user.displayName.slice(0, 1) }}</span>
        <span class="user-name">{{ profile.user.displayName }}</span>
        <button type="button" class="logout" @click="signOut">Log out</button>
      </div>
      <button
        type="button"
        class="theme-toggle"
        :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
        :title="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
        @click="toggleTheme"
      >
        <svg v-if="theme === 'dark'" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.6 15.2A8.5 8.5 0 0 1 8.8 3.4 8.5 8.5 0 1 0 20.6 15.2Z" />
        </svg>
        </button>
      </div>
    </header>

    <div v-if="loading" class="state loading-state" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true" />
      Loading dashboard data…
    </div>

    <LoginPanel
      v-else-if="error?.status === 401"
      :busy="signingIn"
      :error="loginError"
      @submit="signIn"
    />

    <div v-else-if="error" class="state error card">
      <h2>{{ error.message }}</h2>
      <p v-if="error.hint">{{ error.hint }}</p>
      <button type="button" class="retry" @click="loadDashboard">Try again</button>
    </div>

    <main v-else-if="summary && trends && dq">
      <nav class="workspace-nav" aria-label="Workspace sections">
        <p class="nav-label">Workspace</p>
        <button type="button" :class="{ active: section === 'overview' }" @click="section = 'overview'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>
          Overview
        </button>
        <button type="button" :class="{ active: section === 'emissions' }" @click="section = 'emissions'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m5 10V5m5 14v-8m5 8V3" /></svg>
          Emissions
        </button>
        <button type="button" :class="{ active: section === 'safety' }" @click="section = 'safety'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-3Zm-3.2 9 2.1 2.1 4.5-4.6" /></svg>
          Safety
        </button>
        <button type="button" :class="{ active: section === 'quality' }" @click="section = 'quality'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" /></svg>
          Data quality
        </button>
        <button type="button" :class="{ active: section === 'report' }" @click="section = 'report'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4" /></svg>
          Summary
        </button>
        <button
          v-if="profile?.user.role === 'owner'"
          type="button"
          :class="{ active: section === 'upload' }"
          @click="section = 'upload'"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m0 0 4 4m-4-4-4 4M4 15v5h16v-5" /></svg>
          Upload data
        </button>
        <div class="nav-footer">
          <span class="company-name">{{ profile?.company.name }}</span>
          <span>Reporting workspace</span>
        </div>
      </nav>

      <div class="workspace-content">
      <UploadPanel v-if="section === 'upload'" @complete="handleUploadComplete" />

      <template v-else-if="section === 'overview'">
      <!-- Headline. Exactly one hero figure in the view. -->
      <section class="kpis">
        <StatTile
          hero
          label="FY2026 total emissions"
          :value="tonnes(completeFy?.totalKgCo2e ?? 0)"
          unit="t CO₂e"
          :note="
            completeFy
              ? `Complete financial year · Jul 2025 – Jun 2026`
              : 'No complete financial year in this export'
          "
        />
        <StatTile
          label="Scope 1 · fuel combustion"
          swatch="var(--scope1)"
          :value="tonnes(completeFy?.scope1KgCo2e ?? 0)"
          unit="t"
          :note="`${percent(((completeFy?.scope1KgCo2e ?? 0) / (completeFy?.totalKgCo2e ?? 1)) * 100)} of FY2026`"
        />
        <StatTile
          label="Scope 2 · grid electricity"
          swatch="var(--scope2)"
          :value="tonnes(completeFy?.scope2KgCo2e ?? 0)"
          unit="t"
          :note="`${percent(((completeFy?.scope2KgCo2e ?? 0) / (completeFy?.totalKgCo2e ?? 1)) * 100)} of FY2026`"
        />
        <StatTile
          label="Scope 3 · indirect value chain"
          value="Not calculable"
          note="No spend-based factor supplied"
        />
      </section>

      <p v-if="!summary.intensity.available" class="intensity-note">
        <strong>Emissions intensity is not reported.</strong>
        {{ summary.intensity.reason }}
      </p>

      <!-- The overview intentionally stops after the primary decision signal. -->
      <section class="overview-visuals">
      <ChartFrame
        title="Monthly emissions by scope"
        subtitle="Tonnes CO₂e, computed from cleaned activity data and the supplied emission factors. November 2025 has no Scope 1 because the month's fuel invoices are missing from the export."
        :legend="[
          { label: 'Scope 1 · fuel', color: 'var(--scope1)' },
          { label: 'Scope 2 · electricity', color: 'var(--scope2)' },
        ]"
      >
        <StackedColumnChart
          :months="months"
          :highlight-month="outageMonth"
          highlight-note="substation failure"
        />
        <template #table>
          <table class="data">
            <thead>
              <tr>
                <th>Month</th><th>Scope 1 (t)</th><th>Scope 2 (t)</th>
                <th>Total (t)</th><th>Scope 1 share</th><th>Records</th><th>Corrected</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in months" :key="m.month">
                <td>{{ monthLabelLong(m.month) }}</td>
                <td class="num">{{ tonnes(m.scope1KgCo2e, 1) }}</td>
                <td class="num">{{ tonnes(m.scope2KgCo2e, 1) }}</td>
                <td class="num">{{ tonnes(m.totalKgCo2e, 1) }}</td>
                <td class="num">{{ m.scope1SharePct }}%</td>
                <td class="num">{{ m.contributingRecords }}</td>
                <td class="num">{{ m.qualityErrorCount }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </ChartFrame>

      <aside class="overview-status card" aria-labelledby="quality-summary-title">
        <div>
          <p class="panel-kicker">Dataset status</p>
          <h2 id="quality-summary-title">Data quality summary</h2>
          <p class="panel-subtitle">Current validation and reporting readiness.</p>
        </div>
        <ul>
          <li><span>Fuel deliveries</span><strong class="good">Complete</strong></li>
          <li><span>Electricity readings</span><strong class="good">Complete</strong></li>
          <li><span>Safety register</span><strong :class="errorIssues > 0 ? 'attention' : 'good'">{{ errorIssues > 0 ? `${errorIssues} to review` : 'Complete' }}</strong></li>
          <li><span>Rules triggered</span><strong>{{ dq.totals.rulesTriggered }}</strong></li>
        </ul>
        <button type="button" @click="section = 'quality'">Review findings</button>
      </aside>
      </section>

      </template>

      <template v-if="section === 'emissions'">
      <ChartFrame
        title="Scope 1 share of the monthly footprint"
        subtitle="Shown as its own chart rather than a second axis on the columns — two y-scales on one plot align arbitrarily and invent a correlation the data does not contain."
      >
        <ShareLineChart :months="months" :highlight-month="outageMonth" />
        <template #table>
          <table class="data">
            <thead><tr><th>Month</th><th>Scope 1 share</th><th>Month on month</th></tr></thead>
            <tbody>
              <tr v-for="m in months" :key="m.month">
                <td>{{ monthLabelLong(m.month) }}</td>
                <td class="num">{{ m.scope1SharePct }}%</td>
                <td class="num">{{ percent(m.monthOnMonthPct) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </ChartFrame>

      <ChartFrame
        title="Scope 1 by site area"
        subtitle="Scope 1 only. The electricity meters are described by function and never mapped to the site-area vocabulary in the source, so a Scope 2 breakdown would be our guesswork."
      >
        <BarList :items="fuelBySiteArea" color="var(--scope1)" unit=" t" />
        <template #table>
          <table class="data">
            <thead><tr><th>Site area</th><th>Fuel</th><th>Litres</th><th>t CO₂e</th><th>Deliveries</th></tr></thead>
            <tbody>
              <tr v-for="row in siteAreas" :key="`${row.siteArea}-${row.fuelType}`">
                <td>{{ row.siteArea }}</td>
                <td>{{ row.fuelType }}</td>
                <td class="num">{{ count(Math.round(row.litres)) }}</td>
                <td class="num">{{ tonnes(row.kgCo2e, 1) }}</td>
                <td class="num">{{ row.deliveryCount }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </ChartFrame>

      <OutagePanel v-if="outage" :analysis="outage" />
      </template>

      <template v-if="section === 'safety'">
      <SafetyPanel :trends="trends" :incidents="incidents" />
      </template>

      <template v-if="section === 'quality'">
      <DataQualityPanel :overview="dq" :issues="dqIssues" />
      </template>

      <template v-if="section === 'report' && compliance">
      <CompliancePanel
        :summary="compliance"
        :can-generate="profile?.user.role === 'owner'"
        :generating="generatingReport"
        :generate-error="reportError"
        @generate="generateComplianceSummary"
      />
      </template>

      <template v-if="section !== 'upload'">
      <footer>
        Every figure is computed from cleaned source records. Corrections keep the
        original value alongside them, so any number here can be traced to the cell it
        came from — see the data-quality findings above.
      </footer>
      </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 24px 64px;
}

.masthead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 0 2px 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--border);
}

.head-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.user-menu { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 12px; }
.avatar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--series-4); color: white; font-size: 11px; font-weight: 700; }
.user-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.logout { padding: 3px 0; border: 0; border-bottom: 1px solid var(--border); background: none; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.logout:hover { color: var(--text-primary); border-color: var(--text-primary); }

.eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
}

h1 {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.025em;
  margin-top: 4px;
}

.period {
  color: var(--text-secondary);
  font-size: 13px;
  margin-top: 4px;
}

.dot {
  color: var(--text-muted);
  margin: 0 4px;
}

.theme-toggle {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-1);
  color: var(--text-secondary);
  cursor: pointer;
}

.theme-toggle:hover {
  background: var(--surface-sunken);
  color: var(--text-primary);
}

.theme-toggle svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

main {
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  gap: 24px;
}

.workspace-nav { position: sticky; top: 16px; display: flex; align-self: start; flex-direction: column; gap: 4px; min-height: min(680px, calc(100vh - 120px)); padding: 18px 10px; background: var(--sidebar); border-radius: 5px; box-shadow: none; }
.nav-label { padding: 2px 11px 9px; color: var(--sidebar-muted); font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.workspace-nav button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 11px; border: 0; border-left: 2px solid transparent; border-radius: 6px; background: none; color: var(--sidebar-text); font: inherit; font-size: 12.5px; font-weight: 600; text-align: left; cursor: pointer; }
.workspace-nav button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.workspace-nav button:hover { background: var(--sidebar-hover); color: white; }
.workspace-nav button.active { border-left-color: var(--sidebar-active); background: var(--sidebar-hover); color: white; }
.nav-footer { display: grid; gap: 2px; margin-top: auto; padding: 13px 11px 2px; border-top: 1px solid color-mix(in srgb, var(--sidebar-text) 18%, transparent); color: var(--sidebar-muted); font-size: 10.5px; }
.company-name { color: var(--sidebar-text); font-size: 11.5px; font-weight: 600; }
.workspace-content { display: grid; gap: var(--gap); min-width: 0; }

.overview-visuals { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 14px; align-items: stretch; }
.overview-status { display: flex; flex-direction: column; gap: 16px; padding: 18px; }
.panel-kicker { color: var(--text-muted); font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
.overview-status h2 { margin-top: 3px; font-size: 14px; letter-spacing: -.01em; }
.panel-subtitle { margin-top: 3px; color: var(--text-muted); font-size: 11.5px; }
.overview-status ul { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.overview-status li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 11.5px; }
.overview-status strong { color: var(--text-primary); font-weight: 600; white-space: nowrap; }.overview-status .good { color: var(--status-good); }.overview-status .attention { color: #bc6b00; }
.overview-status button { margin-top: auto; width: 100%; padding: 7px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-1); color: var(--text-primary); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }.overview-status button:hover { background: var(--surface-sunken); }

/* Six equal columns with the hero spanning two: the five tiles then land on one
   row. With auto-fit the last tile wrapped alone onto a second row, leaving a
   long empty gap under the headline. */
.kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.kpis > :first-child {
  grid-column: span 1;
}

@media (max-width: 1050px) {
  main { grid-template-columns: 1fr; gap: 12px; }
  .workspace-nav { position: static; flex-direction: row; align-items: center; min-height: auto; padding: 5px; border-radius: 5px; overflow-x: auto; }
  .nav-label, .nav-footer { display: none; }
  .workspace-nav button { width: auto; border-left: 0; border-bottom: 2px solid transparent; border-radius: 0; }
  .workspace-nav button.active { border-left-color: transparent; border-bottom-color: var(--sidebar-active); background: var(--sidebar-hover); }
  .kpis {
    grid-template-columns: repeat(4, 1fr);
  }
  .overview-visuals { grid-template-columns: 1fr; }
  .overview-status { min-height: 0; }
}

@media (max-width: 720px) {
  .kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 460px) {
  .kpis {
    grid-template-columns: 1fr;
  }

  .kpis > :first-child {
    grid-column: span 1;
  }
}

.intensity-note {
  font-size: 12.5px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  border-radius: 8px;
  padding: 11px 14px;
  max-width: 100%;
}

.state {
  color: var(--text-secondary);
  padding: 40px 0;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 180px;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--scope2);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

.state.error {
  padding: 22px 24px;
  border-left: 3px solid var(--status-critical);
}

.state.error h2 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}

.retry {
  margin-top: 14px;
  padding: 7px 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-sunken);
  color: var(--text-primary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.retry:hover {
  border-color: var(--scope2);
}

table.data {
  border-collapse: collapse;
  width: 100%;
  font-size: 12.5px;
}

table.data th,
table.data td {
  text-align: left;
  padding: 6px 14px 6px 0;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

table.data th {
  color: var(--text-secondary);
  font-weight: 500;
}

table.data .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

footer {
  color: var(--text-muted);
  font-size: 12px;
  padding-top: 8px;
  max-width: 86ch;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 720px) {
  .page {
    padding: 22px 16px 44px;
  }

  h1 {
    font-size: 27px;
  }

  .masthead {
    margin-bottom: 20px;
  }

  .head-actions { width: 100%; justify-content: space-between; }
  .user-name { display: none; }
  .workspace-nav button { padding: 9px 7px; }
  .workspace-nav button svg { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>

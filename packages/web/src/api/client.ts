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
  UploadResult,
  UserProfile,
} from '../types';

const BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly hint?: string;

  constructor(status: number, message: string, hint?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
  }
}

async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { credentials: 'include' });
  } catch {
    // A failed fetch here almost always means the API is not running, and a
    // bare "Failed to fetch" sends people looking in the wrong place.
    throw new ApiError(
      0,
      'Cannot reach the API',
      'Start it with `npm run api`, and check the database is up with `npm run db:up`.',
    );
  }

  if (!response.ok) {
    const bodyText = await response.text();
    const body = (() => {
      try {
        return JSON.parse(bodyText) as {
          message?: string;
          hint?: string;
        };
      } catch {
        return {} as {
          message?: string;
          hint?: string;
        };
      }
    })();
    throw new ApiError(
      response.status,
      body.message ?? (bodyText.trim() || `Request failed with ${response.status}`),
      body.hint,
    );
  }

  const bodyText = await response.text();
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new ApiError(
      response.status,
      'The API returned a non-JSON response.',
      'Check that the web app is talking to the Ironbark API and not a fallback page.',
    );
  }
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(
      0,
      'Cannot reach the API',
      'Start it with `npm run api`, and check the database is up with `npm run db:up`.',
    );
  }

  const bodyText = await response.text();
  const body = (() => {
    try {
      return JSON.parse(bodyText) as { message?: string; hint?: string };
    } catch {
      return {} as { message?: string; hint?: string };
    }
  })();

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.message ?? (bodyText.trim() || `Request failed with ${response.status}`),
      body.hint,
    );
  }

  return body as T;
}

async function upload<T>(files: Record<string, File>): Promise<T> {
  const form = new FormData();
  for (const [field, file] of Object.entries(files)) form.append(field, file);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/uploads`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the API');
  }
  const bodyText = await response.text();
  let body: { message?: string; hint?: string } = {};
  try { body = JSON.parse(bodyText) as typeof body; } catch { /* handled below */ }
  if (!response.ok) throw new ApiError(response.status, body.message ?? 'Upload failed.', body.hint);
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    post('/api/auth/login', { email, password }),
  logout: () => post<{ signedOut: boolean }>('/api/auth/logout', {}),
  me: () => get<UserProfile>('/api/auth/me'),
  uploadDataset: (files: Record<string, File>) => upload<UploadResult>(files),
  monthlyEmissions: () =>
    get<{ months: MonthlyEmissions[] }>('/api/emissions/monthly'),
  summary: () => get<EmissionsSummary>('/api/emissions/summary'),
  bySiteArea: () =>
    get<{ siteAreas: SiteArea[] }>('/api/emissions/by-site-area'),
  incidents: () => get<{ incidents: Incident[]; total: number }>('/api/incidents'),
  incidentTrends: () => get<IncidentTrends>('/api/incidents/trends'),
  dataQuality: () => get<DataQualityOverview>('/api/data-quality'),
  dataQualityIssues: (params = '') =>
    get<{ issues: DataQualityIssue[] }>(`/api/data-quality/issues${params}`),
  outageAnalysis: () => get<OutageAnalysis>('/api/analysis/outage'),
  complianceSummary: () => get<ComplianceSummary>('/api/reports/summary'),
  generateComplianceSummary: () =>
    post<ComplianceSummary>('/api/reports/summary', {}),
};

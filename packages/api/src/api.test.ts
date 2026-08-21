import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '@ironbark/db';
import { buildServer } from './server.js';

/**
 * API integration tests, driven through `app.inject()`: no port, no socket, no
 * teardown race.
 *
 * The suite provisions its own tenant and uploads the real export through
 * POST /api/uploads, which exercises signup, the multipart upload, the whole
 * pipeline and every read endpoint against data that arrived the way a client's
 * data arrives. A second tenant checks isolation, the failure that does not
 * error. Everything it creates is removed afterwards.
 *
 * Requires a migrated database. Skips cleanly without one.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rawCsv = (name: string) =>
  readFileSync(join(repoRoot, 'data', 'raw', name), 'utf8');

const UPLOAD_FIELDS: [string, string][] = [
  ['emissionFactors', 'emission_factors.csv'],
  ['fuelDeliveries', 'fuel_deliveries.csv'],
  ['electricityReadings', 'electricity_meter_readings.csv'],
  ['incidentRegister', 'incident_register.csv'],
  ['suppliers', 'suppliers.csv'],
];

/** Distinct per run so a crashed run cannot collide with the next one. */
const RUN_ID = process.pid;
const PASSWORD = 'integration-test-password';

async function databaseReady(): Promise<boolean> {
  try {
    await getPool().query('select 1 from companies limit 1');
    return true;
  } catch {
    return false;
  }
}

const ready = await databaseReady();

if (!ready) {
  // See the note in packages/db/src/emissions.test.ts: CI sets REQUIRE_DB so a
  // skipped suite cannot pass for a green one.
  if (process.env['REQUIRE_DB'] === '1') {
    throw new Error(
      'REQUIRE_DB=1 but no migrated database was found. Run the migrations first.',
    );
  }
  console.warn(
    '[api.test] no migrated database — skipping. Run: npm run db:up && npm run db:migrate',
  );
}

const withDb = () => (ready ? it : it.skip);

/** Multipart body built by hand: `inject` takes a buffer, not a FormData. */
function multipartBody(
  boundary: string,
  parts: { field: string; filename: string; content: string }[],
): Buffer {
  const chunks = parts.map(
    ({ field, filename, content }) =>
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: text/csv\r\n\r\n${content}\r\n`,
  );
  return Buffer.from(`${chunks.join('')}--${boundary}--\r\n`, 'utf8');
}

type Tenant = { app: FastifyInstance; cookie: string; companyId: number };

async function signUp(app: FastifyInstance, suffix: string): Promise<Tenant> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      companyName: `Vitest ${suffix} ${RUN_ID}`,
      displayName: 'Integration Test',
      email: `vitest-${suffix}-${RUN_ID}@example.test`,
      password: PASSWORD,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`signup failed (${response.statusCode}): ${response.body}`);
  }

  const setCookie = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';

  const { rows } = await getPool().query<{ id: number }>(
    'select id from companies where name = $1',
    [`Vitest ${suffix} ${RUN_ID}`],
  );

  return { app, cookie: cookie.split(';')[0] ?? '', companyId: rows[0]!.id };
}

async function upload(tenant: Tenant) {
  const boundary = `----vitest${RUN_ID}`;
  const response = await tenant.app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: {
      cookie: tenant.cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: multipartBody(
      boundary,
      UPLOAD_FIELDS.map(([field, filename]) => ({
        field,
        filename,
        content: rawCsv(filename),
      })),
    ),
  });

  if (response.statusCode !== 201) {
    throw new Error(`upload failed (${response.statusCode}): ${response.body}`);
  }
  return response.json();
}

let app: FastifyInstance;
let primary: Tenant;
let other: Tenant;
let uploadResult: Record<string, unknown>;

if (ready) {
  app = buildServer();
  await app.ready();
  primary = await signUp(app, 'primary');
  other = await signUp(app, 'other');
  uploadResult = (await upload(primary)) as Record<string, unknown>;
}

afterAll(async () => {
  if (ready) {
    // Cascades to every table keyed on company_id.
    await getPool().query('delete from companies where name like $1', [
      `Vitest %${RUN_ID}`,
    ]);
    await app.close();
  }
  await closePool();
});

/** GET as the primary tenant. */
function get(url: string) {
  return app.inject({ method: 'GET', url, headers: { cookie: primary.cookie } });
}

describe('health and docs', () => {
  withDb()('reports healthy without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  withDb()('serves the OpenAPI document', async () => {
    // The document, not the viewer. The viewer reads its assets from disk and
    // is skipped on a serverless build; this route is generated from the same
    // route schemas the server validates against and is always there.
    const response = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('openapi');
  });

  withDb()('answers the health check under /api too', async () => {
    // The hosted build serves everything outside /api as the static site, so
    // the bare /health path is not reachable there.
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('authentication', () => {
  withDb()('refuses every data endpoint without a session', async () => {
    for (const url of [
      '/api/emissions/monthly',
      '/api/emissions/summary',
      '/api/incidents',
      '/api/data-quality',
      '/api/suppliers',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  withDb()('rejects a forged cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/emissions/summary',
      headers: { cookie: 'ironbark_session=not.a.real.token' },
    });
    expect(response.statusCode).toBe(401);
  });

  withDb()('returns the same message for unknown email and wrong password', async () => {
    // Neither response may reveal whether the account exists.
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `nobody-${RUN_ID}@example.test`, password: PASSWORD },
    });
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: `vitest-primary-${RUN_ID}@example.test`,
        password: 'definitely-not-the-password',
      },
    });

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  withDb()('signs in with the right password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: `vitest-primary-${RUN_ID}@example.test`,
        password: PASSWORD,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeDefined();
  });

  withDb()('ignores a company id supplied by the caller', async () => {
    // Fastify's ajv strips unknown body properties rather than rejecting them,
    // so this succeeds, the point is that the smuggled companyId has no
    // effect. The new account gets its own company and sees none of the
    // uploaded data. No endpoint takes a company from the caller.
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: {
        companyName: `Vitest smuggler ${RUN_ID}`,
        displayName: 'Schema Probe',
        email: `vitest-smuggler-${RUN_ID}@example.test`,
        password: PASSWORD,
        companyId: primary.companyId,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().company.id).not.toBe(primary.companyId);

    const setCookie = response.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
    const emissions = await app.inject({
      method: 'GET',
      url: '/api/emissions/monthly',
      headers: { cookie: cookie.split(';')[0] ?? '' },
    });
    expect(emissions.json().months).toHaveLength(0);
  });
});

describe('upload', () => {
  withDb()('loads the whole export and reports what it found', async () => {
    const load = uploadResult['load'] as Record<string, unknown>;
    expect(load['rowCounts']).toMatchObject({
      fuel_deliveries: 143,
      electricity_readings: 108,
      incidents: 42,
      suppliers: 15,
      data_quality_issues: 99,
    });
    expect(load['issueCount']).toBe(99);
    expect(load['errorCount']).toBe(31);
    expect(load['status']).toBe('succeeded');
  });

  withDb()('refuses a partial upload rather than deleting the rest', async () => {
    const boundary = `----vitestpartial${RUN_ID}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: {
        cookie: primary.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, [
        {
          field: 'incidentRegister',
          filename: 'incident_register.csv',
          content: rawCsv('incident_register.csv'),
        },
      ]),
    });
    // 422: the request is well-formed, the dataset it describes is not.
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('Missing file');
  });

  withDb()('refuses a binary file pretending to be a CSV', async () => {
    const boundary = `----vitestbinary${RUN_ID}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: {
        cookie: primary.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(
        boundary,
        UPLOAD_FIELDS.map(([field, filename]) => ({
          field,
          filename,
          content:
            field === 'suppliers' ? 'PK  binary' : rawCsv(filename),
        })),
      ),
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('does not look like a CSV');
  });
});

describe('emissions endpoints', () => {
  withDb()('returns 18 months with both scopes', async () => {
    const response = await get('/api/emissions/monthly');
    expect(response.statusCode).toBe(200);

    const months = response.json().months;
    expect(months).toHaveLength(18);

    // Months are reported as YYYY-MM: the figure is a monthly total, and a
    // day component would invite it being read as a point-in-time reading.
    const august = months.find((m: { month: string }) => m.month === '2025-08');
    // Same figures the SQL golden test computes by hand.
    expect(august.scope1KgCo2e).toBeCloseTo(1_219_184.94, 2);
    expect(august.scope2KgCo2e).toBeCloseTo(1_410_801.03, 2);
  });

  withDb()('responds in camelCase, not snake_case', async () => {
    // The API's contract with the frontend; a repository leaking column names
    // straight through would break every component silently.
    const response = await get('/api/emissions/monthly');
    expect(response.body).not.toContain('scope1_kg_co2e');
    expect(response.body).toContain('scope1KgCo2e');
  });

  withDb()('filters by month range', async () => {
    const response = await get('/api/emissions/monthly?from=2026-01&to=2026-03');
    expect(response.statusCode).toBe(200);

    const months = response.json().months;
    expect(months.map((m: { month: string }) => m.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });

  withDb()('rejects a malformed month rather than ignoring it', async () => {
    // Silently dropping an unparseable filter would return the whole period
    // and look like a correct answer to a different question.
    for (const bad of ['not-a-date', '2026-13', '2026-01-01']) {
      const response = await get(`/api/emissions/monthly?from=${bad}`);
      expect(response.statusCode, bad).toBe(400);
    }
  });

  withDb()('summarises the period', async () => {
    const response = await get('/api/emissions/summary');
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('_kg_co2e');
  });
});

describe('incidents endpoints', () => {
  withDb()('lists the register', async () => {
    const response = await get('/api/incidents');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.total).toBe(42);
    expect(body.incidents.length).toBeGreaterThan(0);
  });

  withDb()('keeps both incidents that shared one ID', async () => {
    const response = await get('/api/incidents');
    const ids = response.json().incidents.map((i: { id: string }) => i.id);
    expect(ids).toContain('INC-2025-011');
    expect(ids).toContain('INC-2025-011-2');
  });

  withDb()('serves one incident with its quality issues', async () => {
    // The traceability endpoint: a number on screen back to its source record.
    const response = await get('/api/incidents/INC-2025-011');
    expect(response.statusCode).toBe(200);

    // The record, its data-quality issues and its AI findings in one payload, 
    // everything needed to trace a figure back to the source row.
    const body = response.json();
    expect(body.incident.id).toBe('INC-2025-011');
    expect(body.incident.sourceIncidentId).toBe('INC-2025-011');
    expect(body).toHaveProperty('dataQualityIssues');
    expect(body).toHaveProperty('aiFindings');
  });

  withDb()('404s on an unknown incident', async () => {
    const response = await get('/api/incidents/INC-9999-999');
    expect(response.statusCode).toBe(404);
  });
});

describe('data quality endpoint', () => {
  withDb()('reports all 99 findings', async () => {
    const response = await get('/api/data-quality');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('99');
  });

  withDb()('serves the rule catalogue with its rationale', async () => {
    const response = await get('/api/data-quality/rules');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    const rules = Array.isArray(body) ? body : body.rules;
    // Every rule carries the reason it was allowed to change a number.
    expect(rules.length).toBeGreaterThanOrEqual(22);
    expect(rules[0]).toHaveProperty('rationale');
  });

  withDb()('drills down to the row level', async () => {
    const response = await get('/api/data-quality/issues?ruleId=FUEL-DUP-01');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('INV-40497');
  });
});

describe('compliance summary', () => {
  /**
   * The endpoint most able to do damage if it is wrong: prose, generated by a
   * model, in a compliance pack. These tests assert the properties that make it
   * safe rather than the words it happens to contain.
   *
   * Whether a summary is available depends on the environment, so the contract
   * is asserted unconditionally and the claim-level invariants run against
   * whatever is actually being served.
   */
  const summaryOrNull = async () => {
    const body = (await get('/api/reports/summary')).json();
    return body.available === true ? body : null;
  };

  withDb()('answers with a summary or a reason, never an error', async () => {
    const response = await get('/api/reports/summary');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    if (body.available) {
      expect(body.sections.length).toBeGreaterThan(0);
      expect(body.verification.claimsShown).toBeGreaterThan(0);
      expect(body.facts.length).toBeGreaterThan(0);
    } else {
      expect(body.reason).toBeTruthy();
      expect(body.hint).toContain('/api/reports/summary');
    }
  });

  withDb()('resolves every citation to a fact in the pack', async () => {
    const body = await summaryOrNull();
    if (!body) return;

    const ids = new Set(body.facts.map((fact: { id: string }) => fact.id));

    for (const section of body.sections) {
      for (const claim of section.claims) {
        expect(claim.citations.length, claim.text).toBeGreaterThan(0);
        for (const citation of claim.citations) {
          expect(ids.has(citation), `${claim.text} cites ${citation}`).toBe(true);
        }
      }
    }
  });

  withDb()('accounts for every claim it was asked to verify', async () => {
    // A claim that no longer matches the figures is dropped rather than shown,
    // and the count is reported rather than hidden. What must never happen is a
    // claim disappearing without appearing in that count.
    const body = await summaryOrNull();
    if (!body) return;

    const { claimsChecked, claimsShown, claimsDroppedOnRead } = body.verification;
    expect(claimsShown + claimsDroppedOnRead).toBe(claimsChecked);
    expect(body.verification.droppedOnRead).toHaveLength(claimsDroppedOnRead);

    // And a summary is only served to a dataset it still substantially
    // describes, so most of it has to survive the check.
    expect(claimsShown / claimsChecked).toBeGreaterThanOrEqual(0.7);
  });

  withDb()('states no figure the fact pack does not contain', async () => {
    // The gate re-run from outside: every number in every rendered sentence has
    // to appear in one of that sentence's own citations. This is the assertion
    // that would catch a plausible-sounding fabrication reaching the UI.
    const body = await summaryOrNull();
    if (!body) return;

    const facts = new Map<string, { value: unknown; label: string; detail: string | null }>(
      body.facts.map((fact: { id: string }) => [fact.id, fact]),
    );

    const numbersIn = (text: string) =>
      (text.replace(/[−–]/g, '-').match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) =>
        Number(token.replace(/,/g, '')),
      );

    for (const section of body.sections) {
      for (const claim of section.claims) {
        const allowed = claim.citations.flatMap((id: string) => {
          const fact = facts.get(id);
          if (!fact) return [];
          return [
            ...(typeof fact.value === 'number' ? [fact.value] : []),
            ...numbersIn(String(fact.value)),
            ...numbersIn(fact.label),
            ...numbersIn(fact.detail ?? ''),
          ];
        });

        const stripped = claim.citations.reduce(
          (text: string, id: string) => text.split(id).join(' '),
          claim.text as string,
        );

        for (const written of numbersIn(stripped)) {
          const isYear = Number.isInteger(written) && written >= 1900 && written <= 2100;
          const supported = allowed.some(
            (value: number) => Math.abs(value - written) <= 0.5 + 1e-9,
          );
          expect(isYear || supported, `${claim.text} states ${written}`).toBe(true);
        }
      }
    }
  });

  withDb()('reports nothing for a tenant with no data, rather than erroring', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/reports/summary',
      headers: { cookie: other.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.available).toBe(false);
    expect(body.reason).toBeTruthy();
    // And no leak of the neighbour's narrative.
    expect(response.body).not.toContain('INC-2026-131');
  });

  withDb()('requires a session on both verbs', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/reports/summary' });
    const write = await app.inject({
      method: 'POST',
      url: '/api/reports/summary',
      payload: {},
    });
    expect(read.statusCode).toBe(401);
    expect(write.statusCode).toBe(401);
  });
});

describe('tenant isolation', () => {
  /**
   * The failure this project is most exposed to. A missing company_id does not
   * raise an error, it sums two clients' data into one confident number.
   */
  withDb()('shows a second company nothing of the first', async () => {
    const collections: [string, string][] = [
      ['/api/emissions/monthly', 'months'],
      ['/api/incidents', 'incidents'],
      ['/api/suppliers', 'suppliers'],
    ];

    for (const [url, key] of collections) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { cookie: other.cookie },
      });
      expect(response.statusCode, url).toBe(200);
      expect(response.json()[key], url).toHaveLength(0);
    }
  });

  withDb()('reports zero emissions for a company that has uploaded nothing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/emissions/summary',
      headers: { cookie: other.cookie },
    });
    expect(response.statusCode).toBe(200);
    // Empty, not a copy of the neighbour's totals.
    expect(response.body).not.toContain('1219184.94');
  });

  withDb()('does not let one tenant read another tenant\'s incident by id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/incidents/INC-2025-011',
      headers: { cookie: other.cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('cross-dataset correlation', () => {
  /**
   * The differentiator, and the endpoint most at risk of being a demo that
   * already knows the answer. These tests assert that nothing is hard-coded:
   * the month, the meters and both incidents have to be *found*.
   */
  withDb()('detects the outage month without being told which it is', async () => {
    const response = await get('/api/analysis/outage');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.detected).toBe(true);
    expect(body.month).toBe('2026-03');
  });

  withDb()('shows the collapse on every meter, against each meter\'s own norm', async () => {
    // The claim that makes this a supply event rather than a broken instrument.
    // Measured per meter because the site's meters differ by an order of
    // magnitude, a site-wide percentage would hide a small meter inside a
    // large one's noise.
    const { electricity } = (await get('/api/analysis/outage')).json();

    expect(electricity.meterCount).toBe(6);
    expect(electricity.metersBelowBaseline).toBe(6);
    expect(electricity.changePct).toBeLessThan(-60);

    for (const meter of electricity.meters) {
      expect(meter.belowBaseline, meter.meterId).toBe(true);
      expect(meter.changePct, meter.meterId).toBeLessThan(-50);
    }
  });

  withDb()('shows diesel substituting for the lost supply', async () => {
    const { fuel } = (await get('/api/analysis/outage')).json();
    expect(fuel.changePct).toBeGreaterThan(40);
    expect(fuel.excessLitres).toBeGreaterThan(200_000);
  });

  withDb()('finds the root-cause incident rather than naming it', async () => {
    const { incidents } = (await get('/api/analysis/outage')).json();
    expect(incidents.rootCause.id).toBe('INC-2026-131');
    expect(incidents.rootCause.typeCode).toBe('ELE');
    expect(incidents.rootCause.severity).toBe(3);
  });

  withDb()('finds the psychosocial consequence through the AI layer', async () => {
    // Coded OTH in the register; only the AI classification makes it findable
    // as the human tail of the outage.
    const { incidents } = (await get('/api/analysis/outage')).json();
    const ids = incidents.consequences.map((c: { id: string }) => c.id);

    expect(ids).toContain('INC-2026-134');
    const fatigue = incidents.consequences.find(
      (c: { id: string }) => c.id === 'INC-2026-134',
    );
    expect(fatigue.typeCode).toBe('OTH');
    expect(fatigue.aiCategory).toBe('Psychosocial hazard');
    // Traceable: the quote must be in the description it came from.
    expect(fatigue.description).toContain(fatigue.aiEvidenceQuote);
  });

  withDb()('reports the total falling while Scope 1 rises', async () => {
    // The whole point. A dashboard reporting one number calls this an
    // improvement; the split says the opposite.
    const { emissions } = (await get('/api/analysis/outage')).json();

    expect(emissions.totalChangePct).toBeLessThan(0);
    expect(emissions.scope1ChangePct).toBeGreaterThan(40);
    expect(emissions.scope2ChangePct).toBeLessThan(-60);
    expect(emissions.actual.scope1SharePct).toBeGreaterThan(75);
  });

  withDb()('gives a counterfactual above the reported total, with its assumption', async () => {
    const { counterfactual, emissions } = (await get('/api/analysis/outage')).json();

    expect(counterfactual.totalKgCo2e).toBeGreaterThan(emissions.actual.totalKgCo2e);
    // Negative: the reported figure sits below a normal month. That gap is the
    // size of the misreading, not a saving.
    expect(counterfactual.reportedMinusCounterfactualKg).toBeLessThan(0);
    // The estimate must carry its own caveat rather than leaving the UI to
    // present it as a measurement.
    expect(counterfactual.assumption).toContain('not a forecast');
    expect(counterfactual.gridFactorKgPerKwh).toBe(0.71);
  });

  withDb()('builds a chain where every link names its source dataset', async () => {
    const { chain } = (await get('/api/analysis/outage')).json();

    expect(chain).toHaveLength(6);
    expect(chain.map((link: { step: number }) => link.step)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const link of chain) {
      expect(link.source, link.title).toBeTruthy();
      expect(link.detail.length, link.title).toBeGreaterThan(20);
    }
    // The chain starts at the incident register and ends there too, cause and
    // human consequence both come from the dataset nobody thinks of as
    // emissions data.
    expect(chain[0].recordId).toBe('INC-2026-131');
    expect(chain[5].recordId).toBe('INC-2026-134');
  });

  withDb()('reports no detection for a tenant with no data, rather than erroring', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/analysis/outage',
      headers: { cookie: other.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.detected).toBe(false);
    expect(body.reason).toBeTruthy();
    // And no trace of the neighbour's outage.
    expect(response.body).not.toContain('2026-03');
    expect(response.body).not.toContain('INC-2026-131');
  });

  withDb()('requires a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/analysis/outage' });
    expect(response.statusCode).toBe(401);
  });
});

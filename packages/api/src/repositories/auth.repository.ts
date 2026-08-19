import { getPool, withClient } from '@ironbark/db';

/**
 * Accounts and tenants.
 *
 * The only repository whose queries are *not* scoped by company — it is the one
 * that decides which company a request belongs to. Everything downstream takes
 * that answer as given, which is why the lookups here are by primary key or by
 * a unique constraint and never by anything a caller can widen.
 */

export type UserRow = {
  id: number;
  company_id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: 'owner' | 'member';
  created_at: Date;
  last_login_at: Date | null;
};

export type UserWithCompanyRow = UserRow & {
  company_name: string;
  company_slug: string;
  company_abn: string | null;
};

export type CompanyRow = {
  id: number;
  slug: string;
  name: string;
  abn: string | null;
  created_at: Date;
};

const USER_WITH_COMPANY_SELECT = `
  select u.id, u.company_id, u.email, u.password_hash, u.display_name, u.role,
         u.created_at, u.last_login_at,
         c.name as company_name, c.slug as company_slug, c.abn as company_abn
  from users u
  join companies c on c.id = u.company_id`;

export async function findUserByEmail(
  email: string,
): Promise<UserWithCompanyRow | undefined> {
  const { rows } = await getPool().query<UserWithCompanyRow>(
    `${USER_WITH_COMPANY_SELECT} where u.email = $1`,
    [email],
  );
  return rows[0];
}

export async function findUserById(
  id: number,
): Promise<UserWithCompanyRow | undefined> {
  const { rows } = await getPool().query<UserWithCompanyRow>(
    `${USER_WITH_COMPANY_SELECT} where u.id = $1`,
    [id],
  );
  return rows[0];
}

export async function slugExists(slug: string): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    'select exists (select 1 from companies where slug = $1) as exists',
    [slug],
  );
  return rows[0]?.exists ?? false;
}

/**
 * Create a company and its first user together.
 *
 * One transaction, because a company with no way to sign into it is not a
 * half-finished signup — it is an orphan row that permanently holds a slug
 * nobody can use.
 */
export async function createCompanyWithOwner(input: {
  companyName: string;
  companySlug: string;
  abn: string | null;
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<UserWithCompanyRow> {
  return withClient(async (client) => {
    await client.query('begin');
    try {
      const { rows: companyRows } = await client.query<CompanyRow>(
        `insert into companies (slug, name, abn) values ($1, $2, $3)
         returning id, slug, name, abn, created_at`,
        [input.companySlug, input.companyName, input.abn],
      );
      const company = companyRows[0]!;

      const { rows: userRows } = await client.query<UserRow>(
        `insert into users (company_id, email, password_hash, display_name, role)
         values ($1, $2, $3, $4, 'owner')
         returning id, company_id, email, password_hash, display_name, role,
                   created_at, last_login_at`,
        [company.id, input.email, input.passwordHash, input.displayName],
      );
      const user = userRows[0]!;

      await client.query('commit');

      return {
        ...user,
        company_name: company.name,
        company_slug: company.slug,
        company_abn: company.abn,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
}

export async function touchLastLogin(userId: number): Promise<void> {
  await getPool().query('update users set last_login_at = now() where id = $1', [
    userId,
  ]);
}

/**
 * Whether this company has any data loaded.
 *
 * A brand-new tenant has none, and the difference between "no emissions" and
 * "no data yet" is the difference between a dashboard of zeroes and a prompt to
 * upload. The API says which; the UI does not have to guess from empty arrays.
 */
export async function countLoadedRows(companyId: number): Promise<{
  fuelDeliveries: number;
  electricityReadings: number;
  incidents: number;
  suppliers: number;
}> {
  const { rows } = await getPool().query<{
    fuel_deliveries: number;
    electricity_readings: number;
    incidents: number;
    suppliers: number;
  }>(
    `select
       (select count(*)::int from fuel_deliveries      where company_id = $1) as fuel_deliveries,
       (select count(*)::int from electricity_readings where company_id = $1) as electricity_readings,
       (select count(*)::int from incidents            where company_id = $1) as incidents,
       (select count(*)::int from suppliers            where company_id = $1) as suppliers`,
    [companyId],
  );
  const row = rows[0];
  return {
    fuelDeliveries: row?.fuel_deliveries ?? 0,
    electricityReadings: row?.electricity_readings ?? 0,
    incidents: row?.incidents ?? 0,
    suppliers: row?.suppliers ?? 0,
  };
}

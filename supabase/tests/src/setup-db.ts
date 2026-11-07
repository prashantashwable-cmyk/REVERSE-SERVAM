import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { BASE_URL, Session, admin } from './db';
import { USERS, type Fixture, type UserKey } from './fixture';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', '..', 'migrations');
const SHIM = join(here, '..', 'sql', 'supabase_shim.sql');

/** Drop and recreate a database, then apply the Supabase shim and every migration in order. */
export async function createDatabase(name: string): Promise<pg.Pool> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('database name must be a plain identifier');
  const root = new pg.Client({ connectionString: BASE_URL });
  await root.connect();
  await root.query(`drop database if exists ${name} with (force)`);
  await root.query(`create database ${name}`);
  await root.end();
  const u = new URL(BASE_URL);
  u.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: u.toString(), max: 6 });
  await pool.query(readFileSync(SHIM, 'utf8'));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await pool.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return pool;
}

export interface FixtureNames {
  person: (key: UserKey) => string;
  aiec: string;
  partnerA: string;
  partnerB: string;
  customer: string;
  supplier: string;
}

export const TEST_NAMES: FixtureNames = {
  person: (key) => `Test ${key}`,
  aiec: 'All India Elevators Company (DEMO)',
  partnerA: 'Demo Partner Alpha Lifts',
  partnerB: 'Demo Partner Beta Elevators',
  customer: 'Demo Customer Housing Society',
  supplier: 'Demo Supplier Lift Components',
};

/**
 * Synthetic people and organizations created through the real RPCs: operator bootstrap → Owner,
 * partner / customer / supplier organizations, AIEC role grants, partner-administered technicians.
 * Phones are synthetic (+91 90000 000NN, NN = position in USERS).
 */
export async function createFixture(pool: pg.Pool, names: FixtureNames = TEST_NAMES): Promise<Fixture> {
  // Supabase Auth would create these rows on OTP sign-up (synthetic numbers).
  const users = {} as Record<UserKey, string>;
  for (const key of USERS) {
    const [row] = await admin<{ id: string }>(pool, `insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id`, [
      `9190000${String(USERS.indexOf(key)).padStart(5, '0')}`,
      { full_name: names.person(key) },
    ]);
    users[key] = row!.id;
  }
  // Operator bootstrap (SQL editor) → first Owner.
  const [boot] = await admin<{ org: string }>(pool, `select app.bootstrap_platform($1, $2) as org`, [users.owner, names.aiec]);
  const aiec = boot!.org;
  const owner = new Session(pool, users.owner);

  const createOrg = (kind: string, name: string, city: string) =>
    owner.rpc<string>('admin_create_organization', { p_kind: kind, p_name: name, p_legal_name: null, p_city: city, p_reason: 'test fixture' });
  const partnerA = await createOrg('partner', names.partnerA, 'Pune');
  const partnerB = await createOrg('partner', names.partnerB, 'PCMC');
  const customer = await createOrg('customer', names.customer, 'Pune');
  const supplier = await createOrg('supplier', names.supplier, 'Pune');

  const grant = async (who: UserKey, org: string, role: string) => {
    await owner.rpc('admin_add_member', { p_user_id: users[who], p_org_id: org, p_reason: 'test fixture' });
    await owner.rpc('admin_grant_role', { p_user_id: users[who], p_org_id: org, p_role_code: role, p_reason: 'test fixture' });
    await owner.rpc('admin_set_user_status', { p_user_id: users[who], p_status: 'active', p_reason: 'verified in fixture' });
  };
  await grant('sales1', aiec, 'sales_executive');
  await grant('sales2', aiec, 'sales_executive');
  await grant('surveyor1', aiec, 'surveyor');
  await grant('surveyor2', aiec, 'surveyor');
  await grant('tech1', aiec, 'technical_manager');
  await grant('ops1', aiec, 'operations_manager');
  await grant('finance1', aiec, 'accounts_finance');
  await grant('procure1', aiec, 'procurement_manager');
  await grant('qa1', aiec, 'qa_inspector');
  await grant('partnerA_admin', partnerA, 'partner_admin');
  await grant('partnerB_admin', partnerB, 'partner_admin');
  await grant('customer1', customer, 'customer');

  // Partner admins enrol their own technicians (tenant-scoped administration).
  const enrol: [UserKey, UserKey, string][] = [
    ['partnerA_admin', 'partnerA_tech', partnerA],
    ['partnerB_admin', 'partnerB_tech', partnerB],
  ];
  for (const [adminKey, techKey, org] of enrol) {
    const pa = new Session(pool, users[adminKey]);
    await pa.rpc('admin_add_member', { p_user_id: users[techKey], p_org_id: org, p_reason: 'new technician' });
    await pa.rpc('admin_grant_role', { p_user_id: users[techKey], p_org_id: org, p_role_code: 'technician', p_reason: 'new technician' });
    await pa.rpc('admin_set_user_status', { p_user_id: users[techKey], p_status: 'active', p_reason: 'identity verified' });
  }

  return { users, orgs: { aiec, partnerA, partnerB, customer, supplier } };
}

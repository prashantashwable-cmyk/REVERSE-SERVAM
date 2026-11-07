import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { BASE_URL, Session, TEST_DB, admin, makePool } from './db';
import { USERS, type Fixture, type UserKey } from './fixture';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', '..', 'migrations');
const SHIM = join(here, '..', 'sql', 'supabase_shim.sql');

/**
 * Builds a throw-away database: Supabase shim → every migration in order →
 * synthetic fixture created through the real RPCs (owner bootstrap, partner
 * tenants, role grants, partner-administered technicians).
 */
export default async function setup(project: TestProject) {
  const root = new pg.Client({ connectionString: BASE_URL });
  await root.connect();
  await root.query(`drop database if exists ${TEST_DB} with (force)`);
  await root.query(`create database ${TEST_DB}`);
  await root.end();

  const pool = makePool();
  await pool.query(readFileSync(SHIM, 'utf8'));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await pool.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }

  // Supabase Auth would create these rows on OTP sign-up (synthetic numbers).
  const users = {} as Record<UserKey, string>;
  for (const key of USERS) {
    const [row] = await admin<{ id: string }>(pool, `insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id`, [
      `9190000${String(USERS.indexOf(key)).padStart(5, '0')}`,
      { full_name: `Test ${key}` },
    ]);
    users[key] = row!.id;
  }

  // Operator bootstrap (SQL editor) → first Owner.
  const [boot] = await admin<{ org: string }>(pool, `select app.bootstrap_platform($1, 'All India Elevators Company (DEMO)') as org`, [users.owner]);
  const aiec = boot!.org;
  const owner = new Session(pool, users.owner);

  const createOrg = (kind: string, name: string, city: string) =>
    owner.rpc<string>('admin_create_organization', { p_kind: kind, p_name: name, p_legal_name: null, p_city: city, p_reason: 'test fixture' });
  const partnerA = await createOrg('partner', 'Demo Partner Alpha Lifts', 'Pune');
  const partnerB = await createOrg('partner', 'Demo Partner Beta Elevators', 'PCMC');
  const customer = await createOrg('customer', 'Demo Customer Housing Society', 'Pune');
  const supplier = await createOrg('supplier', 'Demo Supplier Lift Components', 'Pune');

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

  const fixture: Fixture = { users, orgs: { aiec, partnerA, partnerB, customer, supplier } };
  project.provide('fixture', fixture);
  await pool.end();
}

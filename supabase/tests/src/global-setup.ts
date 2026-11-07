import type { TestProject } from 'vitest/node';
import { TEST_DB } from './db';
import { createDatabase, createFixture } from './setup-db';

/**
 * Builds a throw-away database: Supabase shim → every migration in order →
 * synthetic fixture created through the real RPCs (owner bootstrap, partner
 * tenants, role grants, partner-administered technicians).
 */
export default async function setup(project: TestProject) {
  const pool = await createDatabase(TEST_DB);
  project.provide('fixture', await createFixture(pool));
  await pool.end();
}

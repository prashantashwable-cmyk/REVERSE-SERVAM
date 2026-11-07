/**
 * `npm run seed:demo` — builds a separate local demo database (default `aiec_demo`) from every
 * migration and fills it with the §63 synthetic demo data through the real RPCs.
 * Requires the same local PostgreSQL + PostGIS server as the integration tests
 * (AIEC_TEST_DATABASE_URL points at its maintenance database). It drops and recreates only the
 * demo database. It is not for a hosted Supabase project: demo sign-ins are created here as
 * auth.users rows, which Supabase Auth would create on OTP sign-up.
 */
import { USERS } from './fixture';
import { seedDemo } from './demo-seed';
import { DEMO_NAMES, createDatabase, createFixture } from './setup-db-demo';

const name = process.env.AIEC_DEMO_DATABASE_NAME ?? 'aiec_demo';
if (name === 'postgres' || name.includes('prod')) throw new Error(`refusing to seed demo data into "${name}"`);

const pool = await createDatabase(name);
try {
  const fx = await createFixture(pool, DEMO_NAMES);
  const summary = await seedDemo(pool, fx, { useFixturePartners: true });
  console.log(`Demo database "${name}" is ready.`);
  console.log('Sign in with these synthetic phones (OTP is handled by your local auth / the E2E gateway):');
  for (const key of USERS) console.log(`  ${`90000${String(USERS.indexOf(key)).padStart(5, '0')}`}  ${DEMO_NAMES.person(key).padEnd(18)} ${key}`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}

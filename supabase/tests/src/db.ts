import pg from 'pg';

/**
 * Test-only database access. Impersonation mirrors how Supabase/PostgREST runs
 * a request: one transaction, `SET LOCAL ROLE authenticated` (or anon) and the
 * JWT claims in `request.jwt.claims`, so RLS, grants and auth.uid() behave as
 * they do for a real API call.
 */
export const BASE_URL = process.env.AIEC_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
export const TEST_DB = process.env.AIEC_TEST_DATABASE_NAME ?? 'aiec_test';

if (!/^[a-z_][a-z0-9_]*$/.test(TEST_DB)) throw new Error('AIEC_TEST_DATABASE_NAME must be a plain identifier');

export function testDbUrl(): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

export class DbError extends Error {
  constructor(
    readonly code: string,
    readonly pgCode: string | undefined,
    readonly detail: Record<string, unknown>,
  ) {
    super(code);
  }
}

function wrap(err: unknown): DbError {
  const e = err as { message?: string; code?: string; detail?: string };
  let detail: Record<string, unknown> = {};
  try {
    detail = e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : {};
  } catch {
    detail = { raw: e.detail };
  }
  return new DbError(e.message ?? 'unknown', e.code, detail);
}

export class Session {
  constructor(
    private readonly pool: pg.Pool,
    readonly userId: string | null,
  ) {}

  private async run<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      if (this.userId) {
        await c.query('set local role authenticated');
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: this.userId, role: 'authenticated' })]);
      } else {
        await c.query('set local role anon');
      }
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw wrap(err);
    } finally {
      c.release();
    }
  }

  /** Call public.<fn>(p_key => value, ...) and return its single result value. */
  rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!/^[a-z_]+$/.test(fn)) throw new Error('bad function name');
    const keys = Object.keys(args);
    for (const k of keys) if (!/^p_[a-z_]+$/.test(k)) throw new Error(`bad argument name ${k}`);
    const values = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
    });
    const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    return this.run(async (c) => (await c.query(`select public.${fn}(${params}) as r`, values)).rows[0].r as T);
  }

  query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.run(async (c) => (await c.query(sql, params)).rows as T[]);
  }
}

export function makePool(): pg.Pool {
  return new pg.Pool({ connectionString: testDbUrl(), max: 6 });
}

export async function admin<T = any>(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return (await pool.query(sql, params)).rows as T[];
  } catch (err) {
    throw wrap(err);
  }
}

/** Assert a promise rejects with a given catalogue code; returns the error. */
export async function expectCode(p: Promise<unknown>, code: string): Promise<DbError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DbError && err.code === code) return err;
    throw new Error(`expected ${code}, got ${(err as Error).message} ${JSON.stringify((err as DbError).detail ?? {})}`);
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

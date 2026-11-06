import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requirePublicEnv } from '../env';

/** Per-request Supabase client acting as the signed-in user (RLS applies). */
export async function supabaseServer() {
  const env = requirePublicEnv();
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the middleware refreshes cookies instead.
        }
      },
    },
  });
}

/**
 * Public runtime configuration. Only publishable values are used by the web
 * app; the service-role key must never be configured here (spec §24.3).
 */
export type AppEnvironment = 'production' | 'staging' | 'demo';

export interface PublicEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  environment: AppEnvironment;
}

export function readPublicEnv(): PublicEnv | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const raw = process.env.NEXT_PUBLIC_AIEC_ENV;
  const environment: AppEnvironment = raw === 'production' || raw === 'demo' ? raw : 'staging';
  return { supabaseUrl, supabaseAnonKey, environment };
}

export function requirePublicEnv(): PublicEnv {
  const env = readPublicEnv();
  // i18n-ignore: developer-facing configuration error, never shown to end users
  if (!env) throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return env;
}

/** Publishable configuration inlined by Expo at build time (EXPO_PUBLIC_*). */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  environment: (process.env.EXPO_PUBLIC_AIEC_ENV ?? 'staging') as 'production' | 'staging' | 'demo',
  appVersion: '0.1.0',
};

export const isConfigured = config.supabaseUrl.length > 0 && config.supabaseAnonKey.length > 0;

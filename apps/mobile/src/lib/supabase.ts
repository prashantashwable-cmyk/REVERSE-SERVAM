import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { chunkedStorage } from './chunking';
import { config } from './config';

/**
 * Session tokens live in the Android Keystore-backed SecureStore (chunked),
 * never in plain AsyncStorage. Only the publishable key ships in the app.
 */
export const supabase = createClient(config.supabaseUrl || 'http://invalid.local', config.supabaseAnonKey || 'unset', {
  auth: {
    storage: chunkedStorage(SecureStore),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'x-aiec-app-version': config.appVersion },
  },
});

// Refresh tokens only while the app is in the foreground (Supabase guidance for React Native).
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

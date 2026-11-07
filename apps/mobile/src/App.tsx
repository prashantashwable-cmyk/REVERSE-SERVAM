import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { config, isConfigured } from './lib/config';
import { pendingCount, queue, sendOperation } from './lib/field';
import { LocaleProvider, useT } from './lib/locale';
import { supabase } from './lib/supabase';
import { LoginScreen } from './screens/LoginScreen';
import { SurveyListScreen } from './screens/SurveyListScreen';
import { SurveyScreen } from './screens/SurveyScreen';
import { SyncScreen } from './screens/SyncScreen';
import { Banner, colors, styles } from './ui';

export type Route = { name: 'list' } | { name: 'survey'; surveyId: string } | { name: 'sync' };

export interface AppContextValue {
  userId: string;
  online: boolean;
  pending: number;
  navigate: (r: Route) => void;
  syncNow: () => Promise<void>;
  signOut: () => Promise<string | null>;
}

export default function App() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}

function AppShell() {
  const { t } = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>({ name: 'list' });
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const syncing = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const net = await Network.getNetworkStateAsync();
      const reachable = !!net.isConnected && net.isInternetReachable !== false;
      setOnline(reachable);
      if (reachable && session) await queue.flush(sendOperation);
    } finally {
      setPending(await pendingCount());
      syncing.current = false;
    }
  }, [session]);

  // Sync when connectivity returns and periodically while open (retry with back-off lives in the queue).
  useEffect(() => {
    if (!session) return;
    void syncNow();
    const subscription = Network.addNetworkStateListener((s) => {
      const reachable = !!s.isConnected && s.isInternetReachable !== false;
      setOnline(reachable);
      if (reachable) void syncNow();
    });
    const timer = setInterval(() => void syncNow(), 30_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [session, syncNow]);

  const signOut = useCallback(async () => {
    const n = await pendingCount();
    // Never lose field work: unsynced operations block sign-out (§52, release gate "no data loss").
    if (n > 0) return t('mobile.signout_blocked', { count: n });
    await supabase.auth.signOut();
    const { clearLocalData } = await import('./lib/db');
    await clearLocalData();
    return null;
  }, [t]);

  if (!isConfigured) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.screen, styles.content]}>
          <Banner tone="crit">{t('mobile.no_server')}</Banner>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const ctx: AppContextValue | null = session
    ? { userId: session.user.id, online, pending, navigate: setRoute, syncNow, signOut }
    : null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        {config.environment === 'demo' ? (
          <View style={{ backgroundColor: colors.warn, padding: 4 }}>
            <Text style={{ color: colors.white, textAlign: 'center', fontWeight: '700' }}>{t('common.demo_banner')}</Text>
          </View>
        ) : null}
        {ctx && !online ? (
          <View accessibilityRole="alert" style={{ backgroundColor: colors.navyLight, padding: 6 }}>
            <Text style={{ color: colors.white, textAlign: 'center' }}>{t('mobile.offline_banner')}</Text>
          </View>
        ) : null}
        {loading ? null : !ctx ? (
          <LoginScreen />
        ) : route.name === 'survey' ? (
          <SurveyScreen ctx={ctx} surveyId={route.surveyId} />
        ) : route.name === 'sync' ? (
          <SyncScreen ctx={ctx} />
        ) : (
          <SurveyListScreen ctx={ctx} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

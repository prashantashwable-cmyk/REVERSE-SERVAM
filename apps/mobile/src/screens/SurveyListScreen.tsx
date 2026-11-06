import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { errorMessage, formatDateTimeIST, t, type DomainError } from '@aiec/domain';
import type { AppContextValue } from '../App';
import { cachedWorkPackage, refreshWorkPackage, type CachedSurvey } from '../lib/field';
import { Banner, Button, Chip, colors, styles } from '../ui';

/** SV01 Survey queue — works offline from the cached work package. */
export function SurveyListScreen({ ctx }: { ctx: AppContextValue }) {
  const [items, setItems] = useState<CachedSurvey[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await ctx.syncNow(); // push local work first so the server copy is current
      setItems(await refreshWorkPackage(ctx.userId));
    } catch (e) {
      setItems(await cachedWorkPackage());
      const code = (e as DomainError).code;
      setError(code ? errorMessage(code).title : 'Showing saved work — could not refresh.');
    } finally {
      setRefreshing(false);
    }
  }, [ctx]);

  useEffect(() => {
    cachedWorkPackage().then(setItems);
    void load();
  }, [load]);

  return (
    <View style={styles.screen}>
      <View style={[styles.content, { paddingBottom: 0 }]}>
        <Text accessibilityRole="header" style={styles.h1}>My surveys</Text>
        <View style={styles.row}>
          <Chip text={ctx.online ? 'Online' : 'Offline'} tone={ctx.online ? 'ok' : 'warn'} />
          <Chip text={ctx.pending === 0 ? 'All synced' : `${ctx.pending} waiting to sync`} tone={ctx.pending === 0 ? 'ok' : 'warn'} />
        </View>
        {error ? <Banner tone="warn">{error}</Banner> : null}
        {message ? <Banner tone="crit">{message}</Banner> : null}
      </View>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListEmptyComponent={<Text style={styles.muted}>No surveys assigned. Pull down to refresh.</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Survey ${item.survey_number}, ${item.sites?.name ?? ''}, ${t(`survey.state.${item.status}`)}`}
            onPress={() => ctx.navigate({ name: 'survey', surveyId: item.id })}
            style={{ backgroundColor: colors.white, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.silver, minHeight: 72 }}
          >
            <Text style={{ fontWeight: '700', color: colors.navy, fontSize: 16 }}>{item.sites?.name ?? item.survey_number}</Text>
            <Text style={styles.muted}>{[item.sites?.locality, item.sites?.city].filter(Boolean).join(', ')}</Text>
            <Text style={styles.muted}>{formatDateTimeIST(item.scheduled_start)}</Text>
            <View style={{ marginTop: 6 }}>
              <Chip text={t(`survey.state.${item.status}`)} tone={item.status === 'site_inaccessible' ? 'crit' : item.status.endsWith('requested') ? 'warn' : 'info'} />
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={{ gap: 8, marginTop: 8 }}>
            <Button title="Sync queue" kind="secondary" onPress={() => ctx.navigate({ name: 'sync' })} />
            <Button title="Sign out" kind="secondary" onPress={async () => setMessage(await ctx.signOut())} />
          </View>
        }
      />
    </View>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { DomainError } from '@aiec/domain';
import type { AppContextValue } from '../App';
import { cachedWorkPackage, refreshWorkPackage, type CachedSurvey } from '../lib/field';
import { LanguageSwitch, useT } from '../lib/locale';
import { Banner, Button, Chip, colors, styles } from '../ui';

/** SV01 Survey queue — works offline from the cached work package. */
export function SurveyListScreen({ ctx }: { ctx: AppContextValue }) {
  const { t, dt } = useT();
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
      setError(code ? t(`error.${code}.title`) : t('mobile.refresh_failed'));
    } finally {
      setRefreshing(false);
    }
  }, [ctx, t]);

  useEffect(() => {
    cachedWorkPackage().then(setItems);
    void load();
  }, [load]);

  return (
    <View style={styles.screen}>
      <View style={[styles.content, { paddingBottom: 0 }]}>
        <LanguageSwitch />
        <Text accessibilityRole="header" style={styles.h1}>{t('mobile.my_surveys')}</Text>
        <View style={styles.row}>
          <Chip text={ctx.online ? t('mobile.online') : t('mobile.offline')} tone={ctx.online ? 'ok' : 'warn'} />
          <Chip text={ctx.pending === 0 ? t('mobile.all_synced') : t('mobile.waiting_count', { count: ctx.pending })} tone={ctx.pending === 0 ? 'ok' : 'warn'} />
        </View>
        {error ? <Banner tone="warn">{error}</Banner> : null}
        {message ? <Banner tone="crit">{message}</Banner> : null}
      </View>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListEmptyComponent={<Text style={styles.muted}>{t('mobile.no_surveys')}</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.survey_a11y', { number: item.survey_number, site: item.sites?.name ?? '', status: t(`survey.state.${item.status}`) })}
            onPress={() => ctx.navigate({ name: 'survey', surveyId: item.id })}
            style={{ backgroundColor: colors.white, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.silver, minHeight: 72 }}
          >
            <Text style={{ fontWeight: '700', color: colors.navy, fontSize: 16 }}>{item.sites?.name ?? item.survey_number}</Text>
            <Text style={styles.muted}>{[item.sites?.locality, item.sites?.city].filter(Boolean).join(', ')}</Text>
            <Text style={styles.muted}>{dt(item.scheduled_start)}</Text>
            <View style={{ marginTop: 6 }}>
              <Chip text={t(`survey.state.${item.status}`)} tone={item.status === 'site_inaccessible' ? 'crit' : item.status.endsWith('requested') ? 'warn' : 'info'} />
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={{ gap: 8, marginTop: 8 }}>
            <Button title={t('mobile.sync_queue')} kind="secondary" onPress={() => ctx.navigate({ name: 'sync' })} />
            <Button title={t('mobile.sign_out')} kind="secondary" onPress={async () => setMessage(await ctx.signOut())} />
          </View>
        }
      />
    </View>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SYNC_STATUS_LABEL_KEYS, hasMessage, type SyncOperation } from '@aiec/domain';
import type { AppContextValue } from '../App';
import { queue, syncStore } from '../lib/field';
import { useT } from '../lib/locale';
import { Button, Chip, colors, styles } from '../ui';


/** WT09 / §52.4 Per-record sync status. "Synced" is shown only after server acknowledgement. */
export function SyncScreen({ ctx }: { ctx: AppContextValue }) {
  const { t, dt } = useT();
  const [ops, setOps] = useState<SyncOperation[]>([]);
  const reload = useCallback(async () => setOps((await syncStore.all()).reverse()), []);
  useEffect(() => {
    void reload();
  }, [reload, ctx.pending]);

  return (
    <View style={styles.screen}>
      <View style={[styles.content, { paddingBottom: 0 }]}>
        <Text accessibilityRole="header" style={styles.h1}>{t('mobile.sync_queue')}</Text>
        <Button title={t('mobile.sync_now')} onPress={async () => { await ctx.syncNow(); await reload(); }} disabled={!ctx.online} />
        <Button title={t('mobile.back_surveys')} kind="secondary" onPress={() => ctx.navigate({ name: 'list' })} />
      </View>
      <FlatList
        contentContainerStyle={styles.content}
        data={ops}
        keyExtractor={(o) => o.operationId}
        ListEmptyComponent={<Text style={styles.muted}>{t('mobile.nothing_queued')}</Text>}
        renderItem={({ item }) => {
          const tone = item.status === 'synced' ? 'ok' : item.status === 'conflict' || item.status === 'rejected' ? 'crit' : item.status === 'discarded' ? 'info' : 'warn';
          return (
            <View style={{ backgroundColor: colors.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.silver, gap: 4 }}>
              <Text style={{ fontWeight: '700', color: colors.navy }}>{hasMessage(`mobile.op.${item.operationType}`) ? t(`mobile.op.${item.operationType}`) : item.operationType}</Text>
              <Text style={styles.muted}>{t('mobile.saved_attempts', { date: dt(item.clientCreatedAt), count: item.attempts })}</Text>
              <Chip text={t(SYNC_STATUS_LABEL_KEYS[item.status])} tone={tone} />
              {item.lastErrorCode ? (
                <Text style={{ color: colors.crit }}>
                  {t(`error.${item.lastErrorCode}.title`)}. {t(`error.${item.lastErrorCode}.next`)}
                </Text>
              ) : null}
              {item.status === 'conflict' || item.status === 'rejected' ? (
                <Button
                  title={t('mobile.discard')}
                  kind="danger"
                  accessibilityHint={t('mobile.discard_hint')}
                  onPress={async () => {
                    await queue.discard(item.operationId);
                    await ctx.syncNow();
                    await reload();
                  }}
                />
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}

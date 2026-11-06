import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SYNC_STATUS_LABEL_KEYS, errorMessage, formatDateTimeIST, t, type SyncOperation } from '@aiec/domain';
import type { AppContextValue } from '../App';
import { queue, syncStore } from '../lib/field';
import { Button, Chip, colors, styles } from '../ui';

const OP_LABELS: Record<string, string> = {
  'survey.accept': 'Accept survey',
  'survey.check_in': 'Site check-in',
  'evidence.upload': 'Photo evidence',
  'survey.save_draft': 'Survey data',
  'survey.submit': 'Submit survey',
};

/** WT09 / §52.4 Per-record sync status. "Synced" is shown only after server acknowledgement. */
export function SyncScreen({ ctx }: { ctx: AppContextValue }) {
  const [ops, setOps] = useState<SyncOperation[]>([]);
  const reload = useCallback(async () => setOps((await syncStore.all()).reverse()), []);
  useEffect(() => {
    void reload();
  }, [reload, ctx.pending]);

  return (
    <View style={styles.screen}>
      <View style={[styles.content, { paddingBottom: 0 }]}>
        <Text accessibilityRole="header" style={styles.h1}>Sync queue</Text>
        <Button title="Sync now" onPress={async () => { await ctx.syncNow(); await reload(); }} disabled={!ctx.online} />
        <Button title="Back to surveys" kind="secondary" onPress={() => ctx.navigate({ name: 'list' })} />
      </View>
      <FlatList
        contentContainerStyle={styles.content}
        data={ops}
        keyExtractor={(o) => o.operationId}
        ListEmptyComponent={<Text style={styles.muted}>Nothing queued.</Text>}
        renderItem={({ item }) => {
          const tone = item.status === 'synced' ? 'ok' : item.status === 'conflict' || item.status === 'rejected' ? 'crit' : item.status === 'discarded' ? 'info' : 'warn';
          return (
            <View style={{ backgroundColor: colors.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.silver, gap: 4 }}>
              <Text style={{ fontWeight: '700', color: colors.navy }}>{OP_LABELS[item.operationType] ?? item.operationType}</Text>
              <Text style={styles.muted}>Saved {formatDateTimeIST(item.clientCreatedAt)} · attempts {item.attempts}</Text>
              <Chip text={t(SYNC_STATUS_LABEL_KEYS[item.status])} tone={tone} />
              {item.lastErrorCode ? (
                <Text style={{ color: colors.crit }}>
                  {errorMessage(item.lastErrorCode).title}. {errorMessage(item.lastErrorCode).nextAction}
                </Text>
              ) : null}
              {item.status === 'conflict' || item.status === 'rejected' ? (
                <Button
                  title="Discard this change"
                  kind="danger"
                  accessibilityHint="Keeps a record of the change but stops sending it. Re-enter it from the survey if still needed."
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import {
  DEFAULT_SURVEY_REQUIREMENTS,
  formatPhone,
  fromServerError,
  hasMessage,
  toMillimetres,
  validateSurveySubmission,
  type LengthUnit,
  type SurveyRequirements,
  type SyncOperation,
} from '@aiec/domain';
import type { AppContextValue } from '../App';
import { getDraft, saveDraft, type LocalDraft } from '../lib/db';
import { cachedRequirements, cachedWorkPackage, captureEvidence, enqueueCheckIn, enqueueSimple, syncStore, type CachedSurvey } from '../lib/field';
import { useT } from '../lib/locale';
import { supabase } from '../lib/supabase';
import { Banner, Button, Card, Chip, LabeledInput, colors, styles } from '../ui';

/** Survey sections (§8.5). Keys match the server's allowed sections and Gate 1 paths. */
// Titles: survey.section.<key>; labels: field.<section>.<key>; hints: hint.<section>.<key> (when present).
const SECTIONS: { key: string; fields: { key: string; numeric?: boolean }[] }[] = [
  {
    key: 'building',
    fields: [
      { key: 'usage' },
      { key: 'floors', numeric: true },
      { key: 'stops', numeric: true },
      { key: 'construction_stage' },
      { key: 'structural_type' },
      { key: 'entrances', numeric: true },
      { key: 'existing_lift' },
    ],
  },
  {
    key: 'shaft',
    fields: [
      { key: 'access_conditions' },
      { key: 'verticality_observations' },
      { key: 'obstructions' },
    ],
  },
  {
    key: 'machine_room',
    fields: [
      { key: 'availability' },
      { key: 'location' },
      { key: 'access' },
      { key: 'ventilation' },
    ],
  },
  {
    key: 'electrical',
    fields: [
      { key: 'supply_type' },
      { key: 'phase' },
      { key: 'voltage_measured_by_qualified_person' },
      { key: 'earthing' },
      { key: 'supply_readiness' },
    ],
  },
  {
    key: 'logistics',
    fields: [
      { key: 'material_access_route' },
      { key: 'storage_area' },
      { key: 'working_hours' },
      { key: 'crane_hoist' },
      { key: 'safety_hazards' },
    ],
  },
];

/** Measurements shown even when not required (labels: measure.<key>). */
const MEASUREMENT_KEYS = ['shaft_width', 'shaft_depth', 'pit_depth', 'overhead', 'entrance_width', 'entrance_height'];
const OPTIONAL_EVIDENCE = ['machine_room', 'shaft_level', 'check_in', 'other'];

export function SurveyScreen({ ctx, surveyId }: { ctx: AppContextValue; surveyId: string }) {
  const { t, field, dt } = useT();
  const [survey, setSurvey] = useState<CachedSurvey | null>(null);
  const [req, setReq] = useState<SurveyRequirements>(DEFAULT_SURVEY_REQUIREMENTS);
  const [draft, setDraft] = useState<LocalDraft | null>(null);
  const [ops, setOps] = useState<SyncOperation[]>([]);
  const [gpsReason, setGpsReason] = useState('');
  const [needsGpsReason, setNeedsGpsReason] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'crit'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const s = (await cachedWorkPackage()).find((x) => x.id === surveyId) ?? null;
    setSurvey(s);
    setReq(await cachedRequirements());
    setOps((await syncStore.all()).filter((o) => o.recordKey === `survey:${surveyId}` && o.status !== 'synced' && o.status !== 'discarded'));
    if (s?.revision) {
      const local = await getDraft(surveyId);
      // A local draft for the current revision wins (it holds unsynced edits); otherwise start from the server copy.
      setDraft(local && local.revisionId === s.revision.id ? local : { revisionId: s.revision.id, data: s.revision.data, measurements: s.revision.measurements, updatedAt: new Date().toISOString() });
    }
  }, [surveyId]);

  useEffect(() => {
    void reload();
  }, [reload, ctx.pending]);

  // Autosave every edit to the device (§23.3, safe form recovery after app closure).
  useEffect(() => {
    if (draft) void saveDraft(surveyId, draft);
  }, [draft, surveyId]);

  const pendingTypes = new Set(ops.map((o) => o.operationType));
  const pendingEvidence = ops.filter((o) => o.operationType === 'evidence.upload').map((o) => String((o.payload as { category: string }).category));
  // Optimistic stage for offline work — always labelled "waiting to sync", never as server-confirmed.
  const effective = useMemo(() => {
    if (!survey) return null;
    if (pendingTypes.has('survey.submit')) return 'submit_pending';
    if (survey.status === 'scheduled' && pendingTypes.has('survey.accept')) return pendingTypes.has('survey.check_in') ? 'in_progress' : 'accepted';
    if (survey.status === 'accepted' && pendingTypes.has('survey.check_in')) return 'in_progress';
    return survey.status;
  }, [survey, ops]); // eslint-disable-line react-hooks/exhaustive-deps

  const normalized = useMemo(
    () =>
      (draft?.measurements ?? []).flatMap((m) => {
        try {
          return [{ key: m.key, value_mm: toMillimetres(m.entered_value, m.entered_unit), entered_value: m.entered_value, entered_unit: m.entered_unit }];
        } catch {
          return [];
        }
      }),
    [draft],
  );
  const evidenceRefs = [...(survey?.evidenceCategories ?? []), ...pendingEvidence].map((category) => ({ category }));
  const validation = draft ? validateSurveySubmission(draft.data, normalized, evidenceRefs, req) : null;

  if (!survey) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Banner tone="warn">{t('mobile.not_in_work')}</Banner>
        <Button title={t('mobile.back')} kind="secondary" onPress={() => ctx.navigate({ name: 'list' })} />
      </View>
    );
  }

  const section = (key: string) => (draft?.data[key] as Record<string, unknown> | undefined) ?? {};
  const setField = (sectionKey: string, field: string, value: string, numeric?: boolean) =>
    setDraft((d) => {
      if (!d) return d;
      const v: unknown = numeric ? (value.trim() === '' ? null : /^\d+$/.test(value.trim()) ? Number(value.trim()) : value) : value;
      return { ...d, data: { ...d.data, [sectionKey]: { ...((d.data[sectionKey] as object) ?? {}), [field]: v } }, updatedAt: new Date().toISOString() };
    });
  const setMeasurement = (key: string, entered: string, unit?: LengthUnit) =>
    setDraft((d) => {
      if (!d) return d;
      const current = d.measurements.find((m) => m.key === key);
      const value = entered.trim() === '' ? NaN : Number(entered.replace(',', '.'));
      const rest = d.measurements.filter((m) => m.key !== key);
      const next = Number.isFinite(value) && value > 0 ? [...rest, { key, entered_value: value, entered_unit: unit ?? current?.entered_unit ?? 'mm', level_label: current?.level_label ?? '' }] : rest;
      return { ...d, measurements: next, updatedAt: new Date().toISOString() };
    });
  const docUnavailable = (doc: string) => ((draft?.data.documents_unavailable as Record<string, string> | undefined) ?? {})[doc] ?? '';

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } finally {
      setBusy(false);
      await reload();
    }
  }

  async function onlineAction(action: 'request_reschedule' | 'request_revisit' | 'report_inaccessible' | 'start_revision', needsReason: boolean) {
    if (!ctx.online) return setMessage({ tone: 'warn', text: t('mobile.needs_network') });
    if (needsReason && actionReason.trim().length < 3) return setMessage({ tone: 'crit', text: t('mobile.enter_reason') });
    await run(async () => {
      await ctx.syncNow(); // queued work first, in order
      const { error } = await supabase.rpc('survey_field_action', { p_survey_id: survey!.id, p_expected_version: survey!.version, p_action: action, p_reason: needsReason ? actionReason : null });
      if (error) {
        const code = fromServerError(error).code;
        setMessage({ tone: 'crit', text: `${t(`error.${code}.title`)}. ${t(`error.${code}.next`)}` });
      } else {
        setActionReason('');
        setMessage({ tone: 'ok', text: t('mobile.done') });
        const { refreshWorkPackage } = await import('../lib/field');
        await refreshWorkPackage(ctx.userId);
      }
    });
  }

  const canEdit = effective === 'in_progress';

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Button title={t('mobile.back_my_surveys')} kind="secondary" onPress={() => ctx.navigate({ name: 'list' })} />
      <Text accessibilityRole="header" style={styles.h1}>{survey.sites?.name ?? survey.survey_number}</Text>
      <View style={styles.row}>
        <Chip
          text={
            effective === 'submit_pending'
              ? t('mobile.submission_waiting')
              : effective !== survey.status
                ? t('mobile.waiting_suffix', { state: t(`survey.state.${effective}`) })
                : t(`survey.state.${effective}`)
          } tone={effective === survey.status ? 'info' : 'warn'} />
        {ops.length > 0 ? <Chip text={t('mobile.unsynced_changes', { count: ops.length })} tone="warn" /> : null}
      </View>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      <Card title={t('mobile.assignment')}>
        <Text style={styles.muted}>{survey.survey_number}</Text>
        <Text>{[survey.sites?.address_line, survey.sites?.locality, survey.sites?.city, survey.sites?.pincode].filter(Boolean).join(', ')}</Text>
        <Text>{dt(survey.scheduled_start)} → {dt(survey.scheduled_end)}</Text>
        <Text>{t('mobile.scope', { scope: survey.scope })}</Text>
        {survey.special_instructions ? <Text>{t('mobile.instructions', { text: survey.special_instructions })}</Text> : null}
        <Pressable accessibilityRole="link" onPress={() => survey.site_contact_phone && Linking.openURL(`tel:${survey.site_contact_phone}`)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.navyLight, fontWeight: '700' }}>
            {t('mobile.contact', { name: survey.site_contact_name })} {survey.site_contact_phone ? t('mobile.tap_to_call', { phone: formatPhone(survey.site_contact_phone) }) : ''}
          </Text>
        </Pressable>
        {survey.status_reason ? <Banner tone="warn">{t('mobile.note', { text: survey.status_reason })}</Banner> : null}
      </Card>

      {effective === 'scheduled' ? (
        <Card title={t('mobile.accept_assignment')}>
          <Button title={t('mobile.accept')} busy={busy} onPress={() => run(async () => { await enqueueSimple(ctx.userId, survey, 'survey.accept'); await ctx.syncNow(); })} />
          <LabeledInput label={t('mobile.reason_reschedule')} value={actionReason} onChangeText={setActionReason} />
          <Button title={t('mobile.request_reschedule')} kind="secondary" onPress={() => onlineAction('request_reschedule', true)} />
        </Card>
      ) : null}

      {effective === 'accepted' ? (
        <Card title={t('mobile.site_checkin')}>
          <Text style={styles.muted}>{t('mobile.checkin_intro')}</Text>
          {needsGpsReason ? <Banner tone="warn">{t('mobile.gps_not_verified', { status: t(`enum.gps.${needsGpsReason}`) })}</Banner> : null}
          {needsGpsReason ? <LabeledInput label={t('mobile.gps_reason')} required value={gpsReason} onChangeText={setGpsReason} /> : null}
          <Button
            title={t('mobile.check_in_now')}
            busy={busy}
            onPress={() =>
              run(async () => {
                const r = await enqueueCheckIn(ctx.userId, survey, needsGpsReason ? gpsReason : null);
                if (r.needsReason) setNeedsGpsReason(r.gps);
                else {
                  setNeedsGpsReason(null);
                  await ctx.syncNow();
                }
              })
            }
          />
          <LabeledInput label={t('mobile.reason_inaccessible')} value={actionReason} onChangeText={setActionReason} />
          <Button title={t('mobile.report_inaccessible')} kind="danger" onPress={() => onlineAction('report_inaccessible', true)} />
        </Card>
      ) : null}

      {effective === 'revision_requested' ? (
        <Card title={t('mobile.revision_requested')}>
          <Text>{t('mobile.revision_intro')}</Text>
          <Button title={t('mobile.start_revision')} onPress={() => onlineAction('start_revision', false)} />
        </Card>
      ) : null}

      {effective === 'submitted' || effective === 'submit_pending' ? (
        <Banner tone={effective === 'submitted' ? 'ok' : 'warn'}>
          {effective === 'submitted' ? t('mobile.submitted_locked') : t('mobile.submission_saved')}
        </Banner>
      ) : null}

      {canEdit && draft ? (
        <>
          {SECTIONS.map((s) => (
            <Card key={s.key} title={t(`survey.section.${s.key}`)}>
              {s.fields.map((f) => {
                const v = section(s.key)[f.key];
                return (
                  <LabeledInput
                    key={f.key}
                    label={t(`field.${s.key}.${f.key}`)}
                    required={req.required_fields.includes(`${s.key}.${f.key}`)}
                    placeholder={hasMessage(`hint.${s.key}.${f.key}`) ? t(`hint.${s.key}.${f.key}`) : t('mobile.unknown_placeholder')}
                    keyboardType={f.numeric ? 'number-pad' : 'default'}
                    value={v === null || v === undefined ? '' : String(v)}
                    onChangeText={(text) => setField(s.key, f.key, text, f.numeric)}
                  />
                );
              })}
            </Card>
          ))}

          <Card title={t('mobile.measurements')}>
            <Text style={styles.muted}>{t('mobile.measurements_intro')}</Text>
            {[...new Set([...req.required_measurements, ...MEASUREMENT_KEYS])].map((key) => {
              const m = draft.measurements.find((x) => x.key === key);
              const unit = m?.entered_unit ?? 'mm';
              return (
                <View key={key} style={{ marginBottom: 8 }}>
                  <LabeledInput
                    label={field(`measurement.${key}`)}
                    unit={unit}
                    required={req.required_measurements.includes(key)}
                    keyboardType="decimal-pad"
                    value={m ? String(m.entered_value) : ''}
                    onChangeText={(text) => setMeasurement(key, text)}
                  />
                  <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('mobile.unit_for', { label: field(`measurement.${key}`) })}>
                    {(['mm', 'cm', 'm'] as const).map((u) => (
                      <Pressable
                        key={u}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: unit === u }}
                        onPress={() => m && setMeasurement(key, String(m.entered_value), u)}
                        style={{ minWidth: 56, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center', backgroundColor: unit === u ? colors.navy : colors.white }}
                      >
                        <Text style={{ color: unit === u ? colors.white : colors.navy, fontWeight: '700' }}>{u}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </Card>

          <Card title={t('mobile.photo_evidence')}>
            {[...req.required_evidence, ...OPTIONAL_EVIDENCE].map((cat) => {
              const n = evidenceRefs.filter((e) => e.category === cat).length;
              return (
                <View key={cat} style={{ marginBottom: 8 }}>
                  <Text style={styles.label}>
                    {field(cat)} {req.required_evidence.includes(cat) ? t('mobile.required') : t('mobile.optional')} · {t('mobile.captured_count', { count: n })}
                  </Text>
                  <Button
                    title={n > 0 ? t('mobile.capture_another') : t('mobile.capture_photo')}
                    kind={n > 0 ? 'secondary' : 'primary'}
                    busy={busy}
                    onPress={() =>
                      run(async () => {
                        const r = await captureEvidence(ctx.userId, survey, cat);
                        if (r === 'denied') setMessage({ tone: 'crit', text: t('mobile.camera_denied') });
                        if (r === 'captured') await ctx.syncNow();
                      })
                    }
                  />
                </View>
              );
            })}
          </Card>

          <Card title={t('mobile.documents')}>
            <Text style={styles.muted}>{t('mobile.documents_intro')}</Text>
            {req.required_documents.map((doc) => {
              const n = evidenceRefs.filter((e) => e.category === doc).length;
              return (
                <View key={doc} style={{ marginBottom: 10 }}>
                  <Text style={styles.label}>{field(doc)} · {t('mobile.attached_count', { count: n })}</Text>
                  <Button title={t('mobile.photograph_document')} kind="secondary" busy={busy} onPress={() => run(async () => { await captureEvidence(ctx.userId, survey, doc); await ctx.syncNow(); })} />
                  {n === 0 ? (
                    <LabeledInput
                      label={t('mobile.doc_unavailable')}
                      value={docUnavailable(doc)}
                      onChangeText={(text) =>
                        setDraft((d) =>
                          d ? { ...d, data: { ...d.data, documents_unavailable: { ...((d.data.documents_unavailable as object) ?? {}), [doc]: text } }, updatedAt: new Date().toISOString() } : d,
                        )
                      }
                    />
                  ) : null}
                </View>
              );
            })}
          </Card>

          <Card title={t('mobile.review_submit')}>
            {validation ? (
              <>
                <Text style={styles.muted}>
                  {t('mobile.complete_count', { done: validation.completion.done, total: validation.completion.total })}
                </Text>
                {validation.failures.map((f) => (
                  <Banner key={f.message} tone="crit">
                    {f.messageKey ? t(f.messageKey) : t(`error.${f.code}.title`)}: {[...(f.fields ?? []), ...(f.missing ?? [])].map((x) => field(x)).join(', ')}
                  </Banner>
                ))}
                {validation.warnings.map((w) => (
                  <Banner key={w.key} tone="warn">{t(w.messageKey, { ...w.params, measure: field(`measurement.${w.key}`) })}</Banner>
                ))}
              </>
            ) : null}
            <Button
              title={t('mobile.save_server')}
              kind="secondary"
              busy={busy}
              onPress={() =>
                run(async () => {
                  await enqueueSimple(ctx.userId, survey, 'survey.save_draft', { data: draft.data, measurements: draft.measurements });
                  await ctx.syncNow();
                  setMessage({ tone: 'ok', text: ctx.online ? t('mobile.saved_online') : t('mobile.saved_offline') });
                })
              }
            />
            <Button
              title={t('mobile.submit_survey')}
              disabled={!validation || validation.failures.length > 0}
              busy={busy}
              accessibilityHint={t('mobile.submit_hint')}
              onPress={() =>
                run(async () => {
                  await enqueueSimple(ctx.userId, survey, 'survey.save_draft', { data: draft.data, measurements: draft.measurements });
                  await enqueueSimple(ctx.userId, survey, 'survey.submit');
                  await ctx.syncNow();
                })
              }
            />
            <LabeledInput label={t('mobile.reason_revisit')} value={actionReason} onChangeText={setActionReason} />
            <Button title={t('mobile.request_revisit')} kind="secondary" onPress={() => onlineAction('request_revisit', true)} />
            <Button title={t('mobile.report_inaccessible')} kind="danger" onPress={() => onlineAction('report_inaccessible', true)} />
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

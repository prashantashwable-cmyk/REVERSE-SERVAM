import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import {
  DEFAULT_SURVEY_REQUIREMENTS,
  errorMessage,
  formatDateTimeIST,
  formatPhone,
  fromServerError,
  t,
  toMillimetres,
  validateSurveySubmission,
  type LengthUnit,
  type SurveyRequirements,
  type SyncOperation,
} from '@aiec/domain';
import type { AppContextValue } from '../App';
import { getDraft, saveDraft, type LocalDraft } from '../lib/db';
import { cachedRequirements, cachedWorkPackage, captureEvidence, enqueueCheckIn, enqueueSimple, syncStore, type CachedSurvey } from '../lib/field';
import { supabase } from '../lib/supabase';
import { Banner, Button, Card, Chip, LabeledInput, colors, styles } from '../ui';

/** Survey sections (§8.5). Keys match the server's allowed sections and Gate 1 paths. */
const SECTIONS: { key: string; title: string; fields: { key: string; label: string; numeric?: boolean; hint?: string }[] }[] = [
  {
    key: 'building',
    title: 'Building',
    fields: [
      { key: 'usage', label: 'Building usage', hint: 'Residential / commercial / hospital…' },
      { key: 'floors', label: 'Floors', numeric: true },
      { key: 'stops', label: 'Stops', numeric: true },
      { key: 'construction_stage', label: 'Construction stage' },
      { key: 'structural_type', label: 'Structural type' },
      { key: 'entrances', label: 'Entrances / landings', numeric: true },
      { key: 'existing_lift', label: 'Existing lift (if any)' },
    ],
  },
  {
    key: 'shaft',
    title: 'Shaft',
    fields: [
      { key: 'access_conditions', label: 'Access conditions' },
      { key: 'verticality_observations', label: 'Verticality observations' },
      { key: 'obstructions', label: 'Obstructions' },
    ],
  },
  {
    key: 'machine_room',
    title: 'Machine room / drive',
    fields: [
      { key: 'availability', label: 'Availability', hint: 'Machine room / MRL / not decided' },
      { key: 'location', label: 'Location' },
      { key: 'access', label: 'Access' },
      { key: 'ventilation', label: 'Ventilation / environment' },
    ],
  },
  {
    key: 'electrical',
    title: 'Electrical',
    fields: [
      { key: 'supply_type', label: 'Supply type', hint: 'Permanent / temporary / none yet' },
      { key: 'phase', label: 'Phase', hint: 'Single / three' },
      { key: 'voltage_measured_by_qualified_person', label: 'Voltage (only if measured by a qualified person)' },
      { key: 'earthing', label: 'Earthing information' },
      { key: 'supply_readiness', label: 'Supply readiness' },
    ],
  },
  {
    key: 'logistics',
    title: 'Logistics & safety',
    fields: [
      { key: 'material_access_route', label: 'Material access route' },
      { key: 'storage_area', label: 'Storage area' },
      { key: 'working_hours', label: 'Working hours / restrictions' },
      { key: 'crane_hoist', label: 'Crane / hoist requirement' },
      { key: 'safety_hazards', label: 'Safety hazards observed' },
    ],
  },
];

const MEASUREMENT_LABELS: Record<string, string> = {
  shaft_width: 'Shaft width',
  shaft_depth: 'Shaft depth',
  pit_depth: 'Pit depth',
  overhead: 'Overhead',
  entrance_width: 'Entrance clear width',
  entrance_height: 'Entrance clear height',
};
const OPTIONAL_EVIDENCE = ['machine_room', 'shaft_level', 'check_in', 'other'];
const pretty = (s: string) => s.replace(/^doc_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function SurveyScreen({ ctx, surveyId }: { ctx: AppContextValue; surveyId: string }) {
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
        <Banner tone="warn">This survey is not in your saved work. Go back and pull to refresh.</Banner>
        <Button title="Back" kind="secondary" onPress={() => ctx.navigate({ name: 'list' })} />
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
    if (!ctx.online) return setMessage({ tone: 'warn', text: 'This action needs a network connection. Your captured work stays saved.' });
    if (needsReason && actionReason.trim().length < 3) return setMessage({ tone: 'crit', text: 'Enter a reason first.' });
    await run(async () => {
      await ctx.syncNow(); // queued work first, in order
      const { error } = await supabase.rpc('survey_field_action', { p_survey_id: survey!.id, p_expected_version: survey!.version, p_action: action, p_reason: needsReason ? actionReason : null });
      if (error) {
        const m = errorMessage(fromServerError(error).code);
        setMessage({ tone: 'crit', text: `${m.title}. ${m.nextAction}` });
      } else {
        setActionReason('');
        setMessage({ tone: 'ok', text: 'Done.' });
        const { refreshWorkPackage } = await import('../lib/field');
        await refreshWorkPackage(ctx.userId);
      }
    });
  }

  const canEdit = effective === 'in_progress';

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Button title="← My surveys" kind="secondary" onPress={() => ctx.navigate({ name: 'list' })} />
      <Text accessibilityRole="header" style={styles.h1}>{survey.sites?.name ?? survey.survey_number}</Text>
      <View style={styles.row}>
        <Chip text={effective === 'submit_pending' ? 'Submission waiting to sync' : t(`survey.state.${effective}`) + (effective !== survey.status ? ' (waiting to sync)' : '')} tone={effective === survey.status ? 'info' : 'warn'} />
        {ops.length > 0 ? <Chip text={`${ops.length} change(s) not yet synced`} tone="warn" /> : null}
      </View>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      <Card title="Assignment">
        <Text style={styles.muted}>{survey.survey_number}</Text>
        <Text>{[survey.sites?.address_line, survey.sites?.locality, survey.sites?.city, survey.sites?.pincode].filter(Boolean).join(', ')}</Text>
        <Text>{formatDateTimeIST(survey.scheduled_start)} → {formatDateTimeIST(survey.scheduled_end)}</Text>
        <Text>Scope: {survey.scope}</Text>
        {survey.special_instructions ? <Text>Instructions: {survey.special_instructions}</Text> : null}
        <Pressable accessibilityRole="link" onPress={() => survey.site_contact_phone && Linking.openURL(`tel:${survey.site_contact_phone}`)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.navyLight, fontWeight: '700' }}>
            Contact: {survey.site_contact_name} {survey.site_contact_phone ? `· ${formatPhone(survey.site_contact_phone)} (tap to call)` : ''}
          </Text>
        </Pressable>
        {survey.status_reason ? <Banner tone="warn">Note: {survey.status_reason}</Banner> : null}
      </Card>

      {effective === 'scheduled' ? (
        <Card title="Accept assignment">
          <Button title="Accept" busy={busy} onPress={() => run(async () => { await enqueueSimple(ctx.userId, survey, 'survey.accept'); await ctx.syncNow(); })} />
          <LabeledInput label="Reason (for reschedule)" value={actionReason} onChangeText={setActionReason} />
          <Button title="Request reschedule" kind="secondary" onPress={() => onlineAction('request_reschedule', true)} />
        </Card>
      ) : null}

      {effective === 'accepted' ? (
        <Card title="Site check-in">
          <Text style={styles.muted}>Records your location (with accuracy), the device time and the server receipt time. If location is unavailable, explain why — a location is never invented.</Text>
          {needsGpsReason ? <Banner tone="warn">Location not verified ({needsGpsReason.replace(/_/g, ' ')}). Enter the reason to continue.</Banner> : null}
          {needsGpsReason ? <LabeledInput label="Why is location unavailable?" required value={gpsReason} onChangeText={setGpsReason} /> : null}
          <Button
            title="Check in now"
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
          <LabeledInput label="Reason (if site inaccessible)" value={actionReason} onChangeText={setActionReason} />
          <Button title="Report site inaccessible" kind="danger" onPress={() => onlineAction('report_inaccessible', true)} />
        </Card>
      ) : null}

      {effective === 'revision_requested' ? (
        <Card title="Revision requested">
          <Text>Technical review returned this survey. Correct the data and resubmit; the earlier version is kept.</Text>
          <Button title="Start revision" onPress={() => onlineAction('start_revision', false)} />
        </Card>
      ) : null}

      {effective === 'submitted' || effective === 'submit_pending' ? (
        <Banner tone={effective === 'submitted' ? 'ok' : 'warn'}>
          {effective === 'submitted' ? 'Submitted and locked — awaiting technical review.' : 'Submission is saved on this device and will be sent when online. It is NOT submitted yet.'}
        </Banner>
      ) : null}

      {canEdit && draft ? (
        <>
          {SECTIONS.map((s) => (
            <Card key={s.key} title={s.title}>
              {s.fields.map((f) => {
                const v = section(s.key)[f.key];
                return (
                  <LabeledInput
                    key={f.key}
                    label={f.label}
                    required={req.required_fields.includes(`${s.key}.${f.key}`)}
                    placeholder={f.hint ?? 'Unknown / to be confirmed'}
                    keyboardType={f.numeric ? 'number-pad' : 'default'}
                    value={v === null || v === undefined ? '' : String(v)}
                    onChangeText={(text) => setField(s.key, f.key, text, f.numeric)}
                  />
                );
              })}
            </Card>
          ))}

          <Card title="Measurements">
            <Text style={styles.muted}>Enter each value with its unit. Stored in mm; your entered value and unit are kept. Range checks are hints, not engineering approval.</Text>
            {[...new Set([...req.required_measurements, ...Object.keys(MEASUREMENT_LABELS)])].map((key) => {
              const m = draft.measurements.find((x) => x.key === key);
              const unit = m?.entered_unit ?? 'mm';
              return (
                <View key={key} style={{ marginBottom: 8 }}>
                  <LabeledInput
                    label={MEASUREMENT_LABELS[key] ?? pretty(key)}
                    unit={unit}
                    required={req.required_measurements.includes(key)}
                    keyboardType="decimal-pad"
                    value={m ? String(m.entered_value) : ''}
                    onChangeText={(text) => setMeasurement(key, text)}
                  />
                  <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={`Unit for ${MEASUREMENT_LABELS[key] ?? key}`}>
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

          <Card title="Photo evidence">
            {[...req.required_evidence, ...OPTIONAL_EVIDENCE].map((cat) => {
              const n = evidenceRefs.filter((e) => e.category === cat).length;
              return (
                <View key={cat} style={{ marginBottom: 8 }}>
                  <Text style={styles.label}>
                    {pretty(cat)} {req.required_evidence.includes(cat) ? '(required)' : '(optional)'} · {n} captured
                  </Text>
                  <Button
                    title={n > 0 ? 'Capture another' : 'Capture photo'}
                    kind={n > 0 ? 'secondary' : 'primary'}
                    busy={busy}
                    onPress={() =>
                      run(async () => {
                        const r = await captureEvidence(ctx.userId, survey, cat);
                        if (r === 'denied') setMessage({ tone: 'crit', text: 'Camera permission is needed to capture evidence.' });
                        if (r === 'captured') await ctx.syncNow();
                      })
                    }
                  />
                </View>
              );
            })}
          </Card>

          <Card title="Documents">
            <Text style={styles.muted}>Photograph each document, or record why it is unavailable.</Text>
            {req.required_documents.map((doc) => {
              const n = evidenceRefs.filter((e) => e.category === doc).length;
              return (
                <View key={doc} style={{ marginBottom: 10 }}>
                  <Text style={styles.label}>{pretty(doc)} · {n} attached</Text>
                  <Button title="Photograph document" kind="secondary" busy={busy} onPress={() => run(async () => { await captureEvidence(ctx.userId, survey, doc); await ctx.syncNow(); })} />
                  {n === 0 ? (
                    <LabeledInput
                      label="Or: why is it unavailable?"
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

          <Card title="Review and submit">
            {validation ? (
              <>
                <Text style={styles.muted}>
                  Complete: {validation.completion.done} of {validation.completion.total}
                </Text>
                {validation.failures.map((f) => (
                  <Banner key={f.message} tone="crit">
                    {f.message}: {[...(f.fields ?? []), ...(f.missing ?? [])].map((x) => pretty(x.replace(/^measurement\./, ''))).join(', ')}
                  </Banner>
                ))}
                {validation.warnings.map((w) => (
                  <Banner key={w.key} tone="warn">{w.message}</Banner>
                ))}
              </>
            ) : null}
            <Button
              title="Save to server"
              kind="secondary"
              busy={busy}
              onPress={() =>
                run(async () => {
                  await enqueueSimple(ctx.userId, survey, 'survey.save_draft', { data: draft.data, measurements: draft.measurements });
                  await ctx.syncNow();
                  setMessage({ tone: 'ok', text: ctx.online ? 'Saved. Check the sync queue for confirmation.' : 'Saved on device; will sync when online.' });
                })
              }
            />
            <Button
              title="Submit survey"
              disabled={!validation || validation.failures.length > 0}
              busy={busy}
              accessibilityHint="Locks this survey version and sends it for technical review"
              onPress={() =>
                run(async () => {
                  await enqueueSimple(ctx.userId, survey, 'survey.save_draft', { data: draft.data, measurements: draft.measurements });
                  await enqueueSimple(ctx.userId, survey, 'survey.submit');
                  await ctx.syncNow();
                })
              }
            />
            <LabeledInput label="Reason (for revisit / inaccessible)" value={actionReason} onChangeText={setActionReason} />
            <Button title="Request revisit" kind="secondary" onPress={() => onlineAction('request_revisit', true)} />
            <Button title="Report site inaccessible" kind="danger" onPress={() => onlineAction('report_inaccessible', true)} />
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  DEFAULT_SURVEY_REQUIREMENTS,
  DomainError,
  SyncQueue,
  classifyGps,
  fromServerError,
  type SurveyRequirements,
  type SyncOperation,
} from '@aiec/domain';
import { SqliteSyncStore, kvGet, kvSet } from './db';
import { supabase } from './supabase';

/** States in which a survey belongs in the surveyor's work package. */
export const ACTIVE_STATES = ['scheduled', 'accepted', 'in_progress', 'revision_requested', 'reschedule_requested', 'revisit_requested', 'site_inaccessible', 'submitted'];

export interface CachedSurvey {
  id: string;
  organization_id: string;
  survey_number: string;
  status: string;
  version: number;
  scheduled_start: string;
  scheduled_end: string;
  scope: string;
  special_instructions: string | null;
  site_contact_name: string;
  site_contact_phone: string | null;
  current_revision_id: string | null;
  gps_status: string | null;
  status_reason: string | null;
  sites: { name: string; address_line: string | null; locality: string | null; city: string; pincode: string | null } | null;
  revision: { id: string; version: number; status: string; data: Record<string, unknown>; measurements: { key: string; entered_value: number; entered_unit: 'mm' | 'cm' | 'm'; level_label: string }[] } | null;
  evidenceCategories: string[];
}

export const syncStore = new SqliteSyncStore();
export const queue = new SyncQueue(syncStore);

function asDomainError(err: { message?: string; details?: string | null; code?: string } | null): DomainError {
  return fromServerError(err ?? undefined);
}

/** Download the assigned work package (online). Cached for offline use. */
export async function refreshWorkPackage(userId: string): Promise<CachedSurvey[]> {
  const { data: surveys, error } = await supabase
    .from('surveys')
    .select('id, organization_id, survey_number, status, version, scheduled_start, scheduled_end, scope, special_instructions, site_contact_name, site_contact_phone, current_revision_id, gps_status, status_reason, sites(name, address_line, locality, city, pincode)')
    .eq('surveyor_id', userId)
    .in('status', ACTIVE_STATES)
    .order('scheduled_start');
  if (error) throw asDomainError(error);
  const list = (surveys ?? []) as unknown as Omit<CachedSurvey, 'revision' | 'evidenceCategories'>[];
  const revisionIds = list.map((s) => s.current_revision_id).filter((x): x is string => !!x);
  const ids = list.map((s) => s.id);
  const [revs, ev, rule] = await Promise.all([
    revisionIds.length
      ? supabase.from('survey_revisions').select('id, version, status, data, survey_measurements(key, entered_value, entered_unit, level_label)').in('id', revisionIds)
      : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from('evidence_files').select('survey_id, category').in('survey_id', ids).eq('status', 'active') : Promise.resolve({ data: [], error: null }),
    supabase.from('business_rules').select('value, version').eq('rule_key', 'survey.requirements').order('version', { ascending: false }).limit(1),
  ]);
  if (revs.error) throw asDomainError(revs.error);
  if (ev.error) throw asDomainError(ev.error);
  const revById = new Map((revs.data ?? []).map((r: any) => [r.id, r]));
  const out: CachedSurvey[] = list.map((s) => {
    const r: any = s.current_revision_id ? revById.get(s.current_revision_id) : null;
    return {
      ...s,
      revision: r
        ? { id: r.id, version: r.version, status: r.status, data: r.data ?? {}, measurements: (r.survey_measurements ?? []).map((m: any) => ({ ...m, entered_value: Number(m.entered_value) })) }
        : null,
      evidenceCategories: [...new Set((ev.data ?? []).filter((e: any) => e.survey_id === s.id).map((e: any) => e.category as string))],
    };
  });
  await kvSet('work_package', out);
  if (!rule.error && rule.data?.[0]) await kvSet('survey_requirements', rule.data[0].value);
  return out;
}

export async function cachedWorkPackage(): Promise<CachedSurvey[]> {
  return (await kvGet<CachedSurvey[]>('work_package')) ?? [];
}

export async function cachedRequirements(): Promise<SurveyRequirements> {
  return (await kvGet<SurveyRequirements>('survey_requirements')) ?? DEFAULT_SURVEY_REQUIREMENTS;
}

/** Update the cached survey after a server acknowledgement (never before). */
async function patchCached(surveyId: string, patch: (s: CachedSurvey) => CachedSurvey): Promise<void> {
  const list = await cachedWorkPackage();
  await kvSet('work_package', list.map((s) => (s.id === surveyId ? patch(s) : s)));
}

async function knownSurvey(surveyId: string): Promise<CachedSurvey> {
  const s = (await cachedWorkPackage()).find((x) => x.id === surveyId);
  if (!s) throw new DomainError('NOT_FOUND');
  return s;
}

/* ------------------------------ capture helpers ----------------------------- */

export async function currentPosition(): Promise<{ permission: 'granted' | 'denied' | 'undetermined'; latitude: number | null; longitude: number | null; accuracy: number | null }> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return { permission: perm.status === 'denied' ? 'denied' : 'undetermined', latitude: null, longitude: null, accuracy: null };
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { permission: 'granted', latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
  } catch {
    // GPS unavailable: report it honestly; never fabricate a location.
    return { permission: 'granted', latitude: null, longitude: null, accuracy: null };
  }
}

export async function enqueueCheckIn(userId: string, survey: CachedSurvey, exceptionReason: string | null) {
  const pos = await currentPosition();
  const local = classifyGps({ permission: pos.permission, latitude: pos.latitude, longitude: pos.longitude, accuracyM: pos.accuracy });
  if (local !== 'verified' && !(exceptionReason && exceptionReason.trim().length >= 3)) {
    return { needsReason: true as const, gps: local };
  }
  await queue.enqueue({
    operationId: Crypto.randomUUID(),
    userId,
    organizationId: survey.organization_id,
    operationType: 'survey.check_in',
    recordKey: `survey:${survey.id}`,
    baseRevision: survey.version,
    payload: {
      p_survey_id: survey.id,
      p_location_permission: pos.permission,
      p_latitude: pos.latitude,
      p_longitude: pos.longitude,
      p_accuracy_m: pos.accuracy,
      p_client_time: new Date().toISOString(),
      p_exception_reason: local === 'verified' ? null : exceptionReason,
    },
  });
  return { needsReason: false as const, gps: local };
}

export async function enqueueSimple(userId: string, survey: CachedSurvey, operationType: 'survey.accept' | 'survey.save_draft' | 'survey.submit', payload: Record<string, unknown> = {}) {
  await queue.enqueue({
    operationId: Crypto.randomUUID(),
    userId,
    organizationId: survey.organization_id,
    operationType,
    recordKey: `survey:${survey.id}`,
    baseRevision: survey.revision?.version ?? survey.version,
    payload: { survey_id: survey.id, ...payload },
  });
}

const evidenceDir = () => {
  const d = new Directory(Paths.document, 'evidence');
  if (!d.exists) d.create({ idempotent: true, intermediates: true });
  return d;
};

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Camera-first evidence (§8.6, §38 SV05): capture → copy into durable app
 * storage → hash → queue upload + registration. Works fully offline.
 */
export async function captureEvidence(userId: string, survey: CachedSurvey, category: string): Promise<'captured' | 'cancelled' | 'denied'> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return 'denied';
  const shot = await ImagePicker.launchCameraAsync({ quality: 0.7, exif: false });
  if (shot.canceled || !shot.assets[0]) return 'cancelled';
  const asset = shot.assets[0];
  const capturedAt = new Date().toISOString();
  const pos = await currentPosition();

  const operationId = Crypto.randomUUID();
  const durable = new File(evidenceDir(), `${operationId}.jpg`);
  await new File(asset.uri).copy(durable);
  const bytes = await durable.bytes();
  const sha256 = hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));

  await queue.enqueue({
    operationId,
    userId,
    organizationId: survey.organization_id,
    operationType: 'evidence.upload',
    recordKey: `survey:${survey.id}`,
    baseRevision: null,
    fileRefs: [durable.uri],
    payload: {
      survey_id: survey.id,
      local_uri: durable.uri,
      storage_path: `${survey.organization_id}/surveys/${survey.id}/${operationId}.jpg`,
      category,
      sha256,
      mime_type: 'image/jpeg',
      size_bytes: bytes.byteLength,
      captured_at: capturedAt,
      latitude: pos.latitude,
      longitude: pos.longitude,
      accuracy_m: pos.accuracy,
      source: 'in_app_camera',
    },
  });
  return 'captured';
}

/* --------------------------------- sender ---------------------------------- */

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw asDomainError(error);
  return data as Record<string, unknown>;
}

/** Sends one queued operation. Every server call is idempotent or version-checked. */
export async function sendOperation(op: SyncOperation): Promise<unknown> {
  const p = op.payload as Record<string, any>;
  switch (op.operationType) {
    case 'survey.accept': {
      const s = await knownSurvey(p.survey_id);
      try {
        const r = await rpc('survey_field_action', { p_survey_id: s.id, p_expected_version: s.version, p_action: 'accept' });
        await patchCached(s.id, (x) => ({ ...x, status: String(r.status), version: Number(r.version) }));
        return r;
      } catch (e) {
        // A lost response followed by a retry: if the server already moved on, the accept happened.
        if (e instanceof DomainError && (e.code === 'REVISION_CONFLICT' || e.code === 'INVALID_STATE_TRANSITION')) {
          const { data } = await supabase.from('surveys').select('status, version').eq('id', s.id).maybeSingle();
          if (data && data.status !== 'scheduled') {
            await patchCached(s.id, (x) => ({ ...x, status: data.status, version: data.version }));
            return data;
          }
        }
        throw e;
      }
    }
    case 'survey.check_in': {
      const r = await rpc('check_in_survey', { p_operation_id: op.operationId, ...p });
      await patchCached(String(p.p_survey_id), (x) => ({ ...x, status: String(r.status), version: Number(r.version), gps_status: (r.gps_status as string) ?? null }));
      return r;
    }
    case 'evidence.upload': {
      const file = new File(String(p.local_uri));
      if (!file.exists) throw new DomainError('FILE_UPLOAD_FAILED', 'local evidence file missing'); // i18n-ignore: developer diagnostic
      const bytes = await file.bytes();
      const up = await supabase.storage.from('evidence').upload(String(p.storage_path), bytes, { contentType: String(p.mime_type), upsert: false });
      // "Already exists" after a lost response is success: the path is unique per operation id.
      if (up.error && !/exist|duplicate/i.test(up.error.message)) throw new DomainError('FILE_UPLOAD_FAILED');
      const r = await rpc('register_evidence', {
        p_operation_id: op.operationId,
        p_survey_id: p.survey_id,
        p_payload: {
          category: p.category,
          storage_path: p.storage_path,
          sha256: p.sha256,
          mime_type: p.mime_type,
          size_bytes: p.size_bytes,
          captured_at: p.captured_at,
          latitude: p.latitude,
          longitude: p.longitude,
          accuracy_m: p.accuracy_m,
          source: p.source,
          device_meta: { app: 'aiec-field' },
        },
      });
      await patchCached(String(p.survey_id), (x) => ({ ...x, evidenceCategories: [...new Set([...x.evidenceCategories, String(p.category)])] }));
      return r;
    }
    case 'survey.save_draft': {
      const s = await knownSurvey(p.survey_id);
      if (!s.revision) throw new DomainError('REVISION_CONFLICT');
      const r = await rpc('save_survey_draft', {
        p_operation_id: op.operationId,
        p_survey_id: s.id,
        p_revision_id: s.revision.id,
        p_expected_revision_version: s.revision.version,
        p_data: p.data,
        p_measurements: p.measurements,
      });
      await patchCached(s.id, (x) => (x.revision ? { ...x, revision: { ...x.revision, version: Number(r.revision_version), data: p.data, measurements: p.measurements } } : x));
      return r;
    }
    case 'survey.submit': {
      const s = await knownSurvey(p.survey_id);
      const r = await rpc('submit_survey', { p_operation_id: op.operationId, p_survey_id: s.id, p_expected_revision_version: s.revision?.version ?? null });
      await patchCached(s.id, (x) => ({ ...x, status: String(r.status), version: Number(r.version) }));
      return r;
    }
    default:
      throw new DomainError('VALIDATION_FAILED', `unknown operation ${op.operationType}`);
  }
}

export async function pendingCount(): Promise<number> {
  return (await syncStore.all()).filter((o) => o.status !== 'synced' && o.status !== 'discarded').length;
}

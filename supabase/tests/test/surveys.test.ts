import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_SURVEY_REQUIREMENTS } from '@aiec/domain';
import { Session, admin, expectCode, makePool } from '../src/db';
import type { UserKey } from '../src/fixture';
import { leadPayload } from '../src/payloads';

const fx = inject('fixture');
const pool = makePool();
afterAll(() => pool.end());
const as = (u: UserKey) => new Session(pool, fx.users[u]);

let slot = 0;
/** Non-overlapping 2-hour appointments, starting tomorrow. */
function nextSlot() {
  const start = new Date(Date.now() + 864e5 + slot * 3 * 3600e3);
  slot++;
  return { start: start.toISOString(), end: new Date(start.getTime() + 2 * 3600e3).toISOString() };
}

async function qualifiedLead(owner: UserKey = 'sales1') {
  const s = as(owner);
  const r = await s.rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() });
  const c = await s.rpc('record_lead_activity', {
    p_operation_id: randomUUID(), p_lead_id: r.lead_id, p_activity_type: 'call', p_outcome: 'survey_required',
    p_summary: 'Needs site survey', p_occurred_at: new Date().toISOString(), p_next_follow_up_at: new Date(Date.now() + 864e5).toISOString(),
  });
  const q = await s.rpc('qualify_lead', {
    p_lead_id: r.lead_id, p_expected_version: c.version,
    p_qualification: { need: 'Passenger lift', decision_authority: 'confirmed', timeline: 'within_3_months', next_action: 'Survey' },
  });
  return { leadId: r.lead_id as string, version: q.version as number };
}

async function scheduled(surveyor: UserKey = 'surveyor1') {
  const { leadId } = await qualifiedLead();
  const { start, end } = nextSlot();
  const s = await as('sales1').rpc('schedule_survey', {
    p_operation_id: randomUUID(), p_lead_id: leadId, p_surveyor_id: fx.users[surveyor], p_scheduled_start: start,
    p_scheduled_end: end, p_scope: 'New lift survey, full shaft', p_site_contact_name: 'Society Secretary', p_site_contact_phone: '9811111111',
  });
  return { leadId, survey: s, start, end };
}

async function inProgress(surveyor: UserKey = 'surveyor1') {
  const { survey, leadId } = await scheduled(surveyor);
  const sv = as(surveyor);
  const a = await sv.rpc('survey_field_action', { p_survey_id: survey.survey_id, p_expected_version: survey.version, p_action: 'accept' });
  const c = await sv.rpc('check_in_survey', {
    p_operation_id: randomUUID(), p_survey_id: survey.survey_id, p_location_permission: 'granted',
    p_latitude: 18.5591, p_longitude: 73.7868, p_accuracy_m: 8, p_client_time: new Date().toISOString(),
  });
  expect(a.status).toBe('accepted');
  return { leadId, surveyId: survey.survey_id as string, revisionId: c.current_revision_id as string, gps: c.gps_status };
}

const COMPLETE_DATA = {
  building: { usage: 'residential', floors: 5, stops: 5, construction_stage: 'structure_complete' },
  shaft: { access_conditions: 'clear, scaffold available' },
  machine_room: { availability: 'mrl' },
  electrical: { supply_type: 'temporary', phase: 'three' },
  logistics: { material_access_route: 'main gate, 4 m wide', safety_hazards: 'open shaft edges at upper floors' },
  documents_unavailable: Object.fromEntries(DEFAULT_SURVEY_REQUIREMENTS.required_documents.map((d) => [d, 'Builder to share after approval'])),
};
const COMPLETE_MEASUREMENTS = [
  { key: 'shaft_width', entered_value: 1800, entered_unit: 'mm' },
  { key: 'shaft_depth', entered_value: 1.9, entered_unit: 'm' },
  { key: 'pit_depth', entered_value: 150, entered_unit: 'cm' },
  { key: 'overhead', entered_value: 3600, entered_unit: 'mm' },
  { key: 'entrance_width', entered_value: 900, entered_unit: 'mm' },
  { key: 'entrance_height', entered_value: 2100, entered_unit: 'mm' },
];

async function revisionVersion(revisionId: string) {
  const [r] = await admin<{ version: number }>(pool, 'select version from public.survey_revisions where id = $1', [revisionId]);
  return r!.version;
}

/** Upload (through storage RLS, as the surveyor) then register the evidence. */
async function addEvidence(surveyor: UserKey, surveyId: string, category: string, extra: Record<string, unknown> = {}) {
  const op = randomUUID();
  const path = `${fx.orgs.aiec}/surveys/${surveyId}/${op}.jpg`;
  await as(surveyor).query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('evidence', $1, $2, $3)`, [
    path, fx.users[surveyor], { size: 2048, mimetype: 'image/jpeg' },
  ]);
  return as(surveyor).rpc('register_evidence', {
    p_operation_id: op,
    p_survey_id: surveyId,
    p_payload: {
      category, storage_path: path, sha256: createHash('sha256').update(op).digest('hex'), mime_type: 'image/jpeg', size_bytes: 2048,
      captured_at: new Date().toISOString(), latitude: 18.5591, longitude: 73.7868, accuracy_m: 6, source: 'in_app_camera', ...extra,
    },
  });
}

describe('Slice 2 — survey scheduling and field visibility', () => {
  it('a survey can only be booked for a qualified lead in the scheduler’s book, without double-booking', async () => {
    const r = await as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() });
    const { start, end } = nextSlot();
    const args = { p_operation_id: randomUUID(), p_lead_id: r.lead_id, p_surveyor_id: fx.users.surveyor2, p_scheduled_start: start, p_scheduled_end: end, p_scope: 'Survey' };
    await expectCode(as('sales1').rpc('schedule_survey', args), 'INVALID_STATE_TRANSITION');

    const q = await qualifiedLead();
    await expectCode(as('sales2').rpc('schedule_survey', { ...args, p_lead_id: q.leadId }), 'NOT_FOUND');
    await expectCode(as('sales1').rpc('schedule_survey', { ...args, p_lead_id: q.leadId, p_surveyor_id: fx.users.sales2 }), 'VALIDATION_FAILED');
    const ok = await as('sales1').rpc('schedule_survey', { ...args, p_lead_id: q.leadId });
    expect(ok.survey_number).toMatch(/^SV-PUN-\d{4}-\d{5}$/);

    const q2 = await qualifiedLead();
    const overlap = { ...args, p_operation_id: randomUUID(), p_lead_id: q2.leadId, p_scheduled_start: new Date(Date.parse(start) + 3600e3).toISOString(), p_scheduled_end: new Date(Date.parse(end) + 3600e3).toISOString() };
    await expectCode(as('sales1').rpc('schedule_survey', overlap), 'SCHEDULE_CONFLICT');
    const n = await as('surveyor2').query('select event_type from public.notifications where entity_id = $1', [ok.survey_id]);
    expect(n).toEqual([{ event_type: 'survey.scheduled' }]);
  });

  it('the assigned surveyor sees the survey and site — but not the sales lead, its activities or other surveys', async () => {
    const { survey, leadId } = await scheduled('surveyor1');
    const s1 = as('surveyor1');
    const [row] = await s1.query('select site_contact_name, site_contact_phone from public.surveys where id = $1', [survey.survey_id]);
    expect(row).toEqual({ site_contact_name: 'Society Secretary', site_contact_phone: '+919811111111' });
    expect(await s1.query('select 1 from public.sites s join public.surveys v on v.site_id = s.id where v.id = $1', [survey.survey_id])).toHaveLength(1);
    expect(await s1.query('select 1 from public.leads where id = $1', [leadId])).toEqual([]);
    expect(await s1.query('select 1 from public.lead_activities where lead_id = $1', [leadId])).toEqual([]);
    expect(await as('surveyor2').query('select 1 from public.surveys where id = $1', [survey.survey_id])).toEqual([]);
    for (const u of ['partnerA_admin', 'partnerA_tech', 'customer1'] as const) {
      expect(await as(u).query('select 1 from public.surveys'), u).toEqual([]);
    }
    // Lead owner and technical reviewers can follow it.
    expect(await as('sales1').query('select 1 from public.surveys where id = $1', [survey.survey_id])).toHaveLength(1);
    expect(await as('tech1').query('select 1 from public.surveys where id = $1', [survey.survey_id])).toHaveLength(1);
    // Another surveyor cannot act on it.
    await expectCode(as('surveyor2').rpc('survey_field_action', { p_survey_id: survey.survey_id, p_expected_version: survey.version, p_action: 'accept' }), 'NOT_FOUND');
  });

  it('reschedule requests notify the lead owner; sales reschedules; cancellation needs a reason', async () => {
    const { survey } = await scheduled('surveyor2');
    const rr = await as('surveyor2').rpc('survey_field_action', { p_survey_id: survey.survey_id, p_expected_version: survey.version, p_action: 'request_reschedule', p_reason: 'Clash with another site' });
    expect(rr.status).toBe('reschedule_requested');
    expect(await as('sales1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'survey.reschedule_requested'`, [survey.survey_id])).toHaveLength(1);
    const { start, end } = nextSlot();
    const rs = await as('sales1').rpc('reschedule_survey', { p_survey_id: survey.survey_id, p_expected_version: rr.version, p_scheduled_start: start, p_scheduled_end: end });
    expect(rs.status).toBe('scheduled');
    await expectCode(as('sales1').rpc('cancel_survey', { p_survey_id: survey.survey_id, p_expected_version: rs.version, p_reason: '' }), 'REQUIRED_FIELD_MISSING');
    expect((await as('sales1').rpc('cancel_survey', { p_survey_id: survey.survey_id, p_expected_version: rs.version, p_reason: 'Customer postponed' })).status).toBe('cancelled');
  });
});

describe('Slice 2 — check-in, capture, evidence and Gate 1', () => {
  it('GPS is classified by the server; exceptions need a reason; location is never fabricated', async () => {
    const { survey } = await scheduled('surveyor1');
    const sv = as('surveyor1');
    const a = await sv.rpc('survey_field_action', { p_survey_id: survey.survey_id, p_expected_version: survey.version, p_action: 'accept' });
    const base = { p_operation_id: randomUUID(), p_survey_id: survey.survey_id, p_client_time: new Date().toISOString() };
    const e = await expectCode(sv.rpc('check_in_survey', { ...base, p_location_permission: 'granted', p_latitude: 18.5, p_longitude: 73.8, p_accuracy_m: 120 }), 'REQUIRED_FIELD_MISSING');
    expect(e.detail.gps_status).toBe('low_accuracy');
    await expectCode(sv.rpc('check_in_survey', { ...base, p_operation_id: randomUUID(), p_location_permission: 'denied', p_latitude: null, p_longitude: null, p_accuracy_m: null }), 'REQUIRED_FIELD_MISSING');
    const c = await sv.rpc('check_in_survey', { ...base, p_operation_id: randomUUID(), p_location_permission: 'denied', p_latitude: 18.5, p_longitude: 73.8, p_accuracy_m: 3, p_exception_reason: 'Basement shaft, no permission prompt' });
    expect(c).toMatchObject({ status: 'in_progress', gps_status: 'permission_denied' });
    const [row] = await admin(pool, 'select check_in_location, checked_in_at, check_in_client_time from public.surveys where id = $1', [survey.survey_id]);
    expect(row.check_in_location).toBeNull(); // coordinates sent without permission are discarded
    expect(row.checked_in_at).not.toBeNull();
    expect(a.version).toBeLessThan(c.version);
    // Exception review: not by the surveyor; once by an authorized reviewer.
    await expectCode(sv.rpc('review_gps_exception', { p_survey_id: survey.survey_id, p_decision: 'accepted', p_note: 'self' }), 'ACCESS_DENIED');
    await as('tech1').rpc('review_gps_exception', { p_survey_id: survey.survey_id, p_decision: 'accepted', p_note: 'Photo matches site' });
    await expectCode(as('tech1').rpc('review_gps_exception', { p_survey_id: survey.survey_id, p_decision: 'rejected', p_note: 'again' }), 'INVALID_STATE_TRANSITION');
  });

  it('drafts autosave with optimistic concurrency; the server normalizes units', async () => {
    const { surveyId, revisionId } = await inProgress('surveyor1');
    const sv = as('surveyor1');
    const v1 = await revisionVersion(revisionId);
    const saved = await sv.rpc('save_survey_draft', {
      p_operation_id: randomUUID(), p_survey_id: surveyId, p_revision_id: revisionId, p_expected_revision_version: v1,
      p_data: { building: { usage: 'residential' } }, p_measurements: COMPLETE_MEASUREMENTS,
    });
    expect(saved.revision_version).toBe(v1 + 1);
    expect(saved.failures.map((f: any) => f.code)).toEqual(['REQUIRED_FIELD_MISSING', 'EVIDENCE_REQUIRED', 'EVIDENCE_REQUIRED']);
    const m = await admin(pool, 'select key, value_mm::text, entered_value::text, entered_unit from public.survey_measurements where revision_id = $1 order by key', [revisionId]);
    expect(m.find((x: any) => x.key === 'shaft_depth')).toEqual({ key: 'shaft_depth', value_mm: '1900.0', entered_value: '1.900', entered_unit: 'm' });
    expect(m.find((x: any) => x.key === 'pit_depth')).toMatchObject({ value_mm: '1500.0', entered_unit: 'cm' });

    // A second device with a stale version gets a conflict, not a silent overwrite.
    const err = await expectCode(sv.rpc('save_survey_draft', {
      p_operation_id: randomUUID(), p_survey_id: surveyId, p_revision_id: revisionId, p_expected_revision_version: v1, p_data: {}, p_measurements: [],
    }), 'REVISION_CONFLICT');
    expect(err.detail).toEqual({ expected: v1, current: v1 + 1 });
    await expectCode(sv.rpc('save_survey_draft', {
      p_operation_id: randomUUID(), p_survey_id: surveyId, p_revision_id: revisionId, p_expected_revision_version: v1 + 1, p_data: { pricing: { x: 1 } }, p_measurements: null,
    }), 'VALIDATION_FAILED');
    await expectCode(sv.rpc('save_survey_draft', {
      p_operation_id: randomUUID(), p_survey_id: surveyId, p_revision_id: revisionId, p_expected_revision_version: v1 + 1, p_data: {},
      p_measurements: [{ key: 'pit_depth', entered_value: -1, entered_unit: 'm' }],
    }), 'VALIDATION_FAILED');
    await expectCode(sv.rpc('save_survey_draft', {
      p_operation_id: randomUUID(), p_survey_id: surveyId, p_revision_id: revisionId, p_expected_revision_version: v1 + 1, p_data: {},
      p_measurements: [{ key: 'pit_depth', entered_value: 1, entered_unit: 'ft' }],
    }), 'VALIDATION_FAILED');
  });

  it('evidence: storage policies, path binding, camera-first rule, idempotent registration, supersession', async () => {
    const { surveyId } = await inProgress('surveyor1');
    const other = await inProgress('surveyor2');
    const sv = as('surveyor1');

    // Registering before uploading fails; uploading into someone else's survey is blocked by storage RLS.
    const op = randomUUID();
    const path = `${fx.orgs.aiec}/surveys/${surveyId}/${op}.jpg`;
    await expectCode(sv.rpc('register_evidence', { p_operation_id: op, p_survey_id: surveyId, p_payload: { category: 'pit', storage_path: path, sha256: 'a'.repeat(64), mime_type: 'image/jpeg', size_bytes: 10 } }), 'FILE_UPLOAD_FAILED');
    await expect(as('surveyor2').query(`insert into storage.objects (bucket_id, name) values ('evidence', $1)`, [path])).rejects.toMatchObject({ pgCode: '42501' });
    await expect(as('partnerA_tech').query(`insert into storage.objects (bucket_id, name) values ('evidence', $1)`, [path])).rejects.toMatchObject({ pgCode: '42501' });
    await expect(sv.query(`insert into storage.objects (bucket_id, name) values ('evidence', $1)`, [`${fx.orgs.aiec}/surveys/${surveyId}/not-a-uuid.jpg`])).rejects.toMatchObject({ pgCode: '42501' });

    const ev = await addEvidence('surveyor1', surveyId, 'pit');
    expect(ev).toMatchObject({ category: 'pit', replayed: false });
    // A path for another survey cannot be attached here (wrong-project protection).
    const foreignOp = randomUUID();
    const foreignPath = `${fx.orgs.aiec}/surveys/${other.surveyId}/${foreignOp}.jpg`;
    await as('surveyor2').query(`insert into storage.objects (bucket_id, name, metadata) values ('evidence', $1, $2)`, [foreignPath, { size: 10 }]);
    await expectCode(sv.rpc('register_evidence', { p_operation_id: foreignOp, p_survey_id: surveyId, p_payload: { category: 'pit', storage_path: foreignPath, sha256: 'b'.repeat(64), mime_type: 'image/jpeg', size_bytes: 10 } }), 'VALIDATION_FAILED');
    // Size must match the stored object; photo categories must be in-app captures.
    await expectCode(addEvidence('surveyor1', surveyId, 'overhead', { size_bytes: 99 }), 'VALIDATION_FAILED');
    await expectCode(addEvidence('surveyor1', surveyId, 'overhead', { source: 'document_import' }), 'VALIDATION_FAILED');
    await expectCode(addEvidence('surveyor1', surveyId, 'overhead', { source: 'gallery_exception' }), 'REQUIRED_FIELD_MISSING');
    expect(await addEvidence('surveyor1', surveyId, 'doc_shaft_layout', { source: 'document_import' })).toMatchObject({ category: 'doc_shaft_layout' });

    // Retake supersedes; the original is kept and immutable.
    const retake = await addEvidence('surveyor1', surveyId, 'pit', { supersedes_id: ev.evidence_id });
    const rows = await admin(pool, 'select id, status, superseded_by_id from public.evidence_files where survey_id = $1 and category = $2 order by server_received_at', [surveyId, 'pit']);
    expect(rows).toEqual([
      { id: ev.evidence_id, status: 'superseded', superseded_by_id: retake.evidence_id },
      { id: retake.evidence_id, status: 'active', superseded_by_id: null },
    ]);
    await expectCode(admin(pool, 'delete from public.evidence_files where id = $1', [ev.evidence_id]), 'ACCESS_DENIED');
    await expectCode(admin(pool, `update public.evidence_files set category = 'overhead' where id = $1`, [retake.evidence_id]), 'ACCESS_DENIED');

    // Read access to files follows survey visibility.
    const [{ name }] = await admin(pool, 'select storage_path as name from public.evidence_files where id = $1', [retake.evidence_id]);
    expect(await as('sales1').query(`select 1 from storage.objects where bucket_id = 'evidence' and name = $1`, [name])).toHaveLength(1);
    expect(await as('surveyor2').query(`select 1 from storage.objects where bucket_id = 'evidence' and name = $1`, [name])).toEqual([]);
    expect(await as('partnerA_admin').query(`select 1 from storage.objects where bucket_id = 'evidence'`)).toEqual([]);
    expect(await as('customer1').query('select 1 from public.evidence_files')).toEqual([]);
  });

  it('offline replay of evidence registration never duplicates (§29 tests 5 & 22)', async () => {
    const { surveyId } = await inProgress('surveyor2');
    const op = randomUUID();
    const path = `${fx.orgs.aiec}/surveys/${surveyId}/${op}.jpg`;
    await as('surveyor2').query(`insert into storage.objects (bucket_id, name, metadata) values ('evidence', $1, $2)`, [path, { size: 500 }]);
    const payload = { category: 'site_exterior', storage_path: path, sha256: 'c'.repeat(64), mime_type: 'image/jpeg', size_bytes: 500, captured_at: '2026-11-06T09:15:00+05:30' };
    const results = await Promise.all([1, 2, 3].map(() => as('surveyor2').rpc('register_evidence', { p_operation_id: op, p_survey_id: surveyId, p_payload: payload })));
    expect(new Set(results.map((r) => r.evidence_id)).size).toBe(1);
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(await admin(pool, 'select 1 from public.evidence_files where survey_id = $1', [surveyId])).toHaveLength(1);
    const [row] = await admin(pool, 'select captured_at, server_received_at from public.evidence_files where operation_id = $1', [op]);
    // Device capture time and server receipt time are stored separately.
    expect(new Date(row.captured_at).toISOString()).toBe('2026-11-06T03:45:00.000Z');
    expect(row.server_received_at).not.toEqual(row.captured_at);
  });

  it('Gate 1: an incomplete survey cannot be submitted; a complete one is locked and routed to technical review', async () => {
    const { surveyId, revisionId, leadId } = await inProgress('surveyor1');
    const sv = as('surveyor1');
    let v = await revisionVersion(revisionId);
    const e = await expectCode(sv.rpc('submit_survey', { p_operation_id: randomUUID(), p_survey_id: surveyId, p_expected_revision_version: v }), 'REQUIRED_FIELD_MISSING');
    expect(e.detail.missing).toEqual([...DEFAULT_SURVEY_REQUIREMENTS.required_evidence, ...DEFAULT_SURVEY_REQUIREMENTS.required_documents]);
    expect((e.detail.fields as string[]).length).toBe(DEFAULT_SURVEY_REQUIREMENTS.required_fields.length + DEFAULT_SURVEY_REQUIREMENTS.required_measurements.length);

    await sv.rpc('save_survey_draft', { p_operation_id: randomUUID(), p_survey_id: surveyId, p_revision_id: revisionId, p_expected_revision_version: v, p_data: COMPLETE_DATA, p_measurements: COMPLETE_MEASUREMENTS });
    v = await revisionVersion(revisionId);
    const ev = await expectCode(sv.rpc('submit_survey', { p_operation_id: randomUUID(), p_survey_id: surveyId, p_expected_revision_version: v }), 'EVIDENCE_REQUIRED');
    expect(ev.detail.missing).toEqual(DEFAULT_SURVEY_REQUIREMENTS.required_evidence);
    for (const c of DEFAULT_SURVEY_REQUIREMENTS.required_evidence) await addEvidence('surveyor1', surveyId, c);

    const op = randomUUID();
    const sub = await sv.rpc('submit_survey', { p_operation_id: op, p_survey_id: surveyId, p_expected_revision_version: v });
    expect(sub).toMatchObject({ status: 'submitted', revision_no: 1, replayed: false });
    expect(await sv.rpc('submit_survey', { p_operation_id: op, p_survey_id: surveyId, p_expected_revision_version: v })).toMatchObject({ status: 'submitted', replayed: true });

    // Immutable after submission — even for the database owner.
    await expectCode(admin(pool, `update public.survey_revisions set data = '{}' where id = $1`, [revisionId]), 'ACCESS_DENIED');
    await expectCode(admin(pool, `update public.survey_measurements set value_mm = 1 where revision_id = $1`, [revisionId]), 'ACCESS_DENIED');
    await expectCode(sv.rpc('save_survey_draft', { p_operation_id: randomUUID(), p_survey_id: surveyId, p_revision_id: revisionId, p_expected_revision_version: v, p_data: {}, p_measurements: [] }), 'INVALID_STATE_TRANSITION');
    const [rev] = await admin(pool, 'select status, cardinality(submitted_evidence_ids) as n, requirements_version from public.survey_revisions where id = $1', [revisionId]);
    expect(rev).toEqual({ status: 'submitted', n: DEFAULT_SURVEY_REQUIREMENTS.required_evidence.length, requirements_version: 1 });

    // Automation: technical reviewers and the lead owner are notified exactly once.
    expect(await as('tech1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'survey.submitted'`, [surveyId])).toHaveLength(1);
    expect(await as('sales1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'survey.submitted'`, [surveyId])).toHaveLength(1);

    // The surveyor cannot review their own survey (Gate 2 sits with Technical).
    await expectCode(sv.rpc('request_survey_revision', { p_survey_id: surveyId, p_expected_version: 99, p_reason: 'self' }), 'ACCESS_DENIED');

    // Revision loop: new draft revision (copied), surveyor corrects, resubmits; old revision superseded.
    const [{ version: sVersion }] = await admin(pool, 'select version from public.surveys where id = $1', [surveyId]);
    const rr = await as('tech1').rpc('request_survey_revision', { p_survey_id: surveyId, p_expected_version: sVersion, p_reason: 'Overhead measured at wrong level' });
    expect(rr.status).toBe('revision_requested');
    expect(rr.current_revision_id).not.toBe(revisionId);
    const copied = await admin(pool, 'select count(*)::int as n from public.survey_measurements where revision_id = $1', [rr.current_revision_id]);
    expect(copied[0].n).toBe(COMPLETE_MEASUREMENTS.length);
    const st = await sv.rpc('survey_field_action', { p_survey_id: surveyId, p_expected_version: rr.version, p_action: 'start_revision' });
    expect(st.status).toBe('in_progress');
    const v2 = await revisionVersion(rr.current_revision_id);
    await sv.rpc('save_survey_draft', {
      p_operation_id: randomUUID(), p_survey_id: surveyId, p_revision_id: rr.current_revision_id, p_expected_revision_version: v2,
      p_data: COMPLETE_DATA, p_measurements: COMPLETE_MEASUREMENTS.map((m) => (m.key === 'overhead' ? { ...m, entered_value: 3700 } : m)),
    });
    const sub2 = await sv.rpc('submit_survey', { p_operation_id: randomUUID(), p_survey_id: surveyId, p_expected_revision_version: v2 + 1 });
    expect(sub2).toMatchObject({ status: 'submitted', revision_no: 2 });
    const revs = await admin(pool, 'select revision_no, status from public.survey_revisions where survey_id = $1 order by revision_no', [surveyId]);
    expect(revs).toEqual([{ revision_no: 1, status: 'superseded' }, { revision_no: 2, status: 'submitted' }]);

    // Full audit trail with role context.
    const trail = await as('owner').query<{ action: string; actor_roles: string[] }>(
      `select action, actor_roles from public.audit_logs where entity_type = 'survey' and entity_id = $1 order by id`, [surveyId]);
    expect(trail.map((t) => t.action)).toEqual([
      'survey.scheduled', 'survey.accepted', 'survey.checked_in', 'survey.submitted', 'survey.revision_requested', 'survey.revision_started', 'survey.submitted',
    ]);
    expect(trail.find((t) => t.action === 'survey.revision_requested')!.actor_roles).toEqual(['technical_manager']);
    expect(leadId).toBeTruthy();
  });

  it('site inaccessible / revisit loops go back through scheduling', async () => {
    const { surveyId } = await inProgress('surveyor2');
    const [{ version }] = await admin(pool, 'select version from public.surveys where id = $1', [surveyId]);
    const r = await as('surveyor2').rpc('survey_field_action', { p_survey_id: surveyId, p_expected_version: version, p_action: 'report_inaccessible', p_reason: 'Gate locked, watchman absent' });
    expect(r.status).toBe('site_inaccessible');
    const n = await as('sales1').query(`select severity from public.notifications where entity_id = $1 and event_type = 'survey.site_inaccessible'`, [surveyId]);
    expect(n).toEqual([{ severity: 'warning' }]);
    await expectCode(as('surveyor2').rpc('survey_field_action', { p_survey_id: surveyId, p_expected_version: r.version, p_action: 'accept' }), 'INVALID_STATE_TRANSITION');
    const { start, end } = nextSlot();
    expect((await as('sales1').rpc('reschedule_survey', { p_survey_id: surveyId, p_expected_version: r.version, p_scheduled_start: start, p_scheduled_end: end, p_reason: 'Secretary confirmed access' })).status).toBe('scheduled');
  });
});

import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DEFAULT_SURVEY_REQUIREMENTS } from '@aiec/domain';
import { Session, admin } from './db';
import type { Fixture, UserKey } from './fixture';
import { leadPayload } from './payloads';

/** Complete Gate 1 survey content (matches the launch survey requirements). */
export const COMPLETE_DATA = {
  building: { usage: 'residential', floors: 5, stops: 5, construction_stage: 'structure_complete' },
  shaft: { access_conditions: 'clear, scaffold available' },
  machine_room: { availability: 'mrl' },
  electrical: { supply_type: 'temporary', phase: 'three' },
  logistics: { material_access_route: 'main gate, 4 m wide', safety_hazards: 'open shaft edges at upper floors' },
  documents_unavailable: Object.fromEntries(DEFAULT_SURVEY_REQUIREMENTS.required_documents.map((d) => [d, 'Builder to share after approval'])),
};
export const COMPLETE_MEASUREMENTS = [
  { key: 'shaft_width', entered_value: 1800, entered_unit: 'mm' },
  { key: 'shaft_depth', entered_value: 1.9, entered_unit: 'm' },
  { key: 'pit_depth', entered_value: 150, entered_unit: 'cm' },
  { key: 'overhead', entered_value: 3600, entered_unit: 'mm' },
  { key: 'entrance_width', entered_value: 900, entered_unit: 'mm' },
  { key: 'entrance_height', entered_value: 2100, entered_unit: 'mm' },
];

/** End-to-end business flows through the real RPCs, shared by the integration tests. */
export function flows(pool: pg.Pool, fx: Fixture) {
  const as = (u: UserKey) => new Session(pool, fx.users[u]);
  let slot = 0;
  const nextSlot = () => {
    // Far-future, non-overlapping slots so suites never collide on surveyor calendars.
    const start = new Date(Date.now() + 200 * 864e5 + slot * 3 * 3600e3 + Math.floor(Math.random() * 1e6) * 60e3);
    slot++;
    return { start: start.toISOString(), end: new Date(start.getTime() + 2 * 3600e3).toISOString() };
  };

  async function qualifiedLead(owner: UserKey = 'sales1', lead: Record<string, unknown> = {}) {
    const s = as(owner);
    const r = await s.rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload(lead) });
    const c = await s.rpc('record_lead_activity', {
      p_operation_id: randomUUID(), p_lead_id: r.lead_id, p_activity_type: 'call', p_outcome: 'survey_required',
      p_summary: 'Needs site survey', p_occurred_at: new Date().toISOString(), p_next_follow_up_at: new Date(Date.now() + 864e5).toISOString(),
    });
    await s.rpc('qualify_lead', {
      p_lead_id: r.lead_id, p_expected_version: c.version,
      p_qualification: { need: 'Passenger lift', decision_authority: 'confirmed', timeline: 'within_3_months', next_action: 'Survey' },
    });
    return r.lead_id as string;
  }

  async function revisionVersion(revisionId: string) {
    const [r] = await admin<{ version: number }>(pool, 'select version from public.survey_revisions where id = $1', [revisionId]);
    return r!.version;
  }

  async function addEvidence(surveyor: UserKey, surveyId: string, category: string) {
    const op = randomUUID();
    const path = `${fx.orgs.aiec}/surveys/${surveyId}/${op}.jpg`;
    await as(surveyor).query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('evidence', $1, $2, $3)`, [
      path, fx.users[surveyor], { size: 2048, mimetype: 'image/jpeg' },
    ]);
    return as(surveyor).rpc('register_evidence', {
      p_operation_id: op, p_survey_id: surveyId,
      p_payload: {
        category, storage_path: path, sha256: createHash('sha256').update(op).digest('hex'), mime_type: 'image/jpeg', size_bytes: 2048,
        captured_at: new Date().toISOString(), latitude: 18.5591, longitude: 73.7868, accuracy_m: 6, source: 'in_app_camera',
      },
    });
  }

  /** Qualified lead → scheduled → accepted → checked in → complete → submitted (Gate 1 passed). */
  async function submittedSurvey(owner: UserKey = 'sales1', surveyor: UserKey = 'surveyor1', lead: Record<string, unknown> = {}) {
    const leadId = await qualifiedLead(owner, lead);
    const { start, end } = nextSlot();
    const s = await as(owner).rpc('schedule_survey', {
      p_operation_id: randomUUID(), p_lead_id: leadId, p_surveyor_id: fx.users[surveyor], p_scheduled_start: start,
      p_scheduled_end: end, p_scope: 'New lift survey, full shaft', p_site_contact_name: 'Society Secretary', p_site_contact_phone: '9811111111',
    });
    const sv = as(surveyor);
    await sv.rpc('survey_field_action', { p_survey_id: s.survey_id, p_expected_version: s.version, p_action: 'accept' });
    const c = await sv.rpc('check_in_survey', {
      p_operation_id: randomUUID(), p_survey_id: s.survey_id, p_location_permission: 'granted',
      p_latitude: 18.5591, p_longitude: 73.7868, p_accuracy_m: 8, p_client_time: new Date().toISOString(),
    });
    const revisionId = c.current_revision_id as string;
    await sv.rpc('save_survey_draft', {
      p_operation_id: randomUUID(), p_survey_id: s.survey_id, p_revision_id: revisionId,
      p_expected_revision_version: await revisionVersion(revisionId), p_data: COMPLETE_DATA, p_measurements: COMPLETE_MEASUREMENTS,
    });
    for (const cat of DEFAULT_SURVEY_REQUIREMENTS.required_evidence) await addEvidence(surveyor, s.survey_id, cat);
    await sv.rpc('submit_survey', { p_operation_id: randomUUID(), p_survey_id: s.survey_id, p_expected_revision_version: await revisionVersion(revisionId) });
    return { leadId, surveyId: s.survey_id as string, revisionId };
  }

  /** Resubmit a survey that was returned to the surveyor (copied revision is already complete). */
  async function resubmit(surveyId: string, surveyor: UserKey = 'surveyor1') {
    const sv = as(surveyor);
    const [s] = await admin<{ version: number }>(pool, 'select version from public.surveys where id = $1', [surveyId]);
    const st = await sv.rpc('survey_field_action', { p_survey_id: surveyId, p_expected_version: s!.version, p_action: 'start_revision' });
    const rev = st.current_revision_id as string;
    return sv.rpc('submit_survey', { p_operation_id: randomUUID(), p_survey_id: surveyId, p_expected_revision_version: await revisionVersion(rev) });
  }

  return { as, qualifiedLead, submittedSurvey, resubmit, addEvidence, revisionVersion };
}

/** A complete passenger configuration that fits COMPLETE_MEASUREMENTS. */
export const PASSENGER_CONFIG = {
  rated_load_kg: 544, persons: 8, rated_speed_mps: 1, floors: 5, stops: 5, travel_mm: 12000,
  drive_type: 'traction_mrl', machine_room: 'mrl', car_width_mm: 1100, car_depth_mm: 1400, car_height_mm: 2200,
  shaft_width_mm: 1700, shaft_depth_mm: 1800, pit_depth_mm: 1400, overhead_mm: 3600,
  door_type: 'centre_opening', door_width_mm: 800, door_height_mm: 2000, power_supply: 'three_phase_415v',
  manufacturer: 'Example Lifts', model: 'MRL-8',
};

export const asParameters = (values: Record<string, unknown>, status = 'proposed') =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, status }]));

/**
 * Demo state + actions. Everything runs in the browser on simulated data kept
 * in localStorage on this device. The business rules are the REAL ones from
 * @aiec/domain (state machines, permissions, duplicate detection, Gate 1,
 * units, scoring); the server-side checks of the product (RLS, ownership) are
 * mirrored here so the demo behaves like the real system.
 */
import {
  DEFAULT_SURVEY_REQUIREMENTS,
  DomainError,
  MEANINGFUL_CONTACT_OUTCOMES,
  cityCode,
  classifyGps,
  findPossibleDuplicates,
  formatBusinessId,
  leadMachine,
  measurement,
  normalizePhone,
  normalizeEmail,
  permissionsForRole,
  scoreLead,
  surveyMachine,
  transition,
  validateSurveySubmission,
  type CallOutcome,
  type DuplicateMatch,
  type GpsStatus,
  type LeadState,
  type LengthUnit,
  type LostReason,
  type PermissionCode,
  type RoleCode,
  type SurveyState,
  type Locale,
  t,
} from '@aiec/domain';

export interface DemoUser {
  id: string;
  name: string;
  role: RoleCode;
  org: string;
}

// i18n-ignore-start: fictional people and company names (data, not interface text)
export const USERS: DemoUser[] = [
  { id: 'u-owner', name: 'Asha Kulkarni', role: 'owner', org: 'AIEC' },
  { id: 'u-sales1', name: 'Rahul Patil', role: 'sales_executive', org: 'AIEC' },
  { id: 'u-sales2', name: 'Neha Joshi', role: 'sales_executive', org: 'AIEC' },
  { id: 'u-surv1', name: 'Vikram Shinde', role: 'surveyor', org: 'AIEC' },
  { id: 'u-tech1', name: 'Meera Deshmukh', role: 'technical_manager', org: 'AIEC' },
  { id: 'u-partner', name: 'Sanjay More', role: 'partner_admin', org: 'Demo Partner Lifts' },
];
// i18n-ignore-end

export interface Lead {
  id: string;
  number: string;
  status: LeadState;
  contactName: string;
  phone: string | null;
  email: string | null;
  projectName: string;
  builderName: string | null;
  city: string;
  locality: string | null;
  lat: number | null;
  lng: number | null;
  liftRequirement: string;
  source: string;
  ownerId: string | null;
  nextActionAt: string | null;
  qualification: Record<string, string> | null;
  score: number | null;
  scoreExplanation: { key: string; points: number; matched: boolean }[] | null;
  lostReason: LostReason | null;
  closedReason: string | null;
  createdAt: string;
  version: number;
}

export interface Activity {
  id: string;
  leadId: string;
  type: string;
  outcome: CallOutcome | null;
  summary: string;
  at: string;
  next: string | null;
  noActionReason: string | null;
}

export interface MeasurementInput {
  key: string;
  entered: number;
  unit: LengthUnit;
}

export interface Evidence {
  id: string;
  category: string;
  capturedAt: string;
  thumb: string | null;
  /** Location recorded with the photo (rendered in the viewer's language). */
  gps: { status: 'verified' | 'permission_denied' | 'unavailable'; accuracyM: number | null };
  superseded: boolean;
}

export interface Revision {
  no: number;
  status: 'draft' | 'submitted' | 'superseded';
  data: Record<string, Record<string, string>> & { documents_unavailable?: Record<string, string> };
  measurements: MeasurementInput[];
  reason: string | null;
  submittedAt: string | null;
}

export interface Survey {
  id: string;
  number: string;
  leadId: string;
  surveyorId: string;
  status: SurveyState;
  start: string;
  end: string;
  scope: string;
  site: string;
  contactName: string;
  contactPhone: string | null;
  gpsStatus: GpsStatus | null;
  gpsReason: string | null;
  checkedInAt: string | null;
  statusReason: string | null;
  revisions: Revision[];
  evidence: Evidence[];
  version: number;
}

export interface AuditEntry {
  at: string;
  actor: string;
  role: RoleCode;
  entity: string;
  action: string;
  /** Free text typed by a person (never translated). */
  reason: string | null;
  /** System-generated reason, rendered in the viewer's language. */
  reasonKey?: string;
  reasonParams?: Record<string, string | number>;
}

export interface Notice {
  id: string;
  to: string;
  /** Translation key + parameters: rendered in the viewer's language. */
  key: string;
  params: Record<string, string | number>;
  at: string;
  read: boolean;
}

export interface DemoState {
  version: 2;
  leads: Lead[];
  activities: Activity[];
  surveys: Survey[];
  audit: AuditEntry[];
  notices: Notice[];
  seq: Record<string, number>;
}

// v2: notices / audit reasons / evidence location stored as keys (Marathi + English).
const KEY = 'aiec-demo-state-v2';
const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const daysFromNow = (d: number, h = 10) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(h, 0, 0, 0);
  return x.toISOString();
};

/** <input type="datetime-local"> values are interpreted as IST, like the real web app. */
export function istLocal(value: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(value);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3] ?? '00'}+05:30`) : new Date(value);
}

export function userById(id: string | null): DemoUser | undefined {
  return USERS.find((u) => u.id === id);
}

/* ------------------------------- seed data -------------------------------- */

/** Descriptive seed text is written in the language the demo was started in (like data a person typed). */
function seed(locale: Locale): DemoState {
  const tx = (key: string) => t(key, locale);
  const s: DemoState = { version: 2, leads: [], activities: [], surveys: [], audit: [], notices: [], seq: {} };
  const year = new Date().getFullYear();
  const mk = (over: Partial<Lead>): Lead => {
    const city = over.city ?? 'Pune';
    const code = cityCode(city);
    const n = (s.seq[`LD-${code}`] = (s.seq[`LD-${code}`] ?? 0) + 1);
    return {
      id: uid(),
      number: formatBusinessId('lead', code, year, n),
      status: 'assigned',
      contactName: tx('demo.seed.contact'),
      phone: null,
      email: null,
      projectName: tx('demo.seed.project'),
      builderName: null,
      city,
      locality: null,
      lat: null,
      lng: null,
      liftRequirement: tx('demo.seed.one_lift'),
      source: 'website',
      ownerId: 'u-sales1',
      nextActionAt: daysFromNow(1),
      qualification: null,
      score: null,
      scoreExplanation: null,
      lostReason: null,
      closedReason: null,
      createdAt: daysFromNow(-3),
      version: 1,
      ...over,
    };
  };
  // i18n-ignore-start: fictional seed names
  s.leads.push(
    mk({ contactName: 'Mr. Anil Gokhale', phone: '+919822011001', projectName: 'Sai Krupa Heights', locality: 'Kothrud', lat: 18.5074, lng: 73.8077, liftRequirement: tx('demo.seed.mrl_g4') }),
    mk({ contactName: 'Mrs. Sunita Rao', phone: '+919822011002', projectName: 'Green Valley Society', locality: 'Baner', status: 'contacted', nextActionAt: daysFromNow(-1) }),
    mk({ contactName: tx('demo.seed.builder_office'), phone: '+919822011003', projectName: 'Skyline Residency', builderName: 'Skyline Developers', locality: 'Wakad', city: 'PCMC', status: 'new', ownerId: null }),
    mk({ contactName: 'Dr. Kiran Shah', phone: '+919822011004', projectName: 'Shah Clinic', locality: 'Aundh', status: 'qualified', score: 80, qualification: { need: tx('demo.seed.stretcher_lift'), decision_authority: 'confirmed', timeline: 'within_3_months', next_action: tx('demo.seed.book_survey') } }),
    mk({ contactName: 'Mr. Rohan Jain', phone: '+919822011005', projectName: 'Lakeview Apartments', locality: 'Hadapsar', status: 'lost', lostReason: 'price', closedReason: tx('demo.seed.cheaper_vendor'), ownerId: 'u-sales2' }),
    mk({ contactName: 'Mrs. Priya Nair', phone: '+919822011006', projectName: 'Orchid Towers', locality: 'Kharadi', ownerId: 'u-sales2' }),
  );
  // i18n-ignore-end
  const q = s.leads[3]!;
  s.surveys.push({
    id: uid(),
    number: formatBusinessId('survey', 'PUN', year, (s.seq['SV-PUN'] = 1)),
    leadId: q.id,
    surveyorId: 'u-surv1',
    status: 'scheduled',
    start: daysFromNow(1, 11),
    end: daysFromNow(1, 13),
    scope: tx('lead_form.default_scope'),
    site: `${q.projectName}, ${q.locality}, ${q.city}`,
    contactName: q.contactName,
    contactPhone: q.phone,
    gpsStatus: null,
    gpsReason: null,
    checkedInAt: null,
    statusReason: null,
    revisions: [{ no: 1, status: 'draft', data: {}, measurements: [], reason: null, submittedAt: null }],
    evidence: [],
    version: 1,
  });
  s.audit.push({ at: now(), actor: '', role: 'owner', entity: 'demo', action: 'demo.seeded', reason: null, reasonKey: 'demo.audit.seeded' });
  return s;
}

export function load(locale: Locale): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DemoState;
  } catch {
    /* storage unavailable: start fresh */
  }
  return seed(locale);
}

export function save(s: DemoState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* demo still works for this session */
  }
}

export function reset(locale: Locale): DemoState {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return seed(locale);
}

/* --------------------------------- helpers -------------------------------- */

export function perms(u: DemoUser): ReadonlySet<PermissionCode> {
  return permissionsForRole(u.role);
}

function need(u: DemoUser, p: PermissionCode) {
  if (!perms(u).has(p)) throw new DomainError('ACCESS_DENIED', p);
}

function check<T>(r: { ok: true; to: T } | { ok: false; error: DomainError }): T {
  if (!r.ok) throw r.error;
  return r.to;
}

function audit(s: DemoState, u: DemoUser, entity: string, action: string, reason: string | null = null, reasonKey?: { key: string; params?: Record<string, string | number> }) {
  s.audit.unshift({ at: now(), actor: u.name, role: u.role, entity, action, reason, reasonKey: reasonKey?.key, reasonParams: reasonKey?.params });
}

function notify(s: DemoState, to: string | null, key: string, params: Record<string, string | number> = {}) {
  if (to) s.notices.unshift({ id: uid(), to, key, params, at: now(), read: false });
}

/** Mirrors RLS: what a user may see. */
export function visibleLeads(s: DemoState, u: DemoUser): Lead[] {
  if (perms(u).has('lead.read_all')) return s.leads;
  if (perms(u).has('lead.read_assigned')) return s.leads.filter((l) => l.ownerId === u.id);
  return [];
}

export function visibleSurveys(s: DemoState, u: DemoUser): Survey[] {
  if (perms(u).has('survey.read_all')) return s.surveys;
  return s.surveys.filter((v) => (v.surveyorId === u.id && perms(u).has('survey.read_assigned')) || visibleLeads(s, u).some((l) => l.id === v.leadId));
}

/* ---------------------------------- leads --------------------------------- */

export interface NewLeadInput {
  contactName: string;
  phone: string;
  email: string;
  projectName: string;
  builderName: string;
  city: string;
  locality: string;
  lat: string;
  lng: string;
  liftRequirement: string;
  source: string;
  confirmSeparate: string[];
  duplicateReason: string;
}

export function duplicateCandidates(s: DemoState, input: Pick<NewLeadInput, 'phone' | 'email' | 'projectName' | 'builderName' | 'lat' | 'lng'>): (DuplicateMatch & { lead: Lead })[] {
  const probe = {
    phone: normalizePhone(input.phone),
    email: normalizeEmail(input.email),
    projectName: input.projectName || null,
    builderName: input.builderName || null,
    latitude: input.lat ? Number(input.lat) : null,
    longitude: input.lng ? Number(input.lng) : null,
  };
  const records = s.leads
    .filter((l) => l.status !== 'invalid')
    .map((l) => ({ id: l.id, phone: l.phone, email: l.email, projectName: l.projectName, builderName: l.builderName, latitude: l.lat, longitude: l.lng }));
  return findPossibleDuplicates(probe, records).map((m) => ({ ...m, lead: s.leads.find((l) => l.id === m.id)! }));
}

export function createLead(s: DemoState, u: DemoUser, input: NewLeadInput): Lead {
  need(u, 'lead.create');
  const missing: string[] = [];
  if (!input.contactName.trim()) missing.push('contact_name');
  if (!input.projectName.trim()) missing.push('project_name');
  if (!input.city.trim()) missing.push('city');
  if (!input.liftRequirement.trim()) missing.push('lift_requirement');
  if (!input.source) missing.push('source');
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  if (input.phone.trim() && !phone) throw new DomainError('VALIDATION_FAILED', 'phone', { fields: ['phone'] });
  if (input.email.trim() && !email) throw new DomainError('VALIDATION_FAILED', 'email', { fields: ['email'] });
  if (!phone && !email) missing.push('contact_method');
  if (missing.length) throw new DomainError('REQUIRED_FIELD_MISSING', 'missing', { fields: missing });
  const dups = duplicateCandidates(s, input);
  const unreviewed = dups.filter((d) => !input.confirmSeparate.includes(d.id));
  if (unreviewed.length || (dups.length && input.duplicateReason.trim().length < 3)) {
    throw new DomainError('DUPLICATE_REVIEW_REQUIRED', 'duplicates', { candidates: dups.map((d) => d.id) });
  }
  const code = cityCode(input.city);
  const n = (s.seq[`LD-${code}`] = (s.seq[`LD-${code}`] ?? 0) + 1);
  const lead: Lead = {
    id: uid(),
    number: formatBusinessId('lead', code, new Date().getFullYear(), n),
    status: 'assigned',
    contactName: input.contactName.trim(),
    phone,
    email,
    projectName: input.projectName.trim(),
    builderName: input.builderName.trim() || null,
    city: input.city.trim(),
    locality: input.locality.trim() || null,
    lat: input.lat ? Number(input.lat) : null,
    lng: input.lng ? Number(input.lng) : null,
    liftRequirement: input.liftRequirement.trim(),
    source: input.source,
    ownerId: u.id,
    nextActionAt: null,
    qualification: null,
    score: null,
    scoreExplanation: null,
    lostReason: null,
    closedReason: null,
    createdAt: now(),
    version: 1,
  };
  s.leads.unshift(lead);
  audit(s, u, lead.number, 'lead.created', dups.length ? input.duplicateReason : null, dups.length ? { key: 'demo.audit.dup_reviewed' } : undefined);
  audit(s, u, lead.number, 'lead.assigned');
  return lead;
}

function ownLead(s: DemoState, u: DemoUser, leadId: string): Lead {
  const l = s.leads.find((x) => x.id === leadId);
  if (!l || !visibleLeads(s, u).includes(l)) throw new DomainError('NOT_FOUND');
  if (l.ownerId !== u.id) throw new DomainError('ACCESS_DENIED', 'Only the lead owner can do this'); // i18n-ignore: developer diagnostic
  return l;
}

export function recordActivity(s: DemoState, u: DemoUser, leadId: string, a: { type: string; outcome: CallOutcome | ''; summary: string; next: string; noActionReason: string }) {
  const l = ownLead(s, u, leadId);
  need(u, 'lead.activity.record');
  if (!['assigned', 'contacted', 'qualified'].includes(l.status)) throw new DomainError('INVALID_STATE_TRANSITION', 'closed', { currentState: l.status, allowedActions: [] });
  if (a.summary.trim().length < 2) throw new DomainError('REQUIRED_FIELD_MISSING', 'summary', { fields: ['summary'] });
  if (!a.next && a.noActionReason.trim().length < 3) throw new DomainError('REQUIRED_FIELD_MISSING', 'next', { fields: ['next_follow_up_at', 'no_action_reason'] });
  if (a.next && istLocal(a.next).getTime() <= Date.now()) throw new DomainError('VALIDATION_FAILED', 'next', { fields: ['next_follow_up_at'] });
  const outcome = a.outcome || null;
  if (l.status === 'assigned' && outcome && MEANINGFUL_CONTACT_OUTCOMES.includes(outcome)) {
    l.status = check(transition(leadMachine, l.status, { action: 'record_contact', actorPermissions: perms(u), context: { outcome } }));
    audit(s, u, l.number, 'lead.contacted');
  }
  s.activities.unshift({ id: uid(), leadId, type: a.type, outcome, summary: a.summary.trim(), at: now(), next: a.next ? istLocal(a.next).toISOString() : null, noActionReason: a.next ? null : a.noActionReason.trim() });
  l.nextActionAt = a.next ? istLocal(a.next).toISOString() : null;
  l.version++;
  audit(s, u, l.number, 'lead.activity_recorded');
}

export function qualify(s: DemoState, u: DemoUser, leadId: string, q: Record<string, string>) {
  const l = ownLead(s, u, leadId);
  l.status = check(transition(leadMachine, l.status, { action: 'qualify', actorPermissions: perms(u), context: { qualification: q } }));
  const sc = scoreLead(q);
  l.qualification = q;
  l.score = sc.score;
  l.scoreExplanation = sc.explanation;
  l.version++;
  audit(s, u, l.number, 'lead.qualified');
}

export function closeLead(s: DemoState, u: DemoUser, leadId: string, outcome: 'lost' | 'invalid', lostReason: LostReason | '', reason: string) {
  const l = ownLead(s, u, leadId);
  l.status = check(
    transition(leadMachine, l.status, {
      action: outcome === 'lost' ? 'close_lost' : 'mark_invalid',
      actorPermissions: perms(u),
      reason,
      context: { lostReason: lostReason || null },
    }),
  );
  l.lostReason = outcome === 'lost' ? (lostReason as LostReason) : null;
  l.closedReason = reason;
  l.nextActionAt = null;
  l.version++;
  audit(s, u, l.number, outcome === 'lost' ? 'lead.closed_lost' : 'lead.marked_invalid', reason);
}

export function assignLead(s: DemoState, u: DemoUser, leadId: string, assigneeId: string, reason: string) {
  need(u, 'lead.assign');
  const l = s.leads.find((x) => x.id === leadId);
  if (!l) throw new DomainError('NOT_FOUND');
  const action = l.status === 'new' ? 'assign' : l.status === 'lost' ? 'reopen' : 'reassign';
  l.status = check(transition(leadMachine, l.status, { action, actorPermissions: perms(u), reason, context: { assigneeId } }));
  l.ownerId = assigneeId;
  l.version++;
  audit(s, u, l.number, `lead.${action === 'assign' ? 'assigned' : action === 'reopen' ? 'reopened' : 'reassigned'}`, reason || null);
  notify(s, assigneeId, 'demo.notice.lead_assigned', { number: l.number, project: l.projectName });
}

/* --------------------------------- surveys -------------------------------- */

export function scheduleSurvey(s: DemoState, u: DemoUser, leadId: string, surveyorId: string, startLocal: string, hours: number, scope: string) {
  const l = ownLead(s, u, leadId);
  need(u, 'survey.schedule');
  if (l.status !== 'qualified') throw new DomainError('INVALID_STATE_TRANSITION', 'lead must be qualified', { currentState: l.status, allowedActions: [] });
  if (!startLocal) throw new DomainError('REQUIRED_FIELD_MISSING', 'start', { fields: ['scheduled_start'] });
  const start = istLocal(startLocal);
  if (start.getTime() < Date.now() - 3600_000) throw new DomainError('VALIDATION_FAILED', 'past', { fields: ['scheduled_start'] });
  const end = new Date(start.getTime() + hours * 3600_000);
  const clash = s.surveys.some(
    (v) => v.surveyorId === surveyorId && ['scheduled', 'accepted'].includes(v.status) && Date.parse(v.start) < end.getTime() && Date.parse(v.end) > start.getTime(),
  );
  if (clash) throw new DomainError('SCHEDULE_CONFLICT');
  const n = (s.seq[`SV-${cityCode(l.city)}`] = (s.seq[`SV-${cityCode(l.city)}`] ?? 0) + 1);
  const sv: Survey = {
    id: uid(),
    number: formatBusinessId('survey', cityCode(l.city), new Date().getFullYear(), n),
    leadId,
    surveyorId,
    status: 'scheduled',
    start: start.toISOString(),
    end: end.toISOString(),
    scope,
    site: [l.projectName, l.locality, l.city].filter(Boolean).join(', '),
    contactName: l.contactName,
    contactPhone: l.phone,
    gpsStatus: null,
    gpsReason: null,
    checkedInAt: null,
    statusReason: null,
    revisions: [{ no: 1, status: 'draft', data: {}, measurements: [], reason: null, submittedAt: null }],
    evidence: [],
    version: 1,
  };
  s.surveys.unshift(sv);
  audit(s, u, sv.number, 'survey.scheduled');
  notify(s, surveyorId, 'demo.notice.survey_scheduled', { number: sv.number, site: sv.site });
  return sv;
}

function assignedSurvey(s: DemoState, u: DemoUser, id: string): Survey {
  const v = s.surveys.find((x) => x.id === id);
  if (!v) throw new DomainError('NOT_FOUND');
  need(u, 'survey.capture');
  if (v.surveyorId !== u.id) throw new DomainError('PROJECT_NOT_ASSIGNED');
  return v;
}

export function surveyAction(s: DemoState, u: DemoUser, id: string, action: 'accept' | 'request_reschedule' | 'request_revisit' | 'report_inaccessible' | 'start_revision', reason = '') {
  const v = assignedSurvey(s, u, id);
  v.status = check(transition(surveyMachine, v.status, { action, actorPermissions: perms(u), reason, context: {} }));
  v.statusReason = reason || null;
  v.version++;
  audit(s, u, v.number, `survey.${action}`, reason || null);
  if (action !== 'accept' && action !== 'start_revision') {
    const lead = s.leads.find((l) => l.id === v.leadId);
    notify(s, lead?.ownerId ?? null, 'demo.notice.survey_action', { number: v.number, action, reason });
  }
}

export function checkIn(s: DemoState, u: DemoUser, id: string, pos: { permission: 'granted' | 'denied' | 'undetermined'; lat: number | null; lng: number | null; acc: number | null }, exceptionReason: string): GpsStatus {
  const v = assignedSurvey(s, u, id);
  const gps = classifyGps({ permission: pos.permission, latitude: pos.lat, longitude: pos.lng, accuracyM: pos.acc });
  v.status = check(
    transition(surveyMachine, v.status, { action: 'check_in', actorPermissions: perms(u), context: { gpsStatus: gps, gpsExceptionReason: exceptionReason } }),
  );
  v.gpsStatus = gps;
  v.gpsReason = gps === 'verified' ? null : exceptionReason;
  v.checkedInAt = now();
  v.version++;
  audit(s, u, v.number, 'survey.checked_in', v.gpsReason);
  return gps;
}

export function currentRevision(v: Survey): Revision {
  return v.revisions[v.revisions.length - 1]!;
}

export function saveDraft(s: DemoState, u: DemoUser, id: string, data: Revision['data'], measurements: MeasurementInput[]) {
  const v = assignedSurvey(s, u, id);
  check(transition(surveyMachine, v.status, { action: 'save_draft', actorPermissions: perms(u), context: {} }));
  const rev = currentRevision(v);
  rev.data = data;
  rev.measurements = measurements;
}

export function addEvidence(s: DemoState, u: DemoUser, id: string, category: string, thumb: string | null, gps: Evidence['gps']) {
  const v = assignedSurvey(s, u, id);
  if (v.status !== 'in_progress') throw new DomainError('INVALID_STATE_TRANSITION', 'evidence', { currentState: v.status, allowedActions: [] });
  v.evidence.push({ id: uid(), category, capturedAt: now(), thumb, gps, superseded: false });
  audit(s, u, v.number, 'evidence.registered', null, { key: `enum.evidence.${category}` });
}

export function gate1(v: Survey) {
  const rev = currentRevision(v);
  const ms = rev.measurements.flatMap((m) => {
    try {
      return [measurement(m.key, m.entered, m.unit)];
    } catch {
      return [];
    }
  });
  return validateSurveySubmission(rev.data, ms, v.evidence.filter((e) => !e.superseded).map((e) => ({ category: e.category })), DEFAULT_SURVEY_REQUIREMENTS);
}

export function submitSurvey(s: DemoState, u: DemoUser, id: string) {
  const v = assignedSurvey(s, u, id);
  v.status = check(transition(surveyMachine, v.status, { action: 'submit', actorPermissions: perms(u), context: { submissionFailures: gate1(v).failures } }));
  for (const r of v.revisions) if (r.status === 'submitted') r.status = 'superseded';
  const rev = currentRevision(v);
  rev.status = 'submitted';
  rev.submittedAt = now();
  v.version++;
  audit(s, u, v.number, 'survey.submitted', null, { key: 'demo.audit.revision', params: { no: rev.no } });
  USERS.filter((x) => x.role === 'technical_manager').forEach((m) => notify(s, m.id, 'demo.notice.survey_submitted', { number: v.number }));
}

export function requestRevision(s: DemoState, u: DemoUser, id: string, reason: string) {
  const v = s.surveys.find((x) => x.id === id);
  if (!v) throw new DomainError('NOT_FOUND');
  v.status = check(transition(surveyMachine, v.status, { action: 'request_revision', actorPermissions: perms(u), reason, context: {} }));
  const prev = currentRevision(v);
  v.revisions.push({ no: prev.no + 1, status: 'draft', data: JSON.parse(JSON.stringify(prev.data)), measurements: prev.measurements.map((m) => ({ ...m })), reason, submittedAt: null });
  v.statusReason = reason;
  v.version++;
  audit(s, u, v.number, 'survey.revision_requested', reason);
  notify(s, v.surveyorId, 'demo.notice.survey_returned', { number: v.number, reason });
}

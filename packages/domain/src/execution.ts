import { defineMachine, type GuardFailure } from './state-machine';
import type { ComplianceRequirement, ChecklistItem, SafetyCheck } from './gates';

/**
 * Partner execution (spec §12–§14, §36 OM03–OM06, §42–§43, Gates 7, 8, 9, 11).
 * The database mirrors the assignment machine (state_transitions), the
 * eligibility rule and the task checks; supabase/tests/test/parity.test.ts
 * keeps them equal.
 */

const ok: GuardFailure[] = [];
const fail = (code: GuardFailure['code'], message: string, extra: Partial<GuardFailure> = {}): GuardFailure[] => [{ code, message, ...extra }];

/* -------------------------------------------------------------------------- */
/* Partner company: profile and compliance documents (LP02, LP03)             */
/* -------------------------------------------------------------------------- */

export const PARTNER_DOCUMENT_TYPES = [
  'contractor_licence',
  'insurance',
  'pan',
  'gst_registration',
  'bank_verification',
  'safety_policy',
  'certification',
] as const;
export type PartnerDocumentType = (typeof PARTNER_DOCUMENT_TYPES)[number];

export const PARTNER_ENTITY_TYPES = ['proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'other'] as const;
export const LIFT_CATEGORY_SCOPES = ['passenger', 'goods', 'hospital', 'home'] as const;

export interface PartnerRequirementRule {
  type: PartnerDocumentType;
  /** The document scope must include the project's lift category (e.g. the contractor licence class). */
  scopeFromLiftCategory?: boolean;
}

/** Launch rule `partner.document_requirements` (Decision Register D-029): versioned configuration. */
export const DEFAULT_PARTNER_REQUIREMENTS: PartnerRequirementRule[] = [
  { type: 'contractor_licence', scopeFromLiftCategory: true },
  { type: 'insurance' },
  { type: 'pan' },
  { type: 'bank_verification' },
];

/** The requirements for one project: licence scope must cover the project's lift category. */
export function requirementsForProject(rules: readonly PartnerRequirementRule[], liftCategory: string | null): ComplianceRequirement[] {
  return rules.map((r) => (r.scopeFromLiftCategory && liftCategory ? { type: r.type, requiredScope: [liftCategory] } : { type: r.type }));
}

/** Profile fields a partner must complete before submitting for verification (§12.2). */
export const PARTNER_PROFILE_REQUIRED = [
  'legal_name',
  'entity_type',
  'registered_address',
  'authorized_representative',
  'contact_phone',
  'service_areas',
  'lift_categories',
  'team_size',
  'safety_policy_accepted',
  'compliance_declaration',
] as const;

export function missingPartnerProfileFields(p: Partial<Record<(typeof PARTNER_PROFILE_REQUIRED)[number], unknown>>): string[] {
  return PARTNER_PROFILE_REQUIRED.filter((k) => {
    const v = p[k];
    if (k === 'safety_policy_accepted' || k === 'compliance_declaration') return v !== true;
    if (k === 'team_size') return !(typeof v === 'number' && Number.isInteger(v) && v > 0);
    if (Array.isArray(v)) return v.length === 0;
    return typeof v !== 'string' || v.trim().length < 2;
  });
}

/* -------------------------------------------------------------------------- */
/* Project invitation / assignment (LP04, OM04)                               */
/* -------------------------------------------------------------------------- */

export const ASSIGNMENT_STATES = ['invited', 'clarification_requested', 'accepted', 'declined', 'withdrawn', 'ended'] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export interface AssignmentContext {
  /** Gate 7, evaluated at the moment of the action. */
  partnerEligible?: boolean;
}

export const assignmentMachine = defineMachine<AssignmentState, string, AssignmentContext>({
  name: 'partner_assignment',
  states: ASSIGNMENT_STATES,
  initial: 'invited',
  terminal: ['declined', 'withdrawn', 'ended'],
  transitions: [
    {
      action: 'accept',
      from: ['invited'],
      to: 'accepted',
      permission: 'partner.org.manage',
      auditEvent: 'assignment.accepted',
      guard: (c) => (c.partnerEligible ? ok : fail('PARTNER_COMPLIANCE_BLOCK', 'The partner is not eligible for assignment (Gate 7)')),
    },
    { action: 'decline', from: ['invited', 'clarification_requested'], to: 'declined', permission: 'partner.org.manage', requiresReason: true, auditEvent: 'assignment.declined' },
    { action: 'request_clarification', from: ['invited'], to: 'clarification_requested', permission: 'partner.org.manage', requiresReason: true, auditEvent: 'assignment.clarification_requested' },
    {
      action: 'reissue',
      from: ['clarification_requested'],
      to: 'invited',
      permission: 'partner.assign',
      requiresReason: true,
      auditEvent: 'assignment.reissued',
      guard: (c) => (c.partnerEligible ? ok : fail('PARTNER_COMPLIANCE_BLOCK', 'The partner is not eligible for assignment (Gate 7)')),
    },
    { action: 'withdraw', from: ['invited', 'clarification_requested'], to: 'withdrawn', permission: 'partner.assign', requiresReason: true, auditEvent: 'assignment.withdrawn' },
    { action: 'end', from: ['accepted'], to: 'ended', permission: 'partner.assign', requiresReason: true, auditEvent: 'assignment.ended' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Site readiness checklist (OM03, Gate 8)                                    */
/* -------------------------------------------------------------------------- */

export const SITE_READINESS_ITEMS: { key: string; group: string }[] = [
  { key: 'access_route', group: 'access' },
  { key: 'working_hours_agreed', group: 'access' },
  { key: 'site_contact_confirmed', group: 'access' },
  { key: 'shaft_dimensions_verified', group: 'shaft_civil' },
  { key: 'pit_dry_and_finished', group: 'shaft_civil' },
  { key: 'overhead_clear', group: 'shaft_civil' },
  { key: 'power_supply_available', group: 'electrical' },
  { key: 'earthing_available', group: 'electrical' },
  { key: 'secure_storage', group: 'storage' },
  { key: 'safe_access_and_barricading', group: 'safe_access' },
  { key: 'approved_drawings_on_site', group: 'drawings' },
  { key: 'customer_dependencies_met', group: 'customer' },
  { key: 'stage_permits_checked', group: 'permits' },
];

export const CHECKLIST_RESULTS = ['pass', 'fail', 'not_applicable', 'awaiting_evidence'] as const;

/** Every catalogue item must be answered; then the Gate 8 rules of evaluateChecklist apply. */
export function evaluateSiteReadiness(answers: readonly ChecklistItem[]): { passed: boolean; failures: GuardFailure[] } {
  const failures: GuardFailure[] = [];
  const byKey = new Map(answers.map((a) => [a.key, a]));
  for (const item of SITE_READINESS_ITEMS) {
    if (!byKey.has(item.key)) failures.push({ code: 'REQUIRED_FIELD_MISSING', message: `${item.key}: not answered`, fields: [item.key] });
  }
  for (const a of answers) {
    if (a.result === 'not_applicable' && !(a.note && a.note.trim().length >= 3)) {
      failures.push({ code: 'REQUIRED_FIELD_MISSING', message: `${a.key}: "Not applicable" requires a reason`, fields: [a.key] });
    } else if (a.result === 'fail') {
      failures.push({ code: 'SITE_NOT_READY', message: `${a.key}: failed`, missing: [a.key] });
    } else if (a.result === 'awaiting_evidence') {
      failures.push({ code: 'EVIDENCE_REQUIRED', message: `${a.key}: awaiting evidence`, missing: [a.key] });
    }
  }
  return { passed: failures.length === 0, failures };
}

/* -------------------------------------------------------------------------- */
/* Safety pre-start (WT03, Gate 11)                                           */
/* -------------------------------------------------------------------------- */

/** Launch safety controls (§14.7). Critical controls block Start when not confirmed; no override exists. */
export const DEFAULT_SAFETY_CHECKS: { key: string; critical: boolean }[] = [
  { key: 'ppe', critical: true },
  { key: 'work_at_height', critical: true },
  { key: 'electrical_isolation', critical: true },
  { key: 'shaft_access_control', critical: true },
  { key: 'barricading', critical: true },
  { key: 'emergency_access', critical: true },
  { key: 'tool_inspection', critical: false },
  { key: 'supervisor_briefing', critical: false },
];

/** Builds the SafetyCheck list from answers; unknown keys are ignored, missing answers count as not confirmed. */
export function safetyChecksFromAnswers(answers: Record<string, { applicable: boolean; confirmed: boolean }>): SafetyCheck[] {
  return DEFAULT_SAFETY_CHECKS.map((c) => ({ key: c.key, critical: c.critical, applicable: answers[c.key]?.applicable ?? true, confirmed: answers[c.key]?.confirmed ?? false }));
}

/* -------------------------------------------------------------------------- */
/* Installation tasks (LP07, WT02, WT04, Gate 9)                              */
/* -------------------------------------------------------------------------- */

export const WORKER_SKILLS = ['general', 'mechanical', 'electrical', 'testing'] as const;
export type WorkerSkill = (typeof WORKER_SKILLS)[number];
export const TASK_EVIDENCE_CATEGORIES = ['before', 'in_progress', 'after', 'correction'] as const;
export type TaskEvidenceCategory = (typeof TASK_EVIDENCE_CATEGORIES)[number];

export interface TaskTemplateItem {
  code: string;
  skill: WorkerSkill;
  prerequisites: string[];
  checklist: string[];
  evidence: TaskEvidenceCategory[];
}

/** Launch rule `execution.task_template` (D-030): the new-installation task list. */
export const DEFAULT_TASK_TEMPLATE: TaskTemplateItem[] = [
  { code: 'mobilisation', skill: 'general', prerequisites: [], checklist: ['materials_verified', 'tools_inspected', 'work_area_barricaded'], evidence: ['before'] },
  { code: 'rail_installation', skill: 'mechanical', prerequisites: ['mobilisation'], checklist: ['brackets_fixed', 'rails_aligned', 'alignment_recorded'], evidence: ['before', 'after'] },
  { code: 'machine_installation', skill: 'mechanical', prerequisites: ['rail_installation'], checklist: ['machine_mounted', 'ropes_installed', 'governor_installed'], evidence: ['after'] },
  { code: 'car_and_counterweight', skill: 'mechanical', prerequisites: ['machine_installation'], checklist: ['car_frame_assembled', 'counterweight_assembled', 'safety_gear_fitted'], evidence: ['after'] },
  { code: 'doors', skill: 'mechanical', prerequisites: ['rail_installation'], checklist: ['landing_doors_fitted', 'door_locks_fitted', 'car_door_fitted'], evidence: ['after'] },
  { code: 'electrical_wiring', skill: 'electrical', prerequisites: ['machine_installation'], checklist: ['controller_mounted', 'shaft_wiring_done', 'safety_circuit_checked', 'earthing_connected'], evidence: ['after'] },
  { code: 'pre_commissioning', skill: 'testing', prerequisites: ['car_and_counterweight', 'doors', 'electrical_wiring'], checklist: ['trial_runs_completed', 'safety_devices_tested', 'levelling_checked'], evidence: ['after'] },
];

export function validateTaskTemplate(items: readonly TaskTemplateItem[]): string[] {
  const errors: string[] = [];
  const codes = new Set<string>();
  for (const i of items) {
    if (codes.has(i.code)) errors.push(`duplicate task ${i.code}`);
    for (const p of i.prerequisites) if (!codes.has(p)) errors.push(`${i.code}: prerequisite ${p} must come earlier`);
    if (i.checklist.length === 0) errors.push(`${i.code}: checklist is empty`);
    if (!WORKER_SKILLS.includes(i.skill)) errors.push(`${i.code}: unknown skill ${i.skill}`);
    codes.add(i.code);
  }
  return errors;
}

/** Statuses at which a prerequisite counts as done for sequencing (D-031): submitted work may be followed; QA approval is checked at final QA. */
export const PREREQUISITE_DONE_STATES = ['submitted', 'approved', 'closed'] as const;

export function prerequisitesComplete(prerequisites: readonly string[], statusByCode: Readonly<Record<string, string>>): boolean {
  return prerequisites.every((p) => (PREREQUISITE_DONE_STATES as readonly string[]).includes(statusByCode[p] ?? ''));
}

export interface ChecklistAnswer {
  done: boolean;
  /** Required (3+ characters) when the item is marked not applicable. */
  notApplicableReason?: string | null;
}

/** Gate 9: every checklist item done or not applicable with a reason; every required evidence category present. */
export function taskSubmissionCheck(
  checklist: readonly string[],
  answers: Readonly<Record<string, ChecklistAnswer>>,
  requiredEvidence: readonly string[],
  evidenceCategories: readonly string[],
): { checklistComplete: boolean; incomplete: string[]; missingEvidence: string[] } {
  const incomplete = checklist.filter((k) => {
    const a = answers[k];
    if (!a) return true;
    if (a.done) return false;
    return !(a.notApplicableReason && a.notApplicableReason.trim().length >= 3);
  });
  const missingEvidence = requiredEvidence.filter((c) => !evidenceCategories.includes(c));
  return { checklistComplete: incomplete.length === 0, incomplete, missingEvidence };
}

/* -------------------------------------------------------------------------- */
/* Blockers and incidents (WT05)                                              */
/* -------------------------------------------------------------------------- */

export const BLOCKER_CATEGORIES = [
  'material_missing',
  'site_inaccessible',
  'drawing_unclear',
  'unsafe_condition',
  'equipment_issue',
  'customer_dependency',
  'injury_incident',
  'other',
] as const;
export type BlockerCategory = (typeof BLOCKER_CATEGORIES)[number];

/** Categories that stop the work (Gate 11) and escalate immediately. */
export const SAFETY_STOP_CATEGORIES: readonly BlockerCategory[] = ['unsafe_condition', 'injury_incident'];

export function isSafetyStop(category: string): boolean {
  return (SAFETY_STOP_CATEGORIES as readonly string[]).includes(category);
}

/* -------------------------------------------------------------------------- */
/* Daily work report (LP08)                                                   */
/* -------------------------------------------------------------------------- */

export interface DailyReportInput {
  reportDate?: string | null;
  presentUserIds?: readonly string[] | null;
  workCompleted?: string | null;
  workNotCompleted?: string | null;
  materialUsed?: string | null;
  materialShortage?: string | null;
  blockers?: string | null;
  incidentDeclared?: boolean | null;
  safetyObservations?: string | null;
  nextDayPlan?: string | null;
}

const filled = (s: string | null | undefined) => typeof s === 'string' && s.trim().length >= 3;

/** Missing fields of a daily report. A declared incident needs safety observations. */
export function dailyReportMissing(r: DailyReportInput, today: string): string[] {
  const missing: string[] = [];
  if (!r.reportDate || r.reportDate > today) missing.push('report_date');
  if (!r.presentUserIds || r.presentUserIds.length === 0) missing.push('present_user_ids');
  if (!filled(r.workCompleted)) missing.push('work_completed');
  if (typeof r.incidentDeclared !== 'boolean') missing.push('incident_declared');
  if (r.incidentDeclared === true && !filled(r.safetyObservations)) missing.push('safety_observations');
  if (!filled(r.nextDayPlan)) missing.push('next_day_plan');
  return missing;
}

/* -------------------------------------------------------------------------- */
/* Installation readiness (§50, Gate 8 at project level)                      */
/* -------------------------------------------------------------------------- */

export const READINESS_DIMENSIONS = ['technical', 'site', 'payment', 'material', 'partner', 'documentation'] as const;

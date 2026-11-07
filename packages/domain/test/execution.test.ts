import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTNER_REQUIREMENTS,
  DEFAULT_SAFETY_CHECKS,
  DEFAULT_TASK_TEMPLATE,
  SITE_READINESS_ITEMS,
  assignmentMachine,
  dailyReportMissing,
  evaluateSafetyPreStart,
  evaluateSiteReadiness,
  isSafetyStop,
  missingPartnerProfileFields,
  partnerEligibleForAssignment,
  prerequisitesComplete,
  requirementsForProject,
  safetyChecksFromAnswers,
  taskMachine,
  taskSubmissionCheck,
  validateTaskTemplate,
  transition,
  PERMISSION_CODES,
} from '../src';

const ALL = new Set(PERMISSION_CODES);
const can = (m: any, from: string, action: string, context: object, reason?: string) => transition(m, from, { action, actorPermissions: ALL, context, reason });

const today = '2026-11-07';
const verified = (type: string, extra: Record<string, unknown> = {}) => ({ type, verification: 'verified' as const, expiresOn: '2027-11-07', ...extra });

describe('Gate 7 — partner eligibility per project', () => {
  const docs = [verified('contractor_licence', { scope: ['passenger', 'goods'] }), verified('insurance'), verified('pan', { expiresOn: null }), verified('bank_verification', { expiresOn: null })];
  it('an approved partner with verified, unexpired documents in scope is eligible', () => {
    expect(partnerEligibleForAssignment('approved', docs, requirementsForProject(DEFAULT_PARTNER_REQUIREMENTS, 'passenger'), today).eligible).toBe(true);
  });
  it('the licence scope must cover the project lift category', () => {
    const r = partnerEligibleForAssignment('approved', docs, requirementsForProject(DEFAULT_PARTNER_REQUIREMENTS, 'hospital'), today);
    expect(r.eligible).toBe(false);
    expect(r.failures[0]!.message).toContain('scope_insufficient');
  });
  it('an expired insurance blocks; so does a draft or suspended partner', () => {
    const expired = docs.map((d) => (d.type === 'insurance' ? { ...d, expiresOn: '2026-11-06' } : d));
    expect(partnerEligibleForAssignment('approved', expired, requirementsForProject(DEFAULT_PARTNER_REQUIREMENTS, 'passenger'), today).failures.map((f) => f.message)).toEqual(['insurance: expired']);
    expect(partnerEligibleForAssignment('suspended', docs, requirementsForProject(DEFAULT_PARTNER_REQUIREMENTS, 'passenger'), today).eligible).toBe(false);
    expect(partnerEligibleForAssignment('draft', docs, requirementsForProject(DEFAULT_PARTNER_REQUIREMENTS, 'passenger'), today).eligible).toBe(false);
  });
  it('a document expiring today is still valid today', () => {
    const lastDay = docs.map((d) => (d.type === 'insurance' ? { ...d, expiresOn: today } : d));
    expect(partnerEligibleForAssignment('approved', lastDay, requirementsForProject(DEFAULT_PARTNER_REQUIREMENTS, 'passenger'), today).eligible).toBe(true);
  });
  it('profile completeness before submission', () => {
    expect(missingPartnerProfileFields({})).toContain('legal_name');
    expect(missingPartnerProfileFields({ legal_name: 'Lift Co', entity_type: 'llp', registered_address: 'Pune', authorized_representative: 'A B', contact_phone: '9000000000', service_areas: ['Pune'], lift_categories: ['passenger'], team_size: 6, safety_policy_accepted: true, compliance_declaration: true })).toEqual([]);
    expect(missingPartnerProfileFields({ team_size: 0, safety_policy_accepted: false })).toEqual(expect.arrayContaining(['team_size', 'safety_policy_accepted']));
  });
});

describe('project invitation machine', () => {
  it('acceptance needs Gate 7 at the moment of acceptance; decline needs a reason', () => {
    expect(can(assignmentMachine, 'invited', 'accept', { partnerEligible: false }).ok).toBe(false);
    expect(can(assignmentMachine, 'invited', 'accept', { partnerEligible: true }).ok).toBe(true);
    expect(can(assignmentMachine, 'invited', 'decline', {}).ok).toBe(false);
    expect(can(assignmentMachine, 'invited', 'decline', {}, 'No team free').ok).toBe(true);
    expect(can(assignmentMachine, 'clarification_requested', 'accept', { partnerEligible: true }).ok).toBe(false);
    expect(can(assignmentMachine, 'clarification_requested', 'reissue', { partnerEligible: true }, 'Schedule moved').ok).toBe(true);
  });
});

describe('Gate 8 — site readiness', () => {
  const allPass = SITE_READINESS_ITEMS.map((i) => ({ key: i.key, group: i.group, result: 'pass' as const }));
  it('passes only when every item is answered and none failed or awaits evidence', () => {
    expect(evaluateSiteReadiness(allPass).passed).toBe(true);
    expect(evaluateSiteReadiness(allPass.slice(1)).failures[0]!.fields).toEqual(['access_route']);
    expect(evaluateSiteReadiness(allPass.map((a, i) => (i === 0 ? { ...a, result: 'fail' as const } : a))).failures[0]!.code).toBe('SITE_NOT_READY');
    expect(evaluateSiteReadiness(allPass.map((a, i) => (i === 0 ? { ...a, result: 'awaiting_evidence' as const } : a))).failures[0]!.code).toBe('EVIDENCE_REQUIRED');
  });
  it('"not applicable" needs a reason', () => {
    expect(evaluateSiteReadiness(allPass.map((a, i) => (i === 0 ? { ...a, result: 'not_applicable' as const } : a))).passed).toBe(false);
    expect(evaluateSiteReadiness(allPass.map((a, i) => (i === 0 ? { ...a, result: 'not_applicable' as const, note: 'Ground floor only' } : a))).passed).toBe(true);
  });
});

describe('Gate 11 — safety pre-start', () => {
  const all = Object.fromEntries(DEFAULT_SAFETY_CHECKS.map((c) => [c.key, { applicable: true, confirmed: true }]));
  it('every critical control confirmed → can start; one critical missing → cannot', () => {
    expect(evaluateSafetyPreStart(safetyChecksFromAnswers(all)).canStart).toBe(true);
    const r = evaluateSafetyPreStart(safetyChecksFromAnswers({ ...all, electrical_isolation: { applicable: true, confirmed: false } }));
    expect(r).toMatchObject({ canStart: false, criticalFailures: ['electrical_isolation'] });
  });
  it('a non-critical gap is a warning, a not-applicable control is not required, and an empty answer set counts as unconfirmed', () => {
    expect(evaluateSafetyPreStart(safetyChecksFromAnswers({ ...all, tool_inspection: { applicable: true, confirmed: false } }))).toMatchObject({ canStart: true, warnings: ['tool_inspection'] });
    expect(evaluateSafetyPreStart(safetyChecksFromAnswers({ ...all, work_at_height: { applicable: false, confirmed: false } })).canStart).toBe(true);
    expect(evaluateSafetyPreStart(safetyChecksFromAnswers({})).canStart).toBe(false);
  });
  it('safety and injury blockers stop the work', () => {
    expect(isSafetyStop('unsafe_condition')).toBe(true);
    expect(isSafetyStop('injury_incident')).toBe(true);
    expect(isSafetyStop('material_missing')).toBe(false);
  });
  it('the task machine refuses to start under a safety stop or without a passed pre-start', () => {
    expect(can(taskMachine, 'accepted', 'start', { safetyStopActive: true, safetyPreStartPassed: true, prerequisitesComplete: true }).ok).toBe(false);
    expect(can(taskMachine, 'accepted', 'start', { safetyPreStartPassed: false, prerequisitesComplete: true }).ok).toBe(false);
    expect(can(taskMachine, 'accepted', 'start', { safetyPreStartPassed: true, prerequisitesComplete: true }).ok).toBe(true);
  });
});

describe('Gate 9 — tasks', () => {
  it('the launch template is ordered, with known skills and non-empty checklists', () => {
    expect(validateTaskTemplate(DEFAULT_TASK_TEMPLATE)).toEqual([]);
    expect(validateTaskTemplate([{ code: 'b', skill: 'general', prerequisites: ['a'], checklist: ['x'], evidence: [] }])).toEqual(['b: prerequisite a must come earlier']);
  });
  it('prerequisites count once submitted (QA approval is checked at final QA)', () => {
    expect(prerequisitesComplete(['mobilisation'], { mobilisation: 'in_progress' })).toBe(false);
    expect(prerequisitesComplete(['mobilisation'], { mobilisation: 'submitted' })).toBe(true);
    expect(prerequisitesComplete([], {})).toBe(true);
    expect(prerequisitesComplete(['doors', 'electrical_wiring'], { doors: 'approved' })).toBe(false);
  });
  it('submission needs every checklist item and every required evidence category', () => {
    const r = taskSubmissionCheck(['a', 'b'], { a: { done: true }, b: { done: false, notApplicableReason: 'no' } }, ['before', 'after'], ['before']);
    expect(r).toEqual({ checklistComplete: false, incomplete: ['b'], missingEvidence: ['after'] });
    expect(taskSubmissionCheck(['a', 'b'], { a: { done: true }, b: { done: false, notApplicableReason: 'Not in scope' } }, ['after'], ['after', 'before'])).toEqual({ checklistComplete: true, incomplete: [], missingEvidence: [] });
  });
});

describe('daily report', () => {
  const base = { reportDate: today, presentUserIds: ['u1'], workCompleted: 'Rails fixed to floor 3', incidentDeclared: false, nextDayPlan: 'Floors 4 and 5' };
  it('requires date (not future), people present, work done, incident declaration and next-day plan', () => {
    expect(dailyReportMissing(base, today)).toEqual([]);
    expect(dailyReportMissing({}, today)).toEqual(['report_date', 'present_user_ids', 'work_completed', 'incident_declared', 'next_day_plan']);
    expect(dailyReportMissing({ ...base, reportDate: '2026-11-08' }, today)).toEqual(['report_date']);
  });
  it('a declared incident needs safety observations', () => {
    expect(dailyReportMissing({ ...base, incidentDeclared: true }, today)).toEqual(['safety_observations']);
    expect(dailyReportMissing({ ...base, incidentDeclared: true, safetyObservations: 'Loose plank at landing 2, removed' }, today)).toEqual([]);
  });
});

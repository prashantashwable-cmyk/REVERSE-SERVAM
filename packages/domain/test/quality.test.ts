import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QA_CHECKLISTS,
  DEFAULT_TASK_TEMPLATE,
  DEFAULT_WARRANTY_TERMS,
  defectMachine,
  defectMissing,
  defectStopsWork,
  evaluateInspection,
  missingHandoverDocuments,
  missingStatutoryEvidence,
  projectMachine,
  taskMachine,
  transition,
  warrantyFromEvent,
  PERMISSION_CODES,
} from '../src';

const ALL = new Set(PERMISSION_CODES);
const can = (m: any, from: string, action: string, context: object, reason?: string) => transition(m, from, { action, actorPermissions: ALL, context, reason });

describe('QA checklists and inspection outcome (Gate 10)', () => {
  it('there is a checklist for every task in the template and for final QA', () => {
    for (const t of DEFAULT_TASK_TEMPLATE) expect(DEFAULT_QA_CHECKLISTS[t.code]?.length).toBeGreaterThan(0);
    expect(DEFAULT_QA_CHECKLISTS.final!.length).toBeGreaterThan(0);
  });
  const crit = DEFAULT_QA_CHECKLISTS.rail_installation!;
  const all = (r: string) => Object.fromEntries(crit.map((c) => [c.key, { result: r as never }]));
  it('all pass → passed; any fail → failed; a hold without a fail → on hold', () => {
    expect(evaluateInspection(crit, all('pass')).outcome).toBe('passed');
    expect(evaluateInspection(crit, { ...all('pass'), bracket_spacing: { result: 'fail' } })).toMatchObject({ outcome: 'failed', failed: ['bracket_spacing'] });
    expect(evaluateInspection(crit, { ...all('pass'), fixings_tight: { result: 'hold' } })).toMatchObject({ outcome: 'on_hold', held: ['fixings_tight'] });
    expect(evaluateInspection(crit, { ...all('hold'), fixings_tight: { result: 'fail' } }).outcome).toBe('failed');
  });
  it('every criterion must be answered; critical criteria are never N/A; N/A needs a reason', () => {
    expect(evaluateInspection(crit, {}).outcome).toBeNull();
    expect(evaluateInspection(crit, { ...all('pass'), bracket_spacing: { result: 'not_applicable', note: 'No brackets' } }).problems[0]!.code).toBe('VALIDATION_FAILED');
    expect(evaluateInspection(crit, { ...all('pass'), fixings_tight: { result: 'not_applicable' } }).problems[0]!.code).toBe('REQUIRED_FIELD_MISSING');
    expect(evaluateInspection(crit, { ...all('pass'), fixings_tight: { result: 'not_applicable', note: 'Welded brackets' } }).outcome).toBe('passed');
  });
  it('QA approval must be independent and a failure needs a defect', () => {
    expect(can(taskMachine, 'submitted', 'qa_pass', { inspectorIndependent: false }).ok).toBe(false);
    expect(can(taskMachine, 'submitted', 'qa_pass', { inspectorIndependent: true, submittedBy: 'u1', inspectorId: 'u1' }).ok).toBe(false);
    expect(can(taskMachine, 'submitted', 'qa_pass', { inspectorIndependent: true, submittedBy: 'u1', inspectorId: 'q1' }).ok).toBe(true);
    expect(can(taskMachine, 'submitted', 'qa_fail', { defectCreated: false }).ok).toBe(false);
  });
});

describe('defects and rework (QA04, QA05)', () => {
  const today = '2026-11-07';
  it('a defect needs category, severity, location, description, criterion and a future due date', () => {
    expect(defectMissing({}, today)).toEqual(['category', 'severity', 'location', 'description', 'criterion_key', 'correction_due_date']);
    expect(defectMissing({ category: 'alignment', severity: 'major', location: 'Rail, floor 3 bracket', description: 'Out of plumb by 4 mm', criterionKey: 'rail_alignment_within_tolerance', correctionDueDate: '2026-11-10' }, today)).toEqual([]);
    expect(defectMissing({ category: 'alignment', severity: 'major', location: 'Rail', description: 'Off', criterionKey: 'x', correctionDueDate: '2026-11-06' }, today)).toEqual(['correction_due_date']);
  });
  it('critical defects stop work; a correction needs evidence and the corrector cannot verify it', () => {
    expect(defectStopsWork('critical')).toBe(true);
    expect(defectStopsWork('major')).toBe(false);
    expect(can(defectMachine, 'correction_in_progress', 'submit_correction', { correctionEvidenceCount: 0 }).ok).toBe(false);
    expect(can(defectMachine, 'submitted_for_reinspection', 'verify', { correctedBy: 'u1', inspectorId: 'u1' }).ok).toBe(false);
    expect(can(defectMachine, 'verified', 'close', { correctionEvidenceCount: 1 }).ok).toBe(true);
  });
});

describe('statutory evidence, handover and warranty (Gates 12–14)', () => {
  it('internal QA never satisfies Gate 12: verified official evidence of every required type is needed', () => {
    expect(missingStatutoryEvidence([])).toEqual(['authority_inspection_report', 'operating_licence']);
    expect(missingStatutoryEvidence(['authority_inspection_report', 'operating_licence'])).toEqual([]);
    expect(can(projectMachine, 'statutory_pending', 'record_statutory_clearance', { statutoryEvidenceVerified: false }).ok).toBe(false);
  });
  it('handover needs documents, customer acceptance and statutory evidence; closure needs the warranty asset', () => {
    expect(missingHandoverDocuments(['final_project_report'])).toHaveLength(6);
    expect(can(projectMachine, 'handover_ready', 'complete_handover', { handoverDocumentsComplete: true, customerAccepted: false, statutoryEvidenceVerified: true }).ok).toBe(false);
    expect(can(projectMachine, 'handed_over', 'close', { warrantyAssetCreated: false }).ok).toBe(false);
  });
  it('warranty starts from the contractual event and records its source date', () => {
    expect(warrantyFromEvent({ handover_acceptance: '2026-11-07T10:00:00Z' })).toEqual({ startEvent: 'handover_acceptance', sourceDate: '2026-11-07', start: '2026-11-07', end: '2027-11-06' });
    expect(warrantyFromEvent({ statutory_approval: '2026-11-01' })).toBeNull();
    expect(warrantyFromEvent({ statutory_approval: '2026-11-01' }, { months: 24, startEvent: 'statutory_approval' })?.end).toBe('2028-10-31');
    expect(DEFAULT_WARRANTY_TERMS.months).toBe(12);
  });
});

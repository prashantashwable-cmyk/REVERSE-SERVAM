import type { GuardFailure } from './state-machine';
import { warrantyPeriod } from './gates';

/**
 * QA to handover (spec §15, §16.7, §44 QA01–QA06, §45 CU07, Gates 10, 12, 13, 14).
 * Checklists, statutory evidence types, handover documents and warranty terms are
 * versioned rules mirrored in the database (parity-tested). The illustrative criteria
 * below are NOT a statutory test procedure: qualified engineers must approve them (D-034).
 */

/* -------------------------------------------------------------------------- */
/* Inspection checklists (QA03)                                               */
/* -------------------------------------------------------------------------- */

export interface QaCriterion {
  key: string;
  /** Critical criteria can never be marked not applicable (they must pass). */
  critical: boolean;
}

/** Launch rule `qa.checklists` (D-034): one checklist per installation task, plus `final`. */
export const DEFAULT_QA_CHECKLISTS: Record<string, QaCriterion[]> = {
  mobilisation: [
    { key: 'material_matches_bom', critical: false },
    { key: 'site_safety_setup', critical: true },
  ],
  rail_installation: [
    { key: 'bracket_spacing', critical: true },
    { key: 'rail_alignment_within_tolerance', critical: true },
    { key: 'fixings_tight', critical: false },
  ],
  machine_installation: [
    { key: 'machine_secured', critical: true },
    { key: 'rope_terminations', critical: true },
    { key: 'governor_function', critical: true },
  ],
  car_and_counterweight: [
    { key: 'car_frame_square', critical: false },
    { key: 'safety_gear_set', critical: true },
    { key: 'counterweight_guarding', critical: true },
  ],
  doors: [
    { key: 'door_lock_engagement', critical: true },
    { key: 'door_gaps', critical: false },
  ],
  electrical_wiring: [
    { key: 'earthing_continuity', critical: true },
    { key: 'safety_circuit_complete', critical: true },
    { key: 'wiring_routed_and_labelled', critical: false },
  ],
  pre_commissioning: [
    { key: 'functional_operation', critical: true },
    { key: 'levelling_accuracy', critical: false },
    { key: 'emergency_operation', critical: true },
  ],
  final: [
    { key: 'all_stage_inspections_passed', critical: true },
    { key: 'installed_matches_configuration', critical: true },
    { key: 'test_records_present', critical: true },
    { key: 'emergency_systems_working', critical: true },
    { key: 'site_clean_and_safe', critical: false },
  ],
};

export const QA_RESULTS = ['pass', 'fail', 'hold', 'not_applicable'] as const;
export type QaResult = (typeof QA_RESULTS)[number];
export const INSPECTION_OUTCOMES = ['passed', 'failed', 'on_hold'] as const;
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

export interface QaAnswer {
  result: QaResult;
  note?: string | null;
}

/**
 * Overall outcome of one inspection. Every criterion must be answered; N/A needs a reason and is
 * refused for critical criteria. Any fail → failed (a defect is required); otherwise any hold → on_hold.
 */
export function evaluateInspection(
  criteria: readonly QaCriterion[],
  answers: Readonly<Record<string, QaAnswer>>,
): { outcome: InspectionOutcome | null; problems: GuardFailure[]; failed: string[]; held: string[] } {
  const problems: GuardFailure[] = [];
  const failed: string[] = [];
  const held: string[] = [];
  for (const c of criteria) {
    const a = answers[c.key];
    if (!a || !(QA_RESULTS as readonly string[]).includes(a.result)) {
      problems.push({ code: 'REQUIRED_FIELD_MISSING', message: `${c.key}: not answered`, fields: [c.key] });
      continue;
    }
    if (a.result === 'not_applicable') {
      if (c.critical) problems.push({ code: 'VALIDATION_FAILED', message: `${c.key}: a critical criterion cannot be not applicable`, fields: [c.key] });
      else if (!(a.note && a.note.trim().length >= 3)) problems.push({ code: 'REQUIRED_FIELD_MISSING', message: `${c.key}: "Not applicable" requires a reason`, fields: [c.key] });
    }
    if (a.result === 'fail') failed.push(c.key);
    if (a.result === 'hold') held.push(c.key);
  }
  if (problems.length) return { outcome: null, problems, failed, held };
  return { outcome: failed.length ? 'failed' : held.length ? 'on_hold' : 'passed', problems, failed, held };
}

/* -------------------------------------------------------------------------- */
/* Defects (QA04, QA05)                                                       */
/* -------------------------------------------------------------------------- */

export const DEFECT_CATEGORIES = ['mechanical', 'alignment', 'electrical', 'safety_component', 'doors', 'documentation', 'workmanship', 'other'] as const;
export const DEFECT_SEVERITIES = ['minor', 'major', 'critical'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export interface DefectInput {
  category?: string | null;
  severity?: string | null;
  location?: string | null;
  description?: string | null;
  criterionKey?: string | null;
  correctionDueDate?: string | null;
}

/** Required defect fields (QA04): category, severity, exact location, description, criterion and a due date not in the past. */
export function defectMissing(d: DefectInput, today: string): string[] {
  const missing: string[] = [];
  if (!d.category || !(DEFECT_CATEGORIES as readonly string[]).includes(d.category)) missing.push('category');
  if (!d.severity || !(DEFECT_SEVERITIES as readonly string[]).includes(d.severity)) missing.push('severity');
  if (!d.location || d.location.trim().length < 3) missing.push('location');
  if (!d.description || d.description.trim().length < 3) missing.push('description');
  if (!d.criterionKey) missing.push('criterion_key');
  if (!d.correctionDueDate || d.correctionDueDate < today) missing.push('correction_due_date');
  return missing;
}

/** A critical defect stops the related work (Gate 11) until it is verified. */
export function defectStopsWork(severity: string): boolean {
  return severity === 'critical';
}

/** Defect states that still block final QA. */
export const OPEN_DEFECT_STATES = ['open', 'assigned', 'acknowledged', 'correction_in_progress', 'submitted_for_reinspection', 'disputed'] as const;

/* -------------------------------------------------------------------------- */
/* Statutory evidence (Gate 12)                                               */
/* -------------------------------------------------------------------------- */

export const STATUTORY_EVIDENCE_TYPES = ['authority_inspection_report', 'operating_licence', 'completion_certificate', 'other_official_document'] as const;

/** Launch rule `statutory.required_evidence` (D-020, D-035): what must be verified before handover. */
export const DEFAULT_STATUTORY_REQUIRED = ['authority_inspection_report', 'operating_licence'] as const;

export function missingStatutoryEvidence(verifiedTypes: readonly string[], required: readonly string[] = DEFAULT_STATUTORY_REQUIRED): string[] {
  return required.filter((t) => !verifiedTypes.includes(t));
}

/* -------------------------------------------------------------------------- */
/* Warranty (Gate 14)                                                         */
/* -------------------------------------------------------------------------- */

export const WARRANTY_START_EVENTS = ['handover_acceptance', 'statutory_approval'] as const;
export type WarrantyStartEvent = (typeof WARRANTY_START_EVENTS)[number];

/** Launch rule `warranty.terms` (D-010 → D-036): months and the contractual start event. */
export const DEFAULT_WARRANTY_TERMS = { months: 12, startEvent: 'handover_acceptance' as WarrantyStartEvent };

/** The warranty window from the recorded source event date. */
export function warrantyFromEvent(events: Partial<Record<WarrantyStartEvent, string | null>>, terms = DEFAULT_WARRANTY_TERMS) {
  const date = events[terms.startEvent];
  if (!date) return null;
  return { startEvent: terms.startEvent, sourceDate: date.slice(0, 10), ...warrantyPeriod(date, terms.months) };
}

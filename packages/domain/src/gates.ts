import type { GuardFailure } from './state-machine';
import { PARTNER_ASSIGNABLE_STATES, type PartnerState } from './machines';

/**
 * Critical business gates (spec §21) that are not a single state transition.
 * All thresholds / required sets are inputs so they stay configurable.
 */

/* ----------------------------- Gate 7: partner ---------------------------- */

export interface ComplianceDocument {
  type: string;
  verification: 'pending' | 'verified' | 'rejected';
  /** ISO date (YYYY-MM-DD) or null for non-expiring documents. */
  expiresOn: string | null;
  scope?: string[];
}

export interface ComplianceRequirement {
  type: string;
  /** If set, the document scope must include every listed capability. */
  requiredScope?: string[];
}

function isoDate(d: string): string {
  return d.slice(0, 10);
}

export function evaluatePartnerCompliance(
  documents: readonly ComplianceDocument[],
  requirements: readonly ComplianceRequirement[],
  today: string,
): GuardFailure[] {
  const failures: GuardFailure[] = [];
  for (const req of requirements) {
    const candidates = documents.filter((d) => d.type === req.type);
    const valid = candidates.find(
      (d) =>
        d.verification === 'verified' &&
        (d.expiresOn === null || isoDate(d.expiresOn) >= isoDate(today)) &&
        (req.requiredScope ?? []).every((s) => (d.scope ?? []).includes(s)),
    );
    if (valid) continue;
    let reason = 'missing';
    if (candidates.some((d) => d.verification === 'verified' && d.expiresOn !== null && isoDate(d.expiresOn) < isoDate(today))) reason = 'expired';
    else if (candidates.some((d) => d.verification === 'pending')) reason = 'verification_pending';
    else if (candidates.some((d) => d.verification === 'rejected')) reason = 'rejected';
    else if (candidates.length) reason = 'scope_insufficient';
    failures.push({ code: 'PARTNER_COMPLIANCE_BLOCK', message: `${req.type}: ${reason}`, missing: [req.type] });
  }
  return failures;
}

export function partnerEligibleForAssignment(
  status: PartnerState,
  documents: readonly ComplianceDocument[],
  requirements: readonly ComplianceRequirement[],
  today: string,
): { eligible: boolean; failures: GuardFailure[] } {
  const failures = evaluatePartnerCompliance(documents, requirements, today);
  if (!PARTNER_ASSIGNABLE_STATES.includes(status)) {
    failures.unshift({ code: 'PARTNER_COMPLIANCE_BLOCK', message: `Partner status "${status}" does not permit new assignments` });
  }
  return { eligible: failures.length === 0, failures };
}

/** Documents expiring within `withinDays` (for reminders, §22). */
export function expiringDocuments(documents: readonly ComplianceDocument[], today: string, withinDays: number): ComplianceDocument[] {
  const limit = new Date(`${isoDate(today)}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + withinDays);
  const limitIso = limit.toISOString().slice(0, 10);
  return documents.filter((d) => d.expiresOn !== null && isoDate(d.expiresOn) >= isoDate(today) && isoDate(d.expiresOn) <= limitIso);
}

/* --------------------------- Gate 8: site readiness ----------------------- */

export type ChecklistResult = 'pass' | 'fail' | 'not_applicable' | 'awaiting_evidence';

export interface ChecklistItem {
  key: string;
  group: string;
  result: ChecklistResult;
  note?: string | null;
  critical?: boolean;
}

export function evaluateChecklist(items: readonly ChecklistItem[]): { passed: boolean; failures: GuardFailure[] } {
  const failures: GuardFailure[] = [];
  for (const i of items) {
    if (i.result === 'not_applicable' && !(i.note && i.note.trim().length >= 3)) {
      failures.push({ code: 'REQUIRED_FIELD_MISSING', message: `${i.key}: "Not applicable" requires a reason`, fields: [i.key] });
    } else if (i.result === 'fail') {
      failures.push({ code: 'SITE_NOT_READY', message: `${i.key}: failed`, missing: [i.key] });
    } else if (i.result === 'awaiting_evidence') {
      failures.push({ code: 'EVIDENCE_REQUIRED', message: `${i.key}: awaiting evidence`, missing: [i.key] });
    }
  }
  return { passed: failures.length === 0, failures };
}

/* --------------------------- Gate 11: safety stop ------------------------- */

export interface SafetyCheck {
  key: string;
  applicable: boolean;
  confirmed: boolean;
  /** Critical controls block start when not confirmed. */
  critical: boolean;
}

/**
 * Safety pre-start (§14.7, §43 WT03). Critical failures disable Start. There
 * is deliberately NO override parameter: no deadline or role bypasses this.
 */
export function evaluateSafetyPreStart(checks: readonly SafetyCheck[]): { canStart: boolean; criticalFailures: string[]; warnings: string[] } {
  const criticalFailures = checks.filter((c) => c.applicable && c.critical && !c.confirmed).map((c) => c.key);
  const warnings = checks.filter((c) => c.applicable && !c.critical && !c.confirmed).map((c) => c.key);
  return { canStart: criticalFailures.length === 0 && checks.length > 0, criticalFailures, warnings };
}

/* ---------------------- §50 readiness & timeline promises ----------------- */

export interface ReadinessScores {
  technical: boolean;
  site: boolean;
  payment: boolean;
  material: boolean;
  partner: boolean;
  documentation: boolean;
}

export interface AcceleratedTargetEligibility {
  /** Standard vs complex classification from configurable factors. */
  complexity: 'standard' | 'complex';
  readiness: ReadinessScores;
  targetApprovedBy?: string | null;
}

/**
 * A 14-day style accelerated target may be DISPLAYED only when the project is
 * standard, every readiness dimension passes and the target was approved.
 * It is always labelled `target`, never `contractual commitment`.
 */
export function acceleratedTargetDisplay(e: AcceleratedTargetEligibility): { show: boolean; label: 'target'; unmet: string[] } {
  const unmet: string[] = [];
  if (e.complexity !== 'standard') unmet.push('complexity');
  for (const [k, v] of Object.entries(e.readiness)) if (!v) unmet.push(k);
  if (!e.targetApprovedBy) unmet.push('target_approval');
  return { show: unmet.length === 0, label: 'target', unmet };
}

/* --------------------------- Gate 13 / 14 --------------------------------- */

export const DEFAULT_HANDOVER_DOCUMENTS = [
  'final_project_report',
  'approved_specifications',
  'operating_manual',
  'emergency_instructions',
  'warranty_certificate',
  'statutory_documents',
  'maintenance_schedule',
] as const;

export function missingHandoverDocuments(present: readonly string[], required: readonly string[] = DEFAULT_HANDOVER_DOCUMENTS): string[] {
  return required.filter((d) => !present.includes(d));
}

/**
 * Warranty start from the CONTRACTUAL event (D-010), recording its source date.
 * Returns ISO dates; end = start + months − 1 day.
 */
export function warrantyPeriod(startEventDate: string, months: number): { start: string; end: string } {
  if (!Number.isInteger(months) || months <= 0) throw new RangeError('months must be a positive integer');
  const start = new Date(`${isoDate(startEventDate)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new RangeError('invalid start date');
  const day = start.getUTCDate();
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  // Clamp to the last day of the target month (e.g. 31 Jan + 1 month → 28/29 Feb).
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  end.setUTCDate(end.getUTCDate() - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

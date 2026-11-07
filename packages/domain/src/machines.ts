import { defineMachine, type GuardFailure } from './state-machine';

/* -------------------------------------------------------------------------- */
/* Guard helpers                                                              */
/* -------------------------------------------------------------------------- */

const fail = (code: GuardFailure['code'], message: string, extra: Partial<GuardFailure> = {}): GuardFailure[] => [
  { code, message, ...extra },
];
const ok: GuardFailure[] = [];
const requireFields = (fields: Record<string, unknown>): GuardFailure[] => {
  const missing = Object.entries(fields)
    .filter(([, v]) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0))
    .map(([k]) => k);
  return missing.length ? fail('REQUIRED_FIELD_MISSING', `Required: ${missing.join(', ')}`, { fields: missing }) : ok;
};

/* -------------------------------------------------------------------------- */
/* Lead (spec §7, §20 steps 1–4)                                              */
/* -------------------------------------------------------------------------- */

export const LEAD_STATES = ['new', 'assigned', 'contacted', 'qualified', 'won', 'lost', 'invalid'] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export const LOST_REASONS = [
  'price',
  'competitor',
  'project_cancelled',
  'no_response',
  'budget_unavailable',
  'technical_infeasibility',
  'timeline_mismatch',
  'customer_postponed',
  'other',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const CALL_OUTCOMES = [
  'interested',
  'call_back',
  'meeting_requested',
  'survey_required',
  'proposal_requested',
  'no_answer',
  'not_interested',
  'invalid_enquiry',
  'lost_to_competitor',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Outcomes that prove a two-way contact happened (moves a lead to `contacted`). */
export const MEANINGFUL_CONTACT_OUTCOMES: readonly CallOutcome[] = [
  'interested',
  'call_back',
  'meeting_requested',
  'survey_required',
  'proposal_requested',
  'not_interested',
  'invalid_enquiry',
  'lost_to_competitor',
];

export interface LeadContext {
  assigneeId?: string | null;
  outcome?: CallOutcome | null;
  qualification?: {
    need?: string | null;
    decision_authority?: string | null;
    timeline?: string | null;
    next_action?: string | null;
  } | null;
  lostReason?: LostReason | null;
  hasConfirmedOrder?: boolean;
}

const OPEN_LEAD: readonly LeadState[] = ['new', 'assigned', 'contacted', 'qualified'];

export const leadMachine = defineMachine<LeadState, string, LeadContext>({
  name: 'lead',
  states: LEAD_STATES,
  initial: 'new',
  terminal: ['won', 'invalid'],
  transitions: [
    { action: 'assign', from: ['new'], to: 'assigned', permission: 'lead.assign', auditEvent: 'lead.assigned', guard: (c) => requireFields({ assignee_id: c.assigneeId }) },
    { action: 'reassign', from: ['assigned'], to: 'assigned', permission: 'lead.assign', requiresReason: true, auditEvent: 'lead.reassigned', guard: (c) => requireFields({ assignee_id: c.assigneeId }) },
    { action: 'reassign', from: ['contacted'], to: 'contacted', permission: 'lead.assign', requiresReason: true, auditEvent: 'lead.reassigned', guard: (c) => requireFields({ assignee_id: c.assigneeId }) },
    { action: 'reassign', from: ['qualified'], to: 'qualified', permission: 'lead.assign', requiresReason: true, auditEvent: 'lead.reassigned', guard: (c) => requireFields({ assignee_id: c.assigneeId }) },
    {
      action: 'record_contact',
      from: ['assigned'],
      to: 'contacted',
      permission: 'lead.activity.record',
      auditEvent: 'lead.contacted',
      guard: (c) =>
        c.outcome && MEANINGFUL_CONTACT_OUTCOMES.includes(c.outcome)
          ? ok
          : fail('VALIDATION_FAILED', 'Only a two-way contact outcome marks the lead as contacted', { fields: ['outcome'] }),
    },
    {
      action: 'qualify',
      from: ['contacted', 'qualified'],
      to: 'qualified',
      permission: 'lead.qualify',
      auditEvent: 'lead.qualified',
      guard: (c) =>
        requireFields({
          need: c.qualification?.need,
          decision_authority: c.qualification?.decision_authority,
          timeline: c.qualification?.timeline,
          next_action: c.qualification?.next_action,
        }),
    },
    {
      action: 'close_lost',
      from: OPEN_LEAD,
      to: 'lost',
      permission: 'lead.close',
      requiresReason: true,
      auditEvent: 'lead.closed_lost',
      guard: (c) => requireFields({ lost_reason: c.lostReason }),
    },
    { action: 'mark_invalid', from: ['new', 'assigned', 'contacted'], to: 'invalid', permission: 'lead.close', requiresReason: true, auditEvent: 'lead.marked_invalid' },
    {
      action: 'mark_won',
      from: ['qualified'],
      to: 'won',
      permission: 'order.convert',
      auditEvent: 'lead.won',
      guard: (c) => (c.hasConfirmedOrder ? ok : fail('APPROVAL_REQUIRED', 'A confirmed order is required before a lead is won')),
    },
    { action: 'reopen', from: ['lost'], to: 'assigned', permission: 'lead.assign', requiresReason: true, auditEvent: 'lead.reopened', guard: (c) => requireFields({ assignee_id: c.assigneeId }) },
  ],
});

/* -------------------------------------------------------------------------- */
/* Survey (spec §8, §38, Gate 1)                                              */
/* -------------------------------------------------------------------------- */

export const SURVEY_STATES = [
  'scheduled',
  'accepted',
  'reschedule_requested',
  'in_progress',
  'revisit_requested',
  'site_inaccessible',
  'submitted',
  'revision_requested',
  'under_review',
  'reviewed',
  'cancelled',
] as const;
export type SurveyState = (typeof SURVEY_STATES)[number];

export type GpsStatus = 'verified' | 'low_accuracy' | 'permission_denied' | 'unavailable';

export interface SurveyContext {
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  gpsStatus?: GpsStatus | null;
  gpsExceptionReason?: string | null;
  /** Result of validateSurveySubmission(); empty = complete. */
  submissionFailures?: GuardFailure[];
}

export const surveyMachine = defineMachine<SurveyState, string, SurveyContext>({
  name: 'survey',
  states: SURVEY_STATES,
  initial: 'scheduled',
  terminal: ['reviewed', 'cancelled'],
  transitions: [
    { action: 'accept', from: ['scheduled'], to: 'accepted', permission: 'survey.capture', auditEvent: 'survey.accepted' },
    { action: 'request_reschedule', from: ['scheduled', 'accepted'], to: 'reschedule_requested', permission: 'survey.capture', requiresReason: true, auditEvent: 'survey.reschedule_requested' },
    {
      action: 'reschedule',
      from: ['scheduled', 'accepted', 'reschedule_requested', 'site_inaccessible', 'revisit_requested', 'revision_requested'],
      to: 'scheduled',
      permission: 'survey.schedule',
      auditEvent: 'survey.rescheduled',
      guard: (c) => {
        const missing = requireFields({ scheduled_start: c.scheduledStart, scheduled_end: c.scheduledEnd });
        if (missing.length) return missing;
        return Date.parse(c.scheduledEnd!) > Date.parse(c.scheduledStart!)
          ? ok
          : fail('VALIDATION_FAILED', 'Appointment end must be after start', { fields: ['scheduled_end'] });
      },
    },
    {
      action: 'cancel',
      from: ['scheduled', 'accepted', 'reschedule_requested', 'in_progress', 'site_inaccessible', 'revisit_requested'],
      to: 'cancelled',
      permission: 'survey.schedule',
      requiresReason: true,
      auditEvent: 'survey.cancelled',
    },
    {
      action: 'check_in',
      from: ['accepted'],
      to: 'in_progress',
      permission: 'survey.capture',
      auditEvent: 'survey.checked_in',
      guard: (c) =>
        c.gpsStatus === 'verified' || (c.gpsExceptionReason && c.gpsExceptionReason.trim().length >= 3)
          ? ok
          : fail('VALIDATION_FAILED', 'Location is not verified: record an exception reason', { fields: ['gps_exception_reason'] }),
    },
    { action: 'save_draft', from: ['in_progress'], to: 'in_progress', permission: 'survey.capture', auditEvent: 'survey.draft_saved' },
    { action: 'report_inaccessible', from: ['accepted', 'in_progress'], to: 'site_inaccessible', permission: 'survey.capture', requiresReason: true, auditEvent: 'survey.site_inaccessible' },
    { action: 'request_revisit', from: ['in_progress'], to: 'revisit_requested', permission: 'survey.capture', requiresReason: true, auditEvent: 'survey.revisit_requested' },
    {
      action: 'submit',
      from: ['in_progress'],
      to: 'submitted',
      permission: 'survey.capture',
      auditEvent: 'survey.submitted',
      guard: (c) => c.submissionFailures ?? ok,
    },
    { action: 'request_revision', from: ['submitted', 'under_review'], to: 'revision_requested', permission: 'survey.review', requiresReason: true, auditEvent: 'survey.revision_requested' },
    { action: 'start_revision', from: ['revision_requested'], to: 'in_progress', permission: 'survey.capture', auditEvent: 'survey.revision_started' },
    { action: 'start_review', from: ['submitted'], to: 'under_review', permission: 'technical.review', auditEvent: 'survey.review_started' },
    { action: 'complete_review', from: ['under_review'], to: 'reviewed', permission: 'technical.review', auditEvent: 'survey.review_completed' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Technical review (spec §9.3–9.4, Gate 2)                                   */
/* -------------------------------------------------------------------------- */

export const TECHNICAL_REVIEW_STATES = [
  'open',
  'in_review',
  'clarification_requested',
  'feasible',
  'conditionally_feasible',
  'not_feasible',
  'insufficient_information',
] as const;
export type TechnicalReviewState = (typeof TECHNICAL_REVIEW_STATES)[number];

export interface TechnicalReviewContext {
  surveySubmitted?: boolean;
  technicalBasis?: string | null;
  constraints?: string[];
  correctiveActions?: string[];
}

const decisionGuard = (c: TechnicalReviewContext) => {
  if (!c.surveySubmitted) return fail('VALIDATION_FAILED', 'Survey must be submitted (Gate 1) before a decision');
  return requireFields({ technical_basis: c.technicalBasis });
};

export const technicalReviewMachine = defineMachine<TechnicalReviewState, string, TechnicalReviewContext>({
  name: 'technical_review',
  states: TECHNICAL_REVIEW_STATES,
  initial: 'open',
  terminal: ['feasible', 'conditionally_feasible', 'not_feasible'],
  transitions: [
    { action: 'start', from: ['open'], to: 'in_review', permission: 'technical.review', auditEvent: 'technical_review.started' },
    { action: 'request_clarification', from: ['in_review'], to: 'clarification_requested', permission: 'technical.review', requiresReason: true, auditEvent: 'technical_review.clarification_requested' },
    { action: 'resume', from: ['clarification_requested', 'insufficient_information'], to: 'in_review', permission: 'technical.review', auditEvent: 'technical_review.resumed' },
    { action: 'decide_feasible', from: ['in_review'], to: 'feasible', permission: 'technical.review', auditEvent: 'technical_review.decided', guard: decisionGuard },
    {
      action: 'decide_conditional',
      from: ['in_review'],
      to: 'conditionally_feasible',
      permission: 'technical.review',
      auditEvent: 'technical_review.decided',
      guard: (c) => {
        const base = decisionGuard(c);
        if (base.length) return base;
        return requireFields({ constraints: c.constraints, corrective_actions: c.correctiveActions });
      },
    },
    { action: 'decide_not_feasible', from: ['in_review'], to: 'not_feasible', permission: 'technical.review', requiresReason: true, auditEvent: 'technical_review.decided', guard: decisionGuard },
    { action: 'decide_insufficient', from: ['in_review'], to: 'insufficient_information', permission: 'technical.review', requiresReason: true, auditEvent: 'technical_review.decided', guard: decisionGuard },
  ],
});

/* -------------------------------------------------------------------------- */
/* Quotation revision (spec §7.7–7.8, §49, Gate 3)                            */
/* -------------------------------------------------------------------------- */

export const QUOTATION_STATES = [
  'draft',
  'pending_approval',
  'approved',
  'issued',
  'accepted',
  'rejected_by_customer',
  'superseded',
  'expired',
] as const;
export type QuotationState = (typeof QUOTATION_STATES)[number];

export interface QuotationContext {
  configurationApproved?: boolean;
  lineCount?: number;
  /** True when discount / margin is outside the requester's authority. */
  needsDiscountApproval?: boolean;
  requesterId?: string;
  actorId?: string;
  validUntil?: string | null;
  now?: string;
  termsComplete?: boolean;
  acceptedByName?: string | null;
  acceptorAuthority?: string | null;
  acceptanceEvidence?: string | null;
}

const notExpired = (c: QuotationContext) =>
  c.validUntil && c.now && Date.parse(c.validUntil) >= Date.parse(c.now)
    ? ok
    : fail('APPROVAL_EXPIRED', 'Quotation validity has expired; issue a new revision');

export const quotationMachine = defineMachine<QuotationState, string, QuotationContext>({
  name: 'quotation',
  states: QUOTATION_STATES,
  initial: 'draft',
  terminal: ['accepted', 'rejected_by_customer', 'superseded', 'expired'],
  transitions: [
    {
      action: 'finalize',
      from: ['draft'],
      to: 'approved',
      permission: 'quotation.create',
      auditEvent: 'quotation.finalized',
      guard: (c) => {
        if (!c.configurationApproved) return fail('APPROVAL_REQUIRED', 'An approved technical configuration is required (Gate 2)');
        if (!c.lineCount) return fail('REQUIRED_FIELD_MISSING', 'At least one quotation line is required', { fields: ['lines'] });
        if (c.needsDiscountApproval) return fail('APPROVAL_REQUIRED', 'Discount / margin exceeds authority; request approval');
        return ok;
      },
    },
    {
      action: 'request_approval',
      from: ['draft'],
      to: 'pending_approval',
      permission: 'quotation.create',
      auditEvent: 'quotation.approval_requested',
      guard: (c) => {
        if (!c.configurationApproved) return fail('APPROVAL_REQUIRED', 'An approved technical configuration is required (Gate 2)');
        if (!c.lineCount) return fail('REQUIRED_FIELD_MISSING', 'At least one quotation line is required', { fields: ['lines'] });
        return ok;
      },
    },
    {
      action: 'approve',
      from: ['pending_approval'],
      to: 'approved',
      permission: 'quotation.discount.approve',
      auditEvent: 'quotation.approved',
      guard: (c) =>
        c.requesterId && c.actorId && c.requesterId === c.actorId
          ? fail('SELF_APPROVAL_FORBIDDEN', 'The requester cannot approve their own discount')
          : ok,
    },
    { action: 'return_to_draft', from: ['pending_approval'], to: 'draft', permission: 'quotation.discount.approve', requiresReason: true, auditEvent: 'quotation.approval_rejected' },
    {
      action: 'issue',
      from: ['approved'],
      to: 'issued',
      permission: 'quotation.issue',
      auditEvent: 'quotation.issued',
      guard: (c) => (c.termsComplete ? notExpired(c) : fail('REQUIRED_FIELD_MISSING', 'Scope, exclusions, tax, payment, warranty and delivery terms are required', { fields: ['terms'] })),
    },
    { action: 'accept', from: ['issued'], to: 'accepted', permission: 'customer.approval.decide', auditEvent: 'quotation.accepted', guard: notExpired },
    {
      // Acceptance received outside the portal (signed copy, email) and recorded by Sales with evidence (§16.4).
      action: 'record_acceptance',
      from: ['issued'],
      to: 'accepted',
      permission: 'quotation.issue',
      auditEvent: 'quotation.accepted',
      guard: (c) => {
        const missing = requireFields({ accepted_by_name: c.acceptedByName, acceptor_authority: c.acceptorAuthority, acceptance_evidence: c.acceptanceEvidence });
        return missing.length ? missing : notExpired(c);
      },
    },
    { action: 'record_customer_rejection', from: ['issued'], to: 'rejected_by_customer', permission: 'quotation.issue', requiresReason: true, auditEvent: 'quotation.rejected_by_customer' },
    { action: 'supersede', from: ['draft', 'pending_approval', 'approved', 'issued'], to: 'superseded', permission: 'quotation.create', auditEvent: 'quotation.superseded' },
    { action: 'expire', from: ['issued'], to: 'expired', permission: 'quotation.issue', auditEvent: 'quotation.expired' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Order (Gate 4)                                                             */
/* -------------------------------------------------------------------------- */

export const ORDER_STATES = ['pending_confirmation', 'confirmed', 'completed', 'cancelled'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export interface OrderContext {
  acceptedQuotationRevisionId?: string | null;
  contractReference?: string | null;
  projectHandedOver?: boolean;
}

export const orderMachine = defineMachine<OrderState, string, OrderContext>({
  name: 'order',
  states: ORDER_STATES,
  initial: 'pending_confirmation',
  terminal: ['completed', 'cancelled'],
  transitions: [
    {
      action: 'confirm',
      from: ['pending_confirmation'],
      to: 'confirmed',
      permission: 'order.convert',
      auditEvent: 'order.confirmed',
      guard: (c) => requireFields({ accepted_quotation_revision_id: c.acceptedQuotationRevisionId, contract_reference: c.contractReference }),
    },
    { action: 'cancel', from: ['pending_confirmation', 'confirmed'], to: 'cancelled', permission: 'approval.exception.decide', requiresReason: true, auditEvent: 'order.cancelled' },
    {
      action: 'complete',
      from: ['confirmed'],
      to: 'completed',
      permission: 'project.plan',
      auditEvent: 'order.completed',
      guard: (c) => (c.projectHandedOver ? ok : fail('INVALID_STATE_TRANSITION', 'Project has not been handed over')),
    },
  ],
});

/* -------------------------------------------------------------------------- */
/* Project (spec §20 steps 20–41, Gates 5, 7, 8, 12, 13)                      */
/* -------------------------------------------------------------------------- */

export const PROJECT_STATES = [
  'created',
  'planning',
  'installation_ready',
  'installation',
  'final_qa',
  'statutory_pending',
  'handover_ready',
  'handed_over',
  'closed',
  'on_hold',
  'cancelled',
] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export interface ProjectContext {
  readiness?: {
    technical: boolean;
    site: boolean;
    payment: boolean;
    material: boolean;
    partner: boolean;
    documentation: boolean;
  };
  allTasksApproved?: boolean;
  openDefects?: number;
  statutoryEvidenceVerified?: boolean;
  handoverDocumentsComplete?: boolean;
  customerAccepted?: boolean;
  warrantyAssetCreated?: boolean;
  safetyStopActive?: boolean;
}

export const projectMachine = defineMachine<ProjectState, string, ProjectContext>({
  name: 'project',
  states: PROJECT_STATES,
  initial: 'created',
  terminal: ['closed', 'cancelled'],
  transitions: [
    { action: 'start_planning', from: ['created'], to: 'planning', permission: 'project.plan', auditEvent: 'project.planning_started' },
    {
      action: 'mark_installation_ready',
      from: ['planning'],
      to: 'installation_ready',
      permission: 'project.plan',
      auditEvent: 'project.installation_ready',
      guard: (c) => {
        const r = c.readiness;
        if (!r) return fail('SITE_NOT_READY', 'Readiness has not been evaluated');
        const out: GuardFailure[] = [];
        if (!r.technical) out.push({ code: 'APPROVAL_REQUIRED', message: 'Technical configuration not approved', missing: ['technical'] });
        if (!r.payment) out.push({ code: 'PAYMENT_NOT_VERIFIED', message: 'Payment milestone not verified (Gate 5)', missing: ['payment'] });
        if (!r.partner) out.push({ code: 'PARTNER_COMPLIANCE_BLOCK', message: 'No eligible partner assigned (Gate 7)', missing: ['partner'] });
        if (!r.site) out.push({ code: 'SITE_NOT_READY', message: 'Site readiness incomplete (Gate 8)', missing: ['site'] });
        if (!r.material) out.push({ code: 'MATERIAL_NOT_READY', message: 'Material not received / verified', missing: ['material'] });
        if (!r.documentation) out.push({ code: 'APPROVAL_REQUIRED', message: 'Documentation / approvals incomplete', missing: ['documentation'] });
        return out;
      },
    },
    {
      action: 'start_installation',
      from: ['installation_ready'],
      to: 'installation',
      permission: 'project.plan',
      auditEvent: 'project.installation_started',
      guard: (c) => (c.safetyStopActive ? fail('SAFETY_STOP_ACTIVE', 'A safety stop is active') : ok),
    },
    {
      action: 'submit_final_qa',
      from: ['installation'],
      to: 'final_qa',
      permission: 'project.plan',
      auditEvent: 'project.final_qa_requested',
      guard: (c) => (c.allTasksApproved ? ok : fail('APPROVAL_REQUIRED', 'All installation tasks must be QA approved')),
    },
    {
      action: 'pass_final_qa',
      from: ['final_qa'],
      to: 'statutory_pending',
      permission: 'qa.inspection.decide',
      auditEvent: 'project.final_qa_passed',
      guard: (c) => ((c.openDefects ?? 0) === 0 ? ok : fail('APPROVAL_REQUIRED', 'Open defects must be closed or formally dispositioned')),
    },
    { action: 'fail_final_qa', from: ['final_qa'], to: 'installation', permission: 'qa.inspection.decide', requiresReason: true, auditEvent: 'project.final_qa_failed' },
    {
      action: 'record_statutory_clearance',
      from: ['statutory_pending'],
      to: 'handover_ready',
      permission: 'project.plan',
      auditEvent: 'project.statutory_evidence_recorded',
      // Gate 12: internal QA alone never makes the lift legally ready.
      guard: (c) => (c.statutoryEvidenceVerified ? ok : fail('EVIDENCE_REQUIRED', 'Verified official inspection / permission evidence is required', { missing: ['statutory_evidence'] })),
    },
    {
      action: 'complete_handover',
      from: ['handover_ready'],
      to: 'handed_over',
      permission: 'project.plan',
      auditEvent: 'project.handed_over',
      guard: (c) => {
        const out: GuardFailure[] = [];
        if (!c.handoverDocumentsComplete) out.push({ code: 'EVIDENCE_REQUIRED', message: 'Final handover documents incomplete', missing: ['handover_documents'] });
        if (!c.customerAccepted) out.push({ code: 'APPROVAL_REQUIRED', message: 'Customer handover acceptance missing', missing: ['customer_acceptance'] });
        if (!c.statutoryEvidenceVerified) out.push({ code: 'EVIDENCE_REQUIRED', message: 'Statutory evidence missing', missing: ['statutory_evidence'] });
        return out;
      },
    },
    {
      action: 'close',
      from: ['handed_over'],
      to: 'closed',
      permission: 'project.plan',
      auditEvent: 'project.closed',
      guard: (c) => (c.warrantyAssetCreated ? ok : fail('REQUIRED_FIELD_MISSING', 'Lift asset / warranty record must exist', { fields: ['warranty_asset'] })),
    },
    { action: 'hold', from: ['planning', 'installation_ready', 'installation', 'final_qa'], to: 'on_hold', permission: 'project.plan', requiresReason: true, auditEvent: 'project.held' },
    { action: 'resume', from: ['on_hold'], to: 'planning', permission: 'project.plan', requiresReason: true, auditEvent: 'project.resumed' },
    { action: 'cancel', from: ['created', 'planning', 'installation_ready', 'on_hold'], to: 'cancelled', permission: 'approval.exception.decide', requiresReason: true, auditEvent: 'project.cancelled' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Task (spec §14.4, §47 table, Gates 9, 10, 11)                              */
/* -------------------------------------------------------------------------- */

export const TASK_STATES = ['draft', 'assigned', 'accepted', 'in_progress', 'blocked', 'submitted', 'approved', 'rework', 'closed'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export interface TaskContext {
  assigneeId?: string | null;
  assigneeActiveMember?: boolean;
  prerequisitesComplete?: boolean;
  safetyPreStartPassed?: boolean;
  safetyStopActive?: boolean;
  blockerReason?: string | null;
  checklistComplete?: boolean;
  missingEvidence?: string[];
  submittedBy?: string | null;
  inspectorId?: string | null;
  inspectorIndependent?: boolean;
  defectCreated?: boolean;
  correctionEvidenceAttached?: boolean;
}

export const taskMachine = defineMachine<TaskState, string, TaskContext>({
  name: 'task',
  states: TASK_STATES,
  initial: 'draft',
  terminal: ['closed'],
  transitions: [
    { action: 'assign', from: ['draft'], to: 'assigned', permission: 'partner.task.assign', auditEvent: 'task.assigned', guard: (c) => requireFields({ assignee_id: c.assigneeId }) },
    {
      action: 'accept',
      from: ['assigned'],
      to: 'accepted',
      permission: 'task.execute',
      auditEvent: 'task.accepted',
      guard: (c) => (c.assigneeActiveMember ? ok : fail('ACCESS_DENIED', 'Assignee is not an active partner member')),
    },
    {
      action: 'start',
      from: ['accepted'],
      to: 'in_progress',
      permission: 'task.execute',
      auditEvent: 'task.started',
      guard: (c) => {
        if (c.safetyStopActive) return fail('SAFETY_STOP_ACTIVE', 'A safety stop is active for this work');
        if (!c.safetyPreStartPassed) return fail('SAFETY_STOP_ACTIVE', 'Safety pre-start checks have not passed');
        if (!c.prerequisitesComplete) return fail('INVALID_STATE_TRANSITION', 'Prerequisite tasks are not complete');
        return ok;
      },
    },
    { action: 'block', from: ['in_progress'], to: 'blocked', permission: 'task.execute', requiresReason: true, auditEvent: 'task.blocked' },
    {
      action: 'unblock',
      from: ['blocked'],
      to: 'in_progress',
      permission: 'partner.task.assign',
      requiresReason: true,
      auditEvent: 'task.unblocked',
      guard: (c) => (c.safetyStopActive ? fail('SAFETY_STOP_ACTIVE', 'A safety stop is active for this work') : ok),
    },
    {
      action: 'submit',
      from: ['in_progress'],
      to: 'submitted',
      permission: 'task.execute',
      auditEvent: 'task.submitted',
      guard: (c) => {
        if (!c.checklistComplete) return fail('REQUIRED_FIELD_MISSING', 'Checklist incomplete', { fields: ['checklist'] });
        if (c.missingEvidence && c.missingEvidence.length) return fail('EVIDENCE_REQUIRED', 'Required evidence missing', { missing: c.missingEvidence });
        return ok;
      },
    },
    {
      action: 'qa_pass',
      from: ['submitted'],
      to: 'approved',
      permission: 'qa.inspection.decide',
      auditEvent: 'task.qa_passed',
      guard: (c) => {
        if (c.submittedBy && c.inspectorId && c.submittedBy === c.inspectorId) return fail('SELF_APPROVAL_FORBIDDEN', 'Workers cannot approve their own work');
        if (!c.inspectorIndependent) return fail('ACCESS_DENIED', 'Only independent AIEC QA can approve (Gate 10)');
        return ok;
      },
    },
    {
      action: 'qa_fail',
      from: ['submitted'],
      to: 'rework',
      permission: 'qa.inspection.decide',
      auditEvent: 'task.qa_failed',
      guard: (c) => (c.defectCreated ? ok : fail('REQUIRED_FIELD_MISSING', 'A defect record is required for a QA failure', { fields: ['defect'] })),
    },
    {
      action: 'resubmit',
      from: ['rework'],
      to: 'submitted',
      permission: 'task.execute',
      auditEvent: 'task.resubmitted',
      guard: (c) => (c.correctionEvidenceAttached ? ok : fail('EVIDENCE_REQUIRED', 'Correction evidence is required', { missing: ['correction_evidence'] })),
    },
    { action: 'close', from: ['approved'], to: 'closed', permission: 'project.plan', auditEvent: 'task.closed' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Customer payment claim (spec §10.4, §40 FN02, Gate 5)                      */
/* -------------------------------------------------------------------------- */

export const PAYMENT_STATES = ['claimed', 'pending_clarification', 'partially_verified', 'verified', 'rejected'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export interface PaymentContext {
  submittedBy?: string | null;
  verifierId?: string | null;
  /** Bank / gateway statement reference that matched this claim. */
  matchedStatementReference?: string | null;
  verifiedAmountPaise?: bigint;
  claimedAmountPaise?: bigint;
}

const verifierGuard = (c: PaymentContext): GuardFailure[] => {
  if (c.submittedBy && c.verifierId && c.submittedBy === c.verifierId) return fail('SELF_APPROVAL_FORBIDDEN', 'A user cannot verify their own payment claim');
  // A customer screenshot is never proof of settled funds (§10.4).
  if (!c.matchedStatementReference) return fail('PAYMENT_NOT_VERIFIED', 'Match against a bank / gateway record first', { fields: ['matched_statement_reference'] });
  return ok;
};

export const paymentMachine = defineMachine<PaymentState, string, PaymentContext>({
  name: 'payment',
  states: PAYMENT_STATES,
  initial: 'claimed',
  terminal: ['verified', 'rejected'],
  transitions: [
    {
      action: 'verify',
      from: ['claimed', 'partially_verified'],
      to: 'verified',
      permission: 'finance.payment.verify',
      auditEvent: 'payment.verified',
      guard: (c) => {
        const base = verifierGuard(c);
        if (base.length) return base;
        return c.verifiedAmountPaise !== undefined && c.claimedAmountPaise !== undefined && c.verifiedAmountPaise === c.claimedAmountPaise
          ? ok
          : fail('VALIDATION_FAILED', 'Verified amount must equal the claimed amount; use partial verification otherwise');
      },
    },
    {
      action: 'verify_partially',
      from: ['claimed'],
      to: 'partially_verified',
      permission: 'finance.payment.verify',
      requiresReason: true,
      auditEvent: 'payment.partially_verified',
      guard: (c) => {
        const base = verifierGuard(c);
        if (base.length) return base;
        const v = c.verifiedAmountPaise;
        const cl = c.claimedAmountPaise;
        return v !== undefined && cl !== undefined && v > 0n && v < cl ? ok : fail('VALIDATION_FAILED', 'Partial amount must be between zero and the claimed amount');
      },
    },
    { action: 'request_clarification', from: ['claimed'], to: 'pending_clarification', permission: 'finance.payment.verify', requiresReason: true, auditEvent: 'payment.clarification_requested' },
    { action: 'resubmit', from: ['pending_clarification'], to: 'claimed', permission: 'customer.approval.decide', auditEvent: 'payment.resubmitted' },
    // Claims recorded by staff (before the customer portal) are corrected and resubmitted by Sales.
    { action: 'resubmit_recorded', from: ['pending_clarification'], to: 'claimed', permission: 'order.convert', auditEvent: 'payment.resubmitted' },
    { action: 'reject', from: ['claimed', 'pending_clarification'], to: 'rejected', permission: 'finance.payment.verify', requiresReason: true, auditEvent: 'payment.rejected' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Purchase-order line material tracking (spec §41 PR04, Gate 6)              */
/* -------------------------------------------------------------------------- */

export const MATERIAL_STATES = [
  'ordered',
  'confirmed',
  'manufacturing',
  'ready',
  'dispatched',
  'in_transit',
  'delivered',
  'received',
  'inspected',
  'accepted',
  'quarantined',
  'rejected',
] as const;
export type MaterialState = (typeof MATERIAL_STATES)[number];

export interface MaterialContext {
  receivedQuantity?: number;
  grnNumber?: string | null;
}

export const materialLineMachine = defineMachine<MaterialState, string, MaterialContext>({
  name: 'material_line',
  states: MATERIAL_STATES,
  initial: 'ordered',
  terminal: ['accepted', 'rejected'],
  transitions: [
    { action: 'confirm', from: ['ordered'], to: 'confirmed', permission: 'procurement.po.create', auditEvent: 'material.confirmed' },
    { action: 'start_manufacturing', from: ['confirmed'], to: 'manufacturing', permission: 'procurement.po.create', auditEvent: 'material.manufacturing' },
    { action: 'mark_ready', from: ['confirmed', 'manufacturing'], to: 'ready', permission: 'procurement.po.create', auditEvent: 'material.ready' },
    { action: 'dispatch', from: ['ready'], to: 'dispatched', permission: 'procurement.po.create', auditEvent: 'material.dispatched' },
    { action: 'mark_in_transit', from: ['dispatched'], to: 'in_transit', permission: 'procurement.po.create', auditEvent: 'material.in_transit' },
    { action: 'mark_delivered', from: ['dispatched', 'in_transit'], to: 'delivered', permission: 'procurement.po.create', auditEvent: 'material.delivered' },
    {
      action: 'receive',
      from: ['delivered'],
      to: 'received',
      permission: 'procurement.grn.record',
      auditEvent: 'material.received',
      guard: (c) =>
        c.grnNumber && (c.receivedQuantity ?? 0) > 0 ? ok : fail('REQUIRED_FIELD_MISSING', 'GRN number and received quantity are required', { fields: ['grn_number', 'received_quantity'] }),
    },
    { action: 'inspect', from: ['received'], to: 'inspected', permission: 'procurement.grn.record', auditEvent: 'material.inspected' },
    { action: 'accept', from: ['inspected', 'quarantined'], to: 'accepted', permission: 'procurement.grn.record', auditEvent: 'material.accepted' },
    { action: 'quarantine', from: ['inspected'], to: 'quarantined', permission: 'procurement.grn.record', requiresReason: true, auditEvent: 'material.quarantined' },
    { action: 'reject', from: ['inspected', 'quarantined'], to: 'rejected', permission: 'procurement.grn.record', requiresReason: true, auditEvent: 'material.rejected' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Partner company (spec §12.3, Gate 7)                                       */
/* -------------------------------------------------------------------------- */

export const PARTNER_STATES = [
  'draft',
  'submitted',
  'verification_pending',
  'approved',
  'conditional_approval',
  'suspended',
  'compliance_hold',
  'rejected',
  'inactive',
] as const;
export type PartnerState = (typeof PARTNER_STATES)[number];

export interface PartnerContext {
  /** Output of evaluatePartnerCompliance(); empty = all mandatory documents verified & valid. */
  complianceFailures?: GuardFailure[];
}

const complianceGuard = (c: PartnerContext) => c.complianceFailures ?? fail('PARTNER_COMPLIANCE_BLOCK', 'Compliance not evaluated');

export const partnerMachine = defineMachine<PartnerState, string, PartnerContext>({
  name: 'partner',
  states: PARTNER_STATES,
  initial: 'draft',
  terminal: ['rejected', 'inactive'],
  transitions: [
    { action: 'submit', from: ['draft'], to: 'submitted', permission: 'partner.org.manage', auditEvent: 'partner.submitted' },
    { action: 'start_verification', from: ['submitted'], to: 'verification_pending', permission: 'partner.verify', auditEvent: 'partner.verification_started' },
    { action: 'approve', from: ['verification_pending'], to: 'approved', permission: 'partner.verify', auditEvent: 'partner.approved', guard: complianceGuard },
    { action: 'approve_conditionally', from: ['verification_pending'], to: 'conditional_approval', permission: 'partner.verify', requiresReason: true, auditEvent: 'partner.conditionally_approved' },
    { action: 'return_for_correction', from: ['verification_pending'], to: 'draft', permission: 'partner.verify', requiresReason: true, auditEvent: 'partner.returned' },
    { action: 'reject', from: ['verification_pending'], to: 'rejected', permission: 'partner.verify', requiresReason: true, auditEvent: 'partner.rejected' },
    { action: 'place_compliance_hold', from: ['approved', 'conditional_approval'], to: 'compliance_hold', permission: 'partner.verify', requiresReason: true, auditEvent: 'partner.compliance_hold' },
    { action: 'clear_compliance_hold', from: ['compliance_hold'], to: 'approved', permission: 'partner.verify', auditEvent: 'partner.compliance_cleared', guard: complianceGuard },
    { action: 'suspend', from: ['approved', 'conditional_approval', 'compliance_hold'], to: 'suspended', permission: 'approval.exception.decide', requiresReason: true, auditEvent: 'partner.suspended' },
    { action: 'reinstate', from: ['suspended'], to: 'verification_pending', permission: 'approval.exception.decide', requiresReason: true, auditEvent: 'partner.reinstated' },
    { action: 'deactivate', from: ['approved', 'conditional_approval', 'suspended', 'compliance_hold'], to: 'inactive', permission: 'approval.exception.decide', requiresReason: true, auditEvent: 'partner.deactivated' },
  ],
});

/** Statuses from which a partner may receive a NEW assignment (configurable, legally reviewed: D-007). */
export const PARTNER_ASSIGNABLE_STATES: readonly PartnerState[] = ['approved', 'conditional_approval'];

/* -------------------------------------------------------------------------- */
/* QA defect (spec §15.6, §44 QA05)                                           */
/* -------------------------------------------------------------------------- */

export const DEFECT_STATES = [
  'open',
  'assigned',
  'acknowledged',
  'correction_in_progress',
  'submitted_for_reinspection',
  'verified',
  'closed',
  'disputed',
] as const;
export type DefectState = (typeof DEFECT_STATES)[number];

export interface DefectContext {
  responsiblePartyId?: string | null;
  correctionEvidenceCount?: number;
  correctedBy?: string | null;
  inspectorId?: string | null;
}

export const defectMachine = defineMachine<DefectState, string, DefectContext>({
  name: 'defect',
  states: DEFECT_STATES,
  initial: 'open',
  terminal: ['closed'],
  transitions: [
    { action: 'assign', from: ['open'], to: 'assigned', permission: 'qa.defect.manage', auditEvent: 'defect.assigned', guard: (c) => requireFields({ responsible_party_id: c.responsiblePartyId }) },
    { action: 'acknowledge', from: ['assigned'], to: 'acknowledged', permission: 'partner.task.assign', auditEvent: 'defect.acknowledged' },
    { action: 'dispute', from: ['assigned', 'acknowledged'], to: 'disputed', permission: 'partner.task.assign', requiresReason: true, auditEvent: 'defect.disputed' },
    { action: 'resolve_dispute', from: ['disputed'], to: 'assigned', permission: 'qa.defect.manage', requiresReason: true, auditEvent: 'defect.dispute_resolved' },
    { action: 'start_correction', from: ['acknowledged'], to: 'correction_in_progress', permission: 'task.execute', auditEvent: 'defect.correction_started' },
    {
      action: 'submit_correction',
      from: ['correction_in_progress'],
      to: 'submitted_for_reinspection',
      permission: 'task.execute',
      auditEvent: 'defect.correction_submitted',
      guard: (c) => ((c.correctionEvidenceCount ?? 0) > 0 ? ok : fail('EVIDENCE_REQUIRED', 'Correction evidence is required', { missing: ['correction_evidence'] })),
    },
    { action: 'reject_correction', from: ['submitted_for_reinspection'], to: 'correction_in_progress', permission: 'qa.defect.manage', requiresReason: true, auditEvent: 'defect.not_corrected' },
    {
      action: 'verify',
      from: ['submitted_for_reinspection'],
      to: 'verified',
      permission: 'qa.defect.manage',
      auditEvent: 'defect.verified',
      guard: (c) => (c.correctedBy && c.inspectorId && c.correctedBy === c.inspectorId ? fail('SELF_APPROVAL_FORBIDDEN', 'The corrector cannot verify their own correction') : ok),
    },
    {
      action: 'close',
      from: ['verified'],
      to: 'closed',
      permission: 'qa.defect.manage',
      auditEvent: 'defect.closed',
      guard: (c) => ((c.correctionEvidenceCount ?? 0) > 0 ? ok : fail('EVIDENCE_REQUIRED', 'Defects close only with correction evidence', { missing: ['correction_evidence'] })),
    },
  ],
});

/* -------------------------------------------------------------------------- */
/* Handover (Gate 13) and Warranty (Gate 14)                                  */
/* -------------------------------------------------------------------------- */

export const HANDOVER_STATES = ['not_ready', 'ready', 'issues_raised', 'accepted'] as const;
export type HandoverState = (typeof HANDOVER_STATES)[number];

export interface HandoverContext {
  missingDocuments?: string[];
  finalQaPassed?: boolean;
  statutoryEvidenceVerified?: boolean;
}

export const handoverMachine = defineMachine<HandoverState, string, HandoverContext>({
  name: 'handover',
  states: HANDOVER_STATES,
  initial: 'not_ready',
  terminal: ['accepted'],
  transitions: [
    {
      action: 'confirm_ready',
      from: ['not_ready'],
      to: 'ready',
      permission: 'project.plan',
      auditEvent: 'handover.ready',
      guard: (c) => {
        const out: GuardFailure[] = [];
        if (c.missingDocuments && c.missingDocuments.length) out.push({ code: 'EVIDENCE_REQUIRED', message: 'Handover documents missing', missing: c.missingDocuments });
        if (!c.finalQaPassed) out.push({ code: 'APPROVAL_REQUIRED', message: 'Final QA not passed', missing: ['final_qa'] });
        if (!c.statutoryEvidenceVerified) out.push({ code: 'EVIDENCE_REQUIRED', message: 'Statutory evidence not verified', missing: ['statutory_evidence'] });
        return out;
      },
    },
    { action: 'customer_accept', from: ['ready'], to: 'accepted', permission: 'customer.approval.decide', auditEvent: 'handover.accepted' },
    { action: 'customer_raise_issue', from: ['ready'], to: 'issues_raised', permission: 'customer.approval.decide', requiresReason: true, auditEvent: 'handover.issues_raised' },
    { action: 'recheck', from: ['issues_raised'], to: 'not_ready', permission: 'project.plan', auditEvent: 'handover.rechecked' },
  ],
});

export const WARRANTY_STATES = ['pending', 'active', 'expired', 'voided'] as const;
export type WarrantyState = (typeof WARRANTY_STATES)[number];

export interface WarrantyContext {
  startEvent?: string | null;
  startEventDate?: string | null;
}

export const warrantyMachine = defineMachine<WarrantyState, string, WarrantyContext>({
  name: 'warranty',
  states: WARRANTY_STATES,
  initial: 'pending',
  terminal: ['expired', 'voided'],
  transitions: [
    { action: 'activate', from: ['pending'], to: 'active', permission: 'project.plan', auditEvent: 'warranty.activated', guard: (c) => requireFields({ start_event: c.startEvent, start_event_date: c.startEventDate }) },
    { action: 'expire', from: ['active'], to: 'expired', permission: 'project.plan', auditEvent: 'warranty.expired' },
    { action: 'void', from: ['pending', 'active'], to: 'voided', permission: 'approval.exception.decide', requiresReason: true, auditEvent: 'warranty.voided' },
  ],
});

export const ALL_MACHINES = {
  lead: leadMachine,
  survey: surveyMachine,
  technical_review: technicalReviewMachine,
  quotation: quotationMachine,
  order: orderMachine,
  project: projectMachine,
  task: taskMachine,
  payment: paymentMachine,
  material_line: materialLineMachine,
  partner: partnerMachine,
  defect: defectMachine,
  handover: handoverMachine,
  warranty: warrantyMachine,
} as const;

import { describe, expect, it } from 'vitest';
import {
  ALL_MACHINES,
  PERMISSION_CODES,
  ROLE_PERMISSIONS,
  allowedActions,
  leadMachine,
  paymentMachine,
  permissionsForRole,
  projectMachine,
  quotationMachine,
  reachableStates,
  surveyMachine,
  taskMachine,
  defectMachine,
  partnerMachine,
  transition,
  type PermissionCode,
} from '../src';

const all = new Set<PermissionCode>(PERMISSION_CODES);

describe('machine structure', () => {
  for (const [name, m] of Object.entries(ALL_MACHINES)) {
    it(`${name}: every state is reachable and every permission exists`, () => {
      const reach = reachableStates(m as never);
      expect([...reach].sort()).toEqual([...m.states].sort());
      for (const t of m.transitions) expect(PERMISSION_CODES).toContain(t.permission);
    });
    it(`${name}: terminal states have no outgoing actions`, () => {
      for (const s of m.terminal) expect(allowedActions(m as never, s as never)).toEqual([]);
    });
  }
});

describe('lead machine', () => {
  const sales = permissionsForRole('sales_executive');
  it('returns a structured error with allowed actions for an invalid transition', () => {
    const r = transition(leadMachine, 'new', { action: 'qualify', actorPermissions: all, context: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(r.error.details.currentState).toBe('new');
      expect(r.error.details.allowedActions).toEqual(['assign', 'close_lost', 'mark_invalid']);
    }
  });

  it('no-answer calls do not count as contact', () => {
    const r = transition(leadMachine, 'assigned', { action: 'record_contact', actorPermissions: sales, context: { outcome: 'no_answer' } });
    expect(r.ok).toBe(false);
    const ok = transition(leadMachine, 'assigned', { action: 'record_contact', actorPermissions: sales, context: { outcome: 'interested' } });
    expect(ok).toMatchObject({ ok: true, to: 'contacted' });
  });

  it('closing lost requires a reason code and narrative', () => {
    expect(transition(leadMachine, 'contacted', { action: 'close_lost', actorPermissions: sales, context: { lostReason: 'price' } }).ok).toBe(false);
    expect(transition(leadMachine, 'contacted', { action: 'close_lost', actorPermissions: sales, reason: 'Chose cheaper vendor', context: {} }).ok).toBe(false);
    expect(transition(leadMachine, 'contacted', { action: 'close_lost', actorPermissions: sales, reason: 'Chose cheaper vendor', context: { lostReason: 'price' } })).toMatchObject({ ok: true, to: 'lost' });
  });

  it('sales cannot reassign leads (authority sits with lead.assign)', () => {
    const r = transition(leadMachine, 'assigned', { action: 'reassign', actorPermissions: sales, reason: 'workload', context: { assigneeId: 'u2' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ACCESS_DENIED');
  });

  it('a lead is won only with a confirmed order', () => {
    expect(transition(leadMachine, 'qualified', { action: 'mark_won', actorPermissions: sales, context: {} }).ok).toBe(false);
    expect(transition(leadMachine, 'qualified', { action: 'mark_won', actorPermissions: sales, context: { hasConfirmedOrder: true } }).ok).toBe(true);
  });
});

describe('survey machine (Gate 1)', () => {
  const surveyor = permissionsForRole('surveyor');
  it('surveyor cannot approve feasibility or review', () => {
    expect(allowedActions(surveyMachine, 'submitted', surveyor)).toEqual([]);
  });
  it('check-in without verified GPS needs an exception reason; location is never invented', () => {
    expect(transition(surveyMachine, 'accepted', { action: 'check_in', actorPermissions: surveyor, context: { gpsStatus: 'permission_denied' } }).ok).toBe(false);
    expect(
      transition(surveyMachine, 'accepted', { action: 'check_in', actorPermissions: surveyor, context: { gpsStatus: 'permission_denied', gpsExceptionReason: 'Basement, no signal' } }).ok,
    ).toBe(true);
  });
  it('incomplete survey cannot be submitted', () => {
    const r = transition(surveyMachine, 'in_progress', {
      action: 'submit',
      actorPermissions: surveyor,
      context: { submissionFailures: [{ code: 'EVIDENCE_REQUIRED', message: 'x', missing: ['pit'] }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details.missing).toEqual(['pit']);
  });
});

describe('quotation machine (Gate 3) and segregation of duties', () => {
  const owner = permissionsForRole('owner');
  it('requester cannot approve their own discount', () => {
    const both = new Set<PermissionCode>([...owner, ...permissionsForRole('sales_executive')]);
    const r = transition(quotationMachine, 'pending_approval', { action: 'approve', actorPermissions: both, context: { requesterId: 'u1', actorId: 'u1' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(transition(quotationMachine, 'pending_approval', { action: 'approve', actorPermissions: owner, context: { requesterId: 'u1', actorId: 'u2' } }).ok).toBe(true);
  });
  it('a discount beyond authority cannot be finalized without approval', () => {
    const r = transition(quotationMachine, 'draft', {
      action: 'finalize',
      actorPermissions: permissionsForRole('sales_executive'),
      context: { configurationApproved: true, lineCount: 2, needsDiscountApproval: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('APPROVAL_REQUIRED');
  });
  it('expired quotations cannot be accepted', () => {
    const r = transition(quotationMachine, 'issued', {
      action: 'accept',
      actorPermissions: permissionsForRole('customer'),
      context: { validUntil: '2026-10-01', now: '2026-11-06T00:00:00Z' },
    });
    expect(r.ok).toBe(false);
  });
});

describe('task machine (Gates 9, 10, 11)', () => {
  const tech = permissionsForRole('technician');
  const qa = permissionsForRole('qa_inspector');
  it('critical safety failure blocks start and no role can override it', () => {
    const superActor = new Set<PermissionCode>(PERMISSION_CODES);
    const r = transition(taskMachine, 'accepted', {
      action: 'start',
      actorPermissions: superActor,
      context: { prerequisitesComplete: true, safetyPreStartPassed: false },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SAFETY_STOP_ACTIVE');
  });
  it('technician cannot approve own work', () => {
    expect(allowedActions(taskMachine, 'submitted', tech)).toEqual([]);
    const both = new Set<PermissionCode>([...tech, ...qa]);
    const r = transition(taskMachine, 'submitted', { action: 'qa_pass', actorPermissions: both, context: { submittedBy: 'u1', inspectorId: 'u1', inspectorIndependent: true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });
  it('partner internal QA is never independent QA', () => {
    const r = transition(taskMachine, 'submitted', { action: 'qa_pass', actorPermissions: qa, context: { submittedBy: 'u1', inspectorId: 'u2', inspectorIndependent: false } });
    expect(r.ok).toBe(false);
  });
  it('QA failure requires a defect; resubmission requires correction evidence', () => {
    expect(transition(taskMachine, 'submitted', { action: 'qa_fail', actorPermissions: qa, context: {} }).ok).toBe(false);
    expect(transition(taskMachine, 'submitted', { action: 'qa_fail', actorPermissions: qa, context: { defectCreated: true } })).toMatchObject({ ok: true, to: 'rework' });
    expect(transition(taskMachine, 'rework', { action: 'resubmit', actorPermissions: tech, context: {} }).ok).toBe(false);
  });
});

describe('payment / project / defect / partner', () => {
  const fin = permissionsForRole('accounts_finance');
  it('payment cannot be verified by its submitter or without a bank match', () => {
    const base = { claimedAmountPaise: 100n, verifiedAmountPaise: 100n };
    expect(transition(paymentMachine, 'claimed', { action: 'verify', actorPermissions: fin, context: { ...base, submittedBy: 'a', verifierId: 'a', matchedStatementReference: 'UTR1' } }).ok).toBe(false);
    expect(transition(paymentMachine, 'claimed', { action: 'verify', actorPermissions: fin, context: { ...base, submittedBy: 'a', verifierId: 'b' } }).ok).toBe(false);
    expect(transition(paymentMachine, 'claimed', { action: 'verify', actorPermissions: fin, context: { ...base, submittedBy: 'a', verifierId: 'b', matchedStatementReference: 'UTR1' } }).ok).toBe(true);
  });

  it('operations cannot bypass technical / payment / partner gates', () => {
    const ops = permissionsForRole('operations_manager');
    const r = transition(projectMachine, 'planning', {
      action: 'mark_installation_ready',
      actorPermissions: ops,
      context: { readiness: { technical: false, site: true, payment: false, material: true, partner: true, documentation: true } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error.details.failures as unknown[]).length).toBe(2);
  });

  it('internal QA never implies statutory permission (Gate 12)', () => {
    const ops = permissionsForRole('operations_manager');
    expect(transition(projectMachine, 'statutory_pending', { action: 'record_statutory_clearance', actorPermissions: ops, context: {} }).ok).toBe(false);
  });

  it('defect closes only with correction evidence', () => {
    const qa = permissionsForRole('qa_inspector');
    expect(transition(defectMachine, 'verified', { action: 'close', actorPermissions: qa, context: { correctionEvidenceCount: 0 } }).ok).toBe(false);
    expect(transition(defectMachine, 'verified', { action: 'close', actorPermissions: qa, context: { correctionEvidenceCount: 2 } }).ok).toBe(true);
  });

  it('partner cannot approve itself', () => {
    expect(allowedActions(partnerMachine, 'verification_pending', permissionsForRole('partner_admin'))).toEqual([]);
  });
});

describe('role matrix', () => {
  it('only references known permissions', () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(PERMISSION_CODES).toContain(p);
  });
  it('no field or partner role holds finance release, QA decision or rule management', () => {
    for (const role of ['partner_admin', 'partner_supervisor', 'technician'] as const) {
      const p = permissionsForRole(role);
      expect(p.has('finance.payout.release')).toBe(false);
      expect(p.has('qa.inspection.decide')).toBe(false);
      expect(p.has('rules.manage')).toBe(false);
      expect(p.has('lead.read_all')).toBe(false);
    }
  });
  it('payout preparation and release are held by different roles', () => {
    const holders = (perm: PermissionCode) => Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes(perm)).map(([r]) => r);
    const prep = holders('finance.payout.prepare');
    const rel = holders('finance.payout.release');
    expect(prep.filter((r) => rel.includes(r))).toEqual([]);
  });
});

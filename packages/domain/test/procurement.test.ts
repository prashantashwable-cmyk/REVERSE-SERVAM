import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MILESTONE_TEMPLATES,
  ORDER_HANDOVER_ITEMS,
  PERMISSIONS,
  bomMachine,
  buildMilestoneSchedule,
  computePurchaseOrder,
  lineReceiptStatus,
  missingHandoverItems,
  paymentGate,
  paymentMachine,
  purchaseOrderMachine,
  purchaseRequestMachine,
  transition,
  validateMilestoneTemplate,
  type PermissionCode,
} from '../src';

const perms = (...p: PermissionCode[]) => new Set<PermissionCode>(p);

describe('order handover and milestone templates', () => {
  it('every handover item must be confirmed', () => {
    expect(missingHandoverItems({})).toEqual([...ORDER_HANDOVER_ITEMS]);
    expect(missingHandoverItems(Object.fromEntries(ORDER_HANDOVER_ITEMS.map((k) => [k, true])))).toEqual([]);
  });
  it('launch templates are valid, differ by contract type and gate procurement on the advance', () => {
    for (const t of DEFAULT_MILESTONE_TEMPLATES) expect(validateMilestoneTemplate(t), t.code).toEqual([]);
    expect(new Set(DEFAULT_MILESTONE_TEMPLATES.map((t) => t.items.map((i) => i.shareBps).join('/'))).size).toBe(DEFAULT_MILESTONE_TEMPLATES.length);
    const schedule = buildMilestoneSchedule(129_800_000n, DEFAULT_MILESTONE_TEMPLATES[0]!);
    expect(schedule.reduce((a, m) => a + m.amountPaise, 0n)).toBe(129_800_000n);
    expect(paymentGate('procurement', schedule, []).blocking).toEqual(['advance']);
    expect(paymentGate('procurement', schedule, [{ milestoneCode: 'advance', amountPaise: schedule[0]!.amountPaise, status: 'verified' }]).open).toBe(true);
  });
  it('staff-recorded claims are resubmitted by Sales after clarification; verification stays with Finance', () => {
    expect(transition(paymentMachine, 'pending_clarification', { action: 'resubmit_recorded', actorPermissions: perms('order.convert'), context: {} }).ok).toBe(true);
    const self = transition(paymentMachine, 'claimed', {
      action: 'verify', actorPermissions: perms('finance.payment.verify'),
      context: { submittedBy: 'u1', verifierId: 'u1', matchedStatementReference: 'UTR1', verifiedAmountPaise: 1n, claimedAmountPaise: 1n },
    });
    expect(!self.ok && self.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });
});

describe('BOM, purchase request and purchase order machines', () => {
  it('a BOM is approved only against the approved configuration and with lines', () => {
    const t = perms('technical.drawing.approve');
    expect(transition(bomMachine, 'draft', { action: 'approve', actorPermissions: t, context: { configurationApproved: false, lineCount: 3 } }).ok).toBe(false);
    expect(transition(bomMachine, 'draft', { action: 'approve', actorPermissions: t, context: { configurationApproved: true, lineCount: 0 } }).ok).toBe(false);
    expect(transition(bomMachine, 'draft', { action: 'approve', actorPermissions: t, context: { configurationApproved: true, lineCount: 3 } }).ok).toBe(true);
  });
  it('a supplier choice needs a rationale', () => {
    const p = perms('procurement.po.create');
    expect(transition(purchaseRequestMachine, 'open', { action: 'select_supplier', actorPermissions: p, context: { rationale: '' } }).ok).toBe(false);
    expect(transition(purchaseRequestMachine, 'open', { action: 'select_supplier', actorPermissions: p, context: { rationale: 'Lowest landed cost, matches spec' } }).ok).toBe(true);
  });
  it('POs above the limit need approval by someone else; closing needs every line accepted', () => {
    expect(transition(purchaseOrderMachine, 'draft', { action: 'finalize', actorPermissions: perms('procurement.po.create'), context: { needsApproval: true } }).ok).toBe(false);
    const self = transition(purchaseOrderMachine, 'pending_approval', { action: 'approve', actorPermissions: perms('procurement.po.approve'), context: { creatorId: 'a', actorId: 'a' } });
    expect(!self.ok && self.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(transition(purchaseOrderMachine, 'pending_approval', { action: 'approve', actorPermissions: perms('procurement.po.approve'), context: { creatorId: 'a', actorId: 'b' } }).ok).toBe(true);
    expect(transition(purchaseOrderMachine, 'issued', { action: 'close', actorPermissions: perms('procurement.grn.record'), context: { allLinesAccepted: false } }).ok).toBe(false);
    for (const m of [bomMachine, purchaseRequestMachine, purchaseOrderMachine]) for (const tr of m.transitions) expect(Object.keys(PERMISSIONS)).toContain(tr.permission);
  });
});

describe('PO totals and goods receipt', () => {
  it('computes exact paise with freight', () => {
    const t = computePurchaseOrder([{ quantityMilli: 2500, ratePaise: 333_33n, taxRateBps: 1800 }, { quantityMilli: 1000, ratePaise: 1_000_00n, taxRateBps: 0 }], 500_00n);
    expect(t.lines[0]).toEqual({ netPaise: 83_333n, taxPaise: 15_000n, totalPaise: 98_333n });
    expect(t.totalPaise).toBe(83_333n + 15_000n + 1_000_00n + 500_00n);
    expect(() => computePurchaseOrder([{ quantityMilli: 0, ratePaise: 1n, taxRateBps: 0 }])).toThrow(RangeError);
  });
  it('partial, damaged and quarantined receipts never complete a line', () => {
    expect(lineReceiptStatus(2000, [{ receivedMilli: 1000, damagedMilli: 0, result: 'accepted' }])).toMatchObject({ acceptedMilli: 1000, complete: false, outstandingMilli: 1000 });
    expect(lineReceiptStatus(2000, [{ receivedMilli: 2000, damagedMilli: 500, result: 'accepted' }]).complete).toBe(false);
    expect(lineReceiptStatus(2000, [{ receivedMilli: 2000, damagedMilli: 0, result: 'quarantined' }]).acceptedMilli).toBe(0);
    expect(lineReceiptStatus(2000, [{ receivedMilli: 1500, damagedMilli: 0, result: 'accepted' }, { receivedMilli: 500, damagedMilli: 0, result: 'accepted' }]).complete).toBe(true);
  });
});

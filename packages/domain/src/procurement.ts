import { applyBps, divRound, sum, type BasisPoints, type Paise } from './money';
import { defineMachine, type GuardFailure } from './state-machine';
import type { MilestoneTemplate } from './commercial';

/**
 * Order → project → procurement (spec §11, §41 PR01–PR05, §49.4, Gates 4–6).
 * The database mirrors these machines (state_transitions) and the PO maths
 * (app.compute_purchase_order); supabase/tests/test/parity.test.ts keeps them equal.
 */

const ok: GuardFailure[] = [];
const fail = (code: GuardFailure['code'], message: string, extra: Partial<GuardFailure> = {}): GuardFailure[] => [{ code, message, ...extra }];

/* -------------------------------------------------------------------------- */
/* Order handover checklist (SE11)                                            */
/* -------------------------------------------------------------------------- */

/** Every item is confirmed by Sales before an order is created (Gate 4). */
export const ORDER_HANDOVER_ITEMS = [
  'customer_identity',
  'accepted_revision',
  'agreed_scope',
  'contract_record',
  'site_and_contact',
  'payment_terms',
  'variations_none_open',
  'customer_dependencies',
] as const;
export type OrderHandoverItem = (typeof ORDER_HANDOVER_ITEMS)[number];

export function missingHandoverItems(checked: Partial<Record<string, boolean>> | null | undefined): OrderHandoverItem[] {
  return ORDER_HANDOVER_ITEMS.filter((k) => checked?.[k] !== true);
}

/* -------------------------------------------------------------------------- */
/* Payment milestone templates (§49.4: by contract type, never one universal) */
/* -------------------------------------------------------------------------- */

/** Launch templates (Decision Register D-026): configuration, changed as a versioned business rule. */
export const DEFAULT_MILESTONE_TEMPLATES: MilestoneTemplate[] = [
  {
    code: 'new_installation',
    version: 1,
    items: [
      { code: 'advance', label: 'advance', shareBps: 2500, trigger: 'order_confirmed', dueDays: 7, gates: ['procurement'] },
      { code: 'pre_dispatch', label: 'pre_dispatch', shareBps: 4500, trigger: 'material_ready', dueDays: 7, gates: ['dispatch'] },
      { code: 'installation', label: 'installation', shareBps: 2000, trigger: 'installation_started', dueDays: 15, gates: ['handover'] },
      { code: 'handover', label: 'handover', shareBps: 1000, trigger: 'handover', dueDays: 15, gates: [] },
    ],
  },
  {
    code: 'home_lift',
    version: 1,
    items: [
      { code: 'advance', label: 'advance', shareBps: 4000, trigger: 'order_confirmed', dueDays: 7, gates: ['procurement'] },
      { code: 'pre_dispatch', label: 'pre_dispatch', shareBps: 5000, trigger: 'material_ready', dueDays: 7, gates: ['dispatch'] },
      { code: 'handover', label: 'handover', shareBps: 1000, trigger: 'handover', dueDays: 15, gates: [] },
    ],
  },
];

export const PAYMENT_MODES = ['neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'other'] as const;
export const GATED_ACTIONS = ['procurement', 'dispatch', 'installation', 'handover'] as const;

/* -------------------------------------------------------------------------- */
/* Bill of materials (TE05)                                                   */
/* -------------------------------------------------------------------------- */

export const BOM_STATES = ['draft', 'approved', 'superseded'] as const;
export type BomState = (typeof BOM_STATES)[number];

export const bomMachine = defineMachine<BomState, string, { lineCount?: number; configurationApproved?: boolean }>({
  name: 'bom',
  states: BOM_STATES,
  initial: 'draft',
  terminal: ['superseded'],
  transitions: [
    {
      action: 'approve',
      from: ['draft'],
      to: 'approved',
      permission: 'technical.drawing.approve',
      auditEvent: 'bom.approved',
      guard: (c) => {
        if (!c.configurationApproved) return fail('APPROVAL_REQUIRED', 'The BOM must map to the approved configuration revision');
        return c.lineCount ? ok : fail('REQUIRED_FIELD_MISSING', 'A BOM needs at least one line', { fields: ['lines'] });
      },
    },
    { action: 'supersede', from: ['approved'], to: 'superseded', permission: 'technical.drawing.approve', auditEvent: 'bom.superseded' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Purchase request (PR01–PR02) and purchase order (PR03)                     */
/* -------------------------------------------------------------------------- */

export const PURCHASE_REQUEST_STATES = ['open', 'supplier_selected', 'ordered', 'cancelled'] as const;
export type PurchaseRequestState = (typeof PURCHASE_REQUEST_STATES)[number];

export const purchaseRequestMachine = defineMachine<PurchaseRequestState, string, { rationale?: string | null }>({
  name: 'purchase_request',
  states: PURCHASE_REQUEST_STATES,
  initial: 'open',
  terminal: ['ordered', 'cancelled'],
  transitions: [
    {
      action: 'select_supplier',
      from: ['open', 'supplier_selected'],
      to: 'supplier_selected',
      permission: 'procurement.po.create',
      auditEvent: 'purchase_request.supplier_selected',
      guard: (c) => (c.rationale && c.rationale.trim().length >= 3 ? ok : fail('REQUIRED_FIELD_MISSING', 'Record why this supplier was chosen', { fields: ['rationale'] })),
    },
    { action: 'mark_ordered', from: ['supplier_selected'], to: 'ordered', permission: 'procurement.po.create', auditEvent: 'purchase_request.ordered' },
    { action: 'cancel', from: ['open', 'supplier_selected'], to: 'cancelled', permission: 'procurement.request.create', requiresReason: true, auditEvent: 'purchase_request.cancelled' },
  ],
});

export const PURCHASE_ORDER_STATES = ['draft', 'pending_approval', 'approved', 'issued', 'closed', 'cancelled'] as const;
export type PurchaseOrderState = (typeof PURCHASE_ORDER_STATES)[number];

export interface PurchaseOrderContext {
  needsApproval?: boolean;
  creatorId?: string;
  actorId?: string;
  allLinesAccepted?: boolean;
}

export const purchaseOrderMachine = defineMachine<PurchaseOrderState, string, PurchaseOrderContext>({
  name: 'purchase_order',
  states: PURCHASE_ORDER_STATES,
  initial: 'draft',
  terminal: ['closed', 'cancelled'],
  transitions: [
    {
      action: 'finalize',
      from: ['draft'],
      to: 'approved',
      permission: 'procurement.po.create',
      auditEvent: 'purchase_order.finalized',
      guard: (c) => (c.needsApproval ? fail('APPROVAL_REQUIRED', 'PO value exceeds the procurement limit; request approval') : ok),
    },
    { action: 'request_approval', from: ['draft'], to: 'pending_approval', permission: 'procurement.po.create', auditEvent: 'purchase_order.approval_requested' },
    {
      action: 'approve',
      from: ['pending_approval'],
      to: 'approved',
      permission: 'procurement.po.approve',
      auditEvent: 'purchase_order.approved',
      guard: (c) => (c.creatorId && c.actorId && c.creatorId === c.actorId ? fail('SELF_APPROVAL_FORBIDDEN', 'The PO creator cannot approve it') : ok),
    },
    { action: 'return_to_draft', from: ['pending_approval'], to: 'draft', permission: 'procurement.po.approve', requiresReason: true, auditEvent: 'purchase_order.approval_rejected' },
    { action: 'issue', from: ['approved'], to: 'issued', permission: 'procurement.po.create', auditEvent: 'purchase_order.issued' },
    {
      action: 'close',
      from: ['issued'],
      to: 'closed',
      permission: 'procurement.grn.record',
      auditEvent: 'purchase_order.closed',
      guard: (c) => (c.allLinesAccepted ? ok : fail('MATERIAL_NOT_READY', 'Every line must be fully received and accepted before closing')),
    },
    { action: 'cancel', from: ['draft', 'pending_approval', 'approved'], to: 'cancelled', permission: 'procurement.po.create', requiresReason: true, auditEvent: 'purchase_order.cancelled' },
  ],
});

/** Launch PO approval limit (D-027): POs above this need procurement.po.approve (and a different person). */
export const DEFAULT_PO_APPROVAL_LIMIT_PAISE = 50_000_000n; // ₹5,00,000

export interface PurchaseOrderLineInput {
  quantityMilli: number;
  ratePaise: Paise;
  taxRateBps: BasisPoints;
}

export interface PurchaseOrderTotals {
  lines: { netPaise: Paise; taxPaise: Paise; totalPaise: Paise }[];
  netPaise: Paise;
  taxPaise: Paise;
  freightPaise: Paise;
  totalPaise: Paise;
}

/** PO value: lines (qty × rate, tax on net) + freight; integer paise, rounded half away from zero. */
export function computePurchaseOrder(lines: readonly PurchaseOrderLineInput[], freightPaise: Paise = 0n): PurchaseOrderTotals {
  if (freightPaise < 0n) throw new RangeError('freight must not be negative');
  const out = lines.map((l) => {
    if (!Number.isInteger(l.quantityMilli) || l.quantityMilli <= 0) throw new RangeError('quantity must be positive');
    if (l.ratePaise < 0n) throw new RangeError('rate must not be negative');
    const netPaise = divRound(l.ratePaise * BigInt(l.quantityMilli), 1000n);
    const taxPaise = applyBps(netPaise, l.taxRateBps);
    return { netPaise, taxPaise, totalPaise: netPaise + taxPaise };
  });
  const netPaise = sum(out.map((l) => l.netPaise));
  const taxPaise = sum(out.map((l) => l.taxPaise));
  return { lines: out, netPaise, taxPaise, freightPaise, totalPaise: netPaise + taxPaise + freightPaise };
}

/* -------------------------------------------------------------------------- */
/* Goods receipt (PR05): partial receipts never mark a whole line accepted    */
/* -------------------------------------------------------------------------- */

export const INSPECTION_RESULTS = ['accepted', 'quarantined', 'rejected'] as const;

export interface ReceiptLine {
  receivedMilli: number;
  damagedMilli: number;
  result: (typeof INSPECTION_RESULTS)[number];
}

/** Accepted quantity of a receipt line: only an accepted inspection counts, minus damage. */
export function acceptedMilli(r: ReceiptLine): number {
  return r.result === 'accepted' ? Math.max(0, r.receivedMilli - r.damagedMilli) : 0;
}

/** A PO line is complete only when its accepted quantity covers the ordered quantity. */
export function lineReceiptStatus(orderedMilli: number, receipts: readonly ReceiptLine[]) {
  const received = receipts.reduce((a, r) => a + r.receivedMilli, 0);
  const accepted = receipts.reduce((a, r) => a + acceptedMilli(r), 0);
  return { receivedMilli: received, acceptedMilli: accepted, outstandingMilli: Math.max(0, orderedMilli - accepted), complete: accepted >= orderedMilli };
}

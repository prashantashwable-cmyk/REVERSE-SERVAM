import { allocate, applyBps, divRound, ratioBps, sum, type BasisPoints, type Paise } from './money';

/**
 * Quotation economics, discount governance and payment milestones
 * (spec §7.8, §49). All money is integer paise; all rates are basis points.
 * Tax codes and rates are configured by Finance (D-011) — never hard-coded here.
 */

export const QUOTATION_LINE_CATEGORIES = [
  'lift_equipment',
  'cabin_finishes',
  'door_system',
  'controller_drive',
  'installation',
  'transport_handling',
  'electrical_civil_interface',
  'additional_option',
  'other_charge',
] as const;
export type QuotationLineCategory = (typeof QUOTATION_LINE_CATEGORIES)[number];

export interface TaxCode {
  code: string;
  rateBps: BasisPoints;
}

export interface QuotationLineInput {
  category: QuotationLineCategory;
  description: string;
  /** Quantity in thousandths of the unit (1 nos = 1000; 12.5 m = 12500). */
  quantityMilli: number;
  unit: string;
  ratePaise: Paise;
  discountBps?: BasisPoints;
  taxCode: TaxCode;
  /** Estimated direct cost per unit (internal; never shown to customers). */
  estimatedUnitCostPaise?: Paise;
  costSource?: string;
}

export interface QuotationLineResult {
  grossPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;
  estimatedCostPaise: Paise;
}

export function computeLine(line: QuotationLineInput): QuotationLineResult {
  if (!Number.isInteger(line.quantityMilli) || line.quantityMilli <= 0) throw new RangeError('quantity must be positive');
  if (line.ratePaise < 0n) throw new RangeError('rate must not be negative');
  const discountBps = line.discountBps ?? 0;
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10_000) throw new RangeError('discount must be 0–100%');
  if (!Number.isInteger(line.taxCode.rateBps) || line.taxCode.rateBps < 0) throw new RangeError('invalid tax rate');
  const qty = BigInt(line.quantityMilli);
  const grossPaise = divRound(line.ratePaise * qty, 1000n);
  const discountPaise = applyBps(grossPaise, discountBps);
  const taxablePaise = grossPaise - discountPaise;
  const taxPaise = applyBps(taxablePaise, line.taxCode.rateBps);
  const estimatedCostPaise = line.estimatedUnitCostPaise === undefined ? 0n : divRound(line.estimatedUnitCostPaise * qty, 1000n);
  return { grossPaise, discountPaise, taxablePaise, taxPaise, totalPaise: taxablePaise + taxPaise, estimatedCostPaise };
}

export interface QuotationTotals {
  lines: QuotationLineResult[];
  grossPaise: Paise;
  discountPaise: Paise;
  /** Selling price excluding taxes. */
  taxablePaise: Paise;
  taxByCode: Record<string, Paise>;
  taxPaise: Paise;
  grandTotalPaise: Paise;
  estimatedDirectCostPaise: Paise;
  /** Gross project contribution = selling price excl. tax − direct cost. NOT net profit. */
  grossContributionPaise: Paise;
  /** Contribution margin on selling price excl. tax, in bps (null if no revenue). */
  contributionMarginBps: BasisPoints | null;
  /** Overall discount as share of gross, in bps (null if gross is 0). */
  overallDiscountBps: BasisPoints | null;
}

export function computeQuotation(lines: readonly QuotationLineInput[]): QuotationTotals {
  const results = lines.map(computeLine);
  const taxByCode: Record<string, Paise> = {};
  lines.forEach((l, i) => {
    taxByCode[l.taxCode.code] = (taxByCode[l.taxCode.code] ?? 0n) + results[i]!.taxPaise;
  });
  const grossPaise = sum(results.map((r) => r.grossPaise));
  const discountPaise = sum(results.map((r) => r.discountPaise));
  const taxablePaise = sum(results.map((r) => r.taxablePaise));
  const taxPaise = sum(results.map((r) => r.taxPaise));
  const estimatedDirectCostPaise = sum(results.map((r) => r.estimatedCostPaise));
  const grossContributionPaise = taxablePaise - estimatedDirectCostPaise;
  return {
    lines: results,
    grossPaise,
    discountPaise,
    taxablePaise,
    taxByCode,
    taxPaise,
    grandTotalPaise: taxablePaise + taxPaise,
    estimatedDirectCostPaise,
    grossContributionPaise,
    contributionMarginBps: taxablePaise > 0n ? ratioBps(grossContributionPaise, taxablePaise) : null,
    overallDiscountBps: grossPaise > 0n ? ratioBps(discountPaise, grossPaise) : null,
  };
}

/** Discount / margin authority (configurable: D-004, D-005). */
export interface DiscountPolicy {
  maxDiscountBpsWithoutApproval: BasisPoints;
  marginFloorBps: BasisPoints;
}

export interface DiscountDecision {
  needsApproval: boolean;
  reasons: ('discount_above_authority' | 'margin_below_floor' | 'no_cost_basis')[];
}

export function evaluateDiscountAuthority(totals: QuotationTotals, policy: DiscountPolicy): DiscountDecision {
  const reasons: DiscountDecision['reasons'] = [];
  if ((totals.overallDiscountBps ?? 0) > policy.maxDiscountBpsWithoutApproval) reasons.push('discount_above_authority');
  if (totals.estimatedDirectCostPaise === 0n) reasons.push('no_cost_basis');
  else if (totals.contributionMarginBps === null || totals.contributionMarginBps < policy.marginFloorBps) reasons.push('margin_below_floor');
  return { needsApproval: reasons.length > 0, reasons };
}

/* -------------------------------------------------------------------------- */
/* Payment milestone engine (§49.4) — no hard-coded universal schedule.       */
/* -------------------------------------------------------------------------- */

export interface MilestoneTemplateItem {
  code: string;
  label: string;
  /** Share of contract value in bps. Template must sum to 10 000. */
  shareBps: BasisPoints;
  trigger: string;
  /** Days after trigger event when the milestone is due. */
  dueDays: number;
  /** Actions this milestone gates (e.g. 'procurement', 'dispatch', 'installation'). */
  gates: string[];
}

export interface MilestoneTemplate {
  code: string;
  version: number;
  items: MilestoneTemplateItem[];
}

export function validateMilestoneTemplate(t: MilestoneTemplate): string[] {
  const errors: string[] = [];
  if (t.items.length === 0) errors.push('template has no milestones');
  const total = t.items.reduce((a, i) => a + i.shareBps, 0);
  if (total !== 10_000) errors.push(`milestone shares sum to ${total} bps, expected 10000`);
  const codes = new Set<string>();
  for (const i of t.items) {
    if (!Number.isInteger(i.shareBps) || i.shareBps <= 0) errors.push(`${i.code}: share must be a positive integer bps`);
    if (!Number.isInteger(i.dueDays) || i.dueDays < 0) errors.push(`${i.code}: dueDays must be a non-negative integer`);
    if (codes.has(i.code)) errors.push(`${i.code}: duplicate milestone code`);
    codes.add(i.code);
  }
  return errors;
}

export interface ScheduledMilestone extends MilestoneTemplateItem {
  amountPaise: Paise;
}

/** Contract value (incl. tax, as invoiced) → milestone amounts that sum exactly to it. */
export function buildMilestoneSchedule(contractValuePaise: Paise, t: MilestoneTemplate): ScheduledMilestone[] {
  const errors = validateMilestoneTemplate(t);
  if (errors.length) throw new RangeError(errors.join('; '));
  const amounts = allocate(contractValuePaise, t.items.map((i) => i.shareBps));
  return t.items.map((i, idx) => ({ ...i, amountPaise: amounts[idx]! }));
}

export interface PaymentRecord {
  milestoneCode: string;
  amountPaise: Paise;
  /** Only `verified` / `partially_verified` money counts. Claims and screenshots do not. */
  status: 'claimed' | 'pending_clarification' | 'partially_verified' | 'verified' | 'rejected';
  verifiedAmountPaise?: Paise;
}

export function verifiedAmount(p: PaymentRecord): Paise {
  if (p.status === 'verified') return p.verifiedAmountPaise ?? p.amountPaise;
  if (p.status === 'partially_verified') return p.verifiedAmountPaise ?? 0n;
  return 0n;
}

export interface MilestoneStatus {
  code: string;
  duePaise: Paise;
  verifiedPaise: Paise;
  outstandingPaise: Paise;
  claimedUnverifiedPaise: Paise;
  satisfied: boolean;
}

export function milestoneStatuses(schedule: readonly ScheduledMilestone[], payments: readonly PaymentRecord[]): MilestoneStatus[] {
  return schedule.map((m) => {
    const mine = payments.filter((p) => p.milestoneCode === m.code);
    const verifiedPaise = sum(mine.map(verifiedAmount));
    const claimedUnverifiedPaise = sum(
      mine.filter((p) => p.status === 'claimed' || p.status === 'pending_clarification').map((p) => p.amountPaise),
    );
    const outstanding = m.amountPaise - verifiedPaise;
    return {
      code: m.code,
      duePaise: m.amountPaise,
      verifiedPaise,
      outstandingPaise: outstanding > 0n ? outstanding : 0n,
      claimedUnverifiedPaise,
      satisfied: verifiedPaise >= m.amountPaise,
    };
  });
}

/**
 * Gate 5: is the action (e.g. 'procurement') unlocked? Every milestone that
 * gates the action must be fully satisfied by VERIFIED money, unless an
 * authorized, unexpired exception exists.
 */
export function paymentGate(
  action: string,
  schedule: readonly ScheduledMilestone[],
  payments: readonly PaymentRecord[],
  exception?: { approvedBy: string; expiresAt: string; now: string } | null,
): { open: boolean; blocking: string[]; viaException: boolean } {
  const statuses = new Map(milestoneStatuses(schedule, payments).map((s) => [s.code, s]));
  const blocking = schedule.filter((m) => m.gates.includes(action) && !statuses.get(m.code)!.satisfied).map((m) => m.code);
  if (blocking.length === 0) return { open: true, blocking, viaException: false };
  const exceptionValid = !!exception && Date.parse(exception.expiresAt) > Date.parse(exception.now);
  return { open: exceptionValid, blocking, viaException: exceptionValid };
}

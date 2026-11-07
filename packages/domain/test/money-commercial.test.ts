import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyBps,
  buildMilestoneSchedule,
  computeLine,
  computeQuotation,
  divRound,
  evaluateDiscountAuthority,
  formatInr,
  milestoneStatuses,
  parseInr,
  paymentGate,
  ratioBps,
  validateMilestoneTemplate,
  type MilestoneTemplate,
  type QuotationLineInput,
} from '../src';

const GST18 = { code: 'GST18', rateBps: 1800 };

describe('money', () => {
  it('parses INR strings into paise without floating point', () => {
    expect(parseInr('1234.5')).toBe(123450n);
    expect(parseInr('₹ 1,23,456.78')).toBe(12345678n);
    expect(parseInr('INR 99')).toBe(9900n);
    expect(parseInr('-10.05')).toBe(-1005n);
    expect(parseInr('0.1')).toBe(10n);
  });

  it('rejects invalid amounts', () => {
    expect(() => parseInr('12.345')).toThrow(RangeError);
    expect(() => parseInr('abc')).toThrow(RangeError);
    expect(() => parseInr('')).toThrow(RangeError);
  });

  it('formats with Indian digit grouping', () => {
    expect(formatInr(12345678n)).toBe('₹1,23,456.78');
    expect(formatInr(123456789012n)).toBe('₹1,23,45,67,890.12');
    expect(formatInr(5n)).toBe('₹0.05');
    expect(formatInr(-100000n)).toBe('-₹1,000.00');
    expect(formatInr(99900n, { symbol: false })).toBe('999.00');
  });

  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(applyBps(10001n, 1800)).toBe(1800n); // 1800.18 → 1800
    expect(applyBps(10003n, 1800)).toBe(1801n); // 1800.54 → 1801
    expect(ratioBps(1n, 3n)).toBe(3333);
  });

  it('allocates so that parts always sum to the total', () => {
    const parts = allocate(100n, [1, 1, 1]);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(parts.reduce((a, b) => a + b)).toBe(100n);
    const odd = allocate(1_00_00_001n, [3000, 4000, 2000, 1000]);
    expect(odd.reduce((a, b) => a + b)).toBe(1_00_00_001n);
    expect(allocate(-100n, [1, 1, 1]).reduce((a, b) => a + b)).toBe(-100n);
    expect(() => allocate(100n, [0, 0])).toThrow();
    expect(() => allocate(100n, [1.5])).toThrow();
  });
});

describe('quotation economics', () => {
  const lines: QuotationLineInput[] = [
    { category: 'lift_equipment', description: 'MRL passenger lift 6 pax', quantityMilli: 1000, unit: 'nos', ratePaise: parseInr('1250000'), taxCode: GST18, estimatedUnitCostPaise: parseInr('900000') },
    { category: 'installation', description: 'Installation G+4', quantityMilli: 1000, unit: 'job', ratePaise: parseInr('150000'), discountBps: 1000, taxCode: GST18, estimatedUnitCostPaise: parseInr('90000') },
    { category: 'electrical_civil_interface', description: 'Trailing cable', quantityMilli: 12500, unit: 'm', ratePaise: parseInr('310.40'), taxCode: GST18, estimatedUnitCostPaise: parseInr('200') },
  ];

  it('computes a line with quantity in thousandths', () => {
    const r = computeLine(lines[2]!);
    expect(r.grossPaise).toBe(388000n); // 12.5 × 310.40 = 3880.00
    expect(r.taxPaise).toBe(69840n);
    expect(r.totalPaise).toBe(457840n);
    expect(r.estimatedCostPaise).toBe(250000n);
  });

  it('separates taxes from contribution and never calls it profit', () => {
    const t = computeQuotation(lines);
    expect(t.grossPaise).toBe(parseInr('1403880'));
    expect(t.discountPaise).toBe(parseInr('15000'));
    expect(t.taxablePaise).toBe(parseInr('1388880'));
    expect(t.taxPaise).toBe(parseInr('249998.40'));
    expect(t.grandTotalPaise).toBe(t.taxablePaise + t.taxPaise);
    expect(t.estimatedDirectCostPaise).toBe(parseInr('992500'));
    // Contribution excludes tax collected.
    expect(t.grossContributionPaise).toBe(parseInr('396380'));
    expect(t.taxByCode['GST18']).toBe(t.taxPaise);
    expect(t.contributionMarginBps).toBe(2854);
  });

  it('requires approval when discount or margin is outside authority', () => {
    const t = computeQuotation(lines);
    expect(evaluateDiscountAuthority(t, { maxDiscountBpsWithoutApproval: 500, marginFloorBps: 2000 })).toEqual({ needsApproval: false, reasons: [] });
    expect(evaluateDiscountAuthority(t, { maxDiscountBpsWithoutApproval: 50, marginFloorBps: 2000 }).reasons).toEqual(['discount_above_authority']);
    expect(evaluateDiscountAuthority(t, { maxDiscountBpsWithoutApproval: 500, marginFloorBps: 3000 }).reasons).toEqual(['margin_below_floor']);
    const noCost = computeQuotation([{ ...lines[0]!, estimatedUnitCostPaise: undefined }]);
    expect(evaluateDiscountAuthority(noCost, { maxDiscountBpsWithoutApproval: 500, marginFloorBps: 0 }).reasons).toContain('no_cost_basis');
  });

  it('rejects invalid lines', () => {
    expect(() => computeLine({ ...lines[0]!, quantityMilli: 0 })).toThrow();
    expect(() => computeLine({ ...lines[0]!, discountBps: 10_001 })).toThrow();
    expect(() => computeLine({ ...lines[0]!, ratePaise: -1n })).toThrow();
  });
});

describe('payment milestone engine and Gate 5', () => {
  const template: MilestoneTemplate = {
    code: 'standard-new-install',
    version: 1,
    items: [
      { code: 'advance', label: 'Advance', shareBps: 3000, trigger: 'order_confirmed', dueDays: 0, gates: ['procurement'] },
      { code: 'pre_dispatch', label: 'Before dispatch', shareBps: 4000, trigger: 'material_ready', dueDays: 7, gates: ['dispatch'] },
      { code: 'installation', label: 'Installation complete', shareBps: 2000, trigger: 'final_qa_passed', dueDays: 7, gates: [] },
      { code: 'handover', label: 'Handover', shareBps: 1000, trigger: 'handover_accepted', dueDays: 7, gates: [] },
    ],
  };

  it('validates templates (no hard-coded universal schedule)', () => {
    expect(validateMilestoneTemplate(template)).toEqual([]);
    const bad = { ...template, items: template.items.slice(1) };
    expect(validateMilestoneTemplate(bad)[0]).toMatch(/7000/);
  });

  it('builds a schedule that sums exactly to the contract value', () => {
    const s = buildMilestoneSchedule(1_638_878_40n, template);
    expect(s.reduce((a, m) => a + m.amountPaise, 0n)).toBe(1_638_878_40n);
  });

  it('claimed or screenshot payments never unlock a gate', () => {
    const s = buildMilestoneSchedule(parseInr('1000000'), template);
    const claimed = [{ milestoneCode: 'advance', amountPaise: parseInr('300000'), status: 'claimed' as const }];
    expect(paymentGate('procurement', s, claimed)).toEqual({ open: false, blocking: ['advance'], viaException: false });
    const status = milestoneStatuses(s, claimed)[0]!;
    expect(status.claimedUnverifiedPaise).toBe(parseInr('300000'));
    expect(status.verifiedPaise).toBe(0n);
  });

  it('verified payment unlocks; partial does not', () => {
    const s = buildMilestoneSchedule(parseInr('1000000'), template);
    const partial = [{ milestoneCode: 'advance', amountPaise: parseInr('300000'), status: 'partially_verified' as const, verifiedAmountPaise: parseInr('200000') }];
    expect(paymentGate('procurement', s, partial).open).toBe(false);
    const full = [...partial, { milestoneCode: 'advance', amountPaise: parseInr('100000'), status: 'verified' as const }];
    expect(paymentGate('procurement', s, full).open).toBe(true);
    // Dispatch is still gated by its own milestone.
    expect(paymentGate('dispatch', s, full).blocking).toEqual(['pre_dispatch']);
  });

  it('accepts only an unexpired authorized exception', () => {
    const s = buildMilestoneSchedule(parseInr('1000000'), template);
    const now = '2026-11-06T10:00:00Z';
    expect(paymentGate('procurement', s, [], { approvedBy: 'owner', expiresAt: '2026-11-10T00:00:00Z', now }).viaException).toBe(true);
    expect(paymentGate('procurement', s, [], { approvedBy: 'owner', expiresAt: '2026-11-01T00:00:00Z', now }).open).toBe(false);
  });
});

describe('quantity and percentage input helpers', () => {
  it('parse and format exactly, rejecting invalid input', async () => {
    const { parseQuantityMilli, formatQuantityMilli, parsePercentBps, formatBps, paiseToInput } = await import('../src');
    expect(parseQuantityMilli('1')).toBe(1000);
    expect(parseQuantityMilli(' 12.5 ')).toBe(12500);
    expect(parseQuantityMilli('0.125')).toBe(125);
    for (const bad of ['0', '-1', '1.2345', 'abc', '', '1e3']) expect(() => parseQuantityMilli(bad), bad).toThrow(RangeError);
    expect(formatQuantityMilli(12500)).toBe('12.5');
    expect(formatQuantityMilli(1000)).toBe('1');
    expect(formatQuantityMilli(125)).toBe('0.125');
    expect(parsePercentBps('')).toBe(0);
    expect(parsePercentBps('5')).toBe(500);
    expect(parsePercentBps('12.5')).toBe(1250);
    expect(parsePercentBps('0.25')).toBe(25);
    for (const bad of ['100.01', '-1', '1.234', 'x']) expect(() => parsePercentBps(bad), bad).toThrow(RangeError);
    expect(formatBps(1250)).toBe('12.5');
    expect(formatBps(500)).toBe('5');
    expect(formatBps(25)).toBe('0.25');
    expect(paiseToInput(125000050n)).toBe('1250000.5');
    expect(paiseToInput(100n)).toBe('1');
  });
});

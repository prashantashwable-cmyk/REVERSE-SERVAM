/**
 * Decimal-safe money (spec §49.1): all amounts are integer PAISE held in
 * `bigint`. Percentages / rates are integer BASIS POINTS (1% = 100 bps).
 * Never use floating point for money.
 */

export type Paise = bigint;
export type BasisPoints = number;

const RUPEE_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** Parse "1234.5" / "1,23,456.78" / "₹ 99" into paise. Throws on invalid input. */
export function parseInr(input: string): Paise {
  const cleaned = input.replace(/[₹,\s]/g, '').replace(/^INR/i, '');
  const m = RUPEE_PATTERN.exec(cleaned);
  if (!m) throw new RangeError(`Invalid INR amount: "${input}"`);
  const [, sign, rupees, fraction = ''] = m;
  const paise = BigInt(rupees!) * 100n + BigInt((fraction + '00').slice(0, 2));
  return sign ? -paise : paise;
}

export function rupees(amount: number | string): Paise {
  return parseInr(String(amount));
}

/** Indian digit grouping: 12,34,56,789.00 */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/** Format paise as INR, e.g. 12345678n → "₹1,23,456.78". */
export function formatInr(paise: Paise, opts: { symbol?: boolean } = {}): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const intPart = (abs / 100n).toString();
  const frac = (abs % 100n).toString().padStart(2, '0');
  const body = `${groupIndian(intPart)}.${frac}`;
  const symbol = opts.symbol === false ? '' : '₹';
  return `${negative ? '-' : ''}${symbol}${body}`;
}

/**
 * Round half away from zero of numerator/denominator (both bigint, denominator > 0).
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** amount × bps / 10000, rounded half away from zero to the paisa. */
export function applyBps(amount: Paise, bps: BasisPoints): Paise {
  if (!Number.isInteger(bps)) throw new RangeError('basis points must be an integer');
  return divRound(amount * BigInt(bps), 10_000n);
}

/** Ratio part/whole expressed in basis points (rounded). whole must be > 0. */
export function ratioBps(part: Paise, whole: Paise): BasisPoints {
  if (whole <= 0n) throw new RangeError('whole must be positive');
  return Number(divRound(part * 10_000n, whole));
}

export function sum(values: readonly Paise[]): Paise {
  return values.reduce((a, b) => a + b, 0n);
}

/**
 * Split `total` across weights (e.g. milestone percentages in bps) so that the
 * parts sum EXACTLY to total (largest-remainder method; ties go to the earlier
 * part). Weights must be non-negative integers with a positive sum.
 */
export function allocate(total: Paise, weights: readonly number[]): Paise[] {
  if (weights.length === 0) throw new RangeError('weights required');
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) throw new RangeError('weights must be non-negative integers');
  const weightSum = BigInt(weights.reduce((a, b) => a + b, 0));
  if (weightSum === 0n) throw new RangeError('weights must not all be zero');
  if (total < 0n) return allocate(-total, weights).map((p) => -p);
  const parts = weights.map((w) => (total * BigInt(w)) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (total * BigInt(w)) % weightSum }));
  let leftover = total - sum(parts);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; leftover > 0n; k++, leftover--) {
    const idx = remainders[k % remainders.length]!.i;
    parts[idx] = parts[idx]! + 1n;
  }
  return parts;
}

/** "1" / "12.5" / "0.125" → thousandths of a unit (integer). Throws on invalid or non-positive input. */
export function parseQuantityMilli(input: string): number {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!m) throw new RangeError(`Invalid quantity: "${input}"`);
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  if (milli <= 0 || milli > 999_999_999) throw new RangeError(`Invalid quantity: "${input}"`);
  return milli;
}

export function formatQuantityMilli(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const frac = String(milli % 1000).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Percentage text ("5", "12.5", "0.25", "") → basis points (0–10000). Throws on invalid input. */
export function parsePercentBps(input: string): BasisPoints {
  const s = input.trim();
  if (s === '') return 0;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new RangeError(`Invalid percentage: "${input}"`);
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (bps > 10_000) throw new RangeError(`Invalid percentage: "${input}"`);
  return bps;
}

/** 1250 → "12.5" (percent, no sign). */
export function formatBps(bps: BasisPoints): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(Math.abs(bps % 100)).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Paise → plain rupee text for an input field ("1250000.5"), no grouping or symbol. */
export function paiseToInput(paise: Paise): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const frac = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / 100n}${frac ? `.${frac}` : ''}`;
}

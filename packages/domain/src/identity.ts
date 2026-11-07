/**
 * Contact normalization and business identifiers (spec §4.5, §7.4, §58).
 * Mirrors app.normalize_phone() / app.next_business_id() in the database.
 */

/**
 * Normalize an Indian mobile / landline number to E.164 (+91XXXXXXXXXX).
 * Accepts "+91 98765 43210", "098765-43210", "919876543210", "9876543210".
 * Returns null when the input cannot be an Indian 10-digit number.
 * Other country codes are accepted only when written with an explicit "+".
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    if (digits.startsWith('91')) return digits.length === 12 ? `+${digits}` : null;
    // International number: E.164 allows max 15 digits, min 8 is a sane floor.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  let national = digits;
  if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
  else if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
  if (national.length !== 10 || national.startsWith('0')) return null;
  return `+91${national}`;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const e = input.trim().toLowerCase();
  // Deliberately simple: one @, non-empty local part, dotted domain, no spaces.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Display an E.164 Indian number as "+91 98765 43210". */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** Entity prefixes: every entity type has its own, never-reused series (§4.5). */
export const BUSINESS_ID_PREFIXES = {
  project: 'AIEC',
  lead: 'LD',
  survey: 'SV',
  quotation: 'QT',
  technical_review: 'TR',
  technical_document: 'TD',
  order: 'OR',
  task: 'TK',
  defect: 'DF',
  purchase_order: 'PO',
  purchase_request: 'PR',
  goods_receipt: 'GRN',
  payment: 'PM',
  inspection: 'IN',
} as const;

export type BusinessEntity = keyof typeof BUSINESS_ID_PREFIXES;

/** City codes for configured service areas. Extend through business rules. */
export const CITY_CODES: Record<string, string> = {
  pune: 'PUN',
  pcmc: 'PCM',
  'pimpri-chinchwad': 'PCM',
};

export function cityCode(city: string): string {
  const key = city.trim().toLowerCase();
  const code = CITY_CODES[key];
  if (code) return code;
  const letters = key.replace(/[^a-z]/g, '').toUpperCase();
  if (letters.length < 3) throw new RangeError(`Cannot derive city code from "${city}"`);
  return letters.slice(0, 3);
}

/** e.g. formatBusinessId('project', 'PUN', 2026, 125) → "AIEC-PUN-2026-00125" */
export function formatBusinessId(entity: BusinessEntity, city: string, year: number, sequence: number): string {
  if (!/^[A-Z]{3}$/.test(city)) throw new RangeError('city code must be 3 uppercase letters');
  if (!Number.isInteger(year) || year < 2000 || year > 2999) throw new RangeError('invalid year');
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99_999) throw new RangeError('sequence out of range');
  return `${BUSINESS_ID_PREFIXES[entity]}-${city}-${year}-${String(sequence).padStart(5, '0')}`;
}

const BUSINESS_ID_PATTERN = /^([A-Z]{2,4})-([A-Z]{3})-(\d{4})-(\d{5})$/;

export function parseBusinessId(id: string):
  | { entity: BusinessEntity; city: string; year: number; sequence: number }
  | null {
  const m = BUSINESS_ID_PATTERN.exec(id);
  if (!m) return null;
  const entity = (Object.keys(BUSINESS_ID_PREFIXES) as BusinessEntity[]).find((k) => BUSINESS_ID_PREFIXES[k] === m[1]);
  if (!entity) return null;
  return { entity, city: m[2]!, year: Number(m[3]), sequence: Number(m[4]) };
}

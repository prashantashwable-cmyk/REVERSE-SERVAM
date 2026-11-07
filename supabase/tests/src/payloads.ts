import { randomInt } from 'node:crypto';

/**
 * Synthetic test data. Values must never accidentally look alike, because the
 * real duplicate detector (phone, email, trigram similarity ≥ 0.6, proximity)
 * would rightly flag them. Names are random letter strings with no shared
 * words; phones are random 10-digit mobiles (collision odds ~1e-9 per pair).
 */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export function randomWord(length = 14): string {
  let w = '';
  for (let i = 0; i < length; i++) w += LETTERS[randomInt(LETTERS.length)];
  return w;
}

export const nextPhone = (): string => `9${String(randomInt(1_000_000_000)).padStart(9, '0')}`;

export function leadPayload(over: Record<string, unknown> = {}) {
  return {
    contact_name: 'Demo Contact',
    phone: nextPhone(),
    customer_type: 'housing_society',
    project_name: randomWord(),
    lift_requirement: 'One 6-passenger lift, G+4',
    source: 'website',
    site: { city: 'Pune', locality: 'Baner', pincode: '411045' },
    ...over,
  };
}

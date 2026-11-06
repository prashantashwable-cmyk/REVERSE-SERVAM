import { randomUUID } from 'node:crypto';

let phoneSeq = 0;
/** Unique synthetic mobile per test lead to keep duplicate checks independent. */
export const nextPhone = () => `98${String(Date.now() % 1e6).padStart(6, '0')}${String(phoneSeq++).padStart(2, '0')}`;

export function leadPayload(over: Record<string, unknown> = {}) {
  return {
    contact_name: 'Demo Contact',
    phone: nextPhone(),
    customer_type: 'housing_society',
    project_name: `Demo Residency ${randomUUID().slice(0, 8)}`,
    lift_requirement: 'One 6-passenger lift, G+4',
    source: 'website',
    site: { city: 'Pune', locality: 'Baner', pincode: '411045' },
    ...over,
  };
}


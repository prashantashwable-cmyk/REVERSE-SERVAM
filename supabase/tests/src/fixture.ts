export const USERS = [
  'owner',
  'sales1',
  'sales2',
  'surveyor1',
  'surveyor2',
  'tech1',
  'ops1',
  'partnerA_admin',
  'partnerA_tech',
  'partnerB_admin',
  'partnerB_tech',
  'customer1',
  'pending1',
] as const;
export type UserKey = (typeof USERS)[number];

export interface Fixture {
  users: Record<UserKey, string>;
  orgs: { aiec: string; partnerA: string; partnerB: string; customer: string };
}

declare module 'vitest' {
  export interface ProvidedContext {
    fixture: Fixture;
  }
}

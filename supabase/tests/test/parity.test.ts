import { afterAll, describe, expect, it } from 'vitest';
import {
  CALL_OUTCOMES,
  LEAD_STATES,
  LOST_REASONS,
  ORGANIZATION_KINDS,
  PERMISSIONS,
  ROLE_CODES,
  ROLE_ORG_KINDS,
  ROLE_PERMISSIONS,
  SURVEY_STATES,
  DEFAULT_SURVEY_REQUIREMENTS,
  DEFAULT_LEAD_SCORING,
  leadMachine,
  surveyMachine,
  scoreLead,
  normalizePhone,
} from '@aiec/domain';
import { admin, makePool } from '../src/db';

/** The database and the shared domain package must never drift apart. */
const pool = makePool();
afterAll(() => pool.end());

const enumLabels = async (type: string) =>
  (await admin<{ l: string }>(pool, `select unnest(enum_range(null::public.${type}))::text as l`)).map((r) => r.l);

describe('DB ↔ domain parity', () => {
  it('permission catalogue', async () => {
    const rows = await admin<{ code: string; description: string }>(pool, 'select code, description from public.permissions order by code');
    expect(Object.fromEntries(rows.map((r) => [r.code, r.description]))).toEqual(PERMISSIONS);
  });

  it('roles, allowed organization kinds and role → permission matrix', async () => {
    expect((await admin<{ code: string }>(pool, 'select code from public.roles order by code')).map((r) => r.code)).toEqual([...ROLE_CODES].sort());
    const kinds = await admin<{ role_code: string; org_kind: string }>(pool, 'select role_code, org_kind::text from public.role_org_kinds');
    for (const role of ROLE_CODES) {
      expect(kinds.filter((k) => k.role_code === role).map((k) => k.org_kind).sort()).toEqual([...ROLE_ORG_KINDS[role]].sort());
    }
    const perms = await admin<{ role_code: string; permission_code: string }>(pool, 'select role_code, permission_code from public.role_permissions');
    for (const role of ROLE_CODES) {
      expect(perms.filter((p) => p.role_code === role).map((p) => p.permission_code).sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('enumerations', async () => {
    expect(await enumLabels('org_kind')).toEqual([...ORGANIZATION_KINDS]);
    expect(await enumLabels('lead_state')).toEqual([...LEAD_STATES]);
    expect(await enumLabels('survey_state')).toEqual([...SURVEY_STATES]);
    expect(await enumLabels('lost_reason')).toEqual([...LOST_REASONS]);
    expect(await enumLabels('call_outcome')).toEqual([...CALL_OUTCOMES]);
  });

  it('state transition tables equal the domain machines', async () => {
    const rows = await admin<{ machine: string; from_state: string; action: string; to_state: string; permission_code: string; requires_reason: boolean; audit_event: string }>(
      pool,
      'select machine, from_state, action, to_state, permission_code, requires_reason, audit_event from public.state_transitions',
    );
    for (const m of [leadMachine, surveyMachine]) {
      const expected = m.transitions
        .flatMap((t) => t.from.map((f) => `${f}|${t.action}|${t.to}|${t.permission}|${!!t.requiresReason}|${t.auditEvent}`))
        .sort();
      const actual = rows
        .filter((r) => r.machine === m.name)
        .map((r) => `${r.from_state}|${r.action}|${r.to_state}|${r.permission_code}|${r.requires_reason}|${r.audit_event}`)
        .sort();
      expect(actual).toEqual(expected);
    }
  });

  it('seeded survey requirements and lead scoring equal the domain defaults', async () => {
    const [req] = await admin<{ v: unknown }>(pool, `select app.rule('survey.requirements') as v`);
    expect(req!.v).toEqual(DEFAULT_SURVEY_REQUIREMENTS);
    const [scoring] = await admin<{ v: unknown }>(pool, `select app.rule('lead.scoring') as v`);
    expect(scoring!.v).toEqual(DEFAULT_LEAD_SCORING);
    const q = { need: 'New lift', decision_authority: 'confirmed', timeline: 'within_3_months', site_readiness: 'ready', number_of_lifts: 2 };
    const [db] = await admin<{ v: { score: number; explanation: unknown } }>(pool, 'select app.score_lead($1) as v', [q]);
    expect(db!.v).toEqual(scoreLead(q));
  });

  it('phone normalization', async () => {
    for (const input of ['+91 98765 43210', '098765-43210', '919876543210', '9876543210', '+1 415 555 0100', '12345', '0123456789', '+91 12345', '']) {
      const [row] = await admin<{ v: string | null }>(pool, 'select app.normalize_phone($1) as v', [input]);
      expect(row!.v, input).toBe(normalizePhone(input));
    }
  });
});

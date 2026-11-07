import { afterAll, describe, expect, inject, it } from 'vitest';
import { Session, admin, expectCode, makePool } from '../src/db';
import type { UserKey } from '../src/fixture';

const fx = inject('fixture');
const pool = makePool();
afterAll(() => pool.end());
const as = (u: UserKey) => new Session(pool, fx.users[u]);
const anon = new Session(pool, null);

describe('Slice 1 — identity, role context and RBAC', () => {
  it('get_my_context resolves organizations, roles and permissions', async () => {
    const ctx = await as('sales1').rpc('get_my_context');
    expect(ctx.profile.status).toBe('active');
    expect(ctx.memberships).toEqual([
      expect.objectContaining({ organization_id: fx.orgs.aiec, organization_kind: 'aiec', roles: ['sales_executive'], is_demo: false }),
    ]);
    expect(ctx.permissions).toContain('lead.create');
    expect(ctx.permissions).not.toContain('lead.read_all');
    expect(ctx.aiec_organization_id).toBe(fx.orgs.aiec);
  });

  it('pending accounts see their context but hold no permissions and cannot act', async () => {
    const ctx = await as('pending1').rpc('get_my_context');
    expect(ctx.profile.status).toBe('pending_verification');
    expect(ctx.permissions).toEqual([]);
    await expectCode(as('pending1').rpc('search_possible_duplicates', { p_phone: '9876500000' }), 'ACCOUNT_NOT_ACTIVE');
  });

  it('anonymous callers can neither read tables nor execute RPCs', async () => {
    await expect(anon.query('select * from public.leads')).rejects.toMatchObject({ pgCode: '42501' });
    await expect(anon.query('select * from public.user_profiles')).rejects.toMatchObject({ pgCode: '42501' });
    await expect(anon.rpc('get_my_context')).rejects.toMatchObject({ pgCode: '42501' });
  });

  it('clients cannot write tables directly — only through validated RPCs', async () => {
    await expect(as('owner').query(`update public.user_profiles set status = 'active' where id = $1`, [fx.users.pending1])).rejects.toMatchObject({ pgCode: '42501' });
    await expect(as('owner').query(`insert into public.user_roles (organization_id, user_id, role_code, grant_reason) values ($1, $2, 'owner', 'x')`, [fx.orgs.aiec, fx.users.sales1])).rejects.toMatchObject({ pgCode: '42501' });
    await expect(as('owner').query('delete from public.audit_logs')).rejects.toMatchObject({ pgCode: '42501' });
    await expect(as('sales1').query(`update public.leads set status = 'won'`)).rejects.toMatchObject({ pgCode: '42501' });
  });

  it('audit log is append-only even for the database owner', async () => {
    await expectCode(admin(pool, 'update public.audit_logs set reason = $1', ['tamper']), 'ACCESS_DENIED');
    await expectCode(admin(pool, 'delete from public.audit_logs'), 'ACCESS_DENIED');
    await expectCode(admin(pool, 'truncate public.audit_logs'), 'ACCESS_DENIED');
  });

  it('roles can only be granted in allowed organization kinds', async () => {
    await expectCode(
      as('owner').rpc('admin_grant_role', { p_user_id: fx.users.sales2, p_org_id: fx.orgs.aiec, p_role_code: 'technician', p_reason: 'wrong kind' }),
      'VALIDATION_FAILED',
    );
    await expectCode(
      as('owner').rpc('admin_grant_role', { p_user_id: fx.users.sales2, p_org_id: fx.orgs.partnerA, p_role_code: 'technician', p_reason: 'not a member' }),
      'VALIDATION_FAILED',
    );
  });

  it('partner admins administer only their own tenant and only field roles', async () => {
    const pa = as('partnerA_admin');
    await expectCode(pa.rpc('admin_grant_role', { p_user_id: fx.users.partnerA_tech, p_org_id: fx.orgs.partnerA, p_role_code: 'partner_admin', p_reason: 'escalate' }), 'ACCESS_DENIED');
    await expectCode(pa.rpc('admin_add_member', { p_user_id: fx.users.partnerB_tech, p_org_id: fx.orgs.partnerB, p_reason: 'poach' }), 'ACCESS_DENIED');
    // Cannot pull an AIEC or other-tenant user into their organization.
    await expectCode(pa.rpc('admin_add_member', { p_user_id: fx.users.sales1, p_org_id: fx.orgs.partnerA, p_reason: 'attach' }), 'TENANT_SCOPE_VIOLATION');
    await expectCode(pa.rpc('admin_set_user_status', { p_user_id: fx.users.partnerB_tech, p_status: 'suspended', p_reason: 'not mine' }), 'ACCESS_DENIED');
  });

  it('tenant isolation: partner A sees only its own people and no AIEC records', async () => {
    const pa = as('partnerA_admin');
    const profiles = await pa.query<{ id: string }>('select id from public.user_profiles');
    expect(profiles.map((p) => p.id).sort()).toEqual([fx.users.partnerA_admin, fx.users.partnerA_tech].sort());
    const orgs = await pa.query<{ id: string }>('select id from public.organizations');
    expect(orgs.map((o) => o.id)).toEqual([fx.orgs.partnerA]);
    const roles = await pa.query<{ user_id: string }>('select user_id from public.user_roles');
    expect(new Set(roles.map((r) => r.user_id))).toEqual(new Set([fx.users.partnerA_admin, fx.users.partnerA_tech]));
    expect(await pa.query('select 1 from public.audit_logs')).toEqual([]);
    expect(await pa.query('select 1 from public.leads')).toEqual([]);
    // Technician sees only themself.
    const t = await as('partnerB_tech').query<{ id: string }>('select id from public.user_profiles');
    expect(t.map((p) => p.id)).toEqual([fx.users.partnerB_tech]);
  });

  it('the last active Owner cannot be removed, suspended or demoted; nobody changes their own status', async () => {
    const owner = as('owner');
    const [ownerRole] = await owner.query<{ id: string }>(`select id from public.user_roles where user_id = $1 and role_code = 'owner' and revoked_at is null`, [fx.users.owner]);
    await expectCode(owner.rpc('admin_revoke_role', { p_user_role_id: ownerRole!.id, p_reason: 'oops' }), 'LAST_OWNER_PROTECTED');
    await expectCode(owner.rpc('admin_remove_member', { p_user_id: fx.users.owner, p_org_id: fx.orgs.aiec, p_reason: 'oops' }), 'LAST_OWNER_PROTECTED');
    await expectCode(owner.rpc('admin_set_user_status', { p_user_id: fx.users.owner, p_status: 'suspended', p_reason: 'oops' }), 'SELF_APPROVAL_FORBIDDEN');
  });

  it('suspension revokes access on the very next request and is audited', async () => {
    const owner = as('owner');
    await owner.rpc('admin_set_user_status', { p_user_id: fx.users.ops1, p_status: 'suspended', p_reason: 'investigation' });
    expect(await as('ops1').query('select 1 from public.surveys')).toEqual([]);
    expect((await as('ops1').rpc('get_my_context')).permissions).toEqual([]);
    await owner.rpc('admin_set_user_status', { p_user_id: fx.users.ops1, p_status: 'active', p_reason: 'cleared' });
    expect((await as('ops1').rpc('get_my_context')).permissions).toContain('project.plan');
    const audit = await owner.query<{ action: string; actor_roles: string[]; reason: string }>(
      `select action, actor_roles, reason from public.audit_logs where entity_id = $1 and action = 'user.status_changed' order by id`,
      [fx.users.ops1],
    );
    expect(audit.slice(-2)).toEqual([
      { action: 'user.status_changed', actor_roles: ['owner'], reason: 'investigation' },
      { action: 'user.status_changed', actor_roles: ['owner'], reason: 'cleared' },
    ]);
  });

  it('role revocation takes effect immediately and keeps history', async () => {
    const owner = as('owner');
    const roleId = await owner.rpc<string>('admin_grant_role', { p_user_id: fx.users.ops1, p_org_id: fx.orgs.aiec, p_role_code: 'accounts_finance', p_reason: 'cover leave' });
    expect((await as('ops1').rpc('get_my_context')).permissions).toContain('finance.payment.verify');
    await owner.rpc('admin_revoke_role', { p_user_role_id: roleId, p_reason: 'leave ended' });
    expect((await as('ops1').rpc('get_my_context')).permissions).not.toContain('finance.payment.verify');
    const [row] = await owner.query<{ revoked_at: string | null; grant_reason: string }>('select revoked_at, grant_reason from public.user_roles where id = $1', [roleId]);
    expect(row!.revoked_at).not.toBeNull();
    expect(row!.grant_reason).toBe('cover leave');
  });

  it('business rules are versioned, audited and owner-only', async () => {
    await expectCode(as('sales1').rpc('set_business_rule', { p_rule_key: 'gps.check_in', p_value: { max_accuracy_m: 500 }, p_reason: 'lazy' }), 'ACCESS_DENIED');
    const r = await as('owner').rpc('set_business_rule', { p_rule_key: 'gps.check_in', p_value: { max_accuracy_m: 40 }, p_reason: 'tighten accuracy' });
    expect(r).toEqual({ rule_key: 'gps.check_in', version: 2 });
    const [cur] = await admin<{ v: unknown }>(pool, `select app.rule('gps.check_in') as v`);
    expect(cur!.v).toEqual({ max_accuracy_m: 40 });
    // Restore launch default as a new version (history is never rewritten).
    await as('owner').rpc('set_business_rule', { p_rule_key: 'gps.check_in', p_value: { max_accuracy_m: 50 }, p_reason: 'restore default' });
    await expectCode(admin(pool, `delete from public.business_rules where rule_key = 'gps.check_in'`), 'ACCESS_DENIED');
  });

  it('assignment pickers expose only id and name of active, capable people', async () => {
    const surveyors = await as('sales1').rpc<{ id: string; full_name: string }[]>('list_assignable_users', { p_purpose: 'surveyor' });
    expect(surveyors.map((s) => s.id).sort()).toEqual([fx.users.surveyor1, fx.users.surveyor2].sort());
    expect(Object.keys(surveyors[0]!).sort()).toEqual(['full_name', 'id']);
    const owners = await as('owner').rpc<{ id: string }[]>('list_assignable_users', { p_purpose: 'lead_owner' });
    expect(owners.map((s) => s.id).sort()).toEqual([fx.users.sales1, fx.users.sales2].sort());
    await expectCode(as('sales1').rpc('list_assignable_users', { p_purpose: 'lead_owner' }), 'ACCESS_DENIED');
    await expectCode(as('partnerA_admin').rpc('list_assignable_users', { p_purpose: 'surveyor' }), 'ACCESS_DENIED');
    await expectCode(as('owner').rpc('list_assignable_users', { p_purpose: 'everyone' }), 'VALIDATION_FAILED');
  });

  it('interface language: Marathi by default, changeable by any signed-in user (also pending), audited', async () => {
    const [row] = await admin<{ preferred_locale: string }>(pool, 'select preferred_locale from public.user_profiles where id = $1', [fx.users.pending1]);
    expect(row!.preferred_locale).toBe('mr');
    expect((await as('pending1').rpc('get_my_context')).profile.preferred_locale).toBe('mr');
    expect(await as('pending1').rpc('set_my_locale', { p_locale: 'en' })).toMatchObject({ preferred_locale: 'en', changed: true });
    expect(await as('pending1').rpc('set_my_locale', { p_locale: 'en' })).toMatchObject({ changed: false });
    await expectCode(as('pending1').rpc('set_my_locale', { p_locale: 'fr' }), 'VALIDATION_FAILED');
    await expect(anon.rpc('set_my_locale', { p_locale: 'mr' })).rejects.toMatchObject({ pgCode: '42501' });
    const audit = await admin<{ action: string; new_values: { preferred_locale: string } }>(
      pool, `select action, new_values from public.audit_logs where entity_id = $1 and action = 'profile.locale_changed'`, [fx.users.pending1]);
    expect(audit).toEqual([{ action: 'profile.locale_changed', new_values: { preferred_locale: 'en' } }]);
    await as('pending1').rpc('set_my_locale', { p_locale: 'mr' });
  });

  it('profile updates use optimistic concurrency', async () => {
    const ctx = await as('sales2').rpc('get_my_context');
    await as('sales2').rpc('update_my_profile', { p_full_name: 'Sales Two', p_preferred_locale: 'mr', p_expected_version: ctx.profile.version });
    await expectCode(as('sales2').rpc('update_my_profile', { p_full_name: 'Stale', p_expected_version: ctx.profile.version }), 'REVISION_CONFLICT');
  });
});

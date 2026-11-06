-- =============================================================================
-- Slice 1 RPCs: role context, profile, organization / membership / role
-- administration, user status, business rules, notifications.
-- Every RPC: authenticate → authorize → validate → mutate → audit.
-- =============================================================================

-- §4.2 First login: identity, organizations, roles, permissions, onboarding gaps.
create function public.get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.user_profiles;
  v_memberships jsonb;
  v_permissions jsonb;
  v_missing jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    perform app.raise_error('AUTH_REQUIRED');
  end if;
  select * into v_profile from public.user_profiles where id = v_uid;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'user_profile'));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'organization_id', o.id,
           'organization_name', o.name,
           'organization_kind', o.kind,
           'is_demo', o.is_demo,
           'roles', coalesce((
             select jsonb_agg(ur.role_code order by ur.role_code)
             from public.user_roles ur
             where ur.user_id = v_uid and ur.organization_id = o.id and ur.revoked_at is null
           ), '[]'::jsonb)
         ) order by o.kind, o.name), '[]'::jsonb)
    into v_memberships
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
   where m.user_id = v_uid and m.status = 'active';

  select coalesce(jsonb_agg(distinct rp.permission_code order by rp.permission_code), '[]'::jsonb)
    into v_permissions
    from public.user_roles ur
    join public.organization_memberships m on m.organization_id = ur.organization_id and m.user_id = ur.user_id and m.status = 'active'
    join public.organizations o on o.id = ur.organization_id and o.status = 'active'
    join public.role_org_kinds rok on rok.role_code = ur.role_code and rok.org_kind = o.kind
    join public.role_permissions rp on rp.role_code = ur.role_code
   where ur.user_id = v_uid and ur.revoked_at is null and v_profile.status = 'active';

  if v_profile.full_name is null then
    v_missing := v_missing || '["full_name"]'::jsonb;
  end if;
  if v_profile.phone_e164 is null and v_profile.email is null then
    v_missing := v_missing || '["contact"]'::jsonb;
  end if;

  return jsonb_build_object(
    'user_id', v_uid,
    'profile', jsonb_build_object(
      'full_name', v_profile.full_name,
      'phone_e164', v_profile.phone_e164,
      'email', v_profile.email,
      'status', v_profile.status,
      'preferred_locale', v_profile.preferred_locale,
      'version', v_profile.version
    ),
    'memberships', v_memberships,
    'permissions', v_permissions,
    'aiec_organization_id', app.aiec_org_id(),
    'onboarding_missing', v_missing
  );
end;
$$;

create function public.update_my_profile(p_full_name text, p_preferred_locale text default null, p_expected_version integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.user_profiles;
  v_new public.user_profiles;
begin
  if v_uid is null then
    perform app.raise_error('AUTH_REQUIRED');
  end if;
  select * into v_old from public.user_profiles where id = v_uid for update;
  if p_expected_version is not null and p_expected_version <> v_old.version then
    perform app.raise_error('REVISION_CONFLICT', jsonb_build_object('expected', p_expected_version, 'current', v_old.version));
  end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 2 and 120 then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('full_name')));
  end if;
  if p_preferred_locale is not null and p_preferred_locale not in ('en', 'mr', 'hi') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('preferred_locale')));
  end if;
  update public.user_profiles
     set full_name = btrim(p_full_name),
         preferred_locale = coalesce(p_preferred_locale, preferred_locale)
   where id = v_uid
  returning * into v_new;
  perform app.audit(null, 'user_profile', v_uid, 'profile.updated',
    jsonb_build_object('full_name', v_old.full_name, 'preferred_locale', v_old.preferred_locale),
    jsonb_build_object('full_name', v_new.full_name, 'preferred_locale', v_new.preferred_locale));
  return jsonb_build_object('id', v_uid, 'version', v_new.version);
end;
$$;

-- Last-owner protection: the business must always keep one active Owner.
create function app.assert_not_last_owner(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
       select 1 from public.user_roles
       where user_id = p_user and role_code = 'owner' and revoked_at is null and organization_id = app.aiec_org_id())
     and not exists (
       select 1 from public.user_roles ur
       join public.user_profiles up on up.id = ur.user_id and up.status = 'active'
       where ur.role_code = 'owner' and ur.revoked_at is null and ur.user_id <> p_user
         and ur.organization_id = app.aiec_org_id()) then
    perform app.raise_error('LAST_OWNER_PROTECTED');
  end if;
end;
$$;

create function public.admin_create_organization(p_kind public.org_kind, p_name text, p_legal_name text, p_city text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_id uuid;
begin
  perform app.require_permission('org.manage', app.aiec_org_id());
  if p_kind = 'aiec' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'the AIEC organization already exists'));
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  insert into public.organizations (kind, name, legal_name, city, created_by, updated_by)
  values (p_kind, btrim(p_name), nullif(btrim(coalesce(p_legal_name, '')), ''), nullif(btrim(coalesce(p_city, '')), ''), v_uid, v_uid)
  returning id into v_id;
  perform app.audit(app.aiec_org_id(), 'organization', v_id, 'organization.created', null,
    jsonb_build_object('kind', p_kind, 'name', p_name), p_reason, 'org.manage');
  return v_id;
end;
$$;

-- Who may administer people in an organization:
--  * AIEC `role.assign` → any organization, any allowed role.
--  * Partner `partner.team.manage` → own partner org; supervisor / technician only.
create function app.can_administer(p_org uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'role.assign', app.aiec_org_id())
    or (
      app.user_has_permission(auth.uid(), 'partner.team.manage', p_org)
      and (p_role is null or p_role in ('partner_supervisor', 'technician'))
    )
$$;

create function public.admin_add_member(p_user_id uuid, p_org_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_id uuid;
  v_status text;
begin
  if not app.can_administer(p_org_id, null) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'role.assign'));
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  if not exists (select 1 from public.user_profiles where id = p_user_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'user_profile'));
  end if;
  -- Partner admins may only enrol people who belong to no other organization
  -- (prevents a partner tenant from attaching AIEC or other-tenant users).
  if not app.user_has_permission(v_uid, 'role.assign', app.aiec_org_id())
     and exists (select 1 from public.organization_memberships
                  where user_id = p_user_id and status = 'active' and organization_id <> p_org_id) then
    perform app.raise_error('TENANT_SCOPE_VIOLATION');
  end if;
  select id, status into v_id, v_status from public.organization_memberships
   where organization_id = p_org_id and user_id = p_user_id for update;
  if v_id is not null and v_status = 'active' then
    return v_id; -- already a member: idempotent
  elsif v_id is not null then
    -- Reactivation keeps the original row; the revocation history stays in audit_logs.
    update public.organization_memberships
       set status = 'active', revoked_at = null, revoked_by = null, revoke_reason = null
     where id = v_id;
  else
    insert into public.organization_memberships (organization_id, user_id, created_by)
    values (p_org_id, p_user_id, v_uid) returning id into v_id;
  end if;
  perform app.audit(p_org_id, 'organization_membership', v_id, 'membership.added', null,
    jsonb_build_object('user_id', p_user_id), p_reason, 'role.assign');
  return v_id;
end;
$$;

-- Removing a member revokes their roles; history and attribution remain (§12.7).
create function public.admin_remove_member(p_user_id uuid, p_org_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_id uuid;
  v_roles text[];
begin
  select coalesce(array_agg(role_code), '{}') into v_roles from public.user_roles
   where user_id = p_user_id and organization_id = p_org_id and revoked_at is null;
  if not app.can_administer(p_org_id, null)
     or (not app.user_has_permission(v_uid, 'role.assign', app.aiec_org_id())
         and exists (select 1 from unnest(v_roles) r where r not in ('partner_supervisor', 'technician'))) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'role.assign'));
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  if p_org_id = app.aiec_org_id() then
    perform app.assert_not_last_owner(p_user_id);
  end if;
  update public.user_roles set revoked_at = now(), revoked_by = v_uid, revoke_reason = p_reason
   where user_id = p_user_id and organization_id = p_org_id and revoked_at is null;
  update public.organization_memberships
     set status = 'revoked', revoked_at = now(), revoked_by = v_uid, revoke_reason = p_reason
   where user_id = p_user_id and organization_id = p_org_id and status = 'active'
  returning id into v_id;
  if v_id is null then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'organization_membership'));
  end if;
  perform app.audit(p_org_id, 'organization_membership', v_id, 'membership.removed',
    jsonb_build_object('roles', v_roles), null, p_reason, 'role.assign');
end;
$$;

create function public.admin_grant_role(p_user_id uuid, p_org_id uuid, p_role_code text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_id uuid;
begin
  if not app.can_administer(p_org_id, p_role_code) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'role.assign'));
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  if not exists (select 1 from public.roles where code = p_role_code) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('role_code')));
  end if;
  select id into v_id from public.user_roles
   where user_id = p_user_id and organization_id = p_org_id and role_code = p_role_code and revoked_at is null;
  if v_id is not null then
    return v_id; -- idempotent
  end if;
  insert into public.user_roles (organization_id, user_id, role_code, granted_by, grant_reason)
  values (p_org_id, p_user_id, p_role_code, v_uid, p_reason)
  returning id into v_id;
  perform app.audit(p_org_id, 'user_role', v_id, 'role.granted', null,
    jsonb_build_object('user_id', p_user_id, 'role', p_role_code), p_reason, 'role.assign');
  return v_id;
end;
$$;

create function public.admin_revoke_role(p_user_role_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_row public.user_roles;
begin
  select * into v_row from public.user_roles where id = p_user_role_id for update;
  if not found or v_row.revoked_at is not null then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'user_role'));
  end if;
  if not app.can_administer(v_row.organization_id, v_row.role_code) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'role.assign'));
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  if v_row.role_code = 'owner' then
    perform app.assert_not_last_owner(v_row.user_id);
  end if;
  update public.user_roles set revoked_at = now(), revoked_by = v_uid, revoke_reason = p_reason where id = p_user_role_id;
  perform app.audit(v_row.organization_id, 'user_role', v_row.id, 'role.revoked',
    jsonb_build_object('user_id', v_row.user_id, 'role', v_row.role_code), null, p_reason, 'role.assign');
end;
$$;

-- Activate / suspend accounts. Suspension takes effect on the next request
-- because every permission check reads user_profiles.status (§46.3).
create function public.admin_set_user_status(p_user_id uuid, p_status public.account_status, p_reason text, p_expected_version integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.user_profiles;
  v_new public.user_profiles;
  v_partner_scope boolean;
begin
  select * into v_old from public.user_profiles where id = p_user_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'user_profile'));
  end if;
  -- AIEC user.manage for anyone; partner admins only for their own field staff.
  v_partner_scope := exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_user_id and m.status = 'active'
      and app.user_has_permission(v_uid, 'partner.team.manage', m.organization_id)
  ) and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user_id and ur.revoked_at is null and ur.role_code not in ('partner_supervisor', 'technician')
  );
  if not (app.user_has_permission(v_uid, 'user.manage', app.aiec_org_id()) or v_partner_scope) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'user.manage'));
  end if;
  if p_user_id = v_uid then
    perform app.raise_error('SELF_APPROVAL_FORBIDDEN', jsonb_build_object('reason', 'users cannot change their own account status'));
  end if;
  if p_expected_version is not null and p_expected_version <> v_old.version then
    perform app.raise_error('REVISION_CONFLICT', jsonb_build_object('expected', p_expected_version, 'current', v_old.version));
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  if p_status <> 'active' then
    perform app.assert_not_last_owner(p_user_id);
  end if;
  update public.user_profiles set status = p_status, status_reason = p_reason where id = p_user_id returning * into v_new;
  perform app.audit(app.aiec_org_id(), 'user_profile', p_user_id, 'user.status_changed',
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new.status), p_reason, 'user.manage');
  return jsonb_build_object('id', p_user_id, 'status', v_new.status, 'version', v_new.version);
end;
$$;

-- Versioned configuration change with reason and audit (§35 O08).
create function public.set_business_rule(p_rule_key text, p_value jsonb, p_reason text, p_effective_from timestamptz default null, p_audience text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_prev public.business_rules;
  v_version integer;
begin
  perform app.require_permission('rules.manage', app.aiec_org_id());
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('value')));
  end if;
  perform pg_advisory_xact_lock(hashtext('business_rule:' || p_rule_key));
  select * into v_prev from public.business_rules where rule_key = p_rule_key order by version desc limit 1;
  v_version := coalesce(v_prev.version, 0) + 1;
  insert into public.business_rules (rule_key, version, value, audience, effective_from, reason, created_by)
  values (p_rule_key, v_version, p_value, coalesce(p_audience, v_prev.audience, 'aiec_staff'), coalesce(p_effective_from, now()), p_reason, v_uid);
  perform app.audit(app.aiec_org_id(), 'business_rule', null, 'rule.changed',
    jsonb_build_object('rule_key', p_rule_key, 'version', v_prev.version, 'value', v_prev.value),
    jsonb_build_object('rule_key', p_rule_key, 'version', v_version, 'value', p_value), p_reason, 'rules.manage');
  return jsonb_build_object('rule_key', p_rule_key, 'version', v_version);
end;
$$;

create function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.raise_error('AUTH_REQUIRED');
  end if;
  update public.notifications set read_at = coalesce(read_at, now())
   where id = p_notification_id and recipient_id = auth.uid();
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'notification'));
  end if;
end;
$$;

-- One-time platform bootstrap, run by an operator from the SQL editor
-- (database owner / service role only; never exposed to API roles). Creates the
-- AIEC organization and the first Owner. Refuses to run once an Owner exists.
create function app.bootstrap_platform(p_owner_user_id uuid, p_org_name text, p_city text default 'Pune')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if exists (select 1 from public.user_roles where role_code = 'owner' and revoked_at is null) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'platform already bootstrapped'));
  end if;
  if not exists (select 1 from public.user_profiles where id = p_owner_user_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'user_profile'));
  end if;
  v_org := app.aiec_org_id();
  if v_org is null then
    insert into public.organizations (kind, name, city) values ('aiec', p_org_name, p_city) returning id into v_org;
  end if;
  update public.user_profiles set status = 'active', status_reason = 'platform bootstrap' where id = p_owner_user_id;
  insert into public.organization_memberships (organization_id, user_id) values (v_org, p_owner_user_id)
  on conflict (organization_id, user_id) do update set status = 'active', revoked_at = null, revoked_by = null, revoke_reason = null;
  insert into public.user_roles (organization_id, user_id, role_code, grant_reason) values (v_org, p_owner_user_id, 'owner', 'platform bootstrap');
  insert into public.audit_logs (actor_id, organization_id, entity_type, entity_id, action, new_values, reason)
  values (null, v_org, 'organization', v_org, 'platform.bootstrapped', jsonb_build_object('owner_user_id', p_owner_user_id), 'platform bootstrap');
  return v_org;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.get_my_context(),
  public.update_my_profile(text, text, integer),
  public.admin_create_organization(public.org_kind, text, text, text, text),
  public.admin_add_member(uuid, uuid, text),
  public.admin_remove_member(uuid, uuid, text),
  public.admin_grant_role(uuid, uuid, text, text),
  public.admin_revoke_role(uuid, text),
  public.admin_set_user_status(uuid, public.account_status, text, integer),
  public.set_business_rule(text, jsonb, text, timestamptz, text),
  public.mark_notification_read(uuid)
  to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function
  app.current_user_id(), app.is_active_user(uuid), app.aiec_org_id(),
  app.user_has_permission(uuid, text, uuid), app.has_permission(text, uuid), app.is_member(uuid),
  app.can_read_profile(uuid), app.can_read_org_people(uuid), app.try_uuid(text)
  to authenticated;

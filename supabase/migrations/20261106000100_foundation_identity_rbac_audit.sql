-- =============================================================================
-- AIEC Elevator Installation OS — Slice 1: identity, organizations, RBAC,
-- append-only audit, business rules, identifiers, notifications, idempotency.
--
-- Conventions
--   * Clients get SELECT only (through RLS). Every mutation goes through a
--     SECURITY DEFINER RPC in `public` that authenticates, authorizes,
--     validates the state transition, writes audit and is idempotent.
--   * Private helpers live in schema `app` (not exposed by PostgREST).
--   * Errors are raised with MESSAGE = an error code from the catalogue in
--     packages/domain/src/errors.ts and DETAIL = JSON context.
--   * All SECURITY DEFINER functions pin `search_path = ''` and qualify names.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists postgis with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enumerations (must match packages/domain — asserted by supabase/tests)
-- -----------------------------------------------------------------------------
create type public.org_kind as enum ('aiec', 'partner', 'customer', 'supplier', 'qa_agency');
create type public.account_status as enum ('pending_verification', 'active', 'suspended');

-- -----------------------------------------------------------------------------
-- Error helper
-- -----------------------------------------------------------------------------
create function app.raise_error(p_code text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = coalesce(p_detail, '{}'::jsonb)::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- Catalogue: roles & permissions (seeded from packages/domain/src/rbac.ts)
-- -----------------------------------------------------------------------------
create table public.permissions (
  code text primary key check (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description text not null
);

create table public.roles (
  code text primary key check (code ~ '^[a-z_]+$'),
  name_key text not null
);

create table public.role_org_kinds (
  role_code text not null references public.roles (code),
  org_kind public.org_kind not null,
  primary key (role_code, org_kind)
);

create table public.role_permissions (
  role_code text not null references public.roles (code),
  permission_code text not null references public.permissions (code),
  primary key (role_code, permission_code)
);

-- -----------------------------------------------------------------------------
-- Organizations and users
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  kind public.org_kind not null,
  name text not null check (length(btrim(name)) between 2 and 200),
  legal_name text check (legal_name is null or length(btrim(legal_name)) between 2 and 200),
  city text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
-- Exactly one AIEC (platform owner) organization.
create unique index organizations_single_aiec on public.organizations (kind) where kind = 'aiec';
create index organizations_kind_idx on public.organizations (kind, status);

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text check (full_name is null or length(btrim(full_name)) between 2 and 120),
  phone_e164 text unique check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email extensions.citext,
  status public.account_status not null default 'pending_verification',
  status_reason text,
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'mr', 'hi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references public.user_profiles (id),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  created_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  unique (organization_id, user_id),
  check ((status = 'revoked') = (revoked_at is not null))
);
create index organization_memberships_user_idx on public.organization_memberships (user_id, status);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references public.user_profiles (id),
  role_code text not null references public.roles (code),
  granted_at timestamptz not null default now(),
  granted_by uuid,
  grant_reason text not null check (length(btrim(grant_reason)) >= 3),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  check (revoked_at is null or length(btrim(coalesce(revoke_reason, ''))) >= 3)
);
create unique index user_roles_active_unique on public.user_roles (organization_id, user_id, role_code) where revoked_at is null;
create index user_roles_user_idx on public.user_roles (user_id) where revoked_at is null;

-- Defense in depth: a role can only be granted in an allowed organization kind
-- and only to an active member of that organization.
create function app.validate_user_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind public.org_kind;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.user_id <> old.user_id or new.role_code <> old.role_code
       or new.granted_at <> old.granted_at or new.granted_by is distinct from old.granted_by
       or new.grant_reason <> old.grant_reason or old.revoked_at is not null then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'role grants are immutable; revoke and grant again'));
    end if;
    return new;
  end if;
  select kind into v_kind from public.organizations where id = new.organization_id;
  if not exists (select 1 from public.role_org_kinds where role_code = new.role_code and org_kind = v_kind) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'role not allowed in this organization kind', 'role', new.role_code, 'org_kind', v_kind));
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = new.organization_id and m.user_id = new.user_id and m.status = 'active'
  ) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'user is not an active member of the organization'));
  end if;
  return new;
end;
$$;
create trigger user_roles_validate before insert or update on public.user_roles
  for each row execute function app.validate_user_role();

-- New auth user → pending profile (identity resolved by Supabase Auth).
create function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, phone_e164, email, full_name)
  values (
    new.id,
    case when new.phone is null or new.phone = '' then null
         when left(new.phone, 1) = '+' then new.phone
         else '+' || new.phone end,
    nullif(new.email, ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Generic row housekeeping: server timestamps, actor and optimistic version.
-- -----------------------------------------------------------------------------
create function app.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Every table using this trigger has updated_at, updated_by and version.
  new.updated_at := now();
  new.version := old.version + 1;
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger organizations_touch before update on public.organizations for each row execute function app.touch_row();
create trigger user_profiles_touch before update on public.user_profiles for each row execute function app.touch_row();

-- -----------------------------------------------------------------------------
-- Authorization helpers (read-only, used by RLS and RPCs)
-- -----------------------------------------------------------------------------
create function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select auth.uid() $$;

create function app.is_active_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_profiles where id = p_user and status = 'active')
$$;

create function app.aiec_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select id from public.organizations where kind = 'aiec' $$;

-- Does p_user hold p_permission through an active role in p_org
-- (any organization when p_org is null)? Inactive accounts hold nothing.
create function app.user_has_permission(p_user uuid, p_permission text, p_org uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.organization_memberships m
      on m.organization_id = ur.organization_id and m.user_id = ur.user_id and m.status = 'active'
    join public.organizations o on o.id = ur.organization_id and o.status = 'active'
    join public.role_org_kinds rok on rok.role_code = ur.role_code and rok.org_kind = o.kind
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.user_profiles up on up.id = ur.user_id and up.status = 'active'
    where ur.user_id = p_user
      and ur.revoked_at is null
      and rp.permission_code = p_permission
      and (p_org is null or ur.organization_id = p_org)
  )
$$;

create function app.has_permission(p_permission text, p_org uuid default null)
returns boolean
language sql
stable
set search_path = ''
as $$ select app.user_has_permission(auth.uid(), p_permission, p_org) $$;

create function app.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    join public.user_profiles up on up.id = m.user_id and up.status = 'active'
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

-- Roles of the current user (in p_org) that grant p_permission: recorded in
-- audit as the "active role context" of a sensitive action (§3, §25).
create function app.roles_granting(p_permission text, p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ur.role_code order by ur.role_code), '{}')
  from public.user_roles ur
  join public.role_permissions rp on rp.role_code = ur.role_code and rp.permission_code = p_permission
  where ur.user_id = auth.uid() and ur.revoked_at is null
    and (p_org is null or ur.organization_id = p_org)
$$;

-- Authenticated + active account, else AUTH_REQUIRED / ACCOUNT_NOT_ACTIVE.
create function app.require_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform app.raise_error('AUTH_REQUIRED');
  end if;
  if not exists (select 1 from public.user_profiles where id = v_uid and status = 'active') then
    perform app.raise_error('ACCOUNT_NOT_ACTIVE');
  end if;
  return v_uid;
end;
$$;

create function app.require_permission(p_permission text, p_org uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.user_has_permission(auth.uid(), p_permission, p_org) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', p_permission));
  end if;
end;
$$;

create function app.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Append-only audit log (§25, §35 O09)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_roles text[] not null default '{}',
  permission_used text,
  organization_id uuid,
  project_id uuid,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  reason text,
  operation_id uuid,
  request_meta jsonb
);
create index audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, occurred_at desc);
create index audit_logs_org_idx on public.audit_logs (organization_id, occurred_at desc);

create function app.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', tg_table_name || ' is append-only'));
  return null;
end;
$$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function app.forbid_mutation();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.forbid_mutation();

create function app.audit(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_old jsonb default null,
  p_new jsonb default null,
  p_reason text default null,
  p_permission text default null,
  p_operation_id uuid default null,
  p_project_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  insert into public.audit_logs (
    actor_id, actor_roles, permission_used, organization_id, project_id, entity_type, entity_id,
    action, old_values, new_values, reason, operation_id, request_meta
  ) values (
    auth.uid(),
    case when p_permission is null then '{}'::text[] else app.roles_granting(p_permission, p_organization_id) end,
    p_permission, p_organization_id, p_project_id, p_entity_type, p_entity_id,
    p_action, p_old, p_new, p_reason, p_operation_id,
    case when v_headers is null then null
         else jsonb_strip_nulls(jsonb_build_object(
           'user_agent', v_headers ->> 'user-agent',
           'app_version', v_headers ->> 'x-aiec-app-version',
           'device_id', v_headers ->> 'x-aiec-device-id'))
    end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Versioned business rules (§5.5, §35 O08) — configuration, not code.
-- -----------------------------------------------------------------------------
create table public.business_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null check (rule_key ~ '^[a-z_]+(\.[a-z_]+)*$'),
  version integer not null check (version > 0),
  value jsonb not null,
  audience text not null default 'aiec_staff' check (audience in ('all_users', 'aiec_staff')),
  effective_from timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (rule_key, version)
);
create trigger business_rules_append_only before update or delete on public.business_rules
  for each row execute function app.forbid_mutation();

create function app.rule(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.business_rules
  where rule_key = p_key and effective_from <= now()
  order by version desc
  limit 1
$$;

-- -----------------------------------------------------------------------------
-- Immutable business identifiers (§4.5): never reused, one series per entity.
-- -----------------------------------------------------------------------------
create table public.id_sequences (
  series text primary key,
  last_value integer not null check (last_value between 0 and 99999)
);

create function app.next_business_id(p_prefix text, p_city_code text, p_year integer default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Kolkata'))::integer);
  v_series text;
  v_next integer;
begin
  if p_prefix !~ '^[A-Z]{2,4}$' or p_city_code !~ '^[A-Z]{3}$' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid identifier prefix or city code'));
  end if;
  v_series := p_prefix || '-' || p_city_code || '-' || v_year;
  insert into public.id_sequences (series, last_value) values (v_series, 1)
  on conflict (series) do update set last_value = public.id_sequences.last_value + 1
  returning last_value into v_next;
  return v_series || '-' || lpad(v_next::text, 5, '0');
end;
$$;

create function app.city_code(p_city text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := lower(btrim(coalesce(p_city, '')));
  v_code text;
begin
  v_code := app.rule('geo.city_codes') ->> v_key;
  if v_code is not null then
    return v_code;
  end if;
  v_code := upper(left(regexp_replace(v_key, '[^a-z]', '', 'g'), 3));
  if length(v_code) < 3 then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('city')));
  end if;
  return v_code;
end;
$$;

-- Indian phone normalization (mirrors packages/domain normalizePhone).
create function app.normalize_phone(p_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_trim text := btrim(coalesce(p_input, ''));
  v_digits text := regexp_replace(v_trim, '\D', '', 'g');
begin
  if v_trim = '' then
    return null;
  end if;
  if left(v_trim, 1) = '+' then
    if left(v_digits, 2) = '91' then
      return case when length(v_digits) = 12 then '+' || v_digits end;
    end if;
    return case when length(v_digits) between 8 and 15 then '+' || v_digits end;
  end if;
  if length(v_digits) = 12 and left(v_digits, 2) = '91' then
    v_digits := substr(v_digits, 3);
  elsif length(v_digits) = 11 and left(v_digits, 1) = '0' then
    v_digits := substr(v_digits, 2);
  end if;
  if length(v_digits) <> 10 or left(v_digits, 1) = '0' then
    return null;
  end if;
  return '+91' || v_digits;
end;
$$;

-- -----------------------------------------------------------------------------
-- Idempotency for offline / retried operations (§52.2)
-- -----------------------------------------------------------------------------
create table public.sync_operations (
  operation_id uuid primary key,
  user_id uuid not null references public.user_profiles (id),
  operation_type text not null,
  record_id uuid,
  status text not null default 'processing' check (status in ('processing', 'applied')),
  result jsonb,
  received_at timestamptz not null default now(),
  applied_at timestamptz
);
create index sync_operations_user_idx on public.sync_operations (user_id, received_at desc);

-- Returns the stored result when the operation was already applied (replay),
-- or NULL when the caller must perform it now. Concurrent duplicates block on
-- the primary key until the first transaction commits, then replay.
create function app.op_begin(p_operation_id uuid, p_operation_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_existing public.sync_operations;
begin
  if p_operation_id is null then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('operation_id')));
  end if;
  insert into public.sync_operations (operation_id, user_id, operation_type)
  values (p_operation_id, auth.uid(), p_operation_type)
  on conflict (operation_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return null;
  end if;
  select * into v_existing from public.sync_operations where operation_id = p_operation_id;
  if v_existing.user_id <> auth.uid() or v_existing.operation_type <> p_operation_type then
    perform app.raise_error('DUPLICATE_OPERATION', jsonb_build_object('reason', 'operation id already used for a different operation'));
  end if;
  return coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
end;
$$;

create function app.op_finish(p_operation_id uuid, p_record_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sync_operations
     set status = 'applied', record_id = p_record_id, result = p_result, applied_at = now()
   where operation_id = p_operation_id;
  return p_result || jsonb_build_object('replayed', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications (§22): idempotent through dedupe_key.
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.user_profiles (id),
  organization_id uuid references public.organizations (id),
  event_type text not null,
  entity_type text,
  entity_id uuid,
  title_key text not null,
  payload jsonb not null default '{}'::jsonb,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at, created_at desc);

create function app.notify(
  p_recipient uuid, p_org uuid, p_event text, p_entity_type text, p_entity_id uuid,
  p_title_key text, p_payload jsonb, p_dedupe_key text, p_severity text default 'info'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, organization_id, event_type, entity_type, entity_id, title_key, payload, dedupe_key, severity)
  values (p_recipient, p_org, p_event, p_entity_type, p_entity_id, p_title_key, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, p_severity)
  on conflict (dedupe_key) do nothing
$$;

-- Notify every active holder of a permission in an organization.
create function app.notify_permission_holders(
  p_permission text, p_org uuid, p_event text, p_entity_type text, p_entity_id uuid,
  p_title_key text, p_payload jsonb, p_dedupe_prefix text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.notify(u.user_id, p_org, p_event, p_entity_type, p_entity_id, p_title_key, p_payload, p_dedupe_prefix || ':' || u.user_id::text)
  from (
    select distinct ur.user_id from public.user_roles ur
    where ur.organization_id = p_org and ur.revoked_at is null
      and app.user_has_permission(ur.user_id, p_permission, p_org)
  ) u
$$;

-- -----------------------------------------------------------------------------
-- Seed: role / permission catalogue (generated from packages/domain/src/rbac.ts)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, description) values
  ('user.read', 'View user profiles within permitted organizations'),
  ('user.manage', 'Activate, suspend and verify users'),
  ('role.assign', 'Grant and revoke role assignments'),
  ('org.manage', 'Create and manage organizations'),
  ('rules.manage', 'Change business rules and approval limits'),
  ('audit.read', 'Read the audit log'),
  ('approval.exception.decide', 'Decide authorized workflow exceptions'),
  ('lead.create', 'Create leads'),
  ('lead.read_all', 'Read all leads in the organization'),
  ('lead.read_assigned', 'Read leads assigned to me'),
  ('lead.update_assigned', 'Update leads assigned to me'),
  ('lead.assign', 'Assign / reassign / reopen leads'),
  ('lead.activity.record', 'Record lead activities and follow-ups'),
  ('lead.qualify', 'Qualify leads'),
  ('lead.close', 'Close leads as lost or invalid'),
  ('lead.merge', 'Decide duplicate merges'),
  ('survey.schedule', 'Book, reschedule and cancel surveys'),
  ('survey.read_all', 'Read all surveys'),
  ('survey.read_assigned', 'Read surveys assigned to me'),
  ('survey.capture', 'Perform assigned surveys (check-in, capture, submit)'),
  ('survey.review', 'Review submitted surveys and request revisions'),
  ('survey.gps_exception.review', 'Review GPS / check-in exceptions'),
  ('technical.review', 'Record technical feasibility decisions'),
  ('technical.configuration.approve', 'Approve lift configuration revisions'),
  ('technical.drawing.approve', 'Approve drawing / BOM revisions'),
  ('technical.change.approve', 'Approve technical change and substitution requests'),
  ('quotation.create', 'Prepare quotation drafts'),
  ('quotation.issue', 'Issue approved quotation revisions to customers'),
  ('quotation.discount.approve', 'Approve discounts beyond sales authority'),
  ('order.convert', 'Convert an accepted quotation to an order'),
  ('project.read_all', 'Read all projects'),
  ('project.plan', 'Plan projects, readiness and schedules'),
  ('partner.assign', 'Assign partner companies to projects'),
  ('partner.verify', 'Verify partner companies and compliance documents'),
  ('finance.payment.verify', 'Verify customer payment claims'),
  ('finance.payout.prepare', 'Prepare partner / supplier payouts'),
  ('finance.payout.release', 'Approve and release payouts'),
  ('finance.ledger.read', 'Read financial ledgers'),
  ('finance.expense.approve', 'Approve expenses'),
  ('procurement.request.create', 'Create purchase requests against approved BOM'),
  ('procurement.po.create', 'Create purchase orders'),
  ('procurement.po.approve', 'Approve purchase orders'),
  ('procurement.grn.record', 'Record goods receipts'),
  ('partner.org.manage', 'Manage own partner company profile'),
  ('partner.project.read', 'Read projects assigned to own partner company'),
  ('partner.team.manage', 'Manage own partner workforce'),
  ('partner.task.assign', 'Assign partner tasks to own team members'),
  ('partner.daily_report.submit', 'Submit daily work reports'),
  ('partner.claim.submit', 'Submit partner milestone payment claims'),
  ('task.execute', 'Execute assigned tasks and capture evidence'),
  ('qa.inspection.decide', 'Decide assigned inspections'),
  ('qa.defect.manage', 'Create, verify and close defects'),
  ('customer.project.read', 'Read own projects'),
  ('customer.approval.decide', 'Approve exact document / quotation revisions');

insert into public.roles (code, name_key) values
  ('owner', 'role.owner'),
  ('operations_manager', 'role.operations_manager'),
  ('sales_executive', 'role.sales_executive'),
  ('surveyor', 'role.surveyor'),
  ('technical_manager', 'role.technical_manager'),
  ('accounts_finance', 'role.accounts_finance'),
  ('procurement_manager', 'role.procurement_manager'),
  ('partner_admin', 'role.partner_admin'),
  ('partner_supervisor', 'role.partner_supervisor'),
  ('technician', 'role.technician'),
  ('qa_inspector', 'role.qa_inspector'),
  ('customer', 'role.customer');

insert into public.role_org_kinds (role_code, org_kind) values
  ('owner', 'aiec'),
  ('operations_manager', 'aiec'),
  ('sales_executive', 'aiec'),
  ('surveyor', 'aiec'),
  ('technical_manager', 'aiec'),
  ('accounts_finance', 'aiec'),
  ('procurement_manager', 'aiec'),
  ('partner_admin', 'partner'),
  ('partner_supervisor', 'partner'),
  ('technician', 'partner'),
  ('qa_inspector', 'aiec'),
  ('qa_inspector', 'qa_agency'),
  ('customer', 'customer');

insert into public.role_permissions (role_code, permission_code) values
  ('owner', 'user.read'),
  ('owner', 'user.manage'),
  ('owner', 'role.assign'),
  ('owner', 'org.manage'),
  ('owner', 'rules.manage'),
  ('owner', 'audit.read'),
  ('owner', 'approval.exception.decide'),
  ('owner', 'lead.read_all'),
  ('owner', 'lead.assign'),
  ('owner', 'lead.merge'),
  ('owner', 'survey.read_all'),
  ('owner', 'project.read_all'),
  ('owner', 'quotation.discount.approve'),
  ('owner', 'partner.verify'),
  ('owner', 'finance.ledger.read'),
  ('owner', 'finance.payout.release'),
  ('owner', 'procurement.po.approve'),
  ('operations_manager', 'user.read'),
  ('operations_manager', 'survey.read_all'),
  ('operations_manager', 'project.read_all'),
  ('operations_manager', 'project.plan'),
  ('operations_manager', 'partner.assign'),
  ('operations_manager', 'procurement.po.approve'),
  ('sales_executive', 'lead.create'),
  ('sales_executive', 'lead.read_assigned'),
  ('sales_executive', 'lead.update_assigned'),
  ('sales_executive', 'lead.activity.record'),
  ('sales_executive', 'lead.qualify'),
  ('sales_executive', 'lead.close'),
  ('sales_executive', 'survey.schedule'),
  ('sales_executive', 'quotation.create'),
  ('sales_executive', 'quotation.issue'),
  ('sales_executive', 'order.convert'),
  ('surveyor', 'survey.read_assigned'),
  ('surveyor', 'survey.capture'),
  ('technical_manager', 'survey.read_all'),
  ('technical_manager', 'survey.review'),
  ('technical_manager', 'survey.gps_exception.review'),
  ('technical_manager', 'technical.review'),
  ('technical_manager', 'technical.configuration.approve'),
  ('technical_manager', 'technical.drawing.approve'),
  ('technical_manager', 'technical.change.approve'),
  ('accounts_finance', 'finance.payment.verify'),
  ('accounts_finance', 'finance.payout.prepare'),
  ('accounts_finance', 'finance.ledger.read'),
  ('accounts_finance', 'finance.expense.approve'),
  ('procurement_manager', 'procurement.request.create'),
  ('procurement_manager', 'procurement.po.create'),
  ('procurement_manager', 'procurement.grn.record'),
  ('partner_admin', 'user.read'),
  ('partner_admin', 'partner.org.manage'),
  ('partner_admin', 'partner.project.read'),
  ('partner_admin', 'partner.team.manage'),
  ('partner_admin', 'partner.task.assign'),
  ('partner_admin', 'partner.daily_report.submit'),
  ('partner_admin', 'partner.claim.submit'),
  ('partner_supervisor', 'partner.project.read'),
  ('partner_supervisor', 'partner.task.assign'),
  ('partner_supervisor', 'partner.daily_report.submit'),
  ('technician', 'task.execute'),
  ('qa_inspector', 'qa.inspection.decide'),
  ('qa_inspector', 'qa.defect.manage'),
  ('customer', 'customer.project.read'),
  ('customer', 'customer.approval.decide');


-- -----------------------------------------------------------------------------
-- Seed: launch defaults for configurable rules (Decision Register D-xxx).
-- Changes are made through public.set_business_rule (new version + audit).
-- -----------------------------------------------------------------------------
insert into public.business_rules (rule_key, version, value, audience, reason) values
  ('geo.city_codes', 1, '{"pune": "PUN", "pcmc": "PCM", "pimpri-chinchwad": "PCM"}', 'all_users', 'Launch geography: Pune and PCMC (D-001)'),
  ('gps.check_in', 1, '{"max_accuracy_m": 50}', 'all_users', 'Launch default; check-in GPS accuracy threshold (D-008)'),
  ('evidence.files', 1, '{"max_bytes": 15728640, "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]}', 'all_users', 'Launch default evidence file policy (D-012)'),
  ('lead.duplicate_detection', 1, '{"name_similarity": 0.6, "proximity_m": 150}', 'aiec_staff', 'Launch default duplicate thresholds (D-013)'),
  ('lead.scoring', 1, '{"max": 100, "rules": [
      {"key": "need", "when": "present", "points": 20},
      {"key": "decision_authority", "when": "equals", "value": "confirmed", "points": 20},
      {"key": "budget_readiness", "when": "equals", "value": "ready", "points": 20},
      {"key": "timeline", "when": "in", "value": ["within_3_months"], "points": 20},
      {"key": "site_readiness", "when": "in", "value": ["ready", "under_construction"], "points": 10},
      {"key": "number_of_lifts", "when": "present", "points": 10}
    ]}', 'aiec_staff', 'Launch default transparent lead score (D-014)'),
  ('survey.requirements', 1, '{
      "version": 1,
      "required_fields": ["building.usage", "building.floors", "building.stops", "building.construction_stage",
        "shaft.access_conditions", "machine_room.availability", "electrical.supply_type", "electrical.phase",
        "logistics.material_access_route", "logistics.safety_hazards"],
      "required_measurements": ["shaft_width", "shaft_depth", "pit_depth", "overhead", "entrance_width", "entrance_height"],
      "required_evidence": ["site_exterior", "shaft_full_view", "pit", "overhead", "landing_entrance", "electrical_supply_area", "access_route"],
      "required_documents": ["doc_architectural_drawing", "doc_structural_drawing", "doc_shaft_layout", "doc_electrical_drawing"]
    }', 'all_users', 'Launch default Gate 1 survey completeness set (D-009)');

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_org_kinds enable row level security;
alter table public.role_permissions enable row level security;
alter table public.organizations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;
alter table public.business_rules enable row level security;
alter table public.id_sequences enable row level security;
alter table public.sync_operations enable row level security;
alter table public.notifications enable row level security;

-- Catalogue: readable by any signed-in user.
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy roles_read on public.roles for select to authenticated using (true);
create policy role_org_kinds_read on public.role_org_kinds for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

-- Organizations: members see their own; AIEC user admins see all.
create policy organizations_read on public.organizations for select to authenticated using (
  app.is_member(id)
  or app.has_permission('user.read', app.aiec_org_id())
  or app.has_permission('org.manage', app.aiec_org_id())
);

-- Profiles: self; AIEC user.read sees all; partner admins (user.read held in a
-- partner org) see members of that org only.
create function app.can_read_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = auth.uid()
    or app.user_has_permission(auth.uid(), 'user.read', app.aiec_org_id())
    or exists (
      select 1 from public.organization_memberships target
      where target.user_id = p_user
        and app.user_has_permission(auth.uid(), 'user.read', target.organization_id)
    )
$$;

create policy user_profiles_read on public.user_profiles for select to authenticated using (app.can_read_profile(id));

create function app.can_read_org_people(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'user.read', app.aiec_org_id())
    or app.user_has_permission(auth.uid(), 'user.read', p_org)
$$;

create policy memberships_read on public.organization_memberships for select to authenticated using (
  user_id = (select auth.uid()) or app.can_read_org_people(organization_id)
);
create policy user_roles_read on public.user_roles for select to authenticated using (
  user_id = (select auth.uid()) or app.can_read_org_people(organization_id)
);

create policy audit_logs_read on public.audit_logs for select to authenticated using (
  app.has_permission('audit.read', app.aiec_org_id())
);

create policy business_rules_read on public.business_rules for select to authenticated using (
  (audience = 'all_users' and app.is_active_user((select auth.uid())))
  or app.is_member(app.aiec_org_id())
);

create policy sync_operations_read on public.sync_operations for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_read on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
-- id_sequences: no client access at all.

-- -----------------------------------------------------------------------------
-- Grants: clients read through RLS; they never write tables directly.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.permissions, public.roles, public.role_org_kinds, public.role_permissions,
  public.organizations, public.user_profiles, public.organization_memberships, public.user_roles,
  public.audit_logs, public.business_rules, public.sync_operations, public.notifications
  to authenticated;

revoke execute on all functions in schema app from public, anon, authenticated;
-- Helpers referenced by RLS policies run as the querying role.
grant execute on function
  app.current_user_id(), app.is_active_user(uuid), app.aiec_org_id(),
  app.user_has_permission(uuid, text, uuid), app.has_permission(text, uuid), app.is_member(uuid),
  app.can_read_profile(uuid), app.can_read_org_people(uuid), app.try_uuid(text)
  to authenticated;

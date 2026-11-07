-- =============================================================================
-- Slice 5 — partner execution (spec §12–§14, §36 OM03–OM06, §42–§43, Gates 7, 8, 9, 11)
-- Partner onboarding and compliance documents, verification, eligibility per project,
-- site readiness, invitations / assignments, project team, installation tasks with
-- safety pre-start, checklist and evidence, blockers / incidents (safety stops),
-- daily work reports, installation readiness. Transitions and rules are generated
-- from packages/domain (parity-tested).
-- =============================================================================

create type public.partner_state as enum ('draft', 'submitted', 'verification_pending', 'approved', 'conditional_approval', 'suspended', 'compliance_hold', 'rejected', 'inactive');
create type public.assignment_state as enum ('invited', 'clarification_requested', 'accepted', 'declined', 'withdrawn', 'ended');
create type public.task_state as enum ('draft', 'assigned', 'accepted', 'in_progress', 'blocked', 'submitted', 'approved', 'rework', 'closed');

insert into public.state_transitions (machine, from_state, action, to_state, permission_code, requires_reason, audit_event) values
  ('partner', 'draft', 'submit', 'submitted', 'partner.org.manage', false, 'partner.submitted'),
  ('partner', 'submitted', 'start_verification', 'verification_pending', 'partner.verify', false, 'partner.verification_started'),
  ('partner', 'verification_pending', 'approve', 'approved', 'partner.verify', false, 'partner.approved'),
  ('partner', 'verification_pending', 'approve_conditionally', 'conditional_approval', 'partner.verify', true, 'partner.conditionally_approved'),
  ('partner', 'verification_pending', 'return_for_correction', 'draft', 'partner.verify', true, 'partner.returned'),
  ('partner', 'verification_pending', 'reject', 'rejected', 'partner.verify', true, 'partner.rejected'),
  ('partner', 'approved', 'place_compliance_hold', 'compliance_hold', 'partner.verify', true, 'partner.compliance_hold'),
  ('partner', 'conditional_approval', 'place_compliance_hold', 'compliance_hold', 'partner.verify', true, 'partner.compliance_hold'),
  ('partner', 'compliance_hold', 'clear_compliance_hold', 'approved', 'partner.verify', false, 'partner.compliance_cleared'),
  ('partner', 'approved', 'suspend', 'suspended', 'approval.exception.decide', true, 'partner.suspended'),
  ('partner', 'conditional_approval', 'suspend', 'suspended', 'approval.exception.decide', true, 'partner.suspended'),
  ('partner', 'compliance_hold', 'suspend', 'suspended', 'approval.exception.decide', true, 'partner.suspended'),
  ('partner', 'suspended', 'reinstate', 'verification_pending', 'approval.exception.decide', true, 'partner.reinstated'),
  ('partner', 'approved', 'deactivate', 'inactive', 'approval.exception.decide', true, 'partner.deactivated'),
  ('partner', 'conditional_approval', 'deactivate', 'inactive', 'approval.exception.decide', true, 'partner.deactivated'),
  ('partner', 'suspended', 'deactivate', 'inactive', 'approval.exception.decide', true, 'partner.deactivated'),
  ('partner', 'compliance_hold', 'deactivate', 'inactive', 'approval.exception.decide', true, 'partner.deactivated'),
  ('partner_assignment', 'invited', 'accept', 'accepted', 'partner.org.manage', false, 'assignment.accepted'),
  ('partner_assignment', 'invited', 'decline', 'declined', 'partner.org.manage', true, 'assignment.declined'),
  ('partner_assignment', 'clarification_requested', 'decline', 'declined', 'partner.org.manage', true, 'assignment.declined'),
  ('partner_assignment', 'invited', 'request_clarification', 'clarification_requested', 'partner.org.manage', true, 'assignment.clarification_requested'),
  ('partner_assignment', 'clarification_requested', 'reissue', 'invited', 'partner.assign', true, 'assignment.reissued'),
  ('partner_assignment', 'invited', 'withdraw', 'withdrawn', 'partner.assign', true, 'assignment.withdrawn'),
  ('partner_assignment', 'clarification_requested', 'withdraw', 'withdrawn', 'partner.assign', true, 'assignment.withdrawn'),
  ('partner_assignment', 'accepted', 'end', 'ended', 'partner.assign', true, 'assignment.ended'),
  ('task', 'draft', 'assign', 'assigned', 'partner.task.assign', false, 'task.assigned'),
  ('task', 'assigned', 'accept', 'accepted', 'task.execute', false, 'task.accepted'),
  ('task', 'accepted', 'start', 'in_progress', 'task.execute', false, 'task.started'),
  ('task', 'in_progress', 'block', 'blocked', 'task.execute', true, 'task.blocked'),
  ('task', 'blocked', 'unblock', 'in_progress', 'partner.task.assign', true, 'task.unblocked'),
  ('task', 'in_progress', 'submit', 'submitted', 'task.execute', false, 'task.submitted'),
  ('task', 'submitted', 'qa_pass', 'approved', 'qa.inspection.decide', false, 'task.qa_passed'),
  ('task', 'submitted', 'qa_fail', 'rework', 'qa.inspection.decide', false, 'task.qa_failed'),
  ('task', 'rework', 'resubmit', 'submitted', 'task.execute', false, 'task.resubmitted'),
  ('task', 'approved', 'close', 'closed', 'project.plan', false, 'task.closed');

insert into public.business_rules (rule_key, version, value, audience, reason) values
  ('partner.document_requirements', 1, '{"documents":[{"type":"contractor_licence","scopeFromLiftCategory":true},{"type":"insurance"},{"type":"pan"},{"type":"bank_verification"}]}', 'all_users', 'Documents a partner needs before assignment; licence scope must cover the lift category (D-029)'),
  ('execution.task_template', 1, '{"tasks":[{"code":"mobilisation","skill":"general","prerequisites":[],"checklist":["materials_verified","tools_inspected","work_area_barricaded"],"evidence":["before"]},{"code":"rail_installation","skill":"mechanical","prerequisites":["mobilisation"],"checklist":["brackets_fixed","rails_aligned","alignment_recorded"],"evidence":["before","after"]},{"code":"machine_installation","skill":"mechanical","prerequisites":["rail_installation"],"checklist":["machine_mounted","ropes_installed","governor_installed"],"evidence":["after"]},{"code":"car_and_counterweight","skill":"mechanical","prerequisites":["machine_installation"],"checklist":["car_frame_assembled","counterweight_assembled","safety_gear_fitted"],"evidence":["after"]},{"code":"doors","skill":"mechanical","prerequisites":["rail_installation"],"checklist":["landing_doors_fitted","door_locks_fitted","car_door_fitted"],"evidence":["after"]},{"code":"electrical_wiring","skill":"electrical","prerequisites":["machine_installation"],"checklist":["controller_mounted","shaft_wiring_done","safety_circuit_checked","earthing_connected"],"evidence":["after"]},{"code":"pre_commissioning","skill":"testing","prerequisites":["car_and_counterweight","doors","electrical_wiring"],"checklist":["trial_runs_completed","safety_devices_tested","levelling_checked"],"evidence":["after"]}]}', 'all_users', 'Launch new-installation task list (D-030)'),
  ('execution.safety_checks', 1, '{"checks":[{"key":"ppe","critical":true},{"key":"work_at_height","critical":true},{"key":"electrical_isolation","critical":true},{"key":"shaft_access_control","critical":true},{"key":"barricading","critical":true},{"key":"emergency_access","critical":true},{"key":"tool_inspection","critical":false},{"key":"supervisor_briefing","critical":false}]}', 'all_users', 'Safety pre-start controls; critical controls block start (Gate 11)'),
  ('execution.site_readiness_items', 1, '{"items":[{"key":"access_route","group":"access"},{"key":"working_hours_agreed","group":"access"},{"key":"site_contact_confirmed","group":"access"},{"key":"shaft_dimensions_verified","group":"shaft_civil"},{"key":"pit_dry_and_finished","group":"shaft_civil"},{"key":"overhead_clear","group":"shaft_civil"},{"key":"power_supply_available","group":"electrical"},{"key":"earthing_available","group":"electrical"},{"key":"secure_storage","group":"storage"},{"key":"safe_access_and_barricading","group":"safe_access"},{"key":"approved_drawings_on_site","group":"drawings"},{"key":"customer_dependencies_met","group":"customer"},{"key":"stage_permits_checked","group":"permits"}]}', 'aiec_staff', 'Site readiness checklist (OM03, Gate 8)');

-- =============================================================================
-- Partner company profile (LP02) and compliance documents (LP03)
-- =============================================================================
create table public.partner_profiles (
  organization_id uuid primary key references public.organizations (id),
  status public.partner_state not null default 'draft',
  legal_name text,
  entity_type text check (entity_type is null or entity_type in ('proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'other')),
  registered_address text,
  operating_address text,
  authorized_representative text,
  contact_phone text,
  contact_email text,
  gst_number text,
  service_areas text[] not null default '{}',
  lift_categories text[] not null default '{}' check (lift_categories <@ array['passenger', 'goods', 'hospital', 'home']),
  team_size integer check (team_size is null or team_size > 0),
  experience_years integer check (experience_years is null or experience_years >= 0),
  safety_policy_accepted boolean not null default false,
  compliance_declaration boolean not null default false,
  status_reason text,
  submitted_at timestamptz,
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create trigger partner_profiles_touch before update on public.partner_profiles for each row execute function app.touch_row();

create table public.partner_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  doc_type text not null check (doc_type in ('contractor_licence', 'insurance', 'pan', 'gst_registration', 'bank_verification', 'safety_policy', 'certification')),
  doc_number text not null check (length(btrim(doc_number)) between 2 and 80),
  issuer text not null check (length(btrim(issuer)) between 2 and 200),
  issued_on date,
  expires_on date,
  scope text[] not null default '{}',
  storage_bucket text not null default 'partner-documents',
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  verification text not null default 'pending' check (verification in ('pending', 'verified', 'rejected')),
  verified_by uuid references public.user_profiles (id),
  verified_at timestamptz,
  rejection_reason text,
  uploaded_by uuid not null references public.user_profiles (id),
  uploaded_at timestamptz not null default now(),
  operation_id uuid not null unique,
  unique (storage_bucket, storage_path),
  check (expires_on is null or issued_on is null or expires_on >= issued_on),
  check ((verification = 'pending') = (verified_at is null)),
  check (verification <> 'rejected' or length(btrim(coalesce(rejection_reason, ''))) >= 3)
);
create index partner_documents_org_idx on public.partner_documents (organization_id, doc_type);

-- A document is a record: only its single verification decision may change it.
create function app.guard_partner_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'compliance documents cannot be deleted'));
  end if;
  if not (old.verification = 'pending' and new.verification in ('verified', 'rejected')
          and (to_jsonb(new) - 'verification' - 'verified_by' - 'verified_at' - 'rejection_reason')
            = (to_jsonb(old) - 'verification' - 'verified_by' - 'verified_at' - 'rejection_reason')) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'compliance documents are immutable once decided'));
  end if;
  return new;
end;
$$;
create trigger partner_documents_guard before update or delete on public.partner_documents
  for each row execute function app.guard_partner_document();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-documents', 'partner-documents', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Storage path convention: {partner_org_id}/documents/{operation_id}.{ext}
create function app.parse_partner_document_path(p_name text)
returns table (organization_id uuid, operation_id uuid, extension text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_file text[];
begin
  if array_length(v_parts, 1) <> 3 or v_parts[2] <> 'documents'
     or v_parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|webp)$' then
    return;
  end if;
  v_file := string_to_array(v_parts[3], '.');
  return query select app.try_uuid(v_parts[1]), app.try_uuid(v_file[1]), v_file[2];
end;
$$;

-- AIEC staff who verify, assign or oversee partners.
create function app.is_partner_overseer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'partner.verify', app.aiec_org_id())
      or app.user_has_permission(auth.uid(), 'partner.assign', app.aiec_org_id())
      or app.user_has_permission(auth.uid(), 'project.read_all', app.aiec_org_id())
$$;

create function app.can_read_partner_company(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_member(p_org) or app.is_partner_overseer()
$$;

-- Compliance documents: the partner's own admins and AIEC overseers (not technicians).
create function app.can_read_partner_documents(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'partner.org.manage', p_org) or app.is_partner_overseer()
$$;

create function app.can_upload_partner_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.parse_partner_document_path(p_name) p
    join public.organizations o on o.id = p.organization_id and o.kind = 'partner'
    where app.user_has_permission(auth.uid(), 'partner.org.manage', o.id))
$$;

create function app.can_read_partner_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.parse_partner_document_path(p_name) p where app.can_read_partner_documents(p.organization_id))
$$;

create policy partner_documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-documents' and app.can_upload_partner_document_object(name));
create policy partner_documents_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'partner-documents' and app.can_read_partner_document_object(name));

-- =============================================================================
-- Gate 7: eligibility (mirrors partnerEligibleForAssignment + requirementsForProject)
-- =============================================================================
create function app.partner_status(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select status::text from public.partner_profiles where organization_id = p_org), 'draft')
$$;

-- Pure evaluation (parity-tested): documents [{type, verification, expiresOn, scope}], requirements [{type, requiredScope?}].
create function app.evaluate_partner_compliance(p_documents jsonb, p_requirements jsonb, p_today date)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('type', req ->> 'type', 'reason', r.reason) order by o), '[]'::jsonb)
  from jsonb_array_elements(p_requirements) with ordinality x(req, o)
  cross join lateral (
    select case
      when exists (
        select 1 from jsonb_array_elements(p_documents) d
        where d ->> 'type' = req ->> 'type' and d ->> 'verification' = 'verified'
          and (d ->> 'expiresOn' is null or (d ->> 'expiresOn')::date >= p_today)
          and coalesce((select array_agg(s) from jsonb_array_elements_text(coalesce(req -> 'requiredScope', '[]'::jsonb)) s), '{}')
              <@ coalesce((select array_agg(s) from jsonb_array_elements_text(coalesce(d -> 'scope', '[]'::jsonb)) s), '{}')) then null
      when exists (select 1 from jsonb_array_elements(p_documents) d where d ->> 'type' = req ->> 'type' and d ->> 'verification' = 'verified'
                   and d ->> 'expiresOn' is not null and (d ->> 'expiresOn')::date < p_today) then 'expired'
      when exists (select 1 from jsonb_array_elements(p_documents) d where d ->> 'type' = req ->> 'type' and d ->> 'verification' = 'pending') then 'verification_pending'
      when exists (select 1 from jsonb_array_elements(p_documents) d where d ->> 'type' = req ->> 'type' and d ->> 'verification' = 'rejected') then 'rejected'
      when exists (select 1 from jsonb_array_elements(p_documents) d where d ->> 'type' = req ->> 'type') then 'scope_insufficient'
      else 'missing' end as reason
  ) r
  where r.reason is not null
$$;

-- Requirements for a lift category from rule partner.document_requirements.
create function app.partner_requirements(p_lift_category text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(case when coalesce((r ->> 'scopeFromLiftCategory')::boolean, false) and p_lift_category is not null
                                 then jsonb_build_object('type', r ->> 'type', 'requiredScope', jsonb_build_array(p_lift_category))
                                 else jsonb_build_object('type', r ->> 'type') end order by o), '[]'::jsonb)
  from jsonb_array_elements(app.rule('partner.document_requirements') -> 'documents') with ordinality x(r, o)
$$;

create function app.partner_eligibility(p_org uuid, p_lift_category text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with docs as (
    select coalesce(jsonb_agg(jsonb_build_object('type', d.doc_type, 'verification', d.verification, 'expiresOn', d.expires_on, 'scope', to_jsonb(d.scope))), '[]'::jsonb) as v
    from public.partner_documents d where d.organization_id = p_org
  ), f as (
    select app.evaluate_partner_compliance(docs.v, app.partner_requirements(p_lift_category), app.today_ist()) as failures from docs
  )
  select jsonb_build_object(
    'status', app.partner_status(p_org),
    'eligible', app.partner_status(p_org) in ('approved', 'conditional_approval') and jsonb_array_length(f.failures) = 0,
    'failures', f.failures)
  from f
$$;

create function app.project_lift_category(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.lift_category::text from public.projects p join public.configuration_revisions c on c.id = p.configuration_revision_id where p.id = p_project_id
$$;

-- =============================================================================
-- Partner RPCs
-- =============================================================================
create function app.require_partner_admin(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations where id = p_org and kind = 'partner') then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'partner'));
  end if;
  perform app.require_permission('partner.org.manage', p_org);
end;
$$;

create function app.partner_profile_json(p public.partner_profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('organization_id', p.organization_id, 'status', p.status, 'version', p.version)
$$;

-- LP02: the partner keeps its profile current while draft (or returned for correction).
create function public.save_partner_profile(p_org_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.partner_profiles;
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_areas text[] := app.text_array(v -> 'service_areas', 'service_areas');
  v_cats text[] := app.text_array(v -> 'lift_categories', 'lift_categories');
begin
  perform app.require_partner_admin(p_org_id);
  insert into public.partner_profiles (organization_id, updated_by) values (p_org_id, v_uid) on conflict (organization_id) do nothing;
  select * into v_p from public.partner_profiles where organization_id = p_org_id for update;
  if p_expected_version is not null then
    perform app.assert_version(p_expected_version, v_p.version);
  end if;
  if v_p.status <> 'draft' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_p.status, 'reason', 'the profile is locked while AIEC verifies or after approval'));
  end if;
  if v ? 'entity_type' and nullif(v ->> 'entity_type', '') is not null
     and (v ->> 'entity_type') not in ('proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'other') then
    perform app.j_field_error('entity_type');
  end if;
  if not (coalesce(v_cats, '{}') <@ array['passenger', 'goods', 'hospital', 'home']) then perform app.j_field_error('lift_categories'); end if;
  if nullif(v ->> 'team_size', '') is not null and (v ->> 'team_size') !~ '^[1-9][0-9]{0,4}$' then perform app.j_field_error('team_size'); end if;
  if nullif(v ->> 'experience_years', '') is not null and (v ->> 'experience_years') !~ '^[0-9]{1,3}$' then perform app.j_field_error('experience_years'); end if;
  update public.partner_profiles set
    legal_name = nullif(btrim(coalesce(v ->> 'legal_name', '')), ''),
    entity_type = nullif(v ->> 'entity_type', ''),
    registered_address = nullif(btrim(coalesce(v ->> 'registered_address', '')), ''),
    operating_address = nullif(btrim(coalesce(v ->> 'operating_address', '')), ''),
    authorized_representative = nullif(btrim(coalesce(v ->> 'authorized_representative', '')), ''),
    contact_phone = nullif(btrim(coalesce(v ->> 'contact_phone', '')), ''),
    contact_email = nullif(btrim(coalesce(v ->> 'contact_email', '')), ''),
    gst_number = nullif(upper(btrim(coalesce(v ->> 'gst_number', ''))), ''),
    service_areas = coalesce(v_areas, '{}'),
    lift_categories = coalesce(v_cats, '{}'),
    team_size = nullif(v ->> 'team_size', '')::integer,
    experience_years = nullif(v ->> 'experience_years', '')::integer,
    safety_policy_accepted = coalesce((v ->> 'safety_policy_accepted')::boolean, false),
    compliance_declaration = coalesce((v ->> 'compliance_declaration')::boolean, false),
    updated_by = v_uid
  where organization_id = p_org_id returning * into v_p;
  perform app.audit(p_org_id, 'partner_profile', p_org_id, 'partner.profile_saved', null,
    jsonb_build_object('legal_name', v_p.legal_name, 'lift_categories', v_p.lift_categories, 'service_areas', v_p.service_areas), null, 'partner.org.manage');
  return app.partner_profile_json(v_p);
end;
$$;

-- LP03: register an uploaded compliance document (pending AIEC verification).
create function public.register_partner_document(p_operation_id uuid, p_org_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_path text := v ->> 'storage_path';
  v_parsed record;
  v_object record;
  v_mime text := lower(coalesce(v ->> 'mime_type', ''));
  v_size bigint := app.jint(v, 'size_bytes');
  v_issued date := app.jdate(v, 'issued_on');
  v_expires date := app.jdate(v, 'expires_on');
  v_scope text[] := app.text_array(v -> 'scope', 'scope');
  v_d public.partner_documents;
  v_missing text[] := '{}';
begin
  perform app.require_partner_admin(p_org_id);
  v_replay := app.op_begin(p_operation_id, 'partner_document.register');
  if v_replay is not null then
    return v_replay;
  end if;
  if coalesce(v ->> 'doc_type', '') not in ('contractor_licence', 'insurance', 'pan', 'gst_registration', 'bank_verification', 'safety_policy', 'certification') then
    v_missing := v_missing || 'doc_type'::text;
  end if;
  if length(btrim(coalesce(v ->> 'doc_number', ''))) < 2 then v_missing := v_missing || 'doc_number'::text; end if;
  if length(btrim(coalesce(v ->> 'issuer', ''))) < 2 then v_missing := v_missing || 'issuer'::text; end if;
  if v ->> 'doc_type' in ('contractor_licence', 'insurance') and v_expires is null then v_missing := v_missing || 'expires_on'::text; end if;
  if v ->> 'doc_type' = 'contractor_licence' and coalesce(cardinality(v_scope), 0) = 0 then v_missing := v_missing || 'scope'::text; end if;
  if cardinality(v_missing) > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;
  if not (coalesce(v_scope, '{}') <@ array['passenger', 'goods', 'hospital', 'home']) then perform app.j_field_error('scope'); end if;
  if v_issued is not null and v_issued > app.today_ist() then perform app.j_field_error('issued_on'); end if;
  if v_expires is not null and v_issued is not null and v_expires < v_issued then perform app.j_field_error('expires_on'); end if;
  select * into v_parsed from app.parse_partner_document_path(v_path);
  if v_parsed.organization_id is null or v_parsed.organization_id <> p_org_id or v_parsed.operation_id <> p_operation_id then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('storage_path')));
  end if;
  select o.name, o.metadata into v_object from storage.objects o where o.bucket_id = 'partner-documents' and o.name = v_path;
  if v_object.name is null then
    perform app.raise_error('FILE_UPLOAD_FAILED', jsonb_build_object('reason', 'file not found in storage; upload first'));
  end if;
  if v_mime not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') then perform app.j_field_error('mime_type'); end if;
  if v_size is null or v_size <= 0 or v_size > 15728640 or (v_object.metadata ? 'size' and (v_object.metadata ->> 'size')::bigint <> v_size) then
    perform app.j_field_error('size_bytes');
  end if;
  if coalesce(v ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then perform app.j_field_error('sha256'); end if;
  insert into public.partner_documents (organization_id, doc_type, doc_number, issuer, issued_on, expires_on, scope, storage_path, sha256, mime_type, size_bytes, uploaded_by, operation_id)
  values (p_org_id, v ->> 'doc_type', btrim(v ->> 'doc_number'), btrim(v ->> 'issuer'), v_issued, v_expires, coalesce(v_scope, '{}'), v_path, v ->> 'sha256', v_mime, v_size, v_uid, p_operation_id)
  returning * into v_d;
  perform app.audit(p_org_id, 'partner_document', v_d.id, 'partner_document.registered', null,
    jsonb_build_object('doc_type', v_d.doc_type, 'expires_on', v_d.expires_on, 'scope', v_d.scope, 'sha256', v_d.sha256), null, 'partner.org.manage', p_operation_id);
  perform app.notify_permission_holders('partner.verify', app.aiec_org_id(), 'partner_document.registered', 'partner', p_org_id,
    'notification.partner_document_registered', jsonb_build_object('doc_type', v_d.doc_type), 'partner_document.registered:' || v_d.id);
  return app.op_finish(p_operation_id, v_d.id, jsonb_build_object('document_id', v_d.id, 'verification', v_d.verification));
end;
$$;

-- AIEC verifies or rejects one document (the uploader's organization never verifies itself).
create function public.verify_partner_document(p_document_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_d public.partner_documents;
begin
  select * into v_d from public.partner_documents where id = p_document_id for update;
  if not found or not app.can_read_partner_documents(v_d.organization_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'partner_document'));
  end if;
  perform app.require_permission('partner.verify', app.aiec_org_id());
  if v_d.verification <> 'pending' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_d.verification, 'allowedActions', '[]'::jsonb));
  end if;
  if p_decision not in ('verify', 'reject') then perform app.j_field_error('decision'); end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  update public.partner_documents set verification = case when p_decision = 'verify' then 'verified' else 'rejected' end,
         verified_by = v_uid, verified_at = now(), rejection_reason = case when p_decision = 'reject' then btrim(p_reason) end
   where id = p_document_id returning * into v_d;
  perform app.audit(v_d.organization_id, 'partner_document', v_d.id, 'partner_document.' || v_d.verification, jsonb_build_object('verification', 'pending'),
    jsonb_build_object('verification', v_d.verification, 'doc_type', v_d.doc_type), p_reason, 'partner.verify');
  perform app.notify_permission_holders('partner.org.manage', v_d.organization_id, 'partner_document.decided', 'partner', v_d.organization_id,
    'notification.partner_document_decided', jsonb_build_object('doc_type', v_d.doc_type, 'decision', v_d.verification), 'partner_document.decided:' || v_d.id);
  return jsonb_build_object('document_id', v_d.id, 'verification', v_d.verification);
end;
$$;

-- Partner lifecycle (partner machine). submit: partner admin; everything else: AIEC.
create function public.partner_action(p_org_id uuid, p_expected_version integer, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.partner_profiles;
  v_t public.state_transitions;
  v_missing text[] := '{}';
  v_failures jsonb;
begin
  if not exists (select 1 from public.organizations where id = p_org_id and kind = 'partner') or not app.can_read_partner_company(p_org_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'partner'));
  end if;
  insert into public.partner_profiles (organization_id, updated_by) values (p_org_id, v_uid) on conflict (organization_id) do nothing;
  select * into v_p from public.partner_profiles where organization_id = p_org_id for update;
  perform app.assert_version(p_expected_version, v_p.version);
  v_t := app.transition('partner', v_p.status::text, p_action, p_reason);
  perform app.require_permission(v_t.permission_code, case when v_t.permission_code = 'partner.org.manage' then p_org_id else app.aiec_org_id() end);
  if p_action = 'submit' then
    if v_p.legal_name is null or length(v_p.legal_name) < 2 then v_missing := v_missing || 'legal_name'::text; end if;
    if v_p.entity_type is null then v_missing := v_missing || 'entity_type'::text; end if;
    if v_p.registered_address is null or length(v_p.registered_address) < 2 then v_missing := v_missing || 'registered_address'::text; end if;
    if v_p.authorized_representative is null or length(v_p.authorized_representative) < 2 then v_missing := v_missing || 'authorized_representative'::text; end if;
    if v_p.contact_phone is null or length(v_p.contact_phone) < 2 then v_missing := v_missing || 'contact_phone'::text; end if;
    if cardinality(v_p.service_areas) = 0 then v_missing := v_missing || 'service_areas'::text; end if;
    if cardinality(v_p.lift_categories) = 0 then v_missing := v_missing || 'lift_categories'::text; end if;
    if v_p.team_size is null then v_missing := v_missing || 'team_size'::text; end if;
    if not v_p.safety_policy_accepted then v_missing := v_missing || 'safety_policy_accepted'::text; end if;
    if not v_p.compliance_declaration then v_missing := v_missing || 'compliance_declaration'::text; end if;
    if cardinality(v_missing) > 0 then
      perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
    end if;
  end if;
  if p_action in ('approve', 'clear_compliance_hold') then
    -- Full approval needs every required document verified and valid (no lift-category scope at company level).
    v_failures := (select app.evaluate_partner_compliance(
      coalesce((select jsonb_agg(jsonb_build_object('type', d.doc_type, 'verification', d.verification, 'expiresOn', d.expires_on, 'scope', to_jsonb(d.scope)))
                from public.partner_documents d where d.organization_id = p_org_id), '[]'::jsonb),
      app.partner_requirements(null), app.today_ist()));
    if jsonb_array_length(v_failures) > 0 then
      perform app.raise_error('PARTNER_COMPLIANCE_BLOCK', jsonb_build_object('missing', (select jsonb_agg(f ->> 'type') from jsonb_array_elements(v_failures) f), 'failures', v_failures));
    end if;
  end if;
  update public.partner_profiles set status = v_t.to_state::public.partner_state,
         status_reason = case when v_t.requires_reason then btrim(p_reason) else status_reason end,
         submitted_at = case when p_action = 'submit' then now() else submitted_at end,
         decided_by = case when p_action = 'submit' then decided_by else v_uid end,
         decided_at = case when p_action = 'submit' then decided_at else now() end,
         updated_by = v_uid
   where organization_id = p_org_id returning * into v_p;
  perform app.audit(p_org_id, 'partner_profile', p_org_id, v_t.audit_event, jsonb_build_object('status', v_t.from_state),
    jsonb_build_object('status', v_p.status), p_reason, v_t.permission_code);
  if p_action = 'submit' then
    perform app.notify_permission_holders('partner.verify', app.aiec_org_id(), 'partner.submitted', 'partner', p_org_id,
      'notification.partner_submitted', jsonb_build_object('name', (select name from public.organizations where id = p_org_id)), 'partner.submitted:' || p_org_id || ':' || v_p.version);
  else
    perform app.notify_permission_holders('partner.org.manage', p_org_id, 'partner.status_changed', 'partner', p_org_id,
      'notification.partner_status_changed', jsonb_build_object('status', v_p.status), 'partner.status:' || p_org_id || ':' || v_p.version);
  end if;
  return app.partner_profile_json(v_p);
end;
$$;

-- Read model for pickers and the partner list: status + eligibility for a lift category.
create function public.partner_eligibility(p_org_id uuid, p_lift_category text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations where id = p_org_id and kind = 'partner') or not app.can_read_partner_company(p_org_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'partner'));
  end if;
  if p_lift_category is not null and p_lift_category not in ('passenger', 'goods', 'hospital', 'home') then perform app.j_field_error('lift_category'); end if;
  return app.partner_eligibility(p_org_id, p_lift_category);
end;
$$;

-- =============================================================================
-- Gate 8: site readiness checklist (OM03), append-only revisions
-- =============================================================================
create table public.site_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  revision_no integer not null check (revision_no > 0),
  items jsonb not null,
  passed boolean not null,
  failures jsonb not null default '[]'::jsonb,
  recorded_by uuid not null references public.user_profiles (id),
  recorded_at timestamptz not null default now(),
  unique (project_id, revision_no)
);
create trigger site_readiness_checks_immutable before update or delete on public.site_readiness_checks for each row execute function app.forbid_mutation();

-- Mirrors evaluateSiteReadiness: every catalogue item answered; fail / awaiting evidence / unexplained N/A fail the gate.
create function app.evaluate_site_readiness(p_items jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with catalogue as (
    select c ->> 'key' as key, o from jsonb_array_elements(app.rule('execution.site_readiness_items') -> 'items') with ordinality x(c, o)
  ), answers as (
    select a ->> 'key' as key, a ->> 'result' as result, a ->> 'note' as note, o from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(a, o)
  ), f as (
    select 1 as grp, c.o, jsonb_build_object('code', 'REQUIRED_FIELD_MISSING', 'key', c.key) as failure from catalogue c where not exists (select 1 from answers a where a.key = c.key)
    union all
    select 2, a.o, case
      when a.result = 'not_applicable' and length(btrim(coalesce(a.note, ''))) < 3 then jsonb_build_object('code', 'REQUIRED_FIELD_MISSING', 'key', a.key)
      when a.result = 'fail' then jsonb_build_object('code', 'SITE_NOT_READY', 'key', a.key)
      when a.result = 'awaiting_evidence' then jsonb_build_object('code', 'EVIDENCE_REQUIRED', 'key', a.key) end
    from answers a
  )
  select jsonb_build_object('passed', not exists (select 1 from f where failure is not null),
    'failures', coalesce((select jsonb_agg(failure order by grp, o) from f where failure is not null), '[]'::jsonb))
$$;

create function public.record_site_readiness(p_project_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v_eval jsonb;
  v_c public.site_readiness_checks;
  v_item jsonb;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  if v_p.status not in ('planning', 'installation_ready') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_p.status, 'reason', 'site readiness is recorded during planning'));
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then perform app.j_field_error('items'); end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(v_item ->> 'result', '') not in ('pass', 'fail', 'not_applicable', 'awaiting_evidence')
       or not exists (select 1 from jsonb_array_elements(app.rule('execution.site_readiness_items') -> 'items') c where c ->> 'key' = v_item ->> 'key') then
      perform app.j_field_error(coalesce(v_item ->> 'key', 'items'));
    end if;
  end loop;
  v_eval := app.evaluate_site_readiness(p_items);
  insert into public.site_readiness_checks (project_id, revision_no, items, passed, failures, recorded_by)
  values (p_project_id, coalesce((select max(revision_no) from public.site_readiness_checks where project_id = p_project_id), 0) + 1,
          p_items, (v_eval ->> 'passed')::boolean, v_eval -> 'failures', v_uid)
  returning * into v_c;
  perform app.audit(v_p.organization_id, 'project', v_p.id, 'site_readiness.recorded', null,
    jsonb_build_object('revision_no', v_c.revision_no, 'passed', v_c.passed, 'failures', v_c.failures), null, 'project.plan', null, v_p.id);
  return jsonb_build_object('site_readiness_id', v_c.id, 'revision_no', v_c.revision_no, 'passed', v_c.passed, 'failures', v_c.failures);
end;
$$;

-- =============================================================================
-- Project invitation / assignment (LP04, OM04)
-- =============================================================================
create table public.project_partner_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  partner_org_id uuid not null references public.organizations (id),
  status public.assignment_state not null default 'invited',
  scope_summary text not null check (length(btrim(scope_summary)) >= 3),
  schedule_from date not null,
  schedule_to date not null,
  contract_value_paise bigint not null check (contract_value_paise >= 0),
  payment_terms text not null check (length(btrim(payment_terms)) >= 3),
  material_responsibility text not null check (length(btrim(material_responsibility)) >= 3),
  safety_requirements text not null check (length(btrim(safety_requirements)) >= 3),
  exclusions text,
  offer_sha256 text not null check (offer_sha256 ~ '^[0-9a-f]{64}$'),
  response_reason text,
  responded_by uuid references public.user_profiles (id),
  responded_at timestamptz,
  invited_by uuid not null references public.user_profiles (id),
  invited_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check (schedule_to >= schedule_from)
);
create unique index project_partner_assignments_one_open on public.project_partner_assignments (project_id) where status in ('invited', 'clarification_requested', 'accepted');
create trigger project_partner_assignments_touch before update on public.project_partner_assignments for each row execute function app.touch_row();

-- Content hash of what the partner sees (acceptance acknowledges this exact revision, LP04).
create function app.assignment_offer_sha(p_project uuid, p_partner uuid, p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'project_id', p_project, 'partner_org_id', p_partner,
    'scope_summary', btrim(p_payload ->> 'scope_summary'), 'schedule_from', p_payload ->> 'schedule_from', 'schedule_to', p_payload ->> 'schedule_to',
    'contract_value_paise', p_payload ->> 'contract_value_paise', 'payment_terms', btrim(p_payload ->> 'payment_terms'),
    'material_responsibility', btrim(p_payload ->> 'material_responsibility'), 'safety_requirements', btrim(p_payload ->> 'safety_requirements'),
    'exclusions', nullif(btrim(coalesce(p_payload ->> 'exclusions', '')), ''))::text, 'UTF8'), 'sha256'), 'hex')
$$;

create table public.project_team_members (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.project_partner_assignments (id),
  user_id uuid not null references public.user_profiles (id),
  added_by uuid not null references public.user_profiles (id),
  added_at timestamptz not null default now(),
  removed_by uuid references public.user_profiles (id),
  removed_at timestamptz,
  removal_reason text
);
create unique index project_team_members_active on public.project_team_members (assignment_id, user_id) where removed_at is null;

create table public.partner_workers (
  user_id uuid primary key references public.user_profiles (id),
  organization_id uuid not null references public.organizations (id),
  skills text[] not null default '{}' check (skills <@ array['general', 'mechanical', 'electrical', 'testing']),
  training_note text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create trigger partner_workers_touch before update on public.partner_workers for each row execute function app.touch_row();

create function app.assignment_json(a public.project_partner_assignments)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('assignment_id', a.id, 'project_id', a.project_id, 'partner_org_id', a.partner_org_id, 'status', a.status,
    'offer_sha256', a.offer_sha256, 'version', a.version)
$$;

-- OM04: invite only an eligible partner (Gate 7 for the project's lift category).
create function public.invite_partner(p_project_id uuid, p_partner_org_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_from date := app.jdate(v, 'schedule_from');
  v_to date := app.jdate(v, 'schedule_to');
  v_elig jsonb;
  v_a public.project_partner_assignments;
  v_missing text[] := '{}';
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  perform app.require_permission('partner.assign', v_p.organization_id);
  if v_p.status not in ('planning', 'installation_ready') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_p.status, 'reason', 'partners are invited during planning'));
  end if;
  if not exists (select 1 from public.organizations where id = p_partner_org_id and kind = 'partner' and status = 'active') then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'partner'));
  end if;
  if exists (select 1 from public.project_partner_assignments where project_id = p_project_id and status in ('invited', 'clarification_requested', 'accepted')) then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'this project already has an open invitation or an accepted partner'));
  end if;
  v_elig := app.partner_eligibility(p_partner_org_id, app.project_lift_category(p_project_id));
  if not (v_elig ->> 'eligible')::boolean then
    perform app.raise_error('PARTNER_COMPLIANCE_BLOCK', jsonb_build_object('status', v_elig ->> 'status', 'failures', v_elig -> 'failures',
      'missing', coalesce((select jsonb_agg(f ->> 'type') from jsonb_array_elements(v_elig -> 'failures') f), '[]'::jsonb)));
  end if;
  if length(btrim(coalesce(v ->> 'scope_summary', ''))) < 3 then v_missing := v_missing || 'scope_summary'::text; end if;
  if v_from is null then v_missing := v_missing || 'schedule_from'::text; end if;
  if v_to is null then v_missing := v_missing || 'schedule_to'::text; end if;
  if length(btrim(coalesce(v ->> 'payment_terms', ''))) < 3 then v_missing := v_missing || 'payment_terms'::text; end if;
  if length(btrim(coalesce(v ->> 'material_responsibility', ''))) < 3 then v_missing := v_missing || 'material_responsibility'::text; end if;
  if length(btrim(coalesce(v ->> 'safety_requirements', ''))) < 3 then v_missing := v_missing || 'safety_requirements'::text; end if;
  if cardinality(v_missing) > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;
  if coalesce(v ->> 'contract_value_paise', '') !~ '^[0-9]{1,14}$' then perform app.j_field_error('contract_value_paise'); end if;
  if v_from < app.today_ist() then perform app.j_field_error('schedule_from'); end if;
  if v_to < v_from then perform app.j_field_error('schedule_to'); end if;
  insert into public.project_partner_assignments (project_id, partner_org_id, scope_summary, schedule_from, schedule_to, contract_value_paise, payment_terms,
    material_responsibility, safety_requirements, exclusions, offer_sha256, invited_by, updated_by)
  values (p_project_id, p_partner_org_id, btrim(v ->> 'scope_summary'), v_from, v_to, (v ->> 'contract_value_paise')::bigint, btrim(v ->> 'payment_terms'),
    btrim(v ->> 'material_responsibility'), btrim(v ->> 'safety_requirements'), nullif(btrim(coalesce(v ->> 'exclusions', '')), ''),
    app.assignment_offer_sha(p_project_id, p_partner_org_id, v), v_uid, v_uid)
  returning * into v_a;
  perform app.audit(v_p.organization_id, 'partner_assignment', v_a.id, 'assignment.invited', null,
    jsonb_build_object('partner_org_id', p_partner_org_id, 'offer_sha256', v_a.offer_sha256, 'contract_value_paise', v_a.contract_value_paise::text,
      'eligibility', v_elig), null, 'partner.assign', null, v_p.id);
  perform app.notify_permission_holders('partner.org.manage', p_partner_org_id, 'assignment.invited', 'partner_assignment', v_a.id,
    'notification.assignment_invited', jsonb_build_object('project_number', v_p.project_number), 'assignment.invited:' || v_a.id);
  return app.assignment_json(v_a);
end;
$$;

-- LP04: the partner accepts the displayed revision (hash), declines or asks for clarification.
-- AIEC re-issues after clarification, withdraws an open invitation or ends an accepted one.
create function public.assignment_action(p_assignment_id uuid, p_expected_version integer, p_action text, p_reason text default null, p_offer_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_a public.project_partner_assignments;
  v_p public.projects;
  v_t public.state_transitions;
  v_elig jsonb;
  v_tpl jsonb;
begin
  select * into v_a from public.project_partner_assignments where id = p_assignment_id for update;
  if not found or not app.can_read_assignment(v_a.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'partner_assignment'));
  end if;
  select * into v_p from public.projects where id = v_a.project_id;
  perform app.assert_version(p_expected_version, v_a.version);
  v_t := app.transition('partner_assignment', v_a.status::text, p_action, p_reason);
  perform app.require_permission(v_t.permission_code, case when v_t.permission_code = 'partner.org.manage' then v_a.partner_org_id else v_p.organization_id end);
  if p_action in ('accept', 'reissue') then
    -- Gate 7 again at the moment of the action: documents may have expired since the invitation.
    v_elig := app.partner_eligibility(v_a.partner_org_id, app.project_lift_category(v_a.project_id));
    if not (v_elig ->> 'eligible')::boolean then
      perform app.raise_error('PARTNER_COMPLIANCE_BLOCK', jsonb_build_object('status', v_elig ->> 'status', 'failures', v_elig -> 'failures',
        'missing', coalesce((select jsonb_agg(f ->> 'type') from jsonb_array_elements(v_elig -> 'failures') f), '[]'::jsonb)));
    end if;
  end if;
  if p_action = 'accept' and (p_offer_sha256 is null or p_offer_sha256 <> v_a.offer_sha256) then
    perform app.raise_error('STALE_VERSION', jsonb_build_object('reason', 'the invitation changed; review the current revision before accepting'));
  end if;
  update public.project_partner_assignments set status = v_t.to_state::public.assignment_state,
         response_reason = case when v_t.requires_reason then btrim(p_reason) else response_reason end,
         responded_by = case when v_t.permission_code = 'partner.org.manage' then v_uid else responded_by end,
         responded_at = case when v_t.permission_code = 'partner.org.manage' then now() else responded_at end,
         updated_by = v_uid
   where id = v_a.id returning * into v_a;
  if p_action = 'accept' then
    -- The new-installation task list for this project (rule execution.task_template).
    v_tpl := app.rule('execution.task_template') -> 'tasks';
    insert into public.project_tasks (project_id, assignment_id, sequence, code, skill, prerequisites, checklist, evidence_required, updated_by)
    select v_a.project_id, v_a.id, o, t ->> 'code', t ->> 'skill',
           array(select jsonb_array_elements_text(t -> 'prerequisites')), array(select jsonb_array_elements_text(t -> 'checklist')),
           array(select jsonb_array_elements_text(t -> 'evidence')), v_uid
    from jsonb_array_elements(v_tpl) with ordinality x(t, o)
    on conflict (project_id, code) do update set assignment_id = excluded.assignment_id
      where public.project_tasks.status = 'draft';
  end if;
  perform app.audit(v_p.organization_id, 'partner_assignment', v_a.id, v_t.audit_event, jsonb_build_object('status', v_t.from_state),
    jsonb_build_object('status', v_a.status, 'offer_sha256', v_a.offer_sha256), p_reason, v_t.permission_code, null, v_p.id);
  if v_t.permission_code = 'partner.org.manage' then
    perform app.notify_permission_holders('partner.assign', v_p.organization_id, 'assignment.responded', 'project', v_p.id,
      'notification.assignment_responded', jsonb_build_object('project_number', v_p.project_number, 'status', v_a.status), 'assignment.responded:' || v_a.id || ':' || v_a.version);
  else
    perform app.notify_permission_holders('partner.org.manage', v_a.partner_org_id, 'assignment.updated', 'partner_assignment', v_a.id,
      'notification.assignment_updated', jsonb_build_object('project_number', v_p.project_number, 'status', v_a.status), 'assignment.updated:' || v_a.id || ':' || v_a.version);
  end if;
  return app.assignment_json(v_a);
end;
$$;

-- LP06 / LP07: skills of a worker in the partner's own organization.
create function public.set_worker_profile(p_org_id uuid, p_user_id uuid, p_skills jsonb, p_training_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_skills text[] := app.text_array(p_skills, 'skills');
  v_w public.partner_workers;
begin
  perform app.require_partner_admin(p_org_id);
  perform app.require_permission('partner.team.manage', p_org_id);
  if not exists (select 1 from public.organization_memberships m where m.organization_id = p_org_id and m.user_id = p_user_id and m.status = 'active')
     or not (app.user_has_permission(p_user_id, 'task.execute', p_org_id) or app.user_has_permission(p_user_id, 'partner.task.assign', p_org_id)) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('user_id'), 'reason', 'not an active field member of this partner'));
  end if;
  if not (v_skills <@ array['general', 'mechanical', 'electrical', 'testing']) then perform app.j_field_error('skills'); end if;
  insert into public.partner_workers (user_id, organization_id, skills, training_note, updated_by)
  values (p_user_id, p_org_id, v_skills, nullif(btrim(coalesce(p_training_note, '')), ''), v_uid)
  on conflict (user_id) do update set skills = excluded.skills, training_note = excluded.training_note, updated_by = v_uid
    where public.partner_workers.organization_id = p_org_id
  returning * into v_w;
  if v_w.user_id is null then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('user_id')));
  end if;
  perform app.audit(p_org_id, 'partner_worker', p_user_id, 'worker.skills_set', null, jsonb_build_object('skills', v_w.skills), null, 'partner.team.manage');
  return jsonb_build_object('user_id', v_w.user_id, 'skills', v_w.skills, 'version', v_w.version);
end;
$$;

-- Project team: who of the partner's people work on this project (history kept on removal).
create function public.set_project_team_member(p_assignment_id uuid, p_user_id uuid, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_a public.project_partner_assignments;
  v_m public.project_team_members;
begin
  select * into v_a from public.project_partner_assignments where id = p_assignment_id;
  if not found or not app.can_read_assignment(v_a.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'partner_assignment'));
  end if;
  perform app.require_permission('partner.team.manage', v_a.partner_org_id);
  if v_a.status <> 'accepted' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_a.status, 'reason', 'only an accepted assignment has a team'));
  end if;
  if p_action = 'add' then
    if not exists (select 1 from public.organization_memberships m join public.user_profiles up on up.id = m.user_id and up.status = 'active'
                   where m.organization_id = v_a.partner_org_id and m.user_id = p_user_id and m.status = 'active')
       or not (app.user_has_permission(p_user_id, 'task.execute', v_a.partner_org_id) or app.user_has_permission(p_user_id, 'partner.task.assign', v_a.partner_org_id)) then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('user_id'), 'reason', 'not an active field member of this partner'));
    end if;
    insert into public.project_team_members (assignment_id, user_id, added_by) values (v_a.id, p_user_id, v_uid)
    on conflict do nothing returning * into v_m;
  elsif p_action = 'remove' then
    if length(btrim(coalesce(p_reason, ''))) < 3 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason'))); end if;
    if exists (select 1 from public.project_tasks t where t.assignment_id = v_a.id and t.assignee_user_id = p_user_id and t.status in ('assigned', 'accepted', 'in_progress', 'blocked', 'rework')) then
      perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'reassign this person''s open tasks first'));
    end if;
    update public.project_team_members set removed_by = v_uid, removed_at = now(), removal_reason = btrim(p_reason)
     where assignment_id = v_a.id and user_id = p_user_id and removed_at is null returning * into v_m;
  else
    perform app.j_field_error('action');
  end if;
  perform app.audit(v_a.partner_org_id, 'partner_assignment', v_a.id, 'team.member_' || case when p_action = 'add' then 'added' else 'removed' end, null,
    jsonb_build_object('user_id', p_user_id), p_reason, 'partner.team.manage', null, v_a.project_id);
  return jsonb_build_object('assignment_id', v_a.id, 'user_id', p_user_id, 'active', p_action = 'add');
end;
$$;

-- =============================================================================
-- Installation tasks (LP07, WT02–WT06, Gates 9 and 11)
-- =============================================================================
create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  assignment_id uuid not null references public.project_partner_assignments (id),
  sequence integer not null check (sequence > 0),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,60}$'),
  skill text not null check (skill in ('general', 'mechanical', 'electrical', 'testing')),
  prerequisites text[] not null default '{}',
  checklist text[] not null check (cardinality(checklist) > 0),
  evidence_required text[] not null default '{}',
  status public.task_state not null default 'draft',
  assignee_user_id uuid references public.user_profiles (id),
  assigned_by uuid references public.user_profiles (id),
  assigned_at timestamptz,
  due_date date,
  checklist_answers jsonb not null default '{}'::jsonb,
  notes text,
  safety_stop boolean not null default false,
  started_at timestamptz,
  submitted_at timestamptz,
  submitted_by uuid references public.user_profiles (id),
  block_category text,
  block_reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (project_id, code),
  check (status = 'draft' or assignee_user_id is not null)
);
create trigger project_tasks_touch before update on public.project_tasks for each row execute function app.touch_row();

create table public.task_safety_checks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks (id),
  answers jsonb not null,
  can_start boolean not null,
  critical_failures text[] not null default '{}',
  warnings text[] not null default '{}',
  recorded_by uuid not null references public.user_profiles (id),
  recorded_at timestamptz not null default now(),
  operation_id uuid not null unique
);
create trigger task_safety_checks_immutable before update or delete on public.task_safety_checks for each row execute function app.forbid_mutation();

create table public.task_evidence (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks (id),
  partner_org_id uuid not null references public.organizations (id),
  category text not null check (category in ('before', 'in_progress', 'after', 'correction')),
  storage_bucket text not null default 'execution-evidence',
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  source text not null check (source in ('in_app_camera', 'document_import')),
  captured_by uuid not null references public.user_profiles (id),
  captured_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  capture_location extensions.geography(Point, 4326),
  capture_accuracy_m numeric(10, 1),
  remarks text,
  operation_id uuid not null unique,
  unique (storage_bucket, storage_path)
);
create trigger task_evidence_immutable before update or delete on public.task_evidence for each row execute function app.forbid_mutation();

create table public.execution_incidents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  task_id uuid references public.project_tasks (id),
  partner_org_id uuid not null references public.organizations (id),
  category text not null check (category in ('material_missing', 'site_inaccessible', 'drawing_unclear', 'unsafe_condition', 'equipment_issue', 'customer_dependency', 'injury_incident', 'other')),
  description text not null check (length(btrim(description)) >= 3),
  safety_stop boolean not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  reported_by uuid not null references public.user_profiles (id),
  reported_at timestamptz not null default now(),
  client_reported_at timestamptz,
  resolved_by uuid references public.user_profiles (id),
  resolved_at timestamptz,
  resolution text,
  operation_id uuid not null unique,
  check ((status = 'resolved') = (resolved_at is not null)),
  check (status = 'open' or length(btrim(coalesce(resolution, ''))) >= 3)
);

create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  assignment_id uuid not null references public.project_partner_assignments (id),
  partner_org_id uuid not null references public.organizations (id),
  report_date date not null,
  present_user_ids uuid[] not null check (cardinality(present_user_ids) > 0),
  work_completed text not null check (length(btrim(work_completed)) >= 3),
  work_not_completed text,
  material_used text,
  material_shortage text,
  blockers text,
  incident_declared boolean not null,
  safety_observations text,
  next_day_plan text not null check (length(btrim(next_day_plan)) >= 3),
  submitted_by uuid not null references public.user_profiles (id),
  submitted_at timestamptz not null default now(),
  operation_id uuid not null unique,
  unique (assignment_id, report_date),
  check (not incident_declared or length(btrim(coalesce(safety_observations, ''))) >= 3)
);
create trigger daily_reports_immutable before update or delete on public.daily_reports for each row execute function app.forbid_mutation();

create table public.daily_report_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.daily_reports (id),
  comment text not null check (length(btrim(comment)) between 3 and 2000),
  author_id uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now()
);
create trigger daily_report_comments_immutable before update or delete on public.daily_report_comments for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Read rules
-- -----------------------------------------------------------------------------
-- AIEC people who run projects (not Sales: partner commercial terms are internal).
create function app.is_execution_manager(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'project.read_all', p_org)
      or app.user_has_permission(auth.uid(), 'project.plan', p_org)
      or app.user_has_permission(auth.uid(), 'partner.assign', p_org)
$$;

create function app.can_read_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select app.is_execution_manager(p.organization_id)
        or app.user_has_permission(auth.uid(), 'finance.ledger.read', p.organization_id)
        or app.user_has_permission(auth.uid(), 'partner.project.read', a.partner_org_id)
    from public.project_partner_assignments a join public.projects p on p.id = a.project_id
    where a.id = p_assignment_id), false)
$$;

-- Tasks: AIEC execution managers, the partner's admins / supervisors, and the assignee.
create function app.can_read_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select t.assignee_user_id = auth.uid()
        or app.is_execution_manager(p.organization_id)
        or app.user_has_permission(auth.uid(), 'partner.project.read', a.partner_org_id)
    from public.project_tasks t
    join public.project_partner_assignments a on a.id = t.assignment_id
    join public.projects p on p.id = t.project_id
    where t.id = p_task_id), false)
$$;

-- Partner people see a project they are invited to / work on (title, site, status — no money).
create or replace function app.can_read_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select app.user_has_permission(auth.uid(), 'project.read_all', p.organization_id)
        or app.user_has_permission(auth.uid(), 'technical.review', p.organization_id)
        or app.user_has_permission(auth.uid(), 'finance.ledger.read', p.organization_id)
        or app.is_procurement(p.organization_id)
        or app.can_read_lead(p.lead_id)
        or exists (select 1 from public.project_partner_assignments a
                   where a.project_id = p.id and a.status in ('invited', 'clarification_requested', 'accepted')
                     and app.user_has_permission(auth.uid(), 'partner.project.read', a.partner_org_id))
        or exists (select 1 from public.project_team_members m join public.project_partner_assignments a on a.id = m.assignment_id
                   where a.project_id = p.id and a.status = 'accepted' and m.user_id = auth.uid() and m.removed_at is null)
    from public.projects p where p.id = p_project_id), false)
$$;

-- Execution evidence bucket: {partner_org_id}/tasks/{task_id}/{operation_id}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('execution-evidence', 'execution-evidence', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create function app.parse_task_evidence_path(p_name text)
returns table (organization_id uuid, task_id uuid, operation_id uuid, extension text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_file text[];
begin
  if array_length(v_parts, 1) <> 4 or v_parts[2] <> 'tasks'
     or v_parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic)$' then
    return;
  end if;
  v_file := string_to_array(v_parts[4], '.');
  return query select app.try_uuid(v_parts[1]), app.try_uuid(v_parts[3]), app.try_uuid(v_file[1]), v_file[2];
end;
$$;

-- Only the assignee uploads, while the task is being worked on.
create function app.can_upload_task_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.parse_task_evidence_path(p_name) x
    join public.project_tasks t on t.id = x.task_id
    join public.project_partner_assignments a on a.id = t.assignment_id and a.partner_org_id = x.organization_id
    where t.assignee_user_id = auth.uid() and t.status in ('in_progress', 'rework')
      and app.user_has_permission(auth.uid(), 'task.execute', a.partner_org_id))
$$;

create function app.can_read_task_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.parse_task_evidence_path(p_name) x where app.can_read_task(x.task_id))
$$;

create policy execution_evidence_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'execution-evidence' and app.can_upload_task_evidence_object(name));
create policy execution_evidence_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'execution-evidence' and app.can_read_task_evidence_object(name));

-- -----------------------------------------------------------------------------
-- Task RPCs
-- -----------------------------------------------------------------------------
create function app.task_json(t public.project_tasks)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('task_id', t.id, 'code', t.code, 'status', t.status, 'assignee_user_id', t.assignee_user_id,
    'safety_stop', t.safety_stop, 'version', t.version)
$$;

create function app.lock_task(p_task_id uuid)
returns public.project_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.project_tasks;
begin
  select * into v from public.project_tasks where id = p_task_id for update;
  if not found or not app.can_read_task(p_task_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'task'));
  end if;
  return v;
end;
$$;

create function app.task_partner(p_task public.project_tasks)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select partner_org_id from public.project_partner_assignments where id = p_task.assignment_id
$$;

create function app.require_assignee(p_task public.project_tasks)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_task.assignee_user_id is distinct from auth.uid() then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'only the assigned person works on this task'));
  end if;
  perform app.require_permission('task.execute', app.task_partner(p_task));
end;
$$;

-- LP07: assign (or reassign before acceptance) to an active project-team member with the task's skill.
create function public.assign_task(p_task_id uuid, p_expected_version integer, p_assignee_id uuid, p_due_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_t public.project_tasks := app.lock_task(p_task_id);
  v_a public.project_partner_assignments;
  v_tr public.state_transitions;
  v_from text := v_t.status::text;
begin
  select * into v_a from public.project_partner_assignments where id = v_t.assignment_id;
  perform app.require_permission('partner.task.assign', v_a.partner_org_id);
  perform app.assert_version(p_expected_version, v_t.version);
  if v_a.status <> 'accepted' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_a.status, 'reason', 'the assignment is not active'));
  end if;
  if v_t.status not in ('draft', 'assigned') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_t.status, 'allowedActions', '[]'::jsonb));
  end if;
  if not exists (select 1 from public.project_team_members m where m.assignment_id = v_a.id and m.user_id = p_assignee_id and m.removed_at is null)
     or not app.user_has_permission(p_assignee_id, 'task.execute', v_a.partner_org_id) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('task_assignee_id'), 'reason', 'not an active technician of this project team'));
  end if;
  if not exists (select 1 from public.partner_workers w where w.user_id = p_assignee_id and w.organization_id = v_a.partner_org_id and v_t.skill = any (w.skills)) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('task_assignee_id'), 'reason', 'the person does not have the required skill', 'skill', v_t.skill));
  end if;
  if p_due_date is not null and p_due_date < app.today_ist() then perform app.j_field_error('due_date'); end if;
  if v_t.status = 'draft' then
    v_tr := app.transition('task', 'draft', 'assign');
  end if;
  update public.project_tasks set status = 'assigned', assignee_user_id = p_assignee_id, assigned_by = v_uid, assigned_at = now(),
         due_date = coalesce(p_due_date, due_date), updated_by = v_uid
   where id = v_t.id returning * into v_t;
  perform app.audit(v_a.partner_org_id, 'task', v_t.id, case when v_from = 'draft' then 'task.assigned' else 'task.reassigned' end,
    jsonb_build_object('status', v_from), jsonb_build_object('assignee_user_id', p_assignee_id, 'due_date', v_t.due_date), null, 'partner.task.assign', null, v_t.project_id);
  perform app.notify(p_assignee_id, v_a.partner_org_id, 'task.assigned', 'task', v_t.id, 'notification.task_assigned',
    jsonb_build_object('task', v_t.code), 'task.assigned:' || v_t.id || ':' || v_t.version);
  return app.task_json(v_t);
end;
$$;

create function public.accept_task(p_task_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_t public.project_tasks := app.lock_task(p_task_id);
  v_tr public.state_transitions;
begin
  perform app.require_assignee(v_t);
  perform app.assert_version(p_expected_version, v_t.version);
  v_tr := app.transition('task', v_t.status::text, 'accept');
  update public.project_tasks set status = v_tr.to_state::public.task_state, updated_by = v_uid where id = v_t.id returning * into v_t;
  perform app.audit(app.task_partner(v_t), 'task', v_t.id, v_tr.audit_event, jsonb_build_object('status', v_tr.from_state), jsonb_build_object('status', v_t.status),
    null, v_tr.permission_code, null, v_t.project_id);
  return app.task_json(v_t);
end;
$$;

-- Mirrors evaluateSafetyPreStart(safetyChecksFromAnswers(answers)): missing answers count as applicable and unconfirmed.
create function app.evaluate_safety_check(p_answers jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'criticalFailures', coalesce(jsonb_agg(c ->> 'key' order by o) filter (where (c ->> 'critical')::boolean
       and coalesce((p_answers -> (c ->> 'key') ->> 'applicable')::boolean, true) and not coalesce((p_answers -> (c ->> 'key') ->> 'confirmed')::boolean, false)), '[]'::jsonb),
    'warnings', coalesce(jsonb_agg(c ->> 'key' order by o) filter (where not (c ->> 'critical')::boolean
       and coalesce((p_answers -> (c ->> 'key') ->> 'applicable')::boolean, true) and not coalesce((p_answers -> (c ->> 'key') ->> 'confirmed')::boolean, false)), '[]'::jsonb))
  from jsonb_array_elements(app.rule('execution.safety_checks') -> 'checks') with ordinality x(c, o)
$$;

-- WT03: record the pre-start controls (rule execution.safety_checks). Critical failures disable Start.
create function public.record_safety_check(p_operation_id uuid, p_task_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_t public.project_tasks := app.lock_task(p_task_id);
  v_crit text[];
  v_warn text[];
  v_c public.task_safety_checks;
begin
  perform app.require_assignee(v_t);
  v_replay := app.op_begin(p_operation_id, 'task.safety_check');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_t.status not in ('accepted', 'blocked', 'rework', 'in_progress') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_t.status));
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then perform app.j_field_error('answers'); end if;
  select array(select jsonb_array_elements_text(e -> 'criticalFailures')), array(select jsonb_array_elements_text(e -> 'warnings'))
    into v_crit, v_warn from app.evaluate_safety_check(p_answers) e;
  insert into public.task_safety_checks (task_id, answers, can_start, critical_failures, warnings, recorded_by, operation_id)
  values (v_t.id, p_answers, cardinality(v_crit) = 0, v_crit, v_warn, v_uid, p_operation_id)
  returning * into v_c;
  perform app.audit(app.task_partner(v_t), 'task', v_t.id, 'task.safety_check_recorded', null,
    jsonb_build_object('can_start', v_c.can_start, 'critical_failures', v_c.critical_failures, 'warnings', v_c.warnings), null, 'task.execute', p_operation_id, v_t.project_id);
  return app.op_finish(p_operation_id, v_c.id, jsonb_build_object('safety_check_id', v_c.id, 'can_start', v_c.can_start,
    'critical_failures', to_jsonb(v_c.critical_failures), 'warnings', to_jsonb(v_c.warnings)));
end;
$$;

-- Status of each prerequisite (mirrors prerequisitesComplete: submitted / approved / closed count as done).
create function app.task_prerequisites_done(p_task public.project_tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from unnest(p_task.prerequisites) pre
    where not exists (select 1 from public.project_tasks o where o.project_id = p_task.project_id and o.code = pre and o.status in ('submitted', 'approved', 'closed')))
$$;

-- Today's passing pre-start by the assignee, recorded after any resolved safety stop on this task.
create function app.task_safety_passed(p_task public.project_tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_safety_checks c
    where c.task_id = p_task.id and c.recorded_by = p_task.assignee_user_id and c.can_start
      and (c.recorded_at at time zone 'Asia/Kolkata')::date = app.today_ist()
      and c.recorded_at > coalesce((select max(i.resolved_at) from public.execution_incidents i where i.task_id = p_task.id and i.safety_stop), '-infinity'::timestamptz))
$$;

create function public.start_task(p_task_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_t public.project_tasks := app.lock_task(p_task_id);
  v_p public.projects;
  v_tr public.state_transitions;
begin
  perform app.require_assignee(v_t);
  perform app.assert_version(p_expected_version, v_t.version);
  select * into v_p from public.projects where id = v_t.project_id;
  v_tr := app.transition('task', v_t.status::text, 'start');
  if v_p.status <> 'installation' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_p.status, 'reason', 'installation has not started on this project'));
  end if;
  if v_t.safety_stop then
    perform app.raise_error('SAFETY_STOP_ACTIVE', jsonb_build_object('reason', 'a safety stop is active for this task'));
  end if;
  if not app.task_safety_passed(v_t) then
    perform app.raise_error('SAFETY_STOP_ACTIVE', jsonb_build_object('reason', 'record a passing safety pre-start today first'));
  end if;
  if not app.task_prerequisites_done(v_t) then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'prerequisite tasks are not complete', 'prerequisites', to_jsonb(v_t.prerequisites)));
  end if;
  update public.project_tasks set status = v_tr.to_state::public.task_state, started_at = coalesce(started_at, now()), updated_by = v_uid
   where id = v_t.id returning * into v_t;
  perform app.audit(app.task_partner(v_t), 'task', v_t.id, v_tr.audit_event, jsonb_build_object('status', v_tr.from_state), jsonb_build_object('status', v_t.status),
    null, v_tr.permission_code, null, v_t.project_id);
  return app.task_json(v_t);
end;
$$;

-- WT04: checklist answers {key: {done, not_applicable_reason}} and notes while working.
create function public.save_task_progress(p_task_id uuid, p_expected_version integer, p_answers jsonb, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_t public.project_tasks := app.lock_task(p_task_id);
  v_key text;
begin
  perform app.require_assignee(v_t);
  perform app.assert_version(p_expected_version, v_t.version);
  if v_t.status not in ('in_progress', 'rework') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_t.status));
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then perform app.j_field_error('checklist'); end if;
  for v_key in select jsonb_object_keys(p_answers) loop
    if not (v_key = any (v_t.checklist)) or jsonb_typeof(p_answers -> v_key) <> 'object' then perform app.j_field_error('checklist.' || v_key); end if;
  end loop;
  update public.project_tasks set checklist_answers = p_answers, notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_by = v_uid
   where id = v_t.id returning * into v_t;
  return app.task_json(v_t);
end;
$$;

create function public.register_task_evidence(p_operation_id uuid, p_task_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_t public.project_tasks := app.lock_task(p_task_id);
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_path text := v ->> 'storage_path';
  v_parsed record;
  v_object record;
  v_partner uuid := app.task_partner(v_t);
  v_size bigint := app.jint(v, 'size_bytes');
  v_mime text := lower(coalesce(v ->> 'mime_type', ''));
  v_captured timestamptz := app.jts(v, 'captured_at');
  v_lat double precision := app.jnum(v, 'latitude');
  v_lng double precision := app.jnum(v, 'longitude');
  v_e public.task_evidence;
begin
  perform app.require_assignee(v_t);
  v_replay := app.op_begin(p_operation_id, 'task.evidence');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_t.status not in ('in_progress', 'rework') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_t.status));
  end if;
  if coalesce(v ->> 'category', '') not in ('before', 'in_progress', 'after', 'correction') then perform app.j_field_error('category'); end if;
  if coalesce(v ->> 'source', '') not in ('in_app_camera', 'document_import') then perform app.j_field_error('source'); end if;
  select * into v_parsed from app.parse_task_evidence_path(v_path);
  if v_parsed.task_id is null or v_parsed.task_id <> v_t.id or v_parsed.organization_id <> v_partner or v_parsed.operation_id <> p_operation_id then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('storage_path')));
  end if;
  select o.name, o.metadata into v_object from storage.objects o where o.bucket_id = 'execution-evidence' and o.name = v_path;
  if v_object.name is null then
    perform app.raise_error('FILE_UPLOAD_FAILED', jsonb_build_object('reason', 'file not found in storage; upload first'));
  end if;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic') then perform app.j_field_error('mime_type'); end if;
  if v_size is null or v_size <= 0 or v_size > 15728640 or (v_object.metadata ? 'size' and (v_object.metadata ->> 'size')::bigint <> v_size) then
    perform app.j_field_error('size_bytes');
  end if;
  if coalesce(v ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then perform app.j_field_error('sha256'); end if;
  if v_captured is null or v_captured > now() + interval '5 minutes' then perform app.j_field_error('captured_at'); end if;
  insert into public.task_evidence (task_id, partner_org_id, category, storage_path, sha256, mime_type, size_bytes, source, captured_by, captured_at,
    capture_location, capture_accuracy_m, remarks, operation_id)
  values (v_t.id, v_partner, v ->> 'category', v_path, v ->> 'sha256', v_mime, v_size, v ->> 'source', v_uid, v_captured,
    case when v_lat is not null and v_lng is not null then app.geo_point(v_lat, v_lng) end, app.jnum(v, 'accuracy_m'),
    nullif(btrim(coalesce(v ->> 'remarks', '')), ''), p_operation_id)
  returning * into v_e;
  perform app.audit(v_partner, 'task', v_t.id, 'task.evidence_registered', null,
    jsonb_build_object('evidence_id', v_e.id, 'category', v_e.category, 'sha256', v_e.sha256), null, 'task.execute', p_operation_id, v_t.project_id);
  return app.op_finish(p_operation_id, v_e.id, jsonb_build_object('evidence_id', v_e.id, 'category', v_e.category));
end;
$$;

-- Gate 9: checklist complete and every required evidence category present (mirrors taskSubmissionCheck).
create function app.task_submission_check(p_task public.project_tasks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'incomplete', coalesce((select jsonb_agg(k order by o) from unnest(p_task.checklist) with ordinality u(k, o)
       where not (coalesce((p_task.checklist_answers -> k ->> 'done')::boolean, false)
                  or length(btrim(coalesce(p_task.checklist_answers -> k ->> 'not_applicable_reason', ''))) >= 3)), '[]'::jsonb),
    'missingEvidence', coalesce((select jsonb_agg(c order by o) from unnest(p_task.evidence_required) with ordinality u(c, o)
       where not exists (select 1 from public.task_evidence e where e.task_id = p_task.id and e.category = c)), '[]'::jsonb))
$$;

create function public.submit_task(p_task_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_t public.project_tasks := app.lock_task(p_task_id);
  v_tr public.state_transitions;
  v_check jsonb;
begin
  perform app.require_assignee(v_t);
  perform app.assert_version(p_expected_version, v_t.version);
  if v_t.status = 'rework' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_t.status, 'reason', 'rework is resubmitted through QA (Slice 6)'));
  end if;
  v_tr := app.transition('task', v_t.status::text, 'submit');
  v_check := app.task_submission_check(v_t);
  if jsonb_array_length(v_check -> 'incomplete') > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields',
      (select jsonb_agg('checklist.' || (x #>> '{}')) from jsonb_array_elements(v_check -> 'incomplete') x)));
  end if;
  if jsonb_array_length(v_check -> 'missingEvidence') > 0 then
    perform app.raise_error('EVIDENCE_REQUIRED', jsonb_build_object('missing', v_check -> 'missingEvidence'));
  end if;
  update public.project_tasks set status = v_tr.to_state::public.task_state, submitted_at = now(), submitted_by = v_uid, updated_by = v_uid
   where id = v_t.id returning * into v_t;
  perform app.audit(app.task_partner(v_t), 'task', v_t.id, v_tr.audit_event, jsonb_build_object('status', v_tr.from_state), jsonb_build_object('status', v_t.status),
    null, v_tr.permission_code, null, v_t.project_id);
  perform app.notify_permission_holders('partner.task.assign', app.task_partner(v_t), 'task.submitted', 'task', v_t.id,
    'notification.task_submitted', jsonb_build_object('task', v_t.code), 'task.submitted:' || v_t.id || ':' || v_t.version);
  return app.task_json(v_t);
end;
$$;

-- WT05: blocker or incident. Safety categories stop the task (Gate 11) and escalate to AIEC at once.
create function public.report_incident(p_operation_id uuid, p_task_id uuid, p_category text, p_description text, p_client_reported_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_t public.project_tasks := app.lock_task(p_task_id);
  v_partner uuid := app.task_partner(v_t);
  v_p public.projects;
  v_i public.execution_incidents;
  v_stop boolean := p_category in ('unsafe_condition', 'injury_incident');
  v_tr public.state_transitions;
begin
  if not (v_t.assignee_user_id = v_uid and app.user_has_permission(v_uid, 'task.execute', v_partner))
     and not app.user_has_permission(v_uid, 'partner.task.assign', v_partner) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'task.execute'));
  end if;
  v_replay := app.op_begin(p_operation_id, 'task.incident');
  if v_replay is not null then
    return v_replay;
  end if;
  if coalesce(p_category, '') not in ('material_missing', 'site_inaccessible', 'drawing_unclear', 'unsafe_condition', 'equipment_issue', 'customer_dependency', 'injury_incident', 'other') then
    perform app.j_field_error('category');
  end if;
  if length(btrim(coalesce(p_description, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('description')));
  end if;
  select * into v_p from public.projects where id = v_t.project_id;
  insert into public.execution_incidents (project_id, task_id, partner_org_id, category, description, safety_stop, reported_by, client_reported_at, operation_id)
  values (v_t.project_id, v_t.id, v_partner, p_category, btrim(p_description), v_stop, v_uid, p_client_reported_at, p_operation_id)
  returning * into v_i;
  if v_t.status = 'in_progress' then
    v_tr := app.transition('task', 'in_progress', 'block', p_description);
    update public.project_tasks set status = v_tr.to_state::public.task_state, block_category = p_category, block_reason = btrim(p_description), updated_by = v_uid
     where id = v_t.id;
  end if;
  if v_stop then
    update public.project_tasks set safety_stop = true, updated_by = v_uid where id = v_t.id;
  end if;
  select * into v_t from public.project_tasks where id = v_t.id;
  perform app.audit(v_partner, 'execution_incident', v_i.id, case when v_stop then 'incident.safety_stop' else 'incident.reported' end, null,
    jsonb_build_object('category', v_i.category, 'task_id', v_t.id, 'task_status', v_t.status, 'safety_stop', v_stop), p_description, 'task.execute', p_operation_id, v_t.project_id);
  perform app.notify_permission_holders('project.plan', v_p.organization_id, 'incident.reported', 'project', v_p.id,
    case when v_stop then 'notification.safety_stop' else 'notification.incident_reported' end,
    jsonb_build_object('project_number', v_p.project_number, 'category', v_i.category), 'incident.reported:' || v_i.id);
  if v_stop then
    perform app.notify_permission_holders('approval.exception.decide', v_p.organization_id, 'incident.reported', 'project', v_p.id, 'notification.safety_stop',
      jsonb_build_object('project_number', v_p.project_number, 'category', v_i.category), 'incident.owner:' || v_i.id);
    update public.notifications set severity = 'critical' where dedupe_key like 'incident.%:' || v_i.id || ':%';
  end if;
  perform app.notify_permission_holders('partner.task.assign', v_partner, 'incident.reported', 'task', v_t.id,
    case when v_stop then 'notification.safety_stop' else 'notification.incident_reported' end,
    jsonb_build_object('project_number', v_p.project_number, 'category', v_i.category), 'incident.partner:' || v_i.id);
  return app.op_finish(p_operation_id, v_i.id, jsonb_build_object('incident_id', v_i.id, 'safety_stop', v_stop) || app.task_json(v_t));
end;
$$;

-- AIEC Operations resolves an incident; a safety stop is lifted only here, with a reason (no other override).
create function public.resolve_incident(p_incident_id uuid, p_resolution text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_i public.execution_incidents;
  v_p public.projects;
begin
  select * into v_i from public.execution_incidents where id = p_incident_id for update;
  select * into v_p from public.projects where id = v_i.project_id;
  if v_i.id is null or not app.is_execution_manager(v_p.organization_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'incident'));
  end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  if v_i.status <> 'open' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_i.status, 'allowedActions', '[]'::jsonb));
  end if;
  if length(btrim(coalesce(p_resolution, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('resolution')));
  end if;
  update public.execution_incidents set status = 'resolved', resolved_by = v_uid, resolved_at = now(), resolution = btrim(p_resolution)
   where id = v_i.id returning * into v_i;
  if v_i.safety_stop and v_i.task_id is not null
     and not exists (select 1 from public.execution_incidents o where o.task_id = v_i.task_id and o.safety_stop and o.status = 'open') then
    update public.project_tasks set safety_stop = false, updated_by = v_uid where id = v_i.task_id;
  end if;
  perform app.audit(v_p.organization_id, 'execution_incident', v_i.id, case when v_i.safety_stop then 'incident.safety_stop_lifted' else 'incident.resolved' end,
    jsonb_build_object('status', 'open'), jsonb_build_object('status', 'resolved'), p_resolution, 'project.plan', null, v_p.id);
  perform app.notify_permission_holders('partner.task.assign', v_i.partner_org_id, 'incident.resolved', 'task', v_i.task_id,
    'notification.incident_resolved', jsonb_build_object('project_number', v_p.project_number, 'category', v_i.category), 'incident.resolved:' || v_i.id);
  return jsonb_build_object('incident_id', v_i.id, 'status', v_i.status);
end;
$$;

-- The partner supervisor resumes a blocked task once the cause is cleared. A safety stop must be lifted by
-- AIEC first, and the assignee must record a new passing pre-start after that (Gate 11).
create function public.unblock_task(p_task_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_t public.project_tasks := app.lock_task(p_task_id);
  v_tr public.state_transitions;
begin
  perform app.require_permission('partner.task.assign', app.task_partner(v_t));
  perform app.assert_version(p_expected_version, v_t.version);
  v_tr := app.transition('task', v_t.status::text, 'unblock', p_reason);
  if v_t.safety_stop then
    perform app.raise_error('SAFETY_STOP_ACTIVE', jsonb_build_object('reason', 'AIEC must lift the safety stop first'));
  end if;
  if exists (select 1 from public.execution_incidents i where i.task_id = v_t.id and i.safety_stop) and not app.task_safety_passed(v_t) then
    perform app.raise_error('SAFETY_STOP_ACTIVE', jsonb_build_object('reason', 'the assignee must record a new passing safety pre-start'));
  end if;
  update public.project_tasks set status = v_tr.to_state::public.task_state, block_category = null, block_reason = null, updated_by = v_uid
   where id = v_t.id returning * into v_t;
  perform app.audit(app.task_partner(v_t), 'task', v_t.id, v_tr.audit_event, jsonb_build_object('status', v_tr.from_state), jsonb_build_object('status', v_t.status),
    p_reason, v_tr.permission_code, null, v_t.project_id);
  return app.task_json(v_t);
end;
$$;

-- =============================================================================
-- LP08 daily work report and OM06 comments
-- =============================================================================
create function public.submit_daily_report(p_operation_id uuid, p_assignment_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_a public.project_partner_assignments;
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_date date := app.jdate(v, 'report_date');
  v_present uuid[];
  v_missing text[] := '{}';
  v_r public.daily_reports;
  v_p public.projects;
begin
  select * into v_a from public.project_partner_assignments where id = p_assignment_id;
  if not found or not app.can_read_assignment(v_a.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'partner_assignment'));
  end if;
  perform app.require_permission('partner.daily_report.submit', v_a.partner_org_id);
  v_replay := app.op_begin(p_operation_id, 'daily_report.submit');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_a.status <> 'accepted' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_a.status));
  end if;
  if jsonb_typeof(v -> 'present_user_ids') = 'array' then
    v_present := array(select app.try_uuid(x) from jsonb_array_elements_text(v -> 'present_user_ids') x);
  end if;
  -- Mirrors dailyReportMissing.
  if v_date is null or v_date > app.today_ist() then v_missing := v_missing || 'report_date'::text; end if;
  if coalesce(cardinality(v_present), 0) = 0 then v_missing := v_missing || 'present_user_ids'::text; end if;
  if length(btrim(coalesce(v ->> 'work_completed', ''))) < 3 then v_missing := v_missing || 'work_completed'::text; end if;
  if jsonb_typeof(v -> 'incident_declared') is distinct from 'boolean' then v_missing := v_missing || 'incident_declared'::text; end if;
  if (v ->> 'incident_declared') = 'true' and length(btrim(coalesce(v ->> 'safety_observations', ''))) < 3 then v_missing := v_missing || 'safety_observations'::text; end if;
  if length(btrim(coalesce(v ->> 'next_day_plan', ''))) < 3 then v_missing := v_missing || 'next_day_plan'::text; end if;
  if cardinality(v_missing) > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;
  if v_date < (v_a.responded_at at time zone 'Asia/Kolkata')::date then perform app.j_field_error('report_date'); end if;
  if exists (select 1 from unnest(v_present) u where u is null or not exists (
               select 1 from public.project_team_members m where m.assignment_id = v_a.id and m.user_id = u and m.added_at::date <= v_date + 1)) then
    perform app.j_field_error('present_user_ids');
  end if;
  if exists (select 1 from public.daily_reports where assignment_id = v_a.id and report_date = v_date) then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'a report for this date was already submitted', 'fields', jsonb_build_array('report_date')));
  end if;
  insert into public.daily_reports (project_id, assignment_id, partner_org_id, report_date, present_user_ids, work_completed, work_not_completed, material_used,
    material_shortage, blockers, incident_declared, safety_observations, next_day_plan, submitted_by, operation_id)
  values (v_a.project_id, v_a.id, v_a.partner_org_id, v_date, v_present, btrim(v ->> 'work_completed'), nullif(btrim(coalesce(v ->> 'work_not_completed', '')), ''),
    nullif(btrim(coalesce(v ->> 'material_used', '')), ''), nullif(btrim(coalesce(v ->> 'material_shortage', '')), ''), nullif(btrim(coalesce(v ->> 'blockers', '')), ''),
    (v ->> 'incident_declared')::boolean, nullif(btrim(coalesce(v ->> 'safety_observations', '')), ''), btrim(v ->> 'next_day_plan'), v_uid, p_operation_id)
  returning * into v_r;
  select * into v_p from public.projects where id = v_a.project_id;
  perform app.audit(v_a.partner_org_id, 'daily_report', v_r.id, 'daily_report.submitted', null,
    jsonb_build_object('report_date', v_r.report_date, 'present', cardinality(v_r.present_user_ids), 'incident_declared', v_r.incident_declared), null,
    'partner.daily_report.submit', p_operation_id, v_r.project_id);
  if v_r.incident_declared then
    perform app.notify_permission_holders('project.plan', v_p.organization_id, 'daily_report.incident', 'project', v_p.id, 'notification.daily_report_incident',
      jsonb_build_object('project_number', v_p.project_number, 'report_date', v_r.report_date), 'daily_report.incident:' || v_r.id);
  end if;
  return app.op_finish(p_operation_id, v_r.id, jsonb_build_object('daily_report_id', v_r.id, 'report_date', v_r.report_date));
end;
$$;

create function public.comment_daily_report(p_report_id uuid, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.daily_reports;
  v_p public.projects;
  v_c public.daily_report_comments;
begin
  select * into v_r from public.daily_reports where id = p_report_id;
  select * into v_p from public.projects where id = v_r.project_id;
  if v_r.id is null or not app.is_execution_manager(v_p.organization_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'daily_report'));
  end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  if length(btrim(coalesce(p_comment, ''))) < 3 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('comment'))); end if;
  insert into public.daily_report_comments (report_id, comment, author_id) values (v_r.id, btrim(p_comment), v_uid) returning * into v_c;
  perform app.audit(v_p.organization_id, 'daily_report', v_r.id, 'daily_report.commented', null, jsonb_build_object('comment_id', v_c.id), p_comment, 'project.plan', null, v_p.id);
  perform app.notify_permission_holders('partner.daily_report.submit', v_r.partner_org_id, 'daily_report.commented', 'project', v_p.id,
    'notification.daily_report_commented', jsonb_build_object('project_number', v_p.project_number, 'report_date', v_r.report_date), 'daily_report.commented:' || v_c.id);
  return jsonb_build_object('comment_id', v_c.id);
end;
$$;

-- =============================================================================
-- Installation readiness (§50; project machine guard) and start
-- =============================================================================
create function app.project_readiness(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.projects where id = p_project_id),
  partner as (
    select a.partner_org_id from public.project_partner_assignments a where a.project_id = p_project_id and a.status = 'accepted'
  ),
  bom as (select b.id from public.bom_revisions b where b.project_id = p_project_id and b.status = 'approved')
  select jsonb_build_object(
    'technical', exists (select 1 from p join public.configuration_revisions c on c.id = p.configuration_revision_id where c.status = 'approved'),
    'site', coalesce((select s.passed from public.site_readiness_checks s where s.project_id = p_project_id order by s.revision_no desc limit 1), false),
    'payment', (app.payment_gate(p_project_id, 'dispatch') ->> 'open')::boolean and (app.payment_gate(p_project_id, 'installation') ->> 'open')::boolean,
    'material', exists (select 1 from bom) and not exists (
        select 1 from public.bom_lines l where l.bom_revision_id = (select id from bom)
          and l.quantity_milli > coalesce((select sum(pl.accepted_milli) from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.po_id
                                           where pl.bom_line_id = l.id and po.status <> 'cancelled'), 0)),
    'partner', exists (select 1 from partner) and coalesce((select (app.partner_eligibility(partner.partner_org_id, app.project_lift_category(p_project_id)) ->> 'eligible')::boolean from partner), false),
    'documentation', exists (select 1 from p join public.technical_documents d on d.lead_id = p.lead_id
                             join public.document_revisions r on r.document_id = d.id where r.status = 'approved'))
$$;

create function public.project_readiness(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  return app.project_readiness(p_project_id);
end;
$$;

-- project machine: mark_installation_ready (every readiness dimension) and start_installation (no safety stop).
create function public.project_execution_action(p_project_id uuid, p_expected_version integer, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v_t public.state_transitions;
  v_r jsonb;
  v_missing jsonb;
  v_partner uuid;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found or not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  perform app.assert_version(p_expected_version, v_p.version);
  if p_action not in ('mark_installation_ready', 'start_installation') then perform app.j_field_error('action'); end if;
  v_t := app.transition('project', v_p.status::text, p_action);
  if p_action = 'mark_installation_ready' then
    v_r := app.project_readiness(p_project_id);
    select jsonb_agg(k order by o) into v_missing
    from unnest(array['technical', 'site', 'payment', 'material', 'partner', 'documentation']) with ordinality u(k, o)
    where not (v_r ->> k)::boolean;
    if v_missing is not null then
      perform app.raise_error(case
          when v_missing ? 'site' then 'SITE_NOT_READY'
          when v_missing ? 'partner' then 'PARTNER_COMPLIANCE_BLOCK'
          when v_missing ? 'payment' then 'PAYMENT_NOT_VERIFIED'
          when v_missing ? 'material' then 'MATERIAL_NOT_READY'
          else 'APPROVAL_REQUIRED' end,
        jsonb_build_object('missing', v_missing, 'readiness', v_r));
    end if;
  else
    if exists (select 1 from public.project_tasks t where t.project_id = p_project_id and t.safety_stop) then
      perform app.raise_error('SAFETY_STOP_ACTIVE', jsonb_build_object('reason', 'a safety stop is active on this project'));
    end if;
  end if;
  update public.projects set status = v_t.to_state::public.project_state, updated_by = v_uid where id = p_project_id returning * into v_p;
  perform app.audit(v_p.organization_id, 'project', v_p.id, v_t.audit_event, jsonb_build_object('status', v_t.from_state),
    jsonb_build_object('status', v_p.status, 'readiness', v_r), null, v_t.permission_code, null, v_p.id);
  select partner_org_id into v_partner from public.project_partner_assignments where project_id = p_project_id and status = 'accepted';
  if v_partner is not null then
    perform app.notify_permission_holders('partner.task.assign', v_partner, 'project.' || p_action, 'project', v_p.id,
      'notification.project_' || p_action, jsonb_build_object('project_number', v_p.project_number), 'project.' || p_action || ':' || v_p.id);
  end if;
  return app.project_json(v_p);
end;
$$;

-- Names for record cards: AIEC staff see AIEC and partner people; partner people see their own organization.
create or replace function public.staff_display_names(p_ids jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_aiec uuid := app.aiec_org_id();
  v_is_aiec boolean := exists (select 1 from public.organization_memberships m where m.user_id = v_uid and m.organization_id = v_aiec and m.status = 'active');
  v_ids uuid[] := array(select app.try_uuid(x) from jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end) x);
begin
  if cardinality(v_ids) > 200 then perform app.j_field_error('ids'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', up.id, 'full_name', up.full_name))
    from public.user_profiles up
    where up.id = any (v_ids)
      and exists (
        select 1 from public.organization_memberships target join public.organizations o on o.id = target.organization_id
        where target.user_id = up.id
          and ((v_is_aiec and o.kind in ('aiec', 'partner'))
               or exists (select 1 from public.organization_memberships mine
                          where mine.user_id = v_uid and mine.status = 'active' and mine.organization_id = target.organization_id and o.kind = 'partner')))
  ), '[]'::jsonb);
end;
$$;

-- =============================================================================
-- RLS (read-only; every write goes through the RPCs above)
-- =============================================================================
alter table public.partner_profiles enable row level security;
alter table public.partner_documents enable row level security;
alter table public.site_readiness_checks enable row level security;
alter table public.project_partner_assignments enable row level security;
alter table public.project_team_members enable row level security;
alter table public.partner_workers enable row level security;
alter table public.project_tasks enable row level security;
alter table public.task_safety_checks enable row level security;
alter table public.task_evidence enable row level security;
alter table public.execution_incidents enable row level security;
alter table public.daily_reports enable row level security;
alter table public.daily_report_comments enable row level security;

create policy partner_profiles_read on public.partner_profiles for select to authenticated using (app.can_read_partner_company(organization_id));
create policy partner_documents_read on public.partner_documents for select to authenticated using (app.can_read_partner_documents(organization_id));
create policy site_readiness_checks_read on public.site_readiness_checks for select to authenticated using (app.can_read_project(project_id));
create policy project_partner_assignments_read on public.project_partner_assignments for select to authenticated using (app.can_read_assignment(id));
create policy project_team_members_read on public.project_team_members for select to authenticated using (user_id = auth.uid() or app.can_read_assignment(assignment_id));
create policy partner_workers_read on public.partner_workers for select to authenticated using (
  user_id = auth.uid() or app.user_has_permission(auth.uid(), 'partner.team.manage', organization_id)
  or app.user_has_permission(auth.uid(), 'partner.task.assign', organization_id) or app.is_partner_overseer());
create policy project_tasks_read on public.project_tasks for select to authenticated using (app.can_read_task(id));
create policy task_safety_checks_read on public.task_safety_checks for select to authenticated using (app.can_read_task(task_id));
create policy task_evidence_read on public.task_evidence for select to authenticated using (app.can_read_task(task_id));
create policy execution_incidents_read on public.execution_incidents for select to authenticated using (
  (task_id is not null and app.can_read_task(task_id)) or app.user_has_permission(auth.uid(), 'partner.project.read', partner_org_id)
  or exists (select 1 from public.projects p where p.id = project_id and app.is_execution_manager(p.organization_id)));
create policy daily_reports_read on public.daily_reports for select to authenticated using (app.can_read_assignment(assignment_id));
create policy daily_report_comments_read on public.daily_report_comments for select to authenticated using (
  exists (select 1 from public.daily_reports r where r.id = report_id and app.can_read_assignment(r.assignment_id)));

-- Partner people read the names of the organizations they work with (AIEC) and their own.
create policy organizations_read_partner_context on public.organizations for select to authenticated using (
  kind = 'partner' and app.is_partner_overseer());

revoke all on public.partner_profiles, public.partner_documents, public.site_readiness_checks, public.project_partner_assignments, public.project_team_members,
  public.partner_workers, public.project_tasks, public.task_safety_checks, public.task_evidence, public.execution_incidents, public.daily_reports,
  public.daily_report_comments from anon, authenticated;
grant select on public.partner_profiles, public.partner_documents, public.site_readiness_checks, public.project_partner_assignments, public.project_team_members,
  public.partner_workers, public.project_tasks, public.task_safety_checks, public.task_evidence, public.execution_incidents, public.daily_reports,
  public.daily_report_comments to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.save_partner_profile(uuid, integer, jsonb),
  public.register_partner_document(uuid, uuid, jsonb),
  public.verify_partner_document(uuid, text, text),
  public.partner_action(uuid, integer, text, text),
  public.partner_eligibility(uuid, text),
  public.record_site_readiness(uuid, jsonb),
  public.invite_partner(uuid, uuid, jsonb),
  public.assignment_action(uuid, integer, text, text, text),
  public.set_worker_profile(uuid, uuid, jsonb, text),
  public.set_project_team_member(uuid, uuid, text, text),
  public.assign_task(uuid, integer, uuid, date),
  public.accept_task(uuid, integer),
  public.record_safety_check(uuid, uuid, jsonb),
  public.start_task(uuid, integer),
  public.save_task_progress(uuid, integer, jsonb, text),
  public.register_task_evidence(uuid, uuid, jsonb),
  public.submit_task(uuid, integer),
  public.report_incident(uuid, uuid, text, text, timestamptz),
  public.resolve_incident(uuid, text),
  public.unblock_task(uuid, integer, text),
  public.submit_daily_report(uuid, uuid, jsonb),
  public.comment_daily_report(uuid, text),
  public.project_readiness(uuid),
  public.project_execution_action(uuid, integer, text),
  public.staff_display_names(jsonb)
to authenticated;

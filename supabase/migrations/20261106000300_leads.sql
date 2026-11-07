-- =============================================================================
-- Slice 2a: sites, leads, lead activities, duplicate review, lead scoring.
-- State changes go through public.state_transitions (seeded from
-- packages/domain/src/machines.ts and asserted equal by supabase/tests).
-- =============================================================================

create type public.lead_state as enum ('new', 'assigned', 'contacted', 'qualified', 'won', 'lost', 'invalid');
create type public.lead_source as enum ('website', 'phone', 'whatsapp', 'referral', 'builder_visit', 'marketing_campaign', 'existing_customer', 'manual');
create type public.customer_type as enum ('individual', 'housing_society', 'builder_developer', 'commercial', 'institution', 'other');
create type public.lead_activity_type as enum ('call', 'meeting', 'whatsapp', 'email', 'site_visit', 'note');
create type public.call_outcome as enum (
  'interested', 'call_back', 'meeting_requested', 'survey_required', 'proposal_requested',
  'no_answer', 'not_interested', 'invalid_enquiry', 'lost_to_competitor');
create type public.lost_reason as enum (
  'price', 'competitor', 'project_cancelled', 'no_response', 'budget_unavailable',
  'technical_infeasibility', 'timeline_mismatch', 'customer_postponed', 'other');

-- -----------------------------------------------------------------------------
-- Explicit transition tables (§47): one machine per entity, no global status.
-- -----------------------------------------------------------------------------
create table public.state_transitions (
  machine text not null,
  from_state text not null,
  action text not null,
  to_state text not null,
  permission_code text not null references public.permissions (code),
  requires_reason boolean not null default false,
  audit_event text not null,
  primary key (machine, from_state, action)
);

-- Validate an action from the current state; returns the transition row or
-- raises INVALID_STATE_TRANSITION (with allowed actions) / REQUIRED_FIELD_MISSING.
create function app.transition(p_machine text, p_from text, p_action text, p_reason text default null)
returns public.state_transitions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.state_transitions;
begin
  select * into v_t from public.state_transitions
   where machine = p_machine and from_state = p_from and action = p_action;
  if not found then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object(
      'machine', p_machine,
      'currentState', p_from,
      'action', p_action,
      'allowedActions', coalesce((
        select jsonb_agg(action order by action) from public.state_transitions
        where machine = p_machine and from_state = p_from), '[]'::jsonb)));
  end if;
  if v_t.requires_reason and (p_reason is null or length(btrim(p_reason)) < 3) then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  return v_t;
end;
$$;

create function app.assert_version(p_expected integer, p_current integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_expected is null then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('expected_version')));
  end if;
  if p_expected <> p_current then
    perform app.raise_error('REVISION_CONFLICT', jsonb_build_object('expected', p_expected, 'current', p_current));
  end if;
end;
$$;


-- Safe typed reads from JSON payloads: invalid input → VALIDATION_FAILED with
-- the field name, never a raw cast error.
create function app.j_field_error(p_field text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(p_field)));
end;
$$;

create function app.jint(p_obj jsonb, p_key text, p_field text default null)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
begin
  if v is null then return null; end if;
  if v !~ '^-?[0-9]{1,9}$' then perform app.j_field_error(coalesce(p_field, p_key)); end if;
  return v::integer;
end;
$$;

create function app.jnum(p_obj jsonb, p_key text, p_field text default null)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
begin
  if v is null then return null; end if;
  if v !~ '^-?[0-9]{1,12}(\.[0-9]{1,12})?$' then perform app.j_field_error(coalesce(p_field, p_key)); end if;
  return v::numeric;
end;
$$;

create function app.jdate(p_obj jsonb, p_key text, p_field text default null)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform app.j_field_error(coalesce(p_field, p_key)); end if;
  begin
    return v::date;
  exception when others then
    perform app.j_field_error(coalesce(p_field, p_key));
  end;
end;
$$;

create function app.jts(p_obj jsonb, p_key text, p_field text default null)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
begin
  if v is null then return null; end if;
  -- Require an explicit offset / Z so device-local clocks cannot be misread.
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    perform app.j_field_error(coalesce(p_field, p_key));
  end if;
  begin
    return v::timestamptz;
  exception when others then
    perform app.j_field_error(coalesce(p_field, p_key));
  end;
end;
$$;

create function app.jbool(p_obj jsonb, p_key text, p_field text default null)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare v jsonb := p_obj -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'boolean' then perform app.j_field_error(coalesce(p_field, p_key)); end if;
  return v::text::boolean;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sites (physical location, separate from customer identity — §33)
-- -----------------------------------------------------------------------------
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) between 2 and 200),
  address_line text,
  locality text,
  city text not null check (length(btrim(city)) between 2 and 80),
  zone text,
  pincode text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  location extensions.geography(Point, 4326),
  location_accuracy_m numeric(10, 1) check (location_accuracy_m is null or location_accuracy_m >= 0),
  location_source text not null default 'unknown' check (location_source in ('map_pin', 'gps', 'geocoded', 'unknown')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check ((location is null) = (location_source = 'unknown'))
);
create index sites_location_gix on public.sites using gist (location);
create index sites_org_idx on public.sites (organization_id, created_at desc);
create trigger sites_touch before update on public.sites for each row execute function app.touch_row();

-- -----------------------------------------------------------------------------
-- Leads (an enquiry — never a project; §33)
-- -----------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  status public.lead_state not null default 'new',
  contact_name text not null check (length(btrim(contact_name)) between 2 and 120),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  alternate_phone_e164 text check (alternate_phone_e164 is null or alternate_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email extensions.citext check (email is null or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  customer_type public.customer_type not null default 'other',
  builder_name text,
  project_name text not null check (length(btrim(project_name)) between 2 and 200),
  site_id uuid not null references public.sites (id),
  building_usage text,
  floors_count integer check (floors_count is null or floors_count between 1 and 200),
  stops_count integer check (stops_count is null or stops_count between 2 and 200),
  lift_requirement text not null check (length(btrim(lift_requirement)) >= 2),
  construction_stage text,
  budget_range text,
  expected_decision_date date,
  source public.lead_source not null,
  referrer text,
  decision_maker text,
  communication_preference text check (communication_preference is null or communication_preference in ('call', 'whatsapp', 'sms', 'email')),
  marketing_consent boolean not null default false,
  notes text,
  owner_user_id uuid references public.user_profiles (id),
  next_action_at timestamptz,
  next_action_note text,
  no_action_reason text,
  qualification jsonb,
  score integer check (score is null or score between 0 and 100),
  score_computed integer check (score_computed is null or score_computed between 0 and 100),
  score_explanation jsonb,
  score_override_reason text,
  first_contacted_at timestamptz,
  lost_reason public.lost_reason,
  closed_reason text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  -- One usable contact method is mandatory (§37 SE02).
  check (phone_e164 is not null or email is not null),
  check (status in ('new', 'won', 'invalid') or owner_user_id is not null),
  check (status <> 'lost' or lost_reason is not null),
  check (score_override_reason is null or length(btrim(score_override_reason)) >= 3)
);
create index leads_org_created_idx on public.leads (organization_id, created_at desc);
create index leads_owner_next_idx on public.leads (owner_user_id, next_action_at) where status in ('assigned', 'contacted', 'qualified');
create index leads_status_idx on public.leads (organization_id, status);
create index leads_phone_idx on public.leads (phone_e164);
create index leads_alt_phone_idx on public.leads (alternate_phone_e164);
create index leads_email_idx on public.leads (email);
create index leads_site_idx on public.leads (site_id);
create index leads_project_trgm on public.leads using gin (project_name extensions.gin_trgm_ops);
create index leads_builder_trgm on public.leads using gin (builder_name extensions.gin_trgm_ops);
create trigger leads_touch before update on public.leads for each row execute function app.touch_row();

-- Activities are an append-only communication history (§7.6).
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  organization_id uuid not null references public.organizations (id),
  activity_type public.lead_activity_type not null,
  outcome public.call_outcome,
  summary text not null check (length(btrim(summary)) between 2 and 4000),
  occurred_at timestamptz not null,
  next_follow_up_at timestamptz,
  no_action_reason text,
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  operation_id uuid unique,
  check (next_follow_up_at is not null or length(btrim(coalesce(no_action_reason, ''))) >= 3)
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, occurred_at desc);
create trigger lead_activities_append_only before update or delete on public.lead_activities
  for each row execute function app.forbid_mutation();

-- Human duplicate decisions (§7.4, §37 SE03). Nothing is auto-merged.
create table public.lead_duplicate_decisions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  candidate_lead_id uuid not null references public.leads (id),
  decision text not null check (decision in ('separate_opportunity', 'ownership_transfer_requested', 'merge_requested')),
  match_reasons text[] not null default '{}',
  reason text not null check (length(btrim(reason)) >= 3),
  decided_by uuid not null references public.user_profiles (id),
  decided_at timestamptz not null default now(),
  check (lead_id <> candidate_lead_id)
);
create index lead_duplicate_decisions_lead_idx on public.lead_duplicate_decisions (lead_id);
create trigger lead_duplicate_decisions_append_only before update or delete on public.lead_duplicate_decisions
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Read authorization
-- -----------------------------------------------------------------------------
create function app.can_read_lead_row(p_org uuid, p_owner uuid, p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'lead.read_all', p_org)
    or (p_owner = auth.uid() and app.user_has_permission(auth.uid(), 'lead.read_assigned', p_org))
$$;

create function app.can_read_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_read_lead_row(l.organization_id, l.owner_user_id, l.id) from public.leads l where l.id = p_lead_id), false)
$$;

-- Sales communication history is visible to the lead owner and lead.read_all only.
create function app.can_read_lead_sales_history(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select app.user_has_permission(auth.uid(), 'lead.read_all', l.organization_id)
        or (l.owner_user_id = auth.uid() and app.user_has_permission(auth.uid(), 'lead.read_assigned', l.organization_id))
    from public.leads l where l.id = p_lead_id), false)
$$;

create function app.can_read_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leads l where l.site_id = p_site_id and app.can_read_lead_row(l.organization_id, l.owner_user_id, l.id))
$$;

-- -----------------------------------------------------------------------------
-- Duplicate candidates (§7.4) — explained, never merged automatically.
-- -----------------------------------------------------------------------------
create function app.find_duplicate_leads(
  p_phone text, p_alternate_phone text, p_email text, p_project_name text, p_builder_name text,
  p_location extensions.geography, p_exclude_lead_id uuid default null
)
returns table (lead_id uuid, reasons text[], level text, distance_m numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := coalesce(app.rule('lead.duplicate_detection'), '{"name_similarity": 0.6, "proximity_m": 150}'::jsonb);
  v_sim real := (v_cfg ->> 'name_similarity')::real;
  v_radius double precision := (v_cfg ->> 'proximity_m')::double precision;
  v_phones text[] := array_remove(array[p_phone, p_alternate_phone], null);
begin
  return query
  with c as (
    select l.id,
      array_remove(array[
        case when cardinality(v_phones) > 0 and (l.phone_e164 = any (v_phones) or l.alternate_phone_e164 = any (v_phones)) then 'phone' end,
        case when p_email is not null and l.email = p_email::extensions.citext then 'email' end,
        case when p_project_name is not null and extensions.similarity(l.project_name, p_project_name) >= v_sim then 'project_name' end,
        case when p_builder_name is not null and l.builder_name is not null and extensions.similarity(l.builder_name, p_builder_name) >= v_sim then 'builder_name' end,
        case when p_location is not null and s.location is not null and extensions.st_dwithin(s.location, p_location, v_radius) then 'site_proximity' end
      ], null) as reasons,
      case when p_location is not null and s.location is not null
           then round(extensions.st_distance(s.location, p_location)::numeric, 1) end as distance_m
    from public.leads l
    join public.sites s on s.id = l.site_id
    where (p_exclude_lead_id is null or l.id <> p_exclude_lead_id)
      and l.status <> 'invalid'
  )
  select c.id, c.reasons,
         case when c.reasons && array['phone', 'email'] then 'strong' else 'possible' end,
         c.distance_m
  from c
  where cardinality(c.reasons) > 0
  order by (c.reasons && array['phone', 'email']) desc, cardinality(c.reasons) desc
  limit 20;
end;
$$;

create function app.geo_point(p_latitude double precision, p_longitude double precision)
returns extensions.geography
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_latitude is null and p_longitude is null then
    return null;
  end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('latitude', 'longitude')));
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography;
end;
$$;

-- Masked candidate view for the duplicate review screen: the requester sees
-- identifiers, status and owner — contact details only when already authorized.
create function app.duplicate_candidates_json(
  p_phone text, p_alternate_phone text, p_email text, p_project_name text, p_builder_name text,
  p_location extensions.geography, p_exclude_lead_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'lead_id', d.lead_id,
      'lead_number', l.lead_number,
      'status', l.status,
      'project_name', l.project_name,
      'city', s.city,
      'owner_name', up.full_name,
      'created_at', l.created_at,
      'reasons', to_jsonb(d.reasons),
      'level', d.level,
      'distance_m', d.distance_m,
      'can_open', app.can_read_lead_row(l.organization_id, l.owner_user_id, l.id)
    ) order by (d.level = 'strong') desc, cardinality(d.reasons) desc), '[]'::jsonb)
  from app.find_duplicate_leads(p_phone, p_alternate_phone, p_email, p_project_name, p_builder_name, p_location, p_exclude_lead_id) d
  join public.leads l on l.id = d.lead_id
  join public.sites s on s.id = l.site_id
  left join public.user_profiles up on up.id = l.owner_user_id
$$;

-- -----------------------------------------------------------------------------
-- Lead score (mirrors packages/domain/src/lead-scoring.ts)
-- -----------------------------------------------------------------------------
create function app.score_lead(p_qualification jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := app.rule('lead.scoring');
  v_rule jsonb;
  v_value jsonb;
  v_matched boolean;
  v_total integer := 0;
  v_expl jsonb := '[]'::jsonb;
begin
  for v_rule in select * from jsonb_array_elements(coalesce(v_cfg -> 'rules', '[]'::jsonb)) loop
    v_value := p_qualification -> (v_rule ->> 'key');
    v_matched := case v_rule ->> 'when'
      when 'present' then v_value is not null and jsonb_typeof(v_value) <> 'null'
                          and not (jsonb_typeof(v_value) = 'string' and btrim(v_value #>> '{}') = '')
      when 'equals' then jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') = (v_rule ->> 'value')
      when 'in' then jsonb_typeof(v_value) = 'string' and (v_rule -> 'value') ? (v_value #>> '{}')
      else false end;
    v_matched := coalesce(v_matched, false);
    if v_matched then
      v_total := v_total + (v_rule ->> 'points')::integer;
    end if;
    v_expl := v_expl || jsonb_build_object('key', v_rule ->> 'key', 'points', case when v_matched then (v_rule ->> 'points')::integer else 0 end, 'matched', v_matched);
  end loop;
  return jsonb_build_object('score', greatest(0, least(coalesce((v_cfg ->> 'max')::integer, 100), v_total)), 'explanation', v_expl);
end;
$$;

-- -----------------------------------------------------------------------------
-- Seed: state transitions (generated from packages/domain/src/machines.ts)
-- -----------------------------------------------------------------------------
insert into public.state_transitions (machine, from_state, action, to_state, permission_code, requires_reason, audit_event) values
  ('lead', 'new', 'assign', 'assigned', 'lead.assign', false, 'lead.assigned'),
  ('lead', 'assigned', 'reassign', 'assigned', 'lead.assign', true, 'lead.reassigned'),
  ('lead', 'contacted', 'reassign', 'contacted', 'lead.assign', true, 'lead.reassigned'),
  ('lead', 'qualified', 'reassign', 'qualified', 'lead.assign', true, 'lead.reassigned'),
  ('lead', 'assigned', 'record_contact', 'contacted', 'lead.activity.record', false, 'lead.contacted'),
  ('lead', 'contacted', 'qualify', 'qualified', 'lead.qualify', false, 'lead.qualified'),
  ('lead', 'qualified', 'qualify', 'qualified', 'lead.qualify', false, 'lead.qualified'),
  ('lead', 'new', 'close_lost', 'lost', 'lead.close', true, 'lead.closed_lost'),
  ('lead', 'assigned', 'close_lost', 'lost', 'lead.close', true, 'lead.closed_lost'),
  ('lead', 'contacted', 'close_lost', 'lost', 'lead.close', true, 'lead.closed_lost'),
  ('lead', 'qualified', 'close_lost', 'lost', 'lead.close', true, 'lead.closed_lost'),
  ('lead', 'new', 'mark_invalid', 'invalid', 'lead.close', true, 'lead.marked_invalid'),
  ('lead', 'assigned', 'mark_invalid', 'invalid', 'lead.close', true, 'lead.marked_invalid'),
  ('lead', 'contacted', 'mark_invalid', 'invalid', 'lead.close', true, 'lead.marked_invalid'),
  ('lead', 'qualified', 'mark_won', 'won', 'order.convert', false, 'lead.won'),
  ('lead', 'lost', 'reopen', 'assigned', 'lead.assign', true, 'lead.reopened'),
  ('survey', 'scheduled', 'accept', 'accepted', 'survey.capture', false, 'survey.accepted'),
  ('survey', 'scheduled', 'request_reschedule', 'reschedule_requested', 'survey.capture', true, 'survey.reschedule_requested'),
  ('survey', 'accepted', 'request_reschedule', 'reschedule_requested', 'survey.capture', true, 'survey.reschedule_requested'),
  ('survey', 'scheduled', 'reschedule', 'scheduled', 'survey.schedule', false, 'survey.rescheduled'),
  ('survey', 'accepted', 'reschedule', 'scheduled', 'survey.schedule', false, 'survey.rescheduled'),
  ('survey', 'reschedule_requested', 'reschedule', 'scheduled', 'survey.schedule', false, 'survey.rescheduled'),
  ('survey', 'site_inaccessible', 'reschedule', 'scheduled', 'survey.schedule', false, 'survey.rescheduled'),
  ('survey', 'revisit_requested', 'reschedule', 'scheduled', 'survey.schedule', false, 'survey.rescheduled'),
  ('survey', 'revision_requested', 'reschedule', 'scheduled', 'survey.schedule', false, 'survey.rescheduled'),
  ('survey', 'scheduled', 'cancel', 'cancelled', 'survey.schedule', true, 'survey.cancelled'),
  ('survey', 'accepted', 'cancel', 'cancelled', 'survey.schedule', true, 'survey.cancelled'),
  ('survey', 'reschedule_requested', 'cancel', 'cancelled', 'survey.schedule', true, 'survey.cancelled'),
  ('survey', 'in_progress', 'cancel', 'cancelled', 'survey.schedule', true, 'survey.cancelled'),
  ('survey', 'site_inaccessible', 'cancel', 'cancelled', 'survey.schedule', true, 'survey.cancelled'),
  ('survey', 'revisit_requested', 'cancel', 'cancelled', 'survey.schedule', true, 'survey.cancelled'),
  ('survey', 'accepted', 'check_in', 'in_progress', 'survey.capture', false, 'survey.checked_in'),
  ('survey', 'in_progress', 'save_draft', 'in_progress', 'survey.capture', false, 'survey.draft_saved'),
  ('survey', 'accepted', 'report_inaccessible', 'site_inaccessible', 'survey.capture', true, 'survey.site_inaccessible'),
  ('survey', 'in_progress', 'report_inaccessible', 'site_inaccessible', 'survey.capture', true, 'survey.site_inaccessible'),
  ('survey', 'in_progress', 'request_revisit', 'revisit_requested', 'survey.capture', true, 'survey.revisit_requested'),
  ('survey', 'in_progress', 'submit', 'submitted', 'survey.capture', false, 'survey.submitted'),
  ('survey', 'submitted', 'request_revision', 'revision_requested', 'survey.review', true, 'survey.revision_requested'),
  ('survey', 'under_review', 'request_revision', 'revision_requested', 'survey.review', true, 'survey.revision_requested'),
  ('survey', 'revision_requested', 'start_revision', 'in_progress', 'survey.capture', false, 'survey.revision_started'),
  ('survey', 'submitted', 'start_review', 'under_review', 'technical.review', false, 'survey.review_started'),
  ('survey', 'under_review', 'complete_review', 'reviewed', 'technical.review', false, 'survey.review_completed');


-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create function public.search_possible_duplicates(
  p_phone text default null, p_alternate_phone text default null, p_email text default null,
  p_project_name text default null, p_builder_name text default null,
  p_latitude double precision default null, p_longitude double precision default null,
  p_exclude_lead_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_org uuid := app.aiec_org_id();
begin
  if not (app.user_has_permission(v_uid, 'lead.create', v_org) or app.user_has_permission(v_uid, 'lead.read_all', v_org)) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'lead.create'));
  end if;
  return app.duplicate_candidates_json(
    app.normalize_phone(p_phone), app.normalize_phone(p_alternate_phone),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    nullif(btrim(coalesce(p_project_name, '')), ''), nullif(btrim(coalesce(p_builder_name, '')), ''),
    app.geo_point(p_latitude, p_longitude), p_exclude_lead_id);
end;
$$;

-- SE02 New Lead. Payload keys are documented in docs/api-contracts.md.
create function public.create_lead(p_operation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_org uuid := app.aiec_org_id();
  v_replay jsonb;
  v_site jsonb := coalesce(p_payload -> 'site', '{}'::jsonb);
  v_phone text := app.normalize_phone(p_payload ->> 'phone');
  v_alt text := app.normalize_phone(p_payload ->> 'alternate_phone');
  v_email text := nullif(lower(btrim(coalesce(p_payload ->> 'email', ''))), '');
  v_project text := nullif(btrim(coalesce(p_payload ->> 'project_name', '')), '');
  v_builder text := nullif(btrim(coalesce(p_payload ->> 'builder_name', '')), '');
  v_city text := nullif(btrim(coalesce(v_site ->> 'city', '')), '');
  v_location extensions.geography;
  v_candidates jsonb;
  v_confirmed jsonb := coalesce(p_payload #> '{duplicate_review,confirmed_separate_from}', '[]'::jsonb);
  v_dup_reason text := nullif(btrim(coalesce(p_payload #>> '{duplicate_review,reason}', '')), '');
  v_unreviewed jsonb;
  v_assignee uuid := app.try_uuid(p_payload ->> 'assign_to');
  v_missing text[] := '{}';
  v_site_id uuid;
  v_lead public.leads;
  v_cand jsonb;
begin
  perform app.require_permission('lead.create', v_org);
  v_replay := app.op_begin(p_operation_id, 'lead.create');
  if v_replay is not null then
    return v_replay;
  end if;

  -- Format errors first: a mistyped number is more useful than "no contact method".
  if (p_payload ->> 'phone') is not null and btrim(p_payload ->> 'phone') <> '' and v_phone is null then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('phone')));
  end if;
  if (p_payload ->> 'email') is not null and btrim(p_payload ->> 'email') <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('email')));
  end if;
  -- Minimum capture (§37 SE02); unknown technical details stay unknown.
  if nullif(btrim(coalesce(p_payload ->> 'contact_name', '')), '') is null then v_missing := array_append(v_missing, 'contact_name'::text); end if;
  if v_project is null then v_missing := array_append(v_missing, 'project_name'::text); end if;
  if v_city is null then v_missing := array_append(v_missing, 'site.city'::text); end if;
  if nullif(btrim(coalesce(p_payload ->> 'lift_requirement', '')), '') is null then v_missing := array_append(v_missing, 'lift_requirement'::text); end if;
  if nullif(p_payload ->> 'source', '') is null then v_missing := array_append(v_missing, 'source'::text); end if;
  if v_phone is null and v_email is null then v_missing := array_append(v_missing, 'contact_method'::text); end if;
  if cardinality(v_missing) > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;
  if (p_payload ->> 'source') not in (select unnest(enum_range(null::public.lead_source))::text) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('source')));
  end if;
  if (p_payload ->> 'customer_type') is not null and (p_payload ->> 'customer_type') not in (select unnest(enum_range(null::public.customer_type))::text) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('customer_type')));
  end if;
  if nullif(p_payload ->> 'communication_preference', '') is not null and (p_payload ->> 'communication_preference') not in ('call', 'whatsapp', 'sms', 'email') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('communication_preference')));
  end if;
  if coalesce(app.jint(p_payload, 'floors_count'), 1) not between 1 and 200 or coalesce(app.jint(p_payload, 'stops_count'), 2) not between 2 and 200 then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('floors_count', 'stops_count')));
  end if;
  if nullif(btrim(coalesce(v_site ->> 'pincode', '')), '') !~ '^[1-9][0-9]{5}$' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('site.pincode')));
  end if;
  if coalesce(v_site ->> 'location_source', 'map_pin') not in ('map_pin', 'gps', 'geocoded') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('site.location_source')));
  end if;
  v_location := app.geo_point(app.jnum(v_site, 'latitude', 'site.latitude')::double precision, app.jnum(v_site, 'longitude', 'site.longitude')::double precision);

  -- Duplicate review: every candidate must be explicitly acknowledged.
  v_candidates := app.duplicate_candidates_json(v_phone, v_alt, v_email, v_project, v_builder, v_location, null);
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_unreviewed
    from jsonb_array_elements(v_candidates) c
   where not v_confirmed ? (c ->> 'lead_id');
  if jsonb_array_length(v_unreviewed) > 0 or (jsonb_array_length(v_candidates) > 0 and (v_dup_reason is null or length(v_dup_reason) < 3)) then
    perform app.raise_error('DUPLICATE_REVIEW_REQUIRED', jsonb_build_object('candidates', v_candidates));
  end if;

  -- Assignment: default to the creator; assigning to someone else needs lead.assign.
  if v_assignee is null and app.user_has_permission(v_uid, 'lead.read_assigned', v_org) then
    v_assignee := v_uid;
  elsif v_assignee is not null and v_assignee <> v_uid then
    perform app.require_permission('lead.assign', v_org);
  end if;
  if v_assignee is not null and not app.user_has_permission(v_assignee, 'lead.read_assigned', v_org) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('assign_to'), 'reason', 'assignee cannot own leads'));
  end if;

  insert into public.sites (organization_id, name, address_line, locality, city, zone, pincode, location, location_accuracy_m, location_source, created_by, updated_by)
  values (
    v_org,
    coalesce(nullif(btrim(coalesce(v_site ->> 'name', '')), ''), v_project),
    nullif(btrim(coalesce(v_site ->> 'address_line', '')), ''),
    nullif(btrim(coalesce(v_site ->> 'locality', '')), ''),
    v_city,
    nullif(btrim(coalesce(v_site ->> 'zone', '')), ''),
    nullif(btrim(coalesce(v_site ->> 'pincode', '')), ''),
    v_location,
    app.jnum(v_site, 'location_accuracy_m', 'site.location_accuracy_m'),
    case when v_location is null then 'unknown' else coalesce(nullif(v_site ->> 'location_source', ''), 'map_pin') end,
    v_uid, v_uid)
  returning id into v_site_id;

  insert into public.leads (
    lead_number, organization_id, status, contact_name, phone_e164, alternate_phone_e164, email, customer_type,
    builder_name, project_name, site_id, building_usage, floors_count, stops_count, lift_requirement,
    construction_stage, budget_range, expected_decision_date, source, referrer, decision_maker,
    communication_preference, marketing_consent, notes, owner_user_id, next_action_at, next_action_note,
    created_by, updated_by)
  values (
    app.next_business_id('LD', app.city_code(v_city)), v_org,
    case when v_assignee is null then 'new' else 'assigned' end::public.lead_state,
    btrim(p_payload ->> 'contact_name'), v_phone, v_alt, v_email,
    coalesce(nullif(p_payload ->> 'customer_type', ''), 'other')::public.customer_type,
    v_builder, v_project, v_site_id,
    nullif(btrim(coalesce(p_payload ->> 'building_usage', '')), ''),
    app.jint(p_payload, 'floors_count'), app.jint(p_payload, 'stops_count'),
    btrim(p_payload ->> 'lift_requirement'),
    nullif(btrim(coalesce(p_payload ->> 'construction_stage', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'budget_range', '')), ''),
    app.jdate(p_payload, 'expected_decision_date'),
    (p_payload ->> 'source')::public.lead_source,
    nullif(btrim(coalesce(p_payload ->> 'referrer', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'decision_maker', '')), ''),
    nullif(p_payload ->> 'communication_preference', ''),
    coalesce(app.jbool(p_payload, 'marketing_consent'), false),
    nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
    v_assignee,
    app.jts(p_payload, 'next_action_at'),
    nullif(btrim(coalesce(p_payload ->> 'next_action_note', '')), ''),
    v_uid, v_uid)
  returning * into v_lead;

  for v_cand in select * from jsonb_array_elements(v_candidates) loop
    insert into public.lead_duplicate_decisions (lead_id, candidate_lead_id, decision, match_reasons, reason, decided_by)
    values (v_lead.id, (v_cand ->> 'lead_id')::uuid, 'separate_opportunity',
            array(select jsonb_array_elements_text(v_cand -> 'reasons')), v_dup_reason, v_uid);
  end loop;

  perform app.audit(v_org, 'lead', v_lead.id, 'lead.created', null,
    jsonb_build_object('lead_number', v_lead.lead_number, 'status', v_lead.status, 'source', v_lead.source,
                       'duplicates_acknowledged', jsonb_array_length(v_candidates)),
    v_dup_reason, 'lead.create', p_operation_id);
  if v_assignee is not null then
    perform app.audit(v_org, 'lead', v_lead.id, 'lead.assigned', null, jsonb_build_object('owner_user_id', v_assignee), null, 'lead.create', p_operation_id);
    perform app.notify(v_assignee, v_org, 'lead.assigned', 'lead', v_lead.id, 'notification.lead_assigned',
      jsonb_build_object('lead_number', v_lead.lead_number), 'lead.assigned:' || v_lead.id || ':' || v_assignee || ':' || v_lead.version);
  else
    perform app.notify_permission_holders('lead.assign', v_org, 'lead.unassigned', 'lead', v_lead.id, 'notification.lead_unassigned',
      jsonb_build_object('lead_number', v_lead.lead_number), 'lead.unassigned:' || v_lead.id);
  end if;

  return app.op_finish(p_operation_id, v_lead.id, jsonb_build_object(
    'lead_id', v_lead.id, 'lead_number', v_lead.lead_number, 'status', v_lead.status,
    'owner_user_id', v_lead.owner_user_id, 'version', v_lead.version));
end;
$$;

-- Assign (new → assigned) or reassign (keeps state; reason required).
create function public.assign_lead(p_lead_id uuid, p_assignee_id uuid, p_expected_version integer, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.leads;
  v_new public.leads;
  v_t public.state_transitions;
begin
  select * into v_old from public.leads where id = p_lead_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  perform app.require_permission('lead.assign', v_old.organization_id);
  perform app.assert_version(p_expected_version, v_old.version);
  v_t := app.transition('lead', v_old.status::text, case when v_old.status = 'new' then 'assign' else 'reassign' end, p_reason);
  if p_assignee_id is null or not app.user_has_permission(p_assignee_id, 'lead.read_assigned', v_old.organization_id) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('assignee_id'), 'reason', 'assignee cannot own leads'));
  end if;
  if p_assignee_id = v_old.owner_user_id then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('assignee_id'), 'reason', 'already the owner'));
  end if;
  update public.leads set status = v_t.to_state::public.lead_state, owner_user_id = p_assignee_id
   where id = p_lead_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'lead', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status, 'owner_user_id', v_old.owner_user_id),
    jsonb_build_object('status', v_new.status, 'owner_user_id', v_new.owner_user_id), p_reason, v_t.permission_code);
  perform app.notify(p_assignee_id, v_new.organization_id, 'lead.assigned', 'lead', v_new.id, 'notification.lead_assigned',
    jsonb_build_object('lead_number', v_new.lead_number), 'lead.assigned:' || v_new.id || ':' || p_assignee_id || ':' || v_new.version);
  return jsonb_build_object('lead_id', v_new.id, 'status', v_new.status, 'owner_user_id', v_new.owner_user_id, 'version', v_new.version);
end;
$$;

-- Lead owner authority shared by activity / qualification / closure RPCs.
create function app.require_lead_owner(p_lead public.leads, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_permission, p_lead.organization_id);
  if p_lead.owner_user_id is distinct from auth.uid() then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'only the lead owner can perform this action'));
  end if;
end;
$$;

create function public.record_lead_activity(
  p_operation_id uuid, p_lead_id uuid, p_activity_type public.lead_activity_type, p_outcome public.call_outcome,
  p_summary text, p_occurred_at timestamptz, p_next_follow_up_at timestamptz, p_no_action_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_lead public.leads;
  v_new public.leads;
  v_activity_id uuid;
  v_meaningful boolean := p_outcome is not null and p_outcome <> 'no_answer';
  v_t public.state_transitions;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  perform app.require_lead_owner(v_lead, 'lead.activity.record');
  v_replay := app.op_begin(p_operation_id, 'lead.record_activity');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_lead.status not in ('assigned', 'contacted', 'qualified') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_lead.status, 'allowedActions', '[]'::jsonb));
  end if;
  if p_summary is null or length(btrim(p_summary)) < 2 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('summary')));
  end if;
  if p_occurred_at is null or p_occurred_at > now() + interval '10 minutes' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('occurred_at')));
  end if;
  -- Every active lead needs a next action or a documented reason (§7.6).
  if p_next_follow_up_at is null and length(btrim(coalesce(p_no_action_reason, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('next_follow_up_at')));
  end if;
  if p_next_follow_up_at is not null and p_next_follow_up_at <= p_occurred_at then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('next_follow_up_at')));
  end if;

  insert into public.lead_activities (lead_id, organization_id, activity_type, outcome, summary, occurred_at, next_follow_up_at, no_action_reason, created_by, operation_id)
  values (p_lead_id, v_lead.organization_id, p_activity_type, p_outcome, btrim(p_summary), p_occurred_at, p_next_follow_up_at, nullif(btrim(coalesce(p_no_action_reason, '')), ''), v_uid, p_operation_id)
  returning id into v_activity_id;

  if v_lead.status = 'assigned' and v_meaningful then
    v_t := app.transition('lead', 'assigned', 'record_contact');
  end if;
  update public.leads
     set status = coalesce(v_t.to_state::public.lead_state, status),
         first_contacted_at = case when v_meaningful then coalesce(first_contacted_at, p_occurred_at) else first_contacted_at end,
         next_action_at = p_next_follow_up_at,
         no_action_reason = case when p_next_follow_up_at is null then btrim(p_no_action_reason) end
   where id = p_lead_id returning * into v_new;

  perform app.audit(v_lead.organization_id, 'lead_activity', v_activity_id, 'lead.activity_recorded', null,
    jsonb_build_object('lead_id', p_lead_id, 'type', p_activity_type, 'outcome', p_outcome, 'next_follow_up_at', p_next_follow_up_at),
    null, 'lead.activity.record', p_operation_id);
  if v_t.to_state is not null then
    perform app.audit(v_lead.organization_id, 'lead', p_lead_id, v_t.audit_event,
      jsonb_build_object('status', v_lead.status), jsonb_build_object('status', v_new.status), null, v_t.permission_code, p_operation_id);
  end if;
  return app.op_finish(p_operation_id, v_activity_id, jsonb_build_object(
    'activity_id', v_activity_id, 'lead_id', p_lead_id, 'status', v_new.status, 'version', v_new.version));
end;
$$;

create function public.qualify_lead(
  p_lead_id uuid, p_expected_version integer, p_qualification jsonb,
  p_score_override integer default null, p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.leads;
  v_new public.leads;
  v_t public.state_transitions;
  v_score jsonb;
  v_missing text[] := '{}';
  v_key text;
begin
  select * into v_old from public.leads where id = p_lead_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  perform app.require_lead_owner(v_old, 'lead.qualify');
  perform app.assert_version(p_expected_version, v_old.version);
  v_t := app.transition('lead', v_old.status::text, 'qualify');
  if p_qualification is null or jsonb_typeof(p_qualification) <> 'object' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('qualification')));
  end if;
  foreach v_key in array array['need', 'decision_authority', 'timeline', 'next_action'] loop
    if length(btrim(coalesce(p_qualification ->> v_key, ''))) = 0 then
      v_missing := v_missing || v_key;
    end if;
  end loop;
  if cardinality(v_missing) > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;
  if p_score_override is not null and (p_score_override not between 0 and 100 or length(btrim(coalesce(p_override_reason, ''))) < 3) then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('override_reason')));
  end if;
  v_score := app.score_lead(p_qualification);
  update public.leads
     set status = v_t.to_state::public.lead_state,
         qualification = p_qualification,
         score_computed = (v_score ->> 'score')::integer,
         score = coalesce(p_score_override, (v_score ->> 'score')::integer),
         score_explanation = v_score -> 'explanation',
         score_override_reason = case when p_score_override is null then null else btrim(p_override_reason) end
   where id = p_lead_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'lead', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status, 'score', v_old.score, 'qualification', v_old.qualification),
    jsonb_build_object('status', v_new.status, 'score', v_new.score, 'score_computed', v_new.score_computed, 'qualification', v_new.qualification),
    p_override_reason, v_t.permission_code);
  return jsonb_build_object('lead_id', v_new.id, 'status', v_new.status, 'score', v_new.score,
    'score_computed', v_new.score_computed, 'score_explanation', v_new.score_explanation, 'version', v_new.version);
end;
$$;

create function public.close_lead(
  p_lead_id uuid, p_expected_version integer, p_outcome text, p_reason text, p_lost_reason public.lost_reason default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.leads;
  v_new public.leads;
  v_t public.state_transitions;
begin
  select * into v_old from public.leads where id = p_lead_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  perform app.require_lead_owner(v_old, 'lead.close');
  perform app.assert_version(p_expected_version, v_old.version);
  if p_outcome not in ('lost', 'invalid') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('outcome')));
  end if;
  v_t := app.transition('lead', v_old.status::text, case p_outcome when 'lost' then 'close_lost' else 'mark_invalid' end, p_reason);
  if p_outcome = 'lost' and p_lost_reason is null then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('lost_reason')));
  end if;
  update public.leads
     set status = v_t.to_state::public.lead_state,
         lost_reason = case when p_outcome = 'lost' then p_lost_reason end,
         closed_reason = btrim(p_reason),
         closed_at = now(),
         next_action_at = null
   where id = p_lead_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'lead', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new.status, 'lost_reason', v_new.lost_reason),
    p_reason, v_t.permission_code);
  return jsonb_build_object('lead_id', v_new.id, 'status', v_new.status, 'version', v_new.version);
end;
$$;

create function public.reopen_lead(p_lead_id uuid, p_expected_version integer, p_assignee_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.leads;
  v_new public.leads;
  v_t public.state_transitions;
begin
  select * into v_old from public.leads where id = p_lead_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  perform app.require_permission('lead.assign', v_old.organization_id);
  perform app.assert_version(p_expected_version, v_old.version);
  v_t := app.transition('lead', v_old.status::text, 'reopen', p_reason);
  if p_assignee_id is null or not app.user_has_permission(p_assignee_id, 'lead.read_assigned', v_old.organization_id) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('assignee_id')));
  end if;
  update public.leads
     set status = v_t.to_state::public.lead_state, owner_user_id = p_assignee_id,
         lost_reason = null, closed_reason = null, closed_at = null
   where id = p_lead_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'lead', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status, 'lost_reason', v_old.lost_reason, 'closed_reason', v_old.closed_reason),
    jsonb_build_object('status', v_new.status, 'owner_user_id', v_new.owner_user_id), p_reason, v_t.permission_code);
  perform app.notify(p_assignee_id, v_new.organization_id, 'lead.assigned', 'lead', v_new.id, 'notification.lead_assigned',
    jsonb_build_object('lead_number', v_new.lead_number), 'lead.assigned:' || v_new.id || ':' || p_assignee_id || ':' || v_new.version);
  return jsonb_build_object('lead_id', v_new.id, 'status', v_new.status, 'version', v_new.version);
end;
$$;

-- SE03 actions after creation: request ownership transfer or merge review.
create function public.record_duplicate_decision(p_lead_id uuid, p_candidate_lead_id uuid, p_decision text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_lead public.leads;
  v_id uuid;
  v_reasons text[];
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found or not app.can_read_lead_row(v_lead.organization_id, v_lead.owner_user_id, v_lead.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  if p_decision not in ('separate_opportunity', 'ownership_transfer_requested', 'merge_requested') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('decision')));
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  select d.reasons into v_reasons
    from public.sites s,
         lateral app.find_duplicate_leads(v_lead.phone_e164, v_lead.alternate_phone_e164, v_lead.email::text, v_lead.project_name, v_lead.builder_name, s.location, v_lead.id) d
   where s.id = v_lead.site_id and d.lead_id = p_candidate_lead_id;
  if v_reasons is null then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'records are not duplicate candidates'));
  end if;
  insert into public.lead_duplicate_decisions (lead_id, candidate_lead_id, decision, match_reasons, reason, decided_by)
  values (p_lead_id, p_candidate_lead_id, p_decision, v_reasons, btrim(p_reason), v_uid)
  returning id into v_id;
  perform app.audit(v_lead.organization_id, 'lead', p_lead_id, 'lead.duplicate_decision', null,
    jsonb_build_object('candidate_lead_id', p_candidate_lead_id, 'decision', p_decision, 'reasons', v_reasons), p_reason, null);
  if p_decision <> 'separate_opportunity' then
    perform app.notify_permission_holders(case when p_decision = 'merge_requested' then 'lead.merge' else 'lead.assign' end,
      v_lead.organization_id, 'lead.' || p_decision, 'lead', p_lead_id, 'notification.lead_' || p_decision,
      jsonb_build_object('lead_number', v_lead.lead_number, 'candidate_lead_id', p_candidate_lead_id), 'lead.' || p_decision || ':' || v_id);
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.state_transitions enable row level security;
alter table public.sites enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.lead_duplicate_decisions enable row level security;

create policy state_transitions_read on public.state_transitions for select to authenticated using (true);
create policy sites_read on public.sites for select to authenticated using (app.can_read_site(id));
create policy leads_read on public.leads for select to authenticated using (app.can_read_lead_row(organization_id, owner_user_id, id));
create policy lead_activities_read on public.lead_activities for select to authenticated using (app.can_read_lead_sales_history(lead_id));
create policy lead_duplicate_decisions_read on public.lead_duplicate_decisions for select to authenticated using (app.can_read_lead_sales_history(lead_id));

revoke all on public.state_transitions, public.sites, public.leads, public.lead_activities, public.lead_duplicate_decisions from anon, authenticated;
grant select on public.state_transitions, public.sites, public.leads, public.lead_activities, public.lead_duplicate_decisions to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.search_possible_duplicates(text, text, text, text, text, double precision, double precision, uuid),
  public.create_lead(uuid, jsonb),
  public.assign_lead(uuid, uuid, integer, text),
  public.record_lead_activity(uuid, uuid, public.lead_activity_type, public.call_outcome, text, timestamptz, timestamptz, text),
  public.qualify_lead(uuid, integer, jsonb, integer, text),
  public.close_lead(uuid, integer, text, text, public.lost_reason),
  public.reopen_lead(uuid, integer, uuid, text),
  public.record_duplicate_decision(uuid, uuid, text, text)
  to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function
  app.current_user_id(), app.is_active_user(uuid), app.aiec_org_id(),
  app.user_has_permission(uuid, text, uuid), app.has_permission(text, uuid), app.is_member(uuid),
  app.can_read_profile(uuid), app.can_read_org_people(uuid), app.try_uuid(text),
  app.can_read_lead_row(uuid, uuid, uuid), app.can_read_lead(uuid), app.can_read_lead_sales_history(uuid), app.can_read_site(uuid)
  to authenticated;

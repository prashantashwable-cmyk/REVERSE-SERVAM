-- =============================================================================
-- Slice 3: technical review (Gate 2), lift configuration revisions, controlled
-- technical documents, quotations with server-side economics and discount
-- governance (Gate 3), Owner approval center, customer acceptance bound to an
-- exact quotation revision.
--
-- Mirrors packages/domain (technicalReviewMachine, documentRevisionMachine,
-- quotationMachine, checkConfiguration, computeQuotation,
-- evaluateDiscountAuthority); supabase/tests/test/parity.test.ts keeps them equal.
-- =============================================================================

create type public.technical_review_state as enum (
  'open', 'in_review', 'clarification_requested', 'feasible', 'conditionally_feasible', 'not_feasible', 'insufficient_information');
create type public.document_kind as enum (
  'general_arrangement', 'shaft_layout', 'structural_interface', 'electrical', 'manufacturer',
  'bill_of_materials', 'installation_method', 'technical_specification');
create type public.document_revision_state as enum ('draft', 'in_review', 'approved', 'rejected', 'superseded');
create type public.quotation_state as enum (
  'draft', 'pending_approval', 'approved', 'issued', 'accepted', 'rejected_by_customer', 'superseded', 'expired');
create type public.quotation_line_category as enum (
  'lift_equipment', 'cabin_finishes', 'door_system', 'controller_drive', 'installation',
  'transport_handling', 'electrical_civil_interface', 'additional_option', 'other_charge');

-- -----------------------------------------------------------------------------
-- State transitions (generated from packages/domain machines)
-- -----------------------------------------------------------------------------
insert into public.state_transitions (machine, from_state, action, to_state, permission_code, requires_reason, audit_event) values
  ('technical_review', 'open', 'start', 'in_review', 'technical.review', false, 'technical_review.started'),
  ('technical_review', 'in_review', 'request_clarification', 'clarification_requested', 'technical.review', true, 'technical_review.clarification_requested'),
  ('technical_review', 'clarification_requested', 'resume', 'in_review', 'technical.review', false, 'technical_review.resumed'),
  ('technical_review', 'insufficient_information', 'resume', 'in_review', 'technical.review', false, 'technical_review.resumed'),
  ('technical_review', 'in_review', 'decide_feasible', 'feasible', 'technical.review', false, 'technical_review.decided'),
  ('technical_review', 'in_review', 'decide_conditional', 'conditionally_feasible', 'technical.review', false, 'technical_review.decided'),
  ('technical_review', 'in_review', 'decide_not_feasible', 'not_feasible', 'technical.review', true, 'technical_review.decided'),
  ('technical_review', 'in_review', 'decide_insufficient', 'insufficient_information', 'technical.review', true, 'technical_review.decided'),
  ('document_revision', 'draft', 'submit_for_review', 'in_review', 'technical.review', false, 'document.submitted'),
  ('document_revision', 'in_review', 'approve', 'approved', 'technical.drawing.approve', false, 'document.approved'),
  ('document_revision', 'in_review', 'reject', 'rejected', 'technical.drawing.approve', true, 'document.rejected'),
  ('document_revision', 'approved', 'supersede', 'superseded', 'technical.drawing.approve', false, 'document.superseded'),
  ('quotation', 'draft', 'finalize', 'approved', 'quotation.create', false, 'quotation.finalized'),
  ('quotation', 'draft', 'request_approval', 'pending_approval', 'quotation.create', false, 'quotation.approval_requested'),
  ('quotation', 'pending_approval', 'approve', 'approved', 'quotation.discount.approve', false, 'quotation.approved'),
  ('quotation', 'pending_approval', 'return_to_draft', 'draft', 'quotation.discount.approve', true, 'quotation.approval_rejected'),
  ('quotation', 'approved', 'issue', 'issued', 'quotation.issue', false, 'quotation.issued'),
  ('quotation', 'issued', 'accept', 'accepted', 'customer.approval.decide', false, 'quotation.accepted'),
  ('quotation', 'issued', 'record_acceptance', 'accepted', 'quotation.issue', false, 'quotation.accepted'),
  ('quotation', 'issued', 'record_customer_rejection', 'rejected_by_customer', 'quotation.issue', true, 'quotation.rejected_by_customer'),
  ('quotation', 'draft', 'supersede', 'superseded', 'quotation.create', false, 'quotation.superseded'),
  ('quotation', 'pending_approval', 'supersede', 'superseded', 'quotation.create', false, 'quotation.superseded'),
  ('quotation', 'approved', 'supersede', 'superseded', 'quotation.create', false, 'quotation.superseded'),
  ('quotation', 'issued', 'supersede', 'superseded', 'quotation.create', false, 'quotation.superseded'),
  ('quotation', 'issued', 'expire', 'expired', 'quotation.issue', false, 'quotation.expired');

-- -----------------------------------------------------------------------------
-- Launch defaults (Decision Register D-004, D-005, D-011, D-021). Changed only
-- as new versions of the business rule (audited); values equal packages/domain.
-- -----------------------------------------------------------------------------
insert into public.business_rules (rule_key, version, value, audience, reason) values
  ('technical.configuration_catalogue', 1, '{"version":1,"categories":["passenger","goods","hospital","home"],"parameters":[{"key":"rated_load_kg","kind":"number","unit":"kg","min":50,"max":10000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"persons","kind":"number","min":1,"max":50,"requiredFor":["passenger","hospital","home"]},{"key":"rated_speed_mps","kind":"number","unit":"m/s","min":0.1,"max":10,"requiredFor":["passenger","goods","hospital","home"]},{"key":"floors","kind":"number","min":2,"max":200,"requiredFor":["passenger","goods","hospital","home"]},{"key":"stops","kind":"number","min":2,"max":200,"requiredFor":["passenger","goods","hospital","home"]},{"key":"travel_mm","kind":"number","unit":"mm","min":1000,"max":500000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"drive_type","kind":"choice","choices":["traction_mrl","traction_machine_room","hydraulic"],"requiredFor":["passenger","goods","hospital","home"]},{"key":"machine_room","kind":"choice","choices":["mrl","machine_room_top","machine_room_bottom"],"requiredFor":["passenger","goods","hospital","home"]},{"key":"car_width_mm","kind":"number","unit":"mm","min":500,"max":5000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"car_depth_mm","kind":"number","unit":"mm","min":500,"max":6000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"car_height_mm","kind":"number","unit":"mm","min":1800,"max":4000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"shaft_width_mm","kind":"number","unit":"mm","min":700,"max":6000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"shaft_depth_mm","kind":"number","unit":"mm","min":700,"max":7000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"pit_depth_mm","kind":"number","unit":"mm","min":0,"max":5000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"overhead_mm","kind":"number","unit":"mm","min":1500,"max":8000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"door_type","kind":"choice","choices":["centre_opening","side_opening","swing","collapsible"],"requiredFor":["passenger","goods","hospital","home"]},{"key":"door_width_mm","kind":"number","unit":"mm","min":500,"max":4000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"door_height_mm","kind":"number","unit":"mm","min":1800,"max":4000,"requiredFor":["passenger","goods","hospital","home"]},{"key":"controller","kind":"text","requiredFor":[]},{"key":"cabin_finish","kind":"text","requiredFor":[]},{"key":"power_supply","kind":"choice","choices":["three_phase_415v","single_phase_230v"],"requiredFor":["passenger","goods","hospital","home"]},{"key":"safety_equipment","kind":"text","requiredFor":[]},{"key":"manufacturer","kind":"text","requiredFor":[]},{"key":"model","kind":"text","requiredFor":[]},{"key":"design_references","kind":"text","requiredFor":[]}]}', 'aiec_staff', 'Launch lift configuration catalogue (D-021); engineering values are captured, never calculated'),
  ('commercial.tax_codes', 1, '{"codes":[{"code":"GST18","rateBps":1800}]}', 'aiec_staff', 'Launch placeholder tax code; Finance must confirm rates (D-011)'),
  ('quotation.discount_policy', 1, '{"maxDiscountBpsWithoutApproval":500,"marginFloorBps":1500}', 'aiec_staff', 'Launch default discount authority 5% and margin floor 15% pending Owner decision (D-004, D-005)'),
  ('quotation.validity', 1, '{"days":30}', 'aiec_staff', 'Launch default quotation validity (D-022)');

-- =============================================================================
-- Technical review (TE01–TE02, §9.3–9.4)
-- =============================================================================
create table public.technical_reviews (
  id uuid primary key default gen_random_uuid(),
  review_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null references public.leads (id),
  survey_id uuid not null references public.surveys (id),
  -- The exact submitted survey revision this review is based on ("review version").
  survey_revision_id uuid not null references public.survey_revisions (id),
  status public.technical_review_state not null default 'open',
  reviewer_id uuid references public.user_profiles (id),
  technical_basis text,
  assumptions text,
  references_text text,
  constraints text[] not null default '{}',
  corrective_actions text[] not null default '{}',
  decision_reason text,
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check (status not in ('feasible', 'conditionally_feasible', 'not_feasible', 'insufficient_information')
         or (decided_at is not null and decided_by is not null and length(btrim(coalesce(technical_basis, ''))) >= 3)),
  check (status <> 'conditionally_feasible' or (cardinality(constraints) > 0 and cardinality(corrective_actions) > 0))
);
create unique index technical_reviews_one_active on public.technical_reviews (survey_id)
  where status in ('open', 'in_review', 'clarification_requested', 'insufficient_information');
create index technical_reviews_lead_idx on public.technical_reviews (lead_id);
create index technical_reviews_status_idx on public.technical_reviews (organization_id, status);
create trigger technical_reviews_touch before update on public.technical_reviews for each row execute function app.touch_row();

-- A final decision (feasible / conditional / not feasible) is a record: never edited.
create function app.guard_technical_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status in ('feasible', 'conditionally_feasible', 'not_feasible') then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'technical decisions are immutable'));
  end if;
  return new;
end;
$$;
create trigger technical_reviews_guard before update or delete on public.technical_reviews
  for each row execute function app.guard_technical_review();

-- =============================================================================
-- Lift configuration revisions (TE03, §9.5)
-- =============================================================================
create table public.configuration_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null references public.leads (id),
  technical_review_id uuid not null references public.technical_reviews (id),
  revision_no integer not null check (revision_no > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  lift_category text,
  -- { "<parameter>": { "value": <number|text>, "status": "proposed" | "reviewed" | "approved" } }
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  change_summary text,
  warnings jsonb not null default '[]'::jsonb,
  checksum text check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),
  approved_by uuid references public.user_profiles (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (lead_id, revision_no),
  check ((status = 'draft') = (approved_at is null)),
  check (status = 'draft' or (checksum is not null and approved_by is not null))
);
create unique index configuration_revisions_one_draft on public.configuration_revisions (lead_id) where status = 'draft';
create unique index configuration_revisions_one_approved on public.configuration_revisions (lead_id) where status = 'approved';
create trigger configuration_revisions_touch before update on public.configuration_revisions for each row execute function app.touch_row();

-- Approved configuration content is frozen; the only later change is approved → superseded.
create function app.guard_configuration_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'configuration revisions are kept'));
  end if;
  if old.status = 'superseded'
     or (old.status = 'approved' and (new.status <> 'superseded' or new.parameters <> old.parameters
         or new.lift_category is distinct from old.lift_category or new.checksum is distinct from old.checksum)) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'approved configuration revisions are immutable'));
  end if;
  return new;
end;
$$;
create trigger configuration_revisions_guard before update or delete on public.configuration_revisions
  for each row execute function app.guard_configuration_revision();

-- Same rules as packages/domain checkConfiguration (parity-tested).
create function app.config_number(p_value jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then null
    when jsonb_typeof(p_value) = 'number' then (p_value #>> '{}')::numeric
    when jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p_value #>> '{}')::numeric
    else null
  end
$$;

create function app.config_present(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null and jsonb_typeof(p_value) <> 'null'
     and not (jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') = '')
$$;

create function app.configuration_check(p_category text, p_values jsonb, p_survey_mm jsonb default '{}'::jsonb, p_open_constraints integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cat jsonb := app.rule('technical.configuration_catalogue');
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_p jsonb;
  v_val jsonb;
  v_num numeric;
  v_missing text[] := '{}';
  v_invalid text[];
  v_failures jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_fit record;
  v_surveyed numeric;
begin
  if p_category is null or not ((v_cat -> 'categories') ? p_category) then
    return jsonb_build_object('failures', jsonb_build_array(jsonb_build_object(
      'code', 'REQUIRED_FIELD_MISSING', 'message', 'Lift category is required', 'messageKey', 'gate2.category_missing',
      'fields', jsonb_build_array('lift_category'))), 'warnings', '[]'::jsonb);
  end if;
  select coalesce(array_agg(k order by k collate "C"), '{}') into v_invalid
  from jsonb_object_keys(v_values) k
  where not exists (select 1 from jsonb_array_elements(v_cat -> 'parameters') p where p ->> 'key' = k);

  for v_p in select * from jsonb_array_elements(v_cat -> 'parameters') loop
    v_val := v_values -> (v_p ->> 'key');
    if not app.config_present(v_val) then
      if (v_p -> 'requiredFor') ? p_category then v_missing := v_missing || (v_p ->> 'key'); end if;
      continue;
    end if;
    if v_p ->> 'kind' = 'number' then
      v_num := app.config_number(v_val);
      if v_num is null or (v_p ? 'min' and v_num < (v_p ->> 'min')::numeric) or (v_p ? 'max' and v_num > (v_p ->> 'max')::numeric) then
        v_invalid := v_invalid || (v_p ->> 'key');
      end if;
    elsif v_p ->> 'kind' = 'choice' then
      if not ((v_p -> 'choices') ? (v_val #>> '{}')) then v_invalid := v_invalid || (v_p ->> 'key'); end if;
    elsif length(btrim(v_val #>> '{}')) > 500 then
      v_invalid := v_invalid || (v_p ->> 'key');
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object('code', 'REQUIRED_FIELD_MISSING', 'message', 'Required configuration parameters missing',
      'messageKey', 'gate2.parameters_missing', 'fields', (select jsonb_agg('config.' || k order by o) from unnest(v_missing) with ordinality u(k, o))));
  end if;
  if cardinality(v_invalid) > 0 then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object('code', 'VALIDATION_FAILED', 'message', 'Configuration parameters out of range or not recognised',
      'messageKey', 'gate2.parameters_invalid', 'fields', (select jsonb_agg('config.' || k order by o) from unnest(v_invalid) with ordinality u(k, o))));
  end if;

  if not app.config_present(v_values -> 'manufacturer') or not app.config_present(v_values -> 'model') then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('key', 'manufacturer', 'messageKey', 'gate2.warn_manufacturer', 'params', '{}'::jsonb));
  end if;
  if coalesce(p_open_constraints, 0) > 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('key', 'constraints', 'messageKey', 'gate2.warn_constraints', 'params', jsonb_build_object('count', p_open_constraints)));
  end if;
  for v_fit in select * from (values (1, 'shaft_width_mm', 'shaft_width'), (2, 'shaft_depth_mm', 'shaft_depth'), (3, 'pit_depth_mm', 'pit_depth'), (4, 'overhead_mm', 'overhead')) f(o, config_key, survey_key) order by o loop
    v_num := app.config_number(v_values -> v_fit.config_key);
    v_surveyed := app.config_number(coalesce(p_survey_mm, '{}'::jsonb) -> v_fit.survey_key);
    if v_num is not null and v_surveyed is not null and v_num > v_surveyed then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('key', v_fit.config_key, 'messageKey', 'gate2.warn_exceeds_survey',
        'params', jsonb_build_object('parameter', v_fit.config_key, 'value', v_num, 'surveyed', v_surveyed)));
    end if;
  end loop;
  return jsonb_build_object('failures', v_failures, 'warnings', v_warnings);
end;
$$;

-- =============================================================================
-- Shared helpers
-- =============================================================================
create function app.lead_city_code(p_lead_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.city_code(s.city) from public.leads l join public.sites s on s.id = l.site_id where l.id = p_lead_id
$$;

-- Technical staff read technical records of their organization; sales reads them through the lead.
create function app.can_read_technical(p_org uuid, p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'technical.review', p_org)
      or app.user_has_permission(auth.uid(), 'survey.read_all', p_org)
      or app.can_read_lead(p_lead_id)
$$;

-- Surveyed measurements (mm) of a survey revision, as { key: value_mm } (first level wins).
create function app.survey_mm(p_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, value_mm), '{}'::jsonb)
  from (select distinct on (key) key, value_mm from public.survey_measurements where revision_id = p_revision_id order by key, level_label) m
$$;

create function app.text_array(p_value jsonb, p_field text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text[] := '{}';
  v_item jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return v_out; end if;
  if jsonb_typeof(p_value) <> 'array' then perform app.j_field_error(p_field); end if;
  for v_item in select * from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item) <> 'string' or length(v_item #>> '{}') > 1000 then perform app.j_field_error(p_field); end if;
    if btrim(v_item #>> '{}') <> '' then v_out := v_out || btrim(v_item #>> '{}'); end if;
  end loop;
  return v_out;
end;
$$;

-- Opens a new draft survey revision (copy of the current one) and returns the survey
-- to the surveyor; used by clarification requests and "insufficient information".
create function app.open_survey_revision(p_survey_id uuid, p_reason text, p_permission text)
returns public.surveys
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.surveys;
  v_new public.surveys;
  v_t public.state_transitions;
  v_prev public.survey_revisions;
  v_rev_id uuid;
begin
  select * into v_old from public.surveys where id = p_survey_id for update;
  v_t := app.transition('survey', v_old.status::text, 'request_revision', p_reason);
  select * into v_prev from public.survey_revisions where id = v_old.current_revision_id;
  insert into public.survey_revisions (survey_id, revision_no, data, revision_reason, created_by, updated_by)
  values (p_survey_id, v_prev.revision_no + 1, v_prev.data, btrim(p_reason), v_uid, v_uid)
  returning id into v_rev_id;
  insert into public.survey_measurements (revision_id, key, value_mm, entered_value, entered_unit, level_label, note)
  select v_rev_id, key, value_mm, entered_value, entered_unit, level_label, note from public.survey_measurements where revision_id = v_prev.id;
  update public.surveys set status = v_t.to_state::public.survey_state, current_revision_id = v_rev_id, status_reason = btrim(p_reason)
   where id = p_survey_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'survey', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status, 'revision_id', v_prev.id),
    jsonb_build_object('status', v_new.status, 'revision_id', v_rev_id, 'revision_no', v_prev.revision_no + 1), p_reason, coalesce(p_permission, v_t.permission_code));
  perform app.notify(v_new.surveyor_id, v_new.organization_id, 'survey.revision_requested', 'survey', v_new.id, 'notification.survey_revision_requested',
    jsonb_build_object('survey_number', v_new.survey_number, 'reason', p_reason), 'survey.revision_requested:' || v_rev_id);
  return v_new;
end;
$$;

-- The Slice 2 "return for revision" action now also keeps an open technical review in step.
create or replace function public.request_survey_revision(p_survey_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.surveys := app.lock_survey(p_survey_id);
  v_new public.surveys;
  v_review public.technical_reviews;
  v_t public.state_transitions;
begin
  perform app.require_permission('survey.review', v_old.organization_id);
  perform app.assert_version(p_expected_version, v_old.version);
  v_new := app.open_survey_revision(p_survey_id, p_reason, 'survey.review');
  select * into v_review from public.technical_reviews where survey_id = p_survey_id and status = 'in_review' for update;
  if found then
    v_t := app.transition('technical_review', 'in_review', 'request_clarification', p_reason);
    update public.technical_reviews set status = 'clarification_requested', decision_reason = btrim(p_reason) where id = v_review.id;
    perform app.audit(v_review.organization_id, 'technical_review', v_review.id, v_t.audit_event,
      jsonb_build_object('status', 'in_review'), jsonb_build_object('status', 'clarification_requested'), p_reason, 'survey.review');
  end if;
  return app.survey_json(v_new);
end;
$$;

-- =============================================================================
-- Technical review RPCs
-- =============================================================================
create function app.review_json(r public.technical_reviews)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('review_id', r.id, 'review_number', r.review_number, 'status', r.status, 'lead_id', r.lead_id,
    'survey_id', r.survey_id, 'survey_revision_id', r.survey_revision_id, 'version', r.version)
$$;

create function app.lock_review(p_review_id uuid)
returns public.technical_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.technical_reviews;
begin
  select * into v from public.technical_reviews where id = p_review_id for update;
  if not found or not app.can_read_technical(v.organization_id, v.lead_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'technical_review'));
  end if;
  return v;
end;
$$;

-- TE01 → TE02: open (or resume) the review of a submitted survey.
create function public.start_technical_review(p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_s public.surveys := app.lock_survey(p_survey_id);
  v_s_new public.surveys;
  v_st public.state_transitions;
  v_rt public.state_transitions;
  v_r public.technical_reviews;
  v_from text;
begin
  perform app.require_permission('technical.review', v_s.organization_id);
  v_st := app.transition('survey', v_s.status::text, 'start_review');
  update public.surveys set status = v_st.to_state::public.survey_state where id = p_survey_id returning * into v_s_new;
  perform app.audit(v_s.organization_id, 'survey', v_s.id, v_st.audit_event, jsonb_build_object('status', v_s.status),
    jsonb_build_object('status', v_s_new.status), null, v_st.permission_code);

  select * into v_r from public.technical_reviews
   where survey_id = p_survey_id and status in ('open', 'in_review', 'clarification_requested', 'insufficient_information') for update;
  if found then
    v_from := v_r.status::text;
    v_rt := app.transition('technical_review', v_from, 'resume');
    update public.technical_reviews
       set status = 'in_review', survey_revision_id = v_s.current_revision_id, reviewer_id = v_uid,
           decided_by = null, decided_at = null, decision_reason = null
     where id = v_r.id returning * into v_r;
  else
    insert into public.technical_reviews (review_number, organization_id, lead_id, survey_id, survey_revision_id, status, reviewer_id, created_by, updated_by)
    values (app.next_business_id('TR', app.lead_city_code(v_s.lead_id)), v_s.organization_id, v_s.lead_id, p_survey_id,
            v_s.current_revision_id, 'open', v_uid, v_uid, v_uid)
    returning * into v_r;
    v_from := 'open';
    v_rt := app.transition('technical_review', v_from, 'start');
    update public.technical_reviews set status = 'in_review' where id = v_r.id returning * into v_r;
  end if;
  perform app.audit(v_r.organization_id, 'technical_review', v_r.id, v_rt.audit_event, jsonb_build_object('status', v_from),
    jsonb_build_object('status', v_r.status, 'survey_revision_id', v_r.survey_revision_id), null, v_rt.permission_code);
  return app.review_json(v_r);
end;
$$;

-- TE03 Clarification queue: back to the surveyor with a reason (new survey revision).
create function public.request_technical_clarification(p_review_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.technical_reviews := app.lock_review(p_review_id);
  v_t public.state_transitions;
begin
  perform app.require_permission('technical.review', v_r.organization_id);
  perform app.assert_version(p_expected_version, v_r.version);
  v_t := app.transition('technical_review', v_r.status::text, 'request_clarification', p_reason);
  perform app.open_survey_revision(v_r.survey_id, p_reason, 'technical.review');
  update public.technical_reviews set status = v_t.to_state::public.technical_review_state, decision_reason = btrim(p_reason)
   where id = p_review_id returning * into v_r;
  perform app.audit(v_r.organization_id, 'technical_review', v_r.id, v_t.audit_event, jsonb_build_object('status', 'in_review'),
    jsonb_build_object('status', v_r.status), p_reason, v_t.permission_code);
  return app.review_json(v_r);
end;
$$;

-- TE02 decision: feasible / conditionally feasible / not feasible / insufficient information.
create function public.decide_technical_review(p_review_id uuid, p_expected_version integer, p_decision text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.technical_reviews := app.lock_review(p_review_id);
  v_r public.technical_reviews;
  v_t public.state_transitions;
  v_st public.state_transitions;
  v_s public.surveys;
  v_action text := case p_decision
    when 'feasible' then 'decide_feasible' when 'conditionally_feasible' then 'decide_conditional'
    when 'not_feasible' then 'decide_not_feasible' when 'insufficient_information' then 'decide_insufficient' end;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_basis text := nullif(btrim(coalesce(v_payload ->> 'technical_basis', '')), '');
  v_reason text := nullif(btrim(coalesce(v_payload ->> 'reason', '')), '');
  v_constraints text[] := app.text_array(v_payload -> 'constraints', 'constraints');
  v_actions text[] := app.text_array(v_payload -> 'corrective_actions', 'corrective_actions');
  v_missing text[] := '{}';
  v_lead public.leads;
begin
  perform app.require_permission('technical.review', v_old.organization_id);
  perform app.assert_version(p_expected_version, v_old.version);
  if v_action is null then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('decision')));
  end if;
  v_t := app.transition('technical_review', v_old.status::text, v_action, v_reason);
  select * into v_s from public.surveys where id = v_old.survey_id for update;
  if v_s.status <> 'under_review' or v_s.current_revision_id <> v_old.survey_revision_id
     or not exists (select 1 from public.survey_revisions where id = v_old.survey_revision_id and status = 'submitted') then
    -- Gate 1 must hold for exactly the revision being decided.
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'the reviewed survey revision is not the current submitted revision'));
  end if;
  if v_basis is null or length(v_basis) < 3 then v_missing := v_missing || 'technical_basis'::text; end if;
  if v_action = 'decide_conditional' then
    if cardinality(v_constraints) = 0 then v_missing := v_missing || 'constraints'::text; end if;
    if cardinality(v_actions) = 0 then v_missing := v_missing || 'corrective_actions'::text; end if;
  end if;
  if cardinality(v_missing) > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;

  update public.technical_reviews
     set status = v_t.to_state::public.technical_review_state, technical_basis = v_basis,
         assumptions = nullif(btrim(coalesce(v_payload ->> 'assumptions', '')), ''),
         references_text = nullif(btrim(coalesce(v_payload ->> 'references', '')), ''),
         constraints = v_constraints, corrective_actions = v_actions, decision_reason = v_reason,
         decided_by = v_uid, decided_at = now()
   where id = p_review_id returning * into v_r;

  if v_action = 'decide_insufficient' then
    perform app.open_survey_revision(v_r.survey_id, v_reason, 'technical.review');
  else
    v_st := app.transition('survey', 'under_review', 'complete_review');
    update public.surveys set status = v_st.to_state::public.survey_state where id = v_s.id;
    perform app.audit(v_s.organization_id, 'survey', v_s.id, v_st.audit_event, jsonb_build_object('status', 'under_review'),
      jsonb_build_object('status', v_st.to_state), null, v_st.permission_code);
  end if;
  perform app.audit(v_r.organization_id, 'technical_review', v_r.id, v_t.audit_event, jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', v_r.status, 'technical_basis', v_basis, 'constraints', v_constraints, 'corrective_actions', v_actions,
      'survey_revision_id', v_r.survey_revision_id), v_reason, v_t.permission_code);
  select * into v_lead from public.leads where id = v_r.lead_id;
  if v_lead.owner_user_id is not null then
    perform app.notify(v_lead.owner_user_id, v_r.organization_id, 'technical.decided', 'lead', v_lead.id, 'notification.technical_decided',
      jsonb_build_object('lead_number', v_lead.lead_number, 'review_number', v_r.review_number, 'decision', v_r.status),
      'technical.decided:' || v_r.id || ':' || v_r.version);
  end if;
  return app.review_json(v_r);
end;
$$;

-- =============================================================================
-- Configuration RPCs (TE03)
-- =============================================================================
create function app.config_values(p_parameters jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, value -> 'value'), '{}'::jsonb) from jsonb_each(coalesce(p_parameters, '{}'::jsonb))
$$;

create function app.configuration_json(c public.configuration_revisions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('configuration_revision_id', c.id, 'lead_id', c.lead_id, 'revision_no', c.revision_no, 'status', c.status,
    'version', c.version, 'checksum', c.checksum, 'warnings', c.warnings)
$$;

-- The review a configuration builds on: the latest decided-feasible one, else the one in review.
create function app.config_review(p_lead_id uuid, p_decided_only boolean)
returns public.technical_reviews
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.technical_reviews
  where lead_id = p_lead_id
    and (status in ('feasible', 'conditionally_feasible') or (not p_decided_only and status = 'in_review'))
  order by (status in ('feasible', 'conditionally_feasible')) desc, coalesce(decided_at, updated_at) desc
  limit 1
$$;

create function public.save_configuration_draft(
  p_lead_id uuid, p_expected_version integer, p_lift_category text, p_parameters jsonb, p_change_summary text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_review public.technical_reviews := app.config_review(p_lead_id, false);
  v_draft public.configuration_revisions;
  v_key text;
  v_item jsonb;
  v_params jsonb := coalesce(p_parameters, '{}'::jsonb);
begin
  if v_review.id is null then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'a technical review in progress or a feasible decision is required'));
  end if;
  perform app.require_permission('technical.review', v_review.organization_id);
  if jsonb_typeof(v_params) <> 'object' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('parameters')));
  end if;
  for v_key, v_item in select * from jsonb_each(v_params) loop
    if v_key !~ '^[a-z][a-z0-9_]{0,60}$' or jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item -> 'value'), 'null') not in ('number', 'string', 'null')
       or coalesce(v_item ->> 'status', 'proposed') not in ('proposed', 'reviewed') then
      -- "approved" is set only by approve_configuration.
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('config.' || v_key)));
    end if;
  end loop;
  select * into v_draft from public.configuration_revisions where lead_id = p_lead_id and status = 'draft' for update;
  if found then
    perform app.assert_version(p_expected_version, v_draft.version);
    update public.configuration_revisions
       set lift_category = nullif(btrim(coalesce(p_lift_category, '')), ''), parameters = v_params,
           change_summary = nullif(btrim(coalesce(p_change_summary, '')), ''), technical_review_id = v_review.id
     where id = v_draft.id returning * into v_draft;
  else
    insert into public.configuration_revisions (organization_id, lead_id, technical_review_id, revision_no, lift_category, parameters, change_summary, created_by, updated_by)
    values (v_review.organization_id, p_lead_id, v_review.id,
            coalesce((select max(revision_no) from public.configuration_revisions where lead_id = p_lead_id), 0) + 1,
            nullif(btrim(coalesce(p_lift_category, '')), ''), v_params, nullif(btrim(coalesce(p_change_summary, '')), ''), v_uid, v_uid)
    returning * into v_draft;
  end if;
  perform app.audit(v_draft.organization_id, 'configuration_revision', v_draft.id, 'configuration.saved', null,
    jsonb_build_object('revision_no', v_draft.revision_no, 'lift_category', v_draft.lift_category), null, 'technical.review');
  return app.configuration_json(v_draft) || jsonb_build_object('check', app.configuration_check(v_draft.lift_category, app.config_values(v_draft.parameters),
    app.survey_mm(v_review.survey_revision_id), case when v_review.status = 'conditionally_feasible' then cardinality(v_review.constraints) else 0 end));
end;
$$;

create function public.approve_configuration(p_revision_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_c public.configuration_revisions;
  v_review public.technical_reviews;
  v_check jsonb;
  v_values jsonb;
  v_prev uuid;
  v_lead public.leads;
begin
  select * into v_c from public.configuration_revisions where id = p_revision_id for update;
  if not found or not app.can_read_technical(v_c.organization_id, v_c.lead_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'configuration_revision'));
  end if;
  perform app.require_permission('technical.configuration.approve', v_c.organization_id);
  perform app.assert_version(p_expected_version, v_c.version);
  if v_c.status <> 'draft' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_c.status, 'allowedActions', '[]'::jsonb));
  end if;
  v_review := app.config_review(v_c.lead_id, true);
  if v_review.id is null then
    -- Gate 2: no approved configuration without an authorized feasibility decision.
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'a feasible or conditionally feasible technical decision is required'));
  end if;
  v_values := app.config_values(v_c.parameters);
  v_check := app.configuration_check(v_c.lift_category, v_values, app.survey_mm(v_review.survey_revision_id),
    case when v_review.status = 'conditionally_feasible' then cardinality(v_review.constraints) else 0 end);
  if jsonb_array_length(v_check -> 'failures') > 0 then
    perform app.raise_error(v_check -> 'failures' -> 0 ->> 'code', jsonb_build_object(
      'fields', (select jsonb_agg(f) from jsonb_array_elements(v_check -> 'failures') x, jsonb_array_elements(x -> 'fields') f),
      'failures', v_check -> 'failures'));
  end if;
  update public.configuration_revisions set status = 'superseded' where lead_id = v_c.lead_id and status = 'approved' returning id into v_prev;
  update public.configuration_revisions
     set status = 'approved', approved_by = v_uid, approved_at = now(), technical_review_id = v_review.id, warnings = v_check -> 'warnings',
         parameters = (select coalesce(jsonb_object_agg(key, jsonb_set(value, '{status}', '"approved"')), '{}'::jsonb) from jsonb_each(v_c.parameters)),
         checksum = encode(extensions.digest(convert_to(jsonb_build_object('lead_id', v_c.lead_id, 'revision_no', v_c.revision_no,
           'lift_category', v_c.lift_category, 'values', v_values)::text, 'UTF8'), 'sha256'), 'hex')
   where id = p_revision_id returning * into v_c;
  perform app.audit(v_c.organization_id, 'configuration_revision', v_c.id, 'configuration.approved',
    jsonb_build_object('superseded_revision_id', v_prev),
    jsonb_build_object('revision_no', v_c.revision_no, 'checksum', v_c.checksum, 'technical_review_id', v_review.id, 'warnings', v_c.warnings),
    null, 'technical.configuration.approve');
  select * into v_lead from public.leads where id = v_c.lead_id;
  if v_lead.owner_user_id is not null then
    perform app.notify(v_lead.owner_user_id, v_c.organization_id, 'configuration.approved', 'lead', v_lead.id, 'notification.configuration_approved',
      jsonb_build_object('lead_number', v_lead.lead_number, 'revision_no', v_c.revision_no), 'configuration.approved:' || v_c.id);
  end if;
  return app.configuration_json(v_c);
end;
$$;

-- =============================================================================
-- Controlled technical documents (TE04, §9.6)
-- =============================================================================
create table public.technical_documents (
  id uuid primary key default gen_random_uuid(),
  document_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null references public.leads (id),
  kind public.document_kind not null,
  title text not null check (length(btrim(title)) between 3 and 200),
  current_approved_revision_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create index technical_documents_lead_idx on public.technical_documents (lead_id);
create trigger technical_documents_touch before update on public.technical_documents for each row execute function app.touch_row();

create table public.document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.technical_documents (id),
  revision_no integer not null check (revision_no > 0),
  status public.document_revision_state not null default 'draft',
  storage_bucket text not null default 'technical-documents',
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  change_summary text not null check (length(btrim(change_summary)) >= 3),
  configuration_revision_id uuid references public.configuration_revisions (id),
  author_id uuid not null references public.user_profiles (id),
  submitted_at timestamptz,
  reviewer_id uuid references public.user_profiles (id),
  reviewed_at timestamptz,
  review_comment text,
  operation_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (document_id, revision_no),
  unique (storage_bucket, storage_path),
  check (status not in ('approved', 'rejected', 'superseded') or (reviewer_id is not null and reviewed_at is not null))
);
alter table public.technical_documents add constraint technical_documents_current_fk foreign key (current_approved_revision_id) references public.document_revisions (id);
create unique index document_revisions_one_open on public.document_revisions (document_id) where status in ('draft', 'in_review');
create unique index document_revisions_one_approved on public.document_revisions (document_id) where status = 'approved';
create trigger document_revisions_touch before update on public.document_revisions for each row execute function app.touch_row();

-- The file and its checksum never change; a new upload is a new revision (§39 TE04).
create function app.guard_document_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or new.storage_path <> old.storage_path or new.sha256 <> old.sha256 or new.mime_type <> old.mime_type
     or new.size_bytes <> old.size_bytes or new.author_id <> old.author_id or new.document_id <> old.document_id
     or old.status in ('rejected', 'superseded')
     or (old.status = 'approved' and new.status <> 'superseded') then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'document revisions are immutable records'));
  end if;
  return new;
end;
$$;
create trigger document_revisions_guard before update or delete on public.document_revisions
  for each row execute function app.guard_document_revision();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('technical-documents', 'technical-documents', false, 26214400,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Storage path convention: {organization_id}/leads/{lead_id}/{operation_id}.{ext}
create function app.parse_document_path(p_name text)
returns table (organization_id uuid, lead_id uuid, operation_id uuid, extension text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_file text[];
begin
  if array_length(v_parts, 1) <> 4 or v_parts[2] <> 'leads'
     or v_parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|webp|csv|xlsx)$' then
    return;
  end if;
  v_file := string_to_array(v_parts[4], '.');
  return query select app.try_uuid(v_parts[1]), app.try_uuid(v_parts[3]), app.try_uuid(v_file[1]), v_file[2];
end;
$$;

create function app.can_upload_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.parse_document_path(p_name) p
    join public.leads l on l.id = p.lead_id and l.organization_id = p.organization_id
    where app.user_has_permission(auth.uid(), 'technical.review', l.organization_id)
      and exists (select 1 from public.technical_reviews r where r.lead_id = l.id)
  )
$$;

-- Technical staff read every file of their organization; sales and owners read approved files of readable leads.
create function app.can_read_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.parse_document_path(p_name) p
    join public.leads l on l.id = p.lead_id and l.organization_id = p.organization_id
    where app.user_has_permission(auth.uid(), 'technical.review', l.organization_id)
       or app.user_has_permission(auth.uid(), 'survey.read_all', l.organization_id)
       or (app.can_read_lead(l.id) and exists (
             select 1 from public.document_revisions d where d.storage_bucket = 'technical-documents' and d.storage_path = p_name
             and d.status in ('approved', 'superseded')))
  )
$$;

create policy technical_documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'technical-documents' and app.can_upload_document_object(name));
create policy technical_documents_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'technical-documents' and app.can_read_document_object(name));

create function app.can_read_document_revision(p_org uuid, p_lead_id uuid, p_status public.document_revision_state)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'technical.review', p_org)
      or app.user_has_permission(auth.uid(), 'survey.read_all', p_org)
      or (p_status in ('approved', 'superseded') and app.can_read_lead(p_lead_id))
$$;

create function app.document_json(d public.document_revisions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('document_revision_id', d.id, 'document_id', d.document_id, 'revision_no', d.revision_no, 'status', d.status,
    'sha256', d.sha256, 'version', d.version)
$$;

create function public.register_document_revision(p_operation_id uuid, p_lead_id uuid, p_document_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_lead public.leads;
  v_doc public.technical_documents;
  v_path text := p_payload ->> 'storage_path';
  v_parsed record;
  v_object record;
  v_mime text := lower(coalesce(p_payload ->> 'mime_type', ''));
  v_size bigint := app.jint(p_payload, 'size_bytes');
  v_config uuid := app.try_uuid(p_payload ->> 'configuration_revision_id');
  v_rev public.document_revisions;
  v_kind text := p_payload ->> 'kind';
  v_new_doc boolean := false;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found or not exists (select 1 from public.technical_reviews r where r.lead_id = p_lead_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  perform app.require_permission('technical.review', v_lead.organization_id);
  v_replay := app.op_begin(p_operation_id, 'document.register');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_parsed from app.parse_document_path(v_path);
  if v_parsed.lead_id is null or v_parsed.lead_id <> p_lead_id or v_parsed.organization_id <> v_lead.organization_id or v_parsed.operation_id <> p_operation_id then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('storage_path')));
  end if;
  select o.name, o.metadata into v_object from storage.objects o where o.bucket_id = 'technical-documents' and o.name = v_path;
  if v_object.name is null then
    perform app.raise_error('FILE_UPLOAD_FAILED', jsonb_build_object('reason', 'file not found in storage; upload first'));
  end if;
  if v_mime not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('mime_type')));
  end if;
  if v_size is null or v_size <= 0 or v_size > 26214400 or (v_object.metadata ? 'size' and (v_object.metadata ->> 'size')::bigint <> v_size) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('size_bytes')));
  end if;
  if coalesce(p_payload ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('sha256')));
  end if;
  if length(btrim(coalesce(p_payload ->> 'change_summary', ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('change_summary')));
  end if;
  if v_config is not null and not exists (select 1 from public.configuration_revisions where id = v_config and lead_id = p_lead_id) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('configuration_revision_id')));
  end if;
  if p_document_id is null then
    if v_kind is null or not (v_kind = any (enum_range(null::public.document_kind)::text[])) then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('kind')));
    end if;
    if length(btrim(coalesce(p_payload ->> 'title', ''))) < 3 then
      perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('title')));
    end if;
    insert into public.technical_documents (document_number, organization_id, lead_id, kind, title, created_by, updated_by)
    values (app.next_business_id('TD', app.lead_city_code(p_lead_id)), v_lead.organization_id, p_lead_id, v_kind::public.document_kind,
            btrim(p_payload ->> 'title'), v_uid, v_uid)
    returning * into v_doc;
    v_new_doc := true;
  else
    select * into v_doc from public.technical_documents where id = p_document_id for update;
    if not found or v_doc.lead_id <> p_lead_id then
      perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'technical_document'));
    end if;
    if exists (select 1 from public.document_revisions where document_id = v_doc.id and status in ('draft', 'in_review')) then
      perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'finish the open revision of this document first'));
    end if;
  end if;
  insert into public.document_revisions (document_id, revision_no, storage_path, sha256, mime_type, size_bytes, change_summary,
    configuration_revision_id, author_id, operation_id, updated_by)
  values (v_doc.id, coalesce((select max(revision_no) from public.document_revisions where document_id = v_doc.id), 0) + 1, v_path,
    p_payload ->> 'sha256', v_mime, v_size, btrim(p_payload ->> 'change_summary'), v_config, v_uid, p_operation_id, v_uid)
  returning * into v_rev;
  perform app.audit(v_doc.organization_id, 'document_revision', v_rev.id, 'document.registered', null,
    jsonb_build_object('document_number', v_doc.document_number, 'kind', v_doc.kind, 'revision_no', v_rev.revision_no, 'sha256', v_rev.sha256,
      'new_document', v_new_doc), null, 'technical.review', p_operation_id);
  return app.op_finish(p_operation_id, v_rev.id, app.document_json(v_rev) || jsonb_build_object('document_number', v_doc.document_number));
end;
$$;

create function app.lock_document_revision(p_revision_id uuid)
returns public.document_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.document_revisions;
  v_doc public.technical_documents;
begin
  select * into v from public.document_revisions where id = p_revision_id for update;
  select * into v_doc from public.technical_documents where id = v.document_id;
  if v.id is null or not app.can_read_document_revision(v_doc.organization_id, v_doc.lead_id, v.status) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'document_revision'));
  end if;
  return v;
end;
$$;

create function public.submit_document_revision(p_revision_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_rev public.document_revisions := app.lock_document_revision(p_revision_id);
  v_doc public.technical_documents;
  v_t public.state_transitions;
begin
  select * into v_doc from public.technical_documents where id = v_rev.document_id;
  perform app.require_permission('technical.review', v_doc.organization_id);
  perform app.assert_version(p_expected_version, v_rev.version);
  v_t := app.transition('document_revision', v_rev.status::text, 'submit_for_review');
  update public.document_revisions set status = v_t.to_state::public.document_revision_state, submitted_at = now()
   where id = p_revision_id returning * into v_rev;
  perform app.audit(v_doc.organization_id, 'document_revision', v_rev.id, v_t.audit_event, jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', v_rev.status, 'sha256', v_rev.sha256), null, v_t.permission_code);
  perform app.notify_permission_holders('technical.drawing.approve', v_doc.organization_id, 'document.submitted', 'technical_document', v_doc.id,
    'notification.document_submitted', jsonb_build_object('document_number', v_doc.document_number, 'revision_no', v_rev.revision_no),
    'document.submitted:' || v_rev.id);
  return app.document_json(v_rev);
end;
$$;

-- Approval names the checksum the reviewer saw; a changed file cannot be approved by accident.
create function public.decide_document_revision(p_revision_id uuid, p_expected_version integer, p_decision text, p_reviewed_sha256 text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_rev public.document_revisions := app.lock_document_revision(p_revision_id);
  v_doc public.technical_documents;
  v_t public.state_transitions;
  v_st public.state_transitions;
  v_prev public.document_revisions;
begin
  select * into v_doc from public.technical_documents where id = v_rev.document_id for update;
  perform app.require_permission('technical.drawing.approve', v_doc.organization_id);
  perform app.assert_version(p_expected_version, v_rev.version);
  if p_decision not in ('approve', 'reject') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('decision')));
  end if;
  v_t := app.transition('document_revision', v_rev.status::text, p_decision, p_comment);
  if p_decision = 'approve' and coalesce(p_reviewed_sha256, '') <> v_rev.sha256 then
    perform app.raise_error('REVISION_CONFLICT', jsonb_build_object('fields', jsonb_build_array('sha256'), 'expected', p_reviewed_sha256, 'current', v_rev.sha256));
  end if;
  if p_decision = 'approve' then
    select * into v_prev from public.document_revisions where document_id = v_doc.id and status = 'approved' for update;
    if found then
      v_st := app.transition('document_revision', 'approved', 'supersede');
      update public.document_revisions set status = 'superseded' where id = v_prev.id;
      perform app.audit(v_doc.organization_id, 'document_revision', v_prev.id, v_st.audit_event, jsonb_build_object('status', 'approved'),
        jsonb_build_object('status', 'superseded', 'superseded_by', v_rev.id), null, v_st.permission_code);
    end if;
  end if;
  update public.document_revisions
     set status = v_t.to_state::public.document_revision_state, reviewer_id = v_uid, reviewed_at = now(),
         review_comment = nullif(btrim(coalesce(p_comment, '')), '')
   where id = p_revision_id returning * into v_rev;
  if p_decision = 'approve' then
    update public.technical_documents set current_approved_revision_id = v_rev.id where id = v_doc.id;
  end if;
  perform app.audit(v_doc.organization_id, 'document_revision', v_rev.id, v_t.audit_event, jsonb_build_object('status', 'in_review'),
    jsonb_build_object('status', v_rev.status, 'sha256', v_rev.sha256), p_comment, v_t.permission_code);
  return app.document_json(v_rev);
end;
$$;

-- =============================================================================
-- Quotation economics (§49): exact mirror of packages/domain computeQuotation
-- and evaluateDiscountAuthority, in integer paise / basis points (parity-tested).
-- =============================================================================
-- Round half away from zero of p_num / p_den (p_den > 0), like domain divRound().
create function app.div_round(p_num numeric, p_den numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select sign(p_num) * (div(abs(p_num), p_den) + case when 2 * mod(abs(p_num), p_den) >= p_den then 1 else 0 end)
$$;

-- p_lines: [{ "category", "quantityMilli", "ratePaise", "discountBps", "taxCode": { "code", "rateBps" }, "estimatedUnitCostPaise" }]
-- Returns totals with paise as strings (exact), bps as numbers or null.
create function app.compute_quotation(p_lines jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line jsonb;
  v_qty numeric; v_rate numeric; v_disc_bps numeric; v_tax_bps numeric; v_cost numeric;
  v_gross numeric; v_disc numeric; v_taxable numeric; v_tax numeric; v_est numeric;
  t_gross numeric := 0; t_disc numeric := 0; t_taxable numeric := 0; t_tax numeric := 0; t_est numeric := 0;
  v_by_code jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_code text;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := (v_line ->> 'quantityMilli')::numeric;
    v_rate := (v_line ->> 'ratePaise')::numeric;
    v_disc_bps := coalesce((v_line ->> 'discountBps')::numeric, 0);
    v_tax_bps := (v_line -> 'taxCode' ->> 'rateBps')::numeric;
    v_cost := (v_line ->> 'estimatedUnitCostPaise')::numeric;
    v_code := v_line -> 'taxCode' ->> 'code';
    v_gross := app.div_round(v_rate * v_qty, 1000);
    v_disc := app.div_round(v_gross * v_disc_bps, 10000);
    v_taxable := v_gross - v_disc;
    v_tax := app.div_round(v_taxable * v_tax_bps, 10000);
    v_est := case when v_cost is null then 0 else app.div_round(v_cost * v_qty, 1000) end;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'grossPaise', v_gross::text, 'discountPaise', v_disc::text, 'taxablePaise', v_taxable::text, 'taxPaise', v_tax::text,
      'totalPaise', (v_taxable + v_tax)::text, 'estimatedCostPaise', v_est::text));
    v_by_code := jsonb_set(v_by_code, array[v_code], to_jsonb((coalesce((v_by_code ->> v_code)::numeric, 0) + v_tax)::text));
    t_gross := t_gross + v_gross; t_disc := t_disc + v_disc; t_taxable := t_taxable + v_taxable; t_tax := t_tax + v_tax; t_est := t_est + v_est;
  end loop;
  return jsonb_build_object(
    'lines', v_results,
    'grossPaise', t_gross::text, 'discountPaise', t_disc::text, 'taxablePaise', t_taxable::text,
    'taxByCode', v_by_code, 'taxPaise', t_tax::text, 'grandTotalPaise', (t_taxable + t_tax)::text,
    'estimatedDirectCostPaise', t_est::text, 'grossContributionPaise', (t_taxable - t_est)::text,
    'contributionMarginBps', case when t_taxable > 0 then app.div_round((t_taxable - t_est) * 10000, t_taxable) end,
    'overallDiscountBps', case when t_gross > 0 then app.div_round(t_disc * 10000, t_gross) end);
end;
$$;

create function app.evaluate_discount(p_totals jsonb, p_policy jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reasons text[] := '{}';
begin
  if coalesce((p_totals ->> 'overallDiscountBps')::numeric, 0) > (p_policy ->> 'maxDiscountBpsWithoutApproval')::numeric then
    v_reasons := v_reasons || 'discount_above_authority'::text;
  end if;
  if (p_totals ->> 'estimatedDirectCostPaise')::numeric = 0 then
    v_reasons := v_reasons || 'no_cost_basis'::text;
  elsif p_totals ->> 'contributionMarginBps' is null or (p_totals ->> 'contributionMarginBps')::numeric < (p_policy ->> 'marginFloorBps')::numeric then
    v_reasons := v_reasons || 'margin_below_floor'::text;
  end if;
  return jsonb_build_object('needsApproval', cardinality(v_reasons) > 0, 'reasons', to_jsonb(v_reasons));
end;
$$;

-- =============================================================================
-- Quotations (SE08–SE10, Gate 3)
-- =============================================================================
create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null unique references public.leads (id),
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create trigger quotations_touch before update on public.quotations for each row execute function app.touch_row();

create table public.quotation_revisions (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id),
  revision_no integer not null check (revision_no > 0),
  status public.quotation_state not null default 'draft',
  configuration_revision_id uuid not null references public.configuration_revisions (id),
  valid_until date not null,
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  totals jsonb not null default '{}'::jsonb,
  discount_policy jsonb not null default '{}'::jsonb,
  needs_approval boolean not null default false,
  approval_reasons text[] not null default '{}',
  revision_reason text,
  requested_by uuid references public.user_profiles (id),
  approved_by uuid references public.user_profiles (id),
  approved_at timestamptz,
  issued_by uuid references public.user_profiles (id),
  issued_at timestamptz,
  -- Hash of exactly what the customer received (lines, terms, totals, validity); acceptance binds to it.
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  customer_response_at timestamptz,
  customer_response_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (quotation_id, revision_no),
  check (status not in ('issued', 'accepted', 'rejected_by_customer', 'expired') or (content_sha256 is not null and issued_at is not null))
);
alter table public.quotations add constraint quotations_current_revision_fk foreign key (current_revision_id) references public.quotation_revisions (id);
create unique index quotation_revisions_one_open on public.quotation_revisions (quotation_id)
  where status in ('draft', 'pending_approval', 'approved', 'issued');
create trigger quotation_revisions_touch before update on public.quotation_revisions for each row execute function app.touch_row();

create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.quotation_revisions (id),
  line_no integer not null check (line_no > 0),
  category public.quotation_line_category not null,
  description text not null check (length(btrim(description)) between 2 and 500),
  quantity_milli integer not null check (quantity_milli > 0),
  unit text not null check (length(btrim(unit)) between 1 and 20),
  rate_paise bigint not null check (rate_paise >= 0),
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  tax_code text not null,
  tax_rate_bps integer not null check (tax_rate_bps >= 0),
  -- Internal only (never on the customer document): estimated direct cost and its source.
  estimated_unit_cost_paise bigint check (estimated_unit_cost_paise is null or estimated_unit_cost_paise >= 0),
  cost_source text,
  gross_paise bigint not null,
  discount_paise bigint not null,
  taxable_paise bigint not null,
  tax_paise bigint not null,
  total_paise bigint not null,
  estimated_cost_paise bigint not null,
  unique (revision_id, line_no)
);

-- Only a draft revision's lines can change; everything after submission is a record (§7.8 supersede, not overwrite).
create function app.guard_quotation_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.quotation_state;
begin
  select status into v_status from public.quotation_revisions where id = coalesce(new.revision_id, old.revision_id);
  if v_status <> 'draft' then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'quotation lines are locked once submitted'));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger quotation_lines_guard before insert or update or delete on public.quotation_lines
  for each row execute function app.guard_quotation_line();

create function app.guard_quotation_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status in ('accepted', 'rejected_by_customer', 'superseded', 'expired')
     or (old.status <> 'draft' and (new.terms <> old.terms or new.totals <> old.totals or new.valid_until <> old.valid_until
         or new.configuration_revision_id <> old.configuration_revision_id))
     or (old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'submitted quotation revisions are immutable'));
  end if;
  return new;
end;
$$;
create trigger quotation_revisions_guard before update or delete on public.quotation_revisions
  for each row execute function app.guard_quotation_revision();

-- SE10 Negotiation log: append-only; prior terms are never overwritten.
create table public.quotation_negotiations (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id),
  revision_id uuid references public.quotation_revisions (id),
  occurred_at timestamptz not null,
  contact text not null check (length(btrim(contact)) >= 2),
  topic text not null check (length(btrim(topic)) >= 2),
  requested_change text,
  requested_discount_bps integer check (requested_discount_bps is null or requested_discount_bps between 0 and 10000),
  expected_impact text,
  decision text,
  recorded_by uuid not null references public.user_profiles (id),
  recorded_at timestamptz not null default now()
);
create index quotation_negotiations_quotation_idx on public.quotation_negotiations (quotation_id, occurred_at desc);
create trigger quotation_negotiations_append_only before update or delete on public.quotation_negotiations
  for each row execute function app.forbid_mutation();

-- §16.4 Customer approval record, bound to the exact revision and its content hash.
create table public.customer_acceptances (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null unique references public.quotation_revisions (id),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_by_name text not null check (length(btrim(accepted_by_name)) >= 2),
  acceptor_authority text not null check (length(btrim(acceptor_authority)) >= 2),
  channel text not null check (channel in ('signed_copy', 'email', 'portal', 'in_person', 'other')),
  evidence text not null check (length(btrim(evidence)) >= 3),
  comments text,
  accepted_by_user_id uuid references public.user_profiles (id),
  recorded_by uuid not null references public.user_profiles (id),
  recorded_at timestamptz not null default now()
);
create trigger customer_acceptances_append_only before update or delete on public.customer_acceptances
  for each row execute function app.forbid_mutation();

-- =============================================================================
-- Approval requests (O04, §48): one row per request; decisions are recorded, never edited.
-- =============================================================================
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('quotation_discount')),
  entity_type text not null,
  entity_id uuid not null,
  lead_id uuid references public.leads (id),
  requested_by uuid not null references public.user_profiles (id),
  requested_at timestamptz not null default now(),
  reasons text[] not null,
  policy jsonb not null,
  impact jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'more_info', 'withdrawn')),
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  decision_reason text,
  check ((status = 'pending') = (decided_at is null)),
  check (status not in ('rejected', 'more_info') or length(btrim(coalesce(decision_reason, ''))) >= 3)
);
create unique index approval_requests_one_pending on public.approval_requests (entity_type, entity_id) where status = 'pending';
create index approval_requests_org_status_idx on public.approval_requests (organization_id, status, requested_at);

create function app.guard_approval_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status <> 'pending' or new.requested_by <> old.requested_by or new.reasons <> old.reasons
     or new.policy <> old.policy or new.impact <> old.impact or new.entity_id <> old.entity_id then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'decided approval requests are immutable'));
  end if;
  return new;
end;
$$;
create trigger approval_requests_guard before update or delete on public.approval_requests
  for each row execute function app.guard_approval_request();

-- =============================================================================
-- Quotation RPCs
-- =============================================================================
create function app.can_read_quotation(p_quotation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_read_lead(q.lead_id) from public.quotations q where q.id = p_quotation_id), false)
$$;

create function app.can_read_quotation_revision(p_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_read_quotation(r.quotation_id) from public.quotation_revisions r where r.id = p_revision_id), false)
$$;

create function app.today_ist()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create function app.quotation_json(r public.quotation_revisions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('quotation_id', r.quotation_id, 'revision_id', r.id, 'revision_no', r.revision_no, 'status', r.status,
    'version', r.version, 'valid_until', r.valid_until, 'needs_approval', r.needs_approval, 'approval_reasons', to_jsonb(r.approval_reasons),
    'totals', r.totals, 'content_sha256', r.content_sha256)
$$;

-- Stored lines in the shape app.compute_quotation / domain computeQuotation expect.
create function app.quotation_lines_input(p_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'quantityMilli', quantity_milli, 'ratePaise', rate_paise::text,
    'discountBps', discount_bps, 'taxCode', jsonb_build_object('code', tax_code, 'rateBps', tax_rate_bps),
    'estimatedUnitCostPaise', estimated_unit_cost_paise::text) order by line_no), '[]'::jsonb)
  from public.quotation_lines where revision_id = p_revision_id
$$;

-- Locks a revision for a commercial action by the lead owner.
create function app.lock_quotation_revision(p_revision_id uuid, p_permission text)
returns public.quotation_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.quotation_revisions;
  v_q public.quotations;
  v_lead public.leads;
begin
  select * into v from public.quotation_revisions where id = p_revision_id for update;
  select * into v_q from public.quotations where id = v.quotation_id for update;
  select * into v_lead from public.leads where id = v_q.lead_id;
  if v.id is null or not app.can_read_lead_row(v_lead.organization_id, v_lead.owner_user_id, v_lead.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'quotation'));
  end if;
  if p_permission is not null then
    perform app.require_lead_owner(v_lead, p_permission);
  end if;
  return v;
end;
$$;

create function app.refresh_quotation_totals(p_revision_id uuid)
returns public.quotation_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy jsonb := app.rule('quotation.discount_policy');
  v_totals jsonb := app.compute_quotation(app.quotation_lines_input(p_revision_id));
  v_eval jsonb := app.evaluate_discount(v_totals, v_policy);
  v public.quotation_revisions;
begin
  update public.quotation_revisions
     set totals = v_totals, discount_policy = v_policy, needs_approval = (v_eval ->> 'needsApproval')::boolean,
         approval_reasons = array(select jsonb_array_elements_text(v_eval -> 'reasons'))
   where id = p_revision_id returning * into v;
  return v;
end;
$$;

create function public.create_quotation(p_operation_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_lead public.leads;
  v_config public.configuration_revisions;
  v_q public.quotations;
  v_r public.quotation_revisions;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found or not app.can_read_lead_row(v_lead.organization_id, v_lead.owner_user_id, v_lead.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  perform app.require_lead_owner(v_lead, 'quotation.create');
  v_replay := app.op_begin(p_operation_id, 'quotation.create');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_lead.status <> 'qualified' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_lead.status, 'reason', 'a quotation needs a qualified lead'));
  end if;
  if exists (select 1 from public.quotations where lead_id = p_lead_id) then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'this lead already has a quotation; revise it',
      'quotation_id', (select id from public.quotations where lead_id = p_lead_id)));
  end if;
  select * into v_config from public.configuration_revisions where lead_id = p_lead_id and status = 'approved';
  if not found then
    -- Gate 2: Sales cannot invent a specification (SE08).
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'an approved technical configuration is required'));
  end if;
  insert into public.quotations (quotation_number, organization_id, lead_id, created_by, updated_by)
  values (app.next_business_id('QT', app.lead_city_code(p_lead_id)), v_lead.organization_id, p_lead_id, v_uid, v_uid)
  returning * into v_q;
  insert into public.quotation_revisions (quotation_id, revision_no, configuration_revision_id, valid_until, discount_policy, created_by, updated_by)
  values (v_q.id, 1, v_config.id, app.today_ist() + coalesce((app.rule('quotation.validity') ->> 'days')::integer, 30),
          app.rule('quotation.discount_policy'), v_uid, v_uid)
  returning * into v_r;
  update public.quotations set current_revision_id = v_r.id where id = v_q.id;
  v_r := app.refresh_quotation_totals(v_r.id);
  perform app.audit(v_lead.organization_id, 'quotation', v_q.id, 'quotation.created', null,
    jsonb_build_object('quotation_number', v_q.quotation_number, 'revision_id', v_r.id, 'configuration_revision_id', v_config.id),
    null, 'quotation.create', p_operation_id);
  return app.op_finish(p_operation_id, v_q.id, app.quotation_json(v_r) || jsonb_build_object('quotation_number', v_q.quotation_number));
end;
$$;

create function public.save_quotation_draft(p_revision_id uuid, p_expected_version integer, p_lines jsonb, p_terms jsonb, p_valid_until date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.quotation_revisions := app.lock_quotation_revision(p_revision_id, 'quotation.create');
  v_codes jsonb := app.rule('commercial.tax_codes') -> 'codes';
  v_terms jsonb := coalesce(p_terms, '{}'::jsonb);
  v_line jsonb;
  v_i integer := 0;
  v_key text;
  v_val jsonb;
  v_rate_bps integer;
  v_input jsonb := '[]'::jsonb;
  v_calc jsonb;
  v_org uuid;
begin
  perform app.assert_version(p_expected_version, v_r.version);
  if v_r.status <> 'draft' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_r.status, 'reason', 'only a draft revision can be edited; revise the quotation'));
  end if;
  if jsonb_typeof(v_terms) <> 'object' then perform app.j_field_error('terms'); end if;
  for v_key, v_val in select * from jsonb_each(v_terms) loop
    if v_key not in ('scope_of_supply', 'scope_of_installation', 'customer_responsibilities', 'exclusions', 'tax_treatment',
                     'payment_terms', 'warranty_terms', 'delivery_assumptions')
       or jsonb_typeof(v_val) not in ('string', 'null') or length(coalesce(v_val #>> '{}', '')) > 4000 then
      perform app.j_field_error('terms.' || v_key);
    end if;
  end loop;
  if p_valid_until is null or p_valid_until < app.today_ist() or p_valid_until > app.today_ist() + 365 then
    perform app.j_field_error('valid_until');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 100 then
    perform app.j_field_error('lines');
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_line) <> 'object' then perform app.j_field_error('lines.' || v_i); end if;
    if coalesce(v_line ->> 'category', '') <> all (enum_range(null::public.quotation_line_category)::text[]) then perform app.j_field_error('lines.' || v_i || '.category'); end if;
    if length(btrim(coalesce(v_line ->> 'description', ''))) not between 2 and 500 then perform app.j_field_error('lines.' || v_i || '.description'); end if;
    if coalesce(v_line ->> 'quantity_milli', '') !~ '^[1-9][0-9]{0,8}$' then perform app.j_field_error('lines.' || v_i || '.quantity_milli'); end if;
    if length(btrim(coalesce(v_line ->> 'unit', ''))) not between 1 and 20 then perform app.j_field_error('lines.' || v_i || '.unit'); end if;
    if coalesce(v_line ->> 'rate_paise', '') !~ '^[0-9]{1,13}$' then perform app.j_field_error('lines.' || v_i || '.rate_paise'); end if;
    if coalesce(v_line ->> 'discount_bps', '0') !~ '^[0-9]{1,5}$' or coalesce(v_line ->> 'discount_bps', '0')::integer > 10000 then
      perform app.j_field_error('lines.' || v_i || '.discount_bps');
    end if;
    if nullif(v_line ->> 'estimated_unit_cost_paise', '') is not null and (v_line ->> 'estimated_unit_cost_paise') !~ '^[0-9]{1,13}$' then
      perform app.j_field_error('lines.' || v_i || '.estimated_unit_cost_paise');
    end if;
    if length(coalesce(v_line ->> 'cost_source', '')) > 200 then perform app.j_field_error('lines.' || v_i || '.cost_source'); end if;
    select (c ->> 'rateBps')::integer into v_rate_bps from jsonb_array_elements(v_codes) c where c ->> 'code' = v_line ->> 'tax_code';
    if v_rate_bps is null then perform app.j_field_error('lines.' || v_i || '.tax_code'); end if;
    v_input := v_input || jsonb_build_array(jsonb_build_object('category', v_line ->> 'category', 'quantityMilli', (v_line ->> 'quantity_milli')::integer,
      'ratePaise', v_line ->> 'rate_paise', 'discountBps', coalesce(v_line ->> 'discount_bps', '0')::integer,
      'taxCode', jsonb_build_object('code', v_line ->> 'tax_code', 'rateBps', v_rate_bps),
      'estimatedUnitCostPaise', nullif(v_line ->> 'estimated_unit_cost_paise', '')));
    v_rate_bps := null;
  end loop;
  v_calc := app.compute_quotation(v_input);

  delete from public.quotation_lines where revision_id = p_revision_id;
  insert into public.quotation_lines (revision_id, line_no, category, description, quantity_milli, unit, rate_paise, discount_bps, tax_code, tax_rate_bps,
    estimated_unit_cost_paise, cost_source, gross_paise, discount_paise, taxable_paise, tax_paise, total_paise, estimated_cost_paise)
  select p_revision_id, o, (l ->> 'category')::public.quotation_line_category, btrim(l ->> 'description'), (i ->> 'quantityMilli')::integer, btrim(l ->> 'unit'),
         (i ->> 'ratePaise')::bigint, (i ->> 'discountBps')::integer, i -> 'taxCode' ->> 'code', (i -> 'taxCode' ->> 'rateBps')::integer,
         (i ->> 'estimatedUnitCostPaise')::bigint, nullif(btrim(coalesce(l ->> 'cost_source', '')), ''),
         (c ->> 'grossPaise')::bigint, (c ->> 'discountPaise')::bigint, (c ->> 'taxablePaise')::bigint, (c ->> 'taxPaise')::bigint,
         (c ->> 'totalPaise')::bigint, (c ->> 'estimatedCostPaise')::bigint
  from jsonb_array_elements(p_lines) with ordinality a(l, o)
  join jsonb_array_elements(v_input) with ordinality b(i, ob) on ob = o
  join jsonb_array_elements(v_calc -> 'lines') with ordinality d(c, od) on od = o;

  update public.quotation_revisions
     set terms = (select coalesce(jsonb_object_agg(key, btrim(value #>> '{}')), '{}'::jsonb) from jsonb_each(v_terms) where jsonb_typeof(value) = 'string'),
         valid_until = p_valid_until
   where id = p_revision_id;
  v_r := app.refresh_quotation_totals(p_revision_id);
  select organization_id into v_org from public.quotations where id = v_r.quotation_id;
  perform app.audit(v_org, 'quotation_revision', v_r.id, 'quotation.draft_saved', null,
    jsonb_build_object('lines', jsonb_array_length(p_lines), 'grand_total_paise', v_r.totals ->> 'grandTotalPaise', 'needs_approval', v_r.needs_approval),
    null, 'quotation.create');
  return app.quotation_json(v_r);
end;
$$;

create function public.submit_quotation(p_revision_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.quotation_revisions := app.lock_quotation_revision(p_revision_id, 'quotation.create');
  v_q public.quotations;
  v_t public.state_transitions;
  v_req uuid;
begin
  perform app.assert_version(p_expected_version, v_r.version);
  select * into v_q from public.quotations where id = v_r.quotation_id;
  if not exists (select 1 from public.configuration_revisions where id = v_r.configuration_revision_id and status = 'approved') then
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'the technical configuration changed; revise the quotation'));
  end if;
  if not exists (select 1 from public.quotation_lines where revision_id = p_revision_id) then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('lines')));
  end if;
  if v_r.status = 'draft' then
    -- Discount authority is evaluated by the server, now, against the current policy (D-004 / D-005).
    v_r := app.refresh_quotation_totals(p_revision_id);
  end if;
  v_t := app.transition('quotation', v_r.status::text, case when v_r.needs_approval then 'request_approval' else 'finalize' end);
  if v_r.needs_approval then
    update public.quotation_revisions set status = v_t.to_state::public.quotation_state, requested_by = v_uid where id = p_revision_id returning * into v_r;
    insert into public.approval_requests (organization_id, kind, entity_type, entity_id, lead_id, requested_by, reasons, policy, impact)
    values (v_q.organization_id, 'quotation_discount', 'quotation_revision', v_r.id, v_q.lead_id, v_uid, v_r.approval_reasons, v_r.discount_policy,
      jsonb_build_object('quotation_number', v_q.quotation_number, 'revision_no', v_r.revision_no,
        'grandTotalPaise', v_r.totals ->> 'grandTotalPaise', 'taxablePaise', v_r.totals ->> 'taxablePaise',
        'discountPaise', v_r.totals ->> 'discountPaise', 'overallDiscountBps', v_r.totals -> 'overallDiscountBps',
        'contributionMarginBps', v_r.totals -> 'contributionMarginBps', 'estimatedDirectCostPaise', v_r.totals ->> 'estimatedDirectCostPaise'))
    returning id into v_req;
    perform app.notify_permission_holders('quotation.discount.approve', v_q.organization_id, 'quotation.approval_requested', 'approval_request', v_req,
      'notification.quotation_approval_requested', jsonb_build_object('quotation_number', v_q.quotation_number, 'revision_no', v_r.revision_no),
      'quotation.approval_requested:' || v_req);
  else
    update public.quotation_revisions set status = v_t.to_state::public.quotation_state, requested_by = v_uid, approved_by = v_uid, approved_at = now()
     where id = p_revision_id returning * into v_r;
  end if;
  perform app.audit(v_q.organization_id, 'quotation_revision', v_r.id, v_t.audit_event, jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', v_r.status, 'approval_reasons', to_jsonb(v_r.approval_reasons), 'approval_request_id', v_req), null, v_t.permission_code);
  return app.quotation_json(v_r) || jsonb_build_object('approval_request_id', v_req);
end;
$$;

-- O04: approve / reject / request more information. Requesters never decide their own request.
create function public.decide_quotation_approval(p_request_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_req public.approval_requests;
  v_r public.quotation_revisions;
  v_q public.quotations;
  v_t public.state_transitions;
begin
  select * into v_req from public.approval_requests where id = p_request_id for update;
  if not found or not (app.user_has_permission(v_uid, 'quotation.discount.approve', v_req.organization_id) or v_req.requested_by = v_uid) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'approval_request'));
  end if;
  perform app.require_permission('quotation.discount.approve', v_req.organization_id);
  if v_req.status <> 'pending' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_req.status, 'allowedActions', '[]'::jsonb));
  end if;
  if v_req.requested_by = v_uid then
    perform app.raise_error('SELF_APPROVAL_FORBIDDEN');
  end if;
  if p_decision not in ('approve', 'reject', 'more_info') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('decision')));
  end if;
  select * into v_r from public.quotation_revisions where id = v_req.entity_id for update;
  select * into v_q from public.quotations where id = v_r.quotation_id;
  v_t := app.transition('quotation', v_r.status::text, case when p_decision = 'approve' then 'approve' else 'return_to_draft' end, p_reason);
  if p_decision = 'approve' then
    update public.quotation_revisions set status = v_t.to_state::public.quotation_state, approved_by = v_uid, approved_at = now()
     where id = v_r.id returning * into v_r;
  else
    update public.quotation_revisions set status = v_t.to_state::public.quotation_state where id = v_r.id returning * into v_r;
  end if;
  update public.approval_requests
     set status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'more_info' end,
         decided_by = v_uid, decided_at = now(), decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_request_id returning * into v_req;
  perform app.audit(v_req.organization_id, 'approval_request', v_req.id, 'approval.decided', jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', v_req.status, 'reasons', to_jsonb(v_req.reasons), 'impact', v_req.impact), p_reason, 'quotation.discount.approve');
  perform app.audit(v_req.organization_id, 'quotation_revision', v_r.id, v_t.audit_event, jsonb_build_object('status', 'pending_approval'),
    jsonb_build_object('status', v_r.status), p_reason, v_t.permission_code);
  perform app.notify(v_req.requested_by, v_req.organization_id, 'quotation.approval_decided', 'quotation', v_q.id, 'notification.quotation_approval_decided',
    jsonb_build_object('quotation_number', v_q.quotation_number, 'revision_no', v_r.revision_no, 'decision', v_req.status, 'reason', p_reason),
    'quotation.approval_decided:' || v_req.id);
  return app.quotation_json(v_r) || jsonb_build_object('approval_request_id', v_req.id, 'approval_status', v_req.status);
end;
$$;

-- Gate 3: a binding quotation needs complete terms, validity, approvals and a current configuration.
create function public.issue_quotation(p_revision_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.quotation_revisions := app.lock_quotation_revision(p_revision_id, 'quotation.issue');
  v_q public.quotations;
  v_t public.state_transitions;
  v_missing jsonb;
  v_content jsonb;
  v_config_checksum text;
begin
  perform app.assert_version(p_expected_version, v_r.version);
  select * into v_q from public.quotations where id = v_r.quotation_id;
  v_t := app.transition('quotation', v_r.status::text, 'issue');
  select jsonb_agg('terms.' || k order by o) into v_missing
  from unnest(array['scope_of_supply', 'scope_of_installation', 'customer_responsibilities', 'exclusions', 'tax_treatment',
                    'payment_terms', 'warranty_terms', 'delivery_assumptions']) with ordinality t(k, o)
  where length(btrim(coalesce(v_r.terms ->> k, ''))) < 3;
  if v_missing is not null then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', v_missing));
  end if;
  if v_r.valid_until < app.today_ist() then
    perform app.raise_error('APPROVAL_EXPIRED', jsonb_build_object('valid_until', v_r.valid_until));
  end if;
  select checksum into v_config_checksum from public.configuration_revisions where id = v_r.configuration_revision_id and status = 'approved';
  if v_config_checksum is null then
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'the technical configuration changed; revise the quotation'));
  end if;
  -- Exactly what the customer receives (no internal cost fields).
  v_content := jsonb_build_object(
    'quotation_number', v_q.quotation_number, 'revision_no', v_r.revision_no, 'valid_until', v_r.valid_until, 'terms', v_r.terms,
    'configuration_checksum', v_config_checksum,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('line_no', line_no, 'category', category, 'description', description,
       'quantity_milli', quantity_milli, 'unit', unit, 'rate_paise', rate_paise::text, 'discount_bps', discount_bps, 'tax_code', tax_code,
       'tax_rate_bps', tax_rate_bps, 'taxable_paise', taxable_paise::text, 'tax_paise', tax_paise::text, 'total_paise', total_paise::text) order by line_no), '[]'::jsonb)
       from public.quotation_lines where revision_id = v_r.id),
    'totals', jsonb_build_object('grossPaise', v_r.totals -> 'grossPaise', 'discountPaise', v_r.totals -> 'discountPaise',
       'taxablePaise', v_r.totals -> 'taxablePaise', 'taxByCode', v_r.totals -> 'taxByCode', 'taxPaise', v_r.totals -> 'taxPaise',
       'grandTotalPaise', v_r.totals -> 'grandTotalPaise'));
  update public.quotation_revisions
     set status = v_t.to_state::public.quotation_state, issued_by = v_uid, issued_at = now(),
         content_sha256 = encode(extensions.digest(convert_to(v_content::text, 'UTF8'), 'sha256'), 'hex')
   where id = p_revision_id returning * into v_r;
  perform app.audit(v_q.organization_id, 'quotation_revision', v_r.id, v_t.audit_event, jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', v_r.status, 'content_sha256', v_r.content_sha256, 'valid_until', v_r.valid_until), null, v_t.permission_code);
  return app.quotation_json(v_r);
end;
$$;

create function public.record_customer_response(p_revision_id uuid, p_expected_version integer, p_response text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.quotation_revisions := app.lock_quotation_revision(p_revision_id, 'quotation.issue');
  v_q public.quotations;
  v_t public.state_transitions;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_missing text[] := '{}';
  v_reason text := nullif(btrim(coalesce(v_payload ->> 'reason', '')), '');
begin
  perform app.assert_version(p_expected_version, v_r.version);
  select * into v_q from public.quotations where id = v_r.quotation_id;
  if p_response not in ('accept', 'reject') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('response')));
  end if;
  v_t := app.transition('quotation', v_r.status::text, case when p_response = 'accept' then 'record_acceptance' else 'record_customer_rejection' end, v_reason);
  if p_response = 'accept' then
    if length(btrim(coalesce(v_payload ->> 'accepted_by_name', ''))) < 2 then v_missing := v_missing || 'accepted_by_name'::text; end if;
    if length(btrim(coalesce(v_payload ->> 'acceptor_authority', ''))) < 2 then v_missing := v_missing || 'acceptor_authority'::text; end if;
    if length(btrim(coalesce(v_payload ->> 'evidence', ''))) < 3 then v_missing := v_missing || 'evidence'::text; end if;
    if cardinality(v_missing) > 0 then
      perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
    end if;
    if coalesce(v_payload ->> 'channel', '') not in ('signed_copy', 'email', 'portal', 'in_person', 'other') then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('channel')));
    end if;
    if v_r.valid_until < app.today_ist() then
      perform app.raise_error('APPROVAL_EXPIRED', jsonb_build_object('valid_until', v_r.valid_until));
    end if;
    if coalesce(v_payload ->> 'content_sha256', '') <> v_r.content_sha256 then
      -- The acceptance must name the exact issued revision (§16.4, CU04).
      perform app.raise_error('REVISION_CONFLICT', jsonb_build_object('fields', jsonb_build_array('content_sha256')));
    end if;
    insert into public.customer_acceptances (revision_id, content_sha256, accepted_by_name, acceptor_authority, channel, evidence, comments, recorded_by)
    values (v_r.id, v_r.content_sha256, btrim(v_payload ->> 'accepted_by_name'), btrim(v_payload ->> 'acceptor_authority'), v_payload ->> 'channel',
      btrim(v_payload ->> 'evidence'), nullif(btrim(coalesce(v_payload ->> 'comments', '')), ''), v_uid);
  end if;
  update public.quotation_revisions set status = v_t.to_state::public.quotation_state, customer_response_at = now(), customer_response_reason = v_reason
   where id = p_revision_id returning * into v_r;
  perform app.audit(v_q.organization_id, 'quotation_revision', v_r.id, v_t.audit_event, jsonb_build_object('status', 'issued'),
    jsonb_build_object('status', v_r.status, 'content_sha256', v_r.content_sha256,
      'accepted_by_name', v_payload ->> 'accepted_by_name', 'acceptor_authority', v_payload ->> 'acceptor_authority', 'channel', v_payload ->> 'channel'),
    v_reason, v_t.permission_code);
  if p_response = 'accept' then
    perform app.notify_permission_holders('lead.read_all', v_q.organization_id, 'quotation.accepted', 'quotation', v_q.id,
      'notification.quotation_accepted', jsonb_build_object('quotation_number', v_q.quotation_number, 'revision_no', v_r.revision_no),
      'quotation.accepted:' || v_r.id);
  end if;
  return app.quotation_json(v_r);
end;
$$;

-- A new revision supersedes (never overwrites) the previous one (§7.8).
create function public.revise_quotation(p_quotation_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_q public.quotations;
  v_lead public.leads;
  v_cur public.quotation_revisions;
  v_new public.quotation_revisions;
  v_config public.configuration_revisions;
  v_t public.state_transitions;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  select * into v_lead from public.leads where id = v_q.lead_id;
  if v_q.id is null or not app.can_read_lead_row(v_lead.organization_id, v_lead.owner_user_id, v_lead.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'quotation'));
  end if;
  perform app.require_lead_owner(v_lead, 'quotation.create');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  select * into v_cur from public.quotation_revisions where id = v_q.current_revision_id for update;
  if v_cur.status in ('draft', 'accepted') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_cur.status,
      'reason', case when v_cur.status = 'draft' then 'edit the current draft' else 'an accepted quotation changes only through a variation' end));
  end if;
  if v_cur.status in ('pending_approval', 'approved', 'issued') then
    v_t := app.transition('quotation', v_cur.status::text, 'supersede');
    update public.quotation_revisions set status = 'superseded' where id = v_cur.id;
    update public.approval_requests set status = 'withdrawn', decided_by = v_uid, decided_at = now(), decision_reason = btrim(p_reason)
     where entity_type = 'quotation_revision' and entity_id = v_cur.id and status = 'pending';
    perform app.audit(v_q.organization_id, 'quotation_revision', v_cur.id, v_t.audit_event, jsonb_build_object('status', v_cur.status),
      jsonb_build_object('status', 'superseded'), p_reason, v_t.permission_code);
  end if;
  select * into v_config from public.configuration_revisions where lead_id = v_q.lead_id and status = 'approved';
  if not found then
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'an approved technical configuration is required'));
  end if;
  insert into public.quotation_revisions (quotation_id, revision_no, configuration_revision_id, valid_until, terms, discount_policy, revision_reason, created_by, updated_by)
  values (v_q.id, v_cur.revision_no + 1, v_config.id, app.today_ist() + coalesce((app.rule('quotation.validity') ->> 'days')::integer, 30),
          v_cur.terms, app.rule('quotation.discount_policy'), btrim(p_reason), v_uid, v_uid)
  returning * into v_new;
  insert into public.quotation_lines (revision_id, line_no, category, description, quantity_milli, unit, rate_paise, discount_bps, tax_code, tax_rate_bps,
    estimated_unit_cost_paise, cost_source, gross_paise, discount_paise, taxable_paise, tax_paise, total_paise, estimated_cost_paise)
  select v_new.id, line_no, category, description, quantity_milli, unit, rate_paise, discount_bps, tax_code, tax_rate_bps,
    estimated_unit_cost_paise, cost_source, gross_paise, discount_paise, taxable_paise, tax_paise, total_paise, estimated_cost_paise
  from public.quotation_lines where revision_id = v_cur.id;
  update public.quotations set current_revision_id = v_new.id where id = v_q.id;
  v_new := app.refresh_quotation_totals(v_new.id);
  perform app.audit(v_q.organization_id, 'quotation', v_q.id, 'quotation.revised', jsonb_build_object('revision_id', v_cur.id, 'revision_no', v_cur.revision_no),
    jsonb_build_object('revision_id', v_new.id, 'revision_no', v_new.revision_no, 'configuration_revision_id', v_config.id), p_reason, 'quotation.create');
  return app.quotation_json(v_new);
end;
$$;

create function public.add_quotation_negotiation(p_quotation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_q public.quotations;
  v_lead public.leads;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_at timestamptz := app.jts(v_payload, 'occurred_at');
  v_bps integer := app.jint(v_payload, 'requested_discount_bps');
  v_missing text[] := '{}';
  v_id uuid;
begin
  select * into v_q from public.quotations where id = p_quotation_id;
  select * into v_lead from public.leads where id = v_q.lead_id;
  if v_q.id is null or not app.can_read_lead_row(v_lead.organization_id, v_lead.owner_user_id, v_lead.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'quotation'));
  end if;
  perform app.require_lead_owner(v_lead, 'quotation.create');
  if v_at is null then v_missing := v_missing || 'occurred_at'::text; end if;
  if length(btrim(coalesce(v_payload ->> 'contact', ''))) < 2 then v_missing := v_missing || 'negotiation_contact'::text; end if;
  if length(btrim(coalesce(v_payload ->> 'topic', ''))) < 2 then v_missing := v_missing || 'topic'::text; end if;
  if cardinality(v_missing) > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;
  if v_at > now() + interval '1 day' then perform app.j_field_error('occurred_at'); end if;
  if v_bps is not null and (v_bps < 0 or v_bps > 10000) then perform app.j_field_error('requested_discount_bps'); end if;
  insert into public.quotation_negotiations (quotation_id, revision_id, occurred_at, contact, topic, requested_change, requested_discount_bps, expected_impact, decision, recorded_by)
  values (v_q.id, v_q.current_revision_id, v_at, btrim(v_payload ->> 'contact'), btrim(v_payload ->> 'topic'),
    nullif(btrim(coalesce(v_payload ->> 'requested_change', '')), ''), v_bps, nullif(btrim(coalesce(v_payload ->> 'expected_impact', '')), ''),
    nullif(btrim(coalesce(v_payload ->> 'decision', '')), ''), v_uid)
  returning id into v_id;
  perform app.audit(v_q.organization_id, 'quotation', v_q.id, 'quotation.negotiation_recorded', null,
    jsonb_build_object('negotiation_id', v_id, 'topic', v_payload ->> 'topic', 'requested_discount_bps', v_bps), null, 'quotation.create');
  return jsonb_build_object('negotiation_id', v_id, 'quotation_id', v_q.id);
end;
$$;

-- =============================================================================
-- RLS & grants
-- =============================================================================
create function app.can_read_document_revision_row(p_document_id uuid, p_status public.document_revision_state)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_read_document_revision(d.organization_id, d.lead_id, p_status) from public.technical_documents d where d.id = p_document_id), false)
$$;

alter table public.technical_reviews enable row level security;
alter table public.configuration_revisions enable row level security;
alter table public.technical_documents enable row level security;
alter table public.document_revisions enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_revisions enable row level security;
alter table public.quotation_lines enable row level security;
alter table public.quotation_negotiations enable row level security;
alter table public.customer_acceptances enable row level security;
alter table public.approval_requests enable row level security;

create policy technical_reviews_read on public.technical_reviews for select to authenticated using (app.can_read_technical(organization_id, lead_id));
create policy configuration_revisions_read on public.configuration_revisions for select to authenticated using (app.can_read_technical(organization_id, lead_id));
create policy technical_documents_read on public.technical_documents for select to authenticated using (app.can_read_technical(organization_id, lead_id));
create policy document_revisions_read on public.document_revisions for select to authenticated using (app.can_read_document_revision_row(document_id, status));
-- Commercial records: the lead's sales owner and lead.read_all (Owner). Technical, field, partner and customer roles never see prices or costs.
create policy quotations_read on public.quotations for select to authenticated using (app.can_read_lead(lead_id));
create policy quotation_revisions_read on public.quotation_revisions for select to authenticated using (app.can_read_quotation(quotation_id));
create policy quotation_lines_read on public.quotation_lines for select to authenticated using (app.can_read_quotation_revision(revision_id));
create policy quotation_negotiations_read on public.quotation_negotiations for select to authenticated using (app.can_read_quotation(quotation_id));
create policy customer_acceptances_read on public.customer_acceptances for select to authenticated using (app.can_read_quotation_revision(revision_id));
create policy approval_requests_read on public.approval_requests for select to authenticated using (
  requested_by = auth.uid() or app.user_has_permission(auth.uid(), 'quotation.discount.approve', organization_id));

revoke all on public.technical_reviews, public.configuration_revisions, public.technical_documents, public.document_revisions,
  public.quotations, public.quotation_revisions, public.quotation_lines, public.quotation_negotiations, public.customer_acceptances,
  public.approval_requests from anon, authenticated;
grant select on public.technical_reviews, public.configuration_revisions, public.technical_documents, public.document_revisions,
  public.quotations, public.quotation_revisions, public.quotation_lines, public.quotation_negotiations, public.customer_acceptances,
  public.approval_requests to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.start_technical_review(uuid),
  public.request_technical_clarification(uuid, integer, text),
  public.decide_technical_review(uuid, integer, text, jsonb),
  public.save_configuration_draft(uuid, integer, text, jsonb, text),
  public.approve_configuration(uuid, integer),
  public.register_document_revision(uuid, uuid, uuid, jsonb),
  public.submit_document_revision(uuid, integer),
  public.decide_document_revision(uuid, integer, text, text, text),
  public.create_quotation(uuid, uuid),
  public.save_quotation_draft(uuid, integer, jsonb, jsonb, date),
  public.submit_quotation(uuid, integer),
  public.decide_quotation_approval(uuid, text, text),
  public.issue_quotation(uuid, integer),
  public.record_customer_response(uuid, integer, text, jsonb),
  public.revise_quotation(uuid, text),
  public.add_quotation_negotiation(uuid, jsonb),
  public.request_survey_revision(uuid, integer, text)
  to authenticated;
revoke execute on all functions in schema app from public, anon;
grant execute on function
  app.can_read_technical(uuid, uuid), app.can_read_document_revision(uuid, uuid, public.document_revision_state),
  app.can_read_document_revision_row(uuid, public.document_revision_state),
  app.parse_document_path(text), app.can_upload_document_object(text), app.can_read_document_object(text),
  app.can_read_quotation(uuid), app.can_read_quotation_revision(uuid)
  to authenticated;

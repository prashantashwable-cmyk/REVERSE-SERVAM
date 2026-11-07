-- =============================================================================
-- Slice 2b: survey scheduling, field check-in, versioned survey capture,
-- evidence registration (private storage), Gate 1 submission, revision loop.
-- =============================================================================

create type public.survey_state as enum (
  'scheduled', 'accepted', 'reschedule_requested', 'in_progress', 'revisit_requested',
  'site_inaccessible', 'submitted', 'revision_requested', 'under_review', 'reviewed', 'cancelled');
create type public.gps_status as enum ('verified', 'low_accuracy', 'permission_denied', 'unavailable');

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  survey_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null references public.leads (id),
  site_id uuid not null references public.sites (id),
  surveyor_id uuid not null references public.user_profiles (id),
  status public.survey_state not null default 'scheduled',
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  scope text not null check (length(btrim(scope)) >= 3),
  special_instructions text,
  -- Contact snapshot for the field: surveyors never read the sales lead record.
  site_contact_name text not null check (length(btrim(site_contact_name)) >= 2),
  site_contact_phone text check (site_contact_phone is null or site_contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  current_revision_id uuid,
  checked_in_at timestamptz,
  check_in_client_time timestamptz,
  check_in_location extensions.geography(Point, 4326),
  check_in_accuracy_m numeric(10, 1),
  gps_status public.gps_status,
  gps_exception_reason text,
  gps_exception_decision text check (gps_exception_decision is null or gps_exception_decision in ('accepted', 'rejected')),
  gps_exception_reviewed_by uuid references public.user_profiles (id),
  gps_exception_reviewed_at timestamptz,
  status_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check (scheduled_end > scheduled_start),
  check (gps_status is null or gps_status = 'verified' or length(btrim(coalesce(gps_exception_reason, ''))) >= 3),
  -- A surveyor cannot be double-booked for active appointments (backstop for the RPC check).
  constraint surveys_no_double_booking exclude using gist (
    surveyor_id with =,
    tstzrange(scheduled_start, scheduled_end, '[)') with &&
  ) where (status in ('scheduled', 'accepted'))
);
create index surveys_surveyor_idx on public.surveys (surveyor_id, scheduled_start);
create index surveys_lead_idx on public.surveys (lead_id);
create index surveys_org_status_idx on public.surveys (organization_id, status);
create trigger surveys_touch before update on public.surveys for each row execute function app.touch_row();

create table public.survey_revisions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id),
  revision_no integer not null check (revision_no > 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'superseded')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  requirements_version integer,
  submitted_evidence_ids uuid[],
  revision_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  submitted_at timestamptz,
  submitted_by uuid references public.user_profiles (id),
  unique (survey_id, revision_no),
  check ((status = 'draft') = (submitted_at is null))
);
alter table public.surveys add constraint surveys_current_revision_fk foreign key (current_revision_id) references public.survey_revisions (id);
create unique index survey_revisions_one_draft on public.survey_revisions (survey_id) where status = 'draft';
create trigger survey_revisions_touch before update on public.survey_revisions for each row execute function app.touch_row();

-- Submitted survey versions are immutable (§8.7); only submitted → superseded.
create function app.guard_survey_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'survey revisions cannot be deleted'));
  end if;
  if old.status <> 'draft' then
    if not (old.status = 'submitted' and new.status = 'superseded'
            and new.data = old.data and new.submitted_at = old.submitted_at
            and new.submitted_evidence_ids is not distinct from old.submitted_evidence_ids) then
      perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'submitted survey revisions are immutable'));
    end if;
  end if;
  return new;
end;
$$;
create trigger survey_revisions_guard before update or delete on public.survey_revisions
  for each row execute function app.guard_survey_revision();

create table public.survey_measurements (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.survey_revisions (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  value_mm numeric(10, 1) not null check (value_mm > 0),
  entered_value numeric(12, 3) not null check (entered_value > 0),
  entered_unit text not null check (entered_unit in ('mm', 'cm', 'm')),
  level_label text not null default '',
  note text,
  unique (revision_id, key, level_label)
);

create function app.guard_survey_measurement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rev uuid := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
begin
  if (select status from public.survey_revisions where id = v_rev) <> 'draft' then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'measurements of a submitted revision are immutable'));
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger survey_measurements_guard before insert or update or delete on public.survey_measurements
  for each row execute function app.guard_survey_measurement();

-- Evidence metadata (§8.6, §51.1). Files live in the private `evidence` bucket.
create table public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  survey_id uuid not null references public.surveys (id),
  survey_revision_id uuid not null references public.survey_revisions (id),
  project_id uuid,
  category text not null check (category ~ '^[a-z][a-z0-9_]{1,60}$'),
  storage_bucket text not null default 'evidence',
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  source text not null check (source in ('in_app_camera', 'document_import', 'gallery_exception')),
  source_exception_reason text,
  captured_by uuid not null references public.user_profiles (id),
  captured_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  capture_location extensions.geography(Point, 4326),
  capture_accuracy_m numeric(10, 1),
  device_meta jsonb,
  remarks text,
  status text not null default 'active' check (status in ('active', 'superseded')),
  supersedes_id uuid references public.evidence_files (id),
  superseded_by_id uuid references public.evidence_files (id),
  access_class text not null default 'internal' check (access_class in ('internal', 'customer_visible')),
  operation_id uuid not null unique,
  unique (storage_bucket, storage_path),
  check (source <> 'gallery_exception' or length(btrim(coalesce(source_exception_reason, ''))) >= 3),
  check ((status = 'superseded') = (superseded_by_id is not null))
);
create index evidence_files_survey_idx on public.evidence_files (survey_id, category) where status = 'active';

-- Original evidence is never altered or deleted; only supersession is recorded.
create function app.guard_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'evidence cannot be deleted'));
  end if;
  if not (old.status = 'active' and new.status = 'superseded' and new.superseded_by_id is not null
          and (to_jsonb(new) - 'status' - 'superseded_by_id') = (to_jsonb(old) - 'status' - 'superseded_by_id')) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'evidence is immutable'));
  end if;
  return new;
end;
$$;
create trigger evidence_files_guard before update or delete on public.evidence_files
  for each row execute function app.guard_evidence();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Read authorization
-- -----------------------------------------------------------------------------
create function app.can_read_survey_row(p_org uuid, p_surveyor uuid, p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'survey.read_all', p_org)
    or (p_surveyor = auth.uid() and app.user_has_permission(auth.uid(), 'survey.read_assigned', p_org))
    or exists (select 1 from public.leads l where l.id = p_lead and app.can_read_lead_row(l.organization_id, l.owner_user_id, l.id))
$$;

create function app.can_read_survey(p_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_read_survey_row(s.organization_id, s.surveyor_id, s.lead_id) from public.surveys s where s.id = p_survey_id), false)
$$;

create function app.can_read_survey_revision(p_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_read_survey(r.survey_id) from public.survey_revisions r where r.id = p_revision_id), false)
$$;

-- Sites are visible through readable leads or readable surveys.
create or replace function app.can_read_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leads l where l.site_id = p_site_id and app.can_read_lead_row(l.organization_id, l.owner_user_id, l.id))
      or exists (select 1 from public.surveys s where s.site_id = p_site_id and app.can_read_survey_row(s.organization_id, s.surveyor_id, s.lead_id))
$$;

-- Storage path convention: {organization_id}/surveys/{survey_id}/{operation_id}.{ext}
create function app.parse_evidence_path(p_name text)
returns table (organization_id uuid, survey_id uuid, operation_id uuid, extension text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_file text[];
begin
  if array_length(v_parts, 1) <> 4 or v_parts[2] <> 'surveys'
     or v_parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|pdf)$' then
    return;
  end if;
  v_file := string_to_array(v_parts[4], '.');
  return query select app.try_uuid(v_parts[1]), app.try_uuid(v_parts[3]), app.try_uuid(v_file[1]), v_file[2];
end;
$$;

create function app.can_upload_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.parse_evidence_path(p_name) p
    join public.surveys s on s.id = p.survey_id and s.organization_id = p.organization_id
    where s.surveyor_id = auth.uid()
      and s.status = 'in_progress'
      and app.user_has_permission(auth.uid(), 'survey.capture', s.organization_id)
  )
$$;

create function app.can_read_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.parse_evidence_path(p_name) p
    join public.surveys s on s.id = p.survey_id and s.organization_id = p.organization_id
    where app.can_read_survey_row(s.organization_id, s.surveyor_id, s.lead_id)
  )
$$;

create policy evidence_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and app.can_upload_evidence_object(name));
create policy evidence_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and app.can_read_evidence_object(name));
-- No UPDATE / DELETE policies: stored evidence is immutable for API roles.

-- -----------------------------------------------------------------------------
-- Gate 1: survey completeness (mirrors packages/domain validateSurveySubmission)
-- -----------------------------------------------------------------------------
create function app.survey_submission_failures(p_revision_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req jsonb := app.rule('survey.requirements');
  v_rev public.survey_revisions;
  v_fields text[];
  v_measure text[];
  v_evidence text[];
  v_docs text[];
  v_live text[];
  v_failures jsonb := '[]'::jsonb;
begin
  select * into v_rev from public.survey_revisions where id = p_revision_id;
  select coalesce(array_agg(distinct category), '{}') into v_live
    from public.evidence_files where survey_id = v_rev.survey_id and status = 'active';

  select coalesce(array_agg(f order by ord), '{}') into v_fields
    from jsonb_array_elements_text(v_req -> 'required_fields') with ordinality as t(f, ord)
   where v_rev.data #> string_to_array(f, '.') is null
      or jsonb_typeof(v_rev.data #> string_to_array(f, '.')) = 'null'
      or (jsonb_typeof(v_rev.data #> string_to_array(f, '.')) = 'string' and btrim(v_rev.data #>> string_to_array(f, '.')) = '')
      or (jsonb_typeof(v_rev.data #> string_to_array(f, '.')) = 'array' and jsonb_array_length(v_rev.data #> string_to_array(f, '.')) = 0);

  select coalesce(array_agg('measurement.' || k order by ord), '{}') into v_measure
    from jsonb_array_elements_text(v_req -> 'required_measurements') with ordinality as t(k, ord)
   where not exists (select 1 from public.survey_measurements m where m.revision_id = p_revision_id and m.key = k and m.value_mm > 0);

  select coalesce(array_agg(c order by ord), '{}') into v_evidence
    from jsonb_array_elements_text(v_req -> 'required_evidence') with ordinality as t(c, ord)
   where not c = any (v_live);

  select coalesce(array_agg(d order by ord), '{}') into v_docs
    from jsonb_array_elements_text(v_req -> 'required_documents') with ordinality as t(d, ord)
   where not d = any (v_live)
     and length(btrim(coalesce(v_rev.data #>> array['documents_unavailable', d], ''))) < 3;

  if cardinality(v_fields) > 0 then
    v_failures := v_failures || jsonb_build_object('code', 'REQUIRED_FIELD_MISSING', 'message', 'Required survey fields missing', 'fields', to_jsonb(v_fields));
  end if;
  if cardinality(v_measure) > 0 then
    v_failures := v_failures || jsonb_build_object('code', 'REQUIRED_FIELD_MISSING', 'message', 'Required measurements missing', 'fields', to_jsonb(v_measure));
  end if;
  if cardinality(v_evidence) > 0 then
    v_failures := v_failures || jsonb_build_object('code', 'EVIDENCE_REQUIRED', 'message', 'Required photo evidence missing', 'missing', to_jsonb(v_evidence));
  end if;
  if cardinality(v_docs) > 0 then
    v_failures := v_failures || jsonb_build_object('code', 'EVIDENCE_REQUIRED', 'message', 'Attach documents or mark them unavailable with a reason', 'missing', to_jsonb(v_docs));
  end if;
  return v_failures;
end;
$$;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create function app.lock_survey(p_survey_id uuid)
returns public.surveys
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.surveys;
begin
  select * into v from public.surveys where id = p_survey_id for update;
  if not found or not app.can_read_survey_row(v.organization_id, v.surveyor_id, v.lead_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'survey'));
  end if;
  return v;
end;
$$;

create function app.require_assigned_surveyor(p_survey public.surveys)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission('survey.capture', p_survey.organization_id);
  if p_survey.surveyor_id <> auth.uid() then
    perform app.raise_error('PROJECT_NOT_ASSIGNED', jsonb_build_object('entity', 'survey'));
  end if;
end;
$$;

-- Scheduler authority: survey.schedule and the lead is in the scheduler's book.
create function app.require_survey_scheduler(p_lead_id uuid)
returns public.leads
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found or not app.can_read_lead_row(v_lead.organization_id, v_lead.owner_user_id, v_lead.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'lead'));
  end if;
  perform app.require_permission('survey.schedule', v_lead.organization_id);
  return v_lead;
end;
$$;

create function app.assert_surveyor_available(p_surveyor uuid, p_org uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_start is null or p_end is null or p_end <= p_start then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('scheduled_start', 'scheduled_end')));
  end if;
  if p_end - p_start > interval '12 hours' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('scheduled_end'), 'reason', 'appointment longer than 12 hours'));
  end if;
  if not app.user_has_permission(p_surveyor, 'survey.capture', p_org) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('surveyor_id'), 'reason', 'not an active surveyor'));
  end if;
  if exists (
    select 1 from public.surveys
    where surveyor_id = p_surveyor and status in ('scheduled', 'accepted')
      and (p_exclude is null or id <> p_exclude)
      and tstzrange(scheduled_start, scheduled_end, '[)') && tstzrange(p_start, p_end, '[)')
  ) then
    perform app.raise_error('SCHEDULE_CONFLICT', jsonb_build_object('surveyor_id', p_surveyor));
  end if;
end;
$$;

create function app.survey_json(p public.surveys)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('survey_id', p.id, 'survey_number', p.survey_number, 'status', p.status,
    'current_revision_id', p.current_revision_id, 'version', p.version, 'gps_status', p.gps_status)
$$;

-- -----------------------------------------------------------------------------
-- RPCs — scheduling (Sales)
-- -----------------------------------------------------------------------------
create function public.schedule_survey(
  p_operation_id uuid, p_lead_id uuid, p_surveyor_id uuid, p_scheduled_start timestamptz, p_scheduled_end timestamptz,
  p_scope text, p_special_instructions text default null, p_site_contact_name text default null, p_site_contact_phone text default null
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
  v_site public.sites;
  v_survey public.surveys;
  v_rev_id uuid;
  v_phone text;
begin
  v_lead := app.require_survey_scheduler(p_lead_id);
  v_replay := app.op_begin(p_operation_id, 'survey.schedule');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_lead.status <> 'qualified' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'lead must be qualified before a survey is scheduled', 'currentState', v_lead.status));
  end if;
  if p_scope is null or length(btrim(p_scope)) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('scope')));
  end if;
  if p_scheduled_start < now() - interval '1 hour' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('scheduled_start'), 'reason', 'appointment is in the past'));
  end if;
  perform app.assert_surveyor_available(p_surveyor_id, v_lead.organization_id, p_scheduled_start, p_scheduled_end, null);
  v_phone := coalesce(app.normalize_phone(p_site_contact_phone), v_lead.phone_e164);
  if p_site_contact_phone is not null and btrim(p_site_contact_phone) <> '' and app.normalize_phone(p_site_contact_phone) is null then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('site_contact_phone')));
  end if;
  select * into v_site from public.sites where id = v_lead.site_id;

  insert into public.surveys (survey_number, organization_id, lead_id, site_id, surveyor_id, scheduled_start, scheduled_end,
    scope, special_instructions, site_contact_name, site_contact_phone, created_by, updated_by)
  values (app.next_business_id('SV', app.city_code(v_site.city)), v_lead.organization_id, v_lead.id, v_lead.site_id, p_surveyor_id,
    p_scheduled_start, p_scheduled_end, btrim(p_scope), nullif(btrim(coalesce(p_special_instructions, '')), ''),
    coalesce(nullif(btrim(coalesce(p_site_contact_name, '')), ''), v_lead.contact_name), v_phone, v_uid, v_uid)
  returning * into v_survey;

  insert into public.survey_revisions (survey_id, revision_no, created_by, updated_by)
  values (v_survey.id, 1, v_uid, v_uid) returning id into v_rev_id;
  update public.surveys set current_revision_id = v_rev_id where id = v_survey.id returning * into v_survey;

  perform app.audit(v_survey.organization_id, 'survey', v_survey.id, 'survey.scheduled', null,
    jsonb_build_object('survey_number', v_survey.survey_number, 'lead_id', v_lead.id, 'surveyor_id', p_surveyor_id,
                       'scheduled_start', p_scheduled_start, 'scheduled_end', p_scheduled_end),
    null, 'survey.schedule', p_operation_id);
  perform app.notify(p_surveyor_id, v_survey.organization_id, 'survey.scheduled', 'survey', v_survey.id, 'notification.survey_scheduled',
    jsonb_build_object('survey_number', v_survey.survey_number, 'scheduled_start', p_scheduled_start),
    'survey.scheduled:' || v_survey.id || ':' || v_survey.version);
  return app.op_finish(p_operation_id, v_survey.id, app.survey_json(v_survey));
exception when exclusion_violation then
  perform app.raise_error('SCHEDULE_CONFLICT', jsonb_build_object('surveyor_id', p_surveyor_id));
end;
$$;

create function public.reschedule_survey(
  p_survey_id uuid, p_expected_version integer, p_scheduled_start timestamptz, p_scheduled_end timestamptz,
  p_surveyor_id uuid default null, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.surveys := app.lock_survey(p_survey_id);
  v_new public.surveys;
  v_t public.state_transitions;
  v_surveyor uuid := coalesce(p_surveyor_id, v_old.surveyor_id);
begin
  perform app.require_survey_scheduler(v_old.lead_id);
  perform app.assert_version(p_expected_version, v_old.version);
  v_t := app.transition('survey', v_old.status::text, 'reschedule', p_reason);
  perform app.assert_surveyor_available(v_surveyor, v_old.organization_id, p_scheduled_start, p_scheduled_end, v_old.id);
  update public.surveys
     set status = v_t.to_state::public.survey_state, scheduled_start = p_scheduled_start, scheduled_end = p_scheduled_end,
         surveyor_id = v_surveyor, status_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_survey_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'survey', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status, 'surveyor_id', v_old.surveyor_id, 'scheduled_start', v_old.scheduled_start, 'scheduled_end', v_old.scheduled_end),
    jsonb_build_object('status', v_new.status, 'surveyor_id', v_new.surveyor_id, 'scheduled_start', v_new.scheduled_start, 'scheduled_end', v_new.scheduled_end),
    p_reason, v_t.permission_code);
  perform app.notify(v_surveyor, v_new.organization_id, 'survey.scheduled', 'survey', v_new.id, 'notification.survey_scheduled',
    jsonb_build_object('survey_number', v_new.survey_number, 'scheduled_start', v_new.scheduled_start),
    'survey.scheduled:' || v_new.id || ':' || v_new.version);
  return app.survey_json(v_new);
exception when exclusion_violation then
  perform app.raise_error('SCHEDULE_CONFLICT', jsonb_build_object('surveyor_id', v_surveyor));
end;
$$;

create function public.cancel_survey(p_survey_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.surveys := app.lock_survey(p_survey_id);
  v_new public.surveys;
  v_t public.state_transitions;
begin
  perform app.require_survey_scheduler(v_old.lead_id);
  perform app.assert_version(p_expected_version, v_old.version);
  v_t := app.transition('survey', v_old.status::text, 'cancel', p_reason);
  update public.surveys set status = v_t.to_state::public.survey_state, status_reason = btrim(p_reason)
   where id = p_survey_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'survey', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new.status), p_reason, v_t.permission_code);
  perform app.notify(v_new.surveyor_id, v_new.organization_id, 'survey.cancelled', 'survey', v_new.id, 'notification.survey_cancelled',
    jsonb_build_object('survey_number', v_new.survey_number), 'survey.cancelled:' || v_new.id);
  return app.survey_json(v_new);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs — field (assigned Surveyor)
-- -----------------------------------------------------------------------------
-- Generic simple surveyor transition (accept / request_reschedule / request_revisit /
-- report_inaccessible / start_revision) with version check and notifications.
create function public.survey_field_action(p_survey_id uuid, p_expected_version integer, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.surveys := app.lock_survey(p_survey_id);
  v_new public.surveys;
  v_t public.state_transitions;
  v_lead_owner uuid;
begin
  if p_action not in ('accept', 'request_reschedule', 'request_revisit', 'report_inaccessible', 'start_revision') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('action')));
  end if;
  perform app.require_assigned_surveyor(v_old);
  perform app.assert_version(p_expected_version, v_old.version);
  v_t := app.transition('survey', v_old.status::text, p_action, p_reason);
  update public.surveys set status = v_t.to_state::public.survey_state, status_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_survey_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'survey', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new.status), p_reason, v_t.permission_code);
  if p_action in ('request_reschedule', 'request_revisit', 'report_inaccessible') then
    select owner_user_id into v_lead_owner from public.leads where id = v_new.lead_id;
    if v_lead_owner is not null then
      perform app.notify(v_lead_owner, v_new.organization_id, v_t.audit_event, 'survey', v_new.id, 'notification.' || replace(v_t.audit_event, '.', '_'),
        jsonb_build_object('survey_number', v_new.survey_number, 'reason', p_reason), v_t.audit_event || ':' || v_new.id || ':' || v_new.version,
        case when p_action = 'report_inaccessible' then 'warning' else 'info' end);
    end if;
  end if;
  return app.survey_json(v_new);
end;
$$;

-- SV02 Site check-in. The SERVER classifies GPS; a client cannot claim "verified".
create function public.check_in_survey(
  p_operation_id uuid, p_survey_id uuid, p_location_permission text,
  p_latitude double precision, p_longitude double precision, p_accuracy_m double precision,
  p_client_time timestamptz, p_exception_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_old public.surveys := app.lock_survey(p_survey_id);
  v_new public.surveys;
  v_t public.state_transitions;
  v_max numeric := coalesce((app.rule('gps.check_in') ->> 'max_accuracy_m')::numeric, 50);
  v_status public.gps_status;
  v_point extensions.geography;
begin
  perform app.require_assigned_surveyor(v_old);
  v_replay := app.op_begin(p_operation_id, 'survey.check_in');
  if v_replay is not null then
    return v_replay;
  end if;
  v_t := app.transition('survey', v_old.status::text, 'check_in');
  if p_location_permission is null or p_location_permission not in ('granted', 'denied', 'undetermined') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('location_permission')));
  end if;
  if p_location_permission <> 'granted' then
    v_status := 'permission_denied';
  elsif p_latitude is null or p_longitude is null or p_accuracy_m is null or p_accuracy_m < 0
        or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    v_status := 'unavailable';
  elsif p_accuracy_m <= v_max then
    v_status := 'verified';
  else
    v_status := 'low_accuracy';
  end if;
  if v_status in ('verified', 'low_accuracy') then
    v_point := app.geo_point(p_latitude, p_longitude);
  end if;
  if v_status <> 'verified' and length(btrim(coalesce(p_exception_reason, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('exception_reason'), 'gps_status', v_status));
  end if;
  update public.surveys
     set status = v_t.to_state::public.survey_state,
         checked_in_at = now(), check_in_client_time = p_client_time,
         check_in_location = v_point, check_in_accuracy_m = case when v_point is null then null else round(p_accuracy_m::numeric, 1) end,
         gps_status = v_status,
         gps_exception_reason = case when v_status = 'verified' then null else btrim(p_exception_reason) end
   where id = p_survey_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'survey', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', v_new.status, 'gps_status', v_status, 'accuracy_m', v_new.check_in_accuracy_m, 'client_time', p_client_time),
    v_new.gps_exception_reason, v_t.permission_code, p_operation_id);
  if v_status <> 'verified' then
    perform app.notify_permission_holders('survey.gps_exception.review', v_new.organization_id, 'survey.gps_exception', 'survey', v_new.id,
      'notification.survey_gps_exception', jsonb_build_object('survey_number', v_new.survey_number, 'gps_status', v_status),
      'survey.gps_exception:' || v_new.id || ':' || v_new.version);
  end if;
  return app.op_finish(p_operation_id, v_new.id, app.survey_json(v_new));
end;
$$;

-- SV03/SV04 autosave of the current draft revision. Optimistic concurrency via
-- the revision version: a stale device gets REVISION_CONFLICT, never a silent overwrite.
create function public.save_survey_draft(
  p_operation_id uuid, p_survey_id uuid, p_revision_id uuid, p_expected_revision_version integer,
  p_data jsonb, p_measurements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_survey public.surveys := app.lock_survey(p_survey_id);
  v_rev public.survey_revisions;
  v_m jsonb;
  v_unit text;
  v_entered numeric;
  v_key text;
  v_bad_keys text[];
  v_count integer := 0;
begin
  perform app.require_assigned_surveyor(v_survey);
  v_replay := app.op_begin(p_operation_id, 'survey.save_draft');
  if v_replay is not null then
    return v_replay;
  end if;
  perform app.transition('survey', v_survey.status::text, 'save_draft');
  select * into v_rev from public.survey_revisions where id = p_revision_id and survey_id = p_survey_id for update;
  if not found or v_rev.id <> v_survey.current_revision_id or v_rev.status <> 'draft' then
    perform app.raise_error('REVISION_CONFLICT', jsonb_build_object('reason', 'not the current draft revision', 'current_revision_id', v_survey.current_revision_id));
  end if;
  perform app.assert_version(p_expected_revision_version, v_rev.version);
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('data')));
  end if;
  select array_agg(k) into v_bad_keys from jsonb_object_keys(p_data) k
   where k not in ('building', 'shaft', 'machine_room', 'electrical', 'logistics', 'documents_unavailable', 'critical_unknowns', 'observations');
  if v_bad_keys is not null then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', to_jsonb(v_bad_keys), 'reason', 'unknown survey section'));
  end if;
  if octet_length(p_data::text) > 200000 then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('data'), 'reason', 'too large'));
  end if;
  if p_measurements is not null and jsonb_typeof(p_measurements) <> 'array' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('measurements')));
  end if;

  update public.survey_revisions set data = p_data where id = v_rev.id returning * into v_rev;

  if p_measurements is not null then
    delete from public.survey_measurements where revision_id = v_rev.id;
    for v_m in select * from jsonb_array_elements(p_measurements) loop
      v_key := v_m ->> 'key';
      v_unit := v_m ->> 'entered_unit';
      v_entered := app.jnum(v_m, 'entered_value', 'measurement.' || coalesce(v_key, '?'));
      if v_key is null or v_key !~ '^[a-z][a-z0-9_]{1,60}$' or v_unit not in ('mm', 'cm', 'm') or v_entered is null or v_entered <= 0 then
        perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('measurement.' || coalesce(v_key, '?'))));
      end if;
      -- The server derives the normalized value; the entered value and unit are preserved.
      insert into public.survey_measurements (revision_id, key, value_mm, entered_value, entered_unit, level_label, note)
      values (v_rev.id, v_key,
              round(v_entered * case v_unit when 'mm' then 1 when 'cm' then 10 else 1000 end, 1),
              v_entered, v_unit, coalesce(btrim(v_m ->> 'level_label'), ''), nullif(btrim(coalesce(v_m ->> 'note', '')), ''));
      v_count := v_count + 1;
    end loop;
  end if;

  perform app.audit(v_survey.organization_id, 'survey_revision', v_rev.id, 'survey.draft_saved', null,
    jsonb_build_object('revision_no', v_rev.revision_no, 'version', v_rev.version, 'measurements', v_count),
    null, 'survey.capture', p_operation_id);
  return app.op_finish(p_operation_id, v_rev.id, jsonb_build_object(
    'survey_id', p_survey_id, 'revision_id', v_rev.id, 'revision_version', v_rev.version,
    'failures', app.survey_submission_failures(v_rev.id)));
exception when unique_violation then
  perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'duplicate measurement key and level'));
end;
$$;

-- SV05 Evidence: the file is uploaded to private storage first, then registered.
create function public.register_evidence(p_operation_id uuid, p_survey_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_survey public.surveys := app.lock_survey(p_survey_id);
  v_policy jsonb := app.rule('evidence.files');
  v_path text := p_payload ->> 'storage_path';
  v_parsed record;
  v_object record;
  v_category text := p_payload ->> 'category';
  v_source text := coalesce(p_payload ->> 'source', 'in_app_camera');
  v_mime text := lower(coalesce(p_payload ->> 'mime_type', ''));
  v_size bigint := app.jint(p_payload, 'size_bytes');
  v_supersedes uuid := app.try_uuid(p_payload ->> 'supersedes_id');
  v_old_evidence public.evidence_files;
  v_id uuid;
begin
  perform app.require_assigned_surveyor(v_survey);
  v_replay := app.op_begin(p_operation_id, 'evidence.register');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_survey.status <> 'in_progress' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_survey.status, 'reason', 'evidence can be added while the survey is in progress'));
  end if;
  select * into v_parsed from app.parse_evidence_path(v_path);
  if v_parsed.survey_id is null or v_parsed.survey_id <> p_survey_id or v_parsed.organization_id <> v_survey.organization_id
     or v_parsed.operation_id <> p_operation_id then
    -- Prevents attaching a file to the wrong project / survey (§38 SV05).
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('storage_path')));
  end if;
  select o.name, o.metadata into v_object from storage.objects o where o.bucket_id = 'evidence' and o.name = v_path;
  if v_object.name is null then
    perform app.raise_error('FILE_UPLOAD_FAILED', jsonb_build_object('reason', 'file not found in storage; upload first'));
  end if;
  if v_category is null or v_category !~ '^[a-z][a-z0-9_]{1,60}$' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('category')));
  end if;
  if not (v_policy -> 'allowed_mime_types') ? v_mime then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('mime_type')));
  end if;
  if v_size is null or v_size <= 0 or v_size > (v_policy ->> 'max_bytes')::bigint
     or (v_object.metadata ? 'size' and (v_object.metadata ->> 'size')::bigint <> v_size) then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('size_bytes')));
  end if;
  if coalesce(p_payload ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('sha256')));
  end if;
  -- Camera-first: gallery imports need a documented exception; document imports only for document categories.
  if v_source not in ('in_app_camera', 'document_import', 'gallery_exception') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('source')));
  end if;
  if v_source = 'document_import' and v_category !~ '^doc_' then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('source'), 'reason', 'photo evidence must be captured in-app'));
  end if;
  if v_source = 'gallery_exception' and length(btrim(coalesce(p_payload ->> 'source_exception_reason', ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('source_exception_reason')));
  end if;
  if v_supersedes is not null then
    select * into v_old_evidence from public.evidence_files where id = v_supersedes for update;
    if not found or v_old_evidence.survey_id <> p_survey_id or v_old_evidence.status <> 'active' or v_old_evidence.category <> v_category then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('supersedes_id')));
    end if;
  end if;

  insert into public.evidence_files (
    organization_id, survey_id, survey_revision_id, category, storage_path, sha256, mime_type, size_bytes, source,
    source_exception_reason, captured_by, captured_at, capture_location, capture_accuracy_m, device_meta, remarks,
    supersedes_id, operation_id)
  values (
    v_survey.organization_id, p_survey_id, v_survey.current_revision_id, v_category, v_path, p_payload ->> 'sha256', v_mime, v_size, v_source,
    nullif(btrim(coalesce(p_payload ->> 'source_exception_reason', '')), ''), v_uid,
    coalesce(app.jts(p_payload, 'captured_at'), now()),
    app.geo_point(app.jnum(p_payload, 'latitude')::double precision, app.jnum(p_payload, 'longitude')::double precision),
    app.jnum(p_payload, 'accuracy_m'),
    case when jsonb_typeof(p_payload -> 'device_meta') = 'object' then p_payload -> 'device_meta' end,
    nullif(btrim(coalesce(p_payload ->> 'remarks', '')), ''),
    v_supersedes, p_operation_id)
  returning id into v_id;
  if v_supersedes is not null then
    update public.evidence_files set status = 'superseded', superseded_by_id = v_id where id = v_supersedes;
  end if;
  perform app.audit(v_survey.organization_id, 'evidence', v_id, 'evidence.registered', null,
    jsonb_build_object('survey_id', p_survey_id, 'category', v_category, 'sha256', p_payload ->> 'sha256', 'source', v_source, 'supersedes_id', v_supersedes),
    p_payload ->> 'source_exception_reason', 'survey.capture', p_operation_id);
  return app.op_finish(p_operation_id, v_id, jsonb_build_object('evidence_id', v_id, 'survey_id', p_survey_id, 'category', v_category));
end;
$$;

-- SV06 Submit: Gate 1, locks the revision, creates the technical review queue item.
create function public.submit_survey(p_operation_id uuid, p_survey_id uuid, p_expected_revision_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_old public.surveys := app.lock_survey(p_survey_id);
  v_new public.surveys;
  v_rev public.survey_revisions;
  v_t public.state_transitions;
  v_failures jsonb;
  v_lead_owner uuid;
begin
  perform app.require_assigned_surveyor(v_old);
  v_replay := app.op_begin(p_operation_id, 'survey.submit');
  if v_replay is not null then
    return v_replay;
  end if;
  v_t := app.transition('survey', v_old.status::text, 'submit');
  select * into v_rev from public.survey_revisions where id = v_old.current_revision_id for update;
  perform app.assert_version(p_expected_revision_version, v_rev.version);
  v_failures := app.survey_submission_failures(v_rev.id);
  if jsonb_array_length(v_failures) > 0 then
    perform app.raise_error(v_failures -> 0 ->> 'code', jsonb_build_object(
      'failures', v_failures,
      'fields', coalesce((select jsonb_agg(f) from jsonb_array_elements(v_failures) x, jsonb_array_elements(coalesce(x -> 'fields', '[]')) f), '[]'::jsonb),
      'missing', coalesce((select jsonb_agg(m) from jsonb_array_elements(v_failures) x, jsonb_array_elements(coalesce(x -> 'missing', '[]')) m), '[]'::jsonb)));
  end if;
  -- Supersede the previously submitted revision (if this is a correction).
  update public.survey_revisions set status = 'superseded'
   where survey_id = p_survey_id and status = 'submitted';
  update public.survey_revisions
     set status = 'submitted', submitted_at = now(), submitted_by = v_uid,
         requirements_version = (app.rule('survey.requirements') ->> 'version')::integer,
         submitted_evidence_ids = (select coalesce(array_agg(id order by category, captured_at), '{}') from public.evidence_files where survey_id = p_survey_id and status = 'active')
   where id = v_rev.id returning * into v_rev;
  update public.surveys set status = v_t.to_state::public.survey_state, status_reason = null
   where id = p_survey_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'survey', v_new.id, v_t.audit_event,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', v_new.status, 'revision_id', v_rev.id, 'revision_no', v_rev.revision_no, 'evidence_count', cardinality(v_rev.submitted_evidence_ids)),
    null, v_t.permission_code, p_operation_id);
  -- Automation (§22): survey submitted → technical review queue + sales visibility.
  perform app.notify_permission_holders('survey.review', v_new.organization_id, 'survey.submitted', 'survey', v_new.id,
    'notification.survey_submitted', jsonb_build_object('survey_number', v_new.survey_number, 'revision_no', v_rev.revision_no),
    'survey.submitted:' || v_rev.id);
  select owner_user_id into v_lead_owner from public.leads where id = v_new.lead_id;
  if v_lead_owner is not null then
    perform app.notify(v_lead_owner, v_new.organization_id, 'survey.submitted', 'survey', v_new.id, 'notification.survey_submitted',
      jsonb_build_object('survey_number', v_new.survey_number, 'revision_no', v_rev.revision_no), 'survey.submitted:' || v_rev.id || ':owner');
  end if;
  return app.op_finish(p_operation_id, v_new.id, app.survey_json(v_new) || jsonb_build_object('revision_no', v_rev.revision_no));
end;
$$;

-- Technical Manager returns a submitted survey: new draft revision (copy), old one kept.
create function public.request_survey_revision(p_survey_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.surveys := app.lock_survey(p_survey_id);
  v_new public.surveys;
  v_t public.state_transitions;
  v_prev public.survey_revisions;
  v_rev_id uuid;
begin
  perform app.require_permission('survey.review', v_old.organization_id);
  perform app.assert_version(p_expected_version, v_old.version);
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
    jsonb_build_object('status', v_new.status, 'revision_id', v_rev_id, 'revision_no', v_prev.revision_no + 1), p_reason, v_t.permission_code);
  perform app.notify(v_new.surveyor_id, v_new.organization_id, 'survey.revision_requested', 'survey', v_new.id, 'notification.survey_revision_requested',
    jsonb_build_object('survey_number', v_new.survey_number, 'reason', p_reason), 'survey.revision_requested:' || v_rev_id);
  return app.survey_json(v_new);
end;
$$;

create function public.review_gps_exception(p_survey_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_old public.surveys := app.lock_survey(p_survey_id);
  v_new public.surveys;
begin
  perform app.require_permission('survey.gps_exception.review', v_old.organization_id);
  if v_old.gps_status is null or v_old.gps_status = 'verified' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'no GPS exception to review'));
  end if;
  if v_old.gps_exception_decision is not null then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'already reviewed'));
  end if;
  if v_old.surveyor_id = v_uid then
    perform app.raise_error('SELF_APPROVAL_FORBIDDEN');
  end if;
  if p_decision not in ('accepted', 'rejected') or length(btrim(coalesce(p_note, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('decision', 'note')));
  end if;
  update public.surveys set gps_exception_decision = p_decision, gps_exception_reviewed_by = v_uid, gps_exception_reviewed_at = now()
   where id = p_survey_id returning * into v_new;
  perform app.audit(v_new.organization_id, 'survey', v_new.id, 'survey.gps_exception_reviewed',
    jsonb_build_object('gps_status', v_old.gps_status), jsonb_build_object('decision', p_decision), p_note, 'survey.gps_exception.review');
  return app.survey_json(v_new);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS & grants
-- -----------------------------------------------------------------------------
alter table public.surveys enable row level security;
alter table public.survey_revisions enable row level security;
alter table public.survey_measurements enable row level security;
alter table public.evidence_files enable row level security;

create policy surveys_read on public.surveys for select to authenticated using (app.can_read_survey_row(organization_id, surveyor_id, lead_id));
create policy survey_revisions_read on public.survey_revisions for select to authenticated using (app.can_read_survey(survey_id));
create policy survey_measurements_read on public.survey_measurements for select to authenticated using (app.can_read_survey_revision(revision_id));
create policy evidence_files_read on public.evidence_files for select to authenticated using (app.can_read_survey(survey_id));

revoke all on public.surveys, public.survey_revisions, public.survey_measurements, public.evidence_files from anon, authenticated;
grant select on public.surveys, public.survey_revisions, public.survey_measurements, public.evidence_files to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.schedule_survey(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text),
  public.reschedule_survey(uuid, integer, timestamptz, timestamptz, uuid, text),
  public.cancel_survey(uuid, integer, text),
  public.survey_field_action(uuid, integer, text, text),
  public.check_in_survey(uuid, uuid, text, double precision, double precision, double precision, timestamptz, text),
  public.save_survey_draft(uuid, uuid, uuid, integer, jsonb, jsonb),
  public.register_evidence(uuid, uuid, jsonb),
  public.submit_survey(uuid, uuid, integer),
  public.request_survey_revision(uuid, integer, text),
  public.review_gps_exception(uuid, text, text)
  to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function
  app.current_user_id(), app.is_active_user(uuid), app.aiec_org_id(),
  app.user_has_permission(uuid, text, uuid), app.has_permission(text, uuid), app.is_member(uuid),
  app.can_read_profile(uuid), app.can_read_org_people(uuid), app.try_uuid(text),
  app.can_read_lead_row(uuid, uuid, uuid), app.can_read_lead(uuid), app.can_read_lead_sales_history(uuid), app.can_read_site(uuid),
  app.can_read_survey_row(uuid, uuid, uuid), app.can_read_survey(uuid), app.can_read_survey_revision(uuid),
  app.parse_evidence_path(text), app.can_upload_evidence_object(text), app.can_read_evidence_object(text)
  to authenticated;

-- =============================================================================
-- Slice 6 — QA to handover (spec §15, §16.7, §44 QA01–QA06, §45 CU07, Gates 10, 12, 13, 14)
-- Independent AIEC QA inspections against versioned checklists, defects with rework and
-- reinspection, final QA, statutory evidence verified by a second person, handover
-- documents, customer handover acceptance (portal), lift asset and warranty, project close.
-- Transitions and rules are generated from packages/domain (parity-tested).
-- =============================================================================

create type public.defect_state as enum ('open', 'assigned', 'acknowledged', 'correction_in_progress', 'submitted_for_reinspection', 'verified', 'closed', 'disputed');
create type public.handover_state as enum ('not_ready', 'ready', 'issues_raised', 'accepted');
create type public.warranty_state as enum ('pending', 'active', 'expired', 'voided');

insert into public.state_transitions (machine, from_state, action, to_state, permission_code, requires_reason, audit_event) values
  ('defect', 'open', 'assign', 'assigned', 'qa.defect.manage', false, 'defect.assigned'),
  ('defect', 'assigned', 'acknowledge', 'acknowledged', 'partner.task.assign', false, 'defect.acknowledged'),
  ('defect', 'assigned', 'dispute', 'disputed', 'partner.task.assign', true, 'defect.disputed'),
  ('defect', 'acknowledged', 'dispute', 'disputed', 'partner.task.assign', true, 'defect.disputed'),
  ('defect', 'disputed', 'resolve_dispute', 'assigned', 'qa.defect.manage', true, 'defect.dispute_resolved'),
  ('defect', 'acknowledged', 'start_correction', 'correction_in_progress', 'task.execute', false, 'defect.correction_started'),
  ('defect', 'correction_in_progress', 'submit_correction', 'submitted_for_reinspection', 'task.execute', false, 'defect.correction_submitted'),
  ('defect', 'submitted_for_reinspection', 'reject_correction', 'correction_in_progress', 'qa.defect.manage', true, 'defect.not_corrected'),
  ('defect', 'submitted_for_reinspection', 'verify', 'verified', 'qa.defect.manage', false, 'defect.verified'),
  ('defect', 'verified', 'close', 'closed', 'qa.defect.manage', false, 'defect.closed'),
  ('handover', 'not_ready', 'confirm_ready', 'ready', 'project.plan', false, 'handover.ready'),
  ('handover', 'ready', 'customer_accept', 'accepted', 'customer.approval.decide', false, 'handover.accepted'),
  ('handover', 'ready', 'customer_raise_issue', 'issues_raised', 'customer.approval.decide', true, 'handover.issues_raised'),
  ('handover', 'issues_raised', 'recheck', 'not_ready', 'project.plan', false, 'handover.rechecked'),
  ('warranty', 'pending', 'activate', 'active', 'project.plan', false, 'warranty.activated'),
  ('warranty', 'active', 'expire', 'expired', 'project.plan', false, 'warranty.expired'),
  ('warranty', 'pending', 'void', 'voided', 'approval.exception.decide', true, 'warranty.voided'),
  ('warranty', 'active', 'void', 'voided', 'approval.exception.decide', true, 'warranty.voided');

insert into public.business_rules (rule_key, version, value, audience, reason) values
  ('qa.checklists', 1, '{"checklists":{"mobilisation":[{"key":"material_matches_bom","critical":false},{"key":"site_safety_setup","critical":true}],"rail_installation":[{"key":"bracket_spacing","critical":true},{"key":"rail_alignment_within_tolerance","critical":true},{"key":"fixings_tight","critical":false}],"machine_installation":[{"key":"machine_secured","critical":true},{"key":"rope_terminations","critical":true},{"key":"governor_function","critical":true}],"car_and_counterweight":[{"key":"car_frame_square","critical":false},{"key":"safety_gear_set","critical":true},{"key":"counterweight_guarding","critical":true}],"doors":[{"key":"door_lock_engagement","critical":true},{"key":"door_gaps","critical":false}],"electrical_wiring":[{"key":"earthing_continuity","critical":true},{"key":"safety_circuit_complete","critical":true},{"key":"wiring_routed_and_labelled","critical":false}],"pre_commissioning":[{"key":"functional_operation","critical":true},{"key":"levelling_accuracy","critical":false},{"key":"emergency_operation","critical":true}],"final":[{"key":"all_stage_inspections_passed","critical":true},{"key":"installed_matches_configuration","critical":true},{"key":"test_records_present","critical":true},{"key":"emergency_systems_working","critical":true},{"key":"site_clean_and_safe","critical":false}]}}', 'all_users', 'Illustrative QA checklists per task and final QA; engineers must approve (D-034)'),
  ('statutory.required_evidence', 1, '{"types":["authority_inspection_report","operating_licence"]}', 'aiec_staff', 'Official evidence that must be verified before handover (Gate 12, D-035)'),
  ('handover.required_documents', 1, '{"documents":["final_project_report","approved_specifications","operating_manual","emergency_instructions","warranty_certificate","statutory_documents","maintenance_schedule"]}', 'all_users', 'Final handover package (Gate 13)'),
  ('warranty.terms', 1, '{"months":12,"startEvent":"handover_acceptance"}', 'all_users', 'Warranty months and contractual start event (Gate 14, D-036)');

-- =============================================================================
-- Customer link and read rules
-- =============================================================================
alter table public.projects add column customer_org_id uuid references public.organizations (id);

-- The customer's people see their own project (portal): title, status, handover package, warranty.
create function app.is_project_customer(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.customer_org_id is not null and app.user_has_permission(auth.uid(), 'customer.project.read', p.customer_org_id)
                   from public.projects p where p.id = p_project_id), false)
$$;

drop policy projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using (app.can_read_project(id) or app.is_project_customer(id));

-- AIEC QA inspectors (independent of partners) read projects and tasks they inspect.
create function app.is_qa_inspector(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'qa.inspection.decide', p_org) or app.user_has_permission(auth.uid(), 'qa.defect.manage', p_org)
$$;

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
        or app.is_qa_inspector(p.organization_id)
        or app.can_read_lead(p.lead_id)
        or exists (select 1 from public.project_partner_assignments a
                   where a.project_id = p.id and a.status in ('invited', 'clarification_requested', 'accepted')
                     and app.user_has_permission(auth.uid(), 'partner.project.read', a.partner_org_id))
        or exists (select 1 from public.project_team_members m join public.project_partner_assignments a on a.id = m.assignment_id
                   where a.project_id = p.id and a.status = 'accepted' and m.user_id = auth.uid() and m.removed_at is null)
    from public.projects p where p.id = p_project_id), false)
$$;

create or replace function app.can_read_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select t.assignee_user_id = auth.uid()
        or app.is_execution_manager(p.organization_id)
        or app.is_qa_inspector(p.organization_id)
        or app.user_has_permission(auth.uid(), 'partner.project.read', a.partner_org_id)
    from public.project_tasks t
    join public.project_partner_assignments a on a.id = t.assignment_id
    join public.projects p on p.id = t.project_id
    where t.id = p_task_id), false)
$$;

-- Gate 10: an inspector is AIEC (or a QA agency) staff and never a member of the partner whose work it is.
create function app.require_independent_inspector(p_project public.projects, p_partner uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organization_memberships m join public.organizations o on o.id = m.organization_id
                 where m.user_id = auth.uid() and m.status = 'active' and o.kind in ('aiec', 'qa_agency')
                   and app.user_has_permission(auth.uid(), 'qa.inspection.decide', o.id)) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'qa.inspection.decide'));
  end if;
  if p_partner is not null and exists (select 1 from public.organization_memberships m where m.user_id = auth.uid() and m.organization_id = p_partner and m.status = 'active') then
    perform app.raise_error('SELF_APPROVAL_FORBIDDEN', jsonb_build_object('reason', 'partner members cannot inspect their own work (Gate 10)'));
  end if;
end;
$$;

create function public.link_project_customer(p_project_id uuid, p_expected_version integer, p_customer_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found or not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  perform app.assert_version(p_expected_version, v_p.version);
  if not exists (select 1 from public.organizations where id = p_customer_org_id and kind = 'customer' and status = 'active') then
    perform app.j_field_error('customer_org_id');
  end if;
  update public.projects set customer_org_id = p_customer_org_id, updated_by = v_uid where id = p_project_id returning * into v_p;
  perform app.audit(v_p.organization_id, 'project', v_p.id, 'project.customer_linked', null, jsonb_build_object('customer_org_id', p_customer_org_id), null, 'project.plan', null, v_p.id);
  return app.project_json(v_p);
end;
$$;

-- =============================================================================
-- Inspections (QA02, QA03) and defects (QA04, QA05)
-- =============================================================================
create table public.qa_inspections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  task_id uuid references public.project_tasks (id),
  kind text not null check (kind in ('task', 'final')),
  checklist_key text not null,
  checklist_version integer not null,
  criteria jsonb not null,
  answers jsonb not null,
  outcome text not null check (outcome in ('passed', 'failed', 'on_hold')),
  notes text,
  inspector_id uuid not null references public.user_profiles (id),
  inspected_at timestamptz not null default now(),
  operation_id uuid not null unique,
  check ((kind = 'task') = (task_id is not null))
);
create trigger qa_inspections_immutable before update or delete on public.qa_inspections for each row execute function app.forbid_mutation();

create table public.defects (
  id uuid primary key default gen_random_uuid(),
  defect_number text not null unique,
  project_id uuid not null references public.projects (id),
  task_id uuid not null references public.project_tasks (id),
  inspection_id uuid not null references public.qa_inspections (id),
  partner_org_id uuid not null references public.organizations (id),
  status public.defect_state not null default 'open',
  category text not null check (category in ('mechanical', 'alignment', 'electrical', 'safety_component', 'doors', 'documentation', 'workmanship', 'other')),
  severity text not null check (severity in ('minor', 'major', 'critical')),
  location text not null check (length(btrim(location)) >= 3),
  description text not null check (length(btrim(description)) >= 3),
  criterion_key text not null,
  correction_due_date date not null,
  raised_by uuid not null references public.user_profiles (id),
  raised_at timestamptz not null default now(),
  status_reason text,
  acknowledged_by uuid references public.user_profiles (id),
  corrected_by uuid references public.user_profiles (id),
  correction_submitted_at timestamptz,
  verified_by uuid references public.user_profiles (id),
  verified_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create trigger defects_touch before update on public.defects for each row execute function app.touch_row();
create trigger defects_no_delete before delete on public.defects for each row execute function app.forbid_mutation();

-- Correction evidence is linked to the defect it corrects (original evidence is never replaced).
alter table public.task_evidence add column defect_id uuid references public.defects (id);
alter table public.task_evidence add constraint task_evidence_correction_link check ((category = 'correction') = (defect_id is not null));

create function app.can_read_defect_row(p_project uuid, p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_read_task(p_task)
$$;

create function app.qa_checklist(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.rule('qa.checklists') -> 'checklists' -> p_key
$$;

-- Mirrors evaluateInspection. Returns {outcome|null, problems[{code,key}], failed[], held[]}.
create function app.evaluate_inspection(p_criteria jsonb, p_answers jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with c as (
    select x ->> 'key' as key, coalesce((x ->> 'critical')::boolean, false) as critical, o,
           p_answers -> (x ->> 'key') ->> 'result' as result, p_answers -> (x ->> 'key') ->> 'note' as note
    from jsonb_array_elements(coalesce(p_criteria, '[]'::jsonb)) with ordinality t(x, o)
  ), pr as (
    select o, case
      when result is null or result not in ('pass', 'fail', 'hold', 'not_applicable') then jsonb_build_object('code', 'REQUIRED_FIELD_MISSING', 'key', key)
      when result = 'not_applicable' and critical then jsonb_build_object('code', 'VALIDATION_FAILED', 'key', key)
      when result = 'not_applicable' and length(btrim(coalesce(note, ''))) < 3 then jsonb_build_object('code', 'REQUIRED_FIELD_MISSING', 'key', key) end as problem
    from c
  )
  select jsonb_build_object(
    'outcome', case when exists (select 1 from pr where problem is not null) then null
                    when exists (select 1 from c where result = 'fail') then 'failed'
                    when exists (select 1 from c where result = 'hold') then 'on_hold' else 'passed' end,
    'problems', coalesce((select jsonb_agg(problem order by o) from pr where problem is not null), '[]'::jsonb),
    'failed', coalesce((select jsonb_agg(key order by o) from c where result = 'fail'), '[]'::jsonb),
    'held', coalesce((select jsonb_agg(key order by o) from c where result = 'hold'), '[]'::jsonb))
$$;

create function app.defect_json(d public.defects)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('defect_id', d.id, 'defect_number', d.defect_number, 'status', d.status, 'task_id', d.task_id, 'version', d.version)
$$;

-- QA03 / QA05 / QA06. One RPC records a task inspection (with new defects and reinspection decisions)
-- or the final inspection of the project. Payload:
--   {task_id | project_id (final), answers {key: {result, note}}, notes,
--    defects [{criterion_key, category, severity, location, description, correction_due_date}],
--    defect_decisions [{defect_id, decision: verify|reject, reason}]}
create function public.record_inspection(p_operation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_task public.project_tasks;
  v_p public.projects;
  v_partner uuid;
  v_kind text;
  v_key text;
  v_criteria jsonb;
  v_eval jsonb;
  v_i public.qa_inspections;
  v_d jsonb;
  v_def public.defects;
  v_n integer := 0;
  v_rejected integer := 0;
  v_tr public.state_transitions;
  v_missing text[];
  v_city text;
begin
  if app.try_uuid(v ->> 'task_id') is not null then
    select * into v_task from public.project_tasks where id = app.try_uuid(v ->> 'task_id') for update;
    if v_task.id is null or not app.can_read_task(v_task.id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'task')); end if;
    select * into v_p from public.projects where id = v_task.project_id for update;
    v_partner := app.task_partner(v_task);
    v_kind := 'task';
    v_key := v_task.code;
  else
    select * into v_p from public.projects where id = app.try_uuid(v ->> 'project_id') for update;
    if v_p.id is null or not app.can_read_project(v_p.id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project')); end if;
    select partner_org_id into v_partner from public.project_partner_assignments where project_id = v_p.id and status = 'accepted';
    v_kind := 'final';
    v_key := 'final';
  end if;
  perform app.require_independent_inspector(v_p, v_partner);
  v_replay := app.op_begin(p_operation_id, 'qa.inspection');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_kind = 'task' and v_task.status <> 'submitted' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_task.status, 'reason', 'only submitted work is inspected'));
  end if;
  if v_kind = 'final' and v_p.status <> 'final_qa' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_p.status, 'reason', 'final QA has not been requested'));
  end if;
  v_criteria := app.qa_checklist(v_key);
  if v_criteria is null then perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'no checklist for this task', 'fields', jsonb_build_array('checklist'))); end if;
  if jsonb_typeof(v -> 'answers') is distinct from 'object' then perform app.j_field_error('answers'); end if;
  v_eval := app.evaluate_inspection(v_criteria, v -> 'answers');
  if v_eval ->> 'outcome' is null then
    perform app.raise_error(case when exists (select 1 from jsonb_array_elements(v_eval -> 'problems') x where x ->> 'code' = 'VALIDATION_FAILED') then 'VALIDATION_FAILED' else 'REQUIRED_FIELD_MISSING' end,
      jsonb_build_object('fields', (select jsonb_agg('qa.' || (x ->> 'key')) from jsonb_array_elements(v_eval -> 'problems') x), 'problems', v_eval -> 'problems'));
  end if;
  if v_kind = 'final' and v_eval ->> 'outcome' = 'failed' and length(btrim(coalesce(v ->> 'notes', ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('notes')));
  end if;
  insert into public.qa_inspections (project_id, task_id, kind, checklist_key, checklist_version, criteria, answers, outcome, notes, inspector_id, operation_id)
  values (v_p.id, v_task.id, v_kind, v_key, (select max(version) from public.business_rules where rule_key = 'qa.checklists'), v_criteria, v -> 'answers',
          v_eval ->> 'outcome', nullif(btrim(coalesce(v ->> 'notes', '')), ''), v_uid, p_operation_id)
  returning * into v_i;

  if v_kind = 'task' then
    -- Reinspection (QA05): every correction waiting for reinspection on this task gets a decision.
    for v_d in select * from jsonb_array_elements(coalesce(v -> 'defect_decisions', '[]'::jsonb)) loop
      select * into v_def from public.defects where id = app.try_uuid(v_d ->> 'defect_id') and task_id = v_task.id for update;
      if v_def.id is null or v_def.status <> 'submitted_for_reinspection' then perform app.j_field_error('defect_decisions'); end if;
      if v_d ->> 'decision' = 'verify' then
        if v_def.corrected_by = v_uid then perform app.raise_error('SELF_APPROVAL_FORBIDDEN'); end if;
        update public.defects set status = 'closed', verified_by = v_uid, verified_at = now(), closed_at = now(), updated_by = v_uid where id = v_def.id;
        perform app.audit(v_p.organization_id, 'defect', v_def.id, 'defect.verified', jsonb_build_object('status', v_def.status), jsonb_build_object('status', 'closed', 'inspection_id', v_i.id), null, 'qa.defect.manage', p_operation_id, v_p.id);
      elsif v_d ->> 'decision' = 'reject' then
        if length(btrim(coalesce(v_d ->> 'reason', ''))) < 3 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason'))); end if;
        update public.defects set status = 'correction_in_progress', status_reason = btrim(v_d ->> 'reason'), updated_by = v_uid where id = v_def.id;
        perform app.audit(v_p.organization_id, 'defect', v_def.id, 'defect.not_corrected', jsonb_build_object('status', v_def.status), jsonb_build_object('status', 'correction_in_progress'), v_d ->> 'reason', 'qa.defect.manage', p_operation_id, v_p.id);
        v_rejected := v_rejected + 1;
      else
        perform app.j_field_error('defect_decisions');
      end if;
    end loop;
    if exists (select 1 from public.defects where task_id = v_task.id and status = 'submitted_for_reinspection') then
      perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('defect_decisions'), 'reason', 'decide every correction waiting for reinspection'));
    end if;
    -- New defects (QA04), one per failed criterion at least.
    v_city := app.lead_city_code(v_p.lead_id);
    for v_d in select * from jsonb_array_elements(coalesce(v -> 'defects', '[]'::jsonb)) loop
      v_n := v_n + 1;
      v_missing := '{}';
      if coalesce(v_d ->> 'category', '') not in ('mechanical', 'alignment', 'electrical', 'safety_component', 'doors', 'documentation', 'workmanship', 'other') then v_missing := v_missing || ('defects.' || v_n || '.category'); end if;
      if coalesce(v_d ->> 'severity', '') not in ('minor', 'major', 'critical') then v_missing := v_missing || ('defects.' || v_n || '.severity'); end if;
      if length(btrim(coalesce(v_d ->> 'location', ''))) < 3 then v_missing := v_missing || ('defects.' || v_n || '.location'); end if;
      if length(btrim(coalesce(v_d ->> 'description', ''))) < 3 then v_missing := v_missing || ('defects.' || v_n || '.description'); end if;
      if not exists (select 1 from jsonb_array_elements(v_criteria) c where c ->> 'key' = v_d ->> 'criterion_key') then v_missing := v_missing || ('defects.' || v_n || '.criterion_key'); end if;
      if app.jdate(v_d, 'correction_due_date') is null or app.jdate(v_d, 'correction_due_date') < app.today_ist() then v_missing := v_missing || ('defects.' || v_n || '.correction_due_date'); end if;
      if cardinality(v_missing) > 0 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing))); end if;
      insert into public.defects (defect_number, project_id, task_id, inspection_id, partner_org_id, status, category, severity, location, description, criterion_key,
        correction_due_date, raised_by, updated_by)
      values (app.next_business_id('DF', v_city), v_p.id, v_task.id, v_i.id, v_partner, 'assigned', v_d ->> 'category', v_d ->> 'severity', btrim(v_d ->> 'location'),
        btrim(v_d ->> 'description'), v_d ->> 'criterion_key', app.jdate(v_d, 'correction_due_date'), v_uid, v_uid)
      returning * into v_def;
      perform app.audit(v_p.organization_id, 'defect', v_def.id, 'defect.assigned', null,
        jsonb_build_object('defect_number', v_def.defect_number, 'severity', v_def.severity, 'criterion_key', v_def.criterion_key, 'partner_org_id', v_partner), null, 'qa.defect.manage', p_operation_id, v_p.id);
      if v_def.severity = 'critical' then
        perform app.notify_permission_holders('project.plan', v_p.organization_id, 'defect.critical', 'project', v_p.id, 'notification.defect_critical',
          jsonb_build_object('project_number', v_p.project_number, 'defect_number', v_def.defect_number), 'defect.critical:' || v_def.id);
        update public.notifications set severity = 'critical' where dedupe_key like 'defect.critical:' || v_def.id || ':%';
      end if;
    end loop;
    if v_eval ->> 'outcome' = 'failed' and jsonb_array_length(v_eval -> 'failed') > 0
       and exists (select 1 from jsonb_array_elements_text(v_eval -> 'failed') fk
                   where not exists (select 1 from jsonb_array_elements(coalesce(v -> 'defects', '[]'::jsonb)) d where d ->> 'criterion_key' = fk)) then
      perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('defects'), 'reason', 'record a defect for every failed criterion'));
    end if;
    if v_eval ->> 'outcome' = 'passed' and (v_rejected > 0 or v_n > 0) then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('answers'), 'reason', 'a rejected correction or a new defect means the inspection is not passed'));
    end if;
    if v_eval ->> 'outcome' = 'passed' then
      if exists (select 1 from public.defects where task_id = v_task.id and status::text in ('open', 'assigned', 'acknowledged', 'correction_in_progress', 'submitted_for_reinspection', 'disputed')) then
        perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'open defects on this task'));
      end if;
      if v_task.submitted_by = v_uid then perform app.raise_error('SELF_APPROVAL_FORBIDDEN'); end if;
      v_tr := app.transition('task', 'submitted', 'qa_pass');
      update public.project_tasks set status = v_tr.to_state::public.task_state, updated_by = v_uid where id = v_task.id;
    elsif v_eval ->> 'outcome' = 'failed' or v_rejected > 0 then
      v_tr := app.transition('task', 'submitted', 'qa_fail');
      update public.project_tasks set status = v_tr.to_state::public.task_state, updated_by = v_uid where id = v_task.id;
    end if;
    if v_tr.action is not null then
      perform app.audit(v_partner, 'task', v_task.id, v_tr.audit_event, jsonb_build_object('status', 'submitted'), jsonb_build_object('status', v_tr.to_state, 'inspection_id', v_i.id),
        v ->> 'notes', v_tr.permission_code, p_operation_id, v_p.id);
      perform app.notify_permission_holders('partner.task.assign', v_partner, 'qa.' || v_tr.action, 'task', v_task.id,
        'notification.qa_' || v_tr.action, jsonb_build_object('task', v_task.code), 'qa.' || v_tr.action || ':' || v_i.id);
      if v_task.assignee_user_id is not null then
        perform app.notify(v_task.assignee_user_id, v_partner, 'qa.' || v_tr.action, 'task', v_task.id, 'notification.qa_' || v_tr.action,
          jsonb_build_object('task', v_task.code), 'qa.assignee:' || v_i.id);
      end if;
    end if;
  else
    -- Final QA (QA06): passing needs every task approved and no open defect; it never grants statutory permission.
    if v_eval ->> 'outcome' = 'passed' then
      if exists (select 1 from public.defects where project_id = v_p.id and status::text in ('open', 'assigned', 'acknowledged', 'correction_in_progress', 'submitted_for_reinspection', 'disputed')) then
        perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'open defects must be closed or formally dispositioned'));
      end if;
      v_tr := app.transition('project', 'final_qa', 'pass_final_qa');
    elsif v_eval ->> 'outcome' = 'failed' then
      v_tr := app.transition('project', 'final_qa', 'fail_final_qa', v ->> 'notes');
    end if;
    if v_tr.action is not null then
      update public.projects set status = v_tr.to_state::public.project_state, updated_by = v_uid where id = v_p.id;
      perform app.audit(v_p.organization_id, 'project', v_p.id, v_tr.audit_event, jsonb_build_object('status', 'final_qa'), jsonb_build_object('status', v_tr.to_state, 'inspection_id', v_i.id),
        v ->> 'notes', v_tr.permission_code, p_operation_id, v_p.id);
      perform app.notify_permission_holders('project.plan', v_p.organization_id, 'qa.final_' || case when v_tr.action = 'pass_final_qa' then 'passed' else 'failed' end, 'project', v_p.id,
        'notification.final_qa', jsonb_build_object('project_number', v_p.project_number, 'outcome', v_eval ->> 'outcome'), 'qa.final:' || v_i.id);
    end if;
  end if;
  perform app.audit(v_p.organization_id, 'qa_inspection', v_i.id, 'inspection.recorded', null,
    jsonb_build_object('kind', v_kind, 'task_id', v_task.id, 'outcome', v_i.outcome, 'failed', v_eval -> 'failed', 'held', v_eval -> 'held', 'defects_raised', v_n), v ->> 'notes',
    'qa.inspection.decide', p_operation_id, v_p.id);
  return app.op_finish(p_operation_id, v_i.id, jsonb_build_object('inspection_id', v_i.id, 'outcome', v_i.outcome, 'defects_raised', v_n,
    'task_status', (select status from public.project_tasks where id = v_task.id), 'project_status', (select status from public.projects where id = v_p.id)));
end;
$$;

-- Partner / technician / QA steps on a defect (defect machine). Correction submission needs linked correction evidence.
create function public.defect_action(p_defect_id uuid, p_expected_version integer, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_d public.defects;
  v_t public.project_tasks;
  v_tr public.state_transitions;
  v_p public.projects;
begin
  select * into v_d from public.defects where id = p_defect_id for update;
  if not found or not app.can_read_task(v_d.task_id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'defect')); end if;
  select * into v_t from public.project_tasks where id = v_d.task_id;
  select * into v_p from public.projects where id = v_d.project_id;
  perform app.assert_version(p_expected_version, v_d.version);
  if p_action not in ('acknowledge', 'dispute', 'start_correction', 'submit_correction', 'resolve_dispute') then perform app.j_field_error('action'); end if;
  v_tr := app.transition('defect', v_d.status::text, p_action, p_reason);
  if v_tr.permission_code = 'task.execute' then
    perform app.require_assignee(v_t);
    if v_t.status <> 'rework' then
      perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_t.status, 'reason', 'the task is not in rework'));
    end if;
  elsif v_tr.permission_code = 'partner.task.assign' then
    perform app.require_permission('partner.task.assign', v_d.partner_org_id);
  else
    perform app.require_independent_inspector(v_p, v_d.partner_org_id);
  end if;
  if p_action = 'submit_correction' and not exists (select 1 from public.task_evidence e where e.defect_id = v_d.id and e.category = 'correction') then
    perform app.raise_error('EVIDENCE_REQUIRED', jsonb_build_object('missing', jsonb_build_array('correction_evidence')));
  end if;
  update public.defects set status = v_tr.to_state::public.defect_state,
         status_reason = case when v_tr.requires_reason then btrim(p_reason) else status_reason end,
         acknowledged_by = case when p_action = 'acknowledge' then v_uid else acknowledged_by end,
         corrected_by = case when p_action = 'submit_correction' then v_uid else corrected_by end,
         correction_submitted_at = case when p_action = 'submit_correction' then now() else correction_submitted_at end,
         updated_by = v_uid
   where id = v_d.id returning * into v_d;
  perform app.audit(v_p.organization_id, 'defect', v_d.id, v_tr.audit_event, jsonb_build_object('status', v_tr.from_state), jsonb_build_object('status', v_d.status), p_reason,
    v_tr.permission_code, null, v_p.id);
  if p_action = 'dispute' then
    perform app.notify_permission_holders('qa.defect.manage', v_p.organization_id, 'defect.disputed', 'project', v_p.id, 'notification.defect_disputed',
      jsonb_build_object('defect_number', v_d.defect_number), 'defect.disputed:' || v_d.id || ':' || v_d.version);
  end if;
  return app.defect_json(v_d);
end;
$$;

-- Evidence now also carries correction photos linked to a defect (category 'correction').
create or replace function public.register_task_evidence(p_operation_id uuid, p_task_id uuid, p_payload jsonb)
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
  v_defect uuid := app.try_uuid(v ->> 'defect_id');
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
  if (v ->> 'category' = 'correction') <> (v_defect is not null) then perform app.j_field_error('defect_id'); end if;
  if v_defect is not null and not exists (select 1 from public.defects d where d.id = v_defect and d.task_id = v_t.id and d.status = 'correction_in_progress') then
    perform app.j_field_error('defect_id');
  end if;
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
    capture_location, capture_accuracy_m, remarks, operation_id, defect_id)
  values (v_t.id, v_partner, v ->> 'category', v_path, v ->> 'sha256', v_mime, v_size, v ->> 'source', v_uid, v_captured,
    case when v_lat is not null and v_lng is not null then app.geo_point(v_lat, v_lng) end, app.jnum(v, 'accuracy_m'),
    nullif(btrim(coalesce(v ->> 'remarks', '')), ''), p_operation_id, v_defect)
  returning * into v_e;
  perform app.audit(v_partner, 'task', v_t.id, 'task.evidence_registered', null,
    jsonb_build_object('evidence_id', v_e.id, 'category', v_e.category, 'sha256', v_e.sha256, 'defect_id', v_defect), null, 'task.execute', p_operation_id, v_t.project_id);
  return app.op_finish(p_operation_id, v_e.id, jsonb_build_object('evidence_id', v_e.id, 'category', v_e.category));
end;
$$;

-- WT06: rework goes back to QA once every defect on the task has a submitted correction.
create function public.resubmit_task(p_task_id uuid, p_expected_version integer)
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
  v_tr := app.transition('task', v_t.status::text, 'resubmit');
  if exists (select 1 from public.defects where task_id = v_t.id and status::text in ('open', 'assigned', 'acknowledged', 'correction_in_progress', 'disputed')) then
    perform app.raise_error('EVIDENCE_REQUIRED', jsonb_build_object('missing', jsonb_build_array('correction_evidence'), 'reason', 'submit a correction for every defect first'));
  end if;
  if not exists (select 1 from public.task_evidence e where e.task_id = v_t.id and e.category = 'correction') then
    perform app.raise_error('EVIDENCE_REQUIRED', jsonb_build_object('missing', jsonb_build_array('correction_evidence')));
  end if;
  update public.project_tasks set status = v_tr.to_state::public.task_state, submitted_at = now(), submitted_by = v_uid, updated_by = v_uid
   where id = v_t.id returning * into v_t;
  perform app.audit(app.task_partner(v_t), 'task', v_t.id, v_tr.audit_event, jsonb_build_object('status', v_tr.from_state), jsonb_build_object('status', v_t.status),
    null, v_tr.permission_code, null, v_t.project_id);
  perform app.notify_permission_holders('qa.inspection.decide', (select organization_id from public.projects where id = v_t.project_id), 'task.resubmitted', 'task', v_t.id,
    'notification.task_resubmitted', jsonb_build_object('task', v_t.code), 'task.resubmitted:' || v_t.id || ':' || v_t.version);
  return app.task_json(v_t);
end;
$$;

-- =============================================================================
-- Statutory evidence (Gate 12) and handover documents (Gate 13): private bucket
-- Path: {aiec_org_id}/projects/{project_id}/{operation_id}.{ext}
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('handover-documents', 'handover-documents', false, 26214400, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create table public.statutory_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  evidence_type text not null check (evidence_type in ('authority_inspection_report', 'operating_licence', 'completion_certificate', 'other_official_document')),
  authority text not null check (length(btrim(authority)) >= 3),
  reference_number text not null check (length(btrim(reference_number)) >= 2),
  issued_on date not null,
  valid_until date,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  recorded_by uuid not null references public.user_profiles (id),
  recorded_at timestamptz not null default now(),
  verification text not null default 'pending' check (verification in ('pending', 'verified', 'rejected')),
  verified_by uuid references public.user_profiles (id),
  verified_at timestamptz,
  rejection_reason text,
  operation_id uuid not null unique,
  check ((verification = 'pending') = (verified_at is null)),
  check (verified_by is null or verified_by <> recorded_by),
  check (verification <> 'rejected' or length(btrim(coalesce(rejection_reason, ''))) >= 3)
);
create trigger statutory_evidence_guard before update or delete on public.statutory_evidence for each row execute function app.guard_partner_document();

create table public.handover_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  doc_type text not null check (doc_type in ('final_project_report', 'approved_specifications', 'operating_manual', 'emergency_instructions', 'warranty_certificate', 'statutory_documents', 'maintenance_schedule')),
  title text not null check (length(btrim(title)) >= 3),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid not null references public.user_profiles (id),
  uploaded_at timestamptz not null default now(),
  operation_id uuid not null unique
);
create trigger handover_documents_immutable before update or delete on public.handover_documents for each row execute function app.forbid_mutation();

create function app.parse_project_document_path(p_name text)
returns table (organization_id uuid, project_id uuid, operation_id uuid, extension text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_file text[];
begin
  if array_length(v_parts, 1) <> 4 or v_parts[2] <> 'projects'
     or v_parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|webp)$' then
    return;
  end if;
  v_file := string_to_array(v_parts[4], '.');
  return query select app.try_uuid(v_parts[1]), app.try_uuid(v_parts[3]), app.try_uuid(v_file[1]), v_file[2];
end;
$$;

create function app.can_upload_project_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.parse_project_document_path(p_name) x join public.projects p on p.id = x.project_id and p.organization_id = x.organization_id
                 where app.user_has_permission(auth.uid(), 'project.plan', p.organization_id))
$$;

-- AIEC managers / QA read every file; the customer reads the handover package (not internal statutory drafts).
create function app.can_read_project_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.parse_project_document_path(p_name) x join public.projects p on p.id = x.project_id
                 where app.is_execution_manager(p.organization_id) or app.is_qa_inspector(p.organization_id)
                    or (app.is_project_customer(p.id) and exists (select 1 from public.handover_documents d where d.storage_path = p_name)))
$$;

create policy handover_documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'handover-documents' and app.can_upload_project_document_object(name));
create policy handover_documents_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'handover-documents' and app.can_read_project_document_object(name));

create function app.check_project_file(p_project public.projects, p_operation_id uuid, p jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parsed record;
  v_object record;
  v_size bigint := app.jint(p, 'size_bytes');
begin
  select * into v_parsed from app.parse_project_document_path(p ->> 'storage_path');
  if v_parsed.project_id is null or v_parsed.project_id <> p_project.id or v_parsed.organization_id <> p_project.organization_id or v_parsed.operation_id <> p_operation_id then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('storage_path')));
  end if;
  select o.name, o.metadata into v_object from storage.objects o where o.bucket_id = 'handover-documents' and o.name = p ->> 'storage_path';
  if v_object.name is null then perform app.raise_error('FILE_UPLOAD_FAILED', jsonb_build_object('reason', 'file not found in storage; upload first')); end if;
  if lower(coalesce(p ->> 'mime_type', '')) not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') then perform app.j_field_error('mime_type'); end if;
  if v_size is null or v_size <= 0 or v_size > 26214400 or (v_object.metadata ? 'size' and (v_object.metadata ->> 'size')::bigint <> v_size) then perform app.j_field_error('size_bytes'); end if;
  if coalesce(p ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then perform app.j_field_error('sha256'); end if;
end;
$$;

create function public.register_statutory_evidence(p_operation_id uuid, p_project_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_p public.projects;
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_e public.statutory_evidence;
  v_missing text[] := '{}';
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project(p_project_id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project')); end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  v_replay := app.op_begin(p_operation_id, 'statutory.register');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_p.status not in ('final_qa', 'statutory_pending') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_p.status, 'reason', 'statutory evidence is recorded after installation'));
  end if;
  if coalesce(v ->> 'evidence_type', '') not in ('authority_inspection_report', 'operating_licence', 'completion_certificate', 'other_official_document') then v_missing := v_missing || 'evidence_type'::text; end if;
  if length(btrim(coalesce(v ->> 'authority', ''))) < 3 then v_missing := v_missing || 'authority'::text; end if;
  if length(btrim(coalesce(v ->> 'reference_number', ''))) < 2 then v_missing := v_missing || 'reference_number'::text; end if;
  if app.jdate(v, 'issued_on') is null then v_missing := v_missing || 'issued_on'::text; end if;
  if cardinality(v_missing) > 0 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing))); end if;
  if app.jdate(v, 'issued_on') > app.today_ist() then perform app.j_field_error('issued_on'); end if;
  if app.jdate(v, 'valid_until') is not null and app.jdate(v, 'valid_until') < app.today_ist() then perform app.j_field_error('valid_until'); end if;
  perform app.check_project_file(v_p, p_operation_id, v);
  insert into public.statutory_evidence (project_id, evidence_type, authority, reference_number, issued_on, valid_until, storage_path, sha256, mime_type, size_bytes, recorded_by, operation_id)
  values (v_p.id, v ->> 'evidence_type', btrim(v ->> 'authority'), btrim(v ->> 'reference_number'), app.jdate(v, 'issued_on'), app.jdate(v, 'valid_until'),
          v ->> 'storage_path', v ->> 'sha256', lower(v ->> 'mime_type'), app.jint(v, 'size_bytes'), v_uid, p_operation_id)
  returning * into v_e;
  perform app.audit(v_p.organization_id, 'statutory_evidence', v_e.id, 'statutory.recorded', null,
    jsonb_build_object('evidence_type', v_e.evidence_type, 'authority', v_e.authority, 'reference_number', v_e.reference_number, 'sha256', v_e.sha256), null, 'project.plan', p_operation_id, v_p.id);
  perform app.notify_permission_holders('approval.exception.decide', v_p.organization_id, 'statutory.recorded', 'project', v_p.id, 'notification.statutory_recorded',
    jsonb_build_object('project_number', v_p.project_number), 'statutory.recorded:' || v_e.id);
  return app.op_finish(p_operation_id, v_e.id, jsonb_build_object('evidence_id', v_e.id, 'verification', v_e.verification));
end;
$$;

-- A different, authorized person checks the official document against the authority record.
create function public.verify_statutory_evidence(p_evidence_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_e public.statutory_evidence;
  v_p public.projects;
begin
  select * into v_e from public.statutory_evidence where id = p_evidence_id for update;
  select * into v_p from public.projects where id = v_e.project_id;
  if v_e.id is null or not app.can_read_project(v_p.id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'statutory_evidence')); end if;
  perform app.require_permission('approval.exception.decide', v_p.organization_id);
  if v_e.recorded_by = v_uid then perform app.raise_error('SELF_APPROVAL_FORBIDDEN'); end if;
  if v_e.verification <> 'pending' then perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_e.verification, 'allowedActions', '[]'::jsonb)); end if;
  if p_decision not in ('verify', 'reject') then perform app.j_field_error('decision'); end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) < 3 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason'))); end if;
  update public.statutory_evidence set verification = case when p_decision = 'verify' then 'verified' else 'rejected' end, verified_by = v_uid, verified_at = now(),
         rejection_reason = case when p_decision = 'reject' then btrim(p_reason) end
   where id = v_e.id returning * into v_e;
  perform app.audit(v_p.organization_id, 'statutory_evidence', v_e.id, 'statutory.' || v_e.verification, jsonb_build_object('verification', 'pending'),
    jsonb_build_object('verification', v_e.verification), p_reason, 'approval.exception.decide', null, v_p.id);
  return jsonb_build_object('evidence_id', v_e.id, 'verification', v_e.verification);
end;
$$;

create function app.missing_statutory(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(t order by o), '[]'::jsonb)
  from jsonb_array_elements_text(app.rule('statutory.required_evidence') -> 'types') with ordinality x(t, o)
  where not exists (select 1 from public.statutory_evidence e where e.project_id = p_project_id and e.evidence_type = t and e.verification = 'verified'
                      and (e.valid_until is null or e.valid_until >= app.today_ist()))
$$;

create function app.missing_handover_documents(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(t order by o), '[]'::jsonb)
  from jsonb_array_elements_text(app.rule('handover.required_documents') -> 'documents') with ordinality x(t, o)
  where not exists (select 1 from public.handover_documents d where d.project_id = p_project_id and d.doc_type = t)
$$;

create function public.register_handover_document(p_operation_id uuid, p_project_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_p public.projects;
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_d public.handover_documents;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project(p_project_id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project')); end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  v_replay := app.op_begin(p_operation_id, 'handover.document');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_p.status not in ('final_qa', 'statutory_pending', 'handover_ready') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_p.status));
  end if;
  if exists (select 1 from public.handovers h where h.project_id = v_p.id and h.status in ('ready', 'accepted')) then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'the package is with the customer; recheck it first'));
  end if;
  if coalesce(v ->> 'doc_type', '') not in ('final_project_report', 'approved_specifications', 'operating_manual', 'emergency_instructions', 'warranty_certificate', 'statutory_documents', 'maintenance_schedule') then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('doc_type')));
  end if;
  if length(btrim(coalesce(v ->> 'title', ''))) < 3 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('title'))); end if;
  perform app.check_project_file(v_p, p_operation_id, v);
  insert into public.handover_documents (project_id, doc_type, title, storage_path, sha256, mime_type, size_bytes, uploaded_by, operation_id)
  values (v_p.id, v ->> 'doc_type', btrim(v ->> 'title'), v ->> 'storage_path', v ->> 'sha256', lower(v ->> 'mime_type'), app.jint(v, 'size_bytes'), v_uid, p_operation_id)
  returning * into v_d;
  perform app.audit(v_p.organization_id, 'handover_document', v_d.id, 'handover.document_added', null,
    jsonb_build_object('doc_type', v_d.doc_type, 'sha256', v_d.sha256), null, 'project.plan', p_operation_id, v_p.id);
  return app.op_finish(p_operation_id, v_d.id, jsonb_build_object('document_id', v_d.id, 'doc_type', v_d.doc_type));
end;
$$;

-- =============================================================================
-- Handover (Gate 13) and the lift asset / warranty (Gate 14)
-- =============================================================================
create table public.handovers (
  project_id uuid primary key references public.projects (id),
  status public.handover_state not null default 'not_ready',
  ready_by uuid references public.user_profiles (id),
  ready_at timestamptz,
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  acceptor_name text,
  issues text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create trigger handovers_touch before update on public.handovers for each row execute function app.touch_row();

create table public.lift_assets (
  id uuid primary key default gen_random_uuid(),
  asset_number text not null unique,
  project_id uuid not null unique references public.projects (id),
  configuration_revision_id uuid not null references public.configuration_revisions (id),
  lift_category text,
  manufacturer text,
  model text,
  warranty_status public.warranty_state not null default 'pending',
  warranty_start_event text not null check (warranty_start_event in ('handover_acceptance', 'statutory_approval')),
  warranty_source_date date,
  warranty_start date,
  warranty_end date,
  warranty_months integer not null check (warranty_months > 0),
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check ((warranty_status = 'active') = (warranty_start is not null and warranty_end is not null and warranty_source_date is not null))
);
create trigger lift_assets_touch before update on public.lift_assets for each row execute function app.touch_row();

-- Mirrors warrantyPeriod: end = start + months − 1 day, clamped to the last day of the target month.
create function app.warranty_end(p_start date, p_months integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (least(
            (date_trunc('month', p_start) + make_interval(months => p_months))::date + (extract(day from p_start)::integer - 1),
            ((date_trunc('month', p_start) + make_interval(months => p_months + 1))::date - 1)
         ) - 1)::date
$$;

-- Project machine steps for QA → handover → close (guards mirror projectMachine).
create function public.project_quality_action(p_project_id uuid, p_expected_version integer, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v_t public.state_transitions;
  v_missing jsonb;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found or not app.can_read_project(p_project_id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project')); end if;
  perform app.assert_version(p_expected_version, v_p.version);
  if p_action not in ('submit_final_qa', 'record_statutory_clearance', 'close') then perform app.j_field_error('action'); end if;
  v_t := app.transition('project', v_p.status::text, p_action, p_reason);
  perform app.require_permission(v_t.permission_code, v_p.organization_id);
  if p_action = 'submit_final_qa' then
    if exists (select 1 from public.project_tasks t where t.project_id = v_p.id and t.status not in ('approved', 'closed')) or not exists (select 1 from public.project_tasks t where t.project_id = v_p.id) then
      perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'all installation tasks must be QA approved',
        'missing', (select jsonb_agg(code order by sequence) from public.project_tasks where project_id = v_p.id and status not in ('approved', 'closed'))));
    end if;
  elsif p_action = 'record_statutory_clearance' then
    v_missing := app.missing_statutory(v_p.id);
    if jsonb_array_length(v_missing) > 0 then perform app.raise_error('EVIDENCE_REQUIRED', jsonb_build_object('missing', v_missing)); end if;
  else
    if not exists (select 1 from public.lift_assets a where a.project_id = v_p.id) then
      perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('warranty_asset')));
    end if;
  end if;
  update public.projects set status = v_t.to_state::public.project_state, updated_by = v_uid where id = v_p.id returning * into v_p;
  perform app.audit(v_p.organization_id, 'project', v_p.id, v_t.audit_event, jsonb_build_object('status', v_t.from_state), jsonb_build_object('status', v_p.status), p_reason,
    v_t.permission_code, null, v_p.id);
  if p_action = 'submit_final_qa' then
    perform app.notify_permission_holders('qa.inspection.decide', v_p.organization_id, 'qa.final_requested', 'project', v_p.id, 'notification.final_qa_requested',
      jsonb_build_object('project_number', v_p.project_number), 'qa.final_requested:' || v_p.id || ':' || v_p.version);
  end if;
  return app.project_json(v_p);
end;
$$;

-- Handover machine: confirm_ready (AIEC) and recheck after the customer raised issues.
create function public.handover_action(p_project_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v_h public.handovers;
  v_t public.state_transitions;
  v_missing jsonb;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project(p_project_id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project')); end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  if p_action not in ('confirm_ready', 'recheck') then perform app.j_field_error('action'); end if;
  insert into public.handovers (project_id, updated_by) values (v_p.id, v_uid) on conflict (project_id) do nothing;
  select * into v_h from public.handovers where project_id = v_p.id for update;
  v_t := app.transition('handover', v_h.status::text, p_action);
  if p_action = 'confirm_ready' then
    if v_p.status <> 'handover_ready' then
      perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'final QA and verified statutory evidence come first', 'currentState', v_p.status,
        'missing', jsonb_build_array('final_qa', 'statutory_evidence')));
    end if;
    v_missing := app.missing_handover_documents(v_p.id) || app.missing_statutory(v_p.id);
    if jsonb_array_length(v_missing) > 0 then perform app.raise_error('EVIDENCE_REQUIRED', jsonb_build_object('missing', v_missing)); end if;
    if v_p.customer_org_id is null then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('customer_org_id'))); end if;
  end if;
  update public.handovers set status = v_t.to_state::public.handover_state,
         ready_by = case when p_action = 'confirm_ready' then v_uid else ready_by end, ready_at = case when p_action = 'confirm_ready' then now() else ready_at end,
         updated_by = v_uid
   where project_id = v_p.id returning * into v_h;
  perform app.audit(v_p.organization_id, 'handover', v_p.id, v_t.audit_event, jsonb_build_object('status', v_t.from_state), jsonb_build_object('status', v_h.status), null,
    v_t.permission_code, null, v_p.id);
  if p_action = 'confirm_ready' then
    perform app.notify_permission_holders('customer.approval.decide', v_p.customer_org_id, 'handover.ready', 'project', v_p.id, 'notification.handover_ready',
      jsonb_build_object('project', v_p.title), 'handover.ready:' || v_p.id || ':' || v_h.version);
  end if;
  return jsonb_build_object('project_id', v_p.id, 'handover_status', v_h.status, 'version', v_h.version);
end;
$$;

-- CU07: the customer accepts the handover (completes it, creates the lift asset and starts the warranty)
-- or raises issues. Acceptance binds to the package as listed at that moment (document checksums).
create function public.customer_handover_decision(p_project_id uuid, p_decision text, p_acceptor_name text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v_h public.handovers;
  v_t public.state_transitions;
  v_pt public.state_transitions;
  v_terms jsonb := app.rule('warranty.terms');
  v_event text := v_terms ->> 'startEvent';
  v_months integer := (v_terms ->> 'months')::integer;
  v_source date;
  v_c public.configuration_revisions;
  v_a public.lift_assets;
  v_package jsonb;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found or not app.is_project_customer(p_project_id) then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project')); end if;
  perform app.require_permission('customer.approval.decide', v_p.customer_org_id);
  select * into v_h from public.handovers where project_id = v_p.id for update;
  if v_h.project_id is null then perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', 'not_ready')); end if;
  if p_decision not in ('accept', 'raise_issue') then perform app.j_field_error('decision'); end if;
  if length(btrim(coalesce(p_acceptor_name, ''))) < 2 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('acceptor_name'))); end if;
  v_t := app.transition('handover', v_h.status::text, case when p_decision = 'accept' then 'customer_accept' else 'customer_raise_issue' end, p_comment);
  v_package := (select jsonb_agg(jsonb_build_object('doc_type', d.doc_type, 'sha256', d.sha256) order by d.doc_type, d.uploaded_at) from public.handover_documents d where d.project_id = v_p.id);
  update public.handovers set status = v_t.to_state::public.handover_state, decided_by = v_uid, decided_at = now(), acceptor_name = btrim(p_acceptor_name),
         issues = case when p_decision = 'raise_issue' then btrim(p_comment) else issues end, updated_by = v_uid
   where project_id = v_p.id returning * into v_h;
  perform app.audit(v_p.organization_id, 'handover', v_p.id, v_t.audit_event, jsonb_build_object('status', v_t.from_state),
    jsonb_build_object('status', v_h.status, 'acceptor_name', v_h.acceptor_name, 'package', v_package), p_comment, v_t.permission_code, null, v_p.id);
  if p_decision = 'accept' then
    v_pt := app.transition('project', v_p.status::text, 'complete_handover');
    update public.projects set status = v_pt.to_state::public.project_state, updated_by = v_uid where id = v_p.id returning * into v_p;
    perform app.audit(v_p.organization_id, 'project', v_p.id, v_pt.audit_event, jsonb_build_object('status', v_pt.from_state), jsonb_build_object('status', v_p.status), null,
      v_pt.permission_code, null, v_p.id);
    -- Gate 14: warranty from the contractual event, recording its source date.
    v_source := case v_event
      when 'handover_acceptance' then app.today_ist()
      when 'statutory_approval' then (select max(e.issued_on) from public.statutory_evidence e where e.project_id = v_p.id and e.evidence_type = 'operating_licence' and e.verification = 'verified')
    end;
    select * into v_c from public.configuration_revisions where id = v_p.configuration_revision_id;
    insert into public.lift_assets (asset_number, project_id, configuration_revision_id, lift_category, manufacturer, model, warranty_status, warranty_start_event,
      warranty_source_date, warranty_start, warranty_end, warranty_months, created_by, updated_by)
    values (app.next_business_id('LA', app.lead_city_code(v_p.lead_id)), v_p.id, v_c.id, v_c.lift_category,
      nullif(btrim(coalesce(v_c.parameters -> 'manufacturer' ->> 'value', '')), ''),
      nullif(btrim(coalesce(v_c.parameters -> 'model' ->> 'value', '')), ''),
      (case when v_source is null then 'pending' else 'active' end)::public.warranty_state, v_event, v_source, v_source, case when v_source is null then null else app.warranty_end(v_source, v_months) end,
      v_months, v_uid, v_uid)
    returning * into v_a;
    perform app.audit(v_p.organization_id, 'lift_asset', v_a.id, case when v_a.warranty_status = 'active' then 'warranty.activated' else 'asset.created' end, null,
      jsonb_build_object('asset_number', v_a.asset_number, 'warranty_start_event', v_a.warranty_start_event, 'warranty_source_date', v_a.warranty_source_date,
        'warranty_start', v_a.warranty_start, 'warranty_end', v_a.warranty_end), null, 'project.plan', null, v_p.id);
  end if;
  perform app.notify_permission_holders('project.plan', v_p.organization_id, 'handover.' || p_decision, 'project', v_p.id, 'notification.handover_decided',
    jsonb_build_object('project_number', v_p.project_number, 'decision', p_decision), 'handover.decided:' || v_p.id || ':' || v_h.version);
  return jsonb_build_object('project_id', v_p.id, 'handover_status', v_h.status, 'project_status', v_p.status, 'asset_number', v_a.asset_number,
    'warranty_start', v_a.warranty_start, 'warranty_end', v_a.warranty_end);
end;
$$;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.qa_inspections enable row level security;
alter table public.defects enable row level security;
alter table public.statutory_evidence enable row level security;
alter table public.handover_documents enable row level security;
alter table public.handovers enable row level security;
alter table public.lift_assets enable row level security;

-- Inspections and defects: AIEC managers and QA, the partner's admins / supervisors, the task's assignee.
create policy qa_inspections_read on public.qa_inspections for select to authenticated using (
  (task_id is not null and app.can_read_task(task_id))
  or exists (select 1 from public.projects p where p.id = project_id and (app.is_execution_manager(p.organization_id) or app.is_qa_inspector(p.organization_id))));
create policy defects_read on public.defects for select to authenticated using (app.can_read_task(task_id));
create policy statutory_evidence_read on public.statutory_evidence for select to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and (app.is_execution_manager(p.organization_id) or app.is_qa_inspector(p.organization_id)
          or app.user_has_permission(auth.uid(), 'approval.exception.decide', p.organization_id))));
create policy handover_documents_read on public.handover_documents for select to authenticated using (
  app.is_project_customer(project_id)
  or exists (select 1 from public.projects p where p.id = project_id and (app.is_execution_manager(p.organization_id) or app.is_qa_inspector(p.organization_id))));
create policy handovers_read on public.handovers for select to authenticated using (
  app.is_project_customer(project_id) or exists (select 1 from public.projects p where p.id = project_id and app.is_execution_manager(p.organization_id)));
create policy lift_assets_read on public.lift_assets for select to authenticated using (
  app.is_project_customer(project_id) or exists (select 1 from public.projects p where p.id = project_id and app.is_execution_manager(p.organization_id)));

-- The customer's people read their organization name; AIEC execution managers read customer organizations (to link them).
create policy organizations_read_customers on public.organizations for select to authenticated using (
  kind = 'customer' and app.has_permission('project.plan', app.aiec_org_id()));

revoke all on public.qa_inspections, public.defects, public.statutory_evidence, public.handover_documents, public.handovers, public.lift_assets from anon, authenticated;
grant select on public.qa_inspections, public.defects, public.statutory_evidence, public.handover_documents, public.handovers, public.lift_assets to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.link_project_customer(uuid, integer, uuid),
  public.record_inspection(uuid, jsonb),
  public.defect_action(uuid, integer, text, text),
  public.register_task_evidence(uuid, uuid, jsonb),
  public.resubmit_task(uuid, integer),
  public.register_statutory_evidence(uuid, uuid, jsonb),
  public.verify_statutory_evidence(uuid, text, text),
  public.register_handover_document(uuid, uuid, jsonb),
  public.project_quality_action(uuid, integer, text, text),
  public.handover_action(uuid, text),
  public.customer_handover_decision(uuid, text, text, text)
to authenticated;

-- =============================================================================
-- Slice 4: order conversion (Gate 4) and project creation, payment milestones
-- and verified payment claims (Gate 5, with authorized expiring exceptions),
-- structured BOM (TE05), purchase requests against the approved BOM (Gate 6),
-- supplier quotes, purchase orders with approval limit, material tracking and
-- goods receipts with partial / damaged / quarantined quantities.
-- Mirrors packages/domain (procurement.ts, machines.ts, commercial.ts).
-- =============================================================================

create type public.order_state as enum ('pending_confirmation', 'confirmed', 'completed', 'cancelled');
create type public.project_state as enum (
  'created', 'planning', 'installation_ready', 'installation', 'final_qa', 'statutory_pending',
  'handover_ready', 'handed_over', 'closed', 'on_hold', 'cancelled');
create type public.payment_state as enum ('claimed', 'pending_clarification', 'partially_verified', 'verified', 'rejected');
create type public.material_state as enum (
  'ordered', 'confirmed', 'manufacturing', 'ready', 'dispatched', 'in_transit', 'delivered',
  'received', 'inspected', 'accepted', 'quarantined', 'rejected');
create type public.purchase_request_state as enum ('open', 'supplier_selected', 'ordered', 'cancelled');
create type public.purchase_order_state as enum ('draft', 'pending_approval', 'approved', 'issued', 'closed', 'cancelled');

insert into public.state_transitions (machine, from_state, action, to_state, permission_code, requires_reason, audit_event) values
  ('order', 'pending_confirmation', 'confirm', 'confirmed', 'order.convert', false, 'order.confirmed'),
  ('order', 'pending_confirmation', 'cancel', 'cancelled', 'approval.exception.decide', true, 'order.cancelled'),
  ('order', 'confirmed', 'cancel', 'cancelled', 'approval.exception.decide', true, 'order.cancelled'),
  ('order', 'confirmed', 'complete', 'completed', 'project.plan', false, 'order.completed'),
  ('project', 'created', 'start_planning', 'planning', 'project.plan', false, 'project.planning_started'),
  ('project', 'planning', 'mark_installation_ready', 'installation_ready', 'project.plan', false, 'project.installation_ready'),
  ('project', 'installation_ready', 'start_installation', 'installation', 'project.plan', false, 'project.installation_started'),
  ('project', 'installation', 'submit_final_qa', 'final_qa', 'project.plan', false, 'project.final_qa_requested'),
  ('project', 'final_qa', 'pass_final_qa', 'statutory_pending', 'qa.inspection.decide', false, 'project.final_qa_passed'),
  ('project', 'final_qa', 'fail_final_qa', 'installation', 'qa.inspection.decide', true, 'project.final_qa_failed'),
  ('project', 'statutory_pending', 'record_statutory_clearance', 'handover_ready', 'project.plan', false, 'project.statutory_evidence_recorded'),
  ('project', 'handover_ready', 'complete_handover', 'handed_over', 'project.plan', false, 'project.handed_over'),
  ('project', 'handed_over', 'close', 'closed', 'project.plan', false, 'project.closed'),
  ('project', 'planning', 'hold', 'on_hold', 'project.plan', true, 'project.held'),
  ('project', 'installation_ready', 'hold', 'on_hold', 'project.plan', true, 'project.held'),
  ('project', 'installation', 'hold', 'on_hold', 'project.plan', true, 'project.held'),
  ('project', 'final_qa', 'hold', 'on_hold', 'project.plan', true, 'project.held'),
  ('project', 'on_hold', 'resume', 'planning', 'project.plan', true, 'project.resumed'),
  ('project', 'created', 'cancel', 'cancelled', 'approval.exception.decide', true, 'project.cancelled'),
  ('project', 'planning', 'cancel', 'cancelled', 'approval.exception.decide', true, 'project.cancelled'),
  ('project', 'installation_ready', 'cancel', 'cancelled', 'approval.exception.decide', true, 'project.cancelled'),
  ('project', 'on_hold', 'cancel', 'cancelled', 'approval.exception.decide', true, 'project.cancelled'),
  ('payment', 'claimed', 'verify', 'verified', 'finance.payment.verify', false, 'payment.verified'),
  ('payment', 'partially_verified', 'verify', 'verified', 'finance.payment.verify', false, 'payment.verified'),
  ('payment', 'claimed', 'verify_partially', 'partially_verified', 'finance.payment.verify', true, 'payment.partially_verified'),
  ('payment', 'claimed', 'request_clarification', 'pending_clarification', 'finance.payment.verify', true, 'payment.clarification_requested'),
  ('payment', 'pending_clarification', 'resubmit', 'claimed', 'customer.approval.decide', false, 'payment.resubmitted'),
  ('payment', 'pending_clarification', 'resubmit_recorded', 'claimed', 'order.convert', false, 'payment.resubmitted'),
  ('payment', 'claimed', 'reject', 'rejected', 'finance.payment.verify', true, 'payment.rejected'),
  ('payment', 'pending_clarification', 'reject', 'rejected', 'finance.payment.verify', true, 'payment.rejected'),
  ('material_line', 'ordered', 'confirm', 'confirmed', 'procurement.po.create', false, 'material.confirmed'),
  ('material_line', 'confirmed', 'start_manufacturing', 'manufacturing', 'procurement.po.create', false, 'material.manufacturing'),
  ('material_line', 'confirmed', 'mark_ready', 'ready', 'procurement.po.create', false, 'material.ready'),
  ('material_line', 'manufacturing', 'mark_ready', 'ready', 'procurement.po.create', false, 'material.ready'),
  ('material_line', 'ready', 'dispatch', 'dispatched', 'procurement.po.create', false, 'material.dispatched'),
  ('material_line', 'dispatched', 'mark_in_transit', 'in_transit', 'procurement.po.create', false, 'material.in_transit'),
  ('material_line', 'dispatched', 'mark_delivered', 'delivered', 'procurement.po.create', false, 'material.delivered'),
  ('material_line', 'in_transit', 'mark_delivered', 'delivered', 'procurement.po.create', false, 'material.delivered'),
  ('material_line', 'delivered', 'receive', 'received', 'procurement.grn.record', false, 'material.received'),
  ('material_line', 'received', 'inspect', 'inspected', 'procurement.grn.record', false, 'material.inspected'),
  ('material_line', 'inspected', 'accept', 'accepted', 'procurement.grn.record', false, 'material.accepted'),
  ('material_line', 'quarantined', 'accept', 'accepted', 'procurement.grn.record', false, 'material.accepted'),
  ('material_line', 'inspected', 'quarantine', 'quarantined', 'procurement.grn.record', true, 'material.quarantined'),
  ('material_line', 'inspected', 'reject', 'rejected', 'procurement.grn.record', true, 'material.rejected'),
  ('material_line', 'quarantined', 'reject', 'rejected', 'procurement.grn.record', true, 'material.rejected'),
  ('bom', 'draft', 'approve', 'approved', 'technical.drawing.approve', false, 'bom.approved'),
  ('bom', 'approved', 'supersede', 'superseded', 'technical.drawing.approve', false, 'bom.superseded'),
  ('purchase_request', 'open', 'select_supplier', 'supplier_selected', 'procurement.po.create', false, 'purchase_request.supplier_selected'),
  ('purchase_request', 'supplier_selected', 'select_supplier', 'supplier_selected', 'procurement.po.create', false, 'purchase_request.supplier_selected'),
  ('purchase_request', 'supplier_selected', 'mark_ordered', 'ordered', 'procurement.po.create', false, 'purchase_request.ordered'),
  ('purchase_request', 'open', 'cancel', 'cancelled', 'procurement.request.create', true, 'purchase_request.cancelled'),
  ('purchase_request', 'supplier_selected', 'cancel', 'cancelled', 'procurement.request.create', true, 'purchase_request.cancelled'),
  ('purchase_order', 'draft', 'finalize', 'approved', 'procurement.po.create', false, 'purchase_order.finalized'),
  ('purchase_order', 'draft', 'request_approval', 'pending_approval', 'procurement.po.create', false, 'purchase_order.approval_requested'),
  ('purchase_order', 'pending_approval', 'approve', 'approved', 'procurement.po.approve', false, 'purchase_order.approved'),
  ('purchase_order', 'pending_approval', 'return_to_draft', 'draft', 'procurement.po.approve', true, 'purchase_order.approval_rejected'),
  ('purchase_order', 'approved', 'issue', 'issued', 'procurement.po.create', false, 'purchase_order.issued'),
  ('purchase_order', 'issued', 'close', 'closed', 'procurement.grn.record', false, 'purchase_order.closed'),
  ('purchase_order', 'draft', 'cancel', 'cancelled', 'procurement.po.create', true, 'purchase_order.cancelled'),
  ('purchase_order', 'pending_approval', 'cancel', 'cancelled', 'procurement.po.create', true, 'purchase_order.cancelled'),
  ('purchase_order', 'approved', 'cancel', 'cancelled', 'procurement.po.create', true, 'purchase_order.cancelled');

insert into public.business_rules (rule_key, version, value, audience, reason) values
  ('payment.milestone_templates', 1, '{"templates":[{"code":"new_installation","version":1,"items":[{"code":"advance","label":"advance","shareBps":2500,"trigger":"order_confirmed","dueDays":7,"gates":["procurement"]},{"code":"pre_dispatch","label":"pre_dispatch","shareBps":4500,"trigger":"material_ready","dueDays":7,"gates":["dispatch"]},{"code":"installation","label":"installation","shareBps":2000,"trigger":"installation_started","dueDays":15,"gates":["handover"]},{"code":"handover","label":"handover","shareBps":1000,"trigger":"handover","dueDays":15,"gates":[]}]},{"code":"home_lift","version":1,"items":[{"code":"advance","label":"advance","shareBps":4000,"trigger":"order_confirmed","dueDays":7,"gates":["procurement"]},{"code":"pre_dispatch","label":"pre_dispatch","shareBps":5000,"trigger":"material_ready","dueDays":7,"gates":["dispatch"]},{"code":"handover","label":"handover","shareBps":1000,"trigger":"handover","dueDays":15,"gates":[]}]}]}', 'aiec_staff', 'Launch milestone templates by contract type; Finance / Owner to confirm (D-026)'),
  ('procurement.po_approval_limit', 1, '{"limitPaise":"50000000"}', 'aiec_staff', 'POs above Rs 5,00,000 need approval by another authorized person (D-027)');

alter table public.approval_requests drop constraint approval_requests_kind_check;
alter table public.approval_requests add constraint approval_requests_kind_check check (kind in ('quotation_discount', 'purchase_order', 'payment_exception'));

-- =============================================================================
-- Helpers mirroring the domain
-- =============================================================================
-- Largest-remainder split that sums exactly to p_total (domain allocate(); non-negative totals).
create function app.allocate(p_total numeric, p_weights integer[])
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum numeric := (select sum(w) from unnest(p_weights) w);
  v_parts numeric[];
  v_left numeric;
  v_order integer[];
  v_n integer := cardinality(p_weights);
  k integer := 0;
begin
  if v_n = 0 or v_sum is null or v_sum = 0 or p_total < 0 then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid allocation'));
  end if;
  select array_agg(div(p_total * w, v_sum) order by i) into v_parts from unnest(p_weights) with ordinality u(w, i);
  v_left := p_total - (select sum(x) from unnest(v_parts) x);
  select array_agg(i order by mod(p_total * w, v_sum) desc, i asc) into v_order from unnest(p_weights) with ordinality u(w, i);
  while v_left > 0 loop
    v_parts[v_order[(k % v_n) + 1]] := v_parts[v_order[(k % v_n) + 1]] + 1;
    v_left := v_left - 1;
    k := k + 1;
  end loop;
  return v_parts;
end;
$$;

-- p_lines: [{ "quantityMilli", "ratePaise", "taxRateBps" }]; paise as strings (domain computePurchaseOrder).
create function app.compute_purchase_order(p_lines jsonb, p_freight numeric)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line jsonb;
  v_net numeric; v_tax numeric;
  t_net numeric := 0; t_tax numeric := 0;
  v_out jsonb := '[]'::jsonb;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_net := app.div_round((v_line ->> 'ratePaise')::numeric * (v_line ->> 'quantityMilli')::numeric, 1000);
    v_tax := app.div_round(v_net * (v_line ->> 'taxRateBps')::numeric, 10000);
    v_out := v_out || jsonb_build_array(jsonb_build_object('netPaise', v_net::text, 'taxPaise', v_tax::text, 'totalPaise', (v_net + v_tax)::text));
    t_net := t_net + v_net; t_tax := t_tax + v_tax;
  end loop;
  return jsonb_build_object('lines', v_out, 'netPaise', t_net::text, 'taxPaise', t_tax::text, 'freightPaise', coalesce(p_freight, 0)::text,
    'totalPaise', (t_net + t_tax + coalesce(p_freight, 0))::text);
end;
$$;

-- =============================================================================
-- Orders and projects (Gate 4, SE11)
-- =============================================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null unique references public.leads (id),
  quotation_id uuid not null references public.quotations (id),
  quotation_revision_id uuid not null unique references public.quotation_revisions (id),
  status public.order_state not null default 'pending_confirmation',
  contract_reference text not null check (length(btrim(contract_reference)) >= 3),
  contract_date date not null,
  contract_value_paise bigint not null check (contract_value_paise > 0),
  taxable_value_paise bigint not null,
  milestone_template_code text not null,
  milestone_template_version integer not null,
  handover_checklist jsonb not null,
  notes text,
  confirmed_by uuid references public.user_profiles (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create trigger orders_touch before update on public.orders for each row execute function app.touch_row();

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  project_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  order_id uuid not null unique references public.orders (id),
  lead_id uuid not null references public.leads (id),
  site_id uuid not null references public.sites (id),
  configuration_revision_id uuid not null references public.configuration_revisions (id),
  status public.project_state not null default 'created',
  handover_acknowledged_by uuid references public.user_profiles (id),
  handover_acknowledged_at timestamptz,
  handover_notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create index projects_status_idx on public.projects (organization_id, status);
create trigger projects_touch before update on public.projects for each row execute function app.touch_row();

create table public.payment_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  sequence integer not null,
  code text not null,
  share_bps integer not null check (share_bps > 0),
  amount_paise bigint not null check (amount_paise >= 0),
  trigger_event text not null,
  due_days integer not null check (due_days >= 0),
  gates text[] not null default '{}',
  unique (project_id, code)
);
create trigger payment_milestones_immutable before update or delete on public.payment_milestones
  for each row execute function app.forbid_mutation();

-- Payment claims: a recorded claim is never money until Finance verifies it against a bank / gateway record.
create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  claim_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  milestone_code text not null,
  status public.payment_state not null default 'claimed',
  payer_name text not null check (length(btrim(payer_name)) >= 2),
  amount_paise bigint not null check (amount_paise > 0),
  payment_mode text not null check (payment_mode in ('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'other')),
  payment_reference text not null check (length(btrim(payment_reference)) >= 3),
  payment_date date not null,
  evidence_note text,
  submitted_by uuid not null references public.user_profiles (id),
  verified_by uuid references public.user_profiles (id),
  verified_at timestamptz,
  verified_amount_paise bigint check (verified_amount_paise is null or verified_amount_paise >= 0),
  matched_statement_reference text,
  decision_reason text,
  operation_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check (status not in ('verified', 'partially_verified') or (verified_by is not null and matched_statement_reference is not null and verified_amount_paise is not null)),
  check (verified_by is null or verified_by <> submitted_by)
);
create index payment_claims_project_idx on public.payment_claims (project_id);
create index payment_claims_status_idx on public.payment_claims (organization_id, status);
create trigger payment_claims_touch before update on public.payment_claims for each row execute function app.touch_row();

create function app.guard_payment_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status in ('verified', 'rejected') or new.project_id <> old.project_id or new.submitted_by <> old.submitted_by then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'decided payment claims are records'));
  end if;
  return new;
end;
$$;
create trigger payment_claims_guard before update or delete on public.payment_claims for each row execute function app.guard_payment_claim();

-- Gate 5 (mirror of domain paymentGate): every milestone gating the action is covered by VERIFIED money,
-- unless an approved, unexpired payment exception exists for this project and action.
create function app.payment_gate(p_project_id uuid, p_action text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select pm.code, pm.sequence, pm.amount_paise,
      coalesce((select sum(case when c.status = 'verified' then coalesce(c.verified_amount_paise, c.amount_paise)
                                when c.status = 'partially_verified' then coalesce(c.verified_amount_paise, 0) else 0 end)
                from public.payment_claims c where c.project_id = pm.project_id and c.milestone_code = pm.code), 0) as verified
    from public.payment_milestones pm
    where pm.project_id = p_project_id and p_action = any (pm.gates)
  ), b as (
    select coalesce(jsonb_agg(code order by sequence) filter (where verified < amount_paise), '[]'::jsonb) as blocking from m
  ), e as (
    select exists (
      select 1 from public.approval_requests a
      where a.kind = 'payment_exception' and a.entity_type = 'project' and a.entity_id = p_project_id and a.status = 'approved'
        and a.impact ->> 'action' = p_action and (a.impact ->> 'expires_at')::timestamptz > now()) as ok
  )
  select jsonb_build_object('open', jsonb_array_length(b.blocking) = 0 or e.ok, 'blocking', b.blocking,
    'viaException', jsonb_array_length(b.blocking) > 0 and e.ok)
  from b, e
$$;

-- =============================================================================
-- BOM (TE05)
-- =============================================================================
create table public.bom_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  configuration_revision_id uuid not null references public.configuration_revisions (id),
  revision_no integer not null check (revision_no > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  change_summary text,
  approved_by uuid references public.user_profiles (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (project_id, revision_no),
  check ((status = 'draft') = (approved_at is null))
);
create unique index bom_revisions_one_draft on public.bom_revisions (project_id) where status = 'draft';
create unique index bom_revisions_one_approved on public.bom_revisions (project_id) where status = 'approved';
create trigger bom_revisions_touch before update on public.bom_revisions for each row execute function app.touch_row();

create table public.bom_lines (
  id uuid primary key default gen_random_uuid(),
  bom_revision_id uuid not null references public.bom_revisions (id),
  line_no integer not null check (line_no > 0),
  item_code text not null check (length(btrim(item_code)) between 1 and 60),
  description text not null check (length(btrim(description)) between 2 and 300),
  make_model text,
  specification text,
  quantity_milli integer not null check (quantity_milli > 0),
  unit text not null check (length(btrim(unit)) between 1 and 20),
  source text,
  technical_notes text,
  unique (bom_revision_id, line_no)
);

create function app.guard_bom_line()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select status from public.bom_revisions where id = coalesce(new.bom_revision_id, old.bom_revision_id)) <> 'draft' then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'approved BOM lines are locked'));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger bom_lines_guard before insert or update or delete on public.bom_lines for each row execute function app.guard_bom_line();

-- =============================================================================
-- Purchase requests, supplier quotes, purchase orders, goods receipts (PR01–PR05)
-- =============================================================================
create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  bom_revision_id uuid not null references public.bom_revisions (id),
  status public.purchase_request_state not null default 'open',
  required_by date not null,
  preferred_supplier_id uuid references public.organizations (id),
  budget_estimate_paise bigint check (budget_estimate_paise is null or budget_estimate_paise >= 0),
  notes text,
  selected_quote_id uuid,
  selection_rationale text,
  status_reason text,
  operation_id uuid not null unique,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);
create trigger purchase_requests_touch before update on public.purchase_requests for each row execute function app.touch_row();

create table public.purchase_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests (id),
  line_no integer not null,
  bom_line_id uuid not null references public.bom_lines (id),
  quantity_milli integer not null check (quantity_milli > 0),
  unique (request_id, line_no)
);
create trigger purchase_request_lines_immutable before update or delete on public.purchase_request_lines
  for each row execute function app.forbid_mutation();

create table public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests (id),
  supplier_id uuid not null references public.organizations (id),
  net_paise bigint not null check (net_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  freight_paise bigint not null default 0 check (freight_paise >= 0),
  lead_time_days integer not null check (lead_time_days >= 0),
  warranty_months integer check (warranty_months is null or warranty_months >= 0),
  technical_match boolean not null,
  payment_terms text,
  notes text,
  recorded_by uuid not null references public.user_profiles (id),
  recorded_at timestamptz not null default now()
);
alter table public.purchase_requests add constraint purchase_requests_quote_fk foreign key (selected_quote_id) references public.supplier_quotes (id);
create trigger supplier_quotes_append_only before update or delete on public.supplier_quotes for each row execute function app.forbid_mutation();

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  request_id uuid not null unique references public.purchase_requests (id),
  supplier_id uuid not null references public.organizations (id),
  status public.purchase_order_state not null default 'draft',
  delivery_location text not null check (length(btrim(delivery_location)) >= 3),
  delivery_from date not null,
  delivery_to date not null,
  payment_terms text not null check (length(btrim(payment_terms)) >= 3),
  terms text,
  freight_paise bigint not null default 0 check (freight_paise >= 0),
  totals jsonb not null,
  needs_approval boolean not null,
  approved_by uuid references public.user_profiles (id),
  approved_at timestamptz,
  issued_at timestamptz,
  status_reason text,
  operation_id uuid not null unique,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check (delivery_to >= delivery_from),
  check (approved_by is null or approved_by <> created_by or not needs_approval)
);
create trigger purchase_orders_touch before update on public.purchase_orders for each row execute function app.touch_row();

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id),
  line_no integer not null,
  request_line_id uuid not null unique references public.purchase_request_lines (id),
  bom_line_id uuid not null references public.bom_lines (id),
  description text not null,
  quantity_milli integer not null check (quantity_milli > 0),
  unit text not null,
  rate_paise bigint not null check (rate_paise >= 0),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  net_paise bigint not null,
  tax_paise bigint not null,
  total_paise bigint not null,
  material_status public.material_state not null default 'ordered',
  received_milli integer not null default 0 check (received_milli >= 0),
  accepted_milli integer not null default 0 check (accepted_milli >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (po_id, line_no),
  check (received_milli <= quantity_milli and accepted_milli <= received_milli)
);
create trigger purchase_order_lines_touch before update on public.purchase_order_lines for each row execute function app.touch_row();

create function app.guard_purchase_order_line()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.quantity_milli <> old.quantity_milli or new.rate_paise <> old.rate_paise or new.tax_rate_bps <> old.tax_rate_bps
     or new.po_id <> old.po_id or new.received_milli < old.received_milli or new.accepted_milli < old.accepted_milli then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('reason', 'PO lines are fixed; quantities only grow through goods receipts'));
  end if;
  return new;
end;
$$;
create trigger purchase_order_lines_guard before update or delete on public.purchase_order_lines for each row execute function app.guard_purchase_order_line();

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  grn_number text not null unique,
  organization_id uuid not null references public.organizations (id),
  po_id uuid not null references public.purchase_orders (id),
  received_at timestamptz not null default now(),
  received_by uuid not null references public.user_profiles (id),
  notes text,
  operation_id uuid not null unique
);
create trigger goods_receipts_append_only before update or delete on public.goods_receipts for each row execute function app.forbid_mutation();

create table public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.goods_receipts (id),
  po_line_id uuid not null references public.purchase_order_lines (id),
  received_milli integer not null check (received_milli > 0),
  damaged_milli integer not null default 0 check (damaged_milli >= 0),
  result text not null check (result in ('accepted', 'quarantined', 'rejected')),
  accepted_milli integer not null check (accepted_milli >= 0),
  serial_batch text,
  remarks text,
  check (damaged_milli <= received_milli),
  check (result = 'accepted' or length(btrim(coalesce(remarks, ''))) >= 3)
);
create trigger goods_receipt_lines_append_only before update or delete on public.goods_receipt_lines for each row execute function app.forbid_mutation();

-- =============================================================================
-- Read authorization
-- =============================================================================
create function app.is_procurement(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.user_has_permission(auth.uid(), 'procurement.request.create', p_org)
      or app.user_has_permission(auth.uid(), 'procurement.po.create', p_org)
      or app.user_has_permission(auth.uid(), 'procurement.grn.record', p_org)
      or app.user_has_permission(auth.uid(), 'procurement.po.approve', p_org)
$$;

-- Project record (no money): operations, owner, technical, procurement, finance, and the lead's sales owner.
create function app.can_read_project(p_project_id uuid)
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
    from public.projects p where p.id = p_project_id), false)
$$;

-- Customer money (contract value, milestones, receipts): operations / owner, finance and the lead's sales owner.
create function app.can_read_project_finance(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select app.user_has_permission(auth.uid(), 'project.read_all', p.organization_id)
        or app.user_has_permission(auth.uid(), 'finance.ledger.read', p.organization_id)
        or app.user_has_permission(auth.uid(), 'finance.payment.verify', p.organization_id)
        or app.can_read_lead(p.lead_id)
    from public.projects p where p.id = p_project_id), false)
$$;

-- Supplier prices and receipts: procurement, operations / owner and finance (payables).
create function app.can_read_purchasing(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select app.user_has_permission(auth.uid(), 'project.read_all', p.organization_id)
        or app.user_has_permission(auth.uid(), 'finance.ledger.read', p.organization_id)
        or app.is_procurement(p.organization_id)
    from public.projects p where p.id = p_project_id), false)
$$;

-- =============================================================================
-- Gate 4: convert an accepted quotation revision into an order and a project
-- =============================================================================
create function app.project_json(p public.projects)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('project_id', p.id, 'project_number', p.project_number, 'status', p.status, 'order_id', p.order_id, 'version', p.version)
$$;

create function public.convert_quotation_to_order(p_operation_id uuid, p_revision_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_r public.quotation_revisions;
  v_q public.quotations;
  v_lead public.leads;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_checklist jsonb := coalesce(v_payload -> 'handover_checklist', '{}'::jsonb);
  v_missing jsonb;
  v_template jsonb;
  v_contract_date date := app.jdate(v_payload, 'contract_date');
  v_order public.orders;
  v_project public.projects;
  v_t public.state_transitions;
  v_lt public.state_transitions;
  v_amounts numeric[];
  v_city text;
begin
  select * into v_r from public.quotation_revisions where id = p_revision_id for update;
  select * into v_q from public.quotations where id = v_r.quotation_id;
  select * into v_lead from public.leads where id = v_q.lead_id for update;
  if v_r.id is null or not app.can_read_lead_row(v_lead.organization_id, v_lead.owner_user_id, v_lead.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'quotation'));
  end if;
  perform app.require_lead_owner(v_lead, 'order.convert');
  v_replay := app.op_begin(p_operation_id, 'order.convert');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_r.status <> 'accepted' or v_q.current_revision_id <> v_r.id then
    -- Gate 4: only the accepted, current commercial revision becomes an order.
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_r.status, 'reason', 'only the accepted current revision can be converted'));
  end if;
  if exists (select 1 from public.orders where lead_id = v_lead.id) then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'this lead already has an order'));
  end if;
  select jsonb_agg(k order by o) into v_missing
  from unnest(array['customer_identity', 'accepted_revision', 'agreed_scope', 'contract_record', 'site_and_contact', 'payment_terms',
                    'variations_none_open', 'customer_dependencies']) with ordinality t(k, o)
  where coalesce((v_checklist ->> k)::boolean, false) is not true;
  if v_missing is not null then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', (select jsonb_agg('handover.' || (x #>> '{}')) from jsonb_array_elements(v_missing) x)));
  end if;
  if length(btrim(coalesce(v_payload ->> 'contract_reference', ''))) < 3 or v_contract_date is null then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('contract_reference', 'contract_date')));
  end if;
  if v_contract_date > app.today_ist() then
    perform app.j_field_error('contract_date');
  end if;
  select t into v_template from jsonb_array_elements(app.rule('payment.milestone_templates') -> 'templates') t
   where t ->> 'code' = v_payload ->> 'milestone_template';
  if v_template is null then
    perform app.j_field_error('milestone_template');
  end if;

  v_city := app.lead_city_code(v_lead.id);
  insert into public.orders (order_number, organization_id, lead_id, quotation_id, quotation_revision_id, contract_reference, contract_date,
    contract_value_paise, taxable_value_paise, milestone_template_code, milestone_template_version, handover_checklist, notes, created_by, updated_by)
  values (app.next_business_id('OR', v_city), v_lead.organization_id, v_lead.id, v_q.id, v_r.id, btrim(v_payload ->> 'contract_reference'), v_contract_date,
    (v_r.totals ->> 'grandTotalPaise')::bigint, (v_r.totals ->> 'taxablePaise')::bigint, v_template ->> 'code', (v_template ->> 'version')::integer,
    v_checklist, nullif(btrim(coalesce(v_payload ->> 'notes', '')), ''), v_uid, v_uid)
  returning * into v_order;
  v_t := app.transition('order', 'pending_confirmation', 'confirm');
  update public.orders set status = v_t.to_state::public.order_state, confirmed_by = v_uid, confirmed_at = now() where id = v_order.id returning * into v_order;
  perform app.audit(v_order.organization_id, 'order', v_order.id, v_t.audit_event, null,
    jsonb_build_object('order_number', v_order.order_number, 'quotation_revision_id', v_r.id, 'content_sha256', v_r.content_sha256,
      'contract_reference', v_order.contract_reference, 'contract_value_paise', v_order.contract_value_paise::text), null, v_t.permission_code, p_operation_id);

  -- The lead is won only now, with a confirmed order.
  v_lt := app.transition('lead', v_lead.status::text, 'mark_won');
  update public.leads set status = v_lt.to_state::public.lead_state, next_action_at = null where id = v_lead.id;
  perform app.audit(v_lead.organization_id, 'lead', v_lead.id, v_lt.audit_event, jsonb_build_object('status', v_lead.status),
    jsonb_build_object('status', 'won', 'order_id', v_order.id), null, v_lt.permission_code);

  insert into public.projects (project_number, organization_id, order_id, lead_id, site_id, configuration_revision_id, created_by, updated_by)
  values (app.next_business_id('AIEC', v_city), v_lead.organization_id, v_order.id, v_lead.id, v_lead.site_id, v_r.configuration_revision_id, v_uid, v_uid)
  returning * into v_project;
  v_amounts := app.allocate(v_order.contract_value_paise, (select array_agg((i ->> 'shareBps')::integer order by o) from jsonb_array_elements(v_template -> 'items') with ordinality x(i, o)));
  insert into public.payment_milestones (project_id, sequence, code, share_bps, amount_paise, trigger_event, due_days, gates)
  select v_project.id, o, i ->> 'code', (i ->> 'shareBps')::integer, v_amounts[o]::bigint, i ->> 'trigger', (i ->> 'dueDays')::integer,
         array(select jsonb_array_elements_text(i -> 'gates'))
  from jsonb_array_elements(v_template -> 'items') with ordinality x(i, o);
  perform app.audit(v_project.organization_id, 'project', v_project.id, 'project.created', null,
    jsonb_build_object('project_number', v_project.project_number, 'order_id', v_order.id, 'milestone_template', v_template ->> 'code'),
    null, 'order.convert', null, v_project.id);
  perform app.notify_permission_holders('project.plan', v_project.organization_id, 'project.created', 'project', v_project.id,
    'notification.project_created', jsonb_build_object('project_number', v_project.project_number), 'project.created:' || v_project.id);
  return app.op_finish(p_operation_id, v_project.id, app.project_json(v_project) ||
    jsonb_build_object('order_number', v_order.order_number, 'contract_value_paise', v_order.contract_value_paise::text));
end;
$$;

-- SE11 receiving side: Operations acknowledges the handover and starts planning.
create function public.acknowledge_project_handover(p_project_id uuid, p_expected_version integer, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v_t public.state_transitions;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found or not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  perform app.assert_version(p_expected_version, v_p.version);
  v_t := app.transition('project', v_p.status::text, 'start_planning');
  update public.projects set status = v_t.to_state::public.project_state, handover_acknowledged_by = v_uid, handover_acknowledged_at = now(),
         handover_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_project_id returning * into v_p;
  perform app.audit(v_p.organization_id, 'project', v_p.id, v_t.audit_event, jsonb_build_object('status', 'created'),
    jsonb_build_object('status', v_p.status), p_notes, v_t.permission_code, null, v_p.id);
  return app.project_json(v_p);
end;
$$;

-- =============================================================================
-- Gate 5: payment claims (recorded) → verification by Finance
-- =============================================================================
create function app.claim_json(c public.payment_claims)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('claim_id', c.id, 'claim_number', c.claim_number, 'status', c.status, 'project_id', c.project_id,
    'milestone_code', c.milestone_code, 'version', c.version)
$$;

create function public.record_payment_claim(p_operation_id uuid, p_project_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_p public.projects;
  v_lead public.leads;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_amount text := v_payload ->> 'amount_paise';
  v_date date := app.jdate(v_payload, 'payment_date');
  v_missing text[] := '{}';
  v_c public.payment_claims;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project_finance(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  select * into v_lead from public.leads where id = v_p.lead_id;
  if not ((v_lead.owner_user_id = v_uid and app.user_has_permission(v_uid, 'order.convert', v_p.organization_id))
          or app.user_has_permission(v_uid, 'finance.payment.verify', v_p.organization_id)) then
    perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'order.convert'));
  end if;
  v_replay := app.op_begin(p_operation_id, 'payment.record');
  if v_replay is not null then
    return v_replay;
  end if;
  if not exists (select 1 from public.payment_milestones where project_id = p_project_id and code = v_payload ->> 'milestone_code') then
    v_missing := v_missing || 'milestone_code'::text;
  end if;
  if length(btrim(coalesce(v_payload ->> 'payer_name', ''))) < 2 then v_missing := v_missing || 'payer_name'::text; end if;
  if length(btrim(coalesce(v_payload ->> 'payment_reference', ''))) < 3 then v_missing := v_missing || 'payment_reference'::text; end if;
  if v_date is null then v_missing := v_missing || 'payment_date'::text; end if;
  if cardinality(v_missing) > 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;
  if coalesce(v_amount, '') !~ '^[1-9][0-9]{0,13}$' then perform app.j_field_error('amount_paise'); end if;
  if coalesce(v_payload ->> 'payment_mode', '') not in ('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'other') then perform app.j_field_error('payment_mode'); end if;
  if v_date > app.today_ist() then perform app.j_field_error('payment_date'); end if;
  insert into public.payment_claims (claim_number, organization_id, project_id, milestone_code, payer_name, amount_paise, payment_mode, payment_reference,
    payment_date, evidence_note, submitted_by, operation_id, updated_by)
  values (app.next_business_id('PM', app.lead_city_code(v_p.lead_id)), v_p.organization_id, p_project_id, v_payload ->> 'milestone_code',
    btrim(v_payload ->> 'payer_name'), v_amount::bigint, v_payload ->> 'payment_mode', btrim(v_payload ->> 'payment_reference'), v_date,
    nullif(btrim(coalesce(v_payload ->> 'evidence_note', '')), ''), v_uid, p_operation_id, v_uid)
  returning * into v_c;
  perform app.audit(v_c.organization_id, 'payment_claim', v_c.id, 'payment.claimed', null,
    jsonb_build_object('claim_number', v_c.claim_number, 'milestone_code', v_c.milestone_code, 'amount_paise', v_c.amount_paise::text,
      'payment_reference', v_c.payment_reference), null, null, p_operation_id, v_p.id);
  perform app.notify_permission_holders('finance.payment.verify', v_c.organization_id, 'payment.claimed', 'payment_claim', v_c.id,
    'notification.payment_claimed', jsonb_build_object('claim_number', v_c.claim_number), 'payment.claimed:' || v_c.id);
  return app.op_finish(p_operation_id, v_c.id, app.claim_json(v_c));
end;
$$;

-- FN02: verify / partially verify / ask for clarification / reject. Never by the person who recorded the claim.
create function public.decide_payment_claim(p_claim_id uuid, p_expected_version integer, p_decision text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_c public.payment_claims;
  v_t public.state_transitions;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_reason text := nullif(btrim(coalesce(v_payload ->> 'reason', '')), '');
  v_ref text := nullif(btrim(coalesce(v_payload ->> 'matched_statement_reference', '')), '');
  v_amount text := v_payload ->> 'verified_amount_paise';
  v_verified bigint;
begin
  select * into v_c from public.payment_claims where id = p_claim_id for update;
  if not found or not app.can_read_project_finance(v_c.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'payment_claim'));
  end if;
  perform app.require_permission('finance.payment.verify', v_c.organization_id);
  perform app.assert_version(p_expected_version, v_c.version);
  if p_decision not in ('verify', 'verify_partially', 'request_clarification', 'reject') then
    perform app.j_field_error('decision');
  end if;
  v_t := app.transition('payment', v_c.status::text, p_decision, v_reason);
  if p_decision in ('verify', 'verify_partially') then
    if v_c.submitted_by = v_uid then
      perform app.raise_error('SELF_APPROVAL_FORBIDDEN');
    end if;
    if v_ref is null or length(v_ref) < 3 then
      -- A screenshot or a claim is not money: match a bank / gateway statement first (§10.4).
      perform app.raise_error('PAYMENT_NOT_VERIFIED', jsonb_build_object('fields', jsonb_build_array('matched_statement_reference')));
    end if;
    if coalesce(v_amount, '') !~ '^[0-9]{1,14}$' then perform app.j_field_error('verified_amount_paise'); end if;
    v_verified := v_amount::bigint;
    if p_decision = 'verify' and v_verified <> v_c.amount_paise then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('verified_amount_paise'), 'reason', 'use partial verification'));
    end if;
    if p_decision = 'verify_partially' and (v_verified <= 0 or v_verified >= v_c.amount_paise) then
      perform app.j_field_error('verified_amount_paise');
    end if;
  end if;
  update public.payment_claims
     set status = v_t.to_state::public.payment_state, decision_reason = v_reason,
         verified_by = case when p_decision in ('verify', 'verify_partially') then v_uid else verified_by end,
         verified_at = case when p_decision in ('verify', 'verify_partially') then now() else verified_at end,
         verified_amount_paise = case when p_decision in ('verify', 'verify_partially') then v_verified else verified_amount_paise end,
         matched_statement_reference = case when p_decision in ('verify', 'verify_partially') then v_ref else matched_statement_reference end
   where id = p_claim_id returning * into v_c;
  perform app.audit(v_c.organization_id, 'payment_claim', v_c.id, v_t.audit_event, null,
    jsonb_build_object('status', v_c.status, 'verified_amount_paise', v_c.verified_amount_paise::text, 'matched_statement_reference', v_c.matched_statement_reference),
    v_reason, v_t.permission_code, null, v_c.project_id);
  perform app.notify(v_c.submitted_by, v_c.organization_id, 'payment.decided', 'project', v_c.project_id, 'notification.payment_decided',
    jsonb_build_object('claim_number', v_c.claim_number, 'decision', v_c.status), 'payment.decided:' || v_c.id || ':' || v_c.version);
  return app.claim_json(v_c);
end;
$$;

create function public.resubmit_payment_claim(p_claim_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_c public.payment_claims;
  v_lead public.leads;
  v_t public.state_transitions;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  select * into v_c from public.payment_claims where id = p_claim_id for update;
  if not found or not app.can_read_project_finance(v_c.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'payment_claim'));
  end if;
  select l.* into v_lead from public.leads l join public.projects p on p.lead_id = l.id where p.id = v_c.project_id;
  perform app.require_lead_owner(v_lead, 'order.convert');
  perform app.assert_version(p_expected_version, v_c.version);
  v_t := app.transition('payment', v_c.status::text, 'resubmit_recorded');
  if length(btrim(coalesce(v_payload ->> 'payment_reference', ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('payment_reference')));
  end if;
  update public.payment_claims set status = v_t.to_state::public.payment_state, payment_reference = btrim(v_payload ->> 'payment_reference'),
         evidence_note = coalesce(nullif(btrim(coalesce(v_payload ->> 'evidence_note', '')), ''), evidence_note)
   where id = p_claim_id returning * into v_c;
  perform app.audit(v_c.organization_id, 'payment_claim', v_c.id, v_t.audit_event, null,
    jsonb_build_object('status', v_c.status, 'payment_reference', v_c.payment_reference), null, v_t.permission_code, null, v_c.project_id);
  return app.claim_json(v_c);
end;
$$;

-- Gate 5 exception (§48): Operations asks; an authorized approver decides; it expires.
create function public.request_payment_exception(p_project_id uuid, p_action text, p_reason text, p_expires_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v_gate jsonb;
  v_id uuid;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  perform app.require_permission('project.plan', v_p.organization_id);
  if p_action not in ('procurement', 'dispatch', 'installation', 'handover') then perform app.j_field_error('action'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason'), 'reason', 'explain the rule bypassed, business impact and compensating control'));
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then perform app.j_field_error('expires_at'); end if;
  v_gate := app.payment_gate(p_project_id, p_action);
  if (v_gate ->> 'open')::boolean then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('reason', 'the payment gate is already open'));
  end if;
  insert into public.approval_requests (organization_id, kind, entity_type, entity_id, lead_id, requested_by, reasons, policy, impact)
  values (v_p.organization_id, 'payment_exception', 'project', p_project_id, v_p.lead_id, v_uid, array['payment_not_verified'],
    jsonb_build_object('gate', 'payment', 'blocking', v_gate -> 'blocking'),
    jsonb_build_object('project_number', v_p.project_number, 'action', p_action, 'expires_at', p_expires_at, 'justification', btrim(p_reason)))
  returning id into v_id;
  perform app.audit(v_p.organization_id, 'approval_request', v_id, 'payment_exception.requested', null,
    jsonb_build_object('action', p_action, 'expires_at', p_expires_at, 'blocking', v_gate -> 'blocking'), p_reason, 'project.plan', null, v_p.id);
  perform app.notify_permission_holders('approval.exception.decide', v_p.organization_id, 'approval.requested', 'approval_request', v_id,
    'notification.approval_requested', jsonb_build_object('project_number', v_p.project_number), 'approval.requested:' || v_id);
  return jsonb_build_object('approval_request_id', v_id, 'status', 'pending');
end;
$$;

-- =============================================================================
-- TE05 BOM
-- =============================================================================
create function public.save_bom_draft(p_project_id uuid, p_expected_version integer, p_lines jsonb, p_change_summary text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_p public.projects;
  v_b public.bom_revisions;
  v_line jsonb;
  v_i integer := 0;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  perform app.require_permission('technical.review', v_p.organization_id);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then perform app.j_field_error('lines'); end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    if length(btrim(coalesce(v_line ->> 'item_code', ''))) not between 1 and 60 then perform app.j_field_error('lines.' || v_i || '.item_code'); end if;
    if length(btrim(coalesce(v_line ->> 'description', ''))) not between 2 and 300 then perform app.j_field_error('lines.' || v_i || '.description'); end if;
    if coalesce(v_line ->> 'quantity_milli', '') !~ '^[1-9][0-9]{0,8}$' then perform app.j_field_error('lines.' || v_i || '.quantity_milli'); end if;
    if length(btrim(coalesce(v_line ->> 'unit', ''))) not between 1 and 20 then perform app.j_field_error('lines.' || v_i || '.unit'); end if;
  end loop;
  select * into v_b from public.bom_revisions where project_id = p_project_id and status = 'draft' for update;
  if found then
    perform app.assert_version(p_expected_version, v_b.version);
    update public.bom_revisions set change_summary = nullif(btrim(coalesce(p_change_summary, '')), ''), configuration_revision_id = v_p.configuration_revision_id
     where id = v_b.id returning * into v_b;
    delete from public.bom_lines where bom_revision_id = v_b.id;
  else
    insert into public.bom_revisions (organization_id, project_id, configuration_revision_id, revision_no, change_summary, created_by, updated_by)
    values (v_p.organization_id, p_project_id, v_p.configuration_revision_id,
      coalesce((select max(revision_no) from public.bom_revisions where project_id = p_project_id), 0) + 1,
      nullif(btrim(coalesce(p_change_summary, '')), ''), v_uid, v_uid)
    returning * into v_b;
  end if;
  insert into public.bom_lines (bom_revision_id, line_no, item_code, description, make_model, specification, quantity_milli, unit, source, technical_notes)
  select v_b.id, o, btrim(l ->> 'item_code'), btrim(l ->> 'description'), nullif(btrim(coalesce(l ->> 'make_model', '')), ''),
         nullif(btrim(coalesce(l ->> 'specification', '')), ''), (l ->> 'quantity_milli')::integer, btrim(l ->> 'unit'),
         nullif(btrim(coalesce(l ->> 'source', '')), ''), nullif(btrim(coalesce(l ->> 'technical_notes', '')), '')
  from jsonb_array_elements(p_lines) with ordinality x(l, o);
  perform app.audit(v_b.organization_id, 'bom_revision', v_b.id, 'bom.saved', null,
    jsonb_build_object('revision_no', v_b.revision_no, 'lines', jsonb_array_length(p_lines)), null, 'technical.review', null, p_project_id);
  select * into v_b from public.bom_revisions where id = v_b.id;
  return jsonb_build_object('bom_revision_id', v_b.id, 'revision_no', v_b.revision_no, 'status', v_b.status, 'version', v_b.version);
end;
$$;

create function public.approve_bom(p_bom_revision_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_b public.bom_revisions;
  v_t public.state_transitions;
  v_prev uuid;
begin
  select * into v_b from public.bom_revisions where id = p_bom_revision_id for update;
  if not found or not app.can_read_project(v_b.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'bom_revision'));
  end if;
  perform app.require_permission('technical.drawing.approve', v_b.organization_id);
  perform app.assert_version(p_expected_version, v_b.version);
  v_t := app.transition('bom', v_b.status, 'approve');
  if not exists (select 1 from public.configuration_revisions where id = v_b.configuration_revision_id and status = 'approved') then
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'the BOM must map to the approved configuration revision'));
  end if;
  if not exists (select 1 from public.bom_lines where bom_revision_id = v_b.id) then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('lines')));
  end if;
  update public.bom_revisions set status = 'superseded' where project_id = v_b.project_id and status = 'approved' returning id into v_prev;
  update public.bom_revisions set status = v_t.to_state, approved_by = v_uid, approved_at = now() where id = v_b.id returning * into v_b;
  perform app.audit(v_b.organization_id, 'bom_revision', v_b.id, v_t.audit_event, jsonb_build_object('superseded', v_prev),
    jsonb_build_object('revision_no', v_b.revision_no, 'configuration_revision_id', v_b.configuration_revision_id), null, v_t.permission_code, null, v_b.project_id);
  perform app.notify_permission_holders('procurement.request.create', v_b.organization_id, 'bom.approved', 'project', v_b.project_id,
    'notification.bom_approved', jsonb_build_object('revision_no', v_b.revision_no), 'bom.approved:' || v_b.id);
  return jsonb_build_object('bom_revision_id', v_b.id, 'revision_no', v_b.revision_no, 'status', v_b.status, 'version', v_b.version);
end;
$$;

-- =============================================================================
-- PR01: purchase requests only against approved BOM lines, only when Gate 5 allows procurement
-- =============================================================================
create function public.create_purchase_request(p_operation_id uuid, p_project_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_p public.projects;
  v_bom public.bom_revisions;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_gate jsonb;
  v_required date := app.jdate(v_payload, 'required_by');
  v_line jsonb;
  v_i integer := 0;
  v_bl public.bom_lines;
  v_used bigint;
  v_r public.purchase_requests;
  v_supplier uuid := app.try_uuid(v_payload ->> 'preferred_supplier_id');
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found or not app.can_read_project(p_project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'project'));
  end if;
  perform app.require_permission('procurement.request.create', v_p.organization_id);
  v_replay := app.op_begin(p_operation_id, 'purchase_request.create');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_p.status not in ('planning', 'installation_ready', 'installation') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_p.status, 'reason', 'procurement starts after Operations accepts the handover'));
  end if;
  v_gate := app.payment_gate(p_project_id, 'procurement');
  if not (v_gate ->> 'open')::boolean then
    perform app.raise_error('PAYMENT_NOT_VERIFIED', jsonb_build_object('missing', v_gate -> 'blocking'));
  end if;
  select * into v_bom from public.bom_revisions where project_id = p_project_id and status = 'approved';
  if not found then
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'an approved BOM revision is required'));
  end if;
  if v_required is null then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('required_by'))); end if;
  if v_required < app.today_ist() then perform app.j_field_error('required_by'); end if;
  if v_supplier is not null and not exists (select 1 from public.organizations where id = v_supplier and kind = 'supplier' and status = 'active') then
    perform app.j_field_error('preferred_supplier_id');
  end if;
  if nullif(v_payload ->> 'budget_estimate_paise', '') is not null and (v_payload ->> 'budget_estimate_paise') !~ '^[0-9]{1,14}$' then
    perform app.j_field_error('budget_estimate_paise');
  end if;
  if jsonb_typeof(v_payload -> 'lines') <> 'array' or jsonb_array_length(v_payload -> 'lines') = 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('lines')));
  end if;
  insert into public.purchase_requests (request_number, organization_id, project_id, bom_revision_id, required_by, preferred_supplier_id,
    budget_estimate_paise, notes, operation_id, created_by, updated_by)
  values (app.next_business_id('PR', app.lead_city_code(v_p.lead_id)), v_p.organization_id, p_project_id, v_bom.id, v_required, v_supplier,
    nullif(v_payload ->> 'budget_estimate_paise', '')::bigint, nullif(btrim(coalesce(v_payload ->> 'notes', '')), ''), p_operation_id, v_uid, v_uid)
  returning * into v_r;
  for v_line in select * from jsonb_array_elements(v_payload -> 'lines') loop
    v_i := v_i + 1;
    select * into v_bl from public.bom_lines where id = app.try_uuid(v_line ->> 'bom_line_id') and bom_revision_id = v_bom.id;
    if v_bl.id is null then
      -- Gate 6: only items of the approved BOM; anything else is a substitution for Technical.
      perform app.j_field_error('lines.' || v_i || '.bom_line_id');
    end if;
    if coalesce(v_line ->> 'quantity_milli', '') !~ '^[1-9][0-9]{0,8}$' then perform app.j_field_error('lines.' || v_i || '.quantity_milli'); end if;
    select coalesce(sum(rl.quantity_milli), 0) into v_used from public.purchase_request_lines rl
      join public.purchase_requests r on r.id = rl.request_id where rl.bom_line_id = v_bl.id and r.status <> 'cancelled';
    if v_used + (v_line ->> 'quantity_milli')::integer > v_bl.quantity_milli then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('lines.' || v_i || '.quantity_milli'), 'reason', 'more than the BOM quantity'));
    end if;
    insert into public.purchase_request_lines (request_id, line_no, bom_line_id, quantity_milli) values (v_r.id, v_i, v_bl.id, (v_line ->> 'quantity_milli')::integer);
  end loop;
  perform app.audit(v_r.organization_id, 'purchase_request', v_r.id, 'purchase_request.created', null,
    jsonb_build_object('request_number', v_r.request_number, 'bom_revision_id', v_bom.id, 'lines', v_i, 'via_payment_exception', v_gate -> 'viaException'),
    null, 'procurement.request.create', p_operation_id, p_project_id);
  return app.op_finish(p_operation_id, v_r.id, jsonb_build_object('request_id', v_r.id, 'request_number', v_r.request_number, 'status', v_r.status, 'version', v_r.version));
end;
$$;

create function public.add_supplier_quote(p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.purchase_requests;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_supplier uuid := app.try_uuid(v_payload ->> 'supplier_id');
  v_id uuid;
  k text;
begin
  select * into v_r from public.purchase_requests where id = p_request_id;
  if not found or not app.can_read_purchasing(v_r.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_request'));
  end if;
  perform app.require_permission('procurement.po.create', v_r.organization_id);
  if v_r.status not in ('open', 'supplier_selected') then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_r.status));
  end if;
  if v_supplier is null or not exists (select 1 from public.organizations where id = v_supplier and kind = 'supplier' and status = 'active') then
    perform app.j_field_error('supplier_id');
  end if;
  foreach k in array array['net_paise', 'tax_paise', 'freight_paise'] loop
    if coalesce(v_payload ->> k, '0') !~ '^[0-9]{1,14}$' then perform app.j_field_error(k); end if;
  end loop;
  if coalesce(v_payload ->> 'lead_time_days', '') !~ '^[0-9]{1,4}$' then perform app.j_field_error('lead_time_days'); end if;
  if jsonb_typeof(v_payload -> 'technical_match') <> 'boolean' then perform app.j_field_error('technical_match'); end if;
  insert into public.supplier_quotes (request_id, supplier_id, net_paise, tax_paise, freight_paise, lead_time_days, warranty_months, technical_match, payment_terms, notes, recorded_by)
  values (p_request_id, v_supplier, (v_payload ->> 'net_paise')::bigint, coalesce(v_payload ->> 'tax_paise', '0')::bigint, coalesce(v_payload ->> 'freight_paise', '0')::bigint,
    (v_payload ->> 'lead_time_days')::integer, app.jint(v_payload, 'warranty_months'), (v_payload ->> 'technical_match')::boolean,
    nullif(btrim(coalesce(v_payload ->> 'payment_terms', '')), ''), nullif(btrim(coalesce(v_payload ->> 'notes', '')), ''), v_uid)
  returning id into v_id;
  perform app.audit(v_r.organization_id, 'purchase_request', v_r.id, 'purchase_request.quote_recorded', null,
    jsonb_build_object('quote_id', v_id, 'supplier_id', v_supplier, 'technical_match', v_payload -> 'technical_match'), null, 'procurement.po.create', null, v_r.project_id);
  return jsonb_build_object('quote_id', v_id, 'request_id', p_request_id);
end;
$$;

-- PR02: record the chosen supplier and why; a technically different offer needs Technical approval (PR06), so it is refused here.
create function public.select_supplier(p_request_id uuid, p_expected_version integer, p_quote_id uuid, p_rationale text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.purchase_requests;
  v_q public.supplier_quotes;
  v_t public.state_transitions;
begin
  select * into v_r from public.purchase_requests where id = p_request_id for update;
  if not found or not app.can_read_purchasing(v_r.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_request'));
  end if;
  perform app.require_permission('procurement.po.create', v_r.organization_id);
  perform app.assert_version(p_expected_version, v_r.version);
  v_t := app.transition('purchase_request', v_r.status::text, 'select_supplier');
  select * into v_q from public.supplier_quotes where id = p_quote_id and request_id = p_request_id;
  if v_q.id is null then perform app.j_field_error('quote_id'); end if;
  if length(btrim(coalesce(p_rationale, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('rationale')));
  end if;
  if not v_q.technical_match then
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('reason', 'the offer is not technically equivalent; a substitution needs Technical approval'));
  end if;
  update public.purchase_requests set status = v_t.to_state::public.purchase_request_state, selected_quote_id = v_q.id, selection_rationale = btrim(p_rationale)
   where id = p_request_id returning * into v_r;
  perform app.audit(v_r.organization_id, 'purchase_request', v_r.id, v_t.audit_event, null,
    jsonb_build_object('quote_id', v_q.id, 'supplier_id', v_q.supplier_id), p_rationale, v_t.permission_code, null, v_r.project_id);
  return jsonb_build_object('request_id', v_r.id, 'status', v_r.status, 'version', v_r.version);
end;
$$;

create function public.cancel_purchase_request(p_request_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_r public.purchase_requests;
  v_t public.state_transitions;
begin
  select * into v_r from public.purchase_requests where id = p_request_id for update;
  if not found or not app.can_read_purchasing(v_r.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_request'));
  end if;
  perform app.require_permission('procurement.request.create', v_r.organization_id);
  perform app.assert_version(p_expected_version, v_r.version);
  v_t := app.transition('purchase_request', v_r.status::text, 'cancel', p_reason);
  update public.purchase_requests set status = v_t.to_state::public.purchase_request_state, status_reason = btrim(p_reason) where id = p_request_id returning * into v_r;
  perform app.audit(v_r.organization_id, 'purchase_request', v_r.id, v_t.audit_event, null, jsonb_build_object('status', v_r.status), p_reason, v_t.permission_code, null, v_r.project_id);
  return jsonb_build_object('request_id', v_r.id, 'status', v_r.status, 'version', v_r.version);
end;
$$;

-- =============================================================================
-- PR03: purchase order from the selected supplier; approval above the limit by someone else
-- =============================================================================
create function app.po_json(p public.purchase_orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('po_id', p.id, 'po_number', p.po_number, 'status', p.status, 'needs_approval', p.needs_approval, 'totals', p.totals, 'version', p.version)
$$;

create function public.create_purchase_order(p_operation_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_r public.purchase_requests;
  v_q public.supplier_quotes;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_prices jsonb := coalesce(v_payload -> 'lines', '[]'::jsonb);
  v_rl record;
  v_price jsonb;
  v_input jsonb := '[]'::jsonb;
  v_calc jsonb;
  v_freight text := coalesce(nullif(v_payload ->> 'freight_paise', ''), '0');
  v_from date := app.jdate(v_payload, 'delivery_from');
  v_to date := app.jdate(v_payload, 'delivery_to');
  v_po public.purchase_orders;
  v_t public.state_transitions;
  v_n integer := 0;
begin
  select * into v_r from public.purchase_requests where id = p_request_id for update;
  if not found or not app.can_read_purchasing(v_r.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_request'));
  end if;
  perform app.require_permission('procurement.po.create', v_r.organization_id);
  v_replay := app.op_begin(p_operation_id, 'purchase_order.create');
  if v_replay is not null then
    return v_replay;
  end if;
  v_t := app.transition('purchase_request', v_r.status::text, 'mark_ordered');
  select * into v_q from public.supplier_quotes where id = v_r.selected_quote_id;
  if v_freight !~ '^[0-9]{1,14}$' then perform app.j_field_error('freight_paise'); end if;
  if v_from is null or v_to is null or v_to < v_from then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('delivery_from', 'delivery_to'))); end if;
  if length(btrim(coalesce(v_payload ->> 'delivery_location', ''))) < 3 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('delivery_location'))); end if;
  if length(btrim(coalesce(v_payload ->> 'payment_terms', ''))) < 3 then perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('payment_terms'))); end if;
  for v_rl in select rl.*, bl.description, bl.unit from public.purchase_request_lines rl join public.bom_lines bl on bl.id = rl.bom_line_id
              where rl.request_id = p_request_id order by rl.line_no loop
    v_n := v_n + 1;
    select p into v_price from jsonb_array_elements(v_prices) p where p ->> 'request_line_id' = v_rl.id::text;
    if v_price is null or coalesce(v_price ->> 'rate_paise', '') !~ '^[0-9]{1,13}$' then perform app.j_field_error('lines.' || v_n || '.rate_paise'); end if;
    if coalesce(v_price ->> 'tax_rate_bps', '') !~ '^[0-9]{1,5}$' or (v_price ->> 'tax_rate_bps')::integer > 10000 then perform app.j_field_error('lines.' || v_n || '.tax_rate_bps'); end if;
    v_input := v_input || jsonb_build_array(jsonb_build_object('quantityMilli', v_rl.quantity_milli, 'ratePaise', v_price ->> 'rate_paise', 'taxRateBps', (v_price ->> 'tax_rate_bps')::integer,
      'request_line_id', v_rl.id, 'bom_line_id', v_rl.bom_line_id, 'description', v_rl.description, 'unit', v_rl.unit, 'line_no', v_rl.line_no));
    v_price := null;
  end loop;
  v_calc := app.compute_purchase_order(v_input, v_freight::numeric);
  insert into public.purchase_orders (po_number, organization_id, project_id, request_id, supplier_id, delivery_location, delivery_from, delivery_to,
    payment_terms, terms, freight_paise, totals, needs_approval, operation_id, created_by, updated_by)
  values (app.next_business_id('PO', (select app.lead_city_code(p.lead_id) from public.projects p where p.id = v_r.project_id)), v_r.organization_id, v_r.project_id,
    p_request_id, v_q.supplier_id, btrim(v_payload ->> 'delivery_location'), v_from, v_to, btrim(v_payload ->> 'payment_terms'),
    nullif(btrim(coalesce(v_payload ->> 'terms', '')), ''), v_freight::bigint, v_calc,
    (v_calc ->> 'totalPaise')::numeric > (app.rule('procurement.po_approval_limit') ->> 'limitPaise')::numeric, p_operation_id, v_uid, v_uid)
  returning * into v_po;
  insert into public.purchase_order_lines (po_id, line_no, request_line_id, bom_line_id, description, quantity_milli, unit, rate_paise, tax_rate_bps, net_paise, tax_paise, total_paise)
  select v_po.id, (i ->> 'line_no')::integer, (i ->> 'request_line_id')::uuid, (i ->> 'bom_line_id')::uuid, i ->> 'description', (i ->> 'quantityMilli')::integer,
         i ->> 'unit', (i ->> 'ratePaise')::bigint, (i ->> 'taxRateBps')::integer, (c ->> 'netPaise')::bigint, (c ->> 'taxPaise')::bigint, (c ->> 'totalPaise')::bigint
  from jsonb_array_elements(v_input) with ordinality a(i, o) join jsonb_array_elements(v_calc -> 'lines') with ordinality b(c, ob) on ob = o;
  update public.purchase_requests set status = v_t.to_state::public.purchase_request_state where id = p_request_id;
  perform app.audit(v_po.organization_id, 'purchase_order', v_po.id, 'purchase_order.created', null,
    jsonb_build_object('po_number', v_po.po_number, 'total_paise', v_calc ->> 'totalPaise', 'needs_approval', v_po.needs_approval), null, 'procurement.po.create', p_operation_id, v_po.project_id);
  return app.op_finish(p_operation_id, v_po.id, app.po_json(v_po));
end;
$$;

create function public.submit_purchase_order(p_po_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_po public.purchase_orders;
  v_t public.state_transitions;
  v_req uuid;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found or not app.can_read_purchasing(v_po.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_order'));
  end if;
  perform app.require_permission('procurement.po.create', v_po.organization_id);
  perform app.assert_version(p_expected_version, v_po.version);
  v_t := app.transition('purchase_order', v_po.status::text, case when v_po.needs_approval then 'request_approval' else 'finalize' end);
  if v_po.needs_approval then
    update public.purchase_orders set status = v_t.to_state::public.purchase_order_state where id = p_po_id returning * into v_po;
    insert into public.approval_requests (organization_id, kind, entity_type, entity_id, requested_by, reasons, policy, impact)
    values (v_po.organization_id, 'purchase_order', 'purchase_order', v_po.id, v_po.created_by, array['po_above_limit'],
      jsonb_build_object('limitPaise', app.rule('procurement.po_approval_limit') ->> 'limitPaise'),
      jsonb_build_object('po_number', v_po.po_number, 'totalPaise', v_po.totals ->> 'totalPaise', 'supplier_id', v_po.supplier_id))
    returning id into v_req;
    perform app.notify_permission_holders('procurement.po.approve', v_po.organization_id, 'approval.requested', 'approval_request', v_req,
      'notification.approval_requested', jsonb_build_object('po_number', v_po.po_number), 'approval.requested:' || v_req);
  else
    update public.purchase_orders set status = v_t.to_state::public.purchase_order_state, approved_at = now() where id = p_po_id returning * into v_po;
  end if;
  perform app.audit(v_po.organization_id, 'purchase_order', v_po.id, v_t.audit_event, jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', v_po.status, 'approval_request_id', v_req), null, v_t.permission_code, null, v_po.project_id);
  return app.po_json(v_po) || jsonb_build_object('approval_request_id', v_req);
end;
$$;

-- O04 for the new request kinds: purchase orders (procurement.po.approve) and payment exceptions (approval.exception.decide).
create function public.decide_approval_request(p_request_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_req public.approval_requests;
  v_perm text;
  v_po public.purchase_orders;
  v_t public.state_transitions;
begin
  select * into v_req from public.approval_requests where id = p_request_id for update;
  v_perm := case v_req.kind when 'purchase_order' then 'procurement.po.approve' when 'payment_exception' then 'approval.exception.decide' end;
  if not found or v_perm is null or not (app.user_has_permission(v_uid, v_perm, v_req.organization_id) or v_req.requested_by = v_uid) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'approval_request'));
  end if;
  perform app.require_permission(v_perm, v_req.organization_id);
  if v_req.status <> 'pending' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_req.status, 'allowedActions', '[]'::jsonb));
  end if;
  if v_req.requested_by = v_uid then
    perform app.raise_error('SELF_APPROVAL_FORBIDDEN');
  end if;
  if p_decision not in ('approve', 'reject') then perform app.j_field_error('decision'); end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) < 3 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('reason')));
  end if;
  if v_req.kind = 'payment_exception' and p_decision = 'approve' and (v_req.impact ->> 'expires_at')::timestamptz <= now() then
    perform app.raise_error('APPROVAL_EXPIRED');
  end if;
  if v_req.kind = 'purchase_order' then
    select * into v_po from public.purchase_orders where id = v_req.entity_id for update;
    v_t := app.transition('purchase_order', v_po.status::text, case when p_decision = 'approve' then 'approve' else 'return_to_draft' end, p_reason);
    update public.purchase_orders set status = v_t.to_state::public.purchase_order_state,
           approved_by = case when p_decision = 'approve' then v_uid end, approved_at = case when p_decision = 'approve' then now() end,
           status_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = v_po.id;
    perform app.audit(v_po.organization_id, 'purchase_order', v_po.id, v_t.audit_event, jsonb_build_object('status', 'pending_approval'),
      jsonb_build_object('status', v_t.to_state), p_reason, v_t.permission_code, null, v_po.project_id);
  end if;
  update public.approval_requests set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = v_uid, decided_at = now(), decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_request_id returning * into v_req;
  perform app.audit(v_req.organization_id, 'approval_request', v_req.id, 'approval.decided', jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', v_req.status, 'kind', v_req.kind, 'impact', v_req.impact), p_reason, v_perm);
  perform app.notify(v_req.requested_by, v_req.organization_id, 'approval.decided', 'approval_request', v_req.id, 'notification.approval_decided',
    jsonb_build_object('kind', v_req.kind, 'decision', v_req.status), 'approval.decided:' || v_req.id);
  return jsonb_build_object('approval_request_id', v_req.id, 'approval_status', v_req.status, 'kind', v_req.kind);
end;
$$;

create function public.issue_purchase_order(p_po_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_po public.purchase_orders;
  v_t public.state_transitions;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found or not app.can_read_purchasing(v_po.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_order'));
  end if;
  perform app.require_permission('procurement.po.create', v_po.organization_id);
  perform app.assert_version(p_expected_version, v_po.version);
  v_t := app.transition('purchase_order', v_po.status::text, 'issue');
  update public.purchase_orders set status = v_t.to_state::public.purchase_order_state, issued_at = now() where id = p_po_id returning * into v_po;
  perform app.audit(v_po.organization_id, 'purchase_order', v_po.id, v_t.audit_event, jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', v_po.status), null, v_t.permission_code, null, v_po.project_id);
  return app.po_json(v_po);
end;
$$;

-- PR04: each line is tracked separately (confirmed → manufacturing → ready → dispatched → in transit → delivered).
create function public.update_material_status(p_po_line_id uuid, p_expected_version integer, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_l public.purchase_order_lines;
  v_po public.purchase_orders;
  v_t public.state_transitions;
begin
  select * into v_l from public.purchase_order_lines where id = p_po_line_id for update;
  select * into v_po from public.purchase_orders where id = v_l.po_id;
  if v_l.id is null or not app.can_read_purchasing(v_po.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_order_line'));
  end if;
  perform app.require_permission('procurement.po.create', v_po.organization_id);
  perform app.assert_version(p_expected_version, v_l.version);
  if v_po.status <> 'issued' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_po.status, 'reason', 'the PO must be issued'));
  end if;
  if p_action not in ('confirm', 'start_manufacturing', 'mark_ready', 'dispatch', 'mark_in_transit', 'mark_delivered') then perform app.j_field_error('action'); end if;
  v_t := app.transition('material_line', v_l.material_status::text, p_action);
  update public.purchase_order_lines set material_status = v_t.to_state::public.material_state where id = p_po_line_id returning * into v_l;
  perform app.audit(v_po.organization_id, 'purchase_order_line', v_l.id, v_t.audit_event, null, jsonb_build_object('material_status', v_l.material_status),
    null, v_t.permission_code, null, v_po.project_id);
  return jsonb_build_object('po_line_id', v_l.id, 'material_status', v_l.material_status, 'version', v_l.version);
end;
$$;

-- PR05 goods receipt: partial receipts never mark a line accepted; damaged and quarantined quantities never count.
create function public.record_goods_receipt(p_operation_id uuid, p_po_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_replay jsonb;
  v_po public.purchase_orders;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_line jsonb;
  v_i integer := 0;
  v_l public.purchase_order_lines;
  v_rec integer; v_dmg integer; v_acc integer;
  v_result text;
  v_grn public.goods_receipts;
  v_t public.state_transitions;
  v_all boolean;
  v_close public.state_transitions;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found or not app.can_read_purchasing(v_po.project_id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_order'));
  end if;
  perform app.require_permission('procurement.grn.record', v_po.organization_id);
  v_replay := app.op_begin(p_operation_id, 'goods_receipt.record');
  if v_replay is not null then
    return v_replay;
  end if;
  if v_po.status <> 'issued' then
    perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_po.status));
  end if;
  if jsonb_typeof(v_payload -> 'lines') <> 'array' or jsonb_array_length(v_payload -> 'lines') = 0 then
    perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('lines')));
  end if;
  insert into public.goods_receipts (grn_number, organization_id, po_id, received_by, notes, operation_id)
  values (app.next_business_id('GRN', (select app.lead_city_code(p.lead_id) from public.projects p where p.id = v_po.project_id)), v_po.organization_id, p_po_id, v_uid,
    nullif(btrim(coalesce(v_payload ->> 'notes', '')), ''), p_operation_id)
  returning * into v_grn;
  for v_line in select * from jsonb_array_elements(v_payload -> 'lines') loop
    v_i := v_i + 1;
    select * into v_l from public.purchase_order_lines where id = app.try_uuid(v_line ->> 'po_line_id') and po_id = p_po_id for update;
    if v_l.id is null then perform app.j_field_error('lines.' || v_i || '.po_line_id'); end if;
    if v_l.material_status not in ('delivered', 'received') then
      perform app.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('currentState', v_l.material_status, 'reason', 'mark the line delivered first', 'fields', jsonb_build_array('lines.' || v_i)));
    end if;
    if coalesce(v_line ->> 'received_milli', '') !~ '^[1-9][0-9]{0,8}$' then perform app.j_field_error('lines.' || v_i || '.received_milli'); end if;
    if coalesce(v_line ->> 'damaged_milli', '0') !~ '^[0-9]{1,9}$' then perform app.j_field_error('lines.' || v_i || '.damaged_milli'); end if;
    v_rec := (v_line ->> 'received_milli')::integer;
    v_dmg := coalesce(v_line ->> 'damaged_milli', '0')::integer;
    v_result := v_line ->> 'result';
    if v_result not in ('accepted', 'quarantined', 'rejected') then perform app.j_field_error('lines.' || v_i || '.result'); end if;
    if v_dmg > v_rec then perform app.j_field_error('lines.' || v_i || '.damaged_milli'); end if;
    if (v_result <> 'accepted' or v_dmg > 0) and length(btrim(coalesce(v_line ->> 'remarks', ''))) < 3 then
      perform app.raise_error('REQUIRED_FIELD_MISSING', jsonb_build_object('fields', jsonb_build_array('lines.' || v_i || '.remarks')));
    end if;
    if v_l.received_milli + v_rec > v_l.quantity_milli then
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('lines.' || v_i || '.received_milli'), 'reason', 'more than ordered'));
    end if;
    v_acc := case when v_result = 'accepted' then v_rec - v_dmg else 0 end;
    insert into public.goods_receipt_lines (receipt_id, po_line_id, received_milli, damaged_milli, result, accepted_milli, serial_batch, remarks)
    values (v_grn.id, v_l.id, v_rec, v_dmg, v_result, v_acc, nullif(btrim(coalesce(v_line ->> 'serial_batch', '')), ''), nullif(btrim(coalesce(v_line ->> 'remarks', '')), ''));
    if v_l.material_status = 'delivered' then
      v_t := app.transition('material_line', 'delivered', 'receive');
      update public.purchase_order_lines set material_status = v_t.to_state::public.material_state where id = v_l.id;
    end if;
    update public.purchase_order_lines set received_milli = received_milli + v_rec, accepted_milli = accepted_milli + v_acc where id = v_l.id returning * into v_l;
    if v_l.accepted_milli >= v_l.quantity_milli then
      v_t := app.transition('material_line', 'received', 'inspect');
      update public.purchase_order_lines set material_status = 'inspected' where id = v_l.id;
      v_t := app.transition('material_line', 'inspected', 'accept');
      update public.purchase_order_lines set material_status = v_t.to_state::public.material_state where id = v_l.id;
    end if;
    perform app.audit(v_po.organization_id, 'purchase_order_line', v_l.id, 'material.received', null,
      jsonb_build_object('grn_number', v_grn.grn_number, 'received_milli', v_rec, 'damaged_milli', v_dmg, 'result', v_result, 'accepted_milli', v_acc),
      v_line ->> 'remarks', 'procurement.grn.record', p_operation_id, v_po.project_id);
  end loop;
  select bool_and(material_status = 'accepted') into v_all from public.purchase_order_lines where po_id = p_po_id;
  if v_all then
    v_close := app.transition('purchase_order', 'issued', 'close');
    update public.purchase_orders set status = v_close.to_state::public.purchase_order_state where id = p_po_id;
    perform app.audit(v_po.organization_id, 'purchase_order', v_po.id, v_close.audit_event, jsonb_build_object('status', 'issued'),
      jsonb_build_object('status', 'closed'), null, v_close.permission_code, null, v_po.project_id);
  end if;
  return app.op_finish(p_operation_id, v_grn.id, jsonb_build_object('grn_id', v_grn.id, 'grn_number', v_grn.grn_number, 'po_closed', coalesce(v_all, false)));
end;
$$;

-- =============================================================================
-- RLS & grants
-- =============================================================================
alter table public.orders enable row level security;
alter table public.projects enable row level security;
alter table public.payment_milestones enable row level security;
alter table public.payment_claims enable row level security;
alter table public.bom_revisions enable row level security;
alter table public.bom_lines enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_lines enable row level security;
alter table public.supplier_quotes enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;

create function app.project_of_order(p_order_id uuid) returns uuid language sql stable security definer set search_path = '' as $$ select id from public.projects where order_id = p_order_id $$;
create function app.project_of_bom(p_bom uuid) returns uuid language sql stable security definer set search_path = '' as $$ select project_id from public.bom_revisions where id = p_bom $$;
create function app.project_of_request(p_req uuid) returns uuid language sql stable security definer set search_path = '' as $$ select project_id from public.purchase_requests where id = p_req $$;
create function app.project_of_po(p_po uuid) returns uuid language sql stable security definer set search_path = '' as $$ select project_id from public.purchase_orders where id = p_po $$;
create function app.project_of_receipt(p_grn uuid) returns uuid language sql stable security definer set search_path = '' as $$ select po.project_id from public.goods_receipts g join public.purchase_orders po on po.id = g.po_id where g.id = p_grn $$;

create policy orders_read on public.orders for select to authenticated using (app.can_read_project_finance(app.project_of_order(id)));
create policy projects_read on public.projects for select to authenticated using (app.can_read_project(id));
create policy payment_milestones_read on public.payment_milestones for select to authenticated using (app.can_read_project_finance(project_id));
create policy payment_claims_read on public.payment_claims for select to authenticated using (app.can_read_project_finance(project_id));
create policy bom_revisions_read on public.bom_revisions for select to authenticated using (app.can_read_project(project_id));
create policy bom_lines_read on public.bom_lines for select to authenticated using (app.can_read_project(app.project_of_bom(bom_revision_id)));
create policy purchase_requests_read on public.purchase_requests for select to authenticated using (app.can_read_purchasing(project_id));
create policy purchase_request_lines_read on public.purchase_request_lines for select to authenticated using (app.can_read_purchasing(app.project_of_request(request_id)));
create policy supplier_quotes_read on public.supplier_quotes for select to authenticated using (app.can_read_purchasing(app.project_of_request(request_id)));
create policy purchase_orders_read on public.purchase_orders for select to authenticated using (app.can_read_purchasing(project_id));
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated using (app.can_read_purchasing(app.project_of_po(po_id)));
create policy goods_receipts_read on public.goods_receipts for select to authenticated using (app.can_read_purchasing(app.project_of_po(po_id)));
create policy goods_receipt_lines_read on public.goods_receipt_lines for select to authenticated using (app.can_read_purchasing(app.project_of_receipt(receipt_id)));

-- Approval center: each approver sees the kinds they can decide; requesters see their own.
drop policy approval_requests_read on public.approval_requests;
create policy approval_requests_read on public.approval_requests for select to authenticated using (
  requested_by = auth.uid()
  or (kind = 'quotation_discount' and app.user_has_permission(auth.uid(), 'quotation.discount.approve', organization_id))
  or (kind = 'purchase_order' and app.user_has_permission(auth.uid(), 'procurement.po.approve', organization_id))
  or (kind = 'payment_exception' and app.user_has_permission(auth.uid(), 'approval.exception.decide', organization_id)));

-- Procurement and operations see supplier organizations (to quote and order).
create policy organizations_read_suppliers on public.organizations for select to authenticated using (
  kind = 'supplier' and (app.is_procurement(app.aiec_org_id()) or app.has_permission('project.read_all', app.aiec_org_id())));

revoke all on public.orders, public.projects, public.payment_milestones, public.payment_claims, public.bom_revisions, public.bom_lines,
  public.purchase_requests, public.purchase_request_lines, public.supplier_quotes, public.purchase_orders, public.purchase_order_lines,
  public.goods_receipts, public.goods_receipt_lines from anon, authenticated;
grant select on public.orders, public.projects, public.payment_milestones, public.payment_claims, public.bom_revisions, public.bom_lines,
  public.purchase_requests, public.purchase_request_lines, public.supplier_quotes, public.purchase_orders, public.purchase_order_lines,
  public.goods_receipts, public.goods_receipt_lines to authenticated;

-- Gate 5 status for screens (read-only; same rule the RPCs enforce).
create function public.project_payment_gate(p_project_id uuid, p_action text)
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
  return app.payment_gate(p_project_id, p_action);
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.convert_quotation_to_order(uuid, uuid, jsonb),
  public.acknowledge_project_handover(uuid, integer, text),
  public.record_payment_claim(uuid, uuid, jsonb),
  public.decide_payment_claim(uuid, integer, text, jsonb),
  public.resubmit_payment_claim(uuid, integer, jsonb),
  public.request_payment_exception(uuid, text, text, timestamptz),
  public.save_bom_draft(uuid, integer, jsonb, text),
  public.approve_bom(uuid, integer),
  public.create_purchase_request(uuid, uuid, jsonb),
  public.add_supplier_quote(uuid, jsonb),
  public.select_supplier(uuid, integer, uuid, text),
  public.cancel_purchase_request(uuid, integer, text),
  public.create_purchase_order(uuid, uuid, jsonb),
  public.submit_purchase_order(uuid, integer),
  public.decide_approval_request(uuid, text, text),
  public.issue_purchase_order(uuid, integer),
  public.update_material_status(uuid, integer, text),
  public.record_goods_receipt(uuid, uuid, jsonb),
  public.project_payment_gate(uuid, text)
  to authenticated;
revoke execute on all functions in schema app from public, anon;
grant execute on function
  app.is_procurement(uuid), app.can_read_project(uuid), app.can_read_project_finance(uuid), app.can_read_purchasing(uuid),
  app.project_of_order(uuid), app.project_of_bom(uuid), app.project_of_request(uuid), app.project_of_po(uuid), app.project_of_receipt(uuid)
  to authenticated;

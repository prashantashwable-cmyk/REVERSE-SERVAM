# API contracts — Slices 1 & 2 (Deliverable G)

All business mutations are PostgreSQL functions in schema `public`, called through Supabase (`supabase.rpc(name, args)`). Clients have **SELECT-only** access to tables, filtered by Row Level Security; they never `INSERT`/`UPDATE`/`DELETE` directly (verified by tests).

Every RPC is `SECURITY DEFINER` with `search_path = ''` and runs in a single transaction:

1. **Authenticate** — `auth.uid()` must be set (`AUTH_REQUIRED`) and the profile `active` (`ACCOUNT_NOT_ACTIVE`).
2. **Authorize** — permission + resource scope (`ACCESS_DENIED`, `NOT_FOUND` for records outside your scope, `PROJECT_NOT_ASSIGNED`).
3. **Validate** — state transition from `public.state_transitions` (`INVALID_STATE_TRANSITION` with `currentState` and `allowedActions`), required fields, formats, optimistic version (`REVISION_CONFLICT` with `expected` / `current`).
4. **Mutate**, **audit** (`audit_logs`, with the actor's role context and permission used) and **notify** (deduplicated).

Errors are raised with `message` = an error code from `packages/domain/src/errors.ts` and `details` = JSON. Raw SQL errors are never shown to users: unknown errors map to `UNKNOWN_ERROR`.

**Idempotency.** Operations that create records or may be retried from an offline device take `p_operation_id` (client UUID). The first call stores its result in `sync_operations`; repeats — including concurrent ones — return the stored result with `"replayed": true` and create nothing. Reusing an operation id for a different user or operation type returns `DUPLICATE_OPERATION`. Other transitions are protected by `p_expected_version`.

Times are `timestamptz`; clients must send an explicit offset (the web sends IST `+05:30`).

---

## Identity & administration (Slice 1)

| RPC | Arguments | Who | Behaviour | Audit / notify |
|---|---|---|---|---|
| `get_my_context()` | — | any signed-in user (also pending/suspended) | Profile, active memberships with roles, effective permissions (empty unless `active`), AIEC org id, missing onboarding fields | — |
| `update_my_profile` | `p_full_name`, `p_preferred_locale?` (`en`/`mr`/`hi`), `p_expected_version?` | self | Name 2–120 chars | `profile.updated` |
| `set_my_locale` | `p_locale` (`en`/`mr`/`hi`) | self, any account status (also pending) | Interface language only; returns `{preferred_locale, changed, version}`; new profiles default to `mr` | `profile.locale_changed` |
| `admin_create_organization` | `p_kind` (not `aiec`), `p_name`, `p_legal_name`, `p_city`, `p_reason` | `org.manage` (AIEC) | Creates partner / customer / supplier / QA agency org | `organization.created` |
| `admin_add_member` | `p_user_id`, `p_org_id`, `p_reason` | AIEC `role.assign` (any org) or `partner.team.manage` (own partner org) | Idempotent. Partner admins may only enrol users with no other active membership (`TENANT_SCOPE_VIOLATION`) | `membership.added` |
| `admin_remove_member` | `p_user_id`, `p_org_id`, `p_reason` | as above; partner admins only for supervisor/technician members | Revokes roles + membership; history kept; last Owner protected | `membership.removed` |
| `admin_grant_role` | `p_user_id`, `p_org_id`, `p_role_code`, `p_reason` | AIEC `role.assign`; partner admins only `partner_supervisor` / `technician` in own org | Idempotent; role must be allowed for the org kind and the user an active member (also enforced by trigger) | `role.granted` |
| `admin_revoke_role` | `p_user_role_id`, `p_reason` | as above | Last active Owner protected (`LAST_OWNER_PROTECTED`); takes effect on the next request | `role.revoked` |
| `admin_set_user_status` | `p_user_id`, `p_status`, `p_reason`, `p_expected_version?` | AIEC `user.manage`, or partner admin for own field staff | Not on yourself (`SELF_APPROVAL_FORBIDDEN`); last Owner protected | `user.status_changed` |
| `set_business_rule` | `p_rule_key`, `p_value` (object), `p_reason`, `p_effective_from?`, `p_audience?` | `rules.manage` | Appends a new version (history immutable) | `rule.changed` (before/after) |
| `mark_notification_read` | `p_notification_id` | recipient | — | — |
| `list_assignable_users` | `p_purpose` = `surveyor` \| `lead_owner` | `survey.schedule`/`survey.review` resp. `lead.assign` | Returns only `{id, full_name}` of active capable users | — |

Operator-only (SQL editor, not exposed to API roles): `app.bootstrap_platform(owner_user_id, org_name, city)` creates the AIEC organization and the first Owner; refuses once an Owner exists.

## Leads (Slice 2)

| RPC | Arguments | Who / scope | Preconditions & validation | Idempotency | Audit / notify |
|---|---|---|---|---|---|
| `search_possible_duplicates` | phone, alternate phone, email, project, builder, lat, lng, exclude id | `lead.create` or `lead.read_all` | Returns masked candidates: number, status, project, city, owner name, reasons, `strong`/`possible`, distance, `can_open`. Never contact details of leads you cannot read | read-only | — |
| `create_lead` | `p_operation_id`, `p_payload` (below) | `lead.create` | Minimum: contact name, phone **or** email, project name, site city, initial requirement, source. Formats validated per field. Every duplicate candidate must be listed in `duplicate_review.confirmed_separate_from` with a reason, else `DUPLICATE_REVIEW_REQUIRED` (details include candidates). Default owner = creator; assigning someone else needs `lead.assign` | operation id | `lead.created`, `lead.assigned`; notify owner or `lead.assign` holders |
| `assign_lead` | `p_lead_id`, `p_assignee_id`, `p_expected_version`, `p_reason` | `lead.assign` | `new → assigned`; reassign from assigned/contacted/qualified needs a reason; assignee must hold `lead.read_assigned` | version | `lead.assigned` / `lead.reassigned`; notify assignee |
| `record_lead_activity` | `p_operation_id`, `p_lead_id`, `p_activity_type`, `p_outcome`, `p_summary`, `p_occurred_at`, `p_next_follow_up_at`, `p_no_action_reason` | lead owner with `lead.activity.record` | Open leads only. Next follow-up (after the activity) **or** a no-action reason is mandatory. A two-way outcome moves `assigned → contacted` and sets `first_contacted_at` | operation id | `lead.activity_recorded` (+ `lead.contacted`) |
| `qualify_lead` | `p_lead_id`, `p_expected_version`, `p_qualification` (object), `p_score_override?`, `p_override_reason?` | lead owner with `lead.qualify` | `contacted/qualified → qualified`; requires `need`, `decision_authority`, `timeline`, `next_action`. Score computed from rule `lead.scoring` with explanation; override needs a reason | version | `lead.qualified` (before/after) |
| `close_lead` | `p_lead_id`, `p_expected_version`, `p_outcome` (`lost`/`invalid`), `p_reason`, `p_lost_reason` | lead owner with `lead.close` | Lost needs a lost-reason code and explanation | version | `lead.closed_lost` / `lead.marked_invalid` |
| `reopen_lead` | `p_lead_id`, `p_expected_version`, `p_assignee_id`, `p_reason` | `lead.assign` | `lost → assigned`; `invalid` and `won` are terminal | version | `lead.reopened`; notify |
| `record_duplicate_decision` | `p_lead_id`, `p_candidate_lead_id`, `p_decision`, `p_reason` | can read the lead | Candidate must currently match; `ownership_transfer_requested` / `merge_requested` route to `lead.assign` / `lead.merge` holders. Nothing is merged automatically | — | `lead.duplicate_decision` |

`create_lead` payload keys: `contact_name`, `phone`, `alternate_phone`, `email`, `customer_type`, `builder_name`, `project_name`, `building_usage`, `floors_count`, `stops_count`, `lift_requirement`, `construction_stage`, `budget_range`, `expected_decision_date` (YYYY-MM-DD), `source`, `referrer`, `decision_maker`, `communication_preference`, `marketing_consent` (boolean), `notes`, `next_action_at`, `assign_to`, `site{name, address_line, locality, city, zone, pincode, latitude, longitude, location_accuracy_m, location_source}`, `duplicate_review{confirmed_separate_from[], reason}`.

## Surveys & evidence (Slice 2)

| RPC | Arguments | Who / scope | Preconditions & validation | Idempotency | Audit / notify |
|---|---|---|---|---|---|
| `schedule_survey` | `p_operation_id`, `p_lead_id`, `p_surveyor_id`, `p_scheduled_start`, `p_scheduled_end`, `p_scope`, `p_special_instructions`, `p_site_contact_name`, `p_site_contact_phone` | `survey.schedule` and the lead is visible to you | Lead must be `qualified`; surveyor must hold `survey.capture`; ≤ 12 h; not in the past; no overlap (`SCHEDULE_CONFLICT`, also an exclusion constraint). Creates revision 1 (draft) and a contact snapshot for the field | operation id | `survey.scheduled`; notify surveyor |
| `reschedule_survey` | `p_survey_id`, `p_expected_version`, start, end, `p_surveyor_id?`, `p_reason?` | scheduler | From scheduled / accepted / reschedule_requested / site_inaccessible / revisit_requested / revision_requested | version | `survey.rescheduled`; notify |
| `cancel_survey` | `p_survey_id`, `p_expected_version`, `p_reason` | scheduler | Not after submission | version | `survey.cancelled`; notify surveyor |
| `survey_field_action` | `p_survey_id`, `p_expected_version`, `p_action`, `p_reason?` | assigned surveyor (`survey.capture`) | `accept`, `request_reschedule`*, `request_revisit`*, `report_inaccessible`*, `start_revision` (*reason required) | version | per action; reschedule / revisit / inaccessible notify the lead owner |
| `check_in_survey` | `p_operation_id`, `p_survey_id`, `p_location_permission`, lat, lng, accuracy, `p_client_time`, `p_exception_reason?` | assigned surveyor | `accepted → in_progress`. **Server** classifies GPS (`verified` ≤ rule `gps.check_in.max_accuracy_m`, else `low_accuracy`/`permission_denied`/`unavailable`); non-verified needs a reason; coordinates sent without permission are discarded. Stores device and server time | operation id | `survey.checked_in`; exceptions notify `survey.gps_exception.review` holders |
| `save_survey_draft` | `p_operation_id`, `p_survey_id`, `p_revision_id`, `p_expected_revision_version`, `p_data`, `p_measurements` | assigned surveyor | Current draft revision only; known sections only; measurements `{key, entered_value, entered_unit (mm/cm/m), level_label?, note?}` — the **server** computes `value_mm`. Returns the current Gate 1 failures | operation id + revision version | `survey.draft_saved` |
| `register_evidence` | `p_operation_id`, `p_survey_id`, `p_payload` | assigned surveyor, survey `in_progress` | File must already exist in private bucket `evidence` at `{org}/surveys/{survey}/{operation_id}.{ext}` (storage RLS allows that upload only to the assigned surveyor). Size must match the stored object; MIME and size per rule `evidence.files`; SHA-256 required. Photos must be in-app captures; `document_import` only for `doc_*`; `gallery_exception` needs a reason. `supersedes_id` marks a retake (original kept) | operation id (also unique per file path) | `evidence.registered` |
| `submit_survey` | `p_operation_id`, `p_survey_id`, `p_expected_revision_version` | assigned surveyor | **Gate 1** from rule `survey.requirements`: required fields, measurements, photo categories, documents attached or unavailable-with-reason. Fails with the first failure code and `details.failures/fields/missing`. Locks the revision (immutable), snapshots evidence ids, supersedes the previous submitted revision | operation id | `survey.submitted`; notify `survey.review` holders and the lead owner |
| `request_survey_revision` | `p_survey_id`, `p_expected_version`, `p_reason` | `survey.review` | From submitted / under_review. Creates a new draft revision copying data and measurements | version | `survey.revision_requested`; notify surveyor |
| `review_gps_exception` | `p_survey_id`, `p_decision` (`accepted`/`rejected`), `p_note` | `survey.gps_exception.review`, not the surveyor | Once per check-in | — | `survey.gps_exception_reviewed` |

## Technical review, configuration and documents (Slice 3)

| RPC | Arguments | Who | Behaviour | Audit / notify |
|---|---|---|---|---|
| `start_technical_review` | `p_survey_id` | `technical.review` | Survey `submitted → under_review`; creates the review (TR-…) or resumes one waiting for clarification / information; binds the current submitted revision | `survey.review_started`, `technical_review.started` / `.resumed` |
| `request_technical_clarification` | `p_review_id`, `p_expected_version`, `p_reason` | `technical.review` | New draft survey revision back to the surveyor | `technical_review.clarification_requested`, `survey.revision_requested`; notifies surveyor |
| `decide_technical_review` | `p_review_id`, `p_expected_version`, `p_decision` (`feasible`/`conditionally_feasible`/`not_feasible`/`insufficient_information`), `p_payload` {technical_basis, assumptions, references, constraints[], corrective_actions[], reason} | `technical.review` | Basis always; constraints + actions for conditional; reason for not feasible / insufficient. Survey → `reviewed` (or back to the surveyor for insufficient). Decision immutable | `technical_review.decided`; notifies lead owner |
| `save_configuration_draft` | `p_lead_id`, `p_expected_version`, `p_lift_category`, `p_parameters` {key: {value, status proposed/reviewed}}, `p_change_summary` | `technical.review`, review in progress or feasible | One draft per lead; returns catalogue check (failures + warnings) | `configuration.saved` |
| `approve_configuration` | `p_revision_id`, `p_expected_version` | `technical.configuration.approve`, feasible decision | Catalogue failures block; warnings kept; checksum; supersedes previous approved | `configuration.approved`; notifies lead owner |
| `register_document_revision` | `p_operation_id`, `p_lead_id`, `p_document_id?`, `p_payload` {kind, title, storage_path, sha256, mime_type, size_bytes, change_summary, configuration_revision_id?} | `technical.review` | File must already be in `technical-documents` at `{org}/leads/{lead}/{operation_id}.{ext}`; idempotent; one open revision per document | `document.registered` |
| `submit_document_revision` | `p_revision_id`, `p_expected_version` | `technical.review` | `draft → in_review` | `document.submitted`; notifies approvers |
| `decide_document_revision` | `p_revision_id`, `p_expected_version`, `p_decision` (`approve`/`reject`), `p_reviewed_sha256`, `p_comment` | `technical.drawing.approve` | Approve only if the checksum matches; supersedes the previous approved revision; reject needs a comment | `document.approved` / `.rejected` / `.superseded` |

## Quotations and approvals (Slice 3)

| RPC | Arguments | Who | Behaviour | Audit / notify |
|---|---|---|---|---|
| `create_quotation` | `p_operation_id`, `p_lead_id` | lead owner with `quotation.create` | Qualified lead + approved configuration (Gate 2); one quotation (QT-…) per lead; revision 1 draft | `quotation.created` |
| `save_quotation_draft` | `p_revision_id`, `p_expected_version`, `p_lines` [{category, description, quantity_milli, unit, rate_paise, discount_bps, tax_code, estimated_unit_cost_paise?, cost_source?}], `p_terms` {8 term keys}, `p_valid_until` | lead owner | Server computes every amount in paise and the discount authority (current policy) | `quotation.draft_saved` |
| `submit_quotation` | `p_revision_id`, `p_expected_version` | lead owner | Within authority → `approved`; otherwise `pending_approval` + approval request | `quotation.finalized` / `.approval_requested`; notifies approvers |
| `decide_quotation_approval` | `p_request_id`, `p_decision` (`approve`/`reject`/`more_info`), `p_reason` | `quotation.discount.approve`, never the requester | Reason for reject / more info; returns to draft unless approved | `approval.decided`, `quotation.approved` / `.approval_rejected`; notifies requester |
| `issue_quotation` | `p_revision_id`, `p_expected_version` | lead owner with `quotation.issue` | Gate 3: all terms, validity not passed, configuration still approved; stores the SHA-256 of the customer-facing content | `quotation.issued` |
| `record_customer_response` | `p_revision_id`, `p_expected_version`, `p_response` (`accept`/`reject`), `p_payload` {accepted_by_name, acceptor_authority, channel, evidence, comments, content_sha256 / reason} | lead owner with `quotation.issue` | Acceptance must name the issued content hash and be within validity; stored append-only | `quotation.accepted` / `.rejected_by_customer`; notifies Owner |
| `revise_quotation` | `p_quotation_id`, `p_reason` | lead owner | New draft revision (copy, current approved configuration); supersedes the open one, withdraws a pending request; accepted quotations cannot be revised | `quotation.superseded`, `quotation.revised` |
| `add_quotation_negotiation` | `p_quotation_id`, `p_payload` {occurred_at, contact, topic, requested_change, requested_discount_bps, expected_impact, decision} | lead owner | Append-only log | `quotation.negotiation_recorded` |

## Orders, projects and payments (Slice 4)

| RPC | Arguments | Who | Behaviour | Audit / notify |
|---|---|---|---|---|
| `convert_quotation_to_order` | `p_operation_id`, `p_revision_id`, `p_payload` {contract_reference, contract_date, milestone_template, handover_checklist {8 items}, notes} | lead owner with `order.convert` | Gate 4: only the accepted, current revision; one order (OR-…) per lead; every handover item true; contract date not in the future. Creates the order (confirmed), marks the lead won, creates the project (AIEC-…) with a title / site snapshot and the payment milestones (largest-remainder split of the contract value) | `order.confirmed`, `lead.won`, `project.created`; notifies `project.plan` holders |
| `acknowledge_project_handover` | `p_project_id`, `p_expected_version`, `p_notes` | `project.plan` | created → planning | `project.planning_started` |
| `record_payment_claim` | `p_operation_id`, `p_project_id`, `p_payload` {milestone_code, payer_name, amount_paise, payment_mode, payment_reference, payment_date, evidence_note} | lead owner with `order.convert`, or `finance.payment.verify` | Records a claim (PM-…); a claim never counts as money | `payment.claimed`; notifies Finance |
| `decide_payment_claim` | `p_claim_id`, `p_expected_version`, `p_decision` (verify / verify_partially / request_clarification / reject), `p_payload` {verified_amount_paise, matched_statement_reference, reason} | `finance.payment.verify`, never the recorder | Verification needs a matched statement reference; full = claimed amount, partial strictly between 0 and it; decided claims are immutable | `payment.*`; notifies the recorder |
| `resubmit_payment_claim` | `p_claim_id`, `p_expected_version`, `p_payload` {payment_reference, evidence_note} | the lead owner | After a clarification request | `payment.resubmitted` |
| `request_payment_exception` | `p_project_id`, `p_action`, `p_reason`, `p_expires_at` | `project.plan` | Only while the gate is blocked; time-limited | `payment_exception.requested`; notifies `approval.exception.decide` |
| `project_payment_gate` | `p_project_id`, `p_action` | anyone who can read the project | `{open, blocking[], viaException}` — the same rule as the domain `paymentGate` | — |

## BOM, purchasing and receipts (Slice 4)

| RPC | Arguments | Who | Behaviour | Audit / notify |
|---|---|---|---|---|
| `save_bom_draft` | `p_project_id`, `p_expected_version` (null for a new revision), `p_lines` [{item_code, description, make_model, specification, quantity_milli, unit, source, technical_notes}], `p_change_summary` | `technical.review` | One draft per project, bound to the project's configuration revision | `bom.saved` |
| `approve_bom` | `p_bom_revision_id`, `p_expected_version` | `technical.drawing.approve` | Needs lines and an approved configuration; supersedes the previous approved revision; approved lines are locked | `bom.approved`, `bom.superseded`; notifies Procurement |
| `create_purchase_request` | `p_operation_id`, `p_project_id`, `p_payload` {required_by, preferred_supplier_id, budget_estimate_paise, notes, lines [{bom_line_id, quantity_milli}]} | `procurement.request.create` | Project in planning / installation; Gate 5 `procurement` open; Gate 6: only lines of the approved BOM, never more than the BOM quantity across open requests | `purchase_request.created` |
| `add_supplier_quote` | `p_request_id`, `p_payload` {supplier_id, net_paise, tax_paise, freight_paise, lead_time_days, warranty_months, technical_match, payment_terms, notes} | `procurement.po.create` | Active supplier organizations only | `purchase_request.quote_recorded` |
| `select_supplier` | `p_request_id`, `p_expected_version`, `p_quote_id`, `p_rationale` | `procurement.po.create` | Rationale required | `purchase_request.supplier_selected` |
| `cancel_purchase_request` | `p_request_id`, `p_expected_version`, `p_reason` | `procurement.request.create` | Frees the quantities | `purchase_request.cancelled` |
| `create_purchase_order` | `p_operation_id`, `p_request_id`, `p_payload` {lines [{request_line_id, rate_paise, tax_rate_bps}], freight_paise, delivery_from, delivery_to, delivery_location, payment_terms, terms} | `procurement.po.create` | Selected supplier; server totals (`app.compute_purchase_order` = domain `computePurchaseOrder`); flags `needs_approval` above rule `procurement.po_approval_limit` | `purchase_order.created`, `purchase_request.ordered` |
| `submit_purchase_order` | `p_po_id`, `p_expected_version` | `procurement.po.create` | Within the limit → approved; above → pending approval + approval request | `purchase_order.finalized` / `.approval_requested`; notifies `procurement.po.approve` |
| `decide_approval_request` | `p_request_id`, `p_decision` (approve / reject), `p_reason` | `procurement.po.approve` (PO) or `approval.exception.decide` (payment exception); never the requester | Reason for reject; an expired exception cannot be approved | `approval.decided`; notifies the requester |
| `issue_purchase_order` | `p_po_id`, `p_expected_version` | `procurement.po.create` | approved → issued | `purchase_order.issued` |
| `update_material_status` | `p_po_line_id`, `p_expected_version`, `p_action` (confirm / start_manufacturing / mark_ready / dispatch / mark_in_transit / mark_delivered) | `procurement.po.create` | Issued POs only; per-line material machine | `material.*` |
| `record_goods_receipt` | `p_operation_id`, `p_po_id`, `p_payload` {lines [{po_line_id, received_milli, damaged_milli, result, serial_batch, remarks}], notes} | `procurement.grn.record` | Delivered lines only; never more than ordered; only accepted, undamaged quantity counts; a remark for anything not accepted; the PO closes when every line is accepted | `material.received` / `accepted` / …, `purchase_order.closed` |

## Partner execution (Slice 5)

| RPC | Arguments | Who | Behaviour | Audit / notify |
|---|---|---|---|---|
| `save_partner_profile` | `p_org_id`, `p_expected_version`, `p_payload` {legal_name, entity_type, addresses, authorized_representative, contact_phone/email, gst_number, service_areas[], lift_categories[], team_size, experience_years, safety_policy_accepted, compliance_declaration} | partner admin (`partner.org.manage`) | Draft only | `partner.profile_saved` |
| `register_partner_document` | `p_operation_id`, `p_org_id`, `p_payload` {doc_type, doc_number, issuer, issued_on, expires_on, scope[], storage_path, sha256, mime_type, size_bytes} | partner admin | File must already be in the private `partner-documents` bucket under the org's folder; licence needs scope and expiry, insurance needs expiry | `partner_document.registered`; notifies `partner.verify` |
| `verify_partner_document` | `p_document_id`, `p_decision` (verify / reject), `p_reason` | AIEC `partner.verify` | One decision per document; documents are otherwise immutable | `partner_document.verified/rejected`; notifies the partner |
| `partner_action` | `p_org_id`, `p_expected_version`, `p_action`, `p_reason` | `submit`: partner admin (profile complete); the rest: AIEC per the partner machine | `approve` / `clear_compliance_hold` need every required document verified and in date | `partner.*`; notifies the other side |
| `partner_eligibility` | `p_org_id`, `p_lift_category` | AIEC overseers, the partner's own people | `{status, eligible, failures[{type, reason}]}` (= domain `partnerEligibleForAssignment`) | — |
| `record_site_readiness` | `p_project_id`, `p_items` [{key, result, note}] | `project.plan` | Append-only revisions; server computes pass / failures (= domain `evaluateSiteReadiness`) | `site_readiness.recorded` |
| `invite_partner` | `p_project_id`, `p_partner_org_id`, `p_payload` {scope_summary, schedule_from/to, contract_value_paise, payment_terms, material_responsibility, safety_requirements, exclusions} | `partner.assign` | Gate 7 for the project's lift category; one open invitation per project; stores the offer's SHA-256 | `assignment.invited`; notifies the partner |
| `assignment_action` | `p_assignment_id`, `p_expected_version`, `p_action`, `p_reason`, `p_offer_sha256` | partner admin: accept (hash must match; Gate 7 again) / decline / request_clarification; AIEC: reissue / withdraw / end | Acceptance creates the task list from `execution.task_template` | `assignment.*`; notifies the other side |
| `set_worker_profile` | `p_org_id`, `p_user_id`, `p_skills[]`, `p_training_note` | `partner.team.manage` | Active field members of the same partner only | `worker.skills_set` |
| `set_project_team_member` | `p_assignment_id`, `p_user_id`, `p_action` (add / remove), `p_reason` | `partner.team.manage` | Removal keeps history and needs the person's open tasks reassigned | `team.member_added/removed` |
| `assign_task` | `p_task_id`, `p_expected_version`, `p_assignee_id`, `p_due_date` | `partner.task.assign` | Project-team member with `task.execute` and the task's skill; reassignment before acceptance | `task.assigned/reassigned`; notifies the assignee |
| `accept_task`, `start_task` | `p_task_id`, `p_expected_version` | the assignee | Start: project in installation, no safety stop, today's passing pre-start, prerequisites submitted | `task.accepted`, `task.started` |
| `record_safety_check` | `p_operation_id`, `p_task_id`, `p_answers` {key: {applicable, confirmed}} | the assignee | Critical controls not confirmed → `can_start = false` (= domain `evaluateSafetyPreStart`) | `task.safety_check_recorded` |
| `save_task_progress` | `p_task_id`, `p_expected_version`, `p_answers` {key: {done, not_applicable_reason}}, `p_notes` | the assignee | While in progress | — |
| `register_task_evidence` | `p_operation_id`, `p_task_id`, `p_payload` {category, storage_path, sha256, mime_type, size_bytes, captured_at, latitude, longitude, accuracy_m, source, remarks} | the assignee | Private `execution-evidence` bucket; immutable; server receipt time kept separately | `task.evidence_registered` |
| `submit_task` | `p_task_id`, `p_expected_version` | the assignee | Gate 9: whole checklist + required photo categories | `task.submitted`; notifies supervisors |
| `report_incident` | `p_operation_id`, `p_task_id`, `p_category`, `p_description`, `p_client_reported_at` | the assignee or a supervisor | Blocks a task in progress; unsafe condition / injury set a safety stop (Gate 11) and notify AIEC Operations and the Owner as critical | `incident.reported` / `incident.safety_stop` |
| `resolve_incident` | `p_incident_id`, `p_resolution` | AIEC `project.plan` | The only way to lift a safety stop | `incident.resolved` / `incident.safety_stop_lifted` |
| `unblock_task` | `p_task_id`, `p_expected_version`, `p_reason` | `partner.task.assign` | Refused while a safety stop is active, and after one until the assignee records a new passing pre-start | `task.unblocked` |
| `submit_daily_report` | `p_operation_id`, `p_assignment_id`, `p_payload` {report_date, present_user_ids[], work_completed, work_not_completed, material_used, material_shortage, blockers, incident_declared, safety_observations, next_day_plan} | `partner.daily_report.submit` | One per day, immutable, people must be on the project team; a declared incident needs observations | `daily_report.submitted` (+ AIEC alert on incident) |
| `comment_daily_report` | `p_report_id`, `p_comment` | AIEC `project.plan` | Comments never rewrite the report | `daily_report.commented`; notifies the partner |
| `project_readiness` | `p_project_id` | anyone who can read the project | `{technical, site, payment, material, partner, documentation}` | — |
| `project_execution_action` | `p_project_id`, `p_expected_version`, `p_action` (mark_installation_ready / start_installation) | `project.plan` | Ready only with every dimension true (names the missing ones); start refused under a safety stop | `project.installation_ready/started`; notifies the partner |
| `staff_display_names` | `p_ids[]` | any active member | Names only: AIEC staff see AIEC and partner people; partner people see their own organization | — |

## Read access (RLS summary)

| Data | Visible to |
|---|---|
| Role / permission catalogue, state transitions | any signed-in user |
| Organizations | members; AIEC `user.read` / `org.manage` |
| Profiles, memberships, role grants | self; AIEC `user.read`; partner `user.read` for members of that partner org only |
| Audit log | AIEC `audit.read` |
| Business rules | `all_users` rules to active users; all rules to AIEC members |
| Leads, sites (via lead) | `lead.read_all`; the lead owner with `lead.read_assigned` |
| Lead activities, duplicate decisions | same as leads (surveyors and reviewers do not see sales history) |
| Surveys, revisions, measurements, evidence metadata, sites (via survey) | `survey.read_all`; the assigned surveyor; whoever can read the lead |
| Evidence files (storage) | same as the survey; uploads only by the assigned surveyor while `in_progress`; no update/delete |
| Notifications, sync operations | the recipient / the operation's user |

Slice 3 reads: technical records follow `technical.review` / `survey.read_all` in the organization, or the lead (sales owner, Owner); draft documents are technical-only. Quotations, lines (with internal cost), negotiations and acceptances follow the lead only: technical, field, partner and customer roles never see prices. Approval requests: approvers and the requester.

Slice 4 reads: a project (no money) is visible to Operations / Owner (`project.read_all`), Technical, Finance, Procurement and the lead's sales owner. Orders, milestones and payment claims (customer money) only to Operations / Owner, Finance and the lead's sales owner. Purchase requests, supplier quotes, POs and goods receipts (supplier prices) only to Procurement, Operations / Owner and Finance. Supplier organizations are readable by Procurement, Operations / Owner and Finance.

Slice 5 reads: a partner company's profile is visible to its members and to AIEC overseers (`partner.verify`, `partner.assign`, `project.read_all`); its compliance documents only to its admins and AIEC overseers. An invitation / assignment (with the partner's contract value) is visible to AIEC execution managers, Finance and the partner's admins / supervisors, never to technicians or Sales. Tasks, safety checks and evidence: AIEC execution managers, the partner's admins / supervisors and the assignee. Partner people see the project title, site and status of projects they are invited to or work on, never orders, milestones, quotations or supplier prices.

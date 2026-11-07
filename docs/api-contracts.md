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

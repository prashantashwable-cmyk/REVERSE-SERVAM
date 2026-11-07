# Requirements traceability matrix (§32.2)

Status legend: **Done** = UI (where applicable) + server validation + persistence + RLS/authorization + audit + automated tests. **Domain** = business rule implemented and unit-tested in `@aiec/domain` but not yet wired to database / UI. **Planned** = later slice.

Test IDs: `DB:<file> › <test>` (supabase/tests, real PostgreSQL + PostGIS), `UNIT:<file>` (packages/domain), `WEB:` / `MOB:` (app unit tests).

## Acceptance scenarios (§29)

| # | Scenario | Role | Screen / route | API / DB | Authorization | Audit event | Test | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | New lead created and assigned | Sales | SE02 `/leads/new` | `create_lead`, `assign_lead` | `lead.create`; RLS owner/read_all | `lead.created`, `lead.assigned` | DB:leads › sales creates a lead…; › assignment authority… | Done |
| 2 | Duplicate lead warning | Sales | SE03 (panel in `/leads/new`) | `search_possible_duplicates`, `DUPLICATE_REVIEW_REQUIRED` | masked candidates | `lead.created` (duplicates acknowledged) | DB:leads › possible duplicates must be reviewed… | Done |
| 3 | Sales schedules a survey | Sales | `/leads/[id]` Book a survey | `schedule_survey` | `survey.schedule` + lead in scope | `survey.scheduled` | DB:surveys › a survey can only be booked… | Done |
| 4 | Surveyor completes a survey offline | Surveyor | Mobile SV01–SV06 | SQLite drafts + `SyncQueue` → `save_survey_draft`, `submit_survey` | `survey.capture` + assigned | `survey.draft_saved`, `survey.submitted` | UNIT:gates-sync-errors › offline sync queue; DB:surveys › Gate 1…; MOB bundle build | Done (device test pending) |
| 5 | Survey evidence syncs without duplication | Surveyor | Mobile evidence | `register_evidence` (operation id) | storage RLS | `evidence.registered` | DB:surveys › offline replay of evidence registration… | Done |
| 6 | Incomplete survey cannot be submitted | Surveyor | Mobile review; server Gate 1 | `submit_survey` → `app.survey_submission_failures` | — | — | DB:surveys › Gate 1…; UNIT:survey-identity-duplicates › survey submission validation | Done |
| 7 | Technical Manager requests clarification | Technical | `/technical/reviews/[id]` (TE03) | `request_technical_clarification` (and `request_survey_revision`) | `technical.review` | `technical_review.clarification_requested` | DB:technical-quotation › clarification sends the survey back…; E2E | Done |
| 8 | Technical Manager approves feasibility | Technical | TE02 `/technical/reviews/[id]` | `decide_technical_review`, `approve_configuration`, `decide_document_revision` | `technical.review`, `technical.configuration.approve`, `technical.drawing.approve` | `technical_review.decided`, `configuration.approved`, `document.approved` | DB:technical-quotation › decisions…, configuration…, documents…; E2E s3-tech-* | Done |
| 9 | Sales creates quotation | Sales | SE08 `/quotations/[id]` | `create_quotation`, `save_quotation_draft` | `quotation.create` | `quotation.created`, `quotation.draft_saved` | DB:technical-quotation › server totals equal the domain engine…; DB:parity › quotation economics; E2E | Done |
| 10 | Unauthorized discount is blocked | Sales | SE08 | `submit_quotation` (server evaluates `quotation.discount_policy`) | — | `quotation.approval_requested` | DB:technical-quotation › a discount beyond authority goes to the Owner…; E2E | Done |
| 11 | Owner approves an exception | Owner | O04 `/approvals` | `decide_quotation_approval` | `quotation.discount.approve` | `approval.decided`, `quotation.approved` | DB:technical-quotation › segregation of duties…; E2E s3-owner-approval-center | Done |
| 12 | Customer accepts a specific quotation revision | Sales (records) / Customer (portal later) | SE09 response form | `issue_quotation`, `record_customer_response` (content hash) | `quotation.issue` (`customer.approval.decide` reserved for CU04) | `quotation.issued`, `quotation.accepted` | DB:technical-quotation › acceptance binds to the exact issued revision; E2E s3-sales-quotation-accepted | Done (staff-recorded, D-023); portal: Planned |
| 13 | Order created with contract reference | Sales | SE11 | — | `order.convert` | `order.confirmed` | UNIT:machines (order) | Domain |
| 14 | Unverified payment does not unlock a gate | Finance | FN02 | — | — | — | UNIT:money-commercial › claimed or screenshot payments never unlock a gate | Domain |
| 15 | Verified payment updates the correct ledger | Finance | FN03 | — | `finance.payment.verify` | `payment.verified` | UNIT:money-commercial › verified payment unlocks; partial does not | Domain |
| 16 | Procurement cannot substitute unapproved component | Procurement | PR06 | — | `technical.change.approve` | — | role matrix (procurement lacks the permission) | Domain |
| 17 | Expired partner documentation blocks assignment | Ops | OM04 | — | — | — | UNIT:gates-sync-errors › Gate 7 partner eligibility | Domain |
| 18 | Partner A cannot view Partner B | Partner | — | RLS | tenant scope | — | DB:identity › tenant isolation… ; › partner admins administer only their own tenant… | Done (people/org data); project data: Planned (Slice 5) |
| 19 | Partner assigns an authorized team member | Partner admin | LP07 | `admin_add_member`, `admin_grant_role` (field roles only) | `partner.team.manage` | `membership.added`, `role.granted` | DB fixture (global-setup) + DB:identity › partner admins administer… | Done (enrolment); task assignment: Planned |
| 20 | Technician cannot access another partner's task | Technician | — | — | — | — | DB:identity › tenant isolation (technician sees only self) | Planned (tasks) |
| 21 | Technician submits evidence offline | Technician | WT04 | queue shared with surveyor | — | — | UNIT:gates-sync-errors › offline sync queue | Domain |
| 22 | Repeated sync creates no duplicates | Field | — | `sync_operations` | — | — | DB:leads › a repeated operation id replays…; DB:surveys › offline replay… | Done |
| 23 | QA fails a task with a defect | QA | QA04 | — | `qa.inspection.decide` | `task.qa_failed` | UNIT:machines › QA failure requires a defect… | Domain |
| 24 | Partner submits rework evidence | Partner | WT06 | — | `task.execute` | `task.resubmitted` | UNIT:machines (task resubmit) | Domain |
| 25 | QA reinspects and closes the defect | QA | QA05 | — | `qa.defect.manage` | `defect.closed` | UNIT:machines › defect closes only with correction evidence | Domain |
| 26 | Technician cannot approve own work | Technician | — | — | SoD | — | UNIT:machines › technician cannot approve own work | Domain |
| 27 | Safety-critical failure blocks progression | Technician | WT03 | — | none can override | — | UNIT:machines › critical safety failure blocks start…; UNIT:gates-sync-errors › critical safety failure disables start | Domain |
| 28 | Operations cannot override technical approval | Ops | OM02 | — | — | — | UNIT:machines › operations cannot bypass technical / payment / partner gates | Domain |
| 29 | Partner cannot edit AIEC commercial terms | Partner | — | SELECT-only grants | — | — | DB:identity › clients cannot write tables directly…; role matrix | Done (no client writes) |
| 30 | Customer cannot view internal margin | Customer | — | RLS | — | — | DB:leads › lead visibility (customer sees none); DB:surveys › customer sees no evidence | Done for slices 1–2 |
| 31 | Customer can view verified receipts | Customer | CU05 | — | — | — | — | Planned (Slice 4) |
| 32 | Handover cannot complete without documents | Ops | OM08 | — | — | — | UNIT:machines (project complete_handover), UNIT:gates (handover documents) | Domain |
| 33 | Internal QA does not imply statutory permission | QA | QA06 | — | — | — | UNIT:machines › internal QA never implies statutory permission | Domain |
| 34 | Warranty activates from the contractual event | Ops | — | — | — | `warranty.activated` | UNIT:gates-sync-errors › handover documents and warranty dates | Domain |
| 35 | Every sensitive action appears in audit history | All | `/audit` | `app.audit` (append-only) | `audit.read` | all of the above | DB:identity › audit log is append-only…; DB:leads, DB:surveys (audit trail assertions) | Done for slices 1–2 |

## Additional requirements covered in slices 1–2

| Req | Rule | Where | Test | Status |
|---|---|---|---|---|
| §4.1 | Mobile OTP; staff email; pending / suspended states; demo labelled | `/login`, mobile `LoginScreen`, `(app)/layout` | DB:identity › pending accounts…, › suspension…; web smoke test | Done |
| §4.5 | Immutable, never-reused business IDs per entity | `app.next_business_id` | DB:leads › sales creates a lead…; DB:surveys (SV number); UNIT business identifiers | Done |
| §7.6 | Every active lead has a next action or a documented reason | `record_lead_activity` + table check | DB:leads › activities… | Done |
| §8.4 / §38 SV02 | GPS never fabricated; exception + review | `check_in_survey`, `review_gps_exception` | DB:surveys › GPS is classified by the server… | Done |
| §8.7 | Submitted survey versions immutable; corrections create revisions | triggers + `request_survey_revision` | DB:surveys › Gate 1… | Done |
| §34.1 | Measurements store unit; entered value preserved | `survey_measurements` | DB:surveys › drafts autosave… | Done |
| §46.3 | Revoked access effective on next request | permission helpers read live state | DB:identity › role revocation…, › suspension… | Done |
| §51 | Private storage, path binding, short-lived links, immutable evidence | storage policies, `register_evidence`, web signed URLs | DB:surveys › evidence… | Done |
| §52.3 | No last-write-wins on drafts | revision version check | DB:surveys › drafts autosave…; UNIT detectConflict | Done |
| §55 | Structured error codes, no SQL leakage | `app.raise_error`, `fromServerError` | UNIT:gates-sync-errors › maps server errors…; WEB:actions | Done |
| §58 | Translation keys, INR / IST formatting, text + colour status | `@aiec/domain` i18n, badges/chips | UNIT money & i18n | Done: Marathi (default) + English; `npm run check:i18n` blocks untranslated text |

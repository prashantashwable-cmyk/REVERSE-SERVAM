# State machines (Deliverable D)

> Generated from `packages/domain/src` by `npm run docs:generate --workspace @aiec/domain`. Do not edit by hand.

Each entity has its own machine; there is no global status. Status changes only through a named action. The `lead` and `survey` machines are also seeded into `public.state_transitions` and enforced by the database (parity is tested).

## lead

States: `new`, `assigned`, `contacted`, `qualified`, `won`, `lost`, `invalid`. Initial: `new`. Terminal: `won`, `invalid`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `new` | `assign` | `assigned` | `lead.assign` |  | ✓ | `lead.assigned` |
| `assigned` | `reassign` | `assigned` | `lead.assign` | ✓ | ✓ | `lead.reassigned` |
| `contacted` | `reassign` | `contacted` | `lead.assign` | ✓ | ✓ | `lead.reassigned` |
| `qualified` | `reassign` | `qualified` | `lead.assign` | ✓ | ✓ | `lead.reassigned` |
| `assigned` | `record_contact` | `contacted` | `lead.activity.record` |  | ✓ | `lead.contacted` |
| `contacted`, `qualified` | `qualify` | `qualified` | `lead.qualify` |  | ✓ | `lead.qualified` |
| `new`, `assigned`, `contacted`, `qualified` | `close_lost` | `lost` | `lead.close` | ✓ | ✓ | `lead.closed_lost` |
| `new`, `assigned`, `contacted` | `mark_invalid` | `invalid` | `lead.close` | ✓ |  | `lead.marked_invalid` |
| `qualified` | `mark_won` | `won` | `order.convert` |  | ✓ | `lead.won` |
| `lost` | `reopen` | `assigned` | `lead.assign` | ✓ | ✓ | `lead.reopened` |

## survey

States: `scheduled`, `accepted`, `reschedule_requested`, `in_progress`, `revisit_requested`, `site_inaccessible`, `submitted`, `revision_requested`, `under_review`, `reviewed`, `cancelled`. Initial: `scheduled`. Terminal: `reviewed`, `cancelled`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `scheduled` | `accept` | `accepted` | `survey.capture` |  |  | `survey.accepted` |
| `scheduled`, `accepted` | `request_reschedule` | `reschedule_requested` | `survey.capture` | ✓ |  | `survey.reschedule_requested` |
| `scheduled`, `accepted`, `reschedule_requested`, `site_inaccessible`, `revisit_requested`, `revision_requested` | `reschedule` | `scheduled` | `survey.schedule` |  | ✓ | `survey.rescheduled` |
| `scheduled`, `accepted`, `reschedule_requested`, `in_progress`, `site_inaccessible`, `revisit_requested` | `cancel` | `cancelled` | `survey.schedule` | ✓ |  | `survey.cancelled` |
| `accepted` | `check_in` | `in_progress` | `survey.capture` |  | ✓ | `survey.checked_in` |
| `in_progress` | `save_draft` | `in_progress` | `survey.capture` |  |  | `survey.draft_saved` |
| `accepted`, `in_progress` | `report_inaccessible` | `site_inaccessible` | `survey.capture` | ✓ |  | `survey.site_inaccessible` |
| `in_progress` | `request_revisit` | `revisit_requested` | `survey.capture` | ✓ |  | `survey.revisit_requested` |
| `in_progress` | `submit` | `submitted` | `survey.capture` |  | ✓ | `survey.submitted` |
| `submitted`, `under_review` | `request_revision` | `revision_requested` | `survey.review` | ✓ |  | `survey.revision_requested` |
| `revision_requested` | `start_revision` | `in_progress` | `survey.capture` |  |  | `survey.revision_started` |
| `submitted` | `start_review` | `under_review` | `technical.review` |  |  | `survey.review_started` |
| `under_review` | `complete_review` | `reviewed` | `technical.review` |  |  | `survey.review_completed` |

## technical_review

States: `open`, `in_review`, `clarification_requested`, `feasible`, `conditionally_feasible`, `not_feasible`, `insufficient_information`. Initial: `open`. Terminal: `feasible`, `conditionally_feasible`, `not_feasible`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `open` | `start` | `in_review` | `technical.review` |  |  | `technical_review.started` |
| `in_review` | `request_clarification` | `clarification_requested` | `technical.review` | ✓ |  | `technical_review.clarification_requested` |
| `clarification_requested`, `insufficient_information` | `resume` | `in_review` | `technical.review` |  |  | `technical_review.resumed` |
| `in_review` | `decide_feasible` | `feasible` | `technical.review` |  | ✓ | `technical_review.decided` |
| `in_review` | `decide_conditional` | `conditionally_feasible` | `technical.review` |  | ✓ | `technical_review.decided` |
| `in_review` | `decide_not_feasible` | `not_feasible` | `technical.review` | ✓ | ✓ | `technical_review.decided` |
| `in_review` | `decide_insufficient` | `insufficient_information` | `technical.review` | ✓ | ✓ | `technical_review.decided` |

## quotation

States: `draft`, `pending_approval`, `approved`, `issued`, `accepted`, `rejected_by_customer`, `superseded`, `expired`. Initial: `draft`. Terminal: `accepted`, `rejected_by_customer`, `superseded`, `expired`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `draft` | `finalize` | `approved` | `quotation.create` |  | ✓ | `quotation.finalized` |
| `draft` | `request_approval` | `pending_approval` | `quotation.create` |  | ✓ | `quotation.approval_requested` |
| `pending_approval` | `approve` | `approved` | `quotation.discount.approve` |  | ✓ | `quotation.approved` |
| `pending_approval` | `return_to_draft` | `draft` | `quotation.discount.approve` | ✓ |  | `quotation.approval_rejected` |
| `approved` | `issue` | `issued` | `quotation.issue` |  | ✓ | `quotation.issued` |
| `issued` | `accept` | `accepted` | `customer.approval.decide` |  | ✓ | `quotation.accepted` |
| `issued` | `record_customer_rejection` | `rejected_by_customer` | `quotation.issue` | ✓ |  | `quotation.rejected_by_customer` |
| `draft`, `pending_approval`, `approved`, `issued` | `supersede` | `superseded` | `quotation.create` |  |  | `quotation.superseded` |
| `issued` | `expire` | `expired` | `quotation.issue` |  |  | `quotation.expired` |

## order

States: `pending_confirmation`, `confirmed`, `completed`, `cancelled`. Initial: `pending_confirmation`. Terminal: `completed`, `cancelled`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `pending_confirmation` | `confirm` | `confirmed` | `order.convert` |  | ✓ | `order.confirmed` |
| `pending_confirmation`, `confirmed` | `cancel` | `cancelled` | `approval.exception.decide` | ✓ |  | `order.cancelled` |
| `confirmed` | `complete` | `completed` | `project.plan` |  | ✓ | `order.completed` |

## project

States: `created`, `planning`, `installation_ready`, `installation`, `final_qa`, `statutory_pending`, `handover_ready`, `handed_over`, `closed`, `on_hold`, `cancelled`. Initial: `created`. Terminal: `closed`, `cancelled`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `created` | `start_planning` | `planning` | `project.plan` |  |  | `project.planning_started` |
| `planning` | `mark_installation_ready` | `installation_ready` | `project.plan` |  | ✓ | `project.installation_ready` |
| `installation_ready` | `start_installation` | `installation` | `project.plan` |  | ✓ | `project.installation_started` |
| `installation` | `submit_final_qa` | `final_qa` | `project.plan` |  | ✓ | `project.final_qa_requested` |
| `final_qa` | `pass_final_qa` | `statutory_pending` | `qa.inspection.decide` |  | ✓ | `project.final_qa_passed` |
| `final_qa` | `fail_final_qa` | `installation` | `qa.inspection.decide` | ✓ |  | `project.final_qa_failed` |
| `statutory_pending` | `record_statutory_clearance` | `handover_ready` | `project.plan` |  | ✓ | `project.statutory_evidence_recorded` |
| `handover_ready` | `complete_handover` | `handed_over` | `project.plan` |  | ✓ | `project.handed_over` |
| `handed_over` | `close` | `closed` | `project.plan` |  | ✓ | `project.closed` |
| `planning`, `installation_ready`, `installation`, `final_qa` | `hold` | `on_hold` | `project.plan` | ✓ |  | `project.held` |
| `on_hold` | `resume` | `planning` | `project.plan` | ✓ |  | `project.resumed` |
| `created`, `planning`, `installation_ready`, `on_hold` | `cancel` | `cancelled` | `approval.exception.decide` | ✓ |  | `project.cancelled` |

## task

States: `draft`, `assigned`, `accepted`, `in_progress`, `blocked`, `submitted`, `approved`, `rework`, `closed`. Initial: `draft`. Terminal: `closed`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `draft` | `assign` | `assigned` | `partner.task.assign` |  | ✓ | `task.assigned` |
| `assigned` | `accept` | `accepted` | `task.execute` |  | ✓ | `task.accepted` |
| `accepted` | `start` | `in_progress` | `task.execute` |  | ✓ | `task.started` |
| `in_progress` | `block` | `blocked` | `task.execute` | ✓ |  | `task.blocked` |
| `blocked` | `unblock` | `in_progress` | `partner.task.assign` | ✓ | ✓ | `task.unblocked` |
| `in_progress` | `submit` | `submitted` | `task.execute` |  | ✓ | `task.submitted` |
| `submitted` | `qa_pass` | `approved` | `qa.inspection.decide` |  | ✓ | `task.qa_passed` |
| `submitted` | `qa_fail` | `rework` | `qa.inspection.decide` |  | ✓ | `task.qa_failed` |
| `rework` | `resubmit` | `submitted` | `task.execute` |  | ✓ | `task.resubmitted` |
| `approved` | `close` | `closed` | `project.plan` |  |  | `task.closed` |

## payment

States: `claimed`, `pending_clarification`, `partially_verified`, `verified`, `rejected`. Initial: `claimed`. Terminal: `verified`, `rejected`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `claimed`, `partially_verified` | `verify` | `verified` | `finance.payment.verify` |  | ✓ | `payment.verified` |
| `claimed` | `verify_partially` | `partially_verified` | `finance.payment.verify` | ✓ | ✓ | `payment.partially_verified` |
| `claimed` | `request_clarification` | `pending_clarification` | `finance.payment.verify` | ✓ |  | `payment.clarification_requested` |
| `pending_clarification` | `resubmit` | `claimed` | `customer.approval.decide` |  |  | `payment.resubmitted` |
| `claimed`, `pending_clarification` | `reject` | `rejected` | `finance.payment.verify` | ✓ |  | `payment.rejected` |

## material_line

States: `ordered`, `confirmed`, `manufacturing`, `ready`, `dispatched`, `in_transit`, `delivered`, `received`, `inspected`, `accepted`, `quarantined`, `rejected`. Initial: `ordered`. Terminal: `accepted`, `rejected`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `ordered` | `confirm` | `confirmed` | `procurement.po.create` |  |  | `material.confirmed` |
| `confirmed` | `start_manufacturing` | `manufacturing` | `procurement.po.create` |  |  | `material.manufacturing` |
| `confirmed`, `manufacturing` | `mark_ready` | `ready` | `procurement.po.create` |  |  | `material.ready` |
| `ready` | `dispatch` | `dispatched` | `procurement.po.create` |  |  | `material.dispatched` |
| `dispatched` | `mark_in_transit` | `in_transit` | `procurement.po.create` |  |  | `material.in_transit` |
| `dispatched`, `in_transit` | `mark_delivered` | `delivered` | `procurement.po.create` |  |  | `material.delivered` |
| `delivered` | `receive` | `received` | `procurement.grn.record` |  | ✓ | `material.received` |
| `received` | `inspect` | `inspected` | `procurement.grn.record` |  |  | `material.inspected` |
| `inspected`, `quarantined` | `accept` | `accepted` | `procurement.grn.record` |  |  | `material.accepted` |
| `inspected` | `quarantine` | `quarantined` | `procurement.grn.record` | ✓ |  | `material.quarantined` |
| `inspected`, `quarantined` | `reject` | `rejected` | `procurement.grn.record` | ✓ |  | `material.rejected` |

## partner

States: `draft`, `submitted`, `verification_pending`, `approved`, `conditional_approval`, `suspended`, `compliance_hold`, `rejected`, `inactive`. Initial: `draft`. Terminal: `rejected`, `inactive`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `draft` | `submit` | `submitted` | `partner.org.manage` |  |  | `partner.submitted` |
| `submitted` | `start_verification` | `verification_pending` | `partner.verify` |  |  | `partner.verification_started` |
| `verification_pending` | `approve` | `approved` | `partner.verify` |  | ✓ | `partner.approved` |
| `verification_pending` | `approve_conditionally` | `conditional_approval` | `partner.verify` | ✓ |  | `partner.conditionally_approved` |
| `verification_pending` | `return_for_correction` | `draft` | `partner.verify` | ✓ |  | `partner.returned` |
| `verification_pending` | `reject` | `rejected` | `partner.verify` | ✓ |  | `partner.rejected` |
| `approved`, `conditional_approval` | `place_compliance_hold` | `compliance_hold` | `partner.verify` | ✓ |  | `partner.compliance_hold` |
| `compliance_hold` | `clear_compliance_hold` | `approved` | `partner.verify` |  | ✓ | `partner.compliance_cleared` |
| `approved`, `conditional_approval`, `compliance_hold` | `suspend` | `suspended` | `approval.exception.decide` | ✓ |  | `partner.suspended` |
| `suspended` | `reinstate` | `verification_pending` | `approval.exception.decide` | ✓ |  | `partner.reinstated` |
| `approved`, `conditional_approval`, `suspended`, `compliance_hold` | `deactivate` | `inactive` | `approval.exception.decide` | ✓ |  | `partner.deactivated` |

## defect

States: `open`, `assigned`, `acknowledged`, `correction_in_progress`, `submitted_for_reinspection`, `verified`, `closed`, `disputed`. Initial: `open`. Terminal: `closed`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `open` | `assign` | `assigned` | `qa.defect.manage` |  | ✓ | `defect.assigned` |
| `assigned` | `acknowledge` | `acknowledged` | `partner.task.assign` |  |  | `defect.acknowledged` |
| `assigned`, `acknowledged` | `dispute` | `disputed` | `partner.task.assign` | ✓ |  | `defect.disputed` |
| `disputed` | `resolve_dispute` | `assigned` | `qa.defect.manage` | ✓ |  | `defect.dispute_resolved` |
| `acknowledged` | `start_correction` | `correction_in_progress` | `task.execute` |  |  | `defect.correction_started` |
| `correction_in_progress` | `submit_correction` | `submitted_for_reinspection` | `task.execute` |  | ✓ | `defect.correction_submitted` |
| `submitted_for_reinspection` | `reject_correction` | `correction_in_progress` | `qa.defect.manage` | ✓ |  | `defect.not_corrected` |
| `submitted_for_reinspection` | `verify` | `verified` | `qa.defect.manage` |  | ✓ | `defect.verified` |
| `verified` | `close` | `closed` | `qa.defect.manage` |  | ✓ | `defect.closed` |

## handover

States: `not_ready`, `ready`, `issues_raised`, `accepted`. Initial: `not_ready`. Terminal: `accepted`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `not_ready` | `confirm_ready` | `ready` | `project.plan` |  | ✓ | `handover.ready` |
| `ready` | `customer_accept` | `accepted` | `customer.approval.decide` |  |  | `handover.accepted` |
| `ready` | `customer_raise_issue` | `issues_raised` | `customer.approval.decide` | ✓ |  | `handover.issues_raised` |
| `issues_raised` | `recheck` | `not_ready` | `project.plan` |  |  | `handover.rechecked` |

## warranty

States: `pending`, `active`, `expired`, `voided`. Initial: `pending`. Terminal: `expired`, `voided`.

| From | Action | To | Permission | Reason required | Guarded | Audit event |
|---|---|---|---|:-:|:-:|---|
| `pending` | `activate` | `active` | `project.plan` |  | ✓ | `warranty.activated` |
| `active` | `expire` | `expired` | `project.plan` |  |  | `warranty.expired` |
| `pending`, `active` | `void` | `voided` | `approval.exception.decide` | ✓ |  | `warranty.voided` |


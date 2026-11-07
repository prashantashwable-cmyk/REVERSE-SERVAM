# Permission matrix (Deliverable E)

> Generated from `packages/domain/src` by `npm run docs:generate --workspace @aiec/domain`. Do not edit by hand.

Permissions are `resource.action`. Resource scope (own assignment, own tenant, own lead) is enforced in Postgres RLS and RPCs; see `docs/api-contracts.md`.

## Roles and allowed organization kinds

| Role | Organization kinds |
|---|---|
| Owner / Super Admin (`owner`) | aiec |
| Operations Manager (`operations_manager`) | aiec |
| Sales Executive (`sales_executive`) | aiec |
| Surveyor (`surveyor`) | aiec |
| Technical Manager (`technical_manager`) | aiec |
| Accounts & Finance (`accounts_finance`) | aiec |
| Procurement Manager (`procurement_manager`) | aiec |
| Partner Company Admin (`partner_admin`) | partner |
| Partner Team Leader (`partner_supervisor`) | partner |
| Technician (`technician`) | partner |
| QA Inspector (`qa_inspector`) | aiec, qa_agency |
| Customer / Builder (`customer`) | customer |

## Matrix

| Permission | Description | `owner` | `operations_manager` | `sales_executive` | `surveyor` | `technical_manager` | `accounts_finance` | `procurement_manager` | `partner_admin` | `partner_supervisor` | `technician` | `qa_inspector` | `customer` |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `user.read` | View user profiles within permitted organizations | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |  |
| `user.manage` | Activate, suspend and verify users | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `role.assign` | Grant and revoke role assignments | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `org.manage` | Create and manage organizations | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `rules.manage` | Change business rules and approval limits | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `audit.read` | Read the audit log | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `approval.exception.decide` | Decide authorized workflow exceptions | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `lead.create` | Create leads |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `lead.read_all` | Read all leads in the organization | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `lead.read_assigned` | Read leads assigned to me |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `lead.update_assigned` | Update leads assigned to me |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `lead.assign` | Assign / reassign / reopen leads | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `lead.activity.record` | Record lead activities and follow-ups |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `lead.qualify` | Qualify leads |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `lead.close` | Close leads as lost or invalid |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `lead.merge` | Decide duplicate merges | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `survey.schedule` | Book, reschedule and cancel surveys |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `survey.read_all` | Read all surveys | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |  |
| `survey.read_assigned` | Read surveys assigned to me |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `survey.capture` | Perform assigned surveys (check-in, capture, submit) |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `survey.review` | Review submitted surveys and request revisions |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| `survey.gps_exception.review` | Review GPS / check-in exceptions |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| `technical.review` | Record technical feasibility decisions |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| `technical.configuration.approve` | Approve lift configuration revisions |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| `technical.drawing.approve` | Approve drawing / BOM revisions |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| `technical.change.approve` | Approve technical change and substitution requests |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| `quotation.create` | Prepare quotation drafts |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `quotation.issue` | Issue approved quotation revisions to customers |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `quotation.discount.approve` | Approve discounts beyond sales authority | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `order.convert` | Convert an accepted quotation to an order |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| `project.read_all` | Read all projects | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `project.plan` | Plan projects, readiness and schedules |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `partner.assign` | Assign partner companies to projects |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `partner.verify` | Verify partner companies and compliance documents | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `finance.payment.verify` | Verify customer payment claims |  |  |  |  |  | ✓ |  |  |  |  |  |  |
| `finance.payout.prepare` | Prepare partner / supplier payouts |  |  |  |  |  | ✓ |  |  |  |  |  |  |
| `finance.payout.release` | Approve and release payouts | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `finance.ledger.read` | Read financial ledgers | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  |
| `finance.expense.approve` | Approve expenses |  |  |  |  |  | ✓ |  |  |  |  |  |  |
| `procurement.request.create` | Create purchase requests against approved BOM |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `procurement.po.create` | Create purchase orders |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `procurement.po.approve` | Approve purchase orders | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `procurement.grn.record` | Record goods receipts |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `partner.org.manage` | Manage own partner company profile |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `partner.project.read` | Read projects assigned to own partner company |  |  |  |  |  |  |  | ✓ | ✓ |  |  |  |
| `partner.team.manage` | Manage own partner workforce |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `partner.task.assign` | Assign partner tasks to own team members |  |  |  |  |  |  |  | ✓ | ✓ |  |  |  |
| `partner.daily_report.submit` | Submit daily work reports |  |  |  |  |  |  |  | ✓ | ✓ |  |  |  |
| `partner.claim.submit` | Submit partner milestone payment claims |  |  |  |  |  |  |  | ✓ |  |  |  |  |
| `task.execute` | Execute assigned tasks and capture evidence |  |  |  |  |  |  |  |  |  | ✓ |  |  |
| `qa.inspection.decide` | Decide assigned inspections |  |  |  |  |  |  |  |  |  |  | ✓ |  |
| `qa.defect.manage` | Create, verify and close defects |  |  |  |  |  |  |  |  |  |  | ✓ |  |
| `customer.project.read` | Read own projects |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| `customer.approval.decide` | Approve exact document / quotation revisions |  |  |  |  |  |  |  |  |  |  |  | ✓ |

## Segregation of duties (enforced in code)

- Discount requester ≠ approver (`quotationMachine.approve`, `SELF_APPROVAL_FORBIDDEN`).
- Payment claim submitter ≠ verifier; verification requires a bank / gateway match (`paymentMachine`).
- Payout preparation (`finance.payout.prepare`) and release (`finance.payout.release`) are held by different roles (unit-tested).
- Worker ≠ QA inspector; partner internal QA is never independent QA (`taskMachine.qa_pass`).
- GPS exception reviewer ≠ the surveyor (`review_gps_exception`).
- Nobody changes their own account status; the last active Owner cannot be removed, demoted or suspended.
- Audit log, lead activities, duplicate decisions, business-rule versions, submitted survey revisions and evidence are append-only / immutable (database triggers).

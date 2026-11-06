# AIEC ELEVATOR INSTALLATION OS — MASTER IMPLEMENTATION PROMPT

**Version:** 2.0 — Deep Implementation Edition  
**Supersedes:** Version 1.0 where more detailed rules are provided  
**Business:** ALL INDIA ELEVATORS COMPANY (AIEC)  
**Operating Model:** AIEC Control + Licensed Partner Company Execution  
**Target Platforms:** Android (React Native + Expo), Admin Web (Next.js), Supabase/PostgreSQL  
**Initial Geography:** Pune and PCMC, Maharashtra  

## How to use this file
Give this complete file to your coding agent as the product specification. First instruct it to audit the existing repository and produce a gap analysis. Do not ask it to generate every screen in one pass. Implement the product in vertical slices and require tests, authorization, audit events and offline behavior for each slice. This document is a business, UX and engineering specification; technical and statutory acceptance criteria must be validated by qualified professionals before production use.

## Document map
- Sections 1–31: Business model, baseline role architecture, modules, technology, security and delivery requirements.
- Sections 32–65: Expanded implementation detail, exact screen contracts, role-specific screen behavior, state machines, financial rules, evidence, offline sync, API design, testing and Definition of Done.

---

# 1. MASTER INSTRUCTION TO THE AI / DEVELOPMENT TEAM

Act as a cross-functional product engineering team consisting of:

-   Senior Product Manager for B2B field-service and project-management
    platforms.
-   Elevator installation domain analyst familiar with new elevator
    projects in India.
-   UX Architect and mobile-first interaction designer.
-   React Native + Expo lead engineer.
-   Next.js web application lead engineer.
-   Supabase / PostgreSQL / PostGIS architect.
-   Security and RBAC engineer.
-   QA automation engineer.
-   Indian commercial operations and compliance analyst.

Your assignment is to design and implement a complete, role-based
Elevator Installation Business Operating System for ALL INDIA ELEVATORS
COMPANY (AIEC).

Do not create a generic CRM, generic task manager, generic contractor
marketplace, or a collection of disconnected dashboards. Build one
connected business operating system in which a project moves through
controlled, auditable stages from enquiry to survey, technical
feasibility, quotation, order, procurement, installation, independent
QA, applicable statutory inspection, handover, warranty and AMC.

The product must be mobile-first, practical for Indian field conditions,
usable on Android devices, reliable under intermittent internet
connectivity, and simple enough for field workers while giving
management strong operational and financial control.

The system must be designed around the following principle:

**One Project Record → Multiple Role-Specific Workspaces → Controlled
Workflow Transitions → Complete Evidence and Audit Trail.**

Do not assume that hiding a button in the UI is security. Enforce all
access and business rules on the server and database layer.

Do not invent legal permissions, lift licences, technical limits,
statutory approvals, engineering calculations or safety acceptance
criteria. Make compliance rules configurable and require validation by
qualified professionals and the relevant Maharashtra authority before
production use.

------------------------------------------------------------------------

# 2. BUSINESS MODEL AND OPERATING PRINCIPLES

## 2.1 AIEC operating model

AIEC operates as the central customer-facing and project-governance
organization. It coordinates customers, builders, manufacturers,
suppliers, licensed partner companies, field technicians, QA resources
and relevant inspection processes.

AIEC's system responsibilities include:

-   Lead acquisition and customer relationship management.
-   Lead ownership and duplicate prevention.
-   Site survey scheduling and completeness control.
-   Technical review coordination and approval records.
-   Commercial quotation, discount governance and contract records.
-   Customer payment milestones and receivable tracking.
-   Project creation and project-level governance.
-   Manufacturer and supplier coordination.
-   Licensed partner onboarding and assignment.
-   Project schedule and milestone monitoring.
-   Evidence collection and auditability.
-   Independent QA governance.
-   Applicable statutory documentation and inspection tracking.
-   Customer communication, handover and warranty records.
-   Project profitability and management reporting.

Licensed Partner Companies execute the agreed installation scope under
their own verified capability, applicable authorizations and contract
terms. Technicians are managed within the Partner Company's workforce
structure, subject to applicable law and actual working arrangements.

Do not represent the model as "zero liability". Design controls that
reduce, document and manage risk, but do not imply that software, a
contractor label or an indemnity clause eliminates statutory or
contractual responsibilities.

## 2.2 Initial operating assumptions

Use these as configurable launch assumptions, not hard-coded
limitations:

-   Initial geography: Pune and Pimpri-Chinchwad (PCMC).
-   Initial concurrent project planning capacity: 5 projects.
-   Initial project type: new elevator installation.
-   Typical early project examples may include low-rise residential
    buildings such as G+4, but the system must not assume all projects
    are G+4.
-   Standard and complex projects must have different technical reviews
    and schedules.
-   A 14-day installation target may be displayed only for projects that
    meet defined technical eligibility, site readiness, material
    availability, approvals and manpower conditions. Never promise
    14-day completion universally.
-   Customer pricing must be controlled through Sales and authorized
    approvals. Do not create a binding instant self-priced configurator.
-   Any public-facing price range must be clearly labelled indicative
    and non-binding.
-   No project should progress through a gated stage without required
    evidence and approvals, except through a documented, authorized
    exception.

## 2.3 Core product principles

1.  Mobile-first, responsive and accessible.
2.  Role-specific navigation and information density.
3.  One source of truth for every project.
4.  Server-enforced RBAC and project-level access.
5.  Partner-company tenant isolation.
6.  Customer data isolation.
7.  Append-only audit history for important business events.
8.  Evidence-based work completion.
9.  Offline-first field workflows with safe synchronization.
10. Explicit approval gates and exception handling.
11. No silent edits to approved technical or commercial records.
12. Financial segregation of duties.
13. Independent QA decisions.
14. Configurable business rules rather than hard-coded assumptions.
15. Clear error, loading, empty, offline and permission-denied states.

------------------------------------------------------------------------

# 3. ROLE AND ORGANIZATION ARCHITECTURE

Build the following role model:

1.  Owner / Super Admin.
2.  Operations Manager.
3.  Sales Executive.
4.  Surveyor.
5.  Technical Manager / Engineering.
6.  Accounts & Finance.
7.  Procurement Manager.
8.  Licensed Partner Company Admin.
9.  Partner Team Leader / Supervisor.
10. Technician / Field Worker.
11. QA Inspector.
12. Customer / Builder.
13. Future optional roles: Service / AMC Manager, Statutory Compliance
    Coordinator, Customer Relationship Manager.

The first release may combine some internal roles for a small team, but
permissions must remain separately configurable. A single person may
hold multiple roles only through explicit role assignment. The system
must record which role and permission context was used for each
sensitive action.

## 3.1 Organization hierarchy

Model:

-   AIEC organization.
-   AIEC internal users.
-   Partner companies as separate organizations / tenants.
-   Partner company administrators.
-   Partner supervisors / team leaders.
-   Partner technicians.
-   Customers.
-   Builder organizations and their authorized contacts.
-   Suppliers / manufacturers.
-   Independent QA users.
-   External statutory authority records as external entities, not
    assumed system users.

A Partner Company must never access another Partner Company's private
projects, workers, commercial terms, documents or ledger.

A customer must only access projects explicitly associated with that
customer or builder organization.

------------------------------------------------------------------------

# 4. COMMON UX AND APPLICATION SHELL

## 4.1 Authentication

Create:

-   Splash screen.
-   Login with mobile OTP.
-   Optional email authentication for approved internal users.
-   Secure session management.
-   Device/session management.
-   Logout.
-   Forgot / recover access flow.
-   Account pending-verification state.
-   Suspended account state.
-   Licence-expired or compliance-blocked account state where
    applicable.
-   Demo mode only in non-production environments, with visible DEMO
    labels and isolated sample data.

Never use a universal shared password or production demo bypass.

## 4.2 First login and onboarding

After authentication:

1.  Resolve user identity.
2.  Load active organization.
3.  Load role assignments.
4.  Load permissions.
5.  Load assigned projects and work queues.
6.  Check mandatory profile fields.
7.  Check required KYC / compliance documents for the role.
8.  Display role-specific onboarding.
9.  Open role dashboard.

If required onboarding is incomplete, show a clear checklist and
restrict only the actions that require the missing information.

## 4.3 Shared navigation

Every role workspace should include:

-   Home.
-   Role-specific work queue.
-   Search.
-   Notifications.
-   Profile.
-   Help / support.
-   Offline / sync status where relevant.

Use bottom navigation for field-focused mobile roles and a responsive
sidebar / tab structure for management dashboards.

## 4.4 Shared components

Build reusable components:

-   Project header.
-   Project status badge.
-   Priority indicator.
-   Progress tracker.
-   Activity timeline.
-   Evidence gallery.
-   Document viewer.
-   Approval card.
-   Assignment card.
-   Payment milestone card.
-   Task checklist.
-   Defect card.
-   Notification item.
-   Search and filter panel.
-   Empty state.
-   Error state.
-   Offline banner.
-   Sync queue status.
-   Confirmation dialog.
-   Permission denied state.
-   Audit history viewer.

## 4.5 Universal project identity

Every project must have a unique immutable Project ID, for example:

`AIEC-PUN-2026-00125`

The ID must not be reused. Keep separate identifiers for lead,
quotation, order, project, task, defect, purchase order, payment and
inspection.

## 4.6 Universal project 360 view

The project record should aggregate:

-   Customer and builder.
-   Site address and geo coordinates.
-   Lead and source history.
-   Survey versions and measurements.
-   Technical feasibility decisions.
-   Lift configuration revisions.
-   Drawings and BOM.
-   Quotation versions.
-   Contract and variations.
-   Payment schedule and receipts.
-   Procurement and material status.
-   Partner assignment and scope.
-   Technician team assignments.
-   Project schedule and tasks.
-   Daily work reports.
-   Evidence.
-   QA inspections and defects.
-   Statutory documentation and inspection tracking.
-   Handover documents.
-   Warranty and AMC.
-   Complaints.
-   Audit trail.

------------------------------------------------------------------------

# 5. ROLE 01 --- OWNER / SUPER ADMIN

## 5.1 Role purpose

The Owner is the highest business authority. The Owner monitors company
performance, approves defined exceptions, controls strategic settings,
reviews financial and operational risk, and ensures the organization
works through governed processes rather than informal phone calls.

The Owner should not need to manually manage every routine task. The
dashboard must prioritize exceptions, decisions and business health.

## 5.2 Owner dashboard

Create an executive command center with:

### Business KPIs

-   New leads today / this week / this month.
-   Qualified leads.
-   Surveys completed.
-   Quotations issued.
-   Orders won / lost.
-   Total contracted sales value.
-   Expected gross project margin.
-   Actual recognized project performance.
-   Active projects.
-   Projects at risk.
-   Delayed milestones.
-   Customer receivables.
-   Supplier payables.
-   Partner payables.
-   QA first-pass rate.
-   Customer complaints.
-   Partner capacity utilization.

Every KPI must have a definition, calculation rule, date range, source
table and drill-down route. Do not show misleading totals that combine
estimates with verified actuals.

### Project portfolio

Display project cards or a table with: - Project ID. - Customer. -
Site. - Lift type. - Project value. - Stage. - Partner. - Planned
completion. - Actual progress. - Payment status. - QA status. - Risk
status. - Next action. - Responsible owner.

### Exception queue

Prioritize: - Payment overdue. - Site not ready. - Technical approval
blocked. - Material shortage. - Partner not responding. - Schedule
slippage. - QA failure. - Safety incident. - Licence / insurance
expiry. - Customer complaint. - Missing critical evidence. - Contract
variation pending. - Statutory inspection pending.

Each exception must show severity, age, project, responsible person,
impact, recommended next action and escalation history.

## 5.3 Owner screens

-   O01 Executive Dashboard.
-   O02 Project Portfolio.
-   O03 Project 360 View.
-   O04 Approval Center.
-   O05 Profitability Dashboard.
-   O06 Exception Control Room.
-   O07 Partner Portfolio.
-   O08 Customer Portfolio.
-   O09 Business Reports.
-   O10 User and Role Administration.
-   O11 Business Rules and Approval Limits.
-   O12 Audit Log.
-   O13 Compliance Overview.
-   O14 System Health / Sync Overview.
-   O15 Data Export and Reporting.

## 5.4 Approval authority

Owner may approve only the defined categories: - Discount beyond Sales
authority. - Special pricing and margin exceptions. - Exceptional
payment terms. - Contract variation beyond delegated limit. - Refunds
and credit notes. - Exceptional partner payout or retention release. -
Partner suspension / reinstatement. - Project reassignment exceptions. -
Timeline extension with commercial impact. - High-risk compliance
exception, where legally permissible. - Workflow exception that is not
prohibited by law or safety policy.

A safety-critical control, statutory requirement or legally mandatory
approval must never be bypassed by an ordinary Owner override.

## 5.5 Owner controls

-   View all business records.
-   Create and suspend users.
-   Assign roles and permissions.
-   Configure approval thresholds.
-   Configure service areas.
-   Configure project stage definitions.
-   Configure notification rules.
-   Configure quotation validity defaults.
-   Configure payment milestone templates.
-   Configure partner onboarding requirements.
-   View audit logs.
-   Export authorized reports.

Do not permit silent deletion of financial, contract, QA or audit
records. Use reversal, correction, superseding versions and reason
codes.

## 5.6 Owner KPI and reports

Provide: - Monthly sales report. - Lead funnel. - Conversion by
source. - Salesperson performance. - Project margin report. - Cash flow
forecast. - Receivable ageing. - Partner scorecard. - Supplier
scorecard. - Project delay analysis. - QA defect Pareto. - Customer
satisfaction. - Warranty / AMC pipeline.

------------------------------------------------------------------------

# 6. ROLE 02 --- OPERATIONS MANAGER

## 6.1 Role purpose

The Operations Manager translates confirmed orders into executable
projects and coordinates the internal team, partner companies,
suppliers, schedules and customer updates.

This role owns operational flow, not technical certification, pricing
authority or independent QA decisions.

## 6.2 Dashboard

Show: - Active projects. - Projects awaiting planning. - Site readiness
pending. - Partner assignment pending. - Material readiness pending. -
Tasks due today. - Overdue tasks. - Projects at risk. - QA pending. -
Customer escalations. - Team capacity. - Partner capacity.

## 6.3 Project planning workflow

For each confirmed order:

1.  Verify order and contract record.
2.  Confirm approved technical configuration.
3.  Confirm project scope and exclusions.
4.  Check customer site readiness.
5.  Check required approvals and drawings.
6.  Check payment gate.
7.  Check material plan.
8.  Identify required partner capability.
9.  Review partner availability and compliance.
10. Assign partner subject to approval rules.
11. Create baseline schedule.
12. Create project milestones and tasks.
13. Notify stakeholders.
14. Monitor execution and exceptions.

## 6.4 Scheduling

Support: - Project calendar. - Milestone timeline. - Task
dependencies. - Resource allocation. - Partner capacity. - Team
capacity. - Planned vs actual dates. - Delay reason. - Revised
forecast. - Customer-facing target date.

Do not treat a target date as a guaranteed completion date. Show
assumptions and readiness dependencies.

## 6.5 Partner assignment

Compare: - Service geography. - Valid authorizations and scope. -
Relevant lift experience. - Available team capacity. - Current
workload. - QA history. - Safety record. - On-time performance. -
Customer complaints. - Commercial fit. - Conflict of interest.

The system may recommend a partner, but assignment must follow
configured authorization and due diligence.

## 6.6 Daily operations

Provide a daily control board: - Site-wise status. - Partner daily
report. - Team attendance summary. - Task completion. - Material
consumption / shortage. - Site blocker. - Safety event. - Customer
dependency. - Next-day plan.

## 6.7 Escalation rules

Examples: - Task due soon: notify assigned owner. - Task overdue: notify
Partner Supervisor and Operations. - Project forecast at risk: notify
Operations Manager. - Critical delay affecting customer commitment:
notify Owner and customer communication owner. - Safety incident:
immediately trigger safety escalation and relevant work stop process. -
Compliance expiry: block new assignment where required by policy and
law.

## 6.8 Screens

-   OM01 Operations Dashboard.
-   OM02 Project Planning Queue.
-   OM03 Project 360.
-   OM04 Site Readiness.
-   OM05 Partner Selection.
-   OM06 Project Calendar.
-   OM07 Milestone Timeline.
-   OM08 Daily Progress.
-   OM09 Delayed Task Queue.
-   OM10 Resource / Capacity Board.
-   OM11 Material Readiness.
-   OM12 Customer Escalations.
-   OM13 Project Closure Review.

## 6.9 Restrictions

Operations must not: - Change approved lift design. - Change customer
price. - approve unauthorized discounts. - Release finance payments. -
Mark QA failures as passed. - Claim statutory approval without
evidence. - Delete project evidence.

------------------------------------------------------------------------

# 7. ROLE 03 --- SALES EXECUTIVE

## 7.1 Role purpose

Sales owns lead response, qualification, customer communication,
follow-up, proposal coordination, negotiation records and order
conversion.

Sales does not independently approve technical feasibility or exceed
pricing authority.

## 7.2 Dashboard

Show: - New assigned leads. - Uncontacted leads. - Follow-ups due
today. - Overdue follow-ups. - Site visits scheduled. - Surveys
completed. - Technical clarifications pending. - Quotations requested. -
Quotations awaiting approval. - Quotations sent. - Negotiations. - Won /
lost leads. - Expected pipeline value.

## 7.3 Lead capture

Allow lead creation from: - Website. - Phone. - WhatsApp. - Referral. -
Builder visit. - Marketing campaign. - Existing customer. - Manual
entry.

Fields: - Customer name. - Phone. - Alternate phone. - Email. - Customer
type. - Builder / developer. - Project name. - Site address. - City /
zone. - Map location. - Building usage. - Floors / stops, if known. -
Lift requirement. - Construction stage. - Budget range, if disclosed. -
Expected decision date. - Lead source. - Referrer. - Decision maker. -
Notes and consent / communication preference.

## 7.4 Duplicate prevention

Check: - Normalized phone. - Email. - Project name. - Site geo
proximity. - Builder name. - Existing open lead. - Existing customer /
project.

Do not automatically merge records based only on approximate location.
Show possible duplicates and require an authorized merge decision with
audit history.

## 7.5 Lead qualification

Capture: - Need. - Budget readiness. - Decision authority. - Timeline. -
Site readiness. - Competitor situation. - Number of lifts. - Technical
complexity. - Next action.

Provide configurable lead score. Show score explanation and allow
authorized override with reason.

## 7.6 Follow-up workflow

Every active lead must have a next action or a documented reason why no
action is required.

Call outcomes: - Interested. - Call back. - Meeting requested. - Site
survey required. - Proposal requested. - No answer. - Not interested. -
Invalid enquiry. - Lost to competitor.

Store communication timestamp, channel, summary, next follow-up date and
responsible user.

## 7.7 Quotation coordination

1.  Request survey.
2.  Check survey completion.
3.  Request technical feasibility.
4.  Obtain approved configuration.
5.  Obtain supplier / cost inputs.
6.  Create quotation draft.
7.  Calculate tax and commercial components using configured rules.
8.  Request discount approval if required.
9.  Issue controlled quotation version.
10. Record customer response.
11. Record negotiation.
12. Obtain acceptance.
13. Convert to order after required contract and approval checks.

## 7.8 Quotation rules

-   No binding customer price from an unapproved automatic configurator.
-   Any indicative range must be labelled non-binding.
-   Every quotation must have version number, validity, scope,
    exclusions, tax treatment, payment terms, warranty terms and
    delivery assumptions.
-   A revised quotation must supersede, not overwrite, the previous
    issued version.
-   Discount and margin limits must be server-enforced.

## 7.9 Lost lead analysis

Require a reason: - Price. - Competitor. - Project cancelled. - No
response. - Budget unavailable. - Technical infeasibility. - Timeline
mismatch. - Customer postponed. - Other.

## 7.10 Screens

-   SE01 Sales Dashboard.
-   SE02 Create Lead.
-   SE03 Lead List.
-   SE04 Lead Detail.
-   SE05 Qualification.
-   SE06 Follow-up Calendar.
-   SE07 Communication History.
-   SE08 Survey Booking.
-   SE09 Technical Clarification.
-   SE10 Quotation Request.
-   SE11 Quotation Builder / Review.
-   SE12 Approval Status.
-   SE13 Negotiation History.
-   SE14 Won / Lost Closure.
-   SE15 Sales Reports.

------------------------------------------------------------------------

# 8. ROLE 04 --- SURVEYOR

## 8.1 Role purpose

The Surveyor collects accurate, traceable site data and evidence. The
Surveyor does not make final engineering decisions unless separately
qualified and explicitly authorized for that function.

## 8.2 Dashboard

Show: - Assigned surveys. - Today's visits. - Upcoming visits. -
Accepted assignments. - In-progress surveys. - Drafts. - Submitted
surveys. - Rejected / clarification requested. - Revisit required. -
Offline upload queue.

## 8.3 Assignment detail

Display: - Project / Lead ID. - Customer. - Contact. - Address. - Map
navigation. - Appointment time. - Survey scope. - Required checklist. -
Special instructions. - Customer confirmation status.

## 8.4 Site arrival

Capture: - Check-in timestamp. - GPS coordinate and accuracy. - Site
photograph. - Surveyor identity. - Customer / site representative
confirmation. - Exception if GPS unavailable.

Do not falsely mark GPS as verified if location permission is denied or
accuracy is inadequate. Allow an exception workflow with reason and
supervisor review.

## 8.5 Survey data groups

### Building

-   Building name.
-   Usage.
-   Floors and stops.
-   Construction stage.
-   Structural type.
-   Number of entrances / landings.
-   Existing lift, if any.

### Shaft

-   Width and depth at required levels.
-   Shaft verticality observations.
-   Pit depth.
-   Overhead.
-   Entrance dimensions.
-   Obstructions.
-   Access conditions.

### Machine room / drive arrangement

-   Availability.
-   Location.
-   Access.
-   Dimensions.
-   Ventilation / environmental observations.
-   Preliminary equipment constraints.

### Electrical

-   Supply type.
-   Phase.
-   Voltage information if measured by qualified person.
-   Earthing information.
-   Electrical room.
-   Supply readiness.
-   Drawings / panel information.

### Site logistics

-   Material access route.
-   Storage area.
-   Lifting / handling constraints.
-   Working hours.
-   Site restrictions.
-   Crane / hoist requirements, if applicable.
-   Safety hazards.

### Documents

-   Architectural drawing.
-   Structural drawing.
-   Shaft layout.
-   Electrical drawing.
-   Site permission / access document, if relevant.

## 8.6 Evidence capture

Required categories should be configurable by survey type: - Site
exterior. - Shaft full view. - Shaft at relevant levels. - Pit. -
Overhead. - Landing entrances. - Machine room / equipment area. -
Electrical supply area. - Access route. - Drawings and documents.

Each evidence item stores: - Project ID. - Survey ID and version. -
Category. - Captured by. - Captured timestamp. - GPS and accuracy where
available. - File checksum / integrity metadata. - Upload state. -
Remarks.

Use in-app camera capture as the primary field workflow. Gallery upload
may be disabled by policy for evidence categories, but provide an
authorized exception path for imported drawings or existing documents.

## 8.7 Validation and submission

Before submission: - Required dimensions present. - Units explicit. -
Required evidence present. - Required documents attached or marked
unavailable with reason. - GPS / check-in state visible. - Critical
unknowns flagged. - Draft saved.

Actions: - Save Draft. - Submit Survey. - Request Revisit. - Report Site
Inaccessible.

Submitted survey versions must be immutable. Corrections create a new
revision.

## 8.8 Screens

-   SV01 Survey Dashboard.
-   SV02 Assignment Detail.
-   SV03 Site Check-in.
-   SV04 Building Details.
-   SV05 Shaft Measurements.
-   SV06 Electrical / Machine Room.
-   SV07 Logistics / Safety.
-   SV08 Photo Evidence.
-   SV09 Documents.
-   SV10 Review and Submit.
-   SV11 Revisit / Clarification.

------------------------------------------------------------------------

# 9. ROLE 05 --- TECHNICAL MANAGER / ENGINEERING

## 9.1 Role purpose

Technical Manager reviews site information, determines feasibility,
controls approved lift configuration and engineering document revisions,
and identifies technical conditions that must be met before procurement
or installation.

Technical decisions must be made by competent, authorized personnel
using applicable standards, manufacturer data and verified site
conditions.

## 9.2 Dashboard

Show: - Surveys awaiting review. - Incomplete surveys. - Clarification
requests. - Feasibility decisions pending. - Conditional feasibility
projects. - Approved configurations. - Drawing revisions. - BOM
pending. - Technical change requests. - Technical non-conformities.

## 9.3 Review process

1.  Review survey completeness.
2.  Review site evidence.
3.  Review dimensions and units.
4.  Review structural and electrical information.
5.  Identify missing or conflicting data.
6.  Request clarification if needed.
7.  Evaluate proposed lift type and configuration.
8.  Record constraints and assumptions.
9.  Make feasibility decision.
10. Publish approved revision.

## 9.4 Feasibility outcomes

-   Feasible.
-   Conditionally feasible.
-   Not feasible.
-   Insufficient information.

Every outcome requires: - Decision maker. - Date and time. - Technical
basis. - Constraints. - Required corrective actions. - Supporting
documents. - Review version.

## 9.5 Lift configuration

Capture, where applicable: - Lift category. - Rated load / capacity. -
Rated speed. - Floors / stops. - Travel. - Drive type. - Machine room
arrangement. - Car dimensions. - Shaft dimensions. - Door arrangement. -
Controller. - Cabin finish. - Power requirements. - Safety equipment. -
Manufacturer / model. - Applicable design references.

Do not calculate or auto-approve engineering values without a validated
calculation engine and professional sign-off.

## 9.6 Drawing and document control

Support: - General arrangement drawing. - Shaft layout. - Structural
interface drawing. - Electrical drawing. - Manufacturer drawing. - Bill
of materials. - Installation method / instructions. - Approved technical
specifications.

Every document must have: - Document ID. - Revision. - Status: Draft /
In Review / Approved / Superseded. - Author. - Reviewer. - Approval
timestamp. - Change summary. - Related project.

## 9.7 Technical change request

When customer, site or supplier changes a specification: 1. Create
change request. 2. Identify old and proposed values. 3. Assess technical
impact. 4. Assess cost impact. 5. Assess schedule impact. 6. Assess
compliance / safety impact. 7. Request commercial approval if price
changes. 8. Obtain customer acceptance where contract requires. 9.
Approve new revision. 10. Notify Procurement, Operations and Partner.

## 9.8 Screens

-   TE01 Technical Dashboard.
-   TE02 Survey Review.
-   TE03 Clarification Queue.
-   TE04 Feasibility Assessment.
-   TE05 Lift Configuration.
-   TE06 Technical Documents.
-   TE07 Drawing Revision.
-   TE08 BOM Review.
-   TE09 Change Request.
-   TE10 Technical Approval History.
-   TE11 Technical Risk Register.

------------------------------------------------------------------------

# 10. ROLE 06 --- ACCOUNTS & FINANCE

## 10.1 Role purpose

Accounts controls financial records, customer receipts, supplier
payables, partner ledger, expense records, reconciliation and project
financial reporting.

Separate payment preparation, verification and release wherever
practical. Do not allow one user to create and approve the same
high-risk payment without an authorized exception and audit trail.

## 10.2 Dashboard

Show: - Receivables. - Receivable ageing. - Payments received today. -
Unverified payment claims. - Upcoming milestone dues. - Overdue
invoices. - Supplier payables. - Partner payable balances. - Pending
payout approvals. - Expenses pending review. - Bank reconciliation
status. - Project gross margin estimates and actuals.

## 10.3 Customer receivables

For each contract: - Contract value. - Tax components. - Milestone
schedule. - Invoice number. - Invoice date. - Due date. - Amount due. -
Amount received. - Outstanding amount. - Dispute / hold status.

## 10.4 Payment verification

Capture: - Payer. - Project. - Amount. - Payment date. - Payment mode. -
Bank / UPI reference. - Supporting evidence. - Reconciliation status. -
Verified by. - Receipt reference.

A customer-uploaded screenshot is not proof of settled funds. Verify
against bank / payment gateway records before marking received.

## 10.5 Partner ledger

Track: - Partner contract value. - Approved scope. - Milestone value. -
Work completion claim. - QA / milestone verification. - Approved
payable. - Retention / holdback as contractually agreed. - Deductions
with reasons. - Disputes. - Previous payouts. - Net payable. - Payment
transaction.

Never apply arbitrary deductions or blanket retention without documented
contractual basis and approval.

## 10.6 Supplier payables

Link: - Purchase order. - Supplier invoice. - Goods receipt note. -
Quantity and quality verification. - Tax details. - Payment terms. - Due
date. - Payment approval. - Payment reference.

## 10.7 Expenses

Categories: - Transport. - Site visit. - Loading / unloading. -
Installation. - Consumables. - Electrical. - Travel. - Accommodation. -
Other direct cost. - Overhead.

Each expense must link to a project or a defined overhead cost center.

## 10.8 Project financial view

Display separately: - Contract revenue. - Taxes. - Equipment cost. -
Partner installation cost. - Transport. - Site expenses. - Other direct
cost. - Gross project contribution. - Allocated overhead, if
available. - Financing cost, if available. - Actual collection. -
Outstanding receivable. - Forecast margin.

Do not label gross project contribution as net profit.

## 10.9 Screens

-   FN01 Finance Dashboard.
-   FN02 Receivables.
-   FN03 Payment Verification.
-   FN04 Receipt / Invoice.
-   FN05 Customer Ledger.
-   FN06 Partner Ledger.
-   FN07 Payout Preparation.
-   FN08 Payout Approval.
-   FN09 Supplier Payables.
-   FN10 Expense Entry.
-   FN11 Project Cost Sheet.
-   FN12 Bank Reconciliation.
-   FN13 Financial Reports.
-   FN14 Dispute / Correction Record.

------------------------------------------------------------------------

# 11. ROLE 07 --- PROCUREMENT MANAGER

## 11.1 Role purpose

Procurement ensures approved equipment and materials are purchased from
suitable suppliers, delivered to the correct project and verified before
installation use.

## 11.2 Dashboard

Show: - Purchase requests. - BOM pending. - Supplier quotations
pending. - Purchase approvals. - Purchase orders. - Manufacturing
status. - Dispatch status. - In-transit material. - Received material. -
Damage / shortage. - Supplier delay. - Warranty / serial records.

## 11.3 Supplier / manufacturer profile

Capture: - Legal company name. - Contact information. - Address. - GST
and business details where applicable. - Product categories. - Technical
capability. - Authorizations / certifications relevant to supplied
products. - Warranty terms. - Commercial terms. - Lead times. - Quality
history. - Delivery performance. - Bank details with restricted
access. - Verification status.

## 11.4 Purchase request and BOM

A purchase request must be linked to: - Project. - Approved technical
configuration. - Approved BOM revision. - Required-by date. -
Quantity. - Specification. - Preferred supplier, if any. - Budget
estimate. - Requesting user.

Do not allow procurement to substitute a technically different component
without Technical Manager approval.

## 11.5 Supplier comparison

Compare: - Unit price. - Tax. - Freight. - Delivery lead time. -
Warranty. - Technical compliance. - Quality history. - Payment terms. -
Availability. - Supplier reliability.

Record why the selected supplier was chosen.

## 11.6 Purchase order

Create controlled PO with: - PO number. - Supplier. - Project. - BOM
lines. - Quantities. - Rates. - Tax. - Freight. - Delivery location. -
Delivery schedule. - Warranty. - Terms. - Approval record.

## 11.7 Dispatch and receipt

Track: - Manufacturing status. - Ready date. - Dispatch date. -
Transporter. - LR / tracking reference. - Expected arrival. - Received
date. - Quantity verified. - Damage. - Shortage. - GRN. - Accepted /
rejected / quarantined status.

## 11.8 Inventory

For stock-controlled items: - Item master. - SKU. - Serial / batch
number. - Unit. - Warehouse / site. - Available quantity. - Reserved
quantity. - Issued quantity. - Returned quantity. - Damaged quantity. -
Movement history.

## 11.9 Screens

-   PR01 Procurement Dashboard.
-   PR02 Purchase Requests.
-   PR03 BOM.
-   PR04 Supplier Directory.
-   PR05 Supplier Comparison.
-   PR06 Purchase Order.
-   PR07 Manufacturing / Dispatch.
-   PR08 Material Receipt / GRN.
-   PR09 Inventory.
-   PR10 Shortage / Damage.
-   PR11 Supplier Performance.

------------------------------------------------------------------------

# 12. ROLE 08 --- LICENSED PARTNER COMPANY ADMIN

## 12.1 Role purpose

The Partner Company Admin represents an independent execution company.
It manages its company profile, verified authorizations, assigned
projects, workforce, internal supervision, work evidence, contractual
milestones and its own financial ledger.

The Partner Company must be treated as a separate tenant and business
entity, not as a single technician login.

## 12.2 Onboarding

Capture: - Legal company name. - Entity type. - Registered and operating
address. - Authorized representative. - Contact details. - Business
identification details. - GST details where applicable. - PAN / relevant
business documents. - Bank account with verification. - Relevant
contractor licence. - Licence number. - Issuing authority. - Validity. -
Scope / class. - Insurance details. - Relevant certifications. -
Experience. - Service area. - Lift categories handled. - Team size. -
Available teams. - References. - Safety policy. - Compliance
declaration.

Verify the authenticity, validity and permitted scope of all required
documents before activation. Store expiry reminders and re-verification
history.

## 12.3 Partner status

Possible statuses: - Draft. - Submitted. - Verification Pending. -
Approved. - Conditional Approval. - Suspended. - Expired / Compliance
Hold. - Rejected. - Inactive.

The exact assignment restrictions for each status must be configurable
and legally reviewed.

## 12.4 Partner dashboard

Show: - Project invitations. - Accepted projects. - Active projects. -
Project schedule. - Work assigned today. - Team availability. - Pending
evidence. - Internal QA. - AIEC QA status. - Defects / rework. -
Compliance expiry. - Contract value. - Approved milestones. - Pending
receivables. - Paid amounts. - Disputes. - Performance score.

## 12.5 Project invitation

Display: - Project ID. - Site location. - Lift category. - Scope. -
Approved drawings. - Schedule. - Required skill / team. - Material
responsibility. - Safety requirements. - Contract value. - Milestone
payment terms. - Exclusions. - Customer / site dependencies.

Actions: - Accept. - Reject with reason. - Request clarification. -
Request revised schedule. - Declare conflict / capacity issue.

Acceptance must create an immutable assignment record.

## 12.6 Partner project workspace

Include: - Project overview. - Contract scope. - Approved drawings. -
Technical instructions. - Site readiness. - Material status. - Team
assignment. - Task board. - Daily reports. - Evidence. - Internal
checklist. - Defect correction. - QA status. - Timeline. - Contract
variation requests. - Financial milestone ledger. - Communication
history.

## 12.7 Workforce management

Partner Admin can: - Add / invite technicians. - Verify profile
information. - Assign skills. - Record training. - Assign supervisor. -
Create teams. - Set availability. - Assign team to project. - Record
attendance where lawful and appropriate. - Deactivate access. - View
performance.

The system must retain historical attribution when a worker leaves a
team or company.

## 12.8 Daily work report

Require: - Date. - Project. - Team members present. - Work completed. -
Work not completed. - Material used. - Material shortage. - Site
blocker. - Safety observations. - Incident declaration. - Evidence. -
Next-day plan. - Supervisor confirmation.

## 12.9 Partner internal QA

Partner performs its own internal quality checks before submitting work
to AIEC QA. Partner internal approval must never be represented as
independent AIEC QA approval.

## 12.10 Partner financial ledger

Display: - Contract amount. - Approved variations. - Milestone
schedule. - Claimed work. - Evidence submitted. - Verification status. -
Approved amount. - Retention / holdback if contractually agreed. -
Deductions with reason and dispute route. - Previous payouts. - Net
payable. - Payment references.

Partner Admin cannot approve or release its own payment from AIEC's
finance system.

## 12.11 Partner compliance

Show: - Licence status. - Insurance status. - Worker documents. -
Training status. - Safety audit. - Open corrective actions. - Document
expiry. - Assignment eligibility.

## 12.12 Screens

-   LP01 Partner Dashboard.
-   LP02 Company Profile.
-   LP03 Compliance Documents.
-   LP04 Project Invitations.
-   LP05 Assigned Projects.
-   LP06 Project Workspace.
-   LP07 Team Management.
-   LP08 Technician Profile.
-   LP09 Team Scheduling.
-   LP10 Daily Work Report.
-   LP11 Internal QA.
-   LP12 Defect / Rework.
-   LP13 Financial Ledger.
-   LP14 Payment Claims.
-   LP15 Performance / Compliance.

------------------------------------------------------------------------

# 13. ROLE 09 --- PARTNER TEAM LEADER / SUPERVISOR

## 13.1 Role purpose

This role is an optional but recommended layer between Partner Admin and
technicians. It supervises a site team, distributes tasks, checks
readiness, validates daily reports and coordinates with the Partner
Admin.

## 13.2 Dashboard

-   Assigned sites.
-   Team members.
-   Today's tasks.
-   Attendance / availability.
-   Safety checklist.
-   Work awaiting evidence.
-   Work submitted.
-   Rework.
-   Material issue.
-   Site blockers.

## 13.3 Actions

-   View assigned projects only.
-   Assign tasks to authorized team members.
-   Confirm team arrival.
-   Review task checklist.
-   Review evidence completeness.
-   Submit daily report.
-   Raise material request.
-   Raise safety incident.
-   Request clarification.
-   Escalate delay.
-   Submit work for Partner review.

A Team Leader cannot change approved engineering drawings, contract
amounts or AIEC QA outcomes.

------------------------------------------------------------------------

# 14. ROLE 10 --- TECHNICIAN / FIELD WORKER

## 14.1 Role purpose

Technician executes assigned field tasks under the applicable Partner
and project supervision. The interface must be extremely simple, with
minimal typing and clear safety instructions.

## 14.2 Onboarding

Capture: - Name. - Mobile. - Profile photo. - Identity verification
status. - Partner company. - Supervisor. - Skills. - Experience. -
Training records. - Relevant certificates / authorizations where
required. - Emergency contact. - Access status.

Do not collect unnecessary sensitive personal data. Restrict identity
and bank documents to authorized users.

## 14.3 Dashboard

Show: - Today's job. - Project ID. - Site navigation. - Team Leader. -
Assigned task. - Start / pause / submit status. - Required evidence. -
Safety instructions. - Offline queue. - Notifications.

## 14.4 Task workflow

States: - Assigned. - Accepted. - Ready. - Started. - In Progress. -
Blocked. - Submitted. - QA Review. - Approved. - Rework. - Closed.

Each transition must validate required conditions.

## 14.5 Task detail

Display: - Task name. - Project. - Scope. - Instructions. - Approved
drawing / reference. - Required tools. - Required PPE. - Safety
controls. - Checklist. - Evidence requirements. - Team Leader. - Target
date. - Blocker reporting.

## 14.6 Evidence

Capture: - Before photos. - In-progress photos where required. - After
photos. - Checklist. - Notes. - Timestamp. - GPS metadata and accuracy
where available. - Capturing user. - Upload status.

Do not let a technician alter the timestamp or location metadata
presented as verified system data. Preserve original file metadata and
server receipt time separately.

## 14.7 Safety

Before applicable work: - PPE confirmation. - Work-at-height controls. -
Electrical isolation / lockout-tagout where applicable. - Shaft access
control. - Barricading. - Tool inspection. - Emergency access. -
Supervisor confirmation.

If a critical safety condition fails, block task start and trigger
escalation. No productivity score or deadline may override a safety
stop.

## 14.8 Rework

When QA raises a defect: - Show defect. - Show location / component. -
Show reference photo. - Show correction instructions. - Show deadline. -
Allow clarification request. - Capture correction evidence. - Resubmit
for inspection.

## 14.9 Offline

Allow safe offline: - View previously assigned tasks. - View cached
approved instructions. - Complete permitted checklists. - Capture
evidence. - Save drafts. - Queue submissions.

Do not allow offline completion to bypass server-side approvals. Clearly
mark records as pending sync until acknowledged.

## 14.10 Screens

-   WT01 Technician Home.
-   WT02 My Jobs.
-   WT03 Job Detail.
-   WT04 Safety Check.
-   WT05 Task Checklist.
-   WT06 Camera Evidence.
-   WT07 Blocker / Incident.
-   WT08 Rework.
-   WT09 Sync Queue.
-   WT10 Profile / Training.

------------------------------------------------------------------------

# 15. ROLE 11 --- QA INSPECTOR

## 15.1 Role purpose

QA Inspector independently checks that submitted work meets approved
project requirements, manufacturer instructions, applicable standards
and documented inspection criteria.

QA must be functionally independent from the Partner whose work is being
inspected.

## 15.2 Dashboard

-   Inspections assigned.
-   Inspections due.
-   Submitted work awaiting QA.
-   Failed inspections.
-   Rework awaiting verification.
-   Reinspection.
-   Final QA.
-   Missing documents.
-   Safety non-conformities.

## 15.3 Inspection assignment

Show: - Project ID. - Stage. - Site. - Partner. - Submitted task. -
Approved drawing revision. - Previous inspection. - Required
checklist. - Inspection due date.

## 15.4 Inspection categories

Configure checklists by lift type, installation stage, manufacturer and
applicable requirements.

Possible categories: - Mechanical installation. - Rail / bracket
alignment. - Machine / drive installation. - Car frame and
counterweight. - Landing and car doors. - Electrical installation. -
Controller and wiring. - Earthing and protective devices. - Safety
components. - Functional operation. - Levelling and door operation. -
Emergency operation. - Final test documentation.

Do not treat this illustrative list as a complete statutory test
procedure. Qualified engineers must define and approve the actual
checklists and acceptance criteria.

## 15.5 Inspection result

Allowed outcomes: - Pass. - Fail. - Hold / More Information Required. -
Not Applicable with reason.

For every failure: - Defect category. - Severity. - Exact location. -
Description. - Evidence. - Applicable criterion / reference. -
Responsible party. - Correction due date. - Reinspection requirement.

## 15.6 Defect management

Defect lifecycle: - Open. - Assigned. - Acknowledged. - Correction In
Progress. - Submitted for Reinspection. - Verified. - Closed. - Disputed
/ Clarification.

No defect should be silently deleted. Closure must preserve original
finding and correction evidence.

## 15.7 Final QA

Final QA must verify: - Required stage inspections. - Open defects
closed or formally dispositioned. - Test records present. - Approved
configuration matches installed equipment. - Required documents
available. - Customer handover package ready.

Final QA does not replace statutory inspection, licence or permission
from the competent authority.

## 15.8 Screens

-   QA01 QA Dashboard.
-   QA02 Inspection Queue.
-   QA03 Project Inspection Detail.
-   QA04 Stage Checklist.
-   QA05 Evidence Review.
-   QA06 Defect Creation.
-   QA07 Reinspection.
-   QA08 Final QA Report.
-   QA09 Inspection History.
-   QA10 QA Analytics.

------------------------------------------------------------------------

# 16. ROLE 12 --- CUSTOMER / BUILDER PORTAL

## 16.1 Role purpose

Provide customers and builders with transparent project visibility,
controlled approvals, payment information, documents and support without
exposing internal AIEC data.

## 16.2 Dashboard

-   My projects.
-   Project stage.
-   Progress summary.
-   Upcoming milestones.
-   Pending customer actions.
-   Payment due.
-   Documents.
-   Support requests.
-   Warranty / AMC.

## 16.3 Project view

Show: - Project name. - Lift type and approved specification. - Order
date. - Current stage. - Planned milestone dates. - Customer
dependencies. - Approved progress evidence. - Customer-facing status. -
Contact person.

Do not expose internal partner disputes, internal profit, confidential
supplier pricing, worker personal data or internal risk notes.

## 16.4 Customer approvals

-   Quotation acceptance.
-   Design / finish selection.
-   Drawing approval where required.
-   Variation approval.
-   Payment confirmation.
-   Handover acceptance.

Store: - Approver identity. - Authority / relationship. - Document
version. - Decision. - Timestamp. - Comments. - Electronic consent /
signature evidence where applicable.

## 16.5 Payment center

Show: - Contract amount. - Milestone schedule. - Invoice. - Due date. -
Payment instructions. - Received and verified amount. - Receipt. -
Outstanding amount.

Never show payment as received until verified.

## 16.6 Support

-   Raise query.
-   Raise complaint.
-   Request callback.
-   Request site meeting.
-   Track ticket.
-   View response.
-   Reopen under defined policy.

## 16.7 Handover and warranty

Provide: - Final project report. - Approved specifications. - Operating
manual. - Emergency instructions. - Warranty certificate. - Applicable
statutory documents. - Maintenance schedule. - AMC offer. - Service
contact.

------------------------------------------------------------------------

# 17. FUTURE ROLE --- SERVICE / AMC MANAGER

Build as a later module: - Installed asset registry. - Lift serial /
asset number. - Customer site. - Warranty start and expiry. - AMC
contract. - Preventive maintenance calendar. - Service visit
assignment. - Complaint management. - Breakdown escalation. - Spare
parts. - Technician service report. - Customer sign-off. - Renewal
pipeline.

Do not mix installation project closure with long-term service history.
Link them through a permanent lift asset record.

# 18. FUTURE ROLE --- STATUTORY COMPLIANCE COORDINATOR

Manage: - Applicable approval checklist. - Drawing submission. -
Application references. - Document versions. - Authority
correspondence. - Inspection dates. - Defect notices. - Corrective
action. - Licence / permission status. - Renewal / expiry. - Final
approval evidence.

The module is a tracking and document-management system. It must not
imply that AIEC or the app itself grants statutory permission.

# 19. FUTURE ROLE --- CUSTOMER RELATIONSHIP MANAGER

Manage: - Post-handover satisfaction. - Complaint follow-up. - Referral
requests. - AMC renewal reminders. - Customer history. - Repeat
business. - Builder relationship. - Customer feedback.

------------------------------------------------------------------------

# 20. END-TO-END PROJECT WORKFLOW

Build the following controlled workflow:

1.  Lead Created.
2.  Lead Assigned.
3.  Lead Contacted.
4.  Lead Qualified.
5.  Survey Scheduled.
6.  Survey In Progress.
7.  Survey Submitted.
8.  Technical Review.
9.  Clarification / Revisit, if required.
10. Feasibility Approved / Conditional / Rejected.
11. Configuration Approved.
12. Costing Prepared.
13. Quotation Draft.
14. Quotation Approval.
15. Quotation Sent.
16. Negotiation / Revision.
17. Customer Acceptance.
18. Contract / Order Confirmation.
19. Advance Payment Verification.
20. Project Created.
21. Site Readiness Review.
22. Procurement Request.
23. Supplier Selection.
24. Purchase Order.
25. Manufacturing / Dispatch.
26. Material Receipt and Verification.
27. Partner Selection and Verification.
28. Partner Assignment.
29. Installation Readiness.
30. Installation Tasks.
31. Daily Progress.
32. Internal Partner QA.
33. AIEC Independent QA.
34. Defect / Rework Loop.
35. Final Testing and Documentation.
36. Applicable Statutory Inspection.
37. Permission / Licence evidence.
38. Handover Readiness.
39. Customer Handover.
40. Warranty Activation.
41. AMC / Service Transition.

For each state define: - Entry conditions. - Required fields. - Required
documents. - Responsible role. - Approver. - Allowed next states. -
Rejection / hold reasons. - Notifications. - SLA target. - Escalation. -
Audit event.

Do not allow users to arbitrarily edit the project status field. Status
transitions must go through validated actions.

------------------------------------------------------------------------

# 21. CRITICAL BUSINESS GATES

Implement server-side gates:

## Gate 1 --- Survey completeness

Do not request final technical approval until required survey fields and
evidence are complete or an authorized exception is recorded.

## Gate 2 --- Technical feasibility

Do not issue a final technical specification until authorized technical
review is complete.

## Gate 3 --- Quotation governance

Do not send a binding quotation until pricing, tax, terms and required
discount approvals are complete.

## Gate 4 --- Order confirmation

Do not create an executable project without accepted commercial terms
and required contract records.

## Gate 5 --- Payment readiness

Check contractual payment milestone conditions before procurement /
dispatch / installation actions that depend on payment. Any exception
must be authorized and documented.

## Gate 6 --- Procurement readiness

Do not purchase technically different materials without engineering
approval and required commercial approval.

## Gate 7 --- Partner eligibility

Do not assign a project if mandatory partner verification, applicable
authorization, insurance or other required documents are expired or
insufficient.

## Gate 8 --- Site readiness

Do not mark installation ready until site conditions, access, drawings,
material and required approvals have been checked.

## Gate 9 --- Installation task completion

Require task checklist, responsible user and required evidence.

## Gate 10 --- Independent QA

Partner internal checks cannot substitute for AIEC QA.

## Gate 11 --- Safety stop

Critical safety failure must stop the relevant work. No normal workflow
override may bypass this gate.

## Gate 12 --- Statutory completion

Do not mark the lift legally ready for customer use solely because
internal QA passed. Track required authority inspection and approval
separately.

## Gate 13 --- Handover

Require final documents, customer acceptance and applicable statutory
evidence.

## Gate 14 --- Warranty

Activate warranty from the contractually defined event and record the
source date.

------------------------------------------------------------------------

# 22. NOTIFICATION AND AUTOMATION ENGINE

Create event-driven automation for:

-   New lead → assign Sales.
-   Lead assigned → notify Sales.
-   Follow-up due → remind Sales.
-   Survey booked → notify Surveyor and customer contact as configured.
-   Survey submitted → create Technical Review.
-   Survey incomplete → return with missing items.
-   Feasibility approved → notify Sales.
-   Quotation approval needed → notify approver.
-   Quotation sent → create follow-up.
-   Customer acceptance → initiate order checklist.
-   Payment claimed → create verification task.
-   Payment verified → update milestone and eligibility.
-   Purchase order approved → notify supplier / procurement.
-   Material dispatched → update expected arrival.
-   Material received → create GRN verification.
-   Partner assigned → notify Partner Admin.
-   Task due → notify assigned team.
-   Task overdue → escalate.
-   Daily report missing → remind Partner Supervisor.
-   QA submitted → assign QA Inspector.
-   QA failed → create defect and rework task.
-   Safety incident → trigger critical escalation.
-   Compliance document expiring → alert Partner Admin and AIEC
    compliance owner.
-   Handover complete → create asset and warranty record.
-   Warranty nearing expiry → notify customer and CRM / AMC team.

All automations must be idempotent, retry-safe, logged and observable.
Prevent duplicate tasks and duplicate messages when events are retried.

------------------------------------------------------------------------

# 23. DESIGN SYSTEM AND UI REQUIREMENTS

## 23.1 Visual direction

Use a premium, modern, trustworthy industrial-business design: -
Primary: deep navy. - Secondary: metallic silver / neutral grey. -
Accent: restrained gold. - Success: green. - Warning: amber. - Critical:
red. - Background: white / light neutral for field screens. - Optional
dark theme for management dashboards.

Use accessible contrast. Do not rely on color alone for status.

## 23.2 Typography

Use a legible sans-serif family such as Inter or DM Sans. Use consistent
hierarchy: - Page title. - Section title. - Field label. - Body. -
Helper text. - Status / metadata.

## 23.3 Mobile interaction

-   Large touch targets.
-   Short forms.
-   Progressive disclosure.
-   Autosave drafts.
-   Clear required-field markers.
-   Camera-first evidence capture.
-   Numeric keypad for measurements.
-   Explicit units.
-   Confirm destructive / irreversible actions.
-   Avoid excessive tables on small screens.
-   Show the next action prominently.

## 23.4 Every screen must include states

For every screen design: - Initial loading. - Loaded state. - Empty
state. - Error state. - Offline state. - Permission denied. - Validation
error. - Submission in progress. - Success confirmation. - Partial
sync. - Conflict / stale data.

Do not create only the happy path.

------------------------------------------------------------------------

# 24. TECHNICAL ARCHITECTURE

## 24.1 Recommended stack

-   Android mobile: React Native + Expo.
-   Admin web: Next.js + Tailwind CSS.
-   Backend: Supabase.
-   Database: PostgreSQL.
-   Geo search: PostGIS.
-   Authentication: Supabase Auth.
-   Storage: Supabase Storage.
-   Realtime: Supabase Realtime where suitable.
-   Offline local storage: SQLite or a suitable local database.
-   Background sync: durable sync queue.
-   Push: Expo Notifications / FCM.
-   Payments: Razorpay integration where approved.
-   Messaging: approved WhatsApp Business API provider / SMS / email.
-   Error monitoring and analytics: production-grade monitoring service
    selected by the team.

## 24.2 Database design principles

Use relational tables and foreign keys. Use enums or lookup tables for
controlled statuses. Use UUID primary keys, immutable business
identifiers, timestamps, created_by / updated_by fields and soft-delete
/ archive patterns where appropriate.

Core entities: - organizations - users - user_profiles - roles -
permissions - user_roles - role_permissions - organization_memberships -
partner_companies - partner_documents - partner_technicians -
customers - builders - sites - leads - lead_activities - surveys -
survey_revisions - survey_measurements - evidence_files -
technical_reviews - lift_configurations - configuration_revisions -
drawings - bills_of_materials - quotations - quotation_revisions -
quotation_items - contracts - contract_variations - orders - projects -
project_assignments - project_milestones - tasks - task_dependencies -
task_assignments - daily_reports - inspections - inspection_checklists -
defects - defect_actions - suppliers - purchase_requests -
purchase_orders - goods_receipts - inventory_items -
inventory_movements - invoices - payments - payment_allocations -
partner_ledger_entries - supplier_ledger_entries - expenses -
warranty_assets - amc_contracts - service_tickets - notifications -
approval_requests - approval_decisions - workflow_events - audit_logs -
sync_operations.

## 24.3 Security

Implement: - Supabase RLS on every tenant-sensitive table. -
Organization-scoped access. - Project-scoped access. - Role and
permission checks. - Server-side validation for all critical
transitions. - Secure storage access. - Short-lived signed URLs for
private files. - No secrets in client code. - No service-role key in
mobile app. - Rate limiting for sensitive endpoints. - Session
revocation. - Audit logging. - Data export authorization. - Backup and
recovery plan.

Partner tenant isolation must be tested explicitly.

## 24.4 Offline architecture

For field roles: - Cache assigned tasks and approved project
instructions. - Store offline drafts locally. - Store evidence in a
durable upload queue. - Record client-created event ID. - Sync when
online. - Retry with backoff. - Avoid duplicate submissions. - Show sync
status per record. - Resolve conflicts explicitly. - Keep server as
final authority for approvals and gates.

------------------------------------------------------------------------

# 25. AUDIT, APPROVAL AND CHANGE MANAGEMENT

For sensitive records, store: - Actor. - Active role. - Organization. -
Project. - Action. - Old value / new value where appropriate. -
Reason. - Timestamp. - Server receipt timestamp. - Device / session
metadata where appropriate. - Approval reference. - Related document
version.

Important immutable or versioned records: - Issued quotations. -
Accepted contracts. - Approved technical configurations. - Approved
drawings. - Payment verification. - Partner payout approvals. - QA
results. - Defect history. - Statutory approval documents. - Customer
handover acceptance.

Never overwrite a signed or approved record silently.

------------------------------------------------------------------------

# 26. REPORTING AND ANALYTICS

Build reports for:

## Sales

-   Lead source.
-   Lead conversion.
-   Salesperson performance.
-   Sales cycle.
-   Quotation conversion.
-   Lost reasons.
-   Discount distribution.

## Operations

-   Project stage ageing.
-   On-time completion.
-   Delayed milestones.
-   Resource utilization.
-   Partner capacity.
-   Project risk.

## Finance

-   Receivables.
-   Payables.
-   Ageing.
-   Collections.
-   Project cost.
-   Gross contribution.
-   Cash flow.
-   Partner payout.

## Procurement

-   Supplier delivery.
-   Purchase variance.
-   Material damage.
-   Shortage.
-   Lead time.

## Partner

-   Project quality.
-   On-time delivery.
-   Safety performance.
-   Evidence completeness.
-   Rework.
-   Customer feedback.

## QA

-   First-pass yield.
-   Defects by category.
-   Repeat defects.
-   Rework time.
-   Critical non-conformities.

Every report must identify whether values are estimated, claimed,
approved, invoiced, received or reconciled.

------------------------------------------------------------------------

# 27. REQUIRED SCREEN SPECIFICATION FORMAT

For every screen in the product, produce a detailed specification using
this structure:

1.  Screen ID.
2.  Screen name.
3.  User role.
4.  Business objective.
5.  Entry points.
6.  Exit / next routes.
7.  Layout hierarchy.
8.  Components.
9.  Field list.
10. Field type.
11. Required / optional.
12. Validation rules.
13. Default values.
14. Data source.
15. API action.
16. Database entities.
17. Permission requirements.
18. Button labels.
19. Button behavior.
20. Loading state.
21. Empty state.
22. Error state.
23. Offline state.
24. Success state.
25. Approval conditions.
26. Audit events.
27. Notifications.
28. Accessibility requirements.
29. Acceptance criteria.
30. Test cases.

Do not use vague statements such as "add a modern dashboard". Specify
the exact cards, actions, fields, status rules, routes and data.

------------------------------------------------------------------------

# 28. REQUIRED DEVELOPMENT DELIVERABLES

Produce these artifacts in order:

## Deliverable A --- Product Requirement Document

-   Business goals.
-   Users and roles.
-   Scope.
-   Non-goals.
-   Assumptions.
-   Risks.
-   Success metrics.

## Deliverable B --- Information Architecture

-   Navigation tree.
-   Role workspaces.
-   Shared screens.
-   Screen inventory.
-   Route map.

## Deliverable C --- Role-wise UI/UX Blueprint

-   Every role.
-   Every screen.
-   Every field.
-   Every action.
-   Every state.
-   Mobile and web behavior.

## Deliverable D --- Workflow Specification

-   State machine.
-   Entry and exit conditions.
-   Approval gates.
-   Exception paths.
-   Escalation matrix.

## Deliverable E --- Permission Matrix

-   Role.
-   Permission.
-   Resource.
-   Action.
-   Organization scope.
-   Project scope.
-   Approval level.

## Deliverable F --- Database Specification

-   ERD.
-   Tables.
-   Columns.
-   Types.
-   Relationships.
-   Indexes.
-   RLS policies.
-   Migrations.

## Deliverable G --- API Specification

-   Endpoint / RPC.
-   Request.
-   Response.
-   Authentication.
-   Authorization.
-   Validation.
-   Error codes.
-   Idempotency.
-   Audit events.

## Deliverable H --- UI Implementation

-   Reusable design system.
-   Role dashboards.
-   Forms.
-   Lists.
-   Detail screens.
-   Navigation.
-   Offline states.
-   Accessibility.

## Deliverable I --- Testing

-   Unit tests.
-   Integration tests.
-   Workflow tests.
-   RLS tests.
-   Tenant-isolation tests.
-   Offline sync tests.
-   Permission tests.
-   Financial calculation tests.
-   Evidence upload tests.
-   End-to-end tests.

## Deliverable J --- Android Release

-   Expo build configuration.
-   Android application ID.
-   App icon and splash.
-   Environment configuration.
-   Secure secrets handling.
-   APK / AAB build.
-   Installation testing.
-   Release checklist.
-   Crash reporting.
-   Backup and rollback plan.

------------------------------------------------------------------------

# 29. ACCEPTANCE TEST SCENARIOS

At minimum, test the following end-to-end cases:

1.  New lead successfully created and assigned.
2.  Duplicate lead warning appears.
3.  Sales schedules a survey.
4.  Surveyor completes a survey offline.
5.  Survey evidence syncs without duplication.
6.  Incomplete survey cannot be submitted as complete.
7.  Technical Manager requests clarification.
8.  Technical Manager approves feasibility.
9.  Sales creates quotation.
10. Unauthorized discount is blocked.
11. Owner approves an exception.
12. Customer accepts a specific quotation revision.
13. Order is created with correct contract reference.
14. Unverified payment does not unlock a payment gate.
15. Verified payment updates the correct project ledger.
16. Procurement cannot substitute an unapproved component.
17. Expired mandatory partner documentation blocks assignment.
18. Partner A cannot view Partner B's project.
19. Partner assigns an authorized team member.
20. Technician cannot access another partner's task.
21. Technician submits evidence offline.
22. Repeated sync does not create duplicate tasks or evidence.
23. QA Inspector fails a task with a defect.
24. Partner submits rework evidence.
25. QA reinspects and closes the defect.
26. Technician cannot approve their own work.
27. Safety-critical failure blocks task progression.
28. Operations cannot override technical approval.
29. Partner cannot edit AIEC commercial terms.
30. Customer cannot view internal project margin.
31. Customer can view verified payment receipts.
32. Handover cannot complete without required documents.
33. Internal QA does not falsely imply statutory permission.
34. Warranty activates from the correct contractual event.
35. Every sensitive action appears in audit history.

Add tests for concurrent users, expired sessions, revoked permissions,
missing network, failed uploads, invalid file types, malicious input and
data isolation.

------------------------------------------------------------------------

# 30. IMPLEMENTATION PRIORITY

Build in controlled increments.

## Phase 1 --- Core commercial workflow

Roles: - Owner. - Sales. - Surveyor. - Technical Manager. - Customer.

Modules: - Authentication. - Lead. - Survey. - Technical feasibility. -
Configuration. - Quotation. - Approval. - Order. - Basic project
dashboard.

## Phase 2 --- Project execution

Roles: - Operations. - Licensed Partner Admin. - Partner Supervisor. -
Technician.

Modules: - Partner onboarding. - Assignment. - Team management. - Task
board. - Evidence. - Daily reports. - Offline sync.

## Phase 3 --- Governance and money

Roles: - Accounts. - Procurement. - QA.

Modules: - Payment. - Ledger. - Purchase order. - Material receipt. -
QA. - Defects. - Compliance. - Handover.

## Phase 4 --- Lifecycle and intelligence

Modules: - Warranty. - AMC. - Service. - Partner analytics. - Risk
scoring. - Forecasting. - Advanced automation. - AI-assisted document
and exception summaries.

Do not start Phase 4 before the core project lifecycle is reliable.

------------------------------------------------------------------------

# 31. FINAL EXECUTION INSTRUCTIONS

Before writing production code:

1.  Inspect the existing repository and identify the current stack.
2.  Inspect existing screens, routes, components, database schema and
    tests.
3.  Preserve working features unless a documented reason requires
    change.
4.  Produce a gap analysis against this specification.
5.  Identify conflicting business rules.
6.  Identify missing screens and data entities.
7.  Present the proposed architecture and migration plan.
8.  Implement one complete vertical workflow at a time.
9.  Test every workflow and permission boundary.
10. Keep a traceability matrix from requirement to screen, API, database
    and test.

Do not claim production readiness based only on a successful build.
Production readiness requires security review, RLS verification,
tenant-isolation tests, workflow tests, device testing, backup /
recovery verification and operational sign-off.

## Final product quality standard

The finished AIEC system must enable:

-   Owner to monitor the business through a command center.
-   Sales to convert leads into governed orders.
-   Surveyors to collect reliable field data.
-   Technical staff to control approved configurations.
-   Operations to coordinate project execution.
-   Accounts to reconcile customer and partner finances.
-   Procurement to control supplier and material flow.
-   Licensed Partners to manage their own execution teams.
-   Technicians to complete field work with evidence and safety
    controls.
-   QA to independently inspect and manage defects.
-   Customers to track their project and make controlled approvals.
-   AIEC to retain a traceable record from first enquiry through
    warranty.

**Build a dependable elevator installation operating system, not merely
a visually attractive app. Every screen must serve a defined business
action, every action must have an authorization rule, every stage must
have entry and exit conditions, and every important decision must be
auditable.**


---

# VERSION 2.0 — DEEP IMPLEMENTATION SPECIFICATION

> This section expands the Version 1.0 baseline into a buildable product specification. Where a rule is more specific here, use this version. Do not implement contradictory assumptions silently. Record unresolved decisions in a Decision Register and ask the product owner only when a decision is genuinely blocking. Use safe, reversible defaults for non-blocking decisions.

# 32. PRODUCT DISCOVERY, REPOSITORY AUDIT AND REQUIREMENTS TRACEABILITY

## 32.1 Mandatory repository audit before code changes

When working in an existing repository, do not begin by replacing the app or generating a new UI. First inspect:

- Repository tree and package manager.
- Existing app entry points and route structure.
- React Native / Expo version and app configuration.
- Next.js version and web routes, if present.
- Existing Supabase project configuration and migrations.
- Database schema, enums, triggers, functions and RLS policies.
- Authentication implementation and role model.
- Existing reusable components and design tokens.
- Existing API clients and state management.
- Offline storage and synchronization implementation.
- File upload / image capture behavior.
- Current automated tests and test commands.
- Build scripts, environment variables and deployment configuration.
- Known defects, TODO comments and duplicate implementations.

Create `docs/repository-audit.md` with:
1. Current architecture.
2. Existing working capabilities.
3. Broken or incomplete capabilities.
4. Security risks.
5. Duplicate or obsolete code.
6. Missing modules against this specification.
7. Database migration risks.
8. Proposed implementation sequence.
9. Files that must be preserved.
10. Files proposed for removal, with evidence and dependency analysis.

Never delete a file just because its name contains `old`, `backup`, `draft`, `final` or a version number. Confirm references, imports, deployment use and Git history first.

## 32.2 Requirements traceability matrix

Maintain `docs/traceability-matrix.md`. Every requirement must map to:
- Requirement ID.
- Business rule.
- User role.
- Screen ID.
- Route.
- UI component.
- API / database operation.
- RLS / authorization rule.
- Audit event.
- Automated test ID.
- Implementation status.

A feature is not complete merely because the UI exists. It is complete only when UI, server validation, persistence, permissions, auditability, error states and tests are implemented.

## 32.3 Decision Register

Maintain `docs/decision-register.md` with:
- Decision ID.
- Topic.
- Options considered.
- Recommended default.
- Consequence.
- Decision owner.
- Date.
- Status.

Examples of decisions that must remain configurable until confirmed:
- Exact customer payment percentages.
- Partner payout milestones.
- Retention / holdback terms.
- Sales discount thresholds.
- Margin floors.
- Project SLA by lift type and complexity.
- Required partner documents.
- Technician evidence requirements.
- Statutory checklist applicable to each project.
- Warranty commencement event.
- Tax treatment and invoice numbering.

# 33. DOMAIN MODEL AND BUSINESS GLOSSARY

Use consistent terminology across UI, API, database and reports.

| Term | Definition |
|---|---|
| Lead | An enquiry or potential sales opportunity; it is not yet a confirmed project. |
| Customer | Legal or individual buying party. |
| Builder | Developer / site organization; may have multiple authorized contacts and projects. |
| Site | Physical installation location, separate from customer identity. |
| Survey | Versioned set of site observations, dimensions, photos and documents. |
| Technical Review | Qualified review of survey data and proposed lift configuration. |
| Configuration | Approved technical specification for a specific project revision. |
| Quotation | Commercial proposal with controlled version, scope, exclusions and validity. |
| Order | Accepted commercial transaction linked to a quotation / agreement. |
| Project | Executable delivery record created from an accepted order. |
| Milestone | A measurable project or payment checkpoint. |
| Task | Assigned unit of work with status, owner, due date and completion criteria. |
| Evidence | Photo, document, measurement, checklist or other traceable proof. |
| Partner | A separate execution company registered and approved in AIEC's system. |
| Technician | A worker / field user associated with a Partner organization. |
| QA Inspection | Independent quality review of submitted work. |
| Defect | A recorded failure to meet a defined acceptance criterion. |
| Variation | Approved change to scope, specification, timeline or commercial terms. |
| GRN | Goods Receipt Note confirming material receipt and inspection. |
| Handover | Controlled transfer of the completed lift / project package to the customer, subject to requirements. |
| Asset | The installed lift record used for warranty and future service. |
| AMC | Annual Maintenance Contract or other defined maintenance agreement. |

Never use `lead`, `order`, `project` and `asset` interchangeably. They are different entities with different lifecycle rules.

# 34. DETAILED SCREEN CONTRACT — STANDARD FORMAT

Every screen specification must use the following exact structure. Do not omit sections because a screen appears simple.

1. **Screen ID and route:** stable ID and route path.
2. **Display name:** concise user-facing name.
3. **Primary role:** role normally using it.
4. **Additional roles:** roles allowed to view or act.
5. **Purpose:** one sentence describing the business outcome.
6. **Entry conditions:** how the user reaches the screen and required record state.
7. **Exit routes:** valid next screens and transition actions.
8. **Information hierarchy:** most important information first.
9. **Components:** cards, tables, tabs, form controls, actions and modals.
10. **Field catalogue:** key, label, data type, unit, required state, source, editability and validation.
11. **Actions:** button label, action, preconditions, confirmation, API operation and result.
12. **Permissions:** exact read / create / update / approve permissions.
13. **Business validation:** rules before save or transition.
14. **Server response handling:** success, validation error, authorization error, conflict, timeout and server failure.
15. **Loading state:** skeleton / progress indicator and duplicate-submit prevention.
16. **Empty state:** meaningful message and permitted next action.
17. **Offline state:** cached data, allowed actions, queued actions and blocked actions.
18. **Audit events:** events written by each action.
19. **Notifications:** events generated and recipients.
20. **Accessibility:** focus order, labels, contrast, touch targets and screen reader hints.
21. **Analytics:** event name and non-sensitive properties.
22. **Acceptance criteria:** observable conditions for completion.
23. **Test cases:** normal, boundary, invalid, permission, offline and concurrent-user cases.

## 34.1 Field catalogue rules

For each field define:
- Stable machine key in `snake_case`.
- Human-readable label.
- Type: text, long text, integer, decimal, currency, date, time, datetime, enum, boolean, phone, email, address, geo point, file, image, relation.
- Unit where relevant: mm, kg, m/s, INR, percent, days.
- Required / optional / conditionally required.
- Validation and allowed range.
- Source: user input, derived, external integration or system-generated.
- Whether editable after submission.
- Whether sensitive / restricted.
- Whether it is included in audit history.

Never store numeric measurements without a unit. Store the normalized unit and preserve the entered unit if conversion is supported.

## 34.2 Action contract

Every action must define:
- Who can execute it.
- Record state required.
- Fields / documents required.
- Whether approval is needed.
- Whether action is reversible.
- What happens on repeat click.
- Idempotency behavior.
- Notifications emitted.
- Audit record created.
- Next screen / state.

# 35. DETAILED ROLE SCREEN SPECIFICATIONS — OWNER

## O01 Executive Dashboard

**Purpose:** Give the Owner a prioritized view of company health and decisions, not a cluttered analytics wall.

**Layout:**
- Header: company selector (only if multi-company is enabled), date range, notification icon, profile.
- KPI row: leads, orders, active projects, contracted value, receivables, delayed projects.
- Funnel: lead → qualified → survey → quotation → won.
- Project health list: green / amber / red with reason.
- Exception queue: top overdue and critical items.
- Cash / receivable snapshot.
- Partner performance summary.

**Filters:** date range, geography, lift category, sales owner, partner, project stage and risk status.

**Actions:** open project, open approval, assign follow-up owner (only if authorized), export report (permission controlled).

**Rules:** Every KPI must show whether it is count, estimate, approved amount, invoiced amount or cash received. Clicking a KPI must open a filtered detail list whose total reconciles to the KPI.

## O02 Project Portfolio

Display searchable project table / mobile cards with Project ID, customer, site, lift configuration summary, project stage, next milestone, partner, forecast completion, payment gate, QA status and risk. Provide saved filters: all active, at risk, delayed, payment blocked, partner blocked, QA pending, ready for handover and completed.

Owner may open any project. Changing project assignments or stage must invoke the relevant workflow action, not directly edit fields.

## O03 Project 360

Use tabs: Overview, Customer, Survey, Technical, Commercial, Payments, Procurement, Partner, Tasks, Evidence, QA, Compliance, Handover, Warranty, Activity.

Show immutable revision history for approved records. Highlight superseded quotation and drawing versions. Display related records with ID and status. Hide sensitive fields based on permission even for Owner if separation-of-duty policy requires it.

## O04 Approval Center

Group approvals by age, severity, amount and project impact. Each approval card must show requester, request date, reason, supporting documents, prior approvals, policy threshold and impact of approval / rejection.

Actions: Approve, Reject, Request More Information, Delegate where policy permits. Require a reason for rejection and for exceptions. Prevent requester self-approval where segregation of duties applies.

## O05 Profitability Dashboard

Separate contracted value, recognized revenue if applicable, invoiced value, cash received, estimated cost, committed cost, actual cost and forecast cost. Show gross project contribution separately from net company profit. All totals must be filterable and drillable to source records.

## O06 Exception Control Room

Each exception includes: category, severity, project, detected at, age, owner, impact, next action, SLA, escalation status and resolution evidence. Support bulk assignment only for non-financial, non-safety actions. Critical safety incidents cannot be hidden by ordinary filters.

## O07 Partner Portfolio

Show partner verification status, licence / document expiry, geography, capability, active workload, available capacity, quality score, on-time score, safety incidents, complaints, financial disputes and assignment eligibility. Scores must include definitions and sample size; do not rank a partner on a tiny sample without warning.

## O08 Business Rules

Provide controlled configuration for role permissions, approval thresholds, lead assignment, project numbering, SLA templates, payment milestone templates, notification rules and required evidence sets. Every configuration change requires reason, version, effective date and audit event. Critical policy changes may require second approval.

## O09 Audit Log

Search by actor, project, entity, action, date, organization and severity. Show before / after values when safe, reason, device/session metadata and linked approval. Audit data must be append-only for normal users.

## O10 System Health

Show queue failures, failed notifications, stuck sync events, storage errors, webhook failures, scheduled job failures and integration status. Do not expose secrets or raw credentials.

# 36. DETAILED ROLE SCREEN SPECIFICATIONS — OPERATIONS MANAGER

## OM01 Operations Home

Show work requiring attention today: unplanned orders, incomplete site readiness, unassigned partners, late material, overdue tasks, pending daily reports and QA submissions. Provide filters by zone, partner, project stage and due date.

## OM02 Project Planning Wizard

Step 1: verify order and approved specification. Step 2: verify contract scope and site dependencies. Step 3: site readiness checklist. Step 4: payment readiness. Step 5: material plan. Step 6: partner capability and availability. Step 7: baseline schedule. Step 8: internal review and publish.

Do not allow publish if mandatory dependencies are missing. Where a permitted exception exists, require authority, reason, expiry and follow-up owner.

## OM03 Site Readiness

Checklist groups: access, shaft / civil readiness, electrical readiness, storage, safe access, drawings, customer dependencies, permits / approvals relevant to the stage, working hours and site contact. Each item is Pass / Fail / Not Applicable / Awaiting Evidence with a note and optional photo. “Not Applicable” requires a reason.

## OM04 Partner Selection

Show eligible partners only by default. Include capability match, geography, availability, concurrent projects, relevant experience, QA history, safety record, document validity and commercial terms. Explain recommendation factors. If an ineligible partner is requested, block or route to an authorized compliance exception only where legally permissible.

## OM05 Schedule Builder

Support milestones, task dependencies, planned start / end, responsible organization, assigned role, predecessor, duration, customer dependency and critical path. Keep original baseline and each revised forecast. A change must record reason and customer impact.

## OM06 Daily Control Board

Show site, assigned partner, team, today's planned work, actual work, blockers, material, safety declaration, evidence completeness and next-day plan. Allow manager comments and escalation, not silent rewriting of partner-submitted reports.

## OM07 Delay and Risk Review

Calculate schedule variance from baseline and latest forecast. Require a delay reason category and narrative. Record recovery plan, owner, due date and impact on customer commitment. Never auto-promise a new date without review.

## OM08 Closure Review

Check all project tasks, QA, defects, payment, statutory evidence, handover documents, customer acceptance and asset creation. Operations may prepare closure but cannot fabricate missing approval.

# 37. DETAILED ROLE SCREEN SPECIFICATIONS — SALES EXECUTIVE

## SE01 Sales Home

Prioritize uncontacted new leads, overdue follow-ups and customer actions. Show pipeline by stage and expected close date. Clearly distinguish weighted forecast from confirmed orders.

## SE02 New Lead Form

Required minimum fields: contact name, one verified contact method, site / project identity, city, enquiry source and initial requirement. Additional technical details may be unknown at first capture. Allow “Unknown / To be confirmed” rather than forcing invented values.

## SE03 Duplicate Review

Show possible matches with phone, email, site, project and builder similarity. Actions: open existing, request ownership transfer, confirm separate opportunity, or request merge. Merging must preserve both histories and be restricted to authorized users.

## SE04 Lead Detail

Sections: overview, contacts, site, requirements, activities, communication, survey, quotation, documents and audit. Show lead owner and next follow-up prominently.

## SE05 Qualification

Capture need, authority, budget range, timeline, technical scope, site status, competition and next action. Make scoring transparent and configurable. Do not use score as a legal or credit decision.

## SE06 Follow-up Composer

Allow call note, meeting note, WhatsApp message template, email draft and reminder. The user must review external communication before sending unless a separately approved automation policy applies. Record channel and delivery status from provider response.

## SE07 Survey Booking

Select eligible surveyor, date/time window, site contact and scope. Confirm appointment status. Avoid double-booking and show travel / geography constraints where configured.

## SE08 Quotation Request

Sales submits required customer requirements and approved survey / configuration references. Missing required technical approval must be displayed clearly. Sales cannot invent equipment cost or technical specification.

## SE09 Quotation Presentation

Show current issued revision, validity, scope, exclusions, taxes, payment terms, warranty and delivery assumptions. Customer responses must be attached to the exact revision.

## SE10 Negotiation Log

Each negotiation event includes date, contact, topic, requested change, requested discount, expected impact, owner and decision. Do not overwrite prior terms.

## SE11 Order Handover

Before handover to Operations, verify customer identity, accepted quotation revision, agreed scope, contract, site, contact, payment terms, variation status and customer dependencies. Generate a handover checklist and require acknowledgement by receiving team.

# 38. DETAILED ROLE SCREEN SPECIFICATIONS — SURVEYOR

## SV01 Survey Queue

Show assignment priority, appointment, travel / map link, contact and survey type. Provide accept / request reschedule / report inaccessible actions.

## SV02 Site Check-in

Request location permission contextually. Store coordinate, accuracy, timestamp and permission state. If unavailable, record an exception; do not manufacture a location. Show the user exactly what metadata is being captured.

## SV03 Survey Wizard

Use progressive sections with completion count. Save after each section. Provide explicit units and measurement help. Keep field labels clear and avoid combining width, depth and height into one ambiguous field.

## SV04 Measurement Entry

Support numeric input, decimal precision configured per field, unit labels, photo reference and measurement location / level. Validate plausible ranges but do not present plausibility warnings as engineering approval. Preserve original entered value and normalized value if conversion is used.

## SV05 Evidence Capture

Before capture show required category and photo framing hint. After capture show preview, category, timestamp and sync state. Allow retake. Prevent accidental wrong-project attachment. Do not silently remove a previously submitted image; create a superseding record.

## SV06 Survey Review

Show missing fields, inconsistent values, absent evidence and unresolved observations. Provide save draft, submit, request revisit and report site inaccessible. Submission locks the version and creates a review task.

# 39. DETAILED ROLE SCREEN SPECIFICATIONS — TECHNICAL MANAGER

## TE01 Review Queue

Sort by waiting age, project criticality and survey completeness. Expose missing data before opening the technical decision form.

## TE02 Feasibility Workspace

Side-by-side survey values, evidence, drawings and technical requirements. Record assumptions and references. Decisions: feasible, conditional, infeasible, insufficient information. Every decision requires rationale and reviewer identity.

## TE03 Configuration Builder

Capture only approved parameters relevant to the selected lift category. Field dependencies must be configurable. Show warnings for missing manufacturer data or unresolved site conditions. Mark each parameter as proposed, reviewed or approved.

## TE04 Drawing Review

Allow document preview, revision comparison, comments and approval. Approval must refer to a specific file checksum / version. New upload does not silently replace approved drawing.

## TE05 BOM Review

Map each BOM line to a configuration revision and manufacturer specification. Require approval for substitutions. Record quantities, unit, make / model, source and technical notes.

## TE06 Technical Change

Compare original and proposed specification, identify related drawings/BOM, record cost and schedule impact, compliance impact, approval and customer acceptance where applicable. Notify all dependent roles after approval.

# 40. DETAILED ROLE SCREEN SPECIFICATIONS — ACCOUNTS & FINANCE

## FN01 Finance Home

Show reconciled cash receipts separately from claims and uploaded payment proofs. Display overdue receivables by age bucket. Separate customer, supplier and partner balances.

## FN02 Payment Claim Verification

Review project, payer, amount, payment method, transaction reference, date and evidence. Match against bank / gateway statement or authorized verification source. Outcomes: verified, partially verified, rejected, pending clarification. Every outcome records verifier and reason.

## FN03 Customer Ledger

Show invoices, credit notes, receipts, allocations, outstanding balance and disputes. Do not allow manual balance adjustment without a journal / correction record and approval.

## FN04 Partner Milestone Claim

Partner claim is not automatically payable. Verify contract milestone, work submission, required QA status, variation and supporting evidence. Create payable proposal only after all policy conditions pass.

## FN05 Payout Approval

Separate preparation from approval / release. Display payee verification, bank account status, source invoice / milestone, deductions, holdback terms, tax / withholding configuration if applicable, amount and approval trail. Use payment provider response to update final status.

## FN06 Expense Entry

Require expense category, amount, date, payee, project / cost center, receipt / evidence and business purpose. Enforce configured approval thresholds.

## FN07 Reconciliation

Import or receive bank / payment provider data through approved integration. Show matched, unmatched, duplicate and partially matched transactions. Do not silently mark unmatched transactions reconciled.

# 41. DETAILED ROLE SCREEN SPECIFICATIONS — PROCUREMENT

## PR01 Purchase Request Queue

Show requests linked to approved BOM revision, project, required date, estimated amount and requester. Reject or return requests with reason when required inputs are missing.

## PR02 Supplier Comparison

Compare normalized landed cost, tax, freight, lead time, warranty, technical match and performance history. Make evaluation weights transparent. Record chosen supplier and rationale.

## PR03 Purchase Order Builder

Generate a controlled PO revision from approved purchase request lines. Include supplier, ship-to site, quantities, pricing, taxes, freight, delivery window, payment terms and terms / conditions. Approval limits are configurable.

## PR04 Material Tracking

Track each material line separately: ordered, confirmed, manufacturing, ready, dispatched, in transit, delivered, received, inspected, accepted, quarantined or rejected. Do not mark a whole PO received if only part arrived.

## PR05 GRN

Capture received quantities, damaged quantities, shortage, serial / batch numbers, photographs, receiving user and inspection result. Link accepted quantities to project / inventory.

## PR06 Substitution Request

A supplier substitution must include original item, proposed item, technical data, reason, price impact, delivery impact and Technical Manager decision. Procurement cannot self-approve technical equivalence.

# 42. DETAILED ROLE SCREEN SPECIFICATIONS — LICENSED PARTNER COMPANY

## LP01 Partner Dashboard

Show invitations, active jobs, daily tasks, project risk, team capacity, missing reports, QA / rework, compliance expiry, payment claims and ledger. Clearly separate AIEC approval state from Partner internal status.

## LP02 Company Profile

Editable company contact and operating information must be versioned. Legal identity and bank changes require verification workflow. Notify AIEC for material changes.

## LP03 Compliance Vault

Each document has type, number, issuer, issue date, expiry date, scope, file, verification state, verifier, rejection reason and next review. Expired mandatory document must trigger assignment eligibility rules.

## LP04 Invitations

Partner reviews project summary, scope, schedule, commercial conditions, material responsibilities and constraints before accepting. Acceptance means acknowledgement of the displayed revision. Any later scope change requires variation.

## LP05 Project Workspace

Tabs: scope, schedule, drawings, team, tasks, materials, daily reports, safety, internal QA, AIEC QA, defects, communication, variations and ledger.

## LP06 Team Directory

Show active / inactive team members, role, skill, training, authorization evidence where relevant, project assignment and access status. A removed user must lose future access but remain attributed to their historical actions.

## LP07 Task Assignment

Partner Admin / Supervisor assigns only eligible team members to a permitted task. Check skill, availability, project association and required training. Preserve assignment history.

## LP08 Daily Report

Require presence / absence summary, work completed, blockers, material use, safety event declaration, evidence and next-day plan. A missed report triggers reminder and escalation, not fabricated completion.

## LP09 Variation Request

Partner submits proposed additional scope, cause, evidence, cost, time impact and customer / site dependency. Work outside existing scope must not be represented as approved until required approvals are complete, except immediate safety stabilization actions defined by policy.

## LP10 Payment Claim

Partner submits milestone claim against contract. Show claimed amount, evidence, QA dependencies, prior claims and status. Do not permit editing a claim after submission; allow a revision / clarification response.

# 43. DETAILED ROLE SCREEN SPECIFICATIONS — TEAM LEADER AND TECHNICIAN

## TL01 Team Leader Home

Show assigned sites, team members, tasks, site blockers, safety checks, missing evidence and daily report status. Team leader may coordinate execution but cannot alter approved technical or financial records.

## TL02 Task Board

Sort by priority and dependency. Display start prerequisites. Prevent assignment where prerequisite task is incomplete or safety hold exists.

## WT01 Technician Home

One prominent current task, next task, site details, safety notice, offline badge and action to report blocker. Avoid displaying complex financial or sales data.

## WT02 Task Detail

Display scope, drawing version, instructions, checklist, tools, PPE, hazards, due date, supervisor and evidence requirements. Make approved instruction revision obvious.

## WT03 Safety Pre-Start

Require applicable controls. Critical failures disable Start and display the reason plus contact route. User may raise a stop-work incident. Do not penalize legitimate safety stops through performance metrics.

## WT04 Work Capture

Allow checklist progress, notes, in-app camera, evidence category, sync queue and submit. Show which evidence is mandatory and which is optional. Submission is not equivalent to QA approval.

## WT05 Blocker / Incident

Categories: material missing, site inaccessible, drawing unclear, unsafe condition, equipment issue, customer dependency, injury / incident, other. Safety / injury categories trigger immediate configured escalation. Allow offline capture with pending-sync status.

## WT06 Rework

Show defect, correction criterion, reference evidence and deadline. Technician can ask for clarification. On resubmission, link new evidence to original defect without deleting earlier evidence.

# 44. DETAILED ROLE SCREEN SPECIFICATIONS — QA INSPECTOR

## QA01 Inspection Queue

Sort by due date, criticality and project stage. Filter by lift type, partner and site. Show whether required prerequisite documents are available.

## QA02 Inspection Workspace

Display approved configuration and drawing revisions, task submission, evidence, previous defects and applicable checklist version. Ensure QA inspects against the correct approved revision.

## QA03 Checklist Execution

Each criterion supports pass, fail, hold, not applicable. N/A requires reason. Critical criteria must not be bypassed. Store inspector notes, evidence and reference criterion.

## QA04 Defect Creation

Require category, severity, location, description, evidence, responsible party and correction expectation. Critical safety defects must trigger stop / hold workflow.

## QA05 Reinspection

Compare original defect evidence with correction evidence. Outcomes: verified, not corrected, additional defect, clarification required. Preserve all inspection attempts.

## QA06 Final QA Report

Summarize inspection scope, checklist revision, results, open defects, limitations, evidence and sign-off. Do not label statutory permission or operational licence as granted unless the corresponding official evidence has been recorded and verified.

# 45. DETAILED ROLE SCREEN SPECIFICATIONS — CUSTOMER / BUILDER

## CU01 Customer Home

Show only the user's authorized projects, pending actions, payment due and support tickets. Use customer-friendly language, not internal workflow jargon.

## CU02 Project Tracker

Show stage, completed milestones, next milestone, customer dependencies and approved progress evidence. Avoid exposing internal notes or partner confidential data.

## CU03 Specification and Design Approval

Present exact revision, rendered document, summary of changes and approve / request change actions. Customer approval must bind to that revision only.

## CU04 Quotation and Contract

Present commercial terms, tax details, validity, scope, exclusions, payment milestones and documents. Make acceptance action explicit and record authority to accept.

## CU05 Payment Center

Show invoice, amount due, due date, verified receipts and outstanding amount. Clearly mark payments under verification.

## CU06 Support Center

Create tickets with category, description, photo / attachment, preferred contact and project link. Show ticket status and response timeline.

## CU07 Handover Center

Show final document checklist, manuals, instructions, warranty details, training / demonstration record, outstanding items and customer sign-off.

# 46. MASTER PERMISSION MODEL

Use both role permissions and resource scope. A permission is not simply “Sales can edit leads”. Define:

`subject + action + resource + scope + conditions`.

Examples:
- `sales.lead.read` scoped to assigned leads.
- `sales.lead.create` scoped to AIEC organization.
- `survey.measurement.submit` scoped to assigned survey.
- `technical.configuration.approve` scoped to authorized technical reviewer.
- `partner.project.read` scoped to projects assigned to that partner tenant.
- `technician.task.submit` scoped to assigned task and active partner membership.
- `qa.inspection.decide` scoped to assigned inspection and independent QA role.
- `finance.payment.verify` scoped to permitted company finance records.
- `finance.payout.release` restricted to a separate approver / authorized process.
- `customer.project.read` scoped to projects linked to customer membership.

## 46.1 Permission checks

Check permissions in:
1. Navigation / UI rendering for usability.
2. API / server action before business operation.
3. Database RLS before reading or mutating rows.
4. Storage policy before file retrieval or upload.

All layers must agree. UI hiding is not authorization.

## 46.2 Segregation of duties

Where feasible, prevent:
- Requester approving own exceptional discount.
- User verifying own payment claim.
- Partner approving AIEC payout.
- Technician approving own submitted work.
- Partner internal QA being treated as AIEC independent QA.
- User editing approved technical configuration without a revision.
- User modifying audit log.

## 46.3 Permission change lifecycle

Role permission changes require an authorized administrator, effective timestamp, reason and audit record. Revoked access must take effect on subsequent server requests and should invalidate active sessions where necessary.

# 47. STATE MACHINES AND TRANSITION TABLES

Implement separate state machines for Lead, Survey, Technical Review, Quotation, Order, Project, Task, Payment, Procurement, Partner, QA Defect, Handover and Warranty. Do not use one giant `status` enum for the entire application.

For each state machine document:
- States.
- Valid transitions.
- Actor / role.
- Preconditions.
- Required fields.
- Required attachments.
- Approval requirements.
- Side effects.
- Notification recipients.
- Audit event.
- Retry behavior.
- Cancellation / reopening behavior.

Example Task states:

| Current | Action | Next | Required condition |
|---|---|---|---|
| Draft | Assign | Assigned | Valid project and assignee |
| Assigned | Accept | Accepted | Active user and partner membership |
| Accepted | Start | In Progress | Prerequisites and safety pre-start pass |
| In Progress | Block | Blocked | Blocker reason |
| In Progress | Submit | Submitted | Required checklist / evidence complete |
| Submitted | QA pass | Approved | Authorized QA decision |
| Submitted | QA fail | Rework | Defect created |
| Rework | Resubmit | Submitted | Correction evidence attached |
| Approved | Close | Closed | Downstream transition permits closure |

An invalid transition must return a structured error with current state, allowed actions and a human-readable explanation.

# 48. APPROVAL MATRIX AND EXCEPTION FRAMEWORK

Create configurable approval policies with:
- Action type.
- Amount / percentage threshold where applicable.
- Project risk level.
- Requester role.
- Required approver role(s).
- Sequential or parallel approval.
- Quorum if required.
- Delegation rules.
- Expiry.
- Escalation time.
- Prohibited override conditions.

Every exception request must contain:
- What normal rule is being bypassed.
- Why the exception is needed.
- Business impact.
- Customer impact.
- Safety / compliance impact.
- Financial impact.
- Supporting evidence.
- Compensating control.
- Expiry / review date.

No exception may bypass a legally mandatory permission, a critical safety stop or a missing professional sign-off that is required for the work.

# 49. COMMERCIAL RULES AND PROJECT ECONOMICS

## 49.1 Quotation composition

Build quotation lines from controlled categories:
- Lift equipment.
- Cabin and finishes.
- Door system.
- Controller / drive components.
- Installation scope.
- Transport and handling.
- Electrical / civil interface scope where included.
- Additional options.
- Taxes.
- Discounts.
- Other contractually defined charges.

For each line store quantity, unit, rate, taxable basis, tax code configured by finance, discount, total and source of cost. Use decimal-safe money arithmetic, not floating-point calculations.

## 49.2 Margin control

Show:
- Selling price excluding taxes where appropriate.
- Estimated direct costs.
- Committed direct costs.
- Forecast direct costs.
- Actual direct costs.
- Gross contribution.
- Margin percentage.

Define formulas centrally and test them. Never silently treat tax collected as revenue or gross contribution as net profit.

## 49.3 Contract terms

A quotation / order must version:
- Scope of supply.
- Scope of installation.
- Customer responsibilities.
- Site readiness requirements.
- Exclusions.
- Price and tax treatment.
- Payment milestones.
- Delivery assumptions.
- Project schedule assumptions.
- Warranty terms.
- Delay / extension terms.
- Variation process.
- Cancellation terms.
- Dispute process.
- Applicable legal terms reviewed by counsel.

## 49.4 Payment milestone engine

Do not hard-code a universal 30/40/20/10 schedule. Create templates by product / contract type. Each milestone has trigger, percentage or amount, evidence, invoice requirement, due date rule, verification rule and consequence if unpaid.

## 49.5 Partner commercial contract

Record agreed scope, price basis, milestone, deliverable, acceptance criteria, material responsibility, rework responsibility, insurance obligations, safety obligations, documentation, variation process, payment timeline, dispute handling and termination conditions. Legal counsel must review templates.

# 50. PROJECT COMPLEXITY, READINESS AND TIMELINE PROMISES

Classify project planning complexity using configurable factors, not only floor count:
- Lift category and capacity.
- Number of stops and travel.
- Shaft readiness and dimensions.
- Structural condition.
- Machine room / drive arrangement.
- Custom cabin / doors.
- Manufacturer lead time.
- Site access and logistics.
- Existing construction activity.
- Electrical readiness.
- Inspection / approval dependencies.
- Partner capability and manpower.

Readiness must be separately scored:
- Technical readiness.
- Site readiness.
- Payment readiness.
- Material readiness.
- Partner readiness.
- Documentation / approval readiness.

Only show an accelerated target such as 14 days when all defined eligibility conditions are met, the target is approved and the assumptions are visible. Use labels such as `target`, `forecast` and `contractual commitment` distinctly. Never convert an internal target into a customer promise automatically.

# 51. EVIDENCE AND DOCUMENT GOVERNANCE

## 51.1 Evidence metadata

Store:
- Evidence ID.
- Project ID.
- Related entity / task / inspection.
- Category.
- File path.
- File hash / checksum.
- Captured by.
- Capture timestamp.
- Server received timestamp.
- GPS coordinate and accuracy if captured.
- Device / app version if appropriate.
- Upload status.
- Revision / supersession relationship.
- Access classification.

## 51.2 File controls

- Restrict file type and file size.
- Scan uploads where infrastructure supports it.
- Use private storage buckets.
- Use short-lived signed URLs.
- Enforce organization and project access.
- Maintain download audit for sensitive documents.
- Do not put private file URLs in public notifications.
- Preserve original evidence; corrections create a new version.

## 51.3 Document classes

- Customer documents.
- Site drawings.
- Technical drawings.
- Quotations / contracts.
- Supplier documents.
- Partner compliance.
- Worker training / identity documents.
- Payment documents.
- QA / test records.
- Statutory records.
- Handover manuals.
- Warranty / AMC.

Each class must have retention, visibility and editing policies reviewed by the business and legal adviser.

# 52. OFFLINE-FIRST SYNCHRONIZATION SPECIFICATION

## 52.1 Offline capabilities

Surveyors and Technicians may need to work in basements, shafts and locations with poor connectivity. Support:
- Downloading assigned work packages.
- Cached approved instructions and drawings.
- Local draft forms.
- Local measurement capture.
- In-app camera evidence capture.
- Checklist completion.
- Incident / blocker reporting.
- Queued uploads.

Do not cache unrestricted customer, financial or partner data on field devices.

## 52.2 Sync record contract

Every offline mutation should include:
- Client-generated operation UUID.
- User ID.
- Organization ID.
- Record ID.
- Operation type.
- Base server revision.
- Client creation time.
- Payload version.
- File references.
- Sync attempt count.

Server must enforce idempotency using operation UUID. Repeated delivery must not create duplicate tasks, evidence, reports or ledger entries.

## 52.3 Conflict handling

Do not apply last-write-wins to approved technical, commercial, payment or QA records. For conflicts:
- Compare base revision with current server revision.
- Identify fields changed by each side.
- Preserve both drafts.
- Require authorized resolution.
- Record resolution event.

## 52.4 User feedback

Show per-record status:
- Saved on device.
- Waiting to sync.
- Uploading.
- Synced.
- Failed — retry available.
- Conflict — action required.

Never show `Submitted` or `Approved` when the server has not acknowledged the operation.

# 53. DATABASE IMPLEMENTATION DETAILS

## 53.1 Common columns

Most business tables should use:
- `id` UUID primary key.
- `organization_id` where organization scope applies.
- `created_at` server timestamp.
- `created_by` user reference.
- `updated_at` server timestamp.
- `updated_by` user reference.
- `version` integer for optimistic concurrency.
- `status` only where a defined state machine exists.

Do not add generic `status` columns without defining their semantics and allowed transitions.

## 53.2 Relationship rules

- A lead may have one or more contacts and activities.
- A site may be related to multiple projects over time.
- A survey has revisions.
- A technical configuration has revisions.
- A quotation has revisions.
- An order creates one or more project records only where the business contract requires it.
- A project has multiple assignments over time.
- A task has one or more assignees and evidence records.
- A task may have multiple inspection attempts.
- A defect may have multiple corrective actions and reinspection records.
- A project may have multiple purchase orders and GRNs.
- A payment may be allocated across one or more invoices / milestones where finance policy permits.
- A completed project creates a lift asset record for warranty / service.

## 53.3 Indexing

Add indexes for:
- organization_id + created_at.
- project_id + status.
- assigned_user_id + due_date.
- partner_company_id + project status.
- normalized phone / email as policy permits.
- geo location using PostGIS indexes.
- unique business identifiers.
- foreign keys used in RLS policies.
- notification recipient + read status.
- audit actor + date and entity + date.

Use pagination. Do not load all project records into a mobile screen.

## 53.4 Data integrity

Use foreign keys, unique constraints, check constraints and transactions. Use database functions or secure server operations for multi-record state transitions such as order conversion, payment allocation and QA closure. Avoid partially completed workflows.

# 54. API / SERVER ACTION CONTRACTS

For each operation define a typed request and response. Expected operation groups:

### Authentication / profile
- get-current-user.
- get-role-context.
- update-profile.
- request-access-change.

### Leads
- create-lead.
- search-possible-duplicates.
- assign-lead.
- record-activity.
- qualify-lead.
- close-lead.

### Survey
- create-survey-assignment.
- check-in-survey.
- save-survey-draft.
- upload-evidence.
- submit-survey.
- request-survey-revision.

### Technical
- create-review.
- request-clarification.
- record-feasibility-decision.
- approve-configuration.
- submit-change-request.
- approve-drawing-revision.

### Commercial
- create-quotation-draft.
- request-discount-approval.
- issue-quotation.
- record-customer-response.
- accept-quotation.
- convert-to-order.

### Project / operations
- create-project.
- run-readiness-check.
- assign-partner.
- publish-baseline-schedule.
- create-task.
- submit-daily-report.
- escalate-delay.

### Finance / procurement
- submit-payment-claim.
- verify-payment.
- allocate-payment.
- create-purchase-request.
- approve-purchase-order.
- receive-material.
- submit-partner-milestone-claim.
- approve-payout.

### Execution / QA
- accept-project-invitation.
- assign-technician.
- start-task.
- block-task.
- submit-task.
- create-inspection.
- record-inspection-result.
- create-defect.
- submit-rework.
- close-defect.

### Handover / lifecycle
- perform-handover-readiness-check.
- record-customer-handover.
- create-lift-asset.
- activate-warranty.
- create-amc-offer.

For every operation specify authentication, permission, input validation, transaction boundary, idempotency key, audit event, notifications, error codes and retry policy.

# 55. STANDARD ERROR CATALOGUE

Return structured error codes, for example:
- `AUTH_REQUIRED`.
- `ACCESS_DENIED`.
- `TENANT_SCOPE_VIOLATION`.
- `PROJECT_NOT_ASSIGNED`.
- `INVALID_STATE_TRANSITION`.
- `REQUIRED_FIELD_MISSING`.
- `EVIDENCE_REQUIRED`.
- `APPROVAL_REQUIRED`.
- `APPROVAL_EXPIRED`.
- `PAYMENT_NOT_VERIFIED`.
- `PARTNER_COMPLIANCE_BLOCK`.
- `SITE_NOT_READY`.
- `MATERIAL_NOT_READY`.
- `SAFETY_STOP_ACTIVE`.
- `REVISION_CONFLICT`.
- `DUPLICATE_OPERATION`.
- `OFFLINE_SYNC_REQUIRED`.
- `FILE_UPLOAD_FAILED`.

UI must translate these codes into a helpful explanation and next action. Never expose SQL errors, stack traces, secrets or internal infrastructure details to end users.

# 56. INTEGRATION SPECIFICATION

Integrations must be optional, replaceable and protected by server-side secrets.

## Maps / geo
- Store coordinates and accuracy.
- Support navigation deep links.
- Use PostGIS for distance / duplicate candidate search where suitable.
- Do not use location data beyond disclosed purposes.

## Messaging
- WhatsApp / SMS / email messages must use approved templates where required.
- Log provider response, message ID, delivery state and failure.
- Prevent duplicate sends from retries.
- Provide opt-out / communication preference handling where required.

## Payments
- Use provider webhooks with signature verification.
- Verify transaction status server-side.
- Use idempotency for payment creation.
- Never trust client-supplied payment success.

## E-sign / document signing
- Store signed document, signer identity, timestamp, document hash and provider reference.
- Verify signing provider response.
- Do not claim legal enforceability without counsel review.

## Accounting export
- Export controlled invoices, receipts, expenses and ledger entries.
- Reconcile imports and avoid duplicate postings.

# 57. ANALYTICS DEFINITIONS

Create a data dictionary for every metric.

Examples:
- Lead response time = first meaningful contact timestamp minus lead created timestamp.
- Lead-to-survey conversion = leads with completed survey divided by eligible leads in the selected cohort.
- Quote conversion = won quotations divided by valid issued quotations in the selected cohort.
- Project schedule variance = actual / forecast milestone date minus baseline date.
- QA first-pass rate = first submitted inspections passed divided by first submitted inspections decided, excluding cancelled records by documented rule.
- Rework rate = tasks requiring rework divided by tasks submitted for QA.
- Collection efficiency = verified collections against due amounts for the same defined period / cohort.
- Gross project contribution = approved revenue basis minus direct project costs, using one documented accounting basis.

Always display denominator, cohort, date range and exclusion rules. Do not mix monthly order intake with monthly cash collection.

# 58. ACCESSIBILITY, LOCALIZATION AND FIELD USABILITY

- Support English initially and design for Marathi / Hindi localization.
- Store labels as translation keys, not hard-coded strings.
- Use Indian number formatting and INR display.
- Support mobile number formatting with country code.
- Use local date / time display while storing timezone-aware timestamps.
- Use explicit units for all engineering fields.
- Ensure touch targets are usable with work gloves where practical.
- Provide readable outdoor contrast.
- Support larger text settings.
- Do not encode status using color alone.
- Provide screen-reader labels.
- Allow safe form recovery after app closure.

# 59. TESTING STRATEGY AND RELEASE GATES

## 59.1 Unit tests

Test field validators, financial calculations, state transition validators, permission evaluators, duplicate scoring, schedule calculations and data formatting.

## 59.2 Integration tests

Test database transactions, RLS, storage policies, notifications, webhook handling, audit events and offline synchronization.

## 59.3 Role authorization tests

For every role test allowed and denied access to every sensitive entity. Include direct API requests, not just UI tests.

## 59.4 Tenant isolation tests

Create Partner A and Partner B. Verify Partner A cannot list, read, update, delete, infer or download Partner B's data through API, database, search, storage or notifications.

## 59.5 Workflow tests

Exercise the complete lead-to-handover workflow and all rejection, hold, rework, cancellation, variation and retry paths.

## 59.6 Device tests

Test low-memory Android devices, low bandwidth, loss of network during upload, app termination during draft, permissions denied, GPS unavailable, camera unavailable, clock mismatch and expired session.

## 59.7 Release gates

A release is blocked if:
- Any critical RLS / tenant isolation test fails.
- Payment verification can be spoofed from client.
- A safety stop can be bypassed through ordinary role actions.
- A Technician can approve own work.
- A Partner can access another tenant's records.
- Approved technical / commercial revisions can be overwritten silently.
- Required audit events are missing.
- Data loss occurs in offline sync tests.

# 60. ACCEPTANCE CRITERIA — ROLE BY ROLE

## Owner
- Can see reconciled company-wide KPIs.
- Can drill into source records.
- Can approve only authorized requests.
- Can see risk and overdue exceptions.
- Cannot erase audit history.

## Operations
- Can plan project from confirmed order.
- Can assign eligible Partner.
- Can monitor milestones and blockers.
- Cannot bypass technical, finance, QA or safety gates.

## Sales
- Can create and manage leads.
- Can detect possible duplicates.
- Can issue only approved quotation revision.
- Cannot invent final technical specification or exceed discount limits.

## Surveyor
- Can capture survey offline.
- Can attach evidence to correct project.
- Can submit only when minimum requirements met or exception documented.
- Cannot mark feasibility approved.

## Technical
- Can review, clarify and approve versioned configuration.
- Can record decision rationale.
- Can control BOM / drawing revisions.
- Cannot silently alter commercial contract.

## Accounts
- Can verify actual receipts and reconcile ledger.
- Can prepare controlled payouts.
- Cannot trust client screenshots as settled payment.
- Cannot silently adjust balances.

## Procurement
- Can procure against approved BOM.
- Can compare suppliers and track delivery.
- Cannot substitute technically different material without approval.

## Partner Admin
- Can manage its own organization and team.
- Can see only assigned projects.
- Can submit daily reports and milestone claims.
- Cannot approve AIEC QA or release its own payout.

## Technician
- Can view assigned work and approved instructions.
- Can capture evidence offline.
- Cannot change approved drawings or approve own work.
- Cannot proceed through critical safety stop.

## QA
- Can independently inspect and record defects.
- Can require rework.
- Can close defects only with evidence.
- Cannot make a statutory approval claim without official record.

## Customer
- Can view own authorized project.
- Can approve exact document revisions.
- Can view verified receipts.
- Cannot see internal margin, partner confidential records or other customers' data.

# 61. BUILD SEQUENCE — VERTICAL SLICES

Do not build all screens as static mockups first. Complete one vertical slice end to end.

## Slice 1: Identity and access
- Login.
- Profile.
- Organization membership.
- Role context.
- RLS.
- Basic audit.

## Slice 2: Lead to survey
- Lead creation.
- Assignment.
- Duplicate candidate review.
- Survey scheduling.
- Field capture.
- Offline draft and sync.

## Slice 3: Technical and quotation
- Survey review.
- Feasibility.
- Configuration revision.
- Costing.
- Quotation approval.
- Customer acceptance.

## Slice 4: Order to procurement
- Order conversion.
- Project creation.
- Payment milestone.
- Purchase request.
- Supplier PO.
- GRN.

## Slice 5: Partner execution
- Partner onboarding.
- Compliance checks.
- Assignment.
- Team / technician.
- Tasks.
- Daily evidence.

## Slice 6: QA to handover
- Inspection.
- Defect / rework.
- Final QA.
- Statutory evidence tracking.
- Handover.
- Warranty asset.

Each slice must include its own design, database migrations, APIs, RLS, UI, tests and documentation before proceeding.

# 62. MVP SCOPE CONTROL

The first production MVP should focus on a complete and reliable new-installation lifecycle, not every possible future feature.

Must-have:
- Role-based authentication.
- Lead and customer records.
- Survey and evidence.
- Technical review and approved configuration.
- Quotation and approval.
- Order and project creation.
- Project assignment.
- Partner onboarding and eligibility.
- Task execution and evidence.
- Basic procurement / material readiness.
- QA and defect loop.
- Payment verification / ledger basics.
- Customer progress portal.
- Handover checklist.
- Audit and RLS.

Defer unless already working:
- Advanced AI prediction.
- Complex gamification.
- Full payroll.
- Public partner marketplace.
- Multi-country tax logic.
- Advanced fleet routing.
- Fully automated price configurator.
- Automated statutory submissions.

Do not remove architecture hooks for future expansion, but do not build speculative features before core lifecycle correctness.

# 63. DEMO DATA AND DEMO MODE

Create synthetic demo data only. Use fictional customer names, sites, phone numbers and partner companies. Clearly mark demo environment. Ensure demo users cannot access production data. Do not use real user data in tests or screenshots.

Provide at least:
- 5 sample projects across different stages.
- 2 sample Partner companies.
- 6 sample technicians.
- 8 leads in different statuses.
- 3 quotations with revisions.
- 2 purchase orders.
- 2 QA defects, including one rework loop.
- Sample payments with verified / pending / rejected states.
- One project blocked by missing site readiness.
- One project with missing partner document.

# 64. DEFINITION OF DONE

A feature is Done only when:
- Requirements traceability is complete.
- UI is implemented with all important states.
- Validation exists on client and server.
- Permission rules are verified at API and RLS layers.
- Database migration is reviewed and reversible where practical.
- Audit events are recorded.
- Notifications are correct and retry-safe.
- Offline behavior is defined where relevant.
- Accessibility has been checked.
- Automated tests pass.
- Manual acceptance test passes on target Android device.
- Error monitoring is in place.
- Documentation is updated.
- No known critical security / data integrity defect remains.

# 65. FINAL AI EXECUTION PROMPT

You are now responsible for turning this specification into a dependable AIEC product. Work in the existing repository unless a new repository is explicitly requested. Do not stop at mockups or static screens. Do not fabricate completed APIs, integrations or tests. Do not claim a feature works unless it has been implemented and verified.

Start with repository audit and requirements traceability. Then produce a concise implementation plan identifying the first vertical slice. Implement incrementally. After each slice, report:

1. Files inspected.
2. Files created / modified.
3. Database migrations.
4. Screens / routes completed.
5. APIs / server actions completed.
6. RLS / permission rules implemented.
7. Tests run and their actual results.
8. Known limitations and unresolved decisions.
9. Next recommended slice.

Never invent test results, build results, security assurance or statutory compliance. Preserve working code. Use explicit, reviewable migrations. Keep sensitive credentials out of source control. Prefer robust business correctness over a large screen count.

**The final objective is not a 200-screen prototype. The objective is a controlled, auditable and field-reliable elevator installation operating system that can run AIEC's actual lead-to-handover workflow with clear ownership, evidence, approvals, partner governance, financial discipline and customer transparency.**

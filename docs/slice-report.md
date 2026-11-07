# Slice report — Slices 1 to 6 (§65)

## 1. Files inspected

`AIEC_Role_Wise_Master_Prompt_v2_Deep_Implementation.md` (entire specification). The repository had no code — see `docs/repository-audit.md`.

## 2. Files created

| Path | Purpose |
|---|---|
| `packages/domain/` | Framework-free business rules shared by DB tests, web and mobile: error catalogue, roles / permissions / segregation of duties, 13 state machines, decimal-safe INR money, quotation economics, payment-milestone engine and Gate 5, survey Gate 1 and units, duplicate scoring (pg_trgm-compatible), partner / site / safety / handover / warranty gates, offline `SyncQueue`, lead scoring, i18n keys, metric dictionary |
| `supabase/migrations/` (5 files) | Schema, RLS, RPCs, triggers, seeds for slices 1–2 |
| `supabase/tests/` | Integration test harness (impersonates Supabase roles/JWT on real PostgreSQL + PostGIS) and suites |
| `apps/web/` | Next.js 15 admin web (Owner, Sales, Technical, Operations, admin) |
| `apps/mobile/` | Expo SDK 58 Android field app (Surveyor) |
| `docs/` | Audit, decision register, traceability, permission matrix, state machines, API contracts, this report |
| `.github/workflows/ci.yml` | CI: unit, DB, web build, mobile typecheck/tests |

## 3. Database migrations

| Migration | Contents |
|---|---|
| `20261106000100_foundation_identity_rbac_audit.sql` | Extensions, `app` schema, organizations (single AIEC org), profiles (auto-created from `auth.users`, pending by default), memberships, role grants (org-kind + membership validated by trigger, immutable grants), role/permission catalogue seeded from `@aiec/domain`, append-only `audit_logs` (update/delete/truncate blocked by trigger), versioned `business_rules`, business-ID sequences, `sync_operations` idempotency, deduplicated `notifications`, permission helpers, RLS, grants (SELECT-only for clients) |
| `20261106000200_identity_rpcs.sql` | Role context, profile, organization / membership / role / status administration with last-Owner protection and tenant-scoped partner administration, business-rule versioning, notifications, operator bootstrap |
| `20261106000300_leads.sql` | Enums, `state_transitions` (seeded from domain), safe JSON readers, sites (PostGIS), leads, append-only activities and duplicate decisions, duplicate finder (pg_trgm + PostGIS), lead score, lead RPCs, RLS |
| `20261106000400_surveys_evidence.sql` | Surveys (no-double-booking exclusion constraint), immutable submitted revisions, measurements (server-normalized), immutable evidence with supersession, private `evidence` bucket + storage policies, Gate 1 function, survey RPCs, RLS |
| `20261106000500_directory.sql` | `list_assignable_users` (id + name only) |
| `20261106000600_locale.sql` | Marathi default for new profiles; `set_my_locale` (audited) |
| `20261106000700_technical_quotation.sql` | **Slice 3.** Transitions for technical review, document revision and quotation (seeded from the domain); launch rules (configuration catalogue, tax codes, discount policy, validity); `technical_reviews` (bound to the exact submitted survey revision, decisions immutable); `configuration_revisions` (catalogue-checked, checksum, frozen when approved, one draft / one approved per lead); `technical_documents` + `document_revisions` in a private `technical-documents` bucket (approval names the file checksum; new upload never replaces the approved revision); `quotations`, `quotation_revisions`, `quotation_lines` (server-computed paise, mirror of `computeQuotation`), append-only `quotation_negotiations` and `customer_acceptances`, `approval_requests` (O04); RPCs and RLS (prices/costs only for the lead's sales owner and Owner) |
| `20261107000800_order_procurement.sql` | **Slice 4.** Enums and transitions for order, project, payment, material line, BOM, purchase request and purchase order (seeded from the domain); rules `payment.milestone_templates` and `procurement.po_approval_limit`; `app.allocate` (largest remainder) and `app.compute_purchase_order` (parity-tested with the domain); orders, projects (title / site snapshot), immutable payment milestones, payment claims (decided claims immutable, recorder ≠ verifier), Gate 5 `app.payment_gate`, BOM revisions / lines (approved lines locked), purchase requests / lines (Gate 6), supplier quotes, purchase orders / lines (fixed lines, per-line material status), goods receipts (only accepted, undamaged quantity counts); 20 RPCs; RLS separating project, customer-money and supplier-price visibility; `staff_display_names` (names only) |
| `20261107000900_partner_execution.sql` | **Slice 5.** Enums and transitions for the partner, assignment and task machines (generated from the domain); rules for partner document requirements, the task template, safety checks and the site checklist; partner profiles and immutable compliance documents (private `partner-documents` bucket) with AIEC verification; Gate 7 eligibility per lift category (`app.evaluate_partner_compliance`, parity-tested); append-only site readiness (Gate 8); invitations bound to the offer's SHA-256; project team (history kept) and worker skills; installation tasks with safety pre-start (Gate 11, `app.evaluate_safety_check`), checklist, immutable evidence (private `execution-evidence` bucket) and submission (Gate 9); incidents whose safety stops only AIEC lifts; immutable daily reports with AIEC comments; installation readiness and start; 25 RPCs; RLS separating partner tenants and hiding commercial terms from technicians |
| `20261108001000_quality_handover.sql` | **Slice 6.** Enums and transitions for the defect, handover and warranty machines (generated from the domain); rules `qa.checklists`, `statutory.required_evidence`, `handover.required_documents`, `warranty.terms`; QA inspector read scope; independent-inspector check (only AIEC / QA-agency holders of `qa.inspection.decide`; members of the installing partner are refused — Gate 10); `qa_inspections` (outcome computed by `app.evaluate_inspection`, parity-tested) and `defects` (DF numbers, never deleted; a failed task goes to rework and a critical defect alerts Operations); correction evidence bound to a defect; rework → resubmission; final QA over every task and open defect; statutory evidence in a private `handover-documents` bucket, verified by someone other than the recorder (Gate 12); handover documents and package; customer organization linked to the project; customer acceptance or issue (Gate 13) which creates the lift asset (LA numbers) and activates the warranty from the contractual start event (Gate 14, `app.warranty_end` parity-tested); project close; 11 RPCs; RLS giving the customer only the project row, handover package, handover status and warranty |

## 4. Screens / routes completed

Web: `/login`, `/auth/callback`, `/auth/signout`, `/setup-required`, `/` (role-aware KPIs with stated basis and reconciling drill-downs), `/leads` (SE03 list/search/pagination), `/leads/new` (SE02 + SE03 duplicate review), `/leads/[id]` (SE04/SE05/SE06/SE07/SE14 + survey booking SE08, assignment/reopen), `/surveys`, `/surveys/[id]` (TE02 read + revision request, GPS exception review, reschedule/cancel), `/admin/users` (O10), `/audit` (O12), `/notifications`. **Slice 3:** `/technical` (TE01 queue: waiting surveys oldest first, open reviews, feasible-without-configuration, documents in review), `/technical/reviews/[id]` (TE02 side-by-side survey values + decision / clarification, TE03 configuration builder with live catalogue check and approval, TE04 document upload with server-side SHA-256, submit, checksum-bound approve / reject), lead detail technical + quotation cards, `/quotations` and `/quotations/[id]` (SE08 draft editor with live preview from the shared engine, submit, SE09 issue + customer response bound to the content hash, revisions, SE10 negotiation log), `/approvals` (O04: requester, reasons, policy threshold, impact; approve / reject / more information; own requests blocked). Home KPIs for open reviews, pending approvals and issued quotations. Each has loading, empty, error, permission-denied and pending/suspended states.

Mobile (Android): Login (OTP), SV01 My surveys (offline cache, online/sync chips, pull to refresh), SV02–SV10 in one survey workspace (accept, check-in with honest GPS exception, building / shaft / machine room / electrical / logistics sections, measurements with explicit unit selector, camera evidence per category, documents or unavailability reason, review with Gate 1 preview and plausibility warnings, submit), SV11 revisit / inaccessible / start revision, WT09-style Sync queue with per-record status and conflict discard.

Slice 4 web: `/projects` (list, status filter), `/projects/[id]` (order, handover acceptance, Gate 5 status per step, milestone table with verified / outstanding money from the domain `milestoneStatuses`, payment claims with record / verify / resubmit, exception requests, BOM editor and approval, purchase requests and orders, new purchase request from approved BOM lines), `/procurement` (open requests, active and finished POs), `/procurement/requests/[id]` (lines, side-by-side supplier quotes with the lowest matching offer marked, add quote, select supplier with rationale, create PO), `/procurement/orders/[id]` (totals, submit / approval / issue, per-line material status buttons, goods receipt with inspection, receipt history), `/finance` (claims to verify, oldest first, recent decisions), convert-to-order card on `/quotations/[id]`, PO and payment-exception cards in `/approvals`, nav items and four KPIs (projects awaiting handover acceptance, claims to verify, open purchase requests, POs awaiting receipt). All in Marathi and English.

Slice 5 web: `/partners` and `/partners/[id]` (AIEC: status, documents to verify with verify / reject, lifecycle decisions, eligibility per lift category); on `/projects/[id]` the installation readiness card (six dimensions, mark ready, start installation), the site readiness checklist, partner invitation from the eligible list (ineligible partners shown with the reason), assignment actions, task board, incidents with resolve / lift safety stop, daily reports with comments; partner workspace `/partner` (status, compliance, invitations, projects), `/partner/company` (profile, document upload, submission), `/partner/team` (skills, training), `/partner/assignments/[id]` (offer with revision hash, accept / decline / clarify, project team, task assignment by skill, unblock, daily report, incidents); technician `/work` and `/work/[id]` (accept, safety pre-start, start, checklist, photo evidence, blocker / incident, submit). Nav items and five KPIs. All in Marathi and English.

Slice 6 web: `/qa` (AIEC QA queue: submitted tasks oldest first, final QA requests, open defects), `/qa/tasks/[id]` (checklist per task with pass / fail / hold / not applicable with reason, a defect per failed criterion with category, severity, location, description and due date, re-inspection of corrected defects with verify / reject, dispute resolution), `/qa/projects/[id]` (final QA over every stage); on `/projects/[id]` the quality and handover card (stage inspection status, open defects, request final QA, statutory documents with upload / verify / reject and clearance, handover documents, customer organization link, send package, re-check, close); technician `/work/[id]` rework card (start correction, correction photo per defect, resubmit); partner `/partner/assignments/[id]` defects card (acknowledge / dispute); customer portal `/customer` and `/customer/projects/[id]` (handover package, accept with name or raise an issue, lift asset and warranty dates). Nav items and five KPIs. All in Marathi and English.

## 5. APIs / server actions completed

See `docs/api-contracts.md` — 10 identity/admin RPCs, 8 lead RPCs, 10 survey/evidence RPCs, 1 directory RPC, 1 locale RPC, 16 Slice 3 RPCs (technical review 3, configuration 2, documents 3, quotations 7, approvals 1), 21 Slice 4 RPCs (orders / projects 2, payments 5, BOM 2, purchasing 11, staff names 1), 24 Slice 5 RPCs (partner company 5, readiness and assignment 4, team 2, tasks and safety 9, daily reports 2, project readiness 2), and 11 Slice 6 RPCs (inspection 1, defects 1, correction evidence 1 (replaced), resubmission 1, project quality 1, statutory 2, handover documents 1, customer link 1, handover 1, customer decision 1).

## 6. RLS / permission rules implemented

RLS enabled on every table; clients hold SELECT only. Scope rules: tenant isolation for partner people data, lead visibility (owner or `lead.read_all`), survey visibility (assigned surveyor, `survey.read_all`, the lead's owner), sales history hidden from field and technical roles, audit to `audit.read`, private evidence storage bound to survey scope with upload only by the assigned surveyor during capture and no update/delete. Segregation of duties listed in `docs/permission-matrix.md`.

## 7. Tests run and actual results

**Slice 6 run (2026-11-07, this environment):**

| Suite | Result |
|---|---|
| Domain unit tests (`npm test`) | **995 passed** (new quality tests: inspection outcome with critical / not-applicable rules, required defect fields, open defect states, statutory evidence, warranty from the contractual start event; Marathi and English labels for every new state, action, criterion, document type and notification) |
| Database integration (`npm run test:db`) | **80 passed**: 3 Slice 6 tests (only independent AIEC QA inspects, a failure needs a defect, rework closes only through verified correction evidence; a disputed defect returns to QA and a hold keeps the work submitted; final QA, statutory evidence verified by a second person and hidden from the customer, handover package, customer acceptance creating the lift asset and warranty — the customer never sees orders, milestones, tasks, defects, partner terms, POs or BOMs) + parity for the 3 new machines, 4 rules, 60 random inspection cases and the warranty end date |
| Typecheck all workspaces, `check:i18n` | passed (2,650 dictionary keys, no hard-coded English) |
| Browser E2E (production build) | **77/77 in Marathi** (with the visible-English scan) and **77/77 in English**: 11 new Slice 6 steps across QA inspector, partner admin, technician, Operations, Owner and customer |
| GitHub Actions CI on the PR | passed |

**Slice 5 run (2026-11-07, this environment):**

| Suite | Result |
|---|---|
| Domain unit tests (`npm test`) | **872 passed** (17 new execution tests: Gate 7 per lift category and expiry, invitation machine, Gate 8, safety pre-start with no override, task template, prerequisites, Gate 9, daily report; Marathi and English labels for every new state, action, audit event, enum, checklist item and safety control) |
| Database integration (`npm run test:db`) | **76 passed**: 9 Slice 5 tests (onboarding and AIEC-only verification, eligibility and tenant isolation, site readiness, invitations bound to the offer hash, installation readiness, skilled assignment and safety-gated start, Gate 9 submission and immutable evidence, safety stop lifted only by AIEC, daily reports) + parity for the 3 new machines, 4 rules, 60 random compliance / site-readiness / safety cases |
| Typecheck all workspaces, `check:i18n` | passed (2,352 dictionary keys, no hard-coded English) |
| Browser E2E (production build) | **67/67 in Marathi** (with the visible-English scan) and **67/67 in English**: 15 new Slice 5 steps across Owner, Operations, partner admin, technician and a second partner |

Defects found and fixed while building Slice 5: an existing label (`field.assignee_id`, "Sales owner") would have been renamed for tasks (separate key added); names on record cards failed through the test gateway because the names RPC took `uuid[]` (it now takes a JSON array); a safety check recorded before a safety stop was still shown as "safe to start" (only checks after the latest stop count, matching the server rule); four E2E steps waited for a button to disappear, which also happens while it shows "Working…" (they now wait for the server action's response).

**Slice 4 run (2026-11-07, this environment):**

| Suite | Result |
|---|---|
| Domain unit tests (`npm test`) | **664 passed** (PO maths, goods-receipt acceptance, milestone templates, machines, Marathi and English labels for every new state, action, audit event, enum and handover item) |
| Database integration (`npm run test:db`) | **66 passed**: 9 Slice 4 tests (Gate 4 conversion, handover acceptance, claims vs verified money and recorder ≠ verifier, time-limited exceptions, BOM approval and locking, Gate 6 purchase requests, PO approval limit with segregation of duties, partial receipts, staff names) + parity for the 7 new machines, rules, allocation and PO totals |
| Typecheck all workspaces, `check:i18n` | passed (1,845 dictionary keys, no hard-coded English) |
| Browser E2E (production build) | **52/52 in Marathi** (with the visible-English scan) and **52/52 in English**: 16 new Slice 4 steps from order conversion to a closed PO, plus "procurement does not see the contract value" and "sales cannot open the PO" |

Defects found and fixed while building Slice 4: payment exceptions appeared in a quotation's approval history (now filtered by kind); approval-decided notifications for POs linked to a page Procurement cannot open (now link to `/procurement`); Finance could not see supplier names (policy extended) or who recorded a claim (names-only RPC); two E2E races (acting before a page had refreshed / hydrated).

**Slice 3 run (2026-11-07, this environment):**

| Suite | Result |
|---|---|
| Domain unit tests (`npm test`) | **457 passed** (incl. configuration catalogue, document and quotation machines, input helpers, Marathi dictionary coverage of every new state / enum / parameter) |
| Database integration (`npm run test:db`) | **57 passed**: 17 new Slice 3 tests + parity (enums, transitions, seeded rules, configuration check on edge cases, 40 random quotations identical in SQL and in the domain engine) |
| Typecheck all workspaces, web unit tests, `check:i18n` | passed (1,381 dictionary keys, no hard-coded English) |
| Browser E2E (production build) | **36/36 in Marathi** (with the visible-English scan) and **36/36 in English**: 11 new Slice 3 steps from technical queue to recorded customer acceptance, plus "technical reviewer cannot open prices" |

One E2E run showed a React hydration warning (#418) on the technical queue; it did not recur in four later runs or in isolated repetitions with and without queue items. Recorded as an open observation.

**Slices 1–2 run (2026-11-06):**

| Suite | Command | Result |
|---|---|---|
| Domain unit tests | `npm test` | **102 passed** |
| Database integration (PostgreSQL 16.15 + PostGIS 3, fresh DB, all migrations) | `npm run test:db` | **39 passed** |
| Mutation check | temporarily disabled the GPS-accuracy rule and the lead-owner check | both changes were caught by failing tests; restored |
| Web unit tests | `npm test --workspace @aiec/web` | **3 passed** |
| Web typecheck + production build | `npm run typecheck`, `npm run build:web` | passed (Next.js 15.5.29) |
| Web smoke (Playwright, production server, placeholder backend) | manual script | `/` and deep links redirect to `/login?next=…`; login renders on a 390 px viewport without horizontal scroll or JS errors; DEMO banner shown; security headers present |
| Mobile unit tests | `npm test --workspace @aiec/mobile` | **4 passed** |
| Mobile typecheck + Android JS bundle | `tsc --noEmit`; `expo export --platform android` | passed (773 modules, Hermes bytecode) |

| Browser E2E walkthrough (`e2e/`, production web build, real schema/RLS/RPCs via a local test gateway) | see `e2e/README.md` | **25/25 checks, 7 consecutive clean runs** (Sales, Owner, Technical, Partner, pending user, 390 px mobile width) |
| GitHub Actions CI on the PR | `.github/workflows/ci.yml` | passed |

### Defects found by the E2E walkthrough and fixed

| Symptom | Root cause | Fix |
|---|---|---|
| Soft navigations (link clicks, post-action navigation) into pages containing action forms intermittently never completed (~30–70% in production builds; not reproducible in dev) | Route-group `(app)/loading.tsx` Suspense boundary interacting with production client navigation in Next 15.5 | Removed the route-group loading boundary (per-action pending states remain): 20/20 navigations after the fix |
| Forms stuck on "Working…" after a successful save | `revalidatePath()` inside server actions under the same conditions | Actions return their result; forms call `router.refresh()` on success (`useRefreshOnSuccess`) |
| After "Create lead", the page did not open the new lead | Server-action `redirect()` / immediate `router.push()` aborted by the router | Full navigation to the new lead after creation (10/10) |
| Login could leave the app between two client transitions | `router.replace()` + `router.refresh()` after sign-in | Full page load after sign-in so middleware and server components see the new session cookie |
| Every lead in a list was prefetched (25 server renders per list view) | Default `<Link>` prefetch | `prefetch={false}` on authenticated links |
| Survey page labelled the reason of an already-submitted revision as "Revision requested" | Wording | "Reason for this revision" |
| DB test suite failed ~1 run in 5 | Random test names were occasionally similar enough for the (correct) duplicate detector | Test data now uses unrelated random words and random phone numbers: 0 failures in 15 consecutive runs |

Not run here: web flows against a hosted Supabase project (the E2E gateway stands in for Supabase's HTTP layer; Supabase Auth SMS delivery and Storage uploads are not exercised), and an installed Android build on a device.

## 8. Known limitations and unresolved decisions

- Slice 6 scope notes: QA checklists (D-034), required statutory evidence (D-035), handover documents and warranty terms (D-036, 12 months from handover acceptance) are launch placeholders for qualified-engineer, legal and Owner review — they are **not** a statutory test procedure. Statutory evidence is recorded and verified by AIEC; the system does not contact the Lift Inspectorate. Customer acceptance is by a named person in the customer portal (no e-sign). Maintenance contracts (AMC), warranty claims / service visits and the Android technician app with offline capture and GPS are not built.
- Slice 5 scope notes: technician work is done in the web app (phone-width pages; photos are uploaded and labelled `document_import`); the Android technician app with offline capture and GPS is planned with Slice 6. Partner payment claims (LP10), the partner ledger, variation requests (LP09), schedule baselines (OM05) and delay review (OM07) are not built. Required documents (D-029) and the task template (D-030) are placeholders for legal / engineering review. Expiry reminders are not sent yet (no scheduler); eligibility is re-checked at invitation and acceptance.
- Slice 4 scope notes: technical change requests (TE06) and component substitution, PO cancellation after issue, supplier onboarding screens (suppliers are organizations created by an administrator), customer invoices / accounting export and payment-gateway or bank-statement import are not built. Gate 5 is enforced for procurement; dispatch / installation / handover gates are shown and will be enforced by the Slice 5 workflows. Milestone templates (D-026) and the PO limit (D-027) are launch placeholders.
- Slice 3 scope notes: customer self-service acceptance (CU04) waits for the customer portal — Sales records acceptance with acceptor, authority, channel and evidence, bound to the issued content hash (D-023); quotation expiry is enforced at issue / acceptance (no background job yet); a PDF rendering of the customer quotation is not generated.
- Discount limit 5%, margin floor 15%, GST 18% and 30-day validity are launch placeholders pending Owner / Finance confirmation (D-004, D-005, D-011, D-022).
- No external messaging (WhatsApp/SMS/email), payments, e-sign, push notifications or accounting export; notifications are in-app records.
- Duplicate *merge execution* is not implemented (requests are recorded and routed).
- Evidence SHA-256 is computed on the device and recorded; server-side re-hashing / malware scanning is not implemented.
- Marathi is complete and is the default language, with an English switch, in all three apps. The Marathi text was written to a consistent glossary (`docs/marathi-glossary.md`) and should get a native-speaker business review before production. Hindi is not translated (it falls back to English). Native date/time pickers follow the phone/browser language, not the app's.
- Android release pipeline (EAS build, signing, crash reporting) is not configured; `app.json` sets the application id `in.aiec.field` and permissions.
- Rate limiting relies on Supabase Auth defaults; no custom limits on RPCs.
- Open business decisions: see `docs/decision-register.md` (D-004…D-007, D-010, D-011, D-020 are blocking for later slices).
- Statutory, engineering and legal criteria (survey requirement set, partner documents, warranty event) must be validated by qualified professionals before production use.

### Demo data (§63)

`npm run seed:demo` builds a local `aiec_demo` database and fills it through the real RPCs with the §63 sample set: 5 projects across stages, 2 partner companies (one missing its insurance certificate), 6 technicians, 10 leads in every pipeline status, 3 quotations with accepted second revisions, 3 POs, 2 QA defects (one closed through a rework loop), verified / pending / rejected payments and a project blocked by site readiness. See `docs/demo-data.md`. `test/demo-data.test.ts` checks every item (DB suite: **81 passed**).

## 9. Next recommended work

All six slices of the launch scope and the §63 demo data are built. Recommended next: (1) the Android technician app (WT01–WT09 offline with GPS, sharing the web rules), (2) warranty service and AMC (complaints, service visits, renewals), (3) the business decisions still open in `docs/decision-register.md` and native-speaker / qualified-engineer review of the Marathi text and QA checklists, (4) a hosted Supabase staging project with SMS OTP and Storage exercised end to end.

# Slice report — Slices 1, 2 & 3 (§65)

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

## 4. Screens / routes completed

Web: `/login`, `/auth/callback`, `/auth/signout`, `/setup-required`, `/` (role-aware KPIs with stated basis and reconciling drill-downs), `/leads` (SE03 list/search/pagination), `/leads/new` (SE02 + SE03 duplicate review), `/leads/[id]` (SE04/SE05/SE06/SE07/SE14 + survey booking SE08, assignment/reopen), `/surveys`, `/surveys/[id]` (TE02 read + revision request, GPS exception review, reschedule/cancel), `/admin/users` (O10), `/audit` (O12), `/notifications`. **Slice 3:** `/technical` (TE01 queue: waiting surveys oldest first, open reviews, feasible-without-configuration, documents in review), `/technical/reviews/[id]` (TE02 side-by-side survey values + decision / clarification, TE03 configuration builder with live catalogue check and approval, TE04 document upload with server-side SHA-256, submit, checksum-bound approve / reject), lead detail technical + quotation cards, `/quotations` and `/quotations/[id]` (SE08 draft editor with live preview from the shared engine, submit, SE09 issue + customer response bound to the content hash, revisions, SE10 negotiation log), `/approvals` (O04: requester, reasons, policy threshold, impact; approve / reject / more information; own requests blocked). Home KPIs for open reviews, pending approvals and issued quotations. Each has loading, empty, error, permission-denied and pending/suspended states.

Mobile (Android): Login (OTP), SV01 My surveys (offline cache, online/sync chips, pull to refresh), SV02–SV10 in one survey workspace (accept, check-in with honest GPS exception, building / shaft / machine room / electrical / logistics sections, measurements with explicit unit selector, camera evidence per category, documents or unavailability reason, review with Gate 1 preview and plausibility warnings, submit), SV11 revisit / inaccessible / start revision, WT09-style Sync queue with per-record status and conflict discard.

## 5. APIs / server actions completed

See `docs/api-contracts.md` — 10 identity/admin RPCs, 8 lead RPCs, 10 survey/evidence RPCs, 1 directory RPC, 1 locale RPC, and 16 Slice 3 RPCs (technical review 3, configuration 2, documents 3, quotations 7, approvals 1).

## 6. RLS / permission rules implemented

RLS enabled on every table; clients hold SELECT only. Scope rules: tenant isolation for partner people data, lead visibility (owner or `lead.read_all`), survey visibility (assigned surveyor, `survey.read_all`, the lead's owner), sales history hidden from field and technical roles, audit to `audit.read`, private evidence storage bound to survey scope with upload only by the assigned surveyor during capture and no update/delete. Segregation of duties listed in `docs/permission-matrix.md`.

## 7. Tests run and actual results

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

- Slices 4–6 exist as tested domain rules only. Orders, projects, payments, procurement, partner compliance, tasks, QA, handover and warranty are **not usable** in the product yet.
- Slice 3 scope notes: structured BOM lines (TE05) and technical change requests (TE06) are deferred to Slice 4, where procurement consumes them (a BOM can be controlled today as a checksum-approved document); customer self-service acceptance (CU04) waits for the customer portal — Sales records acceptance with acceptor, authority, channel and evidence, bound to the issued content hash (D-023); quotation expiry is enforced at issue / acceptance (no background job yet); a PDF rendering of the customer quotation is not generated.
- Discount limit 5%, margin floor 15%, GST 18% and 30-day validity are launch placeholders pending Owner / Finance confirmation (D-004, D-005, D-011, D-022).
- No external messaging (WhatsApp/SMS/email), payments, e-sign, push notifications or accounting export; notifications are in-app records.
- Duplicate *merge execution* is not implemented (requests are recorded and routed).
- Evidence SHA-256 is computed on the device and recorded; server-side re-hashing / malware scanning is not implemented.
- Marathi is complete and is the default language, with an English switch, in all three apps. The Marathi text was written to a consistent glossary (`docs/marathi-glossary.md`) and should get a native-speaker business review before production. Hindi is not translated (it falls back to English). Native date/time pickers follow the phone/browser language, not the app's.
- Android release pipeline (EAS build, signing, crash reporting) is not configured; `app.json` sets the application id `in.aiec.field` and permissions.
- Rate limiting relies on Supabase Auth defaults; no custom limits on RPCs.
- Open business decisions: see `docs/decision-register.md` (D-004…D-007, D-010, D-011, D-020 are blocking for later slices).
- Statutory, engineering and legal criteria (survey requirement set, partner documents, warranty event) must be validated by qualified professionals before production use.

## 9. Next recommended slice

**Slice 4 — Order to procurement**: order conversion from an accepted quotation revision (Gate 4, `order.convert`, contract record), project creation and handover checklist (SE11), payment milestone schedule from a configurable template with Finance verification (Gate 5), structured BOM lines mapped to the approved configuration (TE05) and technical change requests (TE06), purchase requests, supplier POs with approval and GRN — each with RLS, audit, DB tests, Marathi + English screens and E2E steps in the same style.

# Slice report — Slices 1 & 2 (§65)

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

## 4. Screens / routes completed

Web: `/login`, `/auth/callback`, `/auth/signout`, `/setup-required`, `/` (role-aware KPIs with stated basis and reconciling drill-downs), `/leads` (SE03 list/search/pagination), `/leads/new` (SE02 + SE03 duplicate review), `/leads/[id]` (SE04/SE05/SE06/SE07/SE14 + survey booking SE08, assignment/reopen), `/surveys`, `/surveys/[id]` (TE02 read + revision request, GPS exception review, reschedule/cancel), `/admin/users` (O10), `/audit` (O12), `/notifications`. Each has loading, empty, error, permission-denied and pending/suspended states.

Mobile (Android): Login (OTP), SV01 My surveys (offline cache, online/sync chips, pull to refresh), SV02–SV10 in one survey workspace (accept, check-in with honest GPS exception, building / shaft / machine room / electrical / logistics sections, measurements with explicit unit selector, camera evidence per category, documents or unavailability reason, review with Gate 1 preview and plausibility warnings, submit), SV11 revisit / inaccessible / start revision, WT09-style Sync queue with per-record status and conflict discard.

## 5. APIs / server actions completed

See `docs/api-contracts.md` — 10 identity/admin RPCs, 8 lead RPCs, 10 survey/evidence RPCs, 1 directory RPC.

## 6. RLS / permission rules implemented

RLS enabled on every table; clients hold SELECT only. Scope rules: tenant isolation for partner people data, lead visibility (owner or `lead.read_all`), survey visibility (assigned surveyor, `survey.read_all`, the lead's owner), sales history hidden from field and technical roles, audit to `audit.read`, private evidence storage bound to survey scope with upload only by the assigned surveyor during capture and no update/delete. Segregation of duties listed in `docs/permission-matrix.md`.

## 7. Tests run and actual results (2026-11-06, this environment)

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

Not run here (no backend/device available): web flows against a hosted Supabase project (Auth OTP, PostgREST, Storage), an installed Android build on a device, CI on GitHub (workflow added; first run happens on push).

## 8. Known limitations and unresolved decisions

- Slices 3–6 exist as tested domain rules only; no tables, RPCs or screens yet. Feasibility decisions, configuration, quotations, orders, projects, payments, procurement, partner compliance, tasks, QA, handover and warranty are **not usable** in the product yet.
- No external messaging (WhatsApp/SMS/email), payments, e-sign, push notifications or accounting export; notifications are in-app records.
- Duplicate *merge execution* is not implemented (requests are recorded and routed).
- Evidence SHA-256 is computed on the device and recorded; server-side re-hashing / malware scanning is not implemented.
- Marathi / Hindi dictionaries are empty (keys are in place).
- Android release pipeline (EAS build, signing, crash reporting) is not configured; `app.json` sets the application id `in.aiec.field` and permissions.
- Rate limiting relies on Supabase Auth defaults; no custom limits on RPCs.
- Open business decisions: see `docs/decision-register.md` (D-004…D-007, D-010, D-011, D-020 are blocking for later slices).
- Statutory, engineering and legal criteria (survey requirement set, partner documents, warranty event) must be validated by qualified professionals before production use.

## 9. Next recommended slice

**Slice 3 — Technical and quotation**: `technical_reviews` (start/clarify/decide, rationale, constraints), versioned `configuration_revisions` and drawing/BOM documents with checksum-bound approval, quotation revisions and lines using `computeQuotation` + `evaluateDiscountAuthority` with rules for D-004/D-005, Owner approval center with self-approval prevention, customer acceptance bound to an exact revision, and the Technical/Sales/Owner screens TE01–TE05, SE09–SE11, O04 — each with RLS, audit and DB tests in the same style.

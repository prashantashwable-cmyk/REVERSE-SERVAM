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

- Slices 3–6 exist as tested domain rules only; no tables, RPCs or screens yet. Feasibility decisions, configuration, quotations, orders, projects, payments, procurement, partner compliance, tasks, QA, handover and warranty are **not usable** in the product yet.
- No external messaging (WhatsApp/SMS/email), payments, e-sign, push notifications or accounting export; notifications are in-app records.
- Duplicate *merge execution* is not implemented (requests are recorded and routed).
- Evidence SHA-256 is computed on the device and recorded; server-side re-hashing / malware scanning is not implemented.
- Marathi is complete and is the default language, with an English switch, in all three apps. The Marathi text was written to a consistent glossary (`docs/marathi-glossary.md`) and should get a native-speaker business review before production. Hindi is not translated (it falls back to English). Native date/time pickers follow the phone/browser language, not the app's.
- Android release pipeline (EAS build, signing, crash reporting) is not configured; `app.json` sets the application id `in.aiec.field` and permissions.
- Rate limiting relies on Supabase Auth defaults; no custom limits on RPCs.
- Open business decisions: see `docs/decision-register.md` (D-004…D-007, D-010, D-011, D-020 are blocking for later slices).
- Statutory, engineering and legal criteria (survey requirement set, partner documents, warranty event) must be validated by qualified professionals before production use.

## 9. Next recommended slice

**Slice 3 — Technical and quotation**: `technical_reviews` (start/clarify/decide, rationale, constraints), versioned `configuration_revisions` and drawing/BOM documents with checksum-bound approval, quotation revisions and lines using `computeQuotation` + `evaluateDiscountAuthority` with rules for D-004/D-005, Owner approval center with self-approval prevention, customer acceptance bound to an exact revision, and the Technical/Sales/Owner screens TE01–TE05, SE09–SE11, O04 — each with RLS, audit and DB tests in the same style.

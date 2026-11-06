# AIEC Elevator Installation OS

Role-based operating system for **ALL INDIA ELEVATORS COMPANY** — from enquiry to survey, technical review, quotation, installation, independent QA, handover and warranty — built from the specification in [`AIEC_Role_Wise_Master_Prompt_v2_Deep_Implementation.md`](AIEC_Role_Wise_Master_Prompt_v2_Deep_Implementation.md).

**Current state: Slices 1 and 2 of 6 are implemented end to end** (identity & access; lead → survey with offline field capture). Later slices exist as tested business rules in `packages/domain` only. See [`docs/slice-report.md`](docs/slice-report.md) for exactly what works, what was tested and what is not built yet.

> Engineering, statutory and legal acceptance criteria in this system (survey requirements, partner documents, warranty events, inspection checklists) are configurable placeholders. They must be validated by qualified professionals and the relevant Maharashtra authority before production use. The software never grants statutory permission.

## Repository layout

| Path | What it is |
|---|---|
| `packages/domain` | Framework-free TypeScript business rules shared everywhere: roles & permissions, 13 state machines, INR money, quotation economics, payment gates, survey Gate 1, duplicate scoring, partner/safety/handover gates, offline sync queue, i18n keys |
| `supabase/migrations` | PostgreSQL schema, Row Level Security, RPCs (all writes), triggers, seeds |
| `supabase/tests` | Integration tests on a real PostgreSQL + PostGIS database (RLS, tenant isolation, workflows, audit, idempotency) |
| `e2e` | Browser walkthrough of the production web build across roles, with screenshots (test-only gateway; see `e2e/README.md`) |
| `apps/web` | Next.js 15 management web (Owner, Sales, Technical, Operations, administration) |
| `apps/mobile` | Expo SDK 58 Android field app (Surveyor; offline-first) |
| `apps/demo` → `docs/demo` | Static, browser-only interactive demo for phones (GitHub Pages). Real business rules from `packages/domain`, simulated data kept on the device — not the product backend |
| `docs` | Audit, decision register, traceability matrix, permission matrix, state machines, API contracts, slice report |

## Languages: Marathi first, English available

Every screen in all three apps (web, Android, demo) is in **Marathi by default**, with a **मराठी / English** switch:

- Web: the choice is saved to the user's profile (`set_my_locale`) and a cookie, so it also applies on the sign-in page.
- Android and demo: the choice is saved on the device.

Dates use Marathi month and day-part names with standard 0–9 digits (e.g. `06 नोव्हें, 2026, सकाळ 10:30`). Business IDs, phone numbers, units (mm/cm/m) and anything a person typed are never translated.

- All text lives in `packages/domain/src/messages/en.ts` (source) and `mr.ts`. `mr.ts` is typed `Record<MessageKey, string>`, so a missing Marathi string fails the build.
- `npm run check:i18n` (run in CI) fails if English text is written directly in a screen.
- Terms follow [`docs/marathi-glossary.md`](docs/marathi-glossary.md).

## Security model in one paragraph

Clients (web and mobile) have **read-only** table access filtered by Row Level Security. Every change goes through a `SECURITY DEFINER` RPC that authenticates, checks the permission *and* the resource scope, validates the state transition, writes an append-only audit record (with the actor's role context) and is idempotent for offline retries. Partner companies are separate tenants. Only publishable Supabase keys are used by the apps; the service-role key must never be configured in `apps/web` or `apps/mobile`.

## Prerequisites

- Node.js 20.11+ (CI uses 22) and npm 10
- For database tests: PostgreSQL 15+ with PostGIS 3 (`pg_trgm`, `btree_gist`, `citext`, `pgcrypto` contrib modules)
- For a running system: a Supabase project (PostgreSQL 15+, Auth with phone OTP via an SMS provider, Storage)

```bash
npm ci
npm test            # domain unit tests
npm run typecheck   # all workspaces
```

## Database tests

The harness creates a throw-away database, loads a small shim for the Supabase `auth`/`storage` schemas and API roles (`supabase/tests/sql/supabase_shim.sql`, test-only), applies every migration and builds a synthetic fixture through the real RPCs.

```bash
# default: postgres://postgres@127.0.0.1:54329/postgres ; database "aiec_test" is dropped and recreated
export AIEC_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
npm run test:db
```

## Setting up a Supabase project

1. Create the project; enable **Phone** auth (configure an SMS provider) and, for staff, **Email** (magic link). Disable open email sign-up if possible — the app only sends links to existing users.
2. Apply the migrations in order (Supabase CLI: `supabase link` then `supabase db push`, or paste each file from `supabase/migrations` into the SQL editor). Migration `…0400` creates the private `evidence` storage bucket and its policies.
3. Sign in once with the future Owner's phone number (creates a `pending_verification` profile), then run in the SQL editor:
   ```sql
   select app.bootstrap_platform('<owner auth user id>', 'All India Elevators Company', 'Pune');
   ```
   This works only once. All further users are verified and given roles in **Users & roles** (`/admin/users`); every change requires a reason and is audited.
4. Review `public.business_rules` defaults against the decision register (`docs/decision-register.md`) and change them with `set_business_rule` (versioned).

## Web app

```bash
cp apps/web/.env.example apps/web/.env.local   # fill in the publishable URL / key
npm run dev --workspace @aiec/web
npm run build:web
```

`NEXT_PUBLIC_*` values are inlined at build time — set them before `next build`. Set `NEXT_PUBLIC_AIEC_ENV=demo` for demo environments (visible DEMO banner).

## Android field app

```bash
cp apps/mobile/.env.example apps/mobile/.env   # EXPO_PUBLIC_* publishable values
npm run start --workspace @aiec/mobile          # Expo dev server
npx expo run:android                            # from apps/mobile, needs Android SDK
```

Application id `in.aiec.field`. Field data (cached work package, drafts, evidence files and the sync queue) is stored on the device and survives app restarts; sign-out is blocked while anything is unsynced, and local data is wiped on sign-out.

## Documentation

- [Repository audit](docs/repository-audit.md) · [Slice report](docs/slice-report.md)
- [Decision register](docs/decision-register.md) · [Traceability matrix](docs/traceability-matrix.md)
- [Permission matrix](docs/permission-matrix.md) · [State machines](docs/state-machines.md) — generated: `npm run docs:generate --workspace @aiec/domain`
- [API contracts](docs/api-contracts.md)

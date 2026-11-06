# Browser end-to-end walkthrough (test-only)

Drives the **production build** of `apps/web` in Chromium (Playwright) through a multi-role scenario against the **real database schema, RLS and RPCs**, taking a screenshot and asserting an outcome at every step.

`test-gateway.mjs` is a small local stand-in for the Supabase HTTP API (Auth OTP with fixed code `123456`, the PostgREST subset the app uses, storage URL signing). Every data request runs in PostgreSQL as role `authenticated` with the caller's JWT claims, so all authorization is the real one. It is **not** part of the product and must never be deployed.

## Run

```bash
# 1. Database with the synthetic fixture (also runs the DB integration tests)
npm run test:db                                   # creates/refreshes database "aiec_test"

# 2. Gateway (port 54400)
node e2e/test-gateway.mjs &

# 3. Production web build pointed at the gateway
cd apps/web
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e \
NEXT_PUBLIC_AIEC_ENV=demo npx next build && npx next start -p 3123 &
cd ../..

# 4. Walkthrough (needs Playwright + Chromium installed). Runs in Marathi by default and fails if
#    any English word (other than typed data and tokens such as AIEC, GPS, mm) is visible on a page.
mkdir -p /tmp/aiec-shots && node e2e/walkthrough.cjs /tmp/aiec-shots
# English pass (refresh the database first, step 1):
AIEC_E2E_LOCALE=en node e2e/walkthrough.cjs /tmp/aiec-shots-en
```

GitHub Pages demo on a phone-sized screen (Marathi, the switch to English and back, the choice kept across reloads):

```bash
npm run build:demo && (cd docs && python3 -m http.server 8765 &) && node e2e/demo-test.cjs /tmp/aiec-demo-shots
```

Refresh the database (step 1) before each run: the scenario creates leads whose names would otherwise be (correctly) flagged as duplicates on the next run.

## What it covers (25 checks)

Sales: home KPIs, lead list, validation errors, lead creation, duplicate review (values kept), activity → contacted, qualification with score, survey booking, survey detail. Owner: KPIs with stated basis, audit log, users & roles, read-only lead view. Technical manager: review queue, measurements + evidence, return for revision, no access to sales leads. Partner admin: no lead access, sees only own team. Pending account banner. 390 px mobile width without horizontal overflow.

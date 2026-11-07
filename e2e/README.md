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

## What it covers

Sales: home KPIs, lead list, validation errors, lead creation, duplicate review (values kept), activity → contacted, qualification with score, survey booking, survey detail. Owner: KPIs with stated basis, audit log, users & roles, read-only lead view. Technical manager: review queue, measurements + evidence, return for revision, no access to sales leads. Partner admin: no lead access, sees only own team. Pending account banner. 390 px mobile width without horizontal overflow.

Slice 3: technical queue → feasibility decision → configuration → controlled document → quotation above authority → Owner approval → issue → recorded acceptance; a technical reviewer cannot open prices.

Slice 4: Sales converts the accepted revision with the handover checklist (project opens); Operations sees the KPI, accepts the handover and sees procurement blocked by Gate 5; Sales records the advance; Finance verifies it against a statement; Technical prepares and approves the BOM; Procurement (who never sees the customer contract value) raises a purchase request from BOM lines, records a quote, selects the supplier with a rationale and creates a PO above the ₹5,00,000 limit; Operations approves it; Procurement issues it, moves each line to delivered, records a partial receipt (the line stays open) and the rest (the PO closes); Sales cannot open the PO.

Slice 5: the partner admin completes the company profile, uploads four compliance documents and submits; the Owner starts verification, verifies each document and approves (eligible for passenger lifts); the partner records its technician's skills; Operations records a passing site check and invites the eligible partner; the partner accepts the displayed offer, adds the technician to the project team and assigns the first task; the pre-dispatch payment is verified; Operations marks installation ready and starts it; the technician accepts, passes the safety pre-start, starts, reports an unsafe condition (safety stop), AIEC lifts it, the technician re-checks, the partner resumes the task, the technician completes the checklist, adds the photo and submits; the partner files a daily report and sees AIEC's comment; another partner cannot open the assignment.

Slice 6: the AIEC QA inspector opens the submitted mobilisation task from the QA queue, fails the site-safety criterion and raises a defect (location, severity, due date); the partner sees and acknowledges it; the technician starts the correction, adds a correction photo and resubmits; QA verifies the correction and passes the re-inspection; the remaining tasks are driven to a QA pass through the real RPCs; Operations requests final QA and QA passes it; Operations records the inspection report and operating licence, the Owner verifies both and Operations records statutory clearance; Operations uploads the handover documents, links the customer organization and sends the package; the customer accepts by name and sees the lift asset and warranty dates; Operations closes the project.

Slice 3 (11 checks): a fresh survey is seeded through the real RPCs; Technical starts the review from the queue, records a feasible decision, builds and approves the configuration, uploads a shaft layout (server-side checksum), submits and approves it; Sales sees the technical summary, creates a quotation with a 12% discount, which goes to the Owner; the Owner approves in the approval center; Sales issues and records acceptance bound to the content hash; the technical reviewer cannot open the quotation.

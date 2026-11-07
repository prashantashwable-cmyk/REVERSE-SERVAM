# Demo data (§63)

Synthetic demo data for a local demonstration of the real product (web app + database). Every record is created through the real RPCs, as the person who would do it, so the data passes every gate, permission and audit rule. All names, phones, sites and companies are fictional; the web app shows the **DEMO** banner when built with `NEXT_PUBLIC_AIEC_ENV=demo`.

This is separate from the GitHub Pages phone demo (`docs/demo/`), which runs entirely in the browser with its own simulated data.

## Build it

Requires the local PostgreSQL 16 + PostGIS server used by the integration tests.

```bash
AIEC_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres npm run seed:demo
```

This drops and recreates only the `aiec_demo` database (override with `AIEC_DEMO_DATABASE_NAME`; names containing `prod` are refused), applies every migration and seeds the data. It is not for a hosted Supabase project: demo sign-ins are inserted as `auth.users` rows, which Supabase Auth would create on OTP sign-up.

To click through it, serve it with the E2E gateway (any listed phone, code `123456`):

```bash
AIEC_E2E_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/aiec_demo node e2e/test-gateway.mjs
cd apps/web && NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e NEXT_PUBLIC_AIEC_ENV=demo npx next build && npx next start -p 3123
```

## Sign-ins

| Phone | Person | Role |
|---|---|---|
| 9000000000 | Vikram Deshmukh | Owner |
| 9000000001 / 02 | Snehal Kulkarni / Rohan Jadhav | Sales |
| 9000000003 / 04 | Ganesh Pawar / Pooja Shinde | Surveyor |
| 9000000005 | Ajit Gokhale | Technical manager |
| 9000000006 | Manisha Bhosale | Operations |
| 9000000007 / 08 | Sachin More / Nitin Salunkhe | Sahyadri Lift Erectors — partner admin / technician |
| 9000000009 / 10 | Kiran Thorat / Amol Gaikwad | Krishna Elevator Services — partner admin / technician |
| 9000000011 | Prakash Rao | Customer (Shivneri Heights CHS) |
| 9000000012 | Rahul Kale | Pending account (no access until verified) |
| 9000000013 | Sunita Joshi | Finance |
| 9000000014 | Mahesh Patil | Procurement |
| 9000000015 | Deepak Kadam | QA inspector |

## What it contains

| §63 requirement | Demo data |
|---|---|
| 5 projects across stages | Shivneri Heights (order converted, waiting for Operations), Gulmohar Park Phase 2 (planning), Indrayani Towers (installation), Mogra Business Centre (statutory evidence pending), Sahyadri Clinic Annex (handed over, warranty active) |
| 2 partner companies | Sahyadri Lift Erectors (approved, eligible for passenger and goods lifts); Krishna Elevator Services (draft) |
| 6 technicians | 3 per partner, enrolled by the partner admin, with recorded skills |
| 8 leads in different statuses | 10 leads: 5 won (the projects), assigned, contacted, qualified, lost (competitor), invalid |
| 3 quotations with revisions | Indrayani, Mogra and Sahyadri Clinic: revision 1 issued, negotiation recorded, revision 2 with a discount issued and accepted |
| 2 purchase orders | 3 issued, delivered and received POs (one per project in installation or later) |
| 2 QA defects incl. one rework loop | Indrayani: open minor defect (two rail brackets short); Mogra: major safety defect failed → acknowledged → corrected with photo → resubmitted → verified and closed |
| Payments verified / pending / rejected | Verified advance and pre-dispatch payments; Shivneri's advance claim waiting for Finance; Gulmohar's cheque rejected (returned unpaid) |
| One project blocked by site readiness | Gulmohar Park Phase 2: site check failed (pit not dry, no power supply) |
| One project with a missing partner document | Krishna Elevator Services has no insurance certificate, so it cannot submit for verification and is shown as not eligible (Gate 7) |

`supabase/tests/test/demo-data.test.ts` builds the same data in the test database and checks each row of this table.

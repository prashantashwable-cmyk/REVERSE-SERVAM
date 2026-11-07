import { afterAll, describe, expect, inject, it } from 'vitest';
import { admin, makePool } from '../src/db';
import { seedDemo, type DemoSummary } from '../src/demo-seed';

const fx = inject('fixture');
const pool = makePool();
afterAll(() => pool.end());

const one = async <T = any>(sql: string, params: unknown[]) => (await admin<T>(pool, sql, params))[0]!;

describe('§63 demo data — built through the real RPCs', () => {
  it('covers every required sample: projects across stages, partners, technicians, leads, quotations, POs, defects and payments', { timeout: 300_000 }, async () => {
    const d: DemoSummary = await seedDemo(pool, fx);
    const pids = Object.values(d.projects);

    // 5 projects across different stages.
    const status = async (id: string) => (await one<{ status: string }>('select status from public.projects where id = $1', [id])).status;
    expect({
      awaitingHandover: await status(d.projects.awaitingHandover), siteBlocked: await status(d.projects.siteBlocked),
      installingWithDefect: await status(d.projects.installingWithDefect), statutoryPending: await status(d.projects.statutoryPending),
      handedOver: await status(d.projects.handedOver),
    }).toEqual({ awaitingHandover: 'created', siteBlocked: 'planning', installingWithDefect: 'installation', statutoryPending: 'statutory_pending', handedOver: 'handed_over' });

    // One project blocked by missing site readiness (latest check failed, with the failing items).
    const site = await one<{ passed: boolean; failures: { key: string; code: string }[] }>(
      'select passed, failures from public.site_readiness_checks where project_id = $1 order by revision_no desc limit 1', [d.projects.siteBlocked]);
    expect(site.passed).toBe(false);
    expect(site.failures.map((x) => `${x.key}:${x.code}`).sort()).toEqual(['pit_dry_and_finished:SITE_NOT_READY', 'power_supply_available:SITE_NOT_READY']);

    // 2 partner companies; one approved, one missing a required document (insurance) and therefore not eligible.
    expect((await one<{ status: string }>('select status from public.partner_profiles where organization_id = $1', [d.partners.alpha])).status).toBe('approved');
    expect((await one<{ status: string }>('select status from public.partner_profiles where organization_id = $1', [d.partners.beta])).status).toBe('draft');
    const betaDocs = (await admin<{ doc_type: string }>(pool, 'select doc_type from public.partner_documents where organization_id = $1 order by doc_type', [d.partners.beta])).map((r) => r.doc_type);
    expect(betaDocs).toEqual(['bank_verification', 'contractor_licence', 'pan']);
    const elig = await one<{ e: { status: string; failures: unknown[] } }>(`select app.partner_eligibility($1, 'passenger') as e`, [d.partners.beta]);
    expect(elig.e.failures.length).toBeGreaterThan(0);

    // 6 technicians (3 per partner), each active with the technician role.
    const techs = await one<{ n: number }>(`select count(distinct g.user_id)::int as n from public.user_roles g join public.user_profiles p on p.id = g.user_id
      where g.role_code = 'technician' and g.revoked_at is null and g.organization_id = any($1::uuid[]) and p.status = 'active'`, [[d.partners.alpha, d.partners.beta]]);
    expect(techs.n).toBe(6);

    // Leads in every pipeline status (5 won through the projects + assigned, contacted, qualified, lost, invalid).
    const leadIds = [...Object.values(d.leads), ...(await admin<{ lead_id: string }>(pool, 'select o.lead_id from public.projects p join public.orders o on o.id = p.order_id where p.id = any($1::uuid[])', [pids])).map((r) => r.lead_id)];
    expect(leadIds).toHaveLength(10);
    const leadStatuses = (await admin<{ status: string }>(pool, 'select status::text from public.leads where id = any($1::uuid[])', [leadIds])).map((r) => r.status).sort();
    expect(leadStatuses).toEqual(['assigned', 'contacted', 'invalid', 'lost', 'qualified', 'won', 'won', 'won', 'won', 'won']);

    // 3 quotations with revisions (revision 1 superseded by an accepted revision 2).
    const revised = await admin<{ n: number }>(pool, `select q.id, count(r.id)::int as n from public.quotations q join public.quotation_revisions r on r.quotation_id = q.id
      where q.lead_id = any($1::uuid[]) group by q.id having count(r.id) > 1`, [leadIds]);
    expect(revised).toHaveLength(3);

    // At least 2 purchase orders.
    expect((await one<{ n: number }>('select count(*)::int as n from public.purchase_orders where project_id = any($1::uuid[])', [pids])).n).toBeGreaterThanOrEqual(2);

    // 2 QA defects, one still open and one closed through a rework loop (fail → correction → verify).
    const defects = await admin<{ project_id: string; status: string }>(pool, 'select project_id, status::text from public.defects where project_id = any($1::uuid[]) order by raised_at', [pids]);
    expect(defects).toEqual([
      { project_id: d.projects.installingWithDefect, status: 'assigned' },
      { project_id: d.projects.statutoryPending, status: 'closed' },
    ]);

    // Payments with verified, pending and rejected states.
    const pay = (await admin<{ status: string }>(pool, 'select distinct status::text from public.payment_claims where project_id = any($1::uuid[])', [pids])).map((r) => r.status).sort();
    expect(pay).toEqual(['claimed', 'rejected', 'verified']);

    // The handed-over project has its lift asset with an active warranty, visible to the customer.
    const asset = await one<{ warranty_status: string }>('select warranty_status::text from public.lift_assets where project_id = $1', [d.projects.handedOver]);
    expect(asset.warranty_status).toBe('active');
  });
});

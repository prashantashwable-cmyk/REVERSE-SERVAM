import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_MILESTONE_TEMPLATES, ORDER_HANDOVER_ITEMS, allocate } from '@aiec/domain';
import { admin, expectCode, makePool } from '../src/db';
import { PASSENGER_CONFIG, asParameters, flows } from '../src/flows';

const fx = inject('fixture');
const pool = makePool();
afterAll(() => pool.end());
const { as, submittedSurvey } = flows(pool, fx);

const version = async (table: string, id: string) =>
  (await admin<{ version: number }>(pool, `select version from public.${table} where id = $1`, [id]))[0]!.version;
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + 330 * 60000 + n * 864e5).toISOString().slice(0, 10);
const TERMS = Object.fromEntries(['scope_of_supply', 'scope_of_installation', 'customer_responsibilities', 'exclusions', 'tax_treatment', 'payment_terms', 'warranty_terms', 'delivery_assumptions'].map((k) => [k, `Agreed ${k}`]));
const CHECKLIST = Object.fromEntries(ORDER_HANDOVER_ITEMS.map((k) => [k, true]));

/** Submitted survey → feasible → approved configuration → quotation issued and accepted. */
async function acceptedQuotation() {
  const s = await submittedSurvey();
  const tech = as('tech1');
  const r = await tech.rpc('start_technical_review', { p_survey_id: s.surveyId });
  await tech.rpc('decide_technical_review', { p_review_id: r.review_id, p_expected_version: r.version, p_decision: 'feasible', p_payload: { technical_basis: 'Fits' } });
  const d = await tech.rpc('save_configuration_draft', { p_lead_id: s.leadId, p_expected_version: null, p_lift_category: 'passenger', p_parameters: asParameters(PASSENGER_CONFIG) });
  await tech.rpc('approve_configuration', { p_revision_id: d.configuration_revision_id, p_expected_version: d.version });
  const sales = as('sales1');
  const q = await sales.rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId });
  const line = { category: 'lift_equipment', description: 'MRL lift', quantity_milli: 1000, unit: 'nos', rate_paise: '1000000000', discount_bps: 0, tax_code: 'GST18', estimated_unit_cost_paise: '700000000' };
  const sv = await sales.rpc('save_quotation_draft', { p_revision_id: q.revision_id, p_expected_version: q.version, p_lines: [line], p_terms: TERMS, p_valid_until: inDays(20) });
  const sub = await sales.rpc('submit_quotation', { p_revision_id: q.revision_id, p_expected_version: sv.version });
  const iss = await sales.rpc('issue_quotation', { p_revision_id: q.revision_id, p_expected_version: sub.version });
  const acc = await sales.rpc('record_customer_response', {
    p_revision_id: q.revision_id, p_expected_version: iss.version, p_response: 'accept',
    p_payload: { accepted_by_name: 'Mr. Rao', acceptor_authority: 'Secretary', channel: 'signed_copy', evidence: 'Signed copy', content_sha256: iss.content_sha256 },
  });
  return { ...s, quotationId: q.quotation_id as string, revisionId: q.revision_id as string, accepted: acc };
}

async function convertedProject() {
  const q = await acceptedQuotation();
  const p = await as('sales1').rpc('convert_quotation_to_order', {
    p_operation_id: randomUUID(), p_revision_id: q.revisionId,
    p_payload: { contract_reference: 'AGR-2026-117', contract_date: today(), milestone_template: 'new_installation', handover_checklist: CHECKLIST },
  });
  return { ...q, projectId: p.project_id as string, project: p };
}

async function planningProject() {
  const p = await convertedProject();
  await as('ops1').rpc('acknowledge_project_handover', { p_project_id: p.projectId, p_expected_version: p.project.version, p_notes: 'Received' });
  return p;
}

async function verifiedAdvance(projectId: string) {
  const [m] = await admin<{ amount_paise: string }>(pool, `select amount_paise from public.payment_milestones where project_id = $1 and code = 'advance'`, [projectId]);
  const c = await as('sales1').rpc('record_payment_claim', { p_operation_id: randomUUID(), p_project_id: projectId, p_payload: {
    milestone_code: 'advance', payer_name: 'Society', amount_paise: m!.amount_paise, payment_mode: 'neft', payment_reference: 'UTR123456', payment_date: today() } });
  return as('finance1').rpc('decide_payment_claim', { p_claim_id: c.claim_id, p_expected_version: c.version, p_decision: 'verify',
    p_payload: { verified_amount_paise: m!.amount_paise, matched_statement_reference: 'HDFC stmt 07-11 line 4' } });
}

async function approvedBom(projectId: string) {
  const b = await as('tech1').rpc('save_bom_draft', { p_project_id: projectId, p_expected_version: null, p_change_summary: 'Initial', p_lines: [
    { item_code: 'MRL-MACH-8', description: 'Gearless machine 544 kg', make_model: 'Example Lifts GL-8', quantity_milli: 1000, unit: 'nos' },
    { item_code: 'RAIL-T89', description: 'Guide rail T89', quantity_milli: 30000, unit: 'm' },
  ] });
  return as('tech1').rpc('approve_bom', { p_bom_revision_id: b.bom_revision_id, p_expected_version: b.version });
}

describe('Slice 4 — Gate 4: order conversion and project creation', () => {
  it('only the accepted revision, with a full handover checklist and contract record, becomes an order and a project', async () => {
    const q = await acceptedQuotation();
    const base = { p_operation_id: randomUUID(), p_revision_id: q.revisionId };
    const payload = { contract_reference: 'AGR-2026-001', contract_date: today(), milestone_template: 'new_installation', handover_checklist: CHECKLIST };
    const e = await expectCode(as('sales1').rpc('convert_quotation_to_order', { ...base, p_payload: { ...payload, handover_checklist: { ...CHECKLIST, payment_terms: false } } }), 'REQUIRED_FIELD_MISSING');
    expect(e.detail.fields).toEqual(['handover.payment_terms']);
    await expectCode(as('sales1').rpc('convert_quotation_to_order', { ...base, p_operation_id: randomUUID(), p_payload: { ...payload, contract_reference: '' } }), 'REQUIRED_FIELD_MISSING');
    await expectCode(as('sales1').rpc('convert_quotation_to_order', { ...base, p_operation_id: randomUUID(), p_payload: { ...payload, milestone_template: 'thirty_forty' } }), 'VALIDATION_FAILED');
    await expectCode(as('sales2').rpc('convert_quotation_to_order', { ...base, p_operation_id: randomUUID(), p_payload: payload }), 'NOT_FOUND');
    await expectCode(as('ops1').rpc('convert_quotation_to_order', { ...base, p_operation_id: randomUUID(), p_payload: payload }), 'NOT_FOUND'); // cannot see the sales lead
    const p = await as('sales1').rpc('convert_quotation_to_order', { ...base, p_operation_id: randomUUID(), p_payload: payload });
    expect(p.project_number).toMatch(/^AIEC-PUN-\d{4}-\d{5}$/);
    expect(p.order_number).toMatch(/^OR-PUN-\d{4}-\d{5}$/);
    expect(p.status).toBe('created');
    await expectCode(as('sales1').rpc('convert_quotation_to_order', { ...base, p_operation_id: randomUUID(), p_payload: payload }), 'INVALID_STATE_TRANSITION');
    const [lead] = await admin(pool, 'select status from public.leads where id = $1', [q.leadId]);
    expect(lead.status).toBe('won');
    // Milestones split the contract value exactly, per the chosen template.
    const ms = await admin<{ code: string; amount_paise: string }>(pool, 'select code, amount_paise from public.payment_milestones where project_id = $1 order by sequence', [p.project_id]);
    const tpl = DEFAULT_MILESTONE_TEMPLATES.find((t) => t.code === 'new_installation')!;
    expect(ms.map((m) => m.code)).toEqual(tpl.items.map((i) => i.code));
    expect(ms.map((m) => BigInt(m.amount_paise))).toEqual(allocate(BigInt(p.contract_value_paise), tpl.items.map((i) => i.shareBps)));
    expect(await as('ops1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'project.created'`, [p.project_id])).toHaveLength(1);
    // Project visibility vs. customer money.
    for (const u of ['ops1', 'owner', 'tech1', 'procure1', 'finance1', 'sales1'] as const) {
      expect(await as(u).query('select 1 from public.projects where id = $1', [p.project_id]), u).toHaveLength(1);
    }
    for (const u of ['sales2', 'surveyor1', 'partnerA_admin', 'customer1'] as const) {
      expect(await as(u).query('select 1 from public.projects where id = $1', [p.project_id]), u).toEqual([]);
    }
    for (const u of ['tech1', 'procure1'] as const) {
      expect(await as(u).query('select 1 from public.orders where lead_id = $1', [q.leadId]), u).toEqual([]);
      expect(await as(u).query('select 1 from public.payment_milestones where project_id = $1', [p.project_id]), u).toEqual([]);
    }
  });

  it('Operations acknowledges the handover to start planning', async () => {
    const p = await convertedProject();
    await expectCode(as('sales1').rpc('acknowledge_project_handover', { p_project_id: p.projectId, p_expected_version: p.project.version }), 'ACCESS_DENIED');
    const r = await as('ops1').rpc('acknowledge_project_handover', { p_project_id: p.projectId, p_expected_version: p.project.version, p_notes: 'Scope and dependencies received' });
    expect(r.status).toBe('planning');
  });
});

describe('Slice 4 — Gate 5: payment claims, verification and exceptions', () => {
  it('a claim is not money until Finance matches a statement; the recorder never verifies', async () => {
    const p = await planningProject();
    const gate = () => as('ops1').rpc('project_payment_gate', { p_project_id: p.projectId, p_action: 'procurement' });
    expect(await gate()).toEqual({ open: false, blocking: ['advance'], viaException: false });
    const [m] = await admin<{ amount_paise: string }>(pool, `select amount_paise from public.payment_milestones where project_id = $1 and code = 'advance'`, [p.projectId]);
    const amount = m!.amount_paise;
    const claim = (by: 'sales1' | 'finance1', over = {}) => as(by).rpc('record_payment_claim', { p_operation_id: randomUUID(), p_project_id: p.projectId,
      p_payload: { milestone_code: 'advance', payer_name: 'Society', amount_paise: amount, payment_mode: 'upi', payment_reference: 'UPI-778899', payment_date: today(), ...over } });
    await expectCode(claim('sales1', { milestone_code: 'nope' }), 'REQUIRED_FIELD_MISSING');
    await expectCode(claim('sales1', { payment_date: inDays(3) }), 'VALIDATION_FAILED');
    await expectCode(as('tech1').rpc('record_payment_claim', { p_operation_id: randomUUID(), p_project_id: p.projectId, p_payload: {} }), 'NOT_FOUND');
    const c = await claim('sales1');
    expect(c.claim_number).toMatch(/^PM-PUN-\d{4}-\d{5}$/);
    expect(await as('finance1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'payment.claimed'`, [c.claim_id])).toHaveLength(1);
    const f = as('finance1');
    await expectCode(f.rpc('decide_payment_claim', { p_claim_id: c.claim_id, p_expected_version: c.version, p_decision: 'verify', p_payload: { verified_amount_paise: amount } }), 'PAYMENT_NOT_VERIFIED');
    await expectCode(f.rpc('decide_payment_claim', { p_claim_id: c.claim_id, p_expected_version: c.version, p_decision: 'verify', p_payload: { verified_amount_paise: '1', matched_statement_reference: 'stmt' } }), 'VALIDATION_FAILED');
    await expectCode(as('sales1').rpc('decide_payment_claim', { p_claim_id: c.claim_id, p_expected_version: c.version, p_decision: 'verify', p_payload: {} }), 'ACCESS_DENIED');
    const cl = await f.rpc('decide_payment_claim', { p_claim_id: c.claim_id, p_expected_version: c.version, p_decision: 'request_clarification', p_payload: { reason: 'UTR not found in statement' } });
    expect(cl.status).toBe('pending_clarification');
    const rs = await as('sales1').rpc('resubmit_payment_claim', { p_claim_id: c.claim_id, p_expected_version: cl.version, p_payload: { payment_reference: 'UTR-CORRECTED-1' } });
    expect(rs.status).toBe('claimed');
    const half = (BigInt(amount) / 2n).toString();
    const pv = await f.rpc('decide_payment_claim', { p_claim_id: c.claim_id, p_expected_version: rs.version, p_decision: 'verify_partially', p_payload: { verified_amount_paise: half, matched_statement_reference: 'stmt 07-11', reason: 'Only half credited so far' } });
    expect(pv.status).toBe('partially_verified');
    expect((await gate()).open).toBe(false);
    // Finance may record a claim but never verifies its own.
    const own = await claim('finance1', { amount_paise: (BigInt(amount) - BigInt(half)).toString(), payment_reference: 'UTR-REST-2' });
    await expectCode(f.rpc('decide_payment_claim', { p_claim_id: own.claim_id, p_expected_version: own.version, p_decision: 'verify',
      p_payload: { verified_amount_paise: (BigInt(amount) - BigInt(half)).toString(), matched_statement_reference: 'stmt' } }), 'SELF_APPROVAL_FORBIDDEN');
    const rest = await claim('sales1', { amount_paise: (BigInt(amount) - BigInt(half)).toString(), payment_reference: 'UTR-REST-3' });
    await f.rpc('decide_payment_claim', { p_claim_id: rest.claim_id, p_expected_version: rest.version, p_decision: 'verify', p_payload: { verified_amount_paise: (BigInt(amount) - BigInt(half)).toString(), matched_statement_reference: 'stmt 08-11' } });
    expect(await gate()).toEqual({ open: true, blocking: [], viaException: false });
    await expectCode(admin(pool, `update public.payment_claims set amount_paise = 1 where id = $1`, [rest.claim_id]), 'ACCESS_DENIED');
    await expectCode(f.rpc('decide_payment_claim', { p_claim_id: own.claim_id, p_expected_version: own.version, p_decision: 'reject', p_payload: {} }), 'REQUIRED_FIELD_MISSING');
  });

  it('an exception opens the gate only when an authorized approver accepts it, and it expires', async () => {
    const p = await planningProject();
    const o = as('ops1');
    await expectCode(o.rpc('request_payment_exception', { p_project_id: p.projectId, p_action: 'procurement', p_reason: 'short', p_expires_at: new Date(Date.now() + 864e5).toISOString() }), 'REQUIRED_FIELD_MISSING');
    await expectCode(o.rpc('request_payment_exception', { p_project_id: p.projectId, p_action: 'procurement', p_reason: 'Long-lead machine must be ordered now; advance cheque deposited', p_expires_at: new Date(Date.now() - 1000).toISOString() }), 'VALIDATION_FAILED');
    const r = await o.rpc('request_payment_exception', { p_project_id: p.projectId, p_action: 'procurement', p_reason: 'Long-lead machine must be ordered now; advance cheque deposited', p_expires_at: new Date(Date.now() + 3 * 864e5).toISOString() });
    await expectCode(o.rpc('decide_approval_request', { p_request_id: r.approval_request_id, p_decision: 'approve' }), 'ACCESS_DENIED');
    await expectCode(as('owner').rpc('decide_approval_request', { p_request_id: r.approval_request_id, p_decision: 'reject' }), 'REQUIRED_FIELD_MISSING');
    const d = await as('owner').rpc('decide_approval_request', { p_request_id: r.approval_request_id, p_decision: 'approve' });
    expect(d).toMatchObject({ approval_status: 'approved', kind: 'payment_exception' });
    expect(await o.rpc('project_payment_gate', { p_project_id: p.projectId, p_action: 'procurement' })).toEqual({ open: true, blocking: ['advance'], viaException: true });
    expect((await o.rpc('project_payment_gate', { p_project_id: p.projectId, p_action: 'dispatch' })).open).toBe(false);
  });
});

describe('Slice 4 — BOM, purchase requests and supplier choice (TE05, PR01–PR02, Gate 6)', () => {
  it('BOM lines map to the approved configuration; Technical approves; approved lines are locked', async () => {
    const p = await planningProject();
    await expectCode(as('procure1').rpc('save_bom_draft', { p_project_id: p.projectId, p_expected_version: null, p_lines: [] }), 'ACCESS_DENIED');
    const b = await as('tech1').rpc('save_bom_draft', { p_project_id: p.projectId, p_expected_version: null, p_lines: [{ item_code: 'X1', description: 'Machine', quantity_milli: 1000, unit: 'nos' }] });
    await expectCode(as('procure1').rpc('approve_bom', { p_bom_revision_id: b.bom_revision_id, p_expected_version: b.version }), 'ACCESS_DENIED');
    const a = await as('tech1').rpc('approve_bom', { p_bom_revision_id: b.bom_revision_id, p_expected_version: b.version });
    expect(a.status).toBe('approved');
    await expectCode(admin(pool, `update public.bom_lines set quantity_milli = 5 where bom_revision_id = $1`, [b.bom_revision_id]), 'ACCESS_DENIED');
    expect(await as('procure1').query('select 1 from public.bom_lines where bom_revision_id = $1', [b.bom_revision_id])).toHaveLength(1);
  });

  it('purchase requests need the payment gate, approved BOM lines and quantities within the BOM; suppliers are chosen with a rationale', async () => {
    const p = await planningProject();
    const bom = await approvedBom(p.projectId);
    const [l1, l2] = await admin<{ id: string }>(pool, 'select id from public.bom_lines where bom_revision_id = $1 order by line_no', [bom.bom_revision_id]);
    const pr = (lines: unknown[], over = {}) => as('procure1').rpc('create_purchase_request', { p_operation_id: randomUUID(), p_project_id: p.projectId,
      p_payload: { required_by: inDays(30), lines, ...over } });
    await expectCode(pr([{ bom_line_id: l1!.id, quantity_milli: 1000 }]), 'PAYMENT_NOT_VERIFIED');
    await verifiedAdvance(p.projectId);
    await expectCode(pr([{ bom_line_id: randomUUID(), quantity_milli: 1000 }]), 'VALIDATION_FAILED');
    await expectCode(pr([{ bom_line_id: l1!.id, quantity_milli: 2000 }]), 'VALIDATION_FAILED');
    await expectCode(as('sales1').rpc('create_purchase_request', { p_operation_id: randomUUID(), p_project_id: p.projectId, p_payload: {} }), 'ACCESS_DENIED');
    const r = await pr([{ bom_line_id: l1!.id, quantity_milli: 1000 }, { bom_line_id: l2!.id, quantity_milli: 30000 }], { preferred_supplier_id: fx.orgs.supplier, budget_estimate_paise: '600000000' });
    expect(r.request_number).toMatch(/^PR-PUN-\d{4}-\d{5}$/);
    await expectCode(pr([{ bom_line_id: l2!.id, quantity_milli: 1000 }]), 'VALIDATION_FAILED'); // BOM quantity already requested
    expect(await as('tech1').query('select 1 from public.purchase_requests where id = $1', [r.request_id])).toEqual([]);
    const q = (over = {}) => as('procure1').rpc('add_supplier_quote', { p_request_id: r.request_id, p_payload: {
      supplier_id: fx.orgs.supplier, net_paise: '550000000', tax_paise: '99000000', freight_paise: '2500000', lead_time_days: 45, warranty_months: 18, technical_match: true, ...over } });
    await expectCode(q({ supplier_id: fx.orgs.partnerA }), 'VALIDATION_FAILED');
    const bad = await q({ technical_match: false, net_paise: '400000000' });
    const good = await q();
    await expectCode(as('procure1').rpc('select_supplier', { p_request_id: r.request_id, p_expected_version: r.version, p_quote_id: bad.quote_id, p_rationale: 'Cheapest' }), 'APPROVAL_REQUIRED');
    await expectCode(as('procure1').rpc('select_supplier', { p_request_id: r.request_id, p_expected_version: r.version, p_quote_id: good.quote_id, p_rationale: '' }), 'REQUIRED_FIELD_MISSING');
    const sel = await as('procure1').rpc('select_supplier', { p_request_id: r.request_id, p_expected_version: r.version, p_quote_id: good.quote_id, p_rationale: 'Technically compliant, 45-day lead time' });
    expect(sel.status).toBe('supplier_selected');
  });
});

describe('Slice 4 — purchase orders, material tracking and goods receipt (PR03–PR05)', () => {
  it('a PO above the limit needs approval by another person; lines are tracked separately; partial receipts never complete a line', async () => {
    const p = await planningProject();
    const bom = await approvedBom(p.projectId);
    await verifiedAdvance(p.projectId);
    const [l1, l2] = await admin<{ id: string }>(pool, 'select id from public.bom_lines where bom_revision_id = $1 order by line_no', [bom.bom_revision_id]);
    const pc = as('procure1');
    const r = await pc.rpc('create_purchase_request', { p_operation_id: randomUUID(), p_project_id: p.projectId,
      p_payload: { required_by: inDays(30), lines: [{ bom_line_id: l1!.id, quantity_milli: 1000 }, { bom_line_id: l2!.id, quantity_milli: 30000 }] } });
    const qt = await pc.rpc('add_supplier_quote', { p_request_id: r.request_id, p_payload: { supplier_id: fx.orgs.supplier, net_paise: '650000000', tax_paise: '117000000', lead_time_days: 30, technical_match: true } });
    const sel = await pc.rpc('select_supplier', { p_request_id: r.request_id, p_expected_version: r.version, p_quote_id: qt.quote_id, p_rationale: 'Only compliant supplier' });
    void sel;
    const lines = await admin<{ id: string }>(pool, 'select id from public.purchase_request_lines where request_id = $1 order by line_no', [r.request_id]);
    const payload = { lines: [{ request_line_id: lines[0]!.id, rate_paise: '500000000', tax_rate_bps: 1800 }, { request_line_id: lines[1]!.id, rate_paise: '500000', tax_rate_bps: 1800 }],
      freight_paise: '2500000', delivery_location: 'Site, Baner, Pune', delivery_from: inDays(30), delivery_to: inDays(40), payment_terms: '30 days from GRN' };
    await expectCode(pc.rpc('create_purchase_order', { p_operation_id: randomUUID(), p_request_id: r.request_id, p_payload: { ...payload, lines: [payload.lines[0]] } }), 'VALIDATION_FAILED');
    const po = await pc.rpc('create_purchase_order', { p_operation_id: randomUUID(), p_request_id: r.request_id, p_payload: payload });
    expect(po.po_number).toMatch(/^PO-PUN-\d{4}-\d{5}$/);
    // 5,00,00,000 + 18% + 30 m × 5,000.00 + 18% + freight 25,000 → above the ₹5,00,000 limit.
    expect(po.totals.totalPaise).toBe((500000000n * 118n / 100n + 15000000n * 118n / 100n + 2500000n).toString());
    expect(po.needs_approval).toBe(true);
    const sub = await pc.rpc('submit_purchase_order', { p_po_id: po.po_id, p_expected_version: po.version });
    expect(sub.status).toBe('pending_approval');
    await expectCode(pc.rpc('decide_approval_request', { p_request_id: sub.approval_request_id, p_decision: 'approve' }), 'ACCESS_DENIED');
    const ap = await as('ops1').rpc('decide_approval_request', { p_request_id: sub.approval_request_id, p_decision: 'approve' });
    expect(ap.approval_status).toBe('approved');
    const iss = await pc.rpc('issue_purchase_order', { p_po_id: po.po_id, p_expected_version: await version('purchase_orders', po.po_id) });
    expect(iss.status).toBe('issued');
    const pol = await admin<{ id: string; quantity_milli: number }>(pool, 'select id, quantity_milli from public.purchase_order_lines where po_id = $1 order by line_no', [po.po_id]);
    await expectCode(admin(pool, `update public.purchase_order_lines set rate_paise = 1 where id = $1`, [pol[0]!.id]), 'ACCESS_DENIED');
    const grn = (lines: unknown[]) => pc.rpc('record_goods_receipt', { p_operation_id: randomUUID(), p_po_id: po.po_id, p_payload: { lines } });
    await expectCode(grn([{ po_line_id: pol[0]!.id, received_milli: 1000, result: 'accepted' }]), 'INVALID_STATE_TRANSITION'); // not delivered yet
    for (const l of pol) {
      for (const action of ['confirm', 'mark_ready', 'dispatch', 'mark_delivered']) {
        await pc.rpc('update_material_status', { p_po_line_id: l.id, p_expected_version: await version('purchase_order_lines', l.id), p_action: action });
      }
    }
    await expectCode(as('tech1').rpc('update_material_status', { p_po_line_id: pol[0]!.id, p_expected_version: 1, p_action: 'confirm' }), 'NOT_FOUND');
    // Partial + damaged + quarantined.
    await expectCode(grn([{ po_line_id: pol[1]!.id, received_milli: 20000, damaged_milli: 2000, result: 'accepted' }]), 'REQUIRED_FIELD_MISSING');
    const g1 = await grn([
      { po_line_id: pol[1]!.id, received_milli: 20000, damaged_milli: 2000, result: 'accepted', remarks: '2 m bent in transit' },
      { po_line_id: pol[0]!.id, received_milli: 1000, result: 'quarantined', remarks: 'Nameplate does not match make/model' },
    ]);
    expect(g1.grn_number).toMatch(/^GRN-PUN-\d{4}-\d{5}$/);
    expect(g1.po_closed).toBe(false);
    const after = await admin(pool, 'select material_status, received_milli, accepted_milli from public.purchase_order_lines where po_id = $1 order by line_no', [po.po_id]);
    expect(after).toEqual([
      { material_status: 'received', received_milli: 1000, accepted_milli: 0 },
      { material_status: 'received', received_milli: 20000, accepted_milli: 18000 },
    ]);
    await expectCode(grn([{ po_line_id: pol[0]!.id, received_milli: 1, result: 'accepted' }]), 'VALIDATION_FAILED'); // over-receipt
    await expectCode(admin(pool, `delete from public.goods_receipt_lines where receipt_id = $1`, [g1.grn_id]), 'ACCESS_DENIED');
    const [{ status }] = await admin(pool, 'select status from public.purchase_orders where id = $1', [po.po_id]);
    expect(status).toBe('issued'); // never closed while anything is outstanding
  });
});

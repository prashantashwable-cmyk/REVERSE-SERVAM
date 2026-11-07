import { createHash, randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ORDER_HANDOVER_ITEMS, SITE_READINESS_ITEMS, DEFAULT_SAFETY_CHECKS } from '@aiec/domain';
import { Session, admin } from './db';
import type { Fixture } from './fixture';
import { PASSENGER_CONFIG, asParameters, flows } from './flows';

/**
 * Slice 5 building blocks: a project that has everything except a partner, fresh partner
 * companies (each test owns its own tenant, so states never leak between tests), and the
 * compliance / readiness steps. Everything goes through the real RPCs as the right person.
 */
export const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const inDays = (n: number) => new Date(Date.now() + 330 * 60000 + n * 864e5).toISOString().slice(0, 10);
const TERMS = Object.fromEntries(['scope_of_supply', 'scope_of_installation', 'customer_responsibilities', 'exclusions', 'tax_treatment', 'payment_terms', 'warranty_terms', 'delivery_assumptions'].map((k) => [k, `Agreed ${k}`]));
const CHECKLIST = Object.fromEntries(ORDER_HANDOVER_ITEMS.map((k) => [k, true]));
export const ALL_SITE_PASS = SITE_READINESS_ITEMS.map((i) => ({ key: i.key, result: 'pass' }));
export const ALL_SAFE = Object.fromEntries(DEFAULT_SAFETY_CHECKS.map((c) => [c.key, { applicable: true, confirmed: true }]));
export const OFFER = {
  scope_summary: 'Install one 8-person MRL lift, G+4, as per approved drawings',
  contract_value_paise: '45000000',
  payment_terms: '40% on rails and machine, 40% on QA pass, 20% on handover',
  material_responsibility: 'AIEC supplies all lift material; partner brings tools and scaffolding',
  safety_requirements: 'Full PPE, harness above 2 m, lockout-tagout for electrical work',
  exclusions: 'Civil work and painting',
};

export function executionFlows(pool: pg.Pool, fx: Fixture) {
  const base = flows(pool, fx);
  const as = base.as;
  const version = async (table: string, id: string) =>
    (await admin<{ version: number }>(pool, `select version from public.${table} where ${table === 'partner_profiles' ? 'organization_id' : 'id'} = $1`, [id]))[0]!.version;

  async function newUser(name: string) {
    const phone = `9198${String(randomInt(1e8)).padStart(8, '0')}`;
    const [u] = await admin<{ id: string }>(pool, `insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id`, [phone, { full_name: name }]);
    return u!.id;
  }

  /** A fresh partner company with its admin and one technician (enrolled by the admin, tenant-scoped). */
  async function newPartner(label = `Partner ${randomUUID().slice(0, 8)}`) {
    const owner = as('owner');
    const org = await owner.rpc<string>('admin_create_organization', { p_kind: 'partner', p_name: label, p_legal_name: null, p_city: 'Pune', p_reason: 'test partner' });
    const adminId = await newUser(`${label} admin`);
    const techId = await newUser(`${label} technician`);
    await owner.rpc('admin_add_member', { p_user_id: adminId, p_org_id: org, p_reason: 'test' });
    await owner.rpc('admin_grant_role', { p_user_id: adminId, p_org_id: org, p_role_code: 'partner_admin', p_reason: 'test' });
    await owner.rpc('admin_set_user_status', { p_user_id: adminId, p_status: 'active', p_reason: 'test' });
    const pa = new Session(pool, adminId);
    await pa.rpc('admin_add_member', { p_user_id: techId, p_org_id: org, p_reason: 'new technician' });
    await pa.rpc('admin_grant_role', { p_user_id: techId, p_org_id: org, p_role_code: 'technician', p_reason: 'new technician' });
    await pa.rpc('admin_set_user_status', { p_user_id: techId, p_status: 'active', p_reason: 'identity verified' });
    return { org, adminId, techId, admin: pa, tech: new Session(pool, techId) };
  }

  const PROFILE = {
    legal_name: 'Alpha Lift Works LLP', entity_type: 'llp', registered_address: 'Shop 4, Baner Road, Pune 411045', authorized_representative: 'Mr. Anil Patil',
    contact_phone: '9822000001', service_areas: ['Pune', 'PCMC'], lift_categories: ['passenger', 'goods'], team_size: 8, experience_years: 6,
    safety_policy_accepted: true, compliance_declaration: true,
  };

  /** Upload a file into partner-documents as the partner admin, then register it. */
  async function addDocument(p: Awaited<ReturnType<typeof newPartner>>, docType: string, over: Record<string, unknown> = {}) {
    const op = randomUUID();
    const path = `${p.org}/documents/${op}.pdf`;
    await p.admin.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('partner-documents', $1, $2, $3)`, [path, p.adminId, { size: 4096, mimetype: 'application/pdf' }]);
    return p.admin.rpc('register_partner_document', { p_operation_id: op, p_org_id: p.org, p_payload: {
      doc_type: docType, doc_number: `${docType.toUpperCase()}-123`, issuer: 'Issuing authority', issued_on: inDays(-200), expires_on: inDays(300),
      scope: docType === 'contractor_licence' ? ['passenger', 'goods'] : [], storage_path: path, sha256: createHash('sha256').update(op).digest('hex'),
      mime_type: 'application/pdf', size_bytes: 4096, ...over } });
  }

  /** Profile → four required documents → submit → AIEC verifies each and approves (Gate 7 satisfied). */
  async function approvedPartner(skills: string[] = ['general', 'mechanical', 'electrical', 'testing']) {
    const p = await newPartner();
    await p.admin.rpc('save_partner_profile', { p_org_id: p.org, p_expected_version: null, p_payload: PROFILE });
    const docs = [];
    for (const t of ['contractor_licence', 'insurance', 'pan', 'bank_verification']) docs.push(await addDocument(p, t));
    const s = await p.admin.rpc('partner_action', { p_org_id: p.org, p_expected_version: await version('partner_profiles', p.org), p_action: 'submit' });
    const owner = as('owner');
    await owner.rpc('partner_action', { p_org_id: p.org, p_expected_version: s.version, p_action: 'start_verification' });
    for (const d of docs) await owner.rpc('verify_partner_document', { p_document_id: d.document_id, p_decision: 'verify' });
    await owner.rpc('partner_action', { p_org_id: p.org, p_expected_version: await version('partner_profiles', p.org), p_action: 'approve' });
    await p.admin.rpc('set_worker_profile', { p_org_id: p.org, p_user_id: p.techId, p_skills: skills, p_training_note: 'Induction and harness training done' });
    return { ...p, documents: docs };
  }

  /** Accepted quotation → order → project in planning (Operations accepted the handover). */
  async function planningProject() {
    const s = await base.submittedSurvey();
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
    await sales.rpc('record_customer_response', { p_revision_id: q.revision_id, p_expected_version: iss.version, p_response: 'accept',
      p_payload: { accepted_by_name: 'Mr. Rao', acceptor_authority: 'Secretary', channel: 'signed_copy', evidence: 'Signed copy', content_sha256: iss.content_sha256 } });
    const p = await sales.rpc('convert_quotation_to_order', { p_operation_id: randomUUID(), p_revision_id: q.revision_id,
      p_payload: { contract_reference: 'AGR-2026-501', contract_date: today(), milestone_template: 'new_installation', handover_checklist: CHECKLIST } });
    await as('ops1').rpc('acknowledge_project_handover', { p_project_id: p.project_id, p_expected_version: p.version, p_notes: 'Received' });
    return { ...s, projectId: p.project_id as string };
  }

  async function verifiedMilestone(projectId: string, code: string) {
    const [m] = await admin<{ amount_paise: string }>(pool, `select amount_paise from public.payment_milestones where project_id = $1 and code = $2`, [projectId, code]);
    const c = await as('sales1').rpc('record_payment_claim', { p_operation_id: randomUUID(), p_project_id: projectId, p_payload: {
      milestone_code: code, payer_name: 'Society', amount_paise: m!.amount_paise, payment_mode: 'neft', payment_reference: `UTR-${code}-${randomInt(1e6)}`, payment_date: today() } });
    return as('finance1').rpc('decide_payment_claim', { p_claim_id: c.claim_id, p_expected_version: c.version, p_decision: 'verify',
      p_payload: { verified_amount_paise: m!.amount_paise, matched_statement_reference: `HDFC stmt ${code}` } });
  }

  /** Approved BOM, advance verified, one small PO (within the limit) issued, delivered and fully accepted. */
  async function materialReceived(projectId: string) {
    const b = await as('tech1').rpc('save_bom_draft', { p_project_id: projectId, p_expected_version: null, p_change_summary: 'Initial', p_lines: [
      { item_code: 'MC-1', description: 'Machine and controller', quantity_milli: 1000, unit: 'set' },
    ] });
    await as('tech1').rpc('approve_bom', { p_bom_revision_id: b.bom_revision_id, p_expected_version: b.version });
    await verifiedMilestone(projectId, 'advance');
    const [bl] = await admin<{ id: string }>(pool, 'select id from public.bom_lines where bom_revision_id = $1', [b.bom_revision_id]);
    const pc = as('procure1');
    const r = await pc.rpc('create_purchase_request', { p_operation_id: randomUUID(), p_project_id: projectId, p_payload: { required_by: inDays(10), lines: [{ bom_line_id: bl!.id, quantity_milli: 1000 }] } });
    const qt = await pc.rpc('add_supplier_quote', { p_request_id: r.request_id, p_payload: { supplier_id: fx.orgs.supplier, net_paise: '20000000', tax_paise: '3600000', lead_time_days: 10, technical_match: true } });
    await pc.rpc('select_supplier', { p_request_id: r.request_id, p_expected_version: r.version, p_quote_id: qt.quote_id, p_rationale: 'Only compliant offer' });
    const [rl] = await admin<{ id: string }>(pool, 'select id from public.purchase_request_lines where request_id = $1', [r.request_id]);
    const po = await pc.rpc('create_purchase_order', { p_operation_id: randomUUID(), p_request_id: r.request_id, p_payload: {
      lines: [{ request_line_id: rl!.id, rate_paise: '20000000', tax_rate_bps: 1800 }], delivery_location: 'Site, Aundh, Pune', delivery_from: inDays(5), delivery_to: inDays(9), payment_terms: '30 days' } });
    const sub = await pc.rpc('submit_purchase_order', { p_po_id: po.po_id, p_expected_version: po.version });
    await pc.rpc('issue_purchase_order', { p_po_id: po.po_id, p_expected_version: sub.version });
    const [pl] = await admin<{ id: string }>(pool, 'select id from public.purchase_order_lines where po_id = $1', [po.po_id]);
    for (const a of ['confirm', 'mark_ready', 'dispatch', 'mark_delivered']) {
      await pc.rpc('update_material_status', { p_po_line_id: pl!.id, p_expected_version: await version('purchase_order_lines', pl!.id), p_action: a });
    }
    await pc.rpc('record_goods_receipt', { p_operation_id: randomUUID(), p_po_id: po.po_id, p_payload: { lines: [{ po_line_id: pl!.id, received_milli: 1000, result: 'accepted' }] } });
  }

  /** An approved technical document for the project's lead (documentation readiness). */
  async function approvedDocument(leadId: string) {
    const op = randomUUID();
    const path = `${fx.orgs.aiec}/leads/${leadId}/${op}.pdf`;
    await as('tech1').query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('technical-documents', $1, $2, $3)`, [path, fx.users.tech1, { size: 2048, mimetype: 'application/pdf' }]);
    const sha = createHash('sha256').update(op).digest('hex');
    const d = await as('tech1').rpc('register_document_revision', { p_operation_id: op, p_lead_id: leadId, p_document_id: null,
      p_payload: { kind: 'shaft_layout', title: 'Shaft layout', storage_path: path, sha256: sha, mime_type: 'application/pdf', size_bytes: 2048, change_summary: 'First issue' } });
    const s = await as('tech1').rpc('submit_document_revision', { p_revision_id: d.document_revision_id, p_expected_version: d.version });
    await as('tech1').rpc('decide_document_revision', { p_revision_id: d.document_revision_id, p_expected_version: s.version, p_decision: 'approve', p_reviewed_sha256: sha });
  }

  return { ...base, as, version, newUser, newPartner, addDocument, approvedPartner, planningProject, verifiedMilestone, materialReceived, approvedDocument, PROFILE };
}

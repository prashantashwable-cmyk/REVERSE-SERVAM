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

  /** A fresh partner company with its admin and technicians (enrolled by the admin, tenant-scoped). */
  async function newPartner(label = `Partner ${randomUUID().slice(0, 8)}`, names: { admin?: string; technicians?: string[]; city?: string } = {}) {
    const owner = as('owner');
    const org = await owner.rpc<string>('admin_create_organization', { p_kind: 'partner', p_name: label, p_legal_name: null, p_city: names.city ?? 'Pune', p_reason: 'new partner company' });
    const adminId = await newUser(names.admin ?? `${label} admin`);
    await owner.rpc('admin_add_member', { p_user_id: adminId, p_org_id: org, p_reason: 'partner administrator' });
    await owner.rpc('admin_grant_role', { p_user_id: adminId, p_org_id: org, p_role_code: 'partner_admin', p_reason: 'partner administrator' });
    await owner.rpc('admin_set_user_status', { p_user_id: adminId, p_status: 'active', p_reason: 'identity verified' });
    const pa = new Session(pool, adminId);
    const techIds: string[] = [];
    for (const name of names.technicians ?? [`${label} technician`]) {
      const id = await newUser(name);
      await pa.rpc('admin_add_member', { p_user_id: id, p_org_id: org, p_reason: 'new technician' });
      await pa.rpc('admin_grant_role', { p_user_id: id, p_org_id: org, p_role_code: 'technician', p_reason: 'new technician' });
      await pa.rpc('admin_set_user_status', { p_user_id: id, p_status: 'active', p_reason: 'identity verified' });
      techIds.push(id);
    }
    const techId = techIds[0]!;
    return { org, adminId, techId, techIds, admin: pa, tech: new Session(pool, techId) };
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

  type PartnerNames = Parameters<typeof newPartner>[1] & { label?: string; profile?: Record<string, unknown> };

  type PartnerHandle = Awaited<ReturnType<typeof newPartner>>;

  /** An existing partner organization (e.g. from the fixture) as a handle for the flows below. */
  function partnerHandle(org: string, adminId: string, techIds: string[]): PartnerHandle {
    return { org, adminId, techId: techIds[0]!, techIds, admin: new Session(pool, adminId), tech: new Session(pool, techIds[0]!) };
  }

  /** Profile → four required documents → submit → AIEC verifies each and approves (Gate 7 satisfied). */
  async function approvePartner(p: PartnerHandle, skills: string[], profile: Record<string, unknown> = {}) {
    await p.admin.rpc('save_partner_profile', { p_org_id: p.org, p_expected_version: null, p_payload: { ...PROFILE, ...profile } });
    const docs = [];
    for (const t of ['contractor_licence', 'insurance', 'pan', 'bank_verification']) docs.push(await addDocument(p, t));
    const s = await p.admin.rpc('partner_action', { p_org_id: p.org, p_expected_version: await version('partner_profiles', p.org), p_action: 'submit' });
    const owner = as('owner');
    await owner.rpc('partner_action', { p_org_id: p.org, p_expected_version: s.version, p_action: 'start_verification' });
    for (const d of docs) await owner.rpc('verify_partner_document', { p_document_id: d.document_id, p_decision: 'verify' });
    await owner.rpc('partner_action', { p_org_id: p.org, p_expected_version: await version('partner_profiles', p.org), p_action: 'approve' });
    for (const id of p.techIds) await p.admin.rpc('set_worker_profile', { p_org_id: p.org, p_user_id: id, p_skills: skills, p_training_note: 'Induction and harness training done' });
    return { ...p, documents: docs };
  }

  async function approvedPartner(skills: string[] = ['general', 'mechanical', 'electrical', 'testing']) {
    return approvePartner(await newPartner(), skills);
  }

  /** Add a technician to an existing partner, enrolled by its admin. */
  async function enrolTechnician(p: PartnerHandle, name: string) {
    const id = await newUser(name);
    await p.admin.rpc('admin_add_member', { p_user_id: id, p_org_id: p.org, p_reason: 'new technician' });
    await p.admin.rpc('admin_grant_role', { p_user_id: id, p_org_id: p.org, p_role_code: 'technician', p_reason: 'new technician' });
    await p.admin.rpc('admin_set_user_status', { p_user_id: id, p_status: 'active', p_reason: 'identity verified' });
    p.techIds.push(id);
    return id;
  }

  interface ProjectOptions {
    /** Lead payload overrides (names, site). */
    lead?: Record<string, unknown>;
    /** Issue revision 1, then revise (customer negotiation) and accept revision 2 with this discount. */
    reviseWithDiscountBps?: number;
    /** Leave the project waiting for Operations to accept the handover. */
    skipHandoverAcceptance?: boolean;
    contractReference?: string;
  }

  /** Accepted quotation → order → project in planning (Operations accepted the handover). */
  async function planningProject(o: ProjectOptions = {}) {
    const s = await base.submittedSurvey('sales1', 'surveyor1', o.lead);
    const tech = as('tech1');
    const r = await tech.rpc('start_technical_review', { p_survey_id: s.surveyId });
    await tech.rpc('decide_technical_review', { p_review_id: r.review_id, p_expected_version: r.version, p_decision: 'feasible', p_payload: { technical_basis: 'Fits' } });
    const d = await tech.rpc('save_configuration_draft', { p_lead_id: s.leadId, p_expected_version: null, p_lift_category: 'passenger', p_parameters: asParameters(PASSENGER_CONFIG) });
    await tech.rpc('approve_configuration', { p_revision_id: d.configuration_revision_id, p_expected_version: d.version });
    const sales = as('sales1');
    const q = await sales.rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId });
    const line = { category: 'lift_equipment', description: 'MRL lift', quantity_milli: 1000, unit: 'nos', rate_paise: '1000000000', discount_bps: 0, tax_code: 'GST18', estimated_unit_cost_paise: '700000000' };
    const issue = async (revisionId: string, version: number, discountBps: number) => {
      const sv = await sales.rpc('save_quotation_draft', { p_revision_id: revisionId, p_expected_version: version, p_lines: [{ ...line, discount_bps: discountBps }], p_terms: TERMS, p_valid_until: inDays(20) });
      const sub = await sales.rpc('submit_quotation', { p_revision_id: revisionId, p_expected_version: sv.version });
      return sales.rpc('issue_quotation', { p_revision_id: revisionId, p_expected_version: sub.version });
    };
    let revisionId = q.revision_id as string;
    let iss = await issue(revisionId, q.version, 0);
    if (o.reviseWithDiscountBps !== undefined) {
      await sales.rpc('add_quotation_negotiation', { p_quotation_id: q.quotation_id, p_payload: {
        occurred_at: new Date().toISOString(), contact: 'Mr. Rao, Secretary', topic: 'Committee asked for a lower price before signing', requested_change: 'Discount on the lift equipment line',
        requested_discount_bps: o.reviseWithDiscountBps, decision: 'Revised quotation to be issued' } });
      const rev = await sales.rpc('revise_quotation', { p_quotation_id: q.quotation_id, p_reason: 'Negotiated discount agreed with the committee' });
      revisionId = rev.revision_id;
      iss = await issue(revisionId, rev.version, o.reviseWithDiscountBps);
    }
    await sales.rpc('record_customer_response', { p_revision_id: revisionId, p_expected_version: iss.version, p_response: 'accept',
      p_payload: { accepted_by_name: 'Mr. Rao', acceptor_authority: 'Secretary', channel: 'signed_copy', evidence: 'Signed copy', content_sha256: iss.content_sha256 } });
    const p = await sales.rpc('convert_quotation_to_order', { p_operation_id: randomUUID(), p_revision_id: revisionId,
      p_payload: { contract_reference: o.contractReference ?? 'AGR-2026-501', contract_date: today(), milestone_template: 'new_installation', handover_checklist: CHECKLIST } });
    if (!o.skipHandoverAcceptance) await as('ops1').rpc('acknowledge_project_handover', { p_project_id: p.project_id, p_expected_version: p.version, p_notes: 'Received' });
    return { ...s, projectId: p.project_id as string, quotationId: q.quotation_id as string };
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

  /** Project in planning with an accepted, eligible partner and the technician on the team. */
  async function acceptedAssignment(o: ProjectOptions & { partner?: Awaited<ReturnType<typeof approvedPartner>> } = {}) {
    const p = o.partner ?? (await approvedPartner());
    const project = await planningProject(o);
    const inv = await as('ops1').rpc('invite_partner', { p_project_id: project.projectId, p_partner_org_id: p.org, p_payload: { ...OFFER, schedule_from: inDays(5), schedule_to: inDays(40) } });
    await p.admin.rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: inv.version, p_action: 'accept', p_offer_sha256: inv.offer_sha256 });
    for (const id of p.techIds) await p.admin.rpc('set_project_team_member', { p_assignment_id: inv.assignment_id, p_user_id: id, p_action: 'add' });
    return { partner: p, project, assignmentId: inv.assignment_id as string };
  }

  /** …and installation started (site ready, drawing approved, material received, pre-dispatch verified). */
  async function installingProject(o: Parameters<typeof acceptedAssignment>[0] = {}) {
    const a = await acceptedAssignment(o);
    const pid = a.project.projectId;
    await as('ops1').rpc('record_site_readiness', { p_project_id: pid, p_items: ALL_SITE_PASS });
    await approvedDocument(a.project.leadId);
    await materialReceived(pid);
    await verifiedMilestone(pid, 'pre_dispatch');
    const r = await as('ops1').rpc('project_execution_action', { p_project_id: pid, p_expected_version: await version('projects', pid), p_action: 'mark_installation_ready' });
    await as('ops1').rpc('project_execution_action', { p_project_id: pid, p_expected_version: r.version, p_action: 'start_installation' });
    return a;
  }

  async function taskByCode(projectId: string, code: string) {
    const [t] = await admin<{ id: string; version: number; status: string; checklist: string[]; evidence_required: string[] }>(pool,
      'select id, version, status, checklist, evidence_required from public.project_tasks where project_id = $1 and code = $2', [projectId, code]);
    return t!;
  }

  async function taskEvidence(a: Awaited<ReturnType<typeof installingProject>>, taskId: string, category: string, defectId: string | null = null) {
    const op = randomUUID();
    const path = `${a.partner.org}/tasks/${taskId}/${op}.jpg`;
    await a.partner.tech.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('execution-evidence', $1, $2, $3)`, [path, a.partner.techId, { size: 3000, mimetype: 'image/jpeg' }]);
    return a.partner.tech.rpc('register_task_evidence', { p_operation_id: op, p_task_id: taskId, p_payload: {
      category, defect_id: defectId, storage_path: path, sha256: createHash('sha256').update(op).digest('hex'), mime_type: 'image/jpeg', size_bytes: 3000,
      captured_at: new Date().toISOString(), source: 'in_app_camera' } });
  }

  /** Assign → accept → safety → start → full checklist → required photos → submit (Gate 9). */
  async function submitTask(a: Awaited<ReturnType<typeof installingProject>>, code: string) {
    const t = await taskByCode(a.project.projectId, code);
    const asg = await a.partner.admin.rpc('assign_task', { p_task_id: t.id, p_expected_version: t.version, p_assignee_id: a.partner.techId });
    const acc = await a.partner.tech.rpc('accept_task', { p_task_id: t.id, p_expected_version: asg.version });
    await a.partner.tech.rpc('record_safety_check', { p_operation_id: randomUUID(), p_task_id: t.id, p_answers: ALL_SAFE });
    const st = await a.partner.tech.rpc('start_task', { p_task_id: t.id, p_expected_version: acc.version });
    const sp = await a.partner.tech.rpc('save_task_progress', { p_task_id: t.id, p_expected_version: st.version, p_answers: Object.fromEntries(t.checklist.map((k) => [k, { done: true }])) });
    for (const c of t.evidence_required) await taskEvidence(a, t.id, c);
    await a.partner.tech.rpc('submit_task', { p_task_id: t.id, p_expected_version: sp.version });
    return t.id;
  }

  return { ...base, as, version, newUser, newPartner, partnerHandle, approvePartner, enrolTechnician, addDocument, approvedPartner, planningProject, verifiedMilestone, materialReceived, approvedDocument, PROFILE,
    acceptedAssignment, installingProject, taskByCode, taskEvidence, submitTask };
}

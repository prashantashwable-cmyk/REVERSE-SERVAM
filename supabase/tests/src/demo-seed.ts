import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DEFAULT_HANDOVER_DOCUMENTS, DEFAULT_QA_CHECKLISTS, DEFAULT_TASK_TEMPLATE, SITE_READINESS_ITEMS } from '@aiec/domain';
import { admin } from './db';
import { executionFlows, inDays, today } from './execution-flows';
import type { Fixture, UserKey } from './fixture';
import type { FixtureNames } from './setup-db';

/**
 * Synthetic demo data (§63). Every record is created through the real RPCs, as the person who would
 * do it, so the data obeys every gate, permission and audit rule. Names, phones, sites and companies
 * are fictional. Run it only on a fresh demo database (`npm run seed:demo`) or the throw-away test
 * database — never on production.
 */

/** Fictional people and organizations for the demo database (phones +91 90000 000NN as in USERS). */
export const DEMO_NAMES: FixtureNames = {
  person: (key: UserKey) =>
    ({
      owner: 'Vikram Deshmukh', sales1: 'Snehal Kulkarni', sales2: 'Rohan Jadhav', surveyor1: 'Ganesh Pawar', surveyor2: 'Pooja Shinde',
      tech1: 'Ajit Gokhale', ops1: 'Manisha Bhosale', partnerA_admin: 'Sachin More', partnerA_tech: 'Nitin Salunkhe',
      partnerB_admin: 'Kiran Thorat', partnerB_tech: 'Amol Gaikwad', customer1: 'Prakash Rao', pending1: 'Rahul Kale',
      finance1: 'Sunita Joshi', procure1: 'Mahesh Patil', qa1: 'Deepak Kadam',
    })[key],
  aiec: 'All India Elevators Company (DEMO)',
  partnerA: 'Sahyadri Lift Erectors (DEMO)',
  partnerB: 'Krishna Elevator Services (DEMO)',
  customer: 'Shivneri Heights Co-operative Housing Society (DEMO)',
  supplier: 'Demo Supplier Lift Components',
};

const site = (locality: string, pincode: string, city = 'Pune') => ({ city, locality, pincode });

/** Leads that become the five sample projects (distinct names, phones and localities: no duplicate warnings). */
const PROJECT_LEADS = [
  { contact_name: 'Prakash Rao', phone: '9890010001', customer_type: 'housing_society', project_name: 'Shivneri Heights', source: 'referral', site: site('Aundh', '411007') },
  { contact_name: 'Meera Apte', phone: '9890010002', customer_type: 'builder_developer', project_name: 'Gulmohar Park Phase 2', source: 'builder_visit', site: site('Wakad', '411057', 'PCMC') },
  { contact_name: 'Sanjay Naik', phone: '9890010003', customer_type: 'housing_society', project_name: 'Indrayani Towers', source: 'website', site: site('Kothrud', '411038') },
  { contact_name: 'Farida Shaikh', phone: '9890010004', customer_type: 'commercial', project_name: 'Mogra Business Centre', source: 'phone', site: site('Hadapsar', '411028') },
  { contact_name: 'Dr. Arun Bapat', phone: '9890010005', customer_type: 'institution', project_name: 'Sahyadri Clinic Annex', source: 'existing_customer', site: site('Karve Nagar', '411052') },
].map((l) => ({ ...l, lift_requirement: 'One 8-passenger MRL lift, G+4' }));

/** Leads that stay in the sales pipeline, one per remaining status. */
const PIPELINE_LEADS = {
  assigned: { contact_name: 'Vaishali Ghorpade', phone: '9890010006', customer_type: 'individual', project_name: 'Ghorpade Bungalow Home Lift', source: 'whatsapp', site: site('Baner', '411045'), lift_requirement: 'Home lift, G+2' },
  contacted: { contact_name: 'Harish Mehta', phone: '9890010007', customer_type: 'commercial', project_name: 'Tulsi Baug Shopping Arcade', source: 'marketing_campaign', site: site('Shivajinagar', '411005'), lift_requirement: 'Goods lift 1000 kg' },
  qualified: { contact_name: 'Anjali Kher', phone: '9890010008', customer_type: 'housing_society', project_name: 'Kalpataru Vihar', source: 'referral', site: site('Pimple Saudagar', '411027', 'PCMC'), lift_requirement: 'Two passenger lifts, G+7' },
  lost: { contact_name: 'Rajesh Kamble', phone: '9890010009', customer_type: 'builder_developer', project_name: 'Pratik Nagar Row Houses', source: 'builder_visit', site: site('Yerawada', '411006'), lift_requirement: 'Four small lifts' },
  invalid: { contact_name: 'Unknown caller', phone: '9890010010', customer_type: 'other', project_name: 'Test enquiry', source: 'phone', site: site('Camp', '411001'), lift_requirement: 'Not stated' },
};

export interface DemoSummary {
  partners: { alpha: string; beta: string };
  projects: Record<'awaitingHandover' | 'siteBlocked' | 'installingWithDefect' | 'statutoryPending' | 'handedOver', string>;
  leads: Record<keyof typeof PIPELINE_LEADS, string>;
}

export async function seedDemo(pool: pg.Pool, fx: Fixture, o: { useFixturePartners?: boolean } = {}): Promise<DemoSummary> {
  const f = executionFlows(pool, fx);
  const { as, version } = f;

  /* ------------------------------ partners (2) and technicians (6) ------------------------------ */
  // In the demo database the fixture's two partner companies are used, so their admins and first
  // technicians can sign in with the listed demo phones; the test run uses fresh companies instead.
  const alphaBase = o.useFixturePartners
    ? f.partnerHandle(fx.orgs.partnerA, fx.users.partnerA_admin, [fx.users.partnerA_tech])
    : await f.newPartner('Sahyadri Lift Erectors (DEMO)', { technicians: ['Nitin Salunkhe'] });
  const betaBase = o.useFixturePartners
    ? f.partnerHandle(fx.orgs.partnerB, fx.users.partnerB_admin, [fx.users.partnerB_tech])
    : await f.newPartner('Krishna Elevator Services (DEMO)', { technicians: ['Amol Gaikwad'], city: 'PCMC' });
  for (const name of ['Vijay Chavan', 'Sagar Lokhande']) await f.enrolTechnician(alphaBase, name);
  for (const name of ['Suresh Mane', 'Tushar Waghmare']) await f.enrolTechnician(betaBase, name);
  // Alpha: approved and eligible for passenger and goods lifts; its three technicians have recorded skills.
  const alpha = await f.approvePartner(alphaBase, ['general', 'mechanical', 'electrical', 'testing'], {
    legal_name: 'Sahyadri Lift Erectors LLP', authorized_representative: 'Mr. Sachin More', contact_phone: '9890020001' });
  // Beta: profile saved but the insurance certificate is missing, so it cannot submit and is not eligible.
  const beta = betaBase;
  await beta.admin.rpc('save_partner_profile', { p_org_id: beta.org, p_expected_version: null, p_payload: {
    ...f.PROFILE, legal_name: 'Krishna Elevator Services', entity_type: 'proprietorship', registered_address: 'Plot 12, Bhosari MIDC, PCMC 411026',
    authorized_representative: 'Mr. Kiran Thorat', contact_phone: '9890020002', service_areas: ['PCMC'], lift_categories: ['passenger'], team_size: 4, experience_years: 3 } });
  for (const t of ['contractor_licence', 'pan', 'bank_verification']) await f.addDocument(beta, t);
  for (const id of beta.techIds) await beta.admin.rpc('set_worker_profile', { p_org_id: beta.org, p_user_id: id, p_skills: ['general', 'mechanical'], p_training_note: 'Induction pending' });

  /* ------------------------------------ helpers (QA / handover) ------------------------------------ */
  const answers = (key: string, over: Record<string, unknown> = {}) =>
    ({ ...Object.fromEntries(DEFAULT_QA_CHECKLISTS[key]!.map((c) => [c.key, { result: 'pass' }])), ...over });
  const inspect = (payload: Record<string, unknown>) => as('qa1').rpc('record_inspection', { p_operation_id: randomUUID(), p_payload: payload });
  const projectFile = async (projectId: string) => {
    const op = randomUUID();
    const path = `${fx.orgs.aiec}/projects/${projectId}/${op}.pdf`;
    await as('ops1').query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('handover-documents', $1, $2, $3)`, [path, fx.users.ops1, { size: 5000, mimetype: 'application/pdf' }]);
    return { op, file: { storage_path: path, sha256: createHash('sha256').update(op).digest('hex'), mime_type: 'application/pdf', size_bytes: 5000 } };
  };
  type Installing = Awaited<ReturnType<typeof f.installingProject>>;
  /** QA fails the task with one defect, the partner and technician correct it, QA verifies (a full rework loop). */
  const reworkLoop = async (a: Installing, taskId: string) => {
    await inspect({ task_id: taskId, answers: answers('mobilisation', { site_safety_setup: { result: 'fail', note: 'Landing opening on floor 2 unguarded' } }),
      defects: [{ criterion_key: 'site_safety_setup', category: 'safety_component', severity: 'major', location: 'Floor 2 landing opening', description: 'No barricade at open landing', correction_due_date: inDays(2) }] });
    const [d] = await admin<{ id: string; version: number }>(pool, 'select id, version from public.defects where task_id = $1', [taskId]);
    const ack = await a.partner.admin.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: d!.version, p_action: 'acknowledge' });
    const sc = await a.partner.tech.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: ack.version, p_action: 'start_correction' });
    await f.taskEvidence(a, taskId, 'correction', d!.id);
    await a.partner.tech.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: sc.version, p_action: 'submit_correction' });
    await a.partner.tech.rpc('resubmit_task', { p_task_id: taskId, p_expected_version: await version('project_tasks', taskId) });
    await inspect({ task_id: taskId, answers: answers('mobilisation'), defect_decisions: [{ defect_id: d!.id, decision: 'verify' }] });
  };
  /** Every task submitted and QA-approved; the first one goes through the rework loop. */
  const allTasksApproved = async (a: Installing, withRework: boolean) => {
    for (const t of DEFAULT_TASK_TEMPLATE) {
      const id = await f.submitTask(a, t.code);
      if (withRework && t.code === 'mobilisation') await reworkLoop(a, id);
      else await inspect({ task_id: id, answers: answers(t.code) });
    }
  };
  const pq = async (pid: string, action: string) =>
    as('ops1').rpc('project_quality_action', { p_project_id: pid, p_expected_version: await version('projects', pid), p_action: action, p_reason: null });

  /* ------------------------------------------ projects (5) ------------------------------------------ */
  // 1. Order converted; waiting for Operations to accept the handover. The advance claim is pending verification.
  const p1 = await f.planningProject({ lead: PROJECT_LEADS[0], skipHandoverAcceptance: true, contractReference: 'AGR-DEMO-001' });
  const [adv] = await admin<{ amount_paise: string }>(pool, `select amount_paise from public.payment_milestones where project_id = $1 and code = 'advance'`, [p1.projectId]);
  await as('sales1').rpc('record_payment_claim', { p_operation_id: randomUUID(), p_project_id: p1.projectId, p_payload: {
    milestone_code: 'advance', payer_name: 'Shivneri Heights CHS', amount_paise: adv!.amount_paise, payment_mode: 'neft', payment_reference: 'UTR-DEMO-0001', payment_date: today() } });

  // 2. Planning, blocked by site readiness (pit not dry, no power). Advance verified; a second claim was rejected.
  const p2 = await f.planningProject({ lead: PROJECT_LEADS[1], contractReference: 'AGR-DEMO-002' });
  await f.verifiedMilestone(p2.projectId, 'advance');
  await as('ops1').rpc('record_site_readiness', { p_project_id: p2.projectId, p_items: SITE_READINESS_ITEMS.map((i) => ({
    key: i.key, result: i.key === 'pit_dry_and_finished' || i.key === 'power_supply_available' ? 'fail' : 'pass',
    note: i.key === 'pit_dry_and_finished' ? 'Water in pit after rain; builder to waterproof' : i.key === 'power_supply_available' ? 'Temporary supply not yet sanctioned' : null })) });
  const [pd] = await admin<{ amount_paise: string }>(pool, `select amount_paise from public.payment_milestones where project_id = $1 and code = 'pre_dispatch'`, [p2.projectId]);
  const rc = await as('sales1').rpc('record_payment_claim', { p_operation_id: randomUUID(), p_project_id: p2.projectId, p_payload: {
    milestone_code: 'pre_dispatch', payer_name: 'Gulmohar Developers', amount_paise: pd!.amount_paise, payment_mode: 'cheque', payment_reference: 'CHQ-DEMO-4411', payment_date: today() } });
  await as('finance1').rpc('decide_payment_claim', { p_claim_id: rc.claim_id, p_expected_version: rc.version, p_decision: 'reject',
    p_payload: { reason: 'Cheque returned unpaid by the bank' } });

  // 3. Installation in progress with an open QA defect (revision 2 of the quotation was accepted).
  const p3 = await f.installingProject({ partner: alpha, lead: PROJECT_LEADS[2], reviseWithDiscountBps: 300, contractReference: 'AGR-DEMO-003' });
  const t3 = await f.submitTask(p3, 'mobilisation');
  await inspect({ task_id: t3, answers: answers('mobilisation', { material_matches_bom: { result: 'fail', note: 'Two rail brackets short' } }),
    defects: [{ criterion_key: 'material_matches_bom', category: 'documentation', severity: 'minor', location: 'Site store room', description: 'Two rail brackets short of the BOM', correction_due_date: inDays(3) }] });

  // 4. Every task approved (with one rework loop), final QA passed: waiting for statutory evidence.
  const p4 = await f.installingProject({ partner: alpha, lead: PROJECT_LEADS[3], reviseWithDiscountBps: 200, contractReference: 'AGR-DEMO-004' });
  await allTasksApproved(p4, true);
  await pq(p4.project.projectId, 'submit_final_qa');
  await inspect({ project_id: p4.project.projectId, answers: answers('final') });

  // 5. Handed over to the customer; lift asset registered and warranty active.
  const p5 = await f.installingProject({ partner: alpha, lead: PROJECT_LEADS[4], reviseWithDiscountBps: 400, contractReference: 'AGR-DEMO-005' });
  const pid5 = p5.project.projectId;
  await allTasksApproved(p5, false);
  await pq(pid5, 'submit_final_qa');
  await inspect({ project_id: pid5, answers: answers('final') });
  for (const type of ['authority_inspection_report', 'operating_licence']) {
    const { op, file } = await projectFile(pid5);
    const e = await as('ops1').rpc('register_statutory_evidence', { p_operation_id: op, p_project_id: pid5, p_payload: {
      evidence_type: type, authority: 'Lift Inspectorate, Pune (DEMO)', reference_number: `DEMO-${type === 'operating_licence' ? 'OPL' : 'AIR'}-0005`, issued_on: inDays(-1), ...file } });
    await as('owner').rpc('verify_statutory_evidence', { p_evidence_id: e.evidence_id, p_decision: 'verify' });
  }
  await pq(pid5, 'record_statutory_clearance');
  for (const doc of DEFAULT_HANDOVER_DOCUMENTS) {
    const { op, file } = await projectFile(pid5);
    await as('ops1').rpc('register_handover_document', { p_operation_id: op, p_project_id: pid5, p_payload: { doc_type: doc, title: `${doc.replace(/_/g, ' ')} (DEMO)`, ...file } });
  }
  await as('ops1').rpc('link_project_customer', { p_project_id: pid5, p_expected_version: await version('projects', pid5), p_customer_org_id: fx.orgs.customer });
  await as('ops1').rpc('handover_action', { p_project_id: pid5, p_action: 'confirm_ready' });
  await as('customer1').rpc('customer_handover_decision', { p_project_id: pid5, p_decision: 'accept', p_acceptor_name: 'Dr. Arun Bapat (Trustee)', p_comment: null });

  /* -------------------------------------- sales pipeline leads -------------------------------------- */
  const sales = as('sales1');
  const create = async (payload: Record<string, unknown>) =>
    (await sales.rpc('create_lead', { p_operation_id: randomUUID(), p_payload: payload })) as { lead_id: string; version: number };
  const activity = (leadId: string, outcome: string, summary: string) => sales.rpc('record_lead_activity', {
    p_operation_id: randomUUID(), p_lead_id: leadId, p_activity_type: 'call', p_outcome: outcome, p_summary: summary,
    p_occurred_at: new Date().toISOString(), p_next_follow_up_at: new Date(Date.now() + 2 * 864e5).toISOString() });

  const assigned = await create(PIPELINE_LEADS.assigned);
  const contacted = await create(PIPELINE_LEADS.contacted);
  await activity(contacted.lead_id, 'call_back', 'Owner travelling; call back on Monday');
  const qualified = await f.qualifiedLead('sales1', PIPELINE_LEADS.qualified);
  const lost = await create(PIPELINE_LEADS.lost);
  const lc = await activity(lost.lead_id, 'lost_to_competitor', 'Builder chose a cheaper local vendor');
  await sales.rpc('close_lead', { p_lead_id: lost.lead_id, p_expected_version: lc.version, p_outcome: 'lost', p_reason: 'Builder chose a cheaper local vendor', p_lost_reason: 'competitor' });
  const invalid = await create(PIPELINE_LEADS.invalid);
  await sales.rpc('close_lead', { p_lead_id: invalid.lead_id, p_expected_version: invalid.version, p_outcome: 'invalid', p_reason: 'Wrong number; caller was not looking for a lift' });

  return {
    partners: { alpha: alpha.org, beta: beta.org },
    projects: { awaitingHandover: p1.projectId, siteBlocked: p2.projectId, installingWithDefect: p3.project.projectId, statutoryPending: p4.project.projectId, handedOver: pid5 },
    leads: { assigned: assigned.lead_id, contacted: contacted.lead_id, qualified, lost: lost.lead_id, invalid: invalid.lead_id },
  };
}

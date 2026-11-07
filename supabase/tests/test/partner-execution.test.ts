import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_TASK_TEMPLATE } from '@aiec/domain';
import { Session, admin, expectCode, makePool } from '../src/db';
import { ALL_SAFE, ALL_SITE_PASS, OFFER, executionFlows, inDays, today } from '../src/execution-flows';

const fx = inject('fixture');
const pool = makePool();
afterAll(() => pool.end());
const f = executionFlows(pool, fx);
const { as, version } = f;

type Partner = Awaited<ReturnType<typeof f.approvedPartner>>;

async function offerSha(assignmentId: string) {
  const [r] = await admin<{ offer_sha256: string }>(pool, 'select offer_sha256 from public.project_partner_assignments where id = $1', [assignmentId]);
  return r!.offer_sha256;
}

/** Project in planning with an accepted, eligible partner (tasks generated) and the technician on the team. */
async function acceptedAssignment(partner?: Partner) {
  const p = partner ?? (await f.approvedPartner());
  const project = await f.planningProject();
  const inv = await as('ops1').rpc('invite_partner', { p_project_id: project.projectId, p_partner_org_id: p.org, p_payload: { ...OFFER, schedule_from: inDays(5), schedule_to: inDays(40) } });
  const acc = await p.admin.rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: inv.version, p_action: 'accept', p_offer_sha256: inv.offer_sha256 });
  await p.admin.rpc('set_project_team_member', { p_assignment_id: inv.assignment_id, p_user_id: p.techId, p_action: 'add' });
  return { partner: p, project, assignmentId: inv.assignment_id as string, assignment: acc };
}

/** …and installation started: site ready, documents, payments (advance + pre-dispatch), material received. */
async function installingProject() {
  const a = await acceptedAssignment();
  const pid = a.project.projectId;
  await as('ops1').rpc('record_site_readiness', { p_project_id: pid, p_items: ALL_SITE_PASS });
  await f.approvedDocument(a.project.leadId);
  await f.materialReceived(pid);
  await f.verifiedMilestone(pid, 'pre_dispatch');
  const ready = await as('ops1').rpc('project_execution_action', { p_project_id: pid, p_expected_version: await version('projects', pid), p_action: 'mark_installation_ready' });
  expect(ready.status).toBe('installation_ready');
  const started = await as('ops1').rpc('project_execution_action', { p_project_id: pid, p_expected_version: ready.version, p_action: 'start_installation' });
  expect(started.status).toBe('installation');
  return a;
}

async function task(projectId: string, code: string) {
  const [t] = await admin<{ id: string; version: number; status: string }>(pool, 'select id, version, status from public.project_tasks where project_id = $1 and code = $2', [projectId, code]);
  return t!;
}

/** The technician's mobilisation task, assigned, accepted, safety-checked and started. */
async function startedTask(a: Awaited<ReturnType<typeof installingProject>>, code = 'mobilisation') {
  const t = await task(a.project.projectId, code);
  const asg = await a.partner.admin.rpc('assign_task', { p_task_id: t.id, p_expected_version: t.version, p_assignee_id: a.partner.techId, p_due_date: inDays(3) });
  const acc = await a.partner.tech.rpc('accept_task', { p_task_id: t.id, p_expected_version: asg.version });
  await a.partner.tech.rpc('record_safety_check', { p_operation_id: randomUUID(), p_task_id: t.id, p_answers: ALL_SAFE });
  const st = await a.partner.tech.rpc('start_task', { p_task_id: t.id, p_expected_version: acc.version });
  return { id: t.id, version: st.version as number };
}

async function uploadEvidence(a: Awaited<ReturnType<typeof installingProject>>, taskId: string, category: string) {
  const op = randomUUID();
  const path = `${a.partner.org}/tasks/${taskId}/${op}.jpg`;
  await a.partner.tech.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('execution-evidence', $1, $2, $3)`, [path, a.partner.techId, { size: 3000, mimetype: 'image/jpeg' }]);
  return a.partner.tech.rpc('register_task_evidence', { p_operation_id: op, p_task_id: taskId, p_payload: {
    category, storage_path: path, sha256: createHash('sha256').update(op).digest('hex'), mime_type: 'image/jpeg', size_bytes: 3000,
    captured_at: new Date().toISOString(), latitude: 18.56, longitude: 73.8, accuracy_m: 9, source: 'in_app_camera' } });
}

describe('Slice 5 — partner onboarding and compliance (LP02, LP03, Gate 7)', () => {
  it('a partner completes its profile and documents; only AIEC verifies; approval needs every required document verified', async () => {
    const p = await f.newPartner();
    await p.admin.rpc('save_partner_profile', { p_org_id: p.org, p_expected_version: null, p_payload: { legal_name: 'Half Done Lifts' } });
    await expectCode(p.admin.rpc('partner_action', { p_org_id: p.org, p_expected_version: await version('partner_profiles', p.org), p_action: 'submit' }), 'REQUIRED_FIELD_MISSING');
    await expectCode(p.tech.rpc('save_partner_profile', { p_org_id: p.org, p_expected_version: null, p_payload: f.PROFILE }), 'ACCESS_DENIED');
    await p.admin.rpc('save_partner_profile', { p_org_id: p.org, p_expected_version: await version('partner_profiles', p.org), p_payload: f.PROFILE });
    // Document registration validates the uploaded file and the required metadata.
    await expectCode(f.addDocument(p, 'insurance', { expires_on: null }), 'REQUIRED_FIELD_MISSING');
    await expectCode(f.addDocument(p, 'contractor_licence', { scope: [] }), 'REQUIRED_FIELD_MISSING');
    await expectCode(f.addDocument(p, 'pan', { storage_path: `${fx.orgs.partnerB}/documents/${randomUUID()}.pdf` }), 'VALIDATION_FAILED');
    const lic = await f.addDocument(p, 'contractor_licence');
    expect(lic.verification).toBe('pending');
    const ins = await f.addDocument(p, 'insurance');
    const sub = await p.admin.rpc('partner_action', { p_org_id: p.org, p_expected_version: await version('partner_profiles', p.org), p_action: 'submit' });
    expect(sub.status).toBe('submitted');
    await expectCode(p.admin.rpc('save_partner_profile', { p_org_id: p.org, p_expected_version: sub.version, p_payload: f.PROFILE }), 'INVALID_STATE_TRANSITION');
    // The partner cannot verify itself; Operations (no partner.verify) cannot either.
    await expectCode(p.admin.rpc('verify_partner_document', { p_document_id: lic.document_id, p_decision: 'verify' }), 'ACCESS_DENIED');
    await expectCode(as('ops1').rpc('verify_partner_document', { p_document_id: lic.document_id, p_decision: 'verify' }), 'ACCESS_DENIED');
    const owner = as('owner');
    const sv = await owner.rpc('partner_action', { p_org_id: p.org, p_expected_version: sub.version, p_action: 'start_verification' });
    await owner.rpc('verify_partner_document', { p_document_id: lic.document_id, p_decision: 'verify' });
    await expectCode(owner.rpc('verify_partner_document', { p_document_id: ins.document_id, p_decision: 'reject' }), 'REQUIRED_FIELD_MISSING');
    await owner.rpc('verify_partner_document', { p_document_id: ins.document_id, p_decision: 'reject', p_reason: 'Policy copy unreadable' });
    await expectCode(owner.rpc('verify_partner_document', { p_document_id: ins.document_id, p_decision: 'verify' }), 'INVALID_STATE_TRANSITION');
    await expectCode(admin(pool, `update public.partner_documents set expires_on = $2 where id = $1`, [lic.document_id, inDays(900)]), 'ACCESS_DENIED');
    const blocked = await owner.rpc('partner_action', { p_org_id: p.org, p_expected_version: sv.version, p_action: 'approve' }).catch((e) => e);
    expect(blocked.code).toBe('PARTNER_COMPLIANCE_BLOCK');
    expect(blocked.detail.missing).toEqual(['insurance', 'pan', 'bank_verification']);
    // Conditional approval is possible with a recorded reason (legal review pending, D-007).
    const cond = await owner.rpc('partner_action', { p_org_id: p.org, p_expected_version: sv.version, p_action: 'approve_conditionally', p_reason: 'Insurance renewal awaited' });
    expect(cond.status).toBe('conditional_approval');
    // …but Gate 7 still blocks assignment until every document is valid.
    const e = await as('ops1').rpc('partner_eligibility', { p_org_id: p.org, p_lift_category: 'passenger' });
    expect(e).toMatchObject({ status: 'conditional_approval', eligible: false });
    expect(e.failures.map((x: { type: string; reason: string }) => `${x.type}:${x.reason}`)).toEqual(['insurance:rejected', 'pan:missing', 'bank_verification:missing']);
  });

  it('eligibility follows the project lift category, expiry and status; tenants see only their own company', async () => {
    const p = await f.approvedPartner();
    const ops = as('ops1');
    expect((await ops.rpc('partner_eligibility', { p_org_id: p.org, p_lift_category: 'passenger' })).eligible).toBe(true);
    const hosp = await ops.rpc('partner_eligibility', { p_org_id: p.org, p_lift_category: 'hospital' });
    expect(hosp.failures).toEqual([{ type: 'contractor_licence', reason: 'scope_insufficient' }]);
    // An expired insurance (renewal pending verification) blocks.
    await admin(pool, `alter table public.partner_documents disable trigger partner_documents_guard`);
    await admin(pool, `update public.partner_documents set expires_on = $2 where organization_id = $1 and doc_type = 'insurance'`, [p.org, inDays(-1)]);
    await admin(pool, `alter table public.partner_documents enable trigger partner_documents_guard`);
    const exp = await ops.rpc('partner_eligibility', { p_org_id: p.org, p_lift_category: 'passenger' });
    expect(exp).toMatchObject({ eligible: false, failures: [{ type: 'insurance', reason: 'expired' }] });
    await f.addDocument(p, 'insurance');
    expect((await ops.rpc('partner_eligibility', { p_org_id: p.org, p_lift_category: 'passenger' })).failures).toEqual([{ type: 'insurance', reason: 'expired' }]);
    // Tenant isolation: another partner and the technician never see this company's documents.
    const other = await f.newPartner();
    expect(await other.admin.query('select 1 from public.partner_documents where organization_id = $1', [p.org])).toEqual([]);
    expect(await other.admin.query('select 1 from public.partner_profiles where organization_id = $1', [p.org])).toEqual([]);
    await expectCode(other.admin.rpc('partner_eligibility', { p_org_id: p.org }), 'NOT_FOUND');
    expect(await p.tech.query('select 1 from public.partner_documents where organization_id = $1', [p.org])).toEqual([]);
    expect(await p.tech.query('select 1 from public.partner_profiles where organization_id = $1', [p.org])).toHaveLength(1);
    await expect(other.admin.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('partner-documents', $1, $2, '{}')`, [`${p.org}/documents/${randomUUID()}.pdf`, other.adminId])).rejects.toThrow(/row-level security/);
    // Suspension by an exception authority removes eligibility at once.
    await as('owner').rpc('partner_action', { p_org_id: p.org, p_expected_version: await version('partner_profiles', p.org), p_action: 'suspend', p_reason: 'Safety audit failed' });
    expect((await ops.rpc('partner_eligibility', { p_org_id: p.org, p_lift_category: 'passenger' })).status).toBe('suspended');
  });
});

describe('Slice 5 — site readiness, invitations and installation readiness (OM03, OM04, LP04, Gates 7–8)', () => {
  it('site readiness passes only with every item answered; failures and unexplained N/A are recorded, not hidden', async () => {
    const project = await f.planningProject();
    const rec = (items: unknown[]) => as('ops1').rpc('record_site_readiness', { p_project_id: project.projectId, p_items: items });
    await expectCode(as('sales1').rpc('record_site_readiness', { p_project_id: project.projectId, p_items: ALL_SITE_PASS }), 'ACCESS_DENIED');
    await expectCode(rec([{ key: 'nonsense', result: 'pass' }]), 'VALIDATION_FAILED');
    const partial = await rec(ALL_SITE_PASS.slice(1));
    expect(partial).toMatchObject({ passed: false, revision_no: 1, failures: [{ code: 'REQUIRED_FIELD_MISSING', key: 'access_route' }] });
    const failing = await rec(ALL_SITE_PASS.map((i, n) => (n === 0 ? { ...i, result: 'fail', note: 'Gate locked' } : n === 1 ? { ...i, result: 'not_applicable' } : i)));
    expect(failing.failures).toEqual([{ code: 'SITE_NOT_READY', key: 'access_route' }, { code: 'REQUIRED_FIELD_MISSING', key: 'working_hours_agreed' }]);
    const ok = await rec(ALL_SITE_PASS.map((i, n) => (n === 1 ? { ...i, result: 'not_applicable', note: 'Site open 24 hours' } : i)));
    expect(ok).toMatchObject({ passed: true, revision_no: 3 });
    await expectCode(admin(pool, 'update public.site_readiness_checks set passed = true where project_id = $1', [project.projectId]), 'ACCESS_DENIED');
  });

  it('only an eligible partner is invited; acceptance binds to the displayed revision and creates the task list', async () => {
    const draft = await f.newPartner();
    const p = await f.approvedPartner();
    const project = await f.planningProject();
    const invite = (org: string, over = {}) => as('ops1').rpc('invite_partner', { p_project_id: project.projectId, p_partner_org_id: org, p_payload: { ...OFFER, schedule_from: inDays(5), schedule_to: inDays(40), ...over } });
    await expectCode(invite(draft.org), 'PARTNER_COMPLIANCE_BLOCK');
    await expectCode(as('sales1').rpc('invite_partner', { p_project_id: project.projectId, p_partner_org_id: p.org, p_payload: OFFER }), 'ACCESS_DENIED');
    await expectCode(invite(p.org, { schedule_from: inDays(-1) }), 'VALIDATION_FAILED');
    const inv = await invite(p.org);
    expect(inv.status).toBe('invited');
    await expectCode(invite(p.org), 'INVALID_STATE_TRANSITION'); // one open invitation per project
    expect(await as('ops1').query(`select 1 from public.notifications where recipient_id = $1 and event_type = 'assignment.invited'`, [p.adminId])).toEqual([]);
    expect(await p.admin.query(`select 1 from public.notifications where event_type = 'assignment.invited' and entity_id = $1`, [inv.assignment_id])).toHaveLength(1);
    // The partner admin sees the invitation and the project title; its technician and Sales do not see the commercial terms; other partners see nothing.
    expect(await p.admin.query('select contract_value_paise from public.project_partner_assignments where id = $1', [inv.assignment_id])).toHaveLength(1);
    expect(await p.admin.query('select title from public.projects where id = $1', [project.projectId])).toHaveLength(1);
    expect(await p.tech.query('select 1 from public.project_partner_assignments where id = $1', [inv.assignment_id])).toEqual([]);
    expect(await as('sales1').query('select 1 from public.project_partner_assignments where id = $1', [inv.assignment_id])).toEqual([]);
    const other = await f.approvedPartner();
    expect(await other.admin.query('select 1 from public.project_partner_assignments where id = $1', [inv.assignment_id])).toEqual([]);
    expect(await other.admin.query('select 1 from public.projects where id = $1', [project.projectId])).toEqual([]);
    expect(await other.admin.query('select 1 from public.orders o join public.projects p on p.order_id = o.id where p.id = $1', [project.projectId])).toEqual([]);
    expect(await p.admin.query('select 1 from public.payment_milestones where project_id = $1', [project.projectId])).toEqual([]);
    // Clarification → re-issue → acceptance of the exact revision.
    await expectCode(p.admin.rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: inv.version, p_action: 'decline' }), 'REQUIRED_FIELD_MISSING');
    const cl = await p.admin.rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: inv.version, p_action: 'request_clarification', p_reason: 'Who provides scaffolding?' });
    await expectCode(p.admin.rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: cl.version, p_action: 'accept', p_offer_sha256: inv.offer_sha256 }), 'INVALID_STATE_TRANSITION');
    const re = await as('ops1').rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: cl.version, p_action: 'reissue', p_reason: 'Partner brings scaffolding (see material responsibility)' });
    await expectCode(other.admin.rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: re.version, p_action: 'accept', p_offer_sha256: inv.offer_sha256 }), 'NOT_FOUND');
    await expectCode(p.admin.rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: re.version, p_action: 'accept', p_offer_sha256: 'a'.repeat(64) }), 'STALE_VERSION');
    const acc = await p.admin.rpc('assignment_action', { p_assignment_id: inv.assignment_id, p_expected_version: re.version, p_action: 'accept', p_offer_sha256: await offerSha(inv.assignment_id) });
    expect(acc.status).toBe('accepted');
    const tasks = await p.admin.query<{ code: string; status: string }>('select code, status from public.project_tasks where project_id = $1 order by sequence', [project.projectId]);
    expect(tasks.map((t) => t.code)).toEqual(DEFAULT_TASK_TEMPLATE.map((t) => t.code));
    expect(new Set(tasks.map((t) => t.status))).toEqual(new Set(['draft']));
    expect(await other.admin.query('select 1 from public.project_tasks where project_id = $1', [project.projectId])).toEqual([]);
  });

  it('installation readiness names every missing dimension; installation starts only when all are met', async () => {
    const a = await acceptedAssignment();
    const pid = a.project.projectId;
    const action = async (act: string) => as('ops1').rpc('project_execution_action', { p_project_id: pid, p_expected_version: await version('projects', pid), p_action: act });
    expect(await as('ops1').rpc('project_readiness', { p_project_id: pid })).toEqual({ technical: true, site: false, payment: false, material: false, partner: true, documentation: false });
    const e = await action('mark_installation_ready').catch((x) => x);
    expect(e.code).toBe('SITE_NOT_READY');
    expect(e.detail.missing).toEqual(['site', 'payment', 'material', 'documentation']);
    await as('ops1').rpc('record_site_readiness', { p_project_id: pid, p_items: ALL_SITE_PASS });
    await f.approvedDocument(a.project.leadId);
    await f.materialReceived(pid);
    expect((await action('mark_installation_ready').catch((x) => x)).detail.missing).toEqual(['payment']); // pre-dispatch not verified yet
    await f.verifiedMilestone(pid, 'pre_dispatch');
    await expectCode(a.partner.admin.rpc('project_execution_action', { p_project_id: pid, p_expected_version: await version('projects', pid), p_action: 'mark_installation_ready' }), 'ACCESS_DENIED');
    expect((await action('mark_installation_ready')).status).toBe('installation_ready');
    await expectCode(action('mark_installation_ready'), 'INVALID_STATE_TRANSITION');
    expect((await action('start_installation')).status).toBe('installation');
    expect(await a.partner.admin.query(`select 1 from public.notifications where event_type = 'project.start_installation' and entity_id = $1`, [pid])).toHaveLength(1);
  });
});

describe('Slice 5 — team, tasks, safety and evidence (LP06, LP07, WT02–WT05, Gates 9 and 11)', () => {
  it('tasks go only to skilled project-team members; a technician starts only after a passing safety pre-start and the prerequisites', async () => {
    const a = await installingProject();
    const pid = a.project.projectId;
    const mob = await task(pid, 'mobilisation');
    const outsider = await f.newUser('Unenrolled worker');
    await expectCode(a.partner.admin.rpc('assign_task', { p_task_id: mob.id, p_expected_version: mob.version, p_assignee_id: outsider }), 'VALIDATION_FAILED');
    await expectCode(a.partner.tech.rpc('assign_task', { p_task_id: mob.id, p_expected_version: mob.version, p_assignee_id: a.partner.techId }), 'NOT_FOUND'); // technicians do not even see unassigned tasks
    // A second technician without the electrical skill cannot take the wiring task.
    const t2 = await f.newUser('Second technician');
    await a.partner.admin.rpc('admin_add_member', { p_user_id: t2, p_org_id: a.partner.org, p_reason: 'new' });
    await a.partner.admin.rpc('admin_grant_role', { p_user_id: t2, p_org_id: a.partner.org, p_role_code: 'technician', p_reason: 'new' });
    await a.partner.admin.rpc('admin_set_user_status', { p_user_id: t2, p_status: 'active', p_reason: 'verified' });
    await a.partner.admin.rpc('set_worker_profile', { p_org_id: a.partner.org, p_user_id: t2, p_skills: ['mechanical'] });
    await a.partner.admin.rpc('set_project_team_member', { p_assignment_id: a.assignmentId, p_user_id: t2, p_action: 'add' });
    const wiring = await task(pid, 'electrical_wiring');
    const skillErr = await a.partner.admin.rpc('assign_task', { p_task_id: wiring.id, p_expected_version: wiring.version, p_assignee_id: t2 }).catch((x) => x);
    expect(skillErr).toMatchObject({ code: 'VALIDATION_FAILED', detail: { skill: 'electrical' } });
    // Assign → accept (only the assignee) → safety → start.
    const asg = await a.partner.admin.rpc('assign_task', { p_task_id: mob.id, p_expected_version: mob.version, p_assignee_id: a.partner.techId, p_due_date: inDays(2) });
    expect(asg.status).toBe('assigned');
    await expectCode(new Session(pool, t2).rpc('accept_task', { p_task_id: mob.id, p_expected_version: asg.version }), 'NOT_FOUND');
    const acc = await a.partner.tech.rpc('accept_task', { p_task_id: mob.id, p_expected_version: asg.version });
    await expectCode(a.partner.tech.rpc('start_task', { p_task_id: mob.id, p_expected_version: acc.version }), 'SAFETY_STOP_ACTIVE');
    const unsafe = await a.partner.tech.rpc('record_safety_check', { p_operation_id: randomUUID(), p_task_id: mob.id, p_answers: { ...ALL_SAFE, electrical_isolation: { applicable: true, confirmed: false }, tool_inspection: { applicable: true, confirmed: false } } });
    expect(unsafe).toMatchObject({ can_start: false, critical_failures: ['electrical_isolation'], warnings: ['tool_inspection'] });
    await expectCode(a.partner.tech.rpc('start_task', { p_task_id: mob.id, p_expected_version: acc.version }), 'SAFETY_STOP_ACTIVE');
    const safe = await a.partner.tech.rpc('record_safety_check', { p_operation_id: randomUUID(), p_task_id: mob.id, p_answers: { ...ALL_SAFE, work_at_height: { applicable: false, confirmed: false } } });
    expect(safe.can_start).toBe(true);
    const st = await a.partner.tech.rpc('start_task', { p_task_id: mob.id, p_expected_version: acc.version });
    expect(st.status).toBe('in_progress');
    // Rails cannot start before mobilisation is submitted.
    const rail = await task(pid, 'rail_installation');
    const ra = await a.partner.admin.rpc('assign_task', { p_task_id: rail.id, p_expected_version: rail.version, p_assignee_id: a.partner.techId });
    const rac = await a.partner.tech.rpc('accept_task', { p_task_id: rail.id, p_expected_version: ra.version });
    await a.partner.tech.rpc('record_safety_check', { p_operation_id: randomUUID(), p_task_id: rail.id, p_answers: ALL_SAFE });
    const pre = await a.partner.tech.rpc('start_task', { p_task_id: rail.id, p_expected_version: rac.version }).catch((x) => x);
    expect(pre).toMatchObject({ code: 'INVALID_STATE_TRANSITION', detail: { prerequisites: ['mobilisation'] } });
    // Tenant isolation: another partner's people never see these tasks; the second technician sees none (not assigned).
    const other = await f.approvedPartner();
    expect(await other.admin.query('select 1 from public.project_tasks where project_id = $1', [pid])).toEqual([]);
    expect(await other.tech.query('select 1 from public.project_tasks where project_id = $1', [pid])).toEqual([]);
    expect(await new Session(pool, t2).query('select 1 from public.project_tasks where project_id = $1', [pid])).toEqual([]);
    expect(await a.partner.tech.query('select code from public.project_tasks where project_id = $1 order by sequence', [pid])).toEqual([{ code: 'mobilisation' }, { code: 'rail_installation' }]);
  });

  it('submission needs the whole checklist and the required evidence (Gate 9); evidence is immutable and only the assignee uploads it', async () => {
    const a = await installingProject();
    const t = await startedTask(a);
    const tech = a.partner.tech;
    await expectCode(tech.rpc('submit_task', { p_task_id: t.id, p_expected_version: t.version }), 'REQUIRED_FIELD_MISSING');
    await expectCode(tech.rpc('save_task_progress', { p_task_id: t.id, p_expected_version: t.version, p_answers: { not_a_key: { done: true } } }), 'VALIDATION_FAILED');
    const sp = await tech.rpc('save_task_progress', { p_task_id: t.id, p_expected_version: t.version, p_answers: {
      materials_verified: { done: true }, tools_inspected: { done: true }, work_area_barricaded: { done: false, not_applicable_reason: 'no' } }, p_notes: 'All material on site' });
    const inc = await tech.rpc('submit_task', { p_task_id: t.id, p_expected_version: sp.version }).catch((x) => x);
    expect(inc).toMatchObject({ code: 'REQUIRED_FIELD_MISSING', detail: { fields: ['checklist.work_area_barricaded'] } });
    const sp2 = await tech.rpc('save_task_progress', { p_task_id: t.id, p_expected_version: sp.version, p_answers: {
      materials_verified: { done: true }, tools_inspected: { done: true }, work_area_barricaded: { done: true } } });
    const ev = await tech.rpc('submit_task', { p_task_id: t.id, p_expected_version: sp2.version }).catch((x) => x);
    expect(ev).toMatchObject({ code: 'EVIDENCE_REQUIRED', detail: { missing: ['before'] } });
    // Only the assignee uploads, into its own task folder.
    await expect(a.partner.admin.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('execution-evidence', $1, $2, '{}')`, [`${a.partner.org}/tasks/${t.id}/${randomUUID()}.jpg`, a.partner.adminId])).rejects.toThrow(/row-level security/);
    const e1 = await uploadEvidence(a, t.id, 'before');
    expect(e1.category).toBe('before');
    await expectCode(admin(pool, 'delete from public.task_evidence where id = $1', [e1.evidence_id]), 'ACCESS_DENIED');
    const sub = await tech.rpc('submit_task', { p_task_id: t.id, p_expected_version: await version('project_tasks', t.id) });
    expect(sub.status).toBe('submitted');
    expect(await a.partner.admin.query(`select 1 from public.notifications where event_type = 'task.submitted' and entity_id = $1`, [t.id])).toHaveLength(1);
    // Submission is not QA approval: nobody in the partner can approve it (Gate 10 is Slice 6, AIEC QA only).
    expect((await admin<{ status: string }>(pool, 'select status from public.project_tasks where id = $1', [t.id]))[0]!.status).toBe('submitted');
    // AIEC Operations reads the task and its evidence; Sales does not.
    expect(await as('ops1').query('select 1 from public.task_evidence where task_id = $1', [t.id])).toHaveLength(1);
    expect(await as('sales1').query('select 1 from public.project_tasks where id = $1', [t.id])).toEqual([]);
  });

  it('a safety incident stops the task; only AIEC lifts the stop, and work resumes only after a new passing pre-start (Gate 11)', async () => {
    const a = await installingProject();
    const t = await startedTask(a);
    const tech = a.partner.tech;
    const op = randomUUID();
    const r = await tech.rpc('report_incident', { p_operation_id: op, p_task_id: t.id, p_category: 'unsafe_condition', p_description: 'Landing door opening unguarded on floor 3' });
    expect(r).toMatchObject({ safety_stop: true, status: 'blocked' });
    expect((await tech.rpc('report_incident', { p_operation_id: op, p_task_id: t.id, p_category: 'unsafe_condition', p_description: 'x' })).replayed).toBe(true);
    const crit = await as('ops1').query<{ severity: string }>(`select severity from public.notifications where event_type = 'incident.reported' and entity_id = $1`, [a.project.projectId]);
    expect(crit.map((n) => n.severity)).toEqual(['critical']);
    expect(await as('owner').query(`select 1 from public.notifications where dedupe_key like 'incident.owner:%' and entity_id = $1`, [a.project.projectId])).toHaveLength(1);
    const v = await version('project_tasks', t.id);
    await expectCode(a.partner.admin.rpc('unblock_task', { p_task_id: t.id, p_expected_version: v, p_reason: 'Guard rail fixed' }), 'SAFETY_STOP_ACTIVE');
    const [inc] = await admin<{ id: string }>(pool, 'select id from public.execution_incidents where operation_id = $1', [op]);
    await expectCode(a.partner.admin.rpc('resolve_incident', { p_incident_id: inc!.id, p_resolution: 'Fixed' }), 'NOT_FOUND');
    await expectCode(as('ops1').rpc('resolve_incident', { p_incident_id: inc!.id, p_resolution: '' }), 'REQUIRED_FIELD_MISSING');
    // While the stop is active, installation cannot be (re)started anywhere on the project either.
    expect((await admin<{ n: number }>(pool, 'select count(*)::int as n from public.project_tasks where project_id = $1 and safety_stop', [a.project.projectId]))[0]!.n).toBe(1);
    await as('ops1').rpc('resolve_incident', { p_incident_id: inc!.id, p_resolution: 'Temporary guard rail fixed and inspected by site engineer' });
    await expectCode(a.partner.admin.rpc('unblock_task', { p_task_id: t.id, p_expected_version: await version('project_tasks', t.id), p_reason: 'Guard rail fixed' }), 'SAFETY_STOP_ACTIVE');
    await tech.rpc('record_safety_check', { p_operation_id: randomUUID(), p_task_id: t.id, p_answers: ALL_SAFE });
    const ub = await a.partner.admin.rpc('unblock_task', { p_task_id: t.id, p_expected_version: await version('project_tasks', t.id), p_reason: 'Guard rail fixed' });
    expect(ub).toMatchObject({ status: 'in_progress', safety_stop: false });
    // A non-safety blocker blocks without a stop; the supervisor resumes it directly.
    const mat = await tech.rpc('report_incident', { p_operation_id: randomUUID(), p_task_id: t.id, p_category: 'material_missing', p_description: 'Rail brackets short by 6' });
    expect(mat).toMatchObject({ safety_stop: false, status: 'blocked' });
    expect((await a.partner.admin.rpc('unblock_task', { p_task_id: t.id, p_expected_version: mat.version, p_reason: 'Brackets delivered' })).status).toBe('in_progress');
    const other = await f.approvedPartner();
    expect(await other.admin.query('select 1 from public.execution_incidents where project_id = $1', [a.project.projectId])).toEqual([]);
  });
});

describe('Slice 5 — daily work report (LP08, OM06)', () => {
  it('reports are complete, name only project-team members, one per day, immutable; AIEC comments without rewriting', async () => {
    const a = await acceptedAssignment();
    const submit = (over: Record<string, unknown> = {}, who = a.partner.admin) => who.rpc('submit_daily_report', { p_operation_id: randomUUID(), p_assignment_id: a.assignmentId, p_payload: {
      report_date: today(), present_user_ids: [a.partner.techId], work_completed: 'Unloaded material, marked bracket positions', incident_declared: false,
      next_day_plan: 'Fix rail brackets floors 1–3', ...over } });
    await expectCode(submit({ work_completed: '', next_day_plan: '', incident_declared: undefined }), 'REQUIRED_FIELD_MISSING');
    await expectCode(submit({ incident_declared: true }), 'REQUIRED_FIELD_MISSING');
    await expectCode(submit({ report_date: inDays(1) }), 'REQUIRED_FIELD_MISSING');
    await expectCode(submit({ present_user_ids: [fx.users.partnerB_tech] }), 'VALIDATION_FAILED');
    await expectCode(submit({}, a.partner.tech), 'NOT_FOUND'); // technicians do not see the assignment (commercial terms)
    const r = await submit({ incident_declared: true, safety_observations: 'Loose plank at landing 2 removed' });
    await expectCode(submit(), 'INVALID_STATE_TRANSITION');
    await expectCode(admin(pool, 'update public.daily_reports set work_completed = $2 where id = $1', [r.daily_report_id, 'rewritten']), 'ACCESS_DENIED');
    expect(await as('ops1').query(`select 1 from public.notifications where event_type = 'daily_report.incident' and entity_id = $1`, [a.project.projectId])).not.toEqual([]);
    await expectCode(a.partner.admin.rpc('comment_daily_report', { p_report_id: r.daily_report_id, p_comment: 'ok' }), 'NOT_FOUND');
    await as('ops1').rpc('comment_daily_report', { p_report_id: r.daily_report_id, p_comment: 'Please photograph bracket spacing tomorrow' });
    expect(await a.partner.admin.query('select comment from public.daily_report_comments where report_id = $1', [r.daily_report_id])).toEqual([{ comment: 'Please photograph bracket spacing tomorrow' }]);
    const other = await f.approvedPartner();
    expect(await other.admin.query('select 1 from public.daily_reports where id = $1', [r.daily_report_id])).toEqual([]);
    expect(await a.partner.tech.query('select 1 from public.daily_reports where id = $1', [r.daily_report_id])).toEqual([]);
  });
});

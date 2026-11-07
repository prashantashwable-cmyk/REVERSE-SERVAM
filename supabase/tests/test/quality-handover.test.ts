import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_HANDOVER_DOCUMENTS, DEFAULT_QA_CHECKLISTS, DEFAULT_TASK_TEMPLATE, warrantyPeriod } from '@aiec/domain';
import { admin, expectCode, makePool } from '../src/db';
import { executionFlows, inDays } from '../src/execution-flows';

const fx = inject('fixture');
const pool = makePool();
afterAll(() => pool.end());
const f = executionFlows(pool, fx);
const { as, version } = f;
type Installing = Awaited<ReturnType<typeof f.installingProject>>;

const answers = (key: string, over: Record<string, unknown> = {}) =>
  ({ ...Object.fromEntries(DEFAULT_QA_CHECKLISTS[key]!.map((c) => [c.key, { result: 'pass' }])), ...over });
const inspect = (payload: Record<string, unknown>, who = 'qa1' as const) => as(who).rpc('record_inspection', { p_operation_id: randomUUID(), p_payload: payload });

async function defectsOf(taskId: string) {
  return admin<{ id: string; status: string; version: number; defect_number: string }>(pool, 'select id, status, version, defect_number from public.defects where task_id = $1 order by raised_at', [taskId]);
}

/** Upload a file into the project's handover-documents folder as Operations. */
async function projectFile(projectId: string) {
  const op = randomUUID();
  const path = `${fx.orgs.aiec}/projects/${projectId}/${op}.pdf`;
  await as('ops1').query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('handover-documents', $1, $2, $3)`, [path, fx.users.ops1, { size: 5000, mimetype: 'application/pdf' }]);
  return { op, file: { storage_path: path, sha256: createHash('sha256').update(op).digest('hex'), mime_type: 'application/pdf', size_bytes: 5000 } };
}

/** Every task submitted and passed by QA, in template order (prerequisites hold). */
async function allTasksApproved(a: Installing) {
  for (const t of DEFAULT_TASK_TEMPLATE) {
    const id = await f.submitTask(a, t.code);
    const r = await inspect({ task_id: id, answers: answers(t.code) });
    expect(r.task_status).toBe('approved');
  }
}

describe('Slice 6 — independent QA, defects and rework (QA02–QA05, Gate 10)', () => {
  it('only independent AIEC QA inspects; a failure needs a defect; rework closes only through verified correction evidence', async () => {
    const a = await f.installingProject();
    const taskId = await f.submitTask(a, 'mobilisation');
    // Gate 10: neither the partner, its technician, Operations nor Sales can inspect.
    for (const s of [a.partner.admin, a.partner.tech, as('ops1'), as('sales1')]) {
      const e = await s.rpc('record_inspection', { p_operation_id: randomUUID(), p_payload: { task_id: taskId, answers: answers('mobilisation') } }).catch((x: any) => x);
      expect(['ACCESS_DENIED', 'NOT_FOUND']).toContain(e.code);
    }
    await expectCode(inspect({ task_id: taskId, answers: {} }), 'REQUIRED_FIELD_MISSING');
    await expectCode(inspect({ task_id: taskId, answers: answers('mobilisation', { site_safety_setup: { result: 'not_applicable', note: 'Not needed' } }) }), 'VALIDATION_FAILED');
    const failing = answers('mobilisation', { site_safety_setup: { result: 'fail', note: 'Shaft opening on floor 2 unguarded' } });
    await expectCode(inspect({ task_id: taskId, answers: failing }), 'REQUIRED_FIELD_MISSING'); // no defect recorded
    const defect = { criterion_key: 'site_safety_setup', category: 'safety_component', severity: 'critical', location: 'Floor 2 landing opening', description: 'No barricade at open landing', correction_due_date: inDays(2) };
    await expectCode(inspect({ task_id: taskId, answers: failing, defects: [{ ...defect, correction_due_date: inDays(-1) }] }), 'REQUIRED_FIELD_MISSING');
    const r = await inspect({ task_id: taskId, answers: failing, defects: [defect], notes: 'Barricade missing' });
    expect(r).toMatchObject({ outcome: 'failed', defects_raised: 1, task_status: 'rework' });
    const [d] = await defectsOf(taskId);
    expect(d).toMatchObject({ status: 'assigned' });
    expect(d!.defect_number).toMatch(/^DF-PUN-\d{4}-\d{5}$/);
    expect(await as('ops1').query(`select severity from public.notifications where event_type = 'defect.critical' and entity_id = $1`, [a.project.projectId])).toEqual([{ severity: 'critical' }]);
    // Visibility: the partner and its technician see the defect; another partner and Sales do not.
    expect(await a.partner.tech.query('select 1 from public.defects where id = $1', [d!.id])).toHaveLength(1);
    const other = await f.approvedPartner();
    expect(await other.admin.query('select 1 from public.defects where id = $1', [d!.id])).toEqual([]);
    expect(await as('sales1').query('select 1 from public.defects where id = $1', [d!.id])).toEqual([]);
    // Rework: acknowledge (partner) → start correction (technician) → correction photo → submit → resubmit task.
    await expectCode(a.partner.tech.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: d!.version, p_action: 'start_correction' }), 'INVALID_STATE_TRANSITION');
    const ack = await a.partner.admin.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: d!.version, p_action: 'acknowledge' });
    const sc = await a.partner.tech.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: ack.version, p_action: 'start_correction' });
    await expectCode(a.partner.tech.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: sc.version, p_action: 'submit_correction' }), 'EVIDENCE_REQUIRED');
    await expectCode(a.partner.tech.rpc('resubmit_task', { p_task_id: taskId, p_expected_version: await version('project_tasks', taskId) }), 'EVIDENCE_REQUIRED');
    await expectCode(f.taskEvidence(a, taskId, 'correction'), 'VALIDATION_FAILED'); // a correction photo names its defect
    await f.taskEvidence(a, taskId, 'correction', d!.id);
    const sub = await a.partner.tech.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: sc.version, p_action: 'submit_correction' });
    expect(sub.status).toBe('submitted_for_reinspection');
    expect((await a.partner.tech.rpc('resubmit_task', { p_task_id: taskId, p_expected_version: await version('project_tasks', taskId) })).status).toBe('submitted');
    // Reinspection (QA05): every waiting correction needs a decision; a rejection sends the task back.
    await expectCode(inspect({ task_id: taskId, answers: answers('mobilisation') }), 'REQUIRED_FIELD_MISSING');
    await expectCode(inspect({ task_id: taskId, answers: answers('mobilisation'), defect_decisions: [{ defect_id: d!.id, decision: 'reject' }] }), 'REQUIRED_FIELD_MISSING');
    const rej = await inspect({ task_id: taskId, answers: answers('mobilisation', { site_safety_setup: { result: 'hold' } }), defect_decisions: [{ defect_id: d!.id, decision: 'reject', reason: 'Barricade is tape only' }] });
    expect(rej.task_status).toBe('rework');
    expect((await defectsOf(taskId))[0]!.status).toBe('correction_in_progress');
    await f.taskEvidence(a, taskId, 'correction', d!.id);
    await a.partner.tech.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: await version('defects', d!.id), p_action: 'submit_correction' });
    await a.partner.tech.rpc('resubmit_task', { p_task_id: taskId, p_expected_version: await version('project_tasks', taskId) });
    const ok = await inspect({ task_id: taskId, answers: answers('mobilisation'), defect_decisions: [{ defect_id: d!.id, decision: 'verify' }] });
    expect(ok).toMatchObject({ outcome: 'passed', task_status: 'approved' });
    expect((await defectsOf(taskId))[0]!.status).toBe('closed');
    // Nothing is silently deleted: the defect, both correction photos and all three inspections remain.
    await expectCode(admin(pool, 'delete from public.defects where id = $1', [d!.id]), 'ACCESS_DENIED');
    expect(await admin(pool, `select 1 from public.task_evidence where defect_id = $1`, [d!.id])).toHaveLength(2);
    expect(await admin(pool, 'select outcome from public.qa_inspections where task_id = $1 order by inspected_at', [taskId])).toEqual([{ outcome: 'failed' }, { outcome: 'on_hold' }, { outcome: 'passed' }]);
  });

  it('a disputed defect returns to QA; a hold keeps the work submitted', async () => {
    const a = await f.installingProject();
    const taskId = await f.submitTask(a, 'mobilisation');
    const held = await inspect({ task_id: taskId, answers: answers('mobilisation', { material_matches_bom: { result: 'hold', note: 'Waiting for packing list' } }) });
    expect(held).toMatchObject({ outcome: 'on_hold', task_status: 'submitted' });
    await inspect({ task_id: taskId, answers: answers('mobilisation', { material_matches_bom: { result: 'fail' } }),
      defects: [{ criterion_key: 'material_matches_bom', category: 'documentation', severity: 'minor', location: 'Store room', description: 'Two brackets short of BOM', correction_due_date: inDays(3) }] });
    const [d] = await defectsOf(taskId);
    await expectCode(a.partner.admin.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: d!.version, p_action: 'dispute' }), 'REQUIRED_FIELD_MISSING');
    const dis = await a.partner.admin.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: d!.version, p_action: 'dispute', p_reason: 'Brackets were counted in crate 4' });
    expect(dis.status).toBe('disputed');
    await expectCode(a.partner.admin.rpc('defect_action', { p_defect_id: d!.id, p_expected_version: dis.version, p_action: 'resolve_dispute', p_reason: 'We decide ourselves' }), 'ACCESS_DENIED');
    const back = await as('qa1').rpc('defect_action', { p_defect_id: d!.id, p_expected_version: dis.version, p_action: 'resolve_dispute', p_reason: 'Crate 4 checked: still short by two' });
    expect(back.status).toBe('assigned');
  });
});

describe('Slice 6 — final QA, statutory evidence, handover and warranty (QA06, CU07, Gates 12–14)', () => {
  it('final QA after every task is approved; statutory evidence verified by a second person; customer acceptance completes handover and starts the warranty', async () => {
    const a = await f.installingProject();
    const pid = a.project.projectId;
    const pq = async (action: string, who: 'ops1' | 'owner' = 'ops1', reason?: string) =>
      as(who).rpc('project_quality_action', { p_project_id: pid, p_expected_version: await version('projects', pid), p_action: action, p_reason: reason ?? null });
    await expectCode(pq('submit_final_qa'), 'APPROVAL_REQUIRED');
    await allTasksApproved(a);
    expect((await pq('submit_final_qa')).status).toBe('final_qa');
    expect(await as('qa1').query(`select 1 from public.notifications where event_type = 'qa.final_requested' and entity_id = $1`, [pid])).toHaveLength(1);
    // Final QA (QA06): a failure needs notes and sends the project back; a pass never grants statutory permission.
    await expectCode(inspect({ project_id: pid, answers: answers('final', { test_records_present: { result: 'fail' } }) }), 'REQUIRED_FIELD_MISSING');
    const fin = await inspect({ project_id: pid, answers: answers('final') });
    expect(fin).toMatchObject({ outcome: 'passed', project_status: 'statutory_pending' });
    // Gate 12: verified official evidence of each required type; the recorder never verifies.
    await expectCode(pq('record_statutory_clearance'), 'EVIDENCE_REQUIRED');
    const evidence = [];
    for (const type of ['authority_inspection_report', 'operating_licence']) {
      const { op, file } = await projectFile(pid);
      evidence.push(await as('ops1').rpc('register_statutory_evidence', { p_operation_id: op, p_project_id: pid, p_payload: {
        evidence_type: type, authority: 'Lift Inspectorate, Pune', reference_number: `${type.toUpperCase()}-77`, issued_on: inDays(-1), ...file } }));
    }
    await expectCode(as('ops1').rpc('verify_statutory_evidence', { p_evidence_id: evidence[0].evidence_id, p_decision: 'verify' }), 'ACCESS_DENIED');
    expect(await as('customer1').query('select 1 from public.statutory_evidence where project_id = $1', [pid])).toEqual([]);
    for (const e of evidence) await as('owner').rpc('verify_statutory_evidence', { p_evidence_id: e.evidence_id, p_decision: 'verify' });
    expect((await pq('record_statutory_clearance')).status).toBe('handover_ready');
    // Gate 13: the package, the customer link, then the customer decides.
    const ho = (action: string) => as('ops1').rpc('handover_action', { p_project_id: pid, p_action: action });
    const missing = await ho('confirm_ready').catch((x: any) => x);
    expect(missing).toMatchObject({ code: 'EVIDENCE_REQUIRED', detail: { missing: [...DEFAULT_HANDOVER_DOCUMENTS] } });
    for (const doc of DEFAULT_HANDOVER_DOCUMENTS) {
      const { op, file } = await projectFile(pid);
      await as('ops1').rpc('register_handover_document', { p_operation_id: op, p_project_id: pid, p_payload: { doc_type: doc, title: `${doc} v1`, ...file } });
    }
    await expectCode(ho('confirm_ready'), 'REQUIRED_FIELD_MISSING'); // no customer linked
    await expectCode(as('customer1').rpc('customer_handover_decision', { p_project_id: pid, p_decision: 'accept', p_acceptor_name: 'Mr. Rao' }), 'NOT_FOUND');
    await as('ops1').rpc('link_project_customer', { p_project_id: pid, p_expected_version: await version('projects', pid), p_customer_org_id: fx.orgs.customer });
    expect((await ho('confirm_ready')).handover_status).toBe('ready');
    expect(await as('customer1').query(`select 1 from public.notifications where event_type = 'handover.ready' and entity_id = $1`, [pid])).toHaveLength(1);
    // The customer sees its project and the package — never orders, tasks, defects, partner terms or supplier prices.
    expect(await as('customer1').query('select title from public.projects where id = $1', [pid])).toHaveLength(1);
    expect(await as('customer1').query('select 1 from public.handover_documents where project_id = $1', [pid])).toHaveLength(7);
    for (const table of ['orders', 'payment_milestones', 'project_tasks', 'defects', 'project_partner_assignments', 'purchase_orders', 'bom_revisions']) {
      expect(await as('customer1').query(`select 1 from public.${table} where project_id = $1`.replace('project_id = $1', table === 'orders' ? 'id in (select order_id from public.projects where id = $1)' : 'project_id = $1'), [pid])).toEqual([]);
    }
    const dec = (decision: string, comment?: string) => as('customer1').rpc('customer_handover_decision', { p_project_id: pid, p_decision: decision, p_acceptor_name: 'Mr. Rao (Secretary)', p_comment: comment ?? null });
    await expectCode(dec('raise_issue'), 'REQUIRED_FIELD_MISSING');
    expect((await dec('raise_issue', 'Emergency instructions missing in Marathi')).handover_status).toBe('issues_raised');
    expect((await ho('recheck')).handover_status).toBe('not_ready');
    const { op, file } = await projectFile(pid);
    await as('ops1').rpc('register_handover_document', { p_operation_id: op, p_project_id: pid, p_payload: { doc_type: 'emergency_instructions', title: 'Emergency instructions (Marathi)', ...file } });
    await ho('confirm_ready');
    const acc = await dec('accept');
    expect(acc).toMatchObject({ handover_status: 'accepted', project_status: 'handed_over' });
    expect(acc.asset_number).toMatch(/^LA-PUN-\d{4}-\d{5}$/);
    // Gate 14: warranty from the contractual event (handover acceptance), with its source date; equals the domain.
    const [asset] = await as('customer1').query<{ warranty_status: string; warranty_start_event: string; warranty_source_date: string; warranty_start: string; warranty_end: string; manufacturer: string }>(
      `select warranty_status, warranty_start_event, warranty_source_date::text, warranty_start::text, warranty_end::text, manufacturer from public.lift_assets where project_id = $1`, [pid]);
    expect(asset).toMatchObject({ warranty_status: 'active', warranty_start_event: 'handover_acceptance', manufacturer: 'Example Lifts' });
    expect({ start: asset!.warranty_start, end: asset!.warranty_end }).toEqual(warrantyPeriod(asset!.warranty_source_date, 12));
    expect((await pq('close')).status).toBe('closed');
    expect(await admin(pool, `select count(*)::int as n from public.audit_logs where project_id = $1 and action in ('project.final_qa_passed', 'project.statutory_evidence_recorded', 'project.handed_over', 'warranty.activated', 'project.closed')`, [pid])).toEqual([{ n: 5 }]);
  });
});

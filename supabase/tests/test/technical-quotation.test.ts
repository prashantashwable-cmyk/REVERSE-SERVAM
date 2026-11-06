import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { computeQuotation, type QuotationLineInput } from '@aiec/domain';
import { admin, expectCode, makePool } from '../src/db';
import { PASSENGER_CONFIG, asParameters, flows } from '../src/flows';

const fx = inject('fixture');
const pool = makePool();
afterAll(() => pool.end());
const { as, submittedSurvey, resubmit } = flows(pool, fx);

const version = async (table: string, id: string) =>
  (await admin<{ version: number }>(pool, `select version from public.${table} where id = $1`, [id]))[0]!.version;

async function reviewing() {
  const s = await submittedSurvey();
  const r = await as('tech1').rpc('start_technical_review', { p_survey_id: s.surveyId });
  return { ...s, reviewId: r.review_id as string, review: r };
}

async function feasible() {
  const s = await reviewing();
  const d = await as('tech1').rpc('decide_technical_review', {
    p_review_id: s.reviewId, p_expected_version: s.review.version, p_decision: 'feasible',
    p_payload: { technical_basis: 'Shaft, pit and overhead fit an 8-person MRL lift', assumptions: 'Builder completes shaft plaster' },
  });
  return { ...s, decision: d };
}

async function approvedConfiguration(values: Record<string, unknown> = PASSENGER_CONFIG) {
  const s = await feasible();
  const draft = await as('tech1').rpc('save_configuration_draft', {
    p_lead_id: s.leadId, p_expected_version: null, p_lift_category: 'passenger', p_parameters: asParameters(values), p_change_summary: 'Initial configuration',
  });
  const approved = await as('tech1').rpc('approve_configuration', { p_revision_id: draft.configuration_revision_id, p_expected_version: draft.version });
  return { ...s, configId: approved.configuration_revision_id as string, config: approved };
}

describe('Slice 3 — technical review (TE01–TE02, Gate 2)', () => {
  it('only technical reviewers open a review of a submitted survey; it records the exact survey revision', async () => {
    const s = await submittedSurvey();
    await expectCode(as('sales1').rpc('start_technical_review', { p_survey_id: s.surveyId }), 'ACCESS_DENIED');
    await expectCode(as('surveyor1').rpc('start_technical_review', { p_survey_id: s.surveyId }), 'ACCESS_DENIED');
    await expectCode(as('partnerA_admin').rpc('start_technical_review', { p_survey_id: s.surveyId }), 'NOT_FOUND');
    const r = await as('tech1').rpc('start_technical_review', { p_survey_id: s.surveyId });
    expect(r).toMatchObject({ status: 'in_review', survey_revision_id: s.revisionId });
    expect(r.review_number).toMatch(/^TR-PUN-\d{4}-\d{5}$/);
    const [sv] = await admin(pool, 'select status from public.surveys where id = $1', [s.surveyId]);
    expect(sv.status).toBe('under_review');
    // Starting twice is not a valid transition.
    await expectCode(as('tech1').rpc('start_technical_review', { p_survey_id: s.surveyId }), 'INVALID_STATE_TRANSITION');
    const audit = await admin(pool, `select action from public.audit_logs where entity_id = $1 order by id`, [r.review_id]);
    expect(audit.map((a: any) => a.action)).toEqual(['technical_review.started']);
  });

  it('clarification sends the survey back; after resubmission the same review resumes on the new revision', async () => {
    const s = await reviewing();
    await expectCode(as('tech1').rpc('request_technical_clarification', { p_review_id: s.reviewId, p_expected_version: s.review.version, p_reason: '' }), 'REQUIRED_FIELD_MISSING');
    const c = await as('tech1').rpc('request_technical_clarification', { p_review_id: s.reviewId, p_expected_version: s.review.version, p_reason: 'Confirm overhead at top landing' });
    expect(c.status).toBe('clarification_requested');
    const [sv] = await admin(pool, 'select status, current_revision_id from public.surveys where id = $1', [s.surveyId]);
    expect(sv.status).toBe('revision_requested');
    expect(await as('surveyor1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'survey.revision_requested'`, [s.surveyId])).toHaveLength(1);
    await resubmit(s.surveyId);
    const again = await as('tech1').rpc('start_technical_review', { p_survey_id: s.surveyId });
    expect(again).toMatchObject({ review_id: s.reviewId, status: 'in_review', survey_revision_id: sv.current_revision_id });
  });

  it('decisions need a technical basis; conditional needs constraints and corrective actions; not feasible needs a reason', async () => {
    const s = await reviewing();
    const base = { p_review_id: s.reviewId, p_expected_version: s.review.version };
    const e = await expectCode(as('tech1').rpc('decide_technical_review', { ...base, p_decision: 'conditionally_feasible', p_payload: { technical_basis: 'ok fine' } }), 'REQUIRED_FIELD_MISSING');
    expect(e.detail.fields).toEqual(['constraints', 'corrective_actions']);
    await expectCode(as('tech1').rpc('decide_technical_review', { ...base, p_decision: 'feasible', p_payload: {} }), 'REQUIRED_FIELD_MISSING');
    await expectCode(as('tech1').rpc('decide_technical_review', { ...base, p_decision: 'not_feasible', p_payload: { technical_basis: 'Shaft too small' } }), 'REQUIRED_FIELD_MISSING');
    await expectCode(as('tech1').rpc('decide_technical_review', { ...base, p_decision: 'approved', p_payload: {} }), 'VALIDATION_FAILED');
    await expectCode(as('sales1').rpc('decide_technical_review', { ...base, p_decision: 'feasible', p_payload: { technical_basis: 'x x x' } }), 'ACCESS_DENIED');
    const d = await as('tech1').rpc('decide_technical_review', {
      ...base, p_decision: 'conditionally_feasible',
      p_payload: { technical_basis: 'Fits with deeper pit', constraints: ['Pit 1500 mm needed', ' '], corrective_actions: ['Builder deepens pit by 100 mm'] },
    });
    expect(d.status).toBe('conditionally_feasible');
    const [row] = await admin(pool, 'select constraints, corrective_actions, decided_by from public.technical_reviews where id = $1', [s.reviewId]);
    expect(row).toEqual({ constraints: ['Pit 1500 mm needed'], corrective_actions: ['Builder deepens pit by 100 mm'], decided_by: fx.users.tech1 });
    const [sv] = await admin(pool, 'select status from public.surveys where id = $1', [s.surveyId]);
    expect(sv.status).toBe('reviewed');
    // A decision is a record: never edited, even by the database owner.
    await expectCode(admin(pool, `update public.technical_reviews set technical_basis = 'changed' where id = $1`, [s.reviewId]), 'ACCESS_DENIED');
    // The lead owner is told; visibility follows the lead.
    expect(await as('sales1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'technical.decided'`, [s.leadId])).toHaveLength(1);
    expect(await as('sales1').query('select 1 from public.technical_reviews where id = $1', [s.reviewId])).toHaveLength(1);
    for (const u of ['sales2', 'surveyor1', 'partnerA_admin', 'customer1'] as const) {
      expect(await as(u).query('select 1 from public.technical_reviews where id = $1', [s.reviewId]), u).toEqual([]);
    }
  });

  it('"insufficient information" is recorded and returns the survey; the review resumes after resubmission', async () => {
    const s = await reviewing();
    const d = await as('tech1').rpc('decide_technical_review', {
      p_review_id: s.reviewId, p_expected_version: s.review.version, p_decision: 'insufficient_information',
      p_payload: { technical_basis: 'Electrical data missing', reason: 'Need supply rating photo' },
    });
    expect(d.status).toBe('insufficient_information');
    const [sv] = await admin(pool, 'select status from public.surveys where id = $1', [s.surveyId]);
    expect(sv.status).toBe('revision_requested');
    await resubmit(s.surveyId);
    expect((await as('tech1').rpc('start_technical_review', { p_survey_id: s.surveyId })).status).toBe('in_review');
  });

  it('the Slice 2 "return for revision" keeps an open review in step', async () => {
    const s = await reviewing();
    const v = await version('surveys', s.surveyId);
    await as('tech1').rpc('request_survey_revision', { p_survey_id: s.surveyId, p_expected_version: v, p_reason: 'Re-measure pit' });
    const [r] = await admin(pool, 'select status from public.technical_reviews where id = $1', [s.reviewId]);
    expect(r.status).toBe('clarification_requested');
  });
});

describe('Slice 3 — lift configuration (TE03)', () => {
  it('drafts need a review in progress; approval needs a feasible decision and a complete, valid configuration', async () => {
    const s = await submittedSurvey();
    await expectCode(as('tech1').rpc('save_configuration_draft', { p_lead_id: s.leadId, p_expected_version: null, p_lift_category: 'passenger', p_parameters: {} }), 'INVALID_STATE_TRANSITION');
    const r = await as('tech1').rpc('start_technical_review', { p_survey_id: s.surveyId });
    const { persons: _p, ...incomplete } = PASSENGER_CONFIG;
    void _p;
    const draft = await as('tech1').rpc('save_configuration_draft', {
      p_lead_id: s.leadId, p_expected_version: null, p_lift_category: 'passenger', p_parameters: asParameters({ ...incomplete, shaft_width_mm: 1900 }),
    });
    expect(draft.check.failures[0]).toMatchObject({ code: 'REQUIRED_FIELD_MISSING', fields: ['config.persons'] });
    expect(draft.check.warnings.map((w: any) => w.key)).toEqual(['shaft_width_mm']);
    await expectCode(as('sales1').rpc('save_configuration_draft', { p_lead_id: s.leadId, p_expected_version: draft.version, p_lift_category: 'passenger', p_parameters: {} }), 'ACCESS_DENIED');
    await expectCode(as('tech1').rpc('save_configuration_draft', {
      p_lead_id: s.leadId, p_expected_version: draft.version, p_lift_category: 'passenger', p_parameters: { rated_load_kg: { value: 544, status: 'approved' } },
    }), 'VALIDATION_FAILED');
    // Gate 2: no approval before the feasibility decision.
    await expectCode(as('tech1').rpc('approve_configuration', { p_revision_id: draft.configuration_revision_id, p_expected_version: draft.version }), 'APPROVAL_REQUIRED');
    await as('tech1').rpc('decide_technical_review', { p_review_id: r.review_id, p_expected_version: r.version, p_decision: 'feasible', p_payload: { technical_basis: 'Fits' } });
    const e = await expectCode(as('tech1').rpc('approve_configuration', { p_revision_id: draft.configuration_revision_id, p_expected_version: draft.version }), 'REQUIRED_FIELD_MISSING');
    expect(e.detail.fields).toEqual(['config.persons']);
    const saved = await as('tech1').rpc('save_configuration_draft', {
      p_lead_id: s.leadId, p_expected_version: draft.version, p_lift_category: 'passenger', p_parameters: asParameters({ ...PASSENGER_CONFIG, shaft_width_mm: 1900 }, 'reviewed'),
    });
    expect(saved.revision_no).toBe(1);
    const ok = await as('tech1').rpc('approve_configuration', { p_revision_id: saved.configuration_revision_id, p_expected_version: saved.version });
    expect(ok).toMatchObject({ status: 'approved' });
    expect(ok.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.warnings.map((w: any) => w.key)).toEqual(['shaft_width_mm']); // larger than surveyed: shown, never blocking
    const [row] = await admin(pool, 'select parameters from public.configuration_revisions where id = $1', [ok.configuration_revision_id]);
    expect(Object.values(row.parameters).every((p: any) => p.status === 'approved')).toBe(true);
    await expectCode(admin(pool, `update public.configuration_revisions set lift_category = 'goods' where id = $1`, [ok.configuration_revision_id]), 'ACCESS_DENIED');
    expect(await as('sales1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'configuration.approved'`, [s.leadId])).toHaveLength(1);
  });

  it('a new approved revision supersedes the previous one; both are kept', async () => {
    const s = await approvedConfiguration();
    const d2 = await as('tech1').rpc('save_configuration_draft', {
      p_lead_id: s.leadId, p_expected_version: null, p_lift_category: 'passenger', p_parameters: asParameters({ ...PASSENGER_CONFIG, rated_speed_mps: 1.5 }), p_change_summary: 'Speed 1.5 m/s on request',
    });
    expect(d2.revision_no).toBe(2);
    await as('tech1').rpc('approve_configuration', { p_revision_id: d2.configuration_revision_id, p_expected_version: d2.version });
    const rows = await as('sales1').query('select revision_no, status from public.configuration_revisions where lead_id = $1 order by revision_no', [s.leadId]);
    expect(rows).toEqual([{ revision_no: 1, status: 'superseded' }, { revision_no: 2, status: 'approved' }]);
  });
});

describe('Slice 3 — controlled technical documents (TE04)', () => {
  async function upload(user: 'tech1' | 'sales1', leadId: string, op = randomUUID(), size = 4096) {
    const path = `${fx.orgs.aiec}/leads/${leadId}/${op}.pdf`;
    await as(user).query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('technical-documents', $1, $2, $3)`, [
      path, fx.users[user], { size, mimetype: 'application/pdf' },
    ]);
    return { op, path, sha: createHash('sha256').update(op).digest('hex'), size };
  }

  it('approval binds to the file checksum; a new upload never silently replaces the approved drawing', async () => {
    const s = await feasible();
    await expect(upload('sales1', s.leadId)).rejects.toThrow(/row-level security/); // only technical staff upload drawings
    const f = await upload('tech1', s.leadId);
    const reg = await as('tech1').rpc('register_document_revision', {
      p_operation_id: f.op, p_lead_id: s.leadId, p_document_id: null,
      p_payload: { kind: 'shaft_layout', title: 'Shaft layout', storage_path: f.path, sha256: f.sha, mime_type: 'application/pdf', size_bytes: f.size, change_summary: 'First issue' },
    });
    expect(reg.document_number).toMatch(/^TD-PUN-\d{4}-\d{5}$/);
    // Replay is idempotent.
    expect((await as('tech1').rpc('register_document_revision', { p_operation_id: f.op, p_lead_id: s.leadId, p_document_id: null, p_payload: {} })).replayed).toBe(true);
    // Sales sees only approved documents.
    expect(await as('sales1').query('select 1 from public.document_revisions where id = $1', [reg.document_revision_id])).toEqual([]);
    const sub = await as('tech1').rpc('submit_document_revision', { p_revision_id: reg.document_revision_id, p_expected_version: reg.version });
    expect(sub.status).toBe('in_review');
    await expectCode(as('tech1').rpc('decide_document_revision', { p_revision_id: reg.document_revision_id, p_expected_version: sub.version, p_decision: 'approve', p_reviewed_sha256: 'f'.repeat(64) }), 'REVISION_CONFLICT');
    await expectCode(as('tech1').rpc('decide_document_revision', { p_revision_id: reg.document_revision_id, p_expected_version: sub.version, p_decision: 'reject', p_reviewed_sha256: null }), 'REQUIRED_FIELD_MISSING');
    const ap = await as('tech1').rpc('decide_document_revision', { p_revision_id: reg.document_revision_id, p_expected_version: sub.version, p_decision: 'approve', p_reviewed_sha256: f.sha });
    expect(ap.status).toBe('approved');
    expect(await as('sales1').query('select status from public.document_revisions where id = $1', [reg.document_revision_id])).toEqual([{ status: 'approved' }]);
    expect(await as('sales1').query(`select 1 from storage.objects where bucket_id = 'technical-documents' and name = $1`, [f.path])).toHaveLength(1);
    await expectCode(admin(pool, `update public.document_revisions set sha256 = $2 where id = $1`, [reg.document_revision_id, 'e'.repeat(64)]), 'ACCESS_DENIED');

    // Revision 2: while it is in review, revision 1 stays the approved one.
    const f2 = await upload('tech1', s.leadId);
    const reg2 = await as('tech1').rpc('register_document_revision', {
      p_operation_id: f2.op, p_lead_id: s.leadId, p_document_id: reg.document_id,
      p_payload: { storage_path: f2.path, sha256: f2.sha, mime_type: 'application/pdf', size_bytes: f2.size, change_summary: 'Pit depth corrected' },
    });
    const f3 = await upload('tech1', s.leadId);
    await expectCode(as('tech1').rpc('register_document_revision', {
      p_operation_id: f3.op, p_lead_id: s.leadId, p_document_id: reg.document_id,
      p_payload: { storage_path: f3.path, sha256: f3.sha, mime_type: 'application/pdf', size_bytes: f3.size, change_summary: 'Another' },
    }), 'INVALID_STATE_TRANSITION');
    const sub2 = await as('tech1').rpc('submit_document_revision', { p_revision_id: reg2.document_revision_id, p_expected_version: reg2.version });
    const [doc] = await admin(pool, 'select current_approved_revision_id from public.technical_documents where id = $1', [reg.document_id]);
    expect(doc.current_approved_revision_id).toBe(reg.document_revision_id);
    await as('tech1').rpc('decide_document_revision', { p_revision_id: reg2.document_revision_id, p_expected_version: sub2.version, p_decision: 'approve', p_reviewed_sha256: f2.sha });
    const revs = await admin(pool, 'select revision_no, status from public.document_revisions where document_id = $1 order by revision_no', [reg.document_id]);
    expect(revs).toEqual([{ revision_no: 1, status: 'superseded' }, { revision_no: 2, status: 'approved' }]);
  });

  it('files must be uploaded to the right lead first, with a matching size and checksum format', async () => {
    const s = await feasible();
    const other = await feasible();
    const f = await upload('tech1', other.leadId);
    const base = { kind: 'electrical', title: 'Electrical drawing', storage_path: f.path, sha256: f.sha, mime_type: 'application/pdf', size_bytes: f.size, change_summary: 'First' };
    await expectCode(as('tech1').rpc('register_document_revision', { p_operation_id: f.op, p_lead_id: s.leadId, p_document_id: null, p_payload: base }), 'VALIDATION_FAILED');
    const g = await upload('tech1', s.leadId);
    const ok = { ...base, storage_path: g.path, sha256: g.sha };
    await expectCode(as('tech1').rpc('register_document_revision', { p_operation_id: g.op, p_lead_id: s.leadId, p_document_id: null, p_payload: { ...ok, size_bytes: 1 } }), 'VALIDATION_FAILED');
    await expectCode(as('tech1').rpc('register_document_revision', { p_operation_id: randomUUID(), p_lead_id: s.leadId, p_document_id: null, p_payload: { ...ok, storage_path: `${fx.orgs.aiec}/leads/${s.leadId}/${randomUUID()}.pdf` } }), 'VALIDATION_FAILED');
    const missing = randomUUID();
    await expectCode(as('tech1').rpc('register_document_revision', { p_operation_id: missing, p_lead_id: s.leadId, p_document_id: null, p_payload: { ...ok, storage_path: `${fx.orgs.aiec}/leads/${s.leadId}/${missing}.pdf` } }), 'FILE_UPLOAD_FAILED');
  });
});

const line = (over: Record<string, unknown> = {}) => ({
  category: 'lift_equipment', description: 'MRL passenger lift, 8 persons', quantity_milli: 1000, unit: 'nos',
  rate_paise: '1250000000', discount_bps: 0, tax_code: 'GST18', estimated_unit_cost_paise: '900000000', cost_source: 'Supplier quote Q-17', ...over,
});
const TERMS = {
  scope_of_supply: 'One MRL passenger lift as per configuration revision',
  scope_of_installation: 'Installation, testing and commissioning',
  customer_responsibilities: 'Civil works, power supply to machine area, scaffolding',
  exclusions: 'Civil and electrical works beyond the lift shaft',
  tax_treatment: 'GST extra as applicable at the time of invoicing',
  payment_terms: 'As per agreed milestone schedule',
  warranty_terms: '12 months from handover',
  delivery_assumptions: 'Site ready as per readiness checklist',
};

describe('Slice 3 — quotations, discount governance and acceptance (SE08–SE10, O04, Gate 3)', () => {
  it('needs an approved configuration; only the lead owner prepares it; technical and field roles never see prices', async () => {
    const s = await feasible();
    await expectCode(as('sales1').rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId }), 'APPROVAL_REQUIRED');
    const draft = await as('tech1').rpc('save_configuration_draft', { p_lead_id: s.leadId, p_expected_version: null, p_lift_category: 'passenger', p_parameters: asParameters(PASSENGER_CONFIG) });
    await as('tech1').rpc('approve_configuration', { p_revision_id: draft.configuration_revision_id, p_expected_version: draft.version });
    await expectCode(as('sales2').rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId }), 'NOT_FOUND');
    await expectCode(as('tech1').rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId }), 'NOT_FOUND');
    const q = await as('sales1').rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId });
    expect(q.quotation_number).toMatch(/^QT-PUN-\d{4}-\d{5}$/);
    expect(q).toMatchObject({ status: 'draft', revision_no: 1 });
    await expectCode(as('sales1').rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId }), 'INVALID_STATE_TRANSITION');
    for (const u of ['tech1', 'surveyor1', 'sales2', 'partnerA_admin', 'customer1', 'ops1'] as const) {
      expect(await as(u).query('select 1 from public.quotations where id = $1', [q.quotation_id]), u).toEqual([]);
      expect(await as(u).query('select 1 from public.quotation_lines'), u).toEqual([]);
    }
  });

  it('server totals equal the domain engine; within authority it is approved directly; issue needs all terms', async () => {
    const s = await approvedConfiguration();
    const q = await as('sales1').rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId });
    const lines = [line(), line({ category: 'installation', description: 'Installation and commissioning', rate_paise: '150000000', discount_bps: 250, estimated_unit_cost_paise: '80000000', quantity_milli: 1000 })];
    const saved = await as('sales1').rpc('save_quotation_draft', { p_revision_id: q.revision_id, p_expected_version: q.version, p_lines: lines, p_terms: {}, p_valid_until: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) });
    const expected = computeQuotation(lines.map((l): QuotationLineInput => ({
      category: l.category as QuotationLineInput['category'], description: l.description, quantityMilli: l.quantity_milli, unit: l.unit,
      ratePaise: BigInt(l.rate_paise), discountBps: l.discount_bps, taxCode: { code: 'GST18', rateBps: 1800 }, estimatedUnitCostPaise: BigInt(l.estimated_unit_cost_paise),
    })));
    expect(saved.totals.grandTotalPaise).toBe(expected.grandTotalPaise.toString());
    expect(saved.totals.contributionMarginBps).toBe(expected.contributionMarginBps);
    expect(saved.needs_approval).toBe(false);
    await expectCode(as('sales1').rpc('save_quotation_draft', { p_revision_id: q.revision_id, p_expected_version: saved.version, p_lines: [line({ tax_code: 'VAT5' })], p_terms: {}, p_valid_until: new Date(Date.now() + 864e5).toISOString().slice(0, 10) }), 'VALIDATION_FAILED');
    await expectCode(as('sales1').rpc('save_quotation_draft', { p_revision_id: q.revision_id, p_expected_version: saved.version, p_lines: [line({ rate_paise: '12.5' })], p_terms: {}, p_valid_until: new Date(Date.now() + 864e5).toISOString().slice(0, 10) }), 'VALIDATION_FAILED');
    const sub = await as('sales1').rpc('submit_quotation', { p_revision_id: q.revision_id, p_expected_version: saved.version });
    expect(sub.status).toBe('approved');
    // Locked after submission.
    await expectCode(as('sales1').rpc('save_quotation_draft', { p_revision_id: q.revision_id, p_expected_version: sub.version, p_lines: lines, p_terms: TERMS, p_valid_until: '2099-01-01' }), 'INVALID_STATE_TRANSITION');
    await expectCode(admin(pool, `update public.quotation_lines set rate_paise = 1 where revision_id = $1`, [q.revision_id]), 'ACCESS_DENIED');
    const e = await expectCode(as('sales1').rpc('issue_quotation', { p_revision_id: q.revision_id, p_expected_version: sub.version }), 'REQUIRED_FIELD_MISSING');
    expect(e.detail.fields).toEqual(Object.keys(TERMS).map((k) => `terms.${k}`));
  });

  it('a discount beyond authority goes to the Owner; requesters never approve; acceptance binds to the exact issued revision', async () => {
    const s = await approvedConfiguration();
    const q = await as('sales1').rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId });
    const validUntil = new Date(Date.now() + 25 * 864e5).toISOString().slice(0, 10);
    const saved = await as('sales1').rpc('save_quotation_draft', { p_revision_id: q.revision_id, p_expected_version: q.version, p_lines: [line({ discount_bps: 1200 })], p_terms: TERMS, p_valid_until: validUntil });
    expect(saved).toMatchObject({ needs_approval: true, approval_reasons: ['discount_above_authority'] });
    const sub = await as('sales1').rpc('submit_quotation', { p_revision_id: q.revision_id, p_expected_version: saved.version });
    expect(sub.status).toBe('pending_approval');
    const reqId = sub.approval_request_id as string;
    const [req] = await as('owner').query('select status, reasons, impact, requested_by from public.approval_requests where id = $1', [reqId]);
    expect(req).toMatchObject({ status: 'pending', reasons: ['discount_above_authority'], requested_by: fx.users.sales1 });
    expect(req.impact).toMatchObject({ overallDiscountBps: 1200, revision_no: 1 });
    expect(await as('owner').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'quotation.approval_requested'`, [reqId])).toHaveLength(1);
    await expectCode(as('sales1').rpc('decide_quotation_approval', { p_request_id: reqId, p_decision: 'approve' }), 'ACCESS_DENIED');
    await expectCode(as('tech1').rpc('decide_quotation_approval', { p_request_id: reqId, p_decision: 'approve' }), 'NOT_FOUND');
    await expectCode(as('owner').rpc('decide_quotation_approval', { p_request_id: reqId, p_decision: 'reject' }), 'REQUIRED_FIELD_MISSING');
    const more = await as('owner').rpc('decide_quotation_approval', { p_request_id: reqId, p_decision: 'more_info', p_reason: 'Attach the competitor quote' });
    expect(more).toMatchObject({ approval_status: 'more_info', status: 'draft' });
    expect(await as('sales1').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'quotation.approval_decided'`, [q.quotation_id])).toHaveLength(1);
    // Decided requests are records.
    await expectCode(as('owner').rpc('decide_quotation_approval', { p_request_id: reqId, p_decision: 'approve' }), 'INVALID_STATE_TRANSITION');

    const v = await version('quotation_revisions', q.revision_id);
    const sub2 = await as('sales1').rpc('submit_quotation', { p_revision_id: q.revision_id, p_expected_version: v });
    const ap = await as('owner').rpc('decide_quotation_approval', { p_request_id: sub2.approval_request_id, p_decision: 'approve' });
    expect(ap).toMatchObject({ approval_status: 'approved', status: 'approved' });
    const iss = await as('sales1').rpc('issue_quotation', { p_revision_id: q.revision_id, p_expected_version: ap.version });
    expect(iss.status).toBe('issued');
    expect(iss.content_sha256).toMatch(/^[0-9a-f]{64}$/);

    const accept = { accepted_by_name: 'Mrs. Rao', acceptor_authority: 'Society secretary (committee resolution)', channel: 'signed_copy', evidence: 'Signed copy scanned' };
    await expectCode(as('sales1').rpc('record_customer_response', { p_revision_id: q.revision_id, p_expected_version: iss.version, p_response: 'accept', p_payload: { ...accept, content_sha256: 'a'.repeat(64) } }), 'REVISION_CONFLICT');
    await expectCode(as('sales1').rpc('record_customer_response', { p_revision_id: q.revision_id, p_expected_version: iss.version, p_response: 'accept', p_payload: { content_sha256: iss.content_sha256 } }), 'REQUIRED_FIELD_MISSING');
    const acc = await as('sales1').rpc('record_customer_response', { p_revision_id: q.revision_id, p_expected_version: iss.version, p_response: 'accept', p_payload: { ...accept, content_sha256: iss.content_sha256 } });
    expect(acc.status).toBe('accepted');
    const [ca] = await as('sales1').query('select content_sha256, accepted_by_name, recorded_by from public.customer_acceptances where revision_id = $1', [q.revision_id]);
    expect(ca).toEqual({ content_sha256: iss.content_sha256, accepted_by_name: 'Mrs. Rao', recorded_by: fx.users.sales1 });
    await expectCode(admin(pool, `update public.customer_acceptances set accepted_by_name = 'x' where revision_id = $1`, [q.revision_id]), 'ACCESS_DENIED');
    await expectCode(as('sales1').rpc('revise_quotation', { p_quotation_id: q.quotation_id, p_reason: 'Customer wants change' }), 'INVALID_STATE_TRANSITION');
    expect(await as('owner').query(`select 1 from public.notifications where entity_id = $1 and event_type = 'quotation.accepted'`, [q.quotation_id])).toHaveLength(1);
  });

  it('segregation of duties: the requester of an approval can never decide it', async () => {
    const [r] = await admin<{ id: string }>(pool, `insert into public.approval_requests (organization_id, kind, entity_type, entity_id, requested_by, reasons, policy, impact)
      values ($1, 'quotation_discount', 'quotation_revision', gen_random_uuid(), $2, '{discount_above_authority}', '{}', '{}') returning id`, [fx.orgs.aiec, fx.users.owner]);
    await expectCode(as('owner').rpc('decide_quotation_approval', { p_request_id: r!.id, p_decision: 'approve' }), 'SELF_APPROVAL_FORBIDDEN');
  });

  it('a revision supersedes the issued one; the negotiation log is append-only', async () => {
    const s = await approvedConfiguration();
    const q = await as('sales1').rpc('create_quotation', { p_operation_id: randomUUID(), p_lead_id: s.leadId });
    const saved = await as('sales1').rpc('save_quotation_draft', { p_revision_id: q.revision_id, p_expected_version: q.version, p_lines: [line()], p_terms: TERMS, p_valid_until: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) });
    const sub = await as('sales1').rpc('submit_quotation', { p_revision_id: q.revision_id, p_expected_version: saved.version });
    const iss = await as('sales1').rpc('issue_quotation', { p_revision_id: q.revision_id, p_expected_version: sub.version });
    await expectCode(as('sales1').rpc('revise_quotation', { p_quotation_id: q.quotation_id, p_reason: '' }), 'REQUIRED_FIELD_MISSING');
    const neg = await as('sales1').rpc('add_quotation_negotiation', { p_quotation_id: q.quotation_id, p_payload: {
      occurred_at: new Date().toISOString(), contact: 'Mr. Rao', topic: 'Price', requested_change: 'Add 2 years AMC', requested_discount_bps: 300, decision: 'Offer revised revision' } });
    await expectCode(admin(pool, `delete from public.quotation_negotiations where id = $1`, [neg.negotiation_id]), 'ACCESS_DENIED');
    await expectCode(as('sales1').rpc('add_quotation_negotiation', { p_quotation_id: q.quotation_id, p_payload: { contact: 'x' } }), 'REQUIRED_FIELD_MISSING');
    const r2 = await as('sales1').rpc('revise_quotation', { p_quotation_id: q.quotation_id, p_reason: 'Customer asked for AMC' });
    expect(r2).toMatchObject({ revision_no: 2, status: 'draft' });
    expect(r2.totals.grandTotalPaise).toBe(iss.totals.grandTotalPaise);
    const revs = await as('sales1').query('select revision_no, status, content_sha256 is not null as hashed from public.quotation_revisions where quotation_id = $1 order by revision_no', [q.quotation_id]);
    expect(revs).toEqual([{ revision_no: 1, status: 'superseded', hashed: true }, { revision_no: 2, status: 'draft', hashed: false }]);
    expect(await as('sales1').query('select count(*)::int as n from public.quotation_lines where revision_id = $1', [r2.revision_id])).toEqual([{ n: 1 }]);
    // Responses are recorded only on the current issued revision.
    const v1 = await version('quotation_revisions', q.revision_id);
    await expectCode(as('sales1').rpc('record_customer_response', { p_revision_id: q.revision_id, p_expected_version: v1, p_response: 'reject', p_payload: { reason: 'Too late' } }), 'INVALID_STATE_TRANSITION');
  });
});

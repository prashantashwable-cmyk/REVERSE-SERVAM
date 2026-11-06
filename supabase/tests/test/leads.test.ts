import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { Session, admin, expectCode, makePool } from '../src/db';
import type { UserKey } from '../src/fixture';
import { leadPayload, nextPhone } from '../src/payloads';

const fx = inject('fixture');
const pool = makePool();
afterAll(() => pool.end());
const as = (u: UserKey) => new Session(pool, fx.users[u]);

const lead = (id: string) => admin<any>(pool, 'select * from public.leads where id = $1', [id]).then((r) => r[0]);

describe('Slice 2 — lead capture, duplicates and idempotency', () => {
  it('sales creates a lead assigned to self with an immutable business id, audit and notification', async () => {
    const op = randomUUID();
    const r = await as('sales1').rpc('create_lead', { p_operation_id: op, p_payload: leadPayload() });
    expect(r).toMatchObject({ status: 'assigned', owner_user_id: fx.users.sales1, replayed: false, version: 1 });
    expect(r.lead_number).toMatch(/^LD-PUN-\d{4}-\d{5}$/);
    const audit = await as('owner').query<{ action: string; actor_roles: string[]; operation_id: string }>(
      `select action, actor_roles, operation_id from public.audit_logs where entity_id = $1 order by id`,
      [r.lead_id],
    );
    expect(audit.map((a) => a.action)).toEqual(['lead.created', 'lead.assigned']);
    expect(audit[0]!.actor_roles).toEqual(['sales_executive']);
    expect(audit[0]!.operation_id).toBe(op);
    const notes = await as('sales1').query(`select event_type from public.notifications where entity_id = $1`, [r.lead_id]);
    expect(notes).toEqual([{ event_type: 'lead.assigned' }]);
  });

  it('a repeated operation id replays the stored result and creates nothing new (also concurrently)', async () => {
    const op = randomUUID();
    const payload = leadPayload();
    const [a, b] = await Promise.all([
      as('sales1').rpc('create_lead', { p_operation_id: op, p_payload: payload }),
      as('sales1').rpc('create_lead', { p_operation_id: op, p_payload: payload }),
    ]);
    expect(a.lead_id).toBe(b.lead_id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const c = await as('sales1').rpc('create_lead', { p_operation_id: op, p_payload: payload });
    expect(c).toMatchObject({ lead_id: a.lead_id, replayed: true });
    const rows = await admin(pool, 'select 1 from public.leads where project_name = $1', [payload.project_name]);
    expect(rows).toHaveLength(1);
    // Another user cannot hijack an operation id.
    await expectCode(as('sales2').rpc('create_lead', { p_operation_id: op, p_payload: leadPayload() }), 'DUPLICATE_OPERATION');
  });

  it('validates minimum capture with field-level errors and never leaks raw SQL errors', async () => {
    const e = await expectCode(as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: { source: 'phone' } }), 'REQUIRED_FIELD_MISSING');
    expect(e.detail.fields).toEqual(['contact_name', 'project_name', 'site.city', 'lift_requirement', 'contact_method']);
    const bad = async (over: Record<string, unknown>, field: string) => {
      const err = await expectCode(as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload(over) }), 'VALIDATION_FAILED');
      expect(err.detail.fields).toContain(field);
    };
    await bad({ phone: '12345' }, 'phone');
    await bad({ email: 'nope' }, 'email');
    await bad({ source: 'billboard' }, 'source');
    await bad({ floors_count: 'five' }, 'floors_count');
    await bad({ floors_count: 0 }, 'floors_count');
    await bad({ expected_decision_date: '2026-02-30' }, 'expected_decision_date');
    await bad({ site: { city: 'Pune', pincode: '12' } }, 'site.pincode');
    await bad({ site: { city: 'Pune', latitude: 95, longitude: 73 } }, 'latitude');
    await bad({ marketing_consent: 'yes' }, 'marketing_consent');
  });

  it('possible duplicates must be reviewed; acknowledgement is recorded; nothing is merged', async () => {
    const phone = nextPhone();
    const first = await as('sales1').rpc('create_lead', {
      p_operation_id: randomUUID(),
      p_payload: leadPayload({ phone, site: { city: 'Pune', latitude: 18.5591, longitude: 73.7868, location_source: 'map_pin' } }),
    });
    // Warning before creation (§29 test 2): masked info, cannot open someone else's lead.
    const candidates = await as('sales2').rpc('search_possible_duplicates', { p_phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` });
    expect(candidates).toEqual([
      expect.objectContaining({ lead_id: first.lead_id, level: 'strong', reasons: ['phone'], can_open: false, owner_name: 'Test sales1' }),
    ]);
    expect(candidates[0]).not.toHaveProperty('phone_e164');

    const payload = leadPayload({ phone, project_name: 'Another wing' });
    const err = await expectCode(as('sales2').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: payload }), 'DUPLICATE_REVIEW_REQUIRED');
    expect((err.detail.candidates as any[]).map((c) => c.lead_id)).toEqual([first.lead_id]);
    // Acknowledging without a reason is not enough.
    await expectCode(
      as('sales2').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: { ...payload, duplicate_review: { confirmed_separate_from: [first.lead_id] } } }),
      'DUPLICATE_REVIEW_REQUIRED',
    );
    const second = await as('sales2').rpc('create_lead', {
      p_operation_id: randomUUID(),
      p_payload: { ...payload, duplicate_review: { confirmed_separate_from: [first.lead_id], reason: 'Same society, separate wing B order' } },
    });
    const decisions = await admin(pool, 'select decision, match_reasons, reason from public.lead_duplicate_decisions where lead_id = $1', [second.lead_id]);
    expect(decisions).toEqual([{ decision: 'separate_opportunity', match_reasons: ['phone'], reason: 'Same society, separate wing B order' }]);
    expect(await lead(first.lead_id)).toMatchObject({ owner_user_id: fx.users.sales1 });

    // Proximity alone still needs review, but is only a "possible" match.
    const near = await as('sales2').rpc('search_possible_duplicates', { p_latitude: 18.5595, p_longitude: 73.787 });
    expect(near.find((c: any) => c.lead_id === first.lead_id)).toMatchObject({ level: 'possible', reasons: ['site_proximity'] });
  });

  it('a later ownership-transfer request is recorded and routed to lead assigners', async () => {
    const phone = nextPhone();
    const a = await as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload({ phone }) });
    const b = await as('sales2').rpc('create_lead', {
      p_operation_id: randomUUID(),
      p_payload: leadPayload({ phone, duplicate_review: { confirmed_separate_from: [a.lead_id], reason: 'checking with customer' } }),
    });
    const id = await as('sales2').rpc('record_duplicate_decision', { p_lead_id: b.lead_id, p_candidate_lead_id: a.lead_id, p_decision: 'ownership_transfer_requested', p_reason: 'customer prefers me' });
    expect(id).toBeTruthy();
    const n = await as('owner').query(`select event_type from public.notifications where dedupe_key like 'lead.ownership_transfer_requested:' || $1 || '%'`, [id]);
    expect(n).toEqual([{ event_type: 'lead.ownership_transfer_requested' }]);
    await expectCode(
      as('sales2').rpc('record_duplicate_decision', { p_lead_id: b.lead_id, p_candidate_lead_id: (await as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() })).lead_id, p_decision: 'merge_requested', p_reason: 'not a match' }),
      'VALIDATION_FAILED',
    );
  });
});

describe('Slice 2 — lead visibility and workflow', () => {
  it('lead visibility: owner of the lead, lead.read_all — nobody else', async () => {
    const r = await as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() });
    const sel = (u: UserKey) => as(u).query('select id from public.leads where id = $1', [r.lead_id]);
    expect(await sel('sales1')).toHaveLength(1);
    expect(await sel('owner')).toHaveLength(1);
    for (const u of ['sales2', 'surveyor1', 'tech1', 'ops1', 'partnerA_admin', 'partnerA_tech', 'customer1'] as const) {
      expect(await sel(u), u).toEqual([]);
    }
    // The owner reads but cannot create (segregation of commercial capture).
    await expectCode(as('owner').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() }), 'ACCESS_DENIED');
    await expectCode(as('sales2').rpc('record_lead_activity', {
      p_operation_id: randomUUID(), p_lead_id: r.lead_id, p_activity_type: 'call', p_outcome: 'interested',
      p_summary: 'hijack', p_occurred_at: new Date().toISOString(), p_next_follow_up_at: new Date(Date.now() + 864e5).toISOString(),
    }), 'ACCESS_DENIED');
  });

  it('activities: no-answer keeps the lead assigned; a real contact moves it; a next action is mandatory', async () => {
    const r = await as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() });
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 864e5).toISOString();
    const act = (over: Record<string, unknown>) =>
      as('sales1').rpc('record_lead_activity', {
        p_operation_id: randomUUID(), p_lead_id: r.lead_id, p_activity_type: 'call', p_outcome: 'no_answer',
        p_summary: 'Tried calling', p_occurred_at: now, p_next_follow_up_at: tomorrow, ...over,
      });
    await expectCode(act({ p_next_follow_up_at: null }), 'REQUIRED_FIELD_MISSING');
    await expectCode(act({ p_next_follow_up_at: new Date(Date.now() - 864e5).toISOString() }), 'VALIDATION_FAILED');
    expect(await act({})).toMatchObject({ status: 'assigned' });
    expect((await lead(r.lead_id)).first_contacted_at).toBeNull();
    expect(await act({ p_outcome: 'interested', p_summary: 'Wants survey next week' })).toMatchObject({ status: 'contacted' });
    const l = await lead(r.lead_id);
    expect(l.first_contacted_at).not.toBeNull();
    expect(new Date(l.next_action_at).toISOString()).toBe(tomorrow);
    // Activity history is append-only.
    await expectCode(admin(pool, 'delete from public.lead_activities where lead_id = $1', [r.lead_id]), 'ACCESS_DENIED');
  });

  it('qualification: invalid transitions explain allowed actions; score is transparent; overrides need a reason', async () => {
    const r = await as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() });
    const q = { need: 'Passenger lift', decision_authority: 'confirmed', timeline: 'within_3_months', next_action: 'Book survey', budget_readiness: 'ready' };
    const err = await expectCode(as('sales1').rpc('qualify_lead', { p_lead_id: r.lead_id, p_expected_version: 1, p_qualification: q }), 'INVALID_STATE_TRANSITION');
    expect(err.detail).toMatchObject({ currentState: 'assigned', allowedActions: ['close_lost', 'mark_invalid', 'reassign', 'record_contact'] });

    const c = await as('sales1').rpc('record_lead_activity', {
      p_operation_id: randomUUID(), p_lead_id: r.lead_id, p_activity_type: 'meeting', p_outcome: 'survey_required',
      p_summary: 'Met secretary', p_occurred_at: new Date().toISOString(), p_next_follow_up_at: new Date(Date.now() + 864e5).toISOString(),
    });
    await expectCode(as('sales1').rpc('qualify_lead', { p_lead_id: r.lead_id, p_expected_version: c.version - 1, p_qualification: q }), 'REVISION_CONFLICT');
    const missing = await expectCode(as('sales1').rpc('qualify_lead', { p_lead_id: r.lead_id, p_expected_version: c.version, p_qualification: { need: 'x' } }), 'REQUIRED_FIELD_MISSING');
    expect(missing.detail.fields).toEqual(['decision_authority', 'timeline', 'next_action']);
    await expectCode(as('sales1').rpc('qualify_lead', { p_lead_id: r.lead_id, p_expected_version: c.version, p_qualification: q, p_score_override: 90 }), 'REQUIRED_FIELD_MISSING');
    const ok = await as('sales1').rpc('qualify_lead', { p_lead_id: r.lead_id, p_expected_version: c.version, p_qualification: q, p_score_override: 90, p_override_reason: 'Board already approved budget' });
    expect(ok).toMatchObject({ status: 'qualified', score: 90, score_computed: 80 });
    expect(ok.score_explanation.filter((e: any) => e.matched).map((e: any) => e.key)).toEqual(['need', 'decision_authority', 'budget_readiness', 'timeline']);
  });

  it('assignment authority: only lead.assign holders reassign, with a reason; closing lost needs a reason code; reopen', async () => {
    const r = await as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() });
    await expectCode(as('sales1').rpc('assign_lead', { p_lead_id: r.lead_id, p_assignee_id: fx.users.sales2, p_expected_version: 1, p_reason: 'swap' }), 'ACCESS_DENIED');
    await expectCode(as('owner').rpc('assign_lead', { p_lead_id: r.lead_id, p_assignee_id: fx.users.sales2, p_expected_version: 1 }), 'REQUIRED_FIELD_MISSING');
    await expectCode(as('owner').rpc('assign_lead', { p_lead_id: r.lead_id, p_assignee_id: fx.users.surveyor1, p_expected_version: 1, p_reason: 'x-skill' }), 'VALIDATION_FAILED');
    const re = await as('owner').rpc('assign_lead', { p_lead_id: r.lead_id, p_assignee_id: fx.users.sales2, p_expected_version: 1, p_reason: 'Territory change' });
    expect(re).toMatchObject({ status: 'assigned', owner_user_id: fx.users.sales2, version: 2 });
    expect(await as('sales1').query('select 1 from public.leads where id = $1', [r.lead_id])).toEqual([]);

    await expectCode(as('sales2').rpc('close_lead', { p_lead_id: r.lead_id, p_expected_version: 2, p_outcome: 'lost', p_reason: 'Went elsewhere' }), 'REQUIRED_FIELD_MISSING');
    const lost = await as('sales2').rpc('close_lead', { p_lead_id: r.lead_id, p_expected_version: 2, p_outcome: 'lost', p_reason: 'Went with competitor', p_lost_reason: 'competitor' });
    expect(lost).toMatchObject({ status: 'lost' });
    await expectCode(as('sales2').rpc('record_lead_activity', {
      p_operation_id: randomUUID(), p_lead_id: r.lead_id, p_activity_type: 'call', p_outcome: 'interested',
      p_summary: 'late', p_occurred_at: new Date().toISOString(), p_next_follow_up_at: new Date(Date.now() + 864e5).toISOString(),
    }), 'INVALID_STATE_TRANSITION');
    const reopened = await as('owner').rpc('reopen_lead', { p_lead_id: r.lead_id, p_expected_version: lost.version, p_assignee_id: fx.users.sales1, p_reason: 'Customer came back' });
    expect(reopened).toMatchObject({ status: 'assigned' });
    expect(await lead(r.lead_id)).toMatchObject({ lost_reason: null, owner_user_id: fx.users.sales1 });
    const trail = await as('owner').query<{ action: string }>('select action from public.audit_logs where entity_id = $1 order by id', [r.lead_id]);
    expect(trail.map((t) => t.action)).toEqual(['lead.created', 'lead.assigned', 'lead.reassigned', 'lead.closed_lost', 'lead.reopened']);
  });

  it('invalid leads are terminal', async () => {
    const r = await as('sales1').rpc('create_lead', { p_operation_id: randomUUID(), p_payload: leadPayload() });
    await as('sales1').rpc('close_lead', { p_lead_id: r.lead_id, p_expected_version: 1, p_outcome: 'invalid', p_reason: 'Wrong number, spam' });
    const e = await expectCode(as('owner').rpc('reopen_lead', { p_lead_id: r.lead_id, p_expected_version: 2, p_assignee_id: fx.users.sales1, p_reason: 'try' }), 'INVALID_STATE_TRANSITION');
    expect(e.detail.allowedActions).toEqual([]);
  });
});

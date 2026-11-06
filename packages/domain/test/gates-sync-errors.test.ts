import { describe, expect, it } from 'vitest';
import {
  DomainError,
  MemorySyncStore,
  SyncQueue,
  acceleratedTargetDisplay,
  backoffMs,
  detectConflict,
  errorMessage,
  evaluateChecklist,
  evaluatePartnerCompliance,
  evaluateSafetyPreStart,
  expiringDocuments,
  fromServerError,
  hasPermission,
  isIndependentQaActor,
  missingHandoverDocuments,
  partnerEligibleForAssignment,
  rate,
  t,
  warrantyPeriod,
  ERROR_CODES,
  type ActorContext,
} from '../src';

describe('Gate 7 partner eligibility', () => {
  const reqs = [{ type: 'lift_contractor_licence', requiredScope: ['passenger'] }, { type: 'insurance' }];
  const docs = [
    { type: 'lift_contractor_licence', verification: 'verified' as const, expiresOn: '2027-03-31', scope: ['passenger', 'goods'] },
    { type: 'insurance', verification: 'verified' as const, expiresOn: '2026-11-01' },
  ];
  it('expired mandatory document blocks assignment', () => {
    const f = evaluatePartnerCompliance(docs, reqs, '2026-11-06');
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toBe('insurance: expired');
    expect(partnerEligibleForAssignment('approved', docs, reqs, '2026-11-06').eligible).toBe(false);
  });
  it('a document valid on its expiry date still counts', () => {
    expect(evaluatePartnerCompliance(docs, reqs, '2026-11-01')).toEqual([]);
  });
  it('insufficient scope and status both block', () => {
    const goodsOnly = [{ ...docs[0]!, scope: ['goods'] }, { ...docs[1]!, expiresOn: null }];
    expect(evaluatePartnerCompliance(goodsOnly, reqs, '2026-11-06')[0]!.message).toBe('lift_contractor_licence: scope_insufficient');
    const valid = [docs[0]!, { ...docs[1]!, expiresOn: null }];
    expect(partnerEligibleForAssignment('approved', valid, reqs, '2026-11-06').eligible).toBe(true);
    expect(partnerEligibleForAssignment('suspended', valid, reqs, '2026-11-06').eligible).toBe(false);
  });
  it('finds documents expiring soon', () => {
    expect(expiringDocuments(docs, '2026-10-20', 30).map((d) => d.type)).toEqual(['insurance']);
  });
});

describe('checklists, safety and timeline promises', () => {
  it('N/A needs a reason and failures block', () => {
    const r = evaluateChecklist([
      { key: 'access', group: 'access', result: 'pass' },
      { key: 'storage', group: 'storage', result: 'not_applicable' },
      { key: 'power', group: 'electrical', result: 'fail' },
      { key: 'drawings', group: 'drawings', result: 'awaiting_evidence' },
    ]);
    expect(r.passed).toBe(false);
    expect(r.failures.map((f) => f.code)).toEqual(['REQUIRED_FIELD_MISSING', 'SITE_NOT_READY', 'EVIDENCE_REQUIRED']);
  });
  it('critical safety failure disables start; non-critical is a warning', () => {
    const r = evaluateSafetyPreStart([
      { key: 'ppe', applicable: true, confirmed: true, critical: true },
      { key: 'lockout_tagout', applicable: true, confirmed: false, critical: true },
      { key: 'housekeeping', applicable: true, confirmed: false, critical: false },
      { key: 'crane', applicable: false, confirmed: false, critical: true },
    ]);
    expect(r).toEqual({ canStart: false, criticalFailures: ['lockout_tagout'], warnings: ['housekeeping'] });
    expect(evaluateSafetyPreStart([]).canStart).toBe(false);
  });
  it('accelerated targets show only when every condition holds and stay labelled target', () => {
    const readiness = { technical: true, site: true, payment: true, material: true, partner: true, documentation: true };
    expect(acceleratedTargetDisplay({ complexity: 'standard', readiness, targetApprovedBy: 'ops' })).toEqual({ show: true, label: 'target', unmet: [] });
    expect(acceleratedTargetDisplay({ complexity: 'complex', readiness: { ...readiness, material: false } }).unmet).toEqual(['complexity', 'material', 'target_approval']);
  });
  it('handover documents and warranty dates', () => {
    expect(missingHandoverDocuments(['operating_manual'])).toContain('warranty_certificate');
    expect(warrantyPeriod('2026-12-15', 12)).toEqual({ start: '2026-12-15', end: '2027-12-14' });
    expect(warrantyPeriod('2026-01-31', 1)).toEqual({ start: '2026-01-31', end: '2026-02-27' });
    expect(() => warrantyPeriod('nope', 12)).toThrow();
  });
});

describe('offline sync queue', () => {
  const base = { userId: 'u', organizationId: 'o', baseRevision: 1, payload: {} };
  it('enqueue is idempotent and ops for one record go strictly in order', async () => {
    let now = new Date('2026-11-06T10:00:00Z');
    const q = new SyncQueue(new MemorySyncStore(), () => now);
    await q.enqueue({ ...base, operationId: 'op1', operationType: 'survey.save_draft', recordKey: 'survey:1' });
    await q.enqueue({ ...base, operationId: 'op1', operationType: 'survey.save_draft', recordKey: 'survey:1' });
    await q.enqueue({ ...base, operationId: 'op2', operationType: 'survey.submit', recordKey: 'survey:1' });
    await q.enqueue({ ...base, operationId: 'op3', operationType: 'evidence.register', recordKey: 'evidence:9' });
    expect((await q.due()).map((o) => o.operationId)).toEqual(['op1', 'op3']);

    const sent: string[] = [];
    let failOnce = true;
    const result = await q.flush(async (op) => {
      sent.push(op.operationId);
      if (op.operationId === 'op3' && failOnce) {
        failOnce = false;
        throw new TypeError('Network request failed');
      }
      return { ok: true };
    });
    // op2 unblocked after op1 synced in the same flush; op3 failed transiently.
    expect(sent).toEqual(['op1', 'op3', 'op2']);
    expect(result.find((o) => o.operationId === 'op3')!.status).toBe('failed');
    expect(await q.status('survey:1')).toBe('synced');
    expect(await q.status('evidence:9')).toBe('failed');
    // Back-off: not due yet, due after the delay.
    expect(await q.due()).toEqual([]);
    now = new Date(now.getTime() + backoffMs(1));
    expect((await q.due()).map((o) => o.operationId)).toEqual(['op3']);
    await q.flush(async () => ({ ok: true }));
    expect(await q.status('evidence:9')).toBe('synced');
  });

  it('conflict blocks later ops for the same record until discarded; never reports synced', async () => {
    const q = new SyncQueue(new MemorySyncStore());
    await q.enqueue({ ...base, operationId: 'a', operationType: 'survey.save_draft', recordKey: 'survey:2' });
    await q.enqueue({ ...base, operationId: 'b', operationType: 'survey.submit', recordKey: 'survey:2' });
    await q.flush(async (op) => {
      if (op.operationId === 'a') throw new DomainError('REVISION_CONFLICT');
      return {};
    });
    expect(await q.status('survey:2')).toBe('conflict');
    expect(await q.due()).toEqual([]);
    await expect(q.discard('b')).rejects.toThrow();
    await q.discard('a');
    expect((await q.due()).map((o) => o.operationId)).toEqual(['b']);
  });

  it('server replay of an already-applied op is treated as synced; validation errors need a human', async () => {
    const q = new SyncQueue(new MemorySyncStore());
    await q.enqueue({ ...base, operationId: 'x', operationType: 't', recordKey: 'r1' });
    await q.enqueue({ ...base, operationId: 'y', operationType: 't', recordKey: 'r2' });
    await q.flush(async (op) => {
      throw new DomainError(op.operationId === 'x' ? 'DUPLICATE_OPERATION' : 'EVIDENCE_REQUIRED');
    });
    expect(await q.status('r1')).toBe('synced');
    expect(await q.status('r2')).toBe('rejected');
  });

  it('detects field-level conflicts', () => {
    expect(detectConflict({ a: 1, b: 1, c: 1 }, { a: 2, b: 1, c: 5 }, { a: 3, b: 4, c: 5 })).toEqual({
      conflicting: ['a'],
      localOnly: [],
      serverOnly: ['b'],
    });
  });
});

describe('errors, i18n, permissions', () => {
  it('maps server errors without leaking internals', () => {
    expect(fromServerError({ message: 'INVALID_STATE_TRANSITION', details: '{"currentState":"new","allowedActions":["assign"]}' }).details).toEqual({
      currentState: 'new',
      allowedActions: ['assign'],
    });
    const leaked = fromServerError({ message: 'duplicate key value violates unique constraint "leads_pkey"', code: '23505' });
    expect(leaked.code).toBe('UNKNOWN_ERROR');
    expect(leaked.message).toBe('UNKNOWN_ERROR');
    expect(fromServerError({ message: 'permission denied for table leads', code: '42501' }).code).toBe('ACCESS_DENIED');
  });
  it('every error code has an English title and next action', () => {
    for (const c of ERROR_CODES) {
      const m = errorMessage(c);
      expect(m.title).not.toBe(`error.${c}.title`);
      expect(m.nextAction).not.toBe(`error.${c}.next`);
    }
    expect(t('missing.key')).toBe('missing.key');
    expect(t('sync.synced', 'mr')).toBe('Synced');
  });
  it('suspended users hold no permissions; QA independence', () => {
    const actor: ActorContext = { userId: 'u', accountStatus: 'suspended', assignments: [{ organizationId: 'aiec', organizationKind: 'aiec', role: 'owner' }] };
    expect(hasPermission(actor, 'audit.read')).toBe(false);
    expect(hasPermission({ ...actor, accountStatus: 'active' }, 'audit.read', 'aiec')).toBe(true);
    expect(hasPermission({ ...actor, accountStatus: 'active' }, 'audit.read', 'other')).toBe(false);
    // A role granted in a disallowed org kind is ignored.
    expect(hasPermission({ ...actor, accountStatus: 'active', assignments: [{ organizationId: 'p', organizationKind: 'partner', role: 'owner' }] }, 'audit.read')).toBe(false);
    expect(isIndependentQaActor({ userId: 'q', accountStatus: 'active', assignments: [{ organizationId: 'aiec', organizationKind: 'aiec', role: 'qa_inspector' }] }, 'aiec')).toBe(true);
  });
  it('rates expose denominators', () => {
    expect(rate(3, 0)).toEqual({ value: null, numerator: 3, denominator: 0 });
  });
});

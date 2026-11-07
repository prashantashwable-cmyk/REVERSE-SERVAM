import { afterAll, describe, expect, it } from 'vitest';
import {
  CALL_OUTCOMES,
  LEAD_STATES,
  LOST_REASONS,
  ORGANIZATION_KINDS,
  PERMISSIONS,
  ROLE_CODES,
  ROLE_ORG_KINDS,
  ROLE_PERMISSIONS,
  SURVEY_STATES,
  DEFAULT_SURVEY_REQUIREMENTS,
  DEFAULT_LEAD_SCORING,
  leadMachine,
  surveyMachine,
  scoreLead,
  normalizePhone,
  DEFAULT_CONFIGURATION_CATALOGUE,
  DEFAULT_DISCOUNT_POLICY,
  DEFAULT_QUOTATION_VALIDITY_DAYS,
  DEFAULT_TAX_CODES,
  DOCUMENT_KINDS,
  DOCUMENT_REVISION_STATES,
  QUOTATION_LINE_CATEGORIES,
  QUOTATION_STATES,
  TECHNICAL_REVIEW_STATES,
  checkConfiguration,
  computeQuotation,
  documentRevisionMachine,
  evaluateDiscountAuthority,
  quotationMachine,
  technicalReviewMachine,
  type QuotationLineInput,
  ORDER_STATES,
  PROJECT_STATES,
  PAYMENT_STATES,
  MATERIAL_STATES,
  PURCHASE_REQUEST_STATES,
  PURCHASE_ORDER_STATES,
  DEFAULT_MILESTONE_TEMPLATES,
  DEFAULT_PO_APPROVAL_LIMIT_PAISE,
  orderMachine,
  projectMachine,
  paymentMachine,
  materialLineMachine,
  bomMachine,
  purchaseRequestMachine,
  purchaseOrderMachine,
  allocate,
  computePurchaseOrder,
  PARTNER_STATES,
  ASSIGNMENT_STATES,
  TASK_STATES,
  partnerMachine,
  assignmentMachine,
  taskMachine,
  DEFAULT_PARTNER_REQUIREMENTS,
  DEFAULT_TASK_TEMPLATE,
  DEFAULT_SAFETY_CHECKS,
  SITE_READINESS_ITEMS,
  evaluatePartnerCompliance,
  evaluateSiteReadiness,
  evaluateSafetyPreStart,
  safetyChecksFromAnswers,
  requirementsForProject,
  DEFECT_STATES,
  HANDOVER_STATES,
  WARRANTY_STATES,
  defectMachine,
  handoverMachine,
  warrantyMachine,
  DEFAULT_QA_CHECKLISTS,
  DEFAULT_STATUTORY_REQUIRED,
  DEFAULT_HANDOVER_DOCUMENTS,
  DEFAULT_WARRANTY_TERMS,
  evaluateInspection,
  warrantyPeriod,
} from '@aiec/domain';
import { admin, makePool } from '../src/db';

/** The database and the shared domain package must never drift apart. */
const pool = makePool();
afterAll(() => pool.end());

const enumLabels = async (type: string) =>
  (await admin<{ l: string }>(pool, `select unnest(enum_range(null::public.${type}))::text as l`)).map((r) => r.l);

describe('DB ↔ domain parity', () => {
  it('permission catalogue', async () => {
    const rows = await admin<{ code: string; description: string }>(pool, 'select code, description from public.permissions order by code');
    expect(Object.fromEntries(rows.map((r) => [r.code, r.description]))).toEqual(PERMISSIONS);
  });

  it('roles, allowed organization kinds and role → permission matrix', async () => {
    expect((await admin<{ code: string }>(pool, 'select code from public.roles order by code')).map((r) => r.code)).toEqual([...ROLE_CODES].sort());
    const kinds = await admin<{ role_code: string; org_kind: string }>(pool, 'select role_code, org_kind::text from public.role_org_kinds');
    for (const role of ROLE_CODES) {
      expect(kinds.filter((k) => k.role_code === role).map((k) => k.org_kind).sort()).toEqual([...ROLE_ORG_KINDS[role]].sort());
    }
    const perms = await admin<{ role_code: string; permission_code: string }>(pool, 'select role_code, permission_code from public.role_permissions');
    for (const role of ROLE_CODES) {
      expect(perms.filter((p) => p.role_code === role).map((p) => p.permission_code).sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('enumerations', async () => {
    expect(await enumLabels('org_kind')).toEqual([...ORGANIZATION_KINDS]);
    expect(await enumLabels('lead_state')).toEqual([...LEAD_STATES]);
    expect(await enumLabels('survey_state')).toEqual([...SURVEY_STATES]);
    expect(await enumLabels('lost_reason')).toEqual([...LOST_REASONS]);
    expect(await enumLabels('call_outcome')).toEqual([...CALL_OUTCOMES]);
    expect(await enumLabels('technical_review_state')).toEqual([...TECHNICAL_REVIEW_STATES]);
    expect(await enumLabels('document_revision_state')).toEqual([...DOCUMENT_REVISION_STATES]);
    expect(await enumLabels('document_kind')).toEqual([...DOCUMENT_KINDS]);
    expect(await enumLabels('quotation_state')).toEqual([...QUOTATION_STATES]);
    expect(await enumLabels('quotation_line_category')).toEqual([...QUOTATION_LINE_CATEGORIES]);
    expect(await enumLabels('order_state')).toEqual([...ORDER_STATES]);
    expect(await enumLabels('project_state')).toEqual([...PROJECT_STATES]);
    expect(await enumLabels('payment_state')).toEqual([...PAYMENT_STATES]);
    expect(await enumLabels('material_state')).toEqual([...MATERIAL_STATES]);
    expect(await enumLabels('purchase_request_state')).toEqual([...PURCHASE_REQUEST_STATES]);
    expect(await enumLabels('purchase_order_state')).toEqual([...PURCHASE_ORDER_STATES]);
    expect(await enumLabels('partner_state')).toEqual([...PARTNER_STATES]);
    expect(await enumLabels('assignment_state')).toEqual([...ASSIGNMENT_STATES]);
    expect(await enumLabels('task_state')).toEqual([...TASK_STATES]);
    expect(await enumLabels('defect_state')).toEqual([...DEFECT_STATES]);
    expect(await enumLabels('handover_state')).toEqual([...HANDOVER_STATES]);
    expect(await enumLabels('warranty_state')).toEqual([...WARRANTY_STATES]);
  });

  it('state transition tables equal the domain machines', async () => {
    const rows = await admin<{ machine: string; from_state: string; action: string; to_state: string; permission_code: string; requires_reason: boolean; audit_event: string }>(
      pool,
      'select machine, from_state, action, to_state, permission_code, requires_reason, audit_event from public.state_transitions',
    );
    for (const m of [leadMachine, surveyMachine, technicalReviewMachine, documentRevisionMachine, quotationMachine, orderMachine, projectMachine, paymentMachine, materialLineMachine, bomMachine, purchaseRequestMachine, purchaseOrderMachine, partnerMachine, assignmentMachine, taskMachine, defectMachine, handoverMachine, warrantyMachine] as const) {
      const expected = m.transitions
        .flatMap((t) => t.from.map((f) => `${f}|${t.action}|${t.to}|${t.permission}|${!!t.requiresReason}|${t.auditEvent}`))
        .sort();
      const actual = rows
        .filter((r) => r.machine === m.name)
        .map((r) => `${r.from_state}|${r.action}|${r.to_state}|${r.permission_code}|${r.requires_reason}|${r.audit_event}`)
        .sort();
      expect(actual).toEqual(expected);
    }
  });

  it('seeded survey requirements and lead scoring equal the domain defaults', async () => {
    const [req] = await admin<{ v: unknown }>(pool, `select app.rule('survey.requirements') as v`);
    expect(req!.v).toEqual(DEFAULT_SURVEY_REQUIREMENTS);
    const [scoring] = await admin<{ v: unknown }>(pool, `select app.rule('lead.scoring') as v`);
    expect(scoring!.v).toEqual(DEFAULT_LEAD_SCORING);
    const q = { need: 'New lift', decision_authority: 'confirmed', timeline: 'within_3_months', site_readiness: 'ready', number_of_lifts: 2 };
    const [db] = await admin<{ v: { score: number; explanation: unknown } }>(pool, 'select app.score_lead($1) as v', [q]);
    expect(db!.v).toEqual(scoreLead(q));
  });

  it('phone normalization', async () => {
    for (const input of ['+91 98765 43210', '098765-43210', '919876543210', '9876543210', '+1 415 555 0100', '12345', '0123456789', '+91 12345', '']) {
      const [row] = await admin<{ v: string | null }>(pool, 'select app.normalize_phone($1) as v', [input]);
      expect(row!.v, input).toBe(normalizePhone(input));
    }
  });

  it('seeded Slice 3 rules equal the domain defaults', async () => {
    const rule = async (k: string) => (await admin<{ v: any }>(pool, 'select app.rule($1) as v', [k]))[0]!.v;
    expect(await rule('technical.configuration_catalogue')).toEqual(DEFAULT_CONFIGURATION_CATALOGUE);
    expect(await rule('commercial.tax_codes')).toEqual({ codes: DEFAULT_TAX_CODES });
    expect(await rule('quotation.discount_policy')).toEqual(DEFAULT_DISCOUNT_POLICY);
    expect(await rule('quotation.validity')).toEqual({ days: DEFAULT_QUOTATION_VALIDITY_DAYS });
  });

  it('configuration check (Gate 2) gives the same failures and warnings', async () => {
    const full = {
      rated_load_kg: 544, persons: 8, rated_speed_mps: 1, floors: 5, stops: 5, travel_mm: 12000, drive_type: 'traction_mrl', machine_room: 'mrl',
      car_width_mm: 1100, car_depth_mm: 1400, car_height_mm: 2200, shaft_width_mm: 1700, shaft_depth_mm: 1800, pit_depth_mm: 1400, overhead_mm: 3600,
      door_type: 'centre_opening', door_width_mm: 800, door_height_mm: 2000, power_supply: 'three_phase_415v', manufacturer: 'X', model: 'Y',
    };
    const cases: [string | null, Record<string, string | number | null>, Record<string, number>, number][] = [
      ['passenger', full, {}, 0],
      [null, full, {}, 0],
      ['escalator', {}, {}, 0],
      ['passenger', {}, {}, 0],
      ['goods', { ...full, persons: null, door_type: 'sliding', zz_extra: 1, aa_extra: 'x', car_height_mm: '900', travel_mm: '12 m', model: ' ' }, {}, 0],
      ['hospital', { ...full, shaft_width_mm: '1900.5', overhead_mm: 4000, rated_speed_mps: '1.5' }, { shaft_width: 1800, shaft_depth: 1900, overhead: 3600 }, 2],
      ['home', { ...full, controller: 'x'.repeat(501), manufacturer: null }, { pit_depth: 1000 }, 0],
    ];
    for (const [category, values, surveyMm, constraints] of cases) {
      const [row] = await admin<{ v: unknown }>(pool, 'select app.configuration_check($1, $2, $3, $4) as v', [category, values, surveyMm, constraints]);
      expect(row!.v, JSON.stringify([category, values])).toEqual(checkConfiguration(category, values, { surveyMm, openConstraints: constraints }));
    }
  });

  it('quotation economics and discount authority give identical results in SQL and in the domain', async () => {
    const cats = ['lift_equipment', 'installation', 'door_system', 'other_charge'] as const;
    const codes = [{ code: 'GST18', rateBps: 1800 }, { code: 'GST5', rateBps: 500 }, { code: 'NIL', rateBps: 0 }];
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let trial = 0; trial < 40; trial++) {
      const lines: QuotationLineInput[] = Array.from({ length: 1 + rnd(5) }, () => ({
        category: cats[rnd(cats.length)]!, description: 'x', unit: 'nos',
        quantityMilli: 1 + rnd(25000), ratePaise: BigInt(rnd(2_000_000_000)) * BigInt(1 + rnd(7)), discountBps: rnd(4) === 0 ? rnd(10001) : rnd(800),
        taxCode: codes[rnd(codes.length)]!, estimatedUnitCostPaise: rnd(5) === 0 ? undefined : BigInt(rnd(1_500_000_000)),
      }));
      const expected = computeQuotation(lines);
      const json = JSON.parse(JSON.stringify(expected, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      const input = lines.map((l) => ({ ...l, ratePaise: l.ratePaise.toString(), estimatedUnitCostPaise: l.estimatedUnitCostPaise?.toString() ?? null }));
      const [row] = await admin<{ t: any; e: any }>(pool, 'select app.compute_quotation($1) as t, app.evaluate_discount(app.compute_quotation($1), $2) as e', [JSON.stringify(input), DEFAULT_DISCOUNT_POLICY]);
      expect(row!.t).toEqual(json);
      expect(row!.e).toEqual(evaluateDiscountAuthority(expected, DEFAULT_DISCOUNT_POLICY));
    }
  });

  it('Slice 4 rules, milestone allocation and purchase-order maths equal the domain', async () => {
    const rule = async (k: string) => (await admin<{ v: any }>(pool, 'select app.rule($1) as v', [k]))[0]!.v;
    expect(await rule('payment.milestone_templates')).toEqual({ templates: DEFAULT_MILESTONE_TEMPLATES });
    expect(await rule('procurement.po_approval_limit')).toEqual({ limitPaise: DEFAULT_PO_APPROVAL_LIMIT_PAISE.toString() });
    let seed = 11;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 40; i++) {
      const weights = Array.from({ length: 1 + rnd(6) }, () => 1 + rnd(5000));
      const total = BigInt(rnd(2_000_000_000)) * BigInt(1 + rnd(50));
      const [row] = await admin<{ v: string[] }>(pool, 'select app.allocate($1::numeric, $2::integer[])::text[] as v', [total.toString(), weights]);
      expect(row!.v.map(BigInt), JSON.stringify([total.toString(), weights])).toEqual(allocate(total, weights));
      const lines = Array.from({ length: 1 + rnd(5) }, () => ({ quantityMilli: 1 + rnd(50000), ratePaise: BigInt(rnd(900_000_000)), taxRateBps: [0, 500, 1200, 1800, 2800][rnd(5)]! }));
      const freight = BigInt(rnd(5_000_000));
      const expected = JSON.parse(JSON.stringify(computePurchaseOrder(lines, freight), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      const [po] = await admin<{ v: unknown }>(pool, 'select app.compute_purchase_order($1, $2) as v', [JSON.stringify(lines.map((l) => ({ ...l, ratePaise: l.ratePaise.toString() }))), freight.toString()]);
      expect(po!.v).toEqual(expected);
    }
  });

  it('Slice 5 rules, Gate 7 compliance, Gate 8 site readiness and the safety pre-start equal the domain', async () => {
    const rule = async (k: string) => (await admin<{ v: any }>(pool, 'select app.rule($1) as v', [k]))[0]!.v;
    expect(await rule('partner.document_requirements')).toEqual({ documents: DEFAULT_PARTNER_REQUIREMENTS });
    expect(await rule('execution.task_template')).toEqual({ tasks: DEFAULT_TASK_TEMPLATE });
    expect(await rule('execution.safety_checks')).toEqual({ checks: DEFAULT_SAFETY_CHECKS });
    expect(await rule('execution.site_readiness_items')).toEqual({ items: SITE_READINESS_ITEMS });
    let seed = 23;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const types = ['contractor_licence', 'insurance', 'pan', 'bank_verification', 'gst_registration'];
    const ver = ['pending', 'verified', 'rejected'] as const;
    const dates = [null, '2026-01-01', '2026-11-06', '2026-11-07', '2027-05-01'];
    const scopes = [[], ['passenger'], ['goods'], ['passenger', 'goods'], ['hospital', 'home']];
    for (let i = 0; i < 60; i++) {
      const docs = Array.from({ length: rnd(7) }, () => ({ type: types[rnd(types.length)]!, verification: ver[rnd(3)]!, expiresOn: dates[rnd(dates.length)]!, scope: scopes[rnd(scopes.length)]! }));
      const cat = [null, 'passenger', 'goods', 'hospital'][rnd(4)] ?? null;
      const reqs = requirementsForProject(DEFAULT_PARTNER_REQUIREMENTS, cat);
      const expected = evaluatePartnerCompliance(docs, reqs, '2026-11-07').map((fl) => { const [type, reason] = fl.message.split(': '); return { type, reason }; });
      const [row] = await admin<{ v: unknown; r: unknown }>(pool, `select app.evaluate_partner_compliance($1, $2, '2026-11-07'::date) as v, app.partner_requirements($3) as r`, [JSON.stringify(docs), JSON.stringify(reqs), cat]);
      expect(row!.v, JSON.stringify({ docs, cat })).toEqual(expected);
      expect(row!.r).toEqual(reqs);
      // Site readiness: random answers over the catalogue (some missing, some N/A with or without a reason).
      const results = ['pass', 'pass', 'pass', 'fail', 'not_applicable', 'awaiting_evidence'] as const;
      const items = SITE_READINESS_ITEMS.filter(() => rnd(10) > 0).map((it) => {
        const result = results[rnd(results.length)]!;
        return { key: it.key, group: it.group, result, note: result === 'not_applicable' && rnd(2) ? 'Not needed on this site' : null };
      });
      const dom = evaluateSiteReadiness(items);
      const [sr] = await admin<{ v: { passed: boolean; failures: { code: string; key: string }[] } }>(pool, 'select app.evaluate_site_readiness($1) as v', [JSON.stringify(items)]);
      expect(sr!.v.passed).toBe(dom.passed);
      expect(sr!.v.failures.map((x) => `${x.code}:${x.key}`)).toEqual(dom.failures.map((x) => `${x.code}:${(x.fields ?? x.missing)![0]}`));
      // Safety pre-start: the recorded can_start equals the domain.
      const answers = Object.fromEntries(DEFAULT_SAFETY_CHECKS.filter(() => rnd(8) > 0).map((c) => [c.key, { applicable: rnd(6) > 0, confirmed: rnd(4) > 0 }]));
      const ds = evaluateSafetyPreStart(safetyChecksFromAnswers(answers));
      const [sc] = await admin<{ v: { criticalFailures: string[]; warnings: string[] } }>(pool, 'select app.evaluate_safety_check($1) as v', [JSON.stringify(answers)]);
      expect(sc!.v).toEqual({ criticalFailures: ds.criticalFailures, warnings: ds.warnings });
    }
  });

  it('Slice 6 rules, inspection outcomes and warranty dates equal the domain', async () => {
    const rule = async (k: string) => (await admin<{ v: any }>(pool, 'select app.rule($1) as v', [k]))[0]!.v;
    expect(await rule('qa.checklists')).toEqual({ checklists: DEFAULT_QA_CHECKLISTS });
    expect(await rule('statutory.required_evidence')).toEqual({ types: DEFAULT_STATUTORY_REQUIRED });
    expect(await rule('handover.required_documents')).toEqual({ documents: DEFAULT_HANDOVER_DOCUMENTS });
    expect(await rule('warranty.terms')).toEqual(DEFAULT_WARRANTY_TERMS);
    let seed = 31;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const keys = Object.keys(DEFAULT_QA_CHECKLISTS);
    const results = ['pass', 'pass', 'pass', 'fail', 'hold', 'not_applicable', 'bogus'];
    for (let i = 0; i < 60; i++) {
      const criteria = DEFAULT_QA_CHECKLISTS[keys[rnd(keys.length)]!]!;
      const answers = Object.fromEntries(criteria.filter(() => rnd(12) > 0).map((c) => [c.key, { result: results[rnd(results.length)], note: rnd(2) ? 'Reason given' : null }]));
      const dom = evaluateInspection(criteria, answers as never);
      const [row] = await admin<{ v: { outcome: string | null; problems: { code: string; key: string }[]; failed: string[]; held: string[] } }>(pool, 'select app.evaluate_inspection($1, $2) as v', [JSON.stringify(criteria), JSON.stringify(answers)]);
      expect(row!.v.outcome, JSON.stringify(answers)).toBe(dom.outcome);
      expect(row!.v.problems.map((x) => `${x.code}:${x.key}`)).toEqual(dom.problems.map((x) => `${x.code}:${x.fields![0]}`));
      expect(row!.v.failed).toEqual(dom.failed);
      expect(row!.v.held).toEqual(dom.held);
      const start = new Date(Date.UTC(2024 + rnd(4), rnd(12), 1 + rnd(31))).toISOString().slice(0, 10);
      const months = 1 + rnd(60);
      const [w] = await admin<{ e: string }>(pool, 'select app.warranty_end($1::date, $2)::text as e', [start, months]);
      expect(w!.e, `${start} + ${months}`).toBe(warrantyPeriod(start, months).end);
    }
  });
});

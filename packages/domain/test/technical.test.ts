import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIGURATION_CATALOGUE,
  PERMISSIONS,
  QUOTATION_TERM_KEYS,
  checkConfiguration,
  documentRevisionMachine,
  missingQuotationTerms,
  quotationMachine,
  technicalReviewMachine,
  transition,
  type PermissionCode,
} from '../src';

const PASSENGER = {
  rated_load_kg: 544, persons: 8, rated_speed_mps: 1, floors: 5, stops: 5, travel_mm: 12000,
  drive_type: 'traction_mrl', machine_room: 'mrl', car_width_mm: 1100, car_depth_mm: 1400, car_height_mm: 2200,
  shaft_width_mm: 1700, shaft_depth_mm: 1800, pit_depth_mm: 1400, overhead_mm: 3600,
  door_type: 'centre_opening', door_width_mm: 800, door_height_mm: 2000, power_supply: 'three_phase_415v',
  manufacturer: 'Example Lifts', model: 'MRL-8',
};
const perms = (...p: PermissionCode[]) => new Set<PermissionCode>(p);

describe('configuration catalogue (TE03, Gate 2)', () => {
  it('every catalogue parameter is unique, typed and only required for known categories', () => {
    const keys = DEFAULT_CONFIGURATION_CATALOGUE.parameters.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of DEFAULT_CONFIGURATION_CATALOGUE.parameters) {
      expect(['number', 'text', 'choice']).toContain(p.kind);
      if (p.kind === 'choice') expect(p.choices!.length).toBeGreaterThan(1);
      for (const c of p.requiredFor) expect(DEFAULT_CONFIGURATION_CATALOGUE.categories).toContain(c);
    }
  });

  it('a complete passenger configuration passes; category is mandatory', () => {
    expect(checkConfiguration('passenger', PASSENGER)).toEqual({ failures: [], warnings: [] });
    expect(checkConfiguration(null, PASSENGER).failures[0]).toMatchObject({ code: 'REQUIRED_FIELD_MISSING', fields: ['lift_category'] });
    expect(checkConfiguration('escalator', PASSENGER).failures[0]!.fields).toEqual(['lift_category']);
  });

  it('reports missing required, out-of-range, unknown and wrong-choice parameters', () => {
    const { persons, rated_speed_mps, ...rest } = PASSENGER;
    void persons;
    void rated_speed_mps;
    const r = checkConfiguration('passenger', { ...rest, door_type: 'sliding', car_height_mm: 900, price: 5 });
    expect(r.failures).toEqual([
      expect.objectContaining({ code: 'REQUIRED_FIELD_MISSING', fields: ['config.persons', 'config.rated_speed_mps'] }),
      expect.objectContaining({ code: 'VALIDATION_FAILED', fields: ['config.price', 'config.car_height_mm', 'config.door_type'] }),
    ]);
    // Persons is optional for goods lifts.
    const { persons: _p, ...goods } = PASSENGER;
    void _p;
    expect(checkConfiguration('goods', goods).failures).toEqual([]);
    // Numbers typed as text are accepted when numeric.
    expect(checkConfiguration('passenger', { ...PASSENGER, travel_mm: '12000' }).failures).toEqual([]);
    expect(checkConfiguration('passenger', { ...PASSENGER, travel_mm: '12 m' }).failures[0]!.fields).toEqual(['config.travel_mm']);
  });

  it('warns (never blocks) on missing manufacturer data, open constraints and dimensions larger than surveyed', () => {
    const { manufacturer: _m, ...noMaker } = PASSENGER;
    void _m;
    const r = checkConfiguration('passenger', { ...noMaker, shaft_width_mm: 1900 }, { surveyMm: { shaft_width: 1800, shaft_depth: 1900 }, openConstraints: 2 });
    expect(r.failures).toEqual([]);
    expect(r.warnings.map((w) => w.key)).toEqual(['manufacturer', 'constraints', 'shaft_width_mm']);
    expect(r.warnings[2]!.params).toEqual({ parameter: 'shaft_width_mm', value: 1900, surveyed: 1800 });
  });
});

describe('technical review machine (Gate 2)', () => {
  const tech = perms('technical.review');
  it('a decision needs a submitted survey and a technical basis; conditional needs constraints and actions', () => {
    expect(transition(technicalReviewMachine, 'in_review', { action: 'decide_feasible', actorPermissions: tech, context: { surveySubmitted: false, technicalBasis: 'x' } }).ok).toBe(false);
    expect(transition(technicalReviewMachine, 'in_review', { action: 'decide_feasible', actorPermissions: tech, context: { surveySubmitted: true, technicalBasis: '' } }).ok).toBe(false);
    expect(transition(technicalReviewMachine, 'in_review', { action: 'decide_feasible', actorPermissions: tech, context: { surveySubmitted: true, technicalBasis: 'Site measurements fit MRL' } }).ok).toBe(true);
    const c = transition(technicalReviewMachine, 'in_review', { action: 'decide_conditional', actorPermissions: tech, context: { surveySubmitted: true, technicalBasis: 'ok', constraints: [] } });
    expect(c.ok).toBe(false);
    expect(transition(technicalReviewMachine, 'in_review', { action: 'decide_conditional', actorPermissions: tech, context: { surveySubmitted: true, technicalBasis: 'ok', constraints: ['Pit to be deepened'], correctiveActions: ['Builder to deepen pit by 200 mm'] } }).ok).toBe(true);
    expect(transition(technicalReviewMachine, 'in_review', { action: 'decide_not_feasible', actorPermissions: tech, context: { surveySubmitted: true, technicalBasis: 'ok' } }).ok).toBe(false); // needs reason
    expect(transition(technicalReviewMachine, 'in_review', { action: 'decide_feasible', actorPermissions: perms('survey.review'), context: { surveySubmitted: true, technicalBasis: 'ok' } }).ok).toBe(false);
  });
});

describe('document revisions (TE04)', () => {
  it('approval binds to the exact file checksum; rejection needs a reason; only reviewers decide', () => {
    const approver = perms('technical.drawing.approve');
    const sha = 'a'.repeat(64);
    expect(transition(documentRevisionMachine, 'in_review', { action: 'approve', actorPermissions: approver, context: { reviewedSha256: sha, storedSha256: sha } }).ok).toBe(true);
    const changed = transition(documentRevisionMachine, 'in_review', { action: 'approve', actorPermissions: approver, context: { reviewedSha256: sha, storedSha256: 'b'.repeat(64) } });
    expect(!changed.ok && changed.error.code).toBe('REVISION_CONFLICT');
    expect(transition(documentRevisionMachine, 'in_review', { action: 'reject', actorPermissions: approver, context: {} }).ok).toBe(false);
    expect(transition(documentRevisionMachine, 'in_review', { action: 'reject', actorPermissions: approver, reason: 'Wrong pit depth', context: {} }).ok).toBe(true);
    expect(transition(documentRevisionMachine, 'in_review', { action: 'approve', actorPermissions: perms('technical.review'), context: { reviewedSha256: sha, storedSha256: sha } }).ok).toBe(false);
    for (const t of documentRevisionMachine.transitions) expect(Object.keys(PERMISSIONS)).toContain(t.permission);
  });
});

describe('quotation terms and staff-recorded acceptance (§7.8, §16.4)', () => {
  it('lists every missing term', () => {
    expect(missingQuotationTerms({})).toEqual([...QUOTATION_TERM_KEYS]);
    const all = Object.fromEntries(QUOTATION_TERM_KEYS.map((k) => [k, 'Stated clearly']));
    expect(missingQuotationTerms(all)).toEqual([]);
    expect(missingQuotationTerms({ ...all, exclusions: ' ' })).toEqual(['exclusions']);
  });

  it('recording an acceptance needs who accepted, their authority and evidence, within validity', () => {
    const sales = perms('quotation.issue');
    const future = new Date(Date.now() + 864e5).toISOString();
    const base = { validUntil: future, now: new Date().toISOString() };
    const missing = transition(quotationMachine, 'issued', { action: 'record_acceptance', actorPermissions: sales, context: { ...base, acceptedByName: 'Mr. Rao' } });
    expect(!missing.ok && missing.error.code).toBe('REQUIRED_FIELD_MISSING');
    const full = { ...base, acceptedByName: 'Mr. Rao', acceptorAuthority: 'Society secretary', acceptanceEvidence: 'Signed copy received' };
    expect(transition(quotationMachine, 'issued', { action: 'record_acceptance', actorPermissions: sales, context: full }).ok).toBe(true);
    const expired = transition(quotationMachine, 'issued', { action: 'record_acceptance', actorPermissions: sales, context: { ...full, validUntil: '2020-01-01T00:00:00Z' } });
    expect(!expired.ok && expired.error.code).toBe('APPROVAL_EXPIRED');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURVEY_REQUIREMENTS,
  classifyGps,
  cityCode,
  findPossibleDuplicates,
  formatBusinessId,
  formatPhone,
  haversineMetres,
  measurement,
  normalizeEmail,
  normalizePhone,
  parseBusinessId,
  similarity,
  toMillimetres,
  validateSurveySubmission,
  type SurveyRevisionData,
} from '../src';

describe('phone / email normalization', () => {
  it.each([
    ['+91 98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['9876543210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
    ['+1 415 555 0100', '+14155550100'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(['12345', '0123456789', '+91 12345', '', '   '])('rejects %j', (bad) => expect(normalizePhone(bad)).toBeNull());

  it('formats and normalizes email', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(normalizeEmail('  Ravi@Example.COM ')).toBe('ravi@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });
});

describe('business identifiers', () => {
  it('formats the spec example and parses it back', () => {
    expect(formatBusinessId('project', 'PUN', 2026, 125)).toBe('AIEC-PUN-2026-00125');
    expect(parseBusinessId('AIEC-PUN-2026-00125')).toEqual({ entity: 'project', city: 'PUN', year: 2026, sequence: 125 });
    expect(formatBusinessId('lead', cityCode('PCMC'), 2026, 1)).toBe('LD-PCM-2026-00001');
    expect(parseBusinessId('XX-PUN-2026-00001')).toBeNull();
    expect(() => formatBusinessId('lead', 'PUN', 2026, 0)).toThrow();
    expect(() => formatBusinessId('lead', 'pun', 2026, 1)).toThrow();
  });
});

describe('measurements', () => {
  it('normalizes to mm and keeps the entered value and unit', () => {
    expect(toMillimetres(1.1, 'm')).toBe(1100);
    expect(toMillimetres(165.5, 'cm')).toBe(1655);
    expect(measurement('pit_depth', 1.45, 'm')).toEqual({ key: 'pit_depth', value_mm: 1450, entered_value: 1.45, entered_unit: 'm', level_label: null });
    expect(() => toMillimetres(-1, 'mm')).toThrow();
    expect(() => toMillimetres(Number.NaN, 'mm')).toThrow();
  });
});

describe('survey submission validation (Gate 1)', () => {
  const data: SurveyRevisionData = {
    building: { usage: 'residential', floors: 5, stops: 5, construction_stage: 'structure_complete' },
    shaft: { access_conditions: 'clear' },
    machine_room: { availability: 'mrl' },
    electrical: { supply_type: 'permanent', phase: 'three' },
    logistics: { material_access_route: 'main gate', safety_hazards: 'open edges at 3F' },
    documents_unavailable: {
      doc_structural_drawing: 'Builder will share next week',
      doc_electrical_drawing: 'Not yet prepared by consultant',
    },
  };
  const measurements = [
    measurement('shaft_width', 1800, 'mm'),
    measurement('shaft_depth', 1.9, 'm'),
    measurement('pit_depth', 1500, 'mm'),
    measurement('overhead', 3600, 'mm'),
    measurement('entrance_width', 900, 'mm'),
    measurement('entrance_height', 2100, 'mm'),
  ];
  const evidence = [
    ...DEFAULT_SURVEY_REQUIREMENTS.required_evidence.map((category) => ({ category })),
    { category: 'doc_architectural_drawing' },
    { category: 'doc_shaft_layout' },
  ];

  it('passes when complete (unavailable documents explained)', () => {
    const r = validateSurveySubmission(data, measurements, evidence);
    expect(r.failures).toEqual([]);
    expect(r.completion.done).toBe(r.completion.total);
  });

  it('lists exactly what is missing', () => {
    const r = validateSurveySubmission({ ...data, building: { usage: '', floors: 5, stops: 5 }, documents_unavailable: { doc_structural_drawing: 'x' } }, measurements.slice(1), evidence.filter((e) => e.category !== 'pit'));
    expect(r.failures.map((f) => f.code)).toEqual(['REQUIRED_FIELD_MISSING', 'REQUIRED_FIELD_MISSING', 'EVIDENCE_REQUIRED', 'EVIDENCE_REQUIRED']);
    expect(r.failures[0]!.fields).toEqual(['building.usage', 'building.construction_stage']);
    expect(r.failures[1]!.fields).toEqual(['measurement.shaft_width']);
    expect(r.failures[2]!.missing).toEqual(['pit']);
    // "x" is too short to count as a reason.
    expect(r.failures[3]!.missing).toEqual(['doc_structural_drawing', 'doc_electrical_drawing']);
  });

  it('superseded evidence does not satisfy a requirement', () => {
    const r = validateSurveySubmission(data, measurements, evidence.map((e) => (e.category === 'pit' ? { ...e, superseded: true } : e)));
    expect(r.failures[0]!.missing).toEqual(['pit']);
  });

  it('flags implausible values as warnings, not failures', () => {
    const r = validateSurveySubmission(data, [...measurements.slice(0, 2), measurement('pit_depth', 15, 'm'), ...measurements.slice(3)], evidence);
    expect(r.failures).toEqual([]);
    expect(r.warnings.map((w) => w.key)).toEqual(['pit_depth']);
  });
});

describe('GPS classification', () => {
  it('never marks GPS as verified without permission and adequate accuracy', () => {
    expect(classifyGps({ permission: 'denied', latitude: 18.5, longitude: 73.8, accuracyM: 5 })).toBe('permission_denied');
    expect(classifyGps({ permission: 'granted', latitude: null, longitude: null, accuracyM: null })).toBe('unavailable');
    expect(classifyGps({ permission: 'granted', latitude: 18.5, longitude: 73.8, accuracyM: 120 })).toBe('low_accuracy');
    expect(classifyGps({ permission: 'granted', latitude: 18.5, longitude: 73.8, accuracyM: 12 })).toBe('verified');
    expect(classifyGps({ permission: 'granted', latitude: 95, longitude: 73.8, accuracyM: 12 })).toBe('unavailable');
  });
});

describe('duplicate detection', () => {
  it('matches pg_trgm similarity for simple cases', () => {
    expect(similarity('word', 'word')).toBe(1);
    expect(similarity('', 'abc')).toBe(0);
    // Reference values computed with PostgreSQL 16 pg_trgm similarity().
    expect(similarity('Sunrise Heights', 'Sunrise Height')).toBeCloseTo(0.8235294, 6);
    expect(similarity('Shree Ganesh Apts', 'Shri Ganesh Apartments')).toBeCloseTo(0.4642857, 6);
  });

  it('computes distances', () => {
    // ~111 m per 0.001° latitude
    expect(haversineMetres(18.5204, 73.8567, 18.5214, 73.8567)).toBeGreaterThan(110);
    expect(haversineMetres(18.5204, 73.8567, 18.5214, 73.8567)).toBeLessThan(112);
  });

  it('explains candidates and never auto-merges on location alone', () => {
    const records = [
      { id: 'a', phone: '+919876543210', projectName: 'Other' },
      { id: 'b', projectName: 'Sunrise Height', latitude: 18.5205, longitude: 73.8567 },
      { id: 'c', latitude: 18.5206, longitude: 73.8568 },
      { id: 'd', email: 'x@y.com', projectName: 'Totally different' },
    ];
    const matches = findPossibleDuplicates(
      { phone: '+919876543210', projectName: 'Sunrise Heights', latitude: 18.5204, longitude: 73.8567, email: 'no@match.com' },
      records,
    );
    expect(matches.map((m) => [m.id, m.level, m.reasons])).toEqual([
      ['a', 'strong', ['phone']],
      ['b', 'possible', ['project_name', 'site_proximity']],
      ['c', 'possible', ['site_proximity']],
    ]);
  });
});

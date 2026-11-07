import { describe, expect, it } from 'vitest';
import {
  CALL_OUTCOMES,
  DEFAULT_LOCALE,
  DEFAULT_SURVEY_REQUIREMENTS,
  ERROR_CODES,
  EVIDENCE_CATEGORIES,
  LEAD_STATES,
  LOST_REASONS,
  PERMISSION_CODES,
  DEFAULT_CONFIGURATION_CATALOGUE,
  DOCUMENT_KINDS,
  DOCUMENT_REVISION_STATES,
  LIFT_CATEGORIES,
  QUOTATION_LINE_CATEGORIES,
  QUOTATION_STATES,
  QUOTATION_TERM_KEYS,
  TECHNICAL_REVIEW_STATES,
  documentRevisionMachine,
  quotationMachine,
  technicalReviewMachine,
  PLAUSIBLE_RANGES_MM,
  ROLE_CODES,
  SURVEY_STATES,
  SYNC_STATUS_LABEL_KEYS,
  fieldLabel,
  formatDateIST,
  formatDateTimeIST,
  hasMessage,
  leadMachine,
  surveyMachine,
  t,
  translator,
  validateSurveySubmission,
} from '../src';
import { en } from '../src/messages/en';
import { mr } from '../src/messages/mr';

const DEVANAGARI = /[ऀ-ॿ]/;
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
/** Values that are legitimately identical in both languages (brand, units, product names, technical examples). */
const SAME_IN_BOTH = /^(AIEC|GPS|SMS|WhatsApp|mm|lead, survey…|\{name\} \(\{kind\}\)|GPS ±\{metres\} m)$/;

describe('Marathi dictionary', () => {
  it('Marathi is the default language', () => {
    expect(DEFAULT_LOCALE).toBe('mr');
  });

  it('has exactly the English keys', () => {
    expect(Object.keys(mr).sort()).toEqual(Object.keys(en).sort());
  });

  it('every value is non-empty Marathi (Devanagari), except brand/unit tokens', () => {
    // A pure template such as "({entity})" has no words of its own to translate.
    const wordless = (v: string) => !/[A-Za-z]/.test(v.replace(/\{\w+\}/g, ''));
    const notMarathi = Object.entries(mr).filter(([, v]) => !v.trim() || (!DEVANAGARI.test(v) && !SAME_IN_BOTH.test(v) && !wordless(v)));
    expect(notMarathi).toEqual([]);
  });

  it('keeps every {placeholder} of the English text', () => {
    const mismatched = (Object.keys(en) as (keyof typeof en)[]).filter((k) => params(en[k]).join() !== params(mr[k]).join());
    expect(mismatched).toEqual([]);
  });

  it('interpolates parameters and falls back to the key for unknown keys', () => {
    expect(t('home.welcome_name', 'mr', { name: 'Asha' })).toBe('स्वागत आहे, Asha');
    expect(t('home.welcome_name', 'en', { name: 'Asha' })).toBe('Welcome, Asha');
    expect(t('no.such.key', 'mr')).toBe('no.such.key');
    expect(translator('en')('nav.leads')).toBe('Leads');
  });
});

describe('every value the interface renders has a label in both languages', () => {
  const required: string[] = [
    ...LEAD_STATES.map((s) => `lead.state.${s}`),
    ...SURVEY_STATES.map((s) => `survey.state.${s}`),
    ...ROLE_CODES.map((r) => `role.${r}`),
    ...PERMISSION_CODES.map((p) => `permission.${p}`),
    ...LOST_REASONS.map((r) => `enum.lost_reason.${r}`),
    ...CALL_OUTCOMES.map((o) => `enum.call_outcome.${o}`),
    ...EVIDENCE_CATEGORIES.map((c) => `enum.evidence.${c}`),
    ...ERROR_CODES.flatMap((c) => [`error.${c}.title`, `error.${c}.next`]),
    ...Object.values(SYNC_STATUS_LABEL_KEYS),
    ...DEFAULT_SURVEY_REQUIREMENTS.required_fields.map((f) => `field.${f}`),
    ...DEFAULT_SURVEY_REQUIREMENTS.required_measurements.map((m) => `measure.${m}`),
    ...Object.keys(PLAUSIBLE_RANGES_MM).map((m) => `measure.${m}`),
    ...[...leadMachine.transitions, ...surveyMachine.transitions, ...technicalReviewMachine.transitions, ...documentRevisionMachine.transitions, ...quotationMachine.transitions].map((tr) => `action.${tr.action}`),
    ...TECHNICAL_REVIEW_STATES.map((s) => `technical.state.${s}`),
    ...DOCUMENT_REVISION_STATES.map((s) => `technical.document_state.${s}`),
    ...QUOTATION_STATES.map((s) => `quotation.state.${s}`),
    ...DOCUMENT_KINDS.map((k) => `enum.document_kind.${k}`),
    ...LIFT_CATEGORIES.map((c) => `enum.lift_category.${c}`),
    ...QUOTATION_LINE_CATEGORIES.map((c) => `enum.line_category.${c}`),
    ...QUOTATION_TERM_KEYS.map((k) => `field.terms.${k}`),
    ...DEFAULT_CONFIGURATION_CATALOGUE.parameters.map((p) => `field.config.${p.key}`),
    ...DEFAULT_CONFIGURATION_CATALOGUE.parameters.flatMap((p) => (p.choices ?? []).map((c) => `enum.config.${c}`)),
    ...['discount_above_authority', 'margin_below_floor', 'no_cost_basis'].map((r) => `enum.approval_reason.${r}`),
    ...['verified', 'low_accuracy', 'permission_denied', 'unavailable'].map((g) => `enum.gps.${g}`),
  ];
  it.each(required)('%s', (key) => {
    expect(hasMessage(key)).toBe(true);
    expect(DEVANAGARI.test(t(key, 'mr')) || SAME_IN_BOTH.test(t(key, 'mr'))).toBe(true);
  });

  it('server field paths resolve to labels (fields, measurements, documents)', () => {
    expect(fieldLabel('site.city', 'mr')).toBe('शहर');
    expect(fieldLabel('measurement.pit_depth', 'mr')).toBe('पिटची खोली');
    expect(fieldLabel('measurement.pit_depth', 'en')).toBe('Pit depth');
    expect(fieldLabel('doc_shaft_layout', 'en')).toBe('Document: shaft layout');
    expect(fieldLabel('assign', 'mr')).toBe('नेमून द्या');
    expect(fieldLabel('config.persons', 'en')).toBe('Persons');
    expect(fieldLabel('terms.exclusions', 'mr')).toBe('समाविष्ट नसलेल्या बाबी');
    expect(fieldLabel('lines.2.rate_paise', 'en')).toBe('Line 2: Rate');
    expect(fieldLabel('lines.3', 'mr')).toBe('ओळ 3');
  });

  it('Gate 1 failures and warnings carry translatable message keys', () => {
    const r = validateSurveySubmission({}, [{ key: 'pit_depth', value_mm: 10, entered_value: 1, entered_unit: 'cm' }], []);
    expect(r.failures.length).toBeGreaterThan(0);
    for (const f of r.failures) expect(f.messageKey && hasMessage(f.messageKey)).toBe(true);
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0]!;
    expect(t(w.messageKey, 'mr', { ...w.params, measure: t('measure.pit_depth', 'mr') })).toBe(
      'पिटची खोली = 10 mm हे नेहमीच्या 50–3000 mm मर्यादेबाहेर आहे; पुन्हा तपासा (हा अभियांत्रिकी निर्णय नाही)',
    );
  });
});

describe('dates', () => {
  const iso = '2026-11-06T05:00:00.000Z'; // 10:30 IST
  it('Marathi dates use Marathi month names with standard 0–9 digits', () => {
    const s = formatDateTimeIST(iso, 'mr');
    expect(s).toMatch(DEVANAGARI);
    expect(s).not.toMatch(/[०-९]/);
    expect(s).toContain('06');
    expect(s).toContain('10:30');
    expect(s).not.toMatch(/[A-Za-z]/); // no "AM"/"PM": Marathi names the part of the day
    expect(formatDateTimeIST('2026-11-06T13:00:00.000Z', 'mr')).toContain('6:30');
    expect(formatDateIST(iso, 'mr')).not.toMatch(/[०-९]/);
  });
  it('English dates stay English', () => {
    const s = formatDateTimeIST(iso, 'en');
    expect(s).toMatch(/Nov/);
    expect(s).toMatch(/10:30 am/i);
    expect(s).not.toMatch(DEVANAGARI);
  });
});

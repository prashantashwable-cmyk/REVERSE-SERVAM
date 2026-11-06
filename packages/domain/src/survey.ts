import type { GuardFailure } from './state-machine';

/**
 * Survey data capture & Gate 1 (survey completeness), spec §8.5–8.7, §38.
 * The database function app.survey_submission_failures() implements the same
 * checks server-side from the business rule `survey.requirements`.
 */

export const LENGTH_UNITS = ['mm', 'cm', 'm'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

const MM_PER_UNIT: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000 };

/** Convert to millimetres, rounded to 0.1 mm. Throws for non-finite / negative input. */
export function toMillimetres(value: number, unit: LengthUnit): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('measurement must be a non-negative finite number');
  return Math.round(value * MM_PER_UNIT[unit] * 10) / 10;
}

export interface SurveyMeasurement {
  key: string;
  /** Normalized value in millimetres. */
  value_mm: number;
  /** Original entered value and unit are preserved (§34.1). */
  entered_value: number;
  entered_unit: LengthUnit;
  level_label?: string | null;
  note?: string | null;
}

export function measurement(key: string, entered: number, unit: LengthUnit, level_label?: string): SurveyMeasurement {
  return { key, value_mm: toMillimetres(entered, unit), entered_value: entered, entered_unit: unit, level_label: level_label ?? null };
}

export interface SurveyRequirements {
  version: number;
  /** Dotted paths into the revision data, e.g. "building.usage". */
  required_fields: string[];
  required_measurements: string[];
  required_evidence: string[];
  /** Document evidence categories: attached OR marked unavailable with reason. */
  required_documents: string[];
}

/** Launch default — configurable via business rule `survey.requirements` (D-009). */
export const DEFAULT_SURVEY_REQUIREMENTS: SurveyRequirements = {
  version: 1,
  required_fields: [
    'building.usage',
    'building.floors',
    'building.stops',
    'building.construction_stage',
    'shaft.access_conditions',
    'machine_room.availability',
    'electrical.supply_type',
    'electrical.phase',
    'logistics.material_access_route',
    'logistics.safety_hazards',
  ],
  required_measurements: ['shaft_width', 'shaft_depth', 'pit_depth', 'overhead', 'entrance_width', 'entrance_height'],
  required_evidence: [
    'site_exterior',
    'shaft_full_view',
    'pit',
    'overhead',
    'landing_entrance',
    'electrical_supply_area',
    'access_route',
  ],
  required_documents: ['doc_architectural_drawing', 'doc_structural_drawing', 'doc_shaft_layout', 'doc_electrical_drawing'],
};

export const EVIDENCE_CATEGORIES = [
  'site_exterior',
  'shaft_full_view',
  'shaft_level',
  'pit',
  'overhead',
  'landing_entrance',
  'machine_room',
  'electrical_supply_area',
  'access_route',
  'check_in',
  'other',
  'doc_architectural_drawing',
  'doc_structural_drawing',
  'doc_shaft_layout',
  'doc_electrical_drawing',
  'doc_site_permission',
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

/** Plausibility ranges in mm. Warnings only — never an engineering approval (§38 SV04). */
export const PLAUSIBLE_RANGES_MM: Record<string, [number, number]> = {
  shaft_width: [800, 4000],
  shaft_depth: [800, 4000],
  pit_depth: [50, 3000],
  overhead: [2000, 6000],
  entrance_width: [600, 2000],
  entrance_height: [1800, 3000],
};

export interface SurveyRevisionData {
  [section: string]: unknown;
  /** Map of document category → reason it is unavailable. */
  documents_unavailable?: Record<string, string>;
  critical_unknowns?: string[];
}

export interface SurveyEvidenceRef {
  category: string;
  superseded?: boolean;
}

function readPath(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), data);
}

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === 'object';
}

export interface SurveyValidationResult {
  failures: GuardFailure[];
  warnings: { key: string; message: string }[];
  completion: { done: number; total: number };
}

/** Gate 1. Returns failures (blocking) and plausibility warnings (non-blocking). */
export function validateSurveySubmission(
  data: SurveyRevisionData,
  measurements: readonly SurveyMeasurement[],
  evidence: readonly SurveyEvidenceRef[],
  req: SurveyRequirements = DEFAULT_SURVEY_REQUIREMENTS,
): SurveyValidationResult {
  const missingFields = req.required_fields.filter((p) => !isPresent(readPath(data, p)));
  const byKey = new Map(measurements.map((m) => [m.key, m]));
  const missingMeasurements = req.required_measurements.filter((k) => {
    const m = byKey.get(k);
    return !m || !Number.isFinite(m.value_mm) || m.value_mm <= 0 || !LENGTH_UNITS.includes(m.entered_unit);
  });
  const liveCategories = new Set(evidence.filter((e) => !e.superseded).map((e) => e.category));
  const missingEvidence = req.required_evidence.filter((c) => !liveCategories.has(c));
  const unavailable = data.documents_unavailable ?? {};
  const missingDocuments = req.required_documents.filter(
    (d) => !liveCategories.has(d) && !(typeof unavailable[d] === 'string' && unavailable[d]!.trim().length >= 3),
  );

  const failures: GuardFailure[] = [];
  if (missingFields.length) failures.push({ code: 'REQUIRED_FIELD_MISSING', message: 'Required survey fields missing', fields: missingFields });
  if (missingMeasurements.length)
    failures.push({ code: 'REQUIRED_FIELD_MISSING', message: 'Required measurements missing', fields: missingMeasurements.map((k) => `measurement.${k}`) });
  if (missingEvidence.length) failures.push({ code: 'EVIDENCE_REQUIRED', message: 'Required photo evidence missing', missing: missingEvidence });
  if (missingDocuments.length)
    failures.push({ code: 'EVIDENCE_REQUIRED', message: 'Attach documents or mark them unavailable with a reason', missing: missingDocuments });

  const warnings = measurements.flatMap((m) => {
    const range = PLAUSIBLE_RANGES_MM[m.key];
    if (!range || (m.value_mm >= range[0] && m.value_mm <= range[1])) return [];
    return [{ key: m.key, message: `${m.key} = ${m.value_mm} mm is outside the usual ${range[0]}–${range[1]} mm range; re-check (not an engineering decision)` }];
  });

  const total = req.required_fields.length + req.required_measurements.length + req.required_evidence.length + req.required_documents.length;
  const missingCount = missingFields.length + missingMeasurements.length + missingEvidence.length + missingDocuments.length;
  return { failures, warnings, completion: { done: total - missingCount, total } };
}

/** GPS status classification for check-in (§8.4, §38 SV02). Never fabricate a location. */
export function classifyGps(input: {
  permission: 'granted' | 'denied' | 'undetermined';
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  maxAccuracyM?: number;
}): 'verified' | 'low_accuracy' | 'permission_denied' | 'unavailable' {
  if (input.permission !== 'granted') return 'permission_denied';
  const { latitude, longitude, accuracyM } = input;
  if (
    latitude === null || latitude === undefined || longitude === null || longitude === undefined ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 || Math.abs(longitude) > 180
  ) {
    return 'unavailable';
  }
  if (accuracyM === null || accuracyM === undefined || !Number.isFinite(accuracyM) || accuracyM < 0) return 'unavailable';
  return accuracyM <= (input.maxAccuracyM ?? 50) ? 'verified' : 'low_accuracy';
}

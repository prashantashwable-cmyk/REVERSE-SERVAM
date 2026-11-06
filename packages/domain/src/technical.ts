import { defineMachine, type GuardFailure } from './state-machine';

/**
 * Technical control (spec §9.5–9.6, TE03–TE04, Gate 2).
 *
 * The configuration catalogue lists which parameters are captured for each lift
 * category. It is configuration, not engineering: nothing here calculates or
 * approves an engineering value (§9.5 "do not calculate or auto-approve
 * engineering values without a validated calculation engine"). The database
 * function app.configuration_check() applies the same catalogue, seeded from
 * DEFAULT_CONFIGURATION_CATALOGUE as business rule `technical.configuration_catalogue`.
 */

export const LIFT_CATEGORIES = ['passenger', 'goods', 'hospital', 'home'] as const;
export type LiftCategory = (typeof LIFT_CATEGORIES)[number];

export const PARAMETER_STATUSES = ['proposed', 'reviewed', 'approved'] as const;
export type ParameterStatus = (typeof PARAMETER_STATUSES)[number];

export interface ConfigurationParameterDef {
  key: string;
  kind: 'number' | 'text' | 'choice';
  /** Display unit for numbers (values are stored as entered, in this unit). */
  unit?: string;
  choices?: string[];
  min?: number;
  max?: number;
  /** Categories that require the parameter; it is optional elsewhere. */
  requiredFor: LiftCategory[];
}

export interface ConfigurationCatalogue {
  version: number;
  categories: LiftCategory[];
  parameters: ConfigurationParameterDef[];
}

const ALL: LiftCategory[] = [...LIFT_CATEGORIES];

export const DEFAULT_CONFIGURATION_CATALOGUE: ConfigurationCatalogue = {
  version: 1,
  categories: ALL,
  parameters: [
    { key: 'rated_load_kg', kind: 'number', unit: 'kg', min: 50, max: 10000, requiredFor: ALL },
    { key: 'persons', kind: 'number', min: 1, max: 50, requiredFor: ['passenger', 'hospital', 'home'] },
    { key: 'rated_speed_mps', kind: 'number', unit: 'm/s', min: 0.1, max: 10, requiredFor: ALL },
    { key: 'floors', kind: 'number', min: 2, max: 200, requiredFor: ALL },
    { key: 'stops', kind: 'number', min: 2, max: 200, requiredFor: ALL },
    { key: 'travel_mm', kind: 'number', unit: 'mm', min: 1000, max: 500000, requiredFor: ALL },
    { key: 'drive_type', kind: 'choice', choices: ['traction_mrl', 'traction_machine_room', 'hydraulic'], requiredFor: ALL },
    { key: 'machine_room', kind: 'choice', choices: ['mrl', 'machine_room_top', 'machine_room_bottom'], requiredFor: ALL },
    { key: 'car_width_mm', kind: 'number', unit: 'mm', min: 500, max: 5000, requiredFor: ALL },
    { key: 'car_depth_mm', kind: 'number', unit: 'mm', min: 500, max: 6000, requiredFor: ALL },
    { key: 'car_height_mm', kind: 'number', unit: 'mm', min: 1800, max: 4000, requiredFor: ALL },
    { key: 'shaft_width_mm', kind: 'number', unit: 'mm', min: 700, max: 6000, requiredFor: ALL },
    { key: 'shaft_depth_mm', kind: 'number', unit: 'mm', min: 700, max: 7000, requiredFor: ALL },
    { key: 'pit_depth_mm', kind: 'number', unit: 'mm', min: 0, max: 5000, requiredFor: ALL },
    { key: 'overhead_mm', kind: 'number', unit: 'mm', min: 1500, max: 8000, requiredFor: ALL },
    { key: 'door_type', kind: 'choice', choices: ['centre_opening', 'side_opening', 'swing', 'collapsible'], requiredFor: ALL },
    { key: 'door_width_mm', kind: 'number', unit: 'mm', min: 500, max: 4000, requiredFor: ALL },
    { key: 'door_height_mm', kind: 'number', unit: 'mm', min: 1800, max: 4000, requiredFor: ALL },
    { key: 'controller', kind: 'text', requiredFor: [] },
    { key: 'cabin_finish', kind: 'text', requiredFor: [] },
    { key: 'power_supply', kind: 'choice', choices: ['three_phase_415v', 'single_phase_230v'], requiredFor: ALL },
    { key: 'safety_equipment', kind: 'text', requiredFor: [] },
    { key: 'manufacturer', kind: 'text', requiredFor: [] },
    { key: 'model', kind: 'text', requiredFor: [] },
    { key: 'design_references', kind: 'text', requiredFor: [] },
  ],
};

/** Configuration dimension → survey measurement it must physically fit within. */
export const SURVEY_FIT_CHECKS: Record<string, string> = {
  shaft_width_mm: 'shaft_width',
  shaft_depth_mm: 'shaft_depth',
  pit_depth_mm: 'pit_depth',
  overhead_mm: 'overhead',
};

export type ConfigurationValues = Record<string, string | number | null | undefined>;

export interface ConfigurationWarning {
  key: string;
  messageKey: string;
  params: Record<string, string | number>;
}

export interface ConfigurationCheck {
  failures: GuardFailure[];
  warnings: ConfigurationWarning[];
}

const present = (v: unknown) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');
/** Plain decimal numbers only ("12", "1.5"); the SQL mirror uses the same pattern. */
const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
};

/**
 * Validate a configuration revision against the catalogue. Failures block
 * approval; warnings are shown to the reviewer and never block (§39 TE03).
 * `surveyMm` holds the surveyed measurements (mm) of the reviewed survey revision.
 */
export function checkConfiguration(
  category: string | null | undefined,
  values: ConfigurationValues,
  context: { surveyMm?: Record<string, number>; openConstraints?: number } = {},
  catalogue: ConfigurationCatalogue = DEFAULT_CONFIGURATION_CATALOGUE,
): ConfigurationCheck {
  if (!category || !catalogue.categories.includes(category as LiftCategory)) {
    return { failures: [{ code: 'REQUIRED_FIELD_MISSING', message: 'Lift category is required', messageKey: 'gate2.category_missing', fields: ['lift_category'] }], warnings: [] };
  }
  const known = new Set(catalogue.parameters.map((p) => p.key));
  const unknown = Object.keys(values).filter((k) => !known.has(k)).sort();
  const missing: string[] = [];
  const invalid: string[] = [...unknown];
  for (const p of catalogue.parameters) {
    const v = values[p.key];
    if (!present(v)) {
      if (p.requiredFor.includes(category as LiftCategory)) missing.push(p.key);
      continue;
    }
    if (p.kind === 'number') {
      const n = toNumber(v);
      if (!Number.isFinite(n) || (p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) invalid.push(p.key);
    } else if (p.kind === 'choice') {
      if (!p.choices!.includes(String(v))) invalid.push(p.key);
    } else if (String(v).trim().length > 500) invalid.push(p.key);
  }
  const failures: GuardFailure[] = [];
  if (missing.length) failures.push({ code: 'REQUIRED_FIELD_MISSING', message: 'Required configuration parameters missing', messageKey: 'gate2.parameters_missing', fields: missing.map((k) => `config.${k}`) });
  if (invalid.length) failures.push({ code: 'VALIDATION_FAILED', message: 'Configuration parameters out of range or not recognised', messageKey: 'gate2.parameters_invalid', fields: invalid.map((k) => `config.${k}`) });

  const warnings: ConfigurationWarning[] = [];
  if (!present(values.manufacturer) || !present(values.model)) warnings.push({ key: 'manufacturer', messageKey: 'gate2.warn_manufacturer', params: {} });
  if ((context.openConstraints ?? 0) > 0) warnings.push({ key: 'constraints', messageKey: 'gate2.warn_constraints', params: { count: context.openConstraints! } });
  for (const [configKey, surveyKey] of Object.entries(SURVEY_FIT_CHECKS)) {
    const v = toNumber(values[configKey]);
    const surveyed = context.surveyMm?.[surveyKey];
    if (present(values[configKey]) && Number.isFinite(v) && surveyed !== undefined && v > surveyed) {
      warnings.push({ key: configKey, messageKey: 'gate2.warn_exceeds_survey', params: { parameter: configKey, value: v, surveyed } });
    }
  }
  return { failures, warnings };
}

/* -------------------------------------------------------------------------- */
/* Controlled technical documents (§9.6, TE04)                                */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_KINDS = [
  'general_arrangement',
  'shaft_layout',
  'structural_interface',
  'electrical',
  'manufacturer',
  'bill_of_materials',
  'installation_method',
  'technical_specification',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_REVISION_STATES = ['draft', 'in_review', 'approved', 'rejected', 'superseded'] as const;
export type DocumentRevisionState = (typeof DOCUMENT_REVISION_STATES)[number];

export interface DocumentRevisionContext {
  /** Checksum the reviewer saw; approval binds to the stored file only if they match (§39 TE04). */
  reviewedSha256?: string | null;
  storedSha256?: string | null;
}

export const documentRevisionMachine = defineMachine<DocumentRevisionState, string, DocumentRevisionContext>({
  name: 'document_revision',
  states: DOCUMENT_REVISION_STATES,
  initial: 'draft',
  terminal: ['rejected', 'superseded'],
  transitions: [
    { action: 'submit_for_review', from: ['draft'], to: 'in_review', permission: 'technical.review', auditEvent: 'document.submitted' },
    {
      action: 'approve',
      from: ['in_review'],
      to: 'approved',
      permission: 'technical.drawing.approve',
      auditEvent: 'document.approved',
      guard: (c) =>
        c.reviewedSha256 && c.storedSha256 && c.reviewedSha256 === c.storedSha256
          ? []
          : [{ code: 'REVISION_CONFLICT', message: 'The file changed since it was reviewed; approval must name the exact file checksum', fields: ['sha256'] }],
    },
    { action: 'reject', from: ['in_review'], to: 'rejected', permission: 'technical.drawing.approve', requiresReason: true, auditEvent: 'document.rejected' },
    { action: 'supersede', from: ['approved'], to: 'superseded', permission: 'technical.drawing.approve', auditEvent: 'document.superseded' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Quotation terms (§7.8, §49.3) and approval requests (§48, O04)             */
/* -------------------------------------------------------------------------- */

/** Every issued quotation states these terms (§7.8). */
export const QUOTATION_TERM_KEYS = [
  'scope_of_supply',
  'scope_of_installation',
  'customer_responsibilities',
  'exclusions',
  'tax_treatment',
  'payment_terms',
  'warranty_terms',
  'delivery_assumptions',
] as const;
export type QuotationTermKey = (typeof QUOTATION_TERM_KEYS)[number];

export function missingQuotationTerms(terms: Partial<Record<string, unknown>> | null | undefined): QuotationTermKey[] {
  return QUOTATION_TERM_KEYS.filter((k) => !present(terms?.[k]) || String(terms![k]).trim().length < 3);
}

export const APPROVAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'more_info', 'withdrawn'] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

/** Launch defaults (Decision Register D-004, D-005, D-011); changed as versioned business rules. */
export const DEFAULT_DISCOUNT_POLICY = { maxDiscountBpsWithoutApproval: 500, marginFloorBps: 1500 } as const;
export const DEFAULT_TAX_CODES = [{ code: 'GST18', rateBps: 1800 }] as const;
export const DEFAULT_QUOTATION_VALIDITY_DAYS = 30;

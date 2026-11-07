/**
 * Metric data dictionary (spec §5.2, §57). Every KPI declares its definition,
 * numerator/denominator, value basis and source so dashboards never mix
 * estimates with verified actuals.
 */
export type ValueBasis = 'count' | 'estimated' | 'claimed' | 'approved' | 'invoiced' | 'received' | 'reconciled';

export interface MetricDefinition {
  key: string;
  label: string;
  basis: ValueBasis;
  definition: string;
  numerator?: string;
  denominator?: string;
  exclusions?: string;
  sourceTables: string[];
}

export const METRICS: Record<string, MetricDefinition> = {
  lead_response_time: {
    key: 'lead_response_time',
    label: 'Lead response time',
    basis: 'count',
    definition: 'First meaningful contact timestamp minus lead created timestamp (median, hours).',
    sourceTables: ['leads', 'lead_activities'],
  },
  lead_to_survey_conversion: {
    key: 'lead_to_survey_conversion',
    label: 'Lead-to-survey conversion',
    basis: 'count',
    definition: 'Leads with a submitted survey ÷ eligible leads created in the cohort.',
    numerator: 'leads in cohort with ≥1 survey reaching submitted',
    denominator: 'leads created in cohort, excluding invalid',
    exclusions: 'Leads marked invalid are excluded from the denominator.',
    sourceTables: ['leads', 'surveys'],
  },
  quote_conversion: {
    key: 'quote_conversion',
    label: 'Quotation conversion',
    basis: 'count',
    definition: 'Won quotations ÷ valid issued quotations in the cohort.',
    numerator: 'quotation revisions accepted',
    denominator: 'quotation revisions issued, excluding superseded-before-response',
    sourceTables: ['quotation_revisions'],
  },
  qa_first_pass_rate: {
    key: 'qa_first_pass_rate',
    label: 'QA first-pass rate',
    basis: 'count',
    definition: 'First submitted inspections passed ÷ first submitted inspections decided.',
    exclusions: 'Cancelled inspections are excluded.',
    sourceTables: ['inspections'],
  },
  rework_rate: {
    key: 'rework_rate',
    label: 'Rework rate',
    basis: 'count',
    definition: 'Tasks requiring rework ÷ tasks submitted for QA.',
    sourceTables: ['tasks'],
  },
  collection_efficiency: {
    key: 'collection_efficiency',
    label: 'Collection efficiency',
    basis: 'received',
    definition: 'Verified collections ÷ amounts due for the same period / cohort.',
    sourceTables: ['payments', 'payment_allocations', 'invoices'],
  },
  gross_project_contribution: {
    key: 'gross_project_contribution',
    label: 'Gross project contribution',
    basis: 'approved',
    definition: 'Approved revenue basis (excluding taxes) minus direct project costs. Not net profit.',
    sourceTables: ['quotation_revisions', 'expenses', 'partner_ledger_entries', 'purchase_orders'],
  },
};

/** Safe ratio with explicit denominator; returns null instead of NaN / Infinity. */
export function rate(numerator: number, denominator: number): { value: number | null; numerator: number; denominator: number } {
  return { value: denominator > 0 ? numerator / denominator : null, numerator, denominator };
}

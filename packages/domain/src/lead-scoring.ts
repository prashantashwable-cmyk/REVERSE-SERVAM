/**
 * Transparent, configurable lead score (spec §7.5, §37 SE05). The score is a
 * sales prioritization aid only — never a legal or credit decision. Mirrors
 * app.score_lead() which reads the business rule `lead.scoring`.
 */
export interface LeadScoringRule {
  key: string;
  when: 'present' | 'equals' | 'in';
  value?: string | string[];
  points: number;
}

export interface LeadScoringConfig {
  max: number;
  rules: LeadScoringRule[];
}

export const DEFAULT_LEAD_SCORING: LeadScoringConfig = {
  max: 100,
  rules: [
    { key: 'need', when: 'present', points: 20 },
    { key: 'decision_authority', when: 'equals', value: 'confirmed', points: 20 },
    { key: 'budget_readiness', when: 'equals', value: 'ready', points: 20 },
    { key: 'timeline', when: 'in', value: ['within_3_months'], points: 20 },
    { key: 'site_readiness', when: 'in', value: ['ready', 'under_construction'], points: 10 },
    { key: 'number_of_lifts', when: 'present', points: 10 },
  ],
};

export interface LeadScore {
  score: number;
  explanation: { key: string; points: number; matched: boolean }[];
}

function present(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

export function scoreLead(qualification: Record<string, unknown>, config: LeadScoringConfig = DEFAULT_LEAD_SCORING): LeadScore {
  const explanation = config.rules.map((r) => {
    const v = qualification[r.key];
    let matched = false;
    if (r.when === 'present') matched = present(v);
    else if (r.when === 'equals') matched = typeof v === 'string' && v === r.value;
    else if (r.when === 'in') matched = typeof v === 'string' && Array.isArray(r.value) && r.value.includes(v);
    return { key: r.key, points: matched ? r.points : 0, matched };
  });
  const total = explanation.reduce((a, e) => a + e.points, 0);
  return { score: Math.max(0, Math.min(config.max, total)), explanation };
}

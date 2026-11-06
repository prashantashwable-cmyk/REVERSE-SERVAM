'use server';

import { redirect } from 'next/navigation';
import { normalizePhone } from '@aiec/domain';
import { errorState, localError, str, uuid, type ActionState } from '@/lib/actions';
import type { DuplicateCandidate, NewLeadState } from './state';
import { supabaseServer } from '@/lib/supabase/server';

const FIELDS = [
  'contact_name', 'phone', 'alternate_phone', 'email', 'customer_type', 'builder_name', 'project_name', 'site_name', 'address_line',
  'locality', 'city', 'zone', 'pincode', 'latitude', 'longitude', 'building_usage', 'floors_count', 'stops_count', 'lift_requirement',
  'construction_stage', 'budget_range', 'expected_decision_date', 'source', 'referrer', 'decision_maker', 'communication_preference', 'notes',
] as const;

export async function createLeadAction(prev: NewLeadState, form: FormData): Promise<NewLeadState> {
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(form, k) ?? ''])) as Record<(typeof FIELDS)[number], string>;
  const operationId = uuid(form, 'operation_id');
  const next = (result: ActionState, candidates: DuplicateCandidate[] = []): NewLeadState => ({ result, values, candidates, attempt: prev.attempt + 1 });
  if (!operationId) return next(localError('REQUIRED_FIELD_MISSING', ['operation_id']));

  // Client-side style validation repeated on the server action (the database validates again).
  if (values.phone && !normalizePhone(values.phone)) return next(localError('VALIDATION_FAILED', ['phone']));
  // Numbers are sent as entered; the database validates them and reports the exact field.
  const num = (v: string) => (v === '' ? null : v);
  const confirmed = form.getAll('confirm_separate').filter((v): v is string => typeof v === 'string');

  const payload = {
    contact_name: values.contact_name,
    phone: values.phone || null,
    alternate_phone: values.alternate_phone || null,
    email: values.email || null,
    customer_type: values.customer_type || null,
    builder_name: values.builder_name || null,
    project_name: values.project_name,
    building_usage: values.building_usage || null,
    floors_count: num(values.floors_count),
    stops_count: num(values.stops_count),
    lift_requirement: values.lift_requirement,
    construction_stage: values.construction_stage || null,
    budget_range: values.budget_range || null,
    expected_decision_date: values.expected_decision_date || null,
    source: values.source,
    referrer: values.referrer || null,
    decision_maker: values.decision_maker || null,
    communication_preference: values.communication_preference || null,
    marketing_consent: form.get('marketing_consent') === 'on',
    notes: values.notes || null,
    site: {
      name: values.site_name || null,
      address_line: values.address_line || null,
      locality: values.locality || null,
      city: values.city,
      zone: values.zone || null,
      pincode: values.pincode || null,
      latitude: num(values.latitude),
      longitude: num(values.longitude),
      location_source: values.latitude && values.longitude ? 'map_pin' : null,
    },
    duplicate_review: confirmed.length > 0 ? { confirmed_separate_from: confirmed, reason: str(form, 'duplicate_reason') } : undefined,
  };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('create_lead', { p_operation_id: operationId, p_payload: payload });
  if (error) {
    const state = errorState(error);
    const candidates = state.status === 'error' && Array.isArray(state.details.candidates) ? (state.details.candidates as DuplicateCandidate[]) : [];
    return next(state, candidates);
  }
  redirect(`/leads/${(data as { lead_id: string }).lead_id}?created=1`);
}

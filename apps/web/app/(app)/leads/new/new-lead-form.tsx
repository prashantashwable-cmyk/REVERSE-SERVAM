'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { FormStatus, SubmitButton } from '@/components/forms';
import { Card, Field, inputClass } from '@/components/ui';
import { createLeadAction } from './actions';
import { INITIAL_NEW_LEAD } from './state';

const SOURCES = ['website', 'phone', 'whatsapp', 'referral', 'builder_visit', 'marketing_campaign', 'existing_customer', 'manual'];
const CUSTOMER_TYPES = ['individual', 'housing_society', 'builder_developer', 'commercial', 'institution', 'other'];
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function NewLeadForm({ operationId }: { operationId: string }) {
  const [state, action] = useActionState(createLeadAction, INITIAL_NEW_LEAD);
  useEffect(() => {
    // Full navigation: a client router.push() issued right after a server action was
    // observed (E2E, Next 15.5) to be aborted about half the time.
    if (state.createdLeadId) window.location.assign(`/leads/${state.createdLeadId}?created=1`);
  }, [state.createdLeadId]);
  const v = state.values;
  const invalid = (f: string) => state.result.status === 'error' && state.result.fields.some((x) => x === f || x.endsWith(`.${f}`));
  const input = (name: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={name} name={name} defaultValue={v[name] ?? ''} aria-invalid={invalid(name) || undefined} className={`${inputClass} ${invalid(name) ? 'border-crit-700' : ''}`} {...props} />
  );

  return (
    // Remount on each attempt so inputs show the values that were submitted.
    <form key={state.attempt} action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="operation_id" value={operationId} />

      {state.candidates.length > 0 ? (
        <Card title="Possible duplicates — review before saving">
          <p className="mb-3 text-sm text-silver-700">
            These existing leads look similar. Open an existing lead if it is the same enquiry. To continue, confirm each one is a separate opportunity and give a reason. Nothing is merged automatically.
          </p>
          <ul className="flex flex-col gap-2">
            {state.candidates.map((c) => (
              <li key={c.lead_id} className="rounded-md border border-silver-200 p-3 text-sm">
                <label className="flex items-start gap-3">
                  <input type="checkbox" name="confirm_separate" value={c.lead_id} className="mt-1 h-5 w-5" />
                  <span>
                    <span className="font-mono font-semibold">{c.lead_number}</span> · {c.project_name} · {c.city} · {pretty(c.status)}
                    <span className={`ml-2 rounded px-1.5 text-xs font-semibold ${c.level === 'strong' ? 'bg-crit-50 text-crit-700' : 'bg-warn-50 text-warn-700'}`}>
                      {c.level === 'strong' ? 'Strong match' : 'Possible match'}
                    </span>
                    <br />
                    <span className="text-silver-700">
                      Matched on: {c.reasons.map(pretty).join(', ')}
                      {c.distance_m !== null ? ` (${Math.round(c.distance_m)} m away)` : ''} · Owner: {c.owner_name ?? 'unassigned'}
                    </span>
                    {c.can_open ? (
                      <>
                        {' · '}
                        <Link prefetch={false} href={`/leads/${c.lead_id}`} className="underline">
                          Open
                        </Link>
                      </>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Field label="Why is this a separate opportunity?" htmlFor="duplicate_reason" required>
              <textarea id="duplicate_reason" name="duplicate_reason" className={inputClass} rows={2} />
            </Field>
          </div>
        </Card>
      ) : null}

      <Card title="Contact">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Contact name" htmlFor="contact_name" required>{input('contact_name', { autoComplete: 'name' })}</Field>
          <Field label="Customer type" htmlFor="customer_type">
            <select id="customer_type" name="customer_type" defaultValue={v.customer_type ?? 'other'} className={inputClass}>
              {CUSTOMER_TYPES.map((c) => (
                <option key={c} value={c}>{pretty(c)}</option>
              ))}
            </select>
          </Field>
          <Field label="Mobile" htmlFor="phone" hint="Phone or email is required.">{input('phone', { inputMode: 'tel', placeholder: '+91 98765 43210' })}</Field>
          <Field label="Alternate phone" htmlFor="alternate_phone">{input('alternate_phone', { inputMode: 'tel' })}</Field>
          <Field label="Email" htmlFor="email">{input('email', { type: 'email' })}</Field>
          <Field label="Communication preference" htmlFor="communication_preference">
            <select id="communication_preference" name="communication_preference" defaultValue={v.communication_preference ?? ''} className={inputClass}>
              <option value="">Not stated</option>
              <option value="call">Call</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </Field>
          <Field label="Decision maker" htmlFor="decision_maker">{input('decision_maker')}</Field>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" name="marketing_consent" className="h-5 w-5" /> Consents to marketing communication
          </label>
        </div>
      </Card>

      <Card title="Site and project">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Project name" htmlFor="project_name" required>{input('project_name')}</Field>
          <Field label="Builder / developer" htmlFor="builder_name">{input('builder_name')}</Field>
          <Field label="Site name" htmlFor="site_name" hint="Defaults to the project name.">{input('site_name')}</Field>
          <Field label="Address" htmlFor="address_line">{input('address_line')}</Field>
          <Field label="Locality" htmlFor="locality">{input('locality')}</Field>
          <Field label="City" htmlFor="city" required>{input('city', { list: 'cities' })}</Field>
          <datalist id="cities">
            <option value="Pune" />
            <option value="PCMC" />
          </datalist>
          <Field label="Zone" htmlFor="zone">{input('zone')}</Field>
          <Field label="PIN code" htmlFor="pincode">{input('pincode', { inputMode: 'numeric', maxLength: 6 })}</Field>
          <Field label="Latitude" htmlFor="latitude" hint="Optional map pin (decimal degrees).">{input('latitude', { inputMode: 'decimal' })}</Field>
          <Field label="Longitude" htmlFor="longitude">{input('longitude', { inputMode: 'decimal' })}</Field>
        </div>
      </Card>

      <Card title="Requirement">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Initial requirement" htmlFor="lift_requirement" required hint="e.g. one 6-passenger lift for G+4">{input('lift_requirement')}</Field>
          <Field label="Building usage" htmlFor="building_usage">{input('building_usage', { placeholder: 'Residential / commercial / …' })}</Field>
          <Field label="Floors (if known)" htmlFor="floors_count">{input('floors_count', { inputMode: 'numeric' })}</Field>
          <Field label="Stops (if known)" htmlFor="stops_count">{input('stops_count', { inputMode: 'numeric' })}</Field>
          <Field label="Construction stage" htmlFor="construction_stage">{input('construction_stage')}</Field>
          <Field label="Budget range (if disclosed)" htmlFor="budget_range">{input('budget_range')}</Field>
          <Field label="Expected decision date" htmlFor="expected_decision_date">{input('expected_decision_date', { type: 'date' })}</Field>
          <Field label="Source" htmlFor="source" required>
            <select id="source" name="source" defaultValue={v.source ?? ''} className={inputClass}>
              <option value="" disabled>Select…</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{pretty(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Referrer" htmlFor="referrer">{input('referrer')}</Field>
          <Field label="Notes" htmlFor="notes">
            <textarea id="notes" name="notes" defaultValue={v.notes ?? ''} className={inputClass} rows={3} />
          </Field>
        </div>
      </Card>

      <FormStatus state={state.result} />
      <div>
        {state.createdLeadId ? (
          <p role="status" className="text-sm text-ok-700">Lead created — opening it…</p>
        ) : (
          <SubmitButton>{state.candidates.length > 0 ? 'Confirm and create lead' : 'Create lead'}</SubmitButton>
        )}
      </div>
    </form>
  );
}

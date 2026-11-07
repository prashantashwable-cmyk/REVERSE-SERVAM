'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { FormStatus, SubmitButton } from '@/components/forms';
import { useT } from '@/components/locale';
import { Card, inputClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { createLeadAction } from './actions';
import { INITIAL_NEW_LEAD } from './state';

const SOURCES = ['website', 'phone', 'whatsapp', 'referral', 'builder_visit', 'marketing_campaign', 'existing_customer', 'manual'];
const CUSTOMER_TYPES = ['individual', 'housing_society', 'builder_developer', 'commercial', 'institution', 'other'];

export function NewLeadForm({ operationId }: { operationId: string }) {
  const [state, action] = useActionState(createLeadAction, INITIAL_NEW_LEAD);
  const { t } = useT();
  // Field label from the shared dictionary (the same keys name fields in server errors).
  const f = (name: string) => t(`field.${name}`);
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
        <Card title={t('dup.title')}>
          <p className="mb-3 text-sm text-silver-700">{t('dup.intro')}</p>
          <ul className="flex flex-col gap-2">
            {state.candidates.map((c) => (
              <li key={c.lead_id} className="rounded-md border border-silver-200 p-3 text-sm">
                <label className="flex items-start gap-3">
                  <input type="checkbox" name="confirm_separate" value={c.lead_id} className="mt-1 h-5 w-5" />
                  <span>
                    <span className="font-mono font-semibold">{c.lead_number}</span> · {c.project_name} · {c.city} · {t(`lead.state.${c.status}`)}
                    <span className={`ml-2 rounded px-1.5 text-xs font-semibold ${c.level === 'strong' ? 'bg-crit-50 text-crit-700' : 'bg-warn-50 text-warn-700'}`}>
                      {c.level === 'strong' ? t('dup.strong') : t('dup.possible')}
                    </span>
                    <br />
                    <span className="text-silver-700">
                      {t('dup.matched_on', { reasons: c.reasons.map((r) => t(`dup.reason.${r}`)).join(', ') })}
                      {c.distance_m !== null ? ` (${t('dup.distance', { metres: Math.round(c.distance_m) })})` : ''} ·{' '}
                      {t('dup.owner', { name: c.owner_name ?? t('dup.unassigned') })}
                    </span>
                    {c.can_open ? (
                      <>
                        {' · '}
                        <Link prefetch={false} href={`/leads/${c.lead_id}`} className="underline">
                          {t('common.open')}
                        </Link>
                      </>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Field label={t('dup.reason_label')} htmlFor="duplicate_reason" required>
              <textarea id="duplicate_reason" name="duplicate_reason" className={inputClass} rows={2} />
            </Field>
          </div>
        </Card>
      ) : null}

      <Card title={t('lead_form.section_contact')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={f('contact_name')} htmlFor="contact_name" required>{input('contact_name', { autoComplete: 'name' })}</Field>
          <Field label={f('customer_type')} htmlFor="customer_type">
            <select id="customer_type" name="customer_type" defaultValue={v.customer_type ?? 'other'} className={inputClass}>
              {CUSTOMER_TYPES.map((c) => (
                <option key={c} value={c}>{t(`enum.customer_type.${c}`)}</option>
              ))}
            </select>
          </Field>
          <Field label={f('phone')} htmlFor="phone" hint={t('lead_form.contact_hint')}>{input('phone', { inputMode: 'tel', placeholder: '+91 98765 43210' })}</Field>
          <Field label={f('alternate_phone')} htmlFor="alternate_phone">{input('alternate_phone', { inputMode: 'tel' })}</Field>
          <Field label={f('email')} htmlFor="email">{input('email', { type: 'email' })}</Field>
          <Field label={f('communication_preference')} htmlFor="communication_preference">
            <select id="communication_preference" name="communication_preference" defaultValue={v.communication_preference ?? ''} className={inputClass}>
              <option value="">{t('enum.communication.none')}</option>
              {['call', 'whatsapp', 'sms', 'email'].map((c) => (
                <option key={c} value={c}>{t(`enum.communication.${c}`)}</option>
              ))}
            </select>
          </Field>
          <Field label={f('decision_maker')} htmlFor="decision_maker">{input('decision_maker')}</Field>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" name="marketing_consent" className="h-5 w-5" /> {f('marketing_consent')}
          </label>
        </div>
      </Card>

      <Card title={t('lead_form.section_site')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={f('project_name')} htmlFor="project_name" required>{input('project_name')}</Field>
          <Field label={f('builder_name')} htmlFor="builder_name">{input('builder_name')}</Field>
          <Field label={f('site_name')} htmlFor="site_name" hint={t('lead_form.site_name_hint')}>{input('site_name')}</Field>
          <Field label={f('address_line')} htmlFor="address_line">{input('address_line')}</Field>
          <Field label={f('locality')} htmlFor="locality">{input('locality')}</Field>
          <Field label={f('city')} htmlFor="city" required>{input('city', { list: 'cities' })}</Field>
          <datalist id="cities">
            <option value="Pune" />
            <option value="PCMC" />
          </datalist>
          <Field label={f('zone')} htmlFor="zone">{input('zone')}</Field>
          <Field label={f('pincode')} htmlFor="pincode">{input('pincode', { inputMode: 'numeric', maxLength: 6 })}</Field>
          <Field label={f('latitude')} htmlFor="latitude" hint={t('lead_form.latitude_hint')}>{input('latitude', { inputMode: 'decimal' })}</Field>
          <Field label={f('longitude')} htmlFor="longitude">{input('longitude', { inputMode: 'decimal' })}</Field>
        </div>
      </Card>

      <Card title={t('lead_form.section_requirement')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={f('lift_requirement')} htmlFor="lift_requirement" required hint={t('lead_form.requirement_hint')}>{input('lift_requirement')}</Field>
          <Field label={f('building_usage')} htmlFor="building_usage">{input('building_usage', { placeholder: t('lead_form.usage_placeholder') })}</Field>
          <Field label={f('floors_count')} htmlFor="floors_count">{input('floors_count', { inputMode: 'numeric' })}</Field>
          <Field label={f('stops_count')} htmlFor="stops_count">{input('stops_count', { inputMode: 'numeric' })}</Field>
          <Field label={f('construction_stage')} htmlFor="construction_stage">{input('construction_stage')}</Field>
          <Field label={f('budget_range')} htmlFor="budget_range">{input('budget_range')}</Field>
          <Field label={f('expected_decision_date')} htmlFor="expected_decision_date">{input('expected_decision_date', { type: 'date' })}</Field>
          <Field label={f('source')} htmlFor="source" required>
            <select id="source" name="source" defaultValue={v.source ?? ''} className={inputClass}>
              <option value="" disabled>{t('common.select')}</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{t(`enum.source.${s}`)}</option>
              ))}
            </select>
          </Field>
          <Field label={f('referrer')} htmlFor="referrer">{input('referrer')}</Field>
          <Field label={f('notes')} htmlFor="notes">
            <textarea id="notes" name="notes" defaultValue={v.notes ?? ''} className={inputClass} rows={3} />
          </Field>
        </div>
      </Card>

      <FormStatus state={state.result} />
      <div>
        {state.createdLeadId ? (
          <p role="status" className="text-sm text-ok-700">{t('lead_form.created_opening')}</p>
        ) : (
          <SubmitButton>{state.candidates.length > 0 ? t('lead_form.confirm_create') : t('lead_form.create')}</SubmitButton>
        )}
      </div>
    </form>
  );
}

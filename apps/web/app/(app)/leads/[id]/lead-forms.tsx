'use client';

import { useActionState, useState } from 'react';
import { CALL_OUTCOMES, LOST_REASONS } from '@aiec/domain';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import { assignLeadAction, closeLeadAction, qualifyAction, recordActivityAction, reopenLeadAction, scheduleSurveyAction } from './actions';

interface Base {
  leadId: string;
  version: number;
}

export function ActivityForm({ leadId, operationId, nowLocal }: { leadId: string; operationId: string; nowLocal: string }) {
  const [state, action] = useActionState(recordActivityAction, IDLE);
  const { t, field: f } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="operation_id" value={operationId} />
      <Field label={f('activity_type')} htmlFor="activity_type" required>
        <select id="activity_type" name="activity_type" className={inputClass} defaultValue="call">
          {['call', 'meeting', 'whatsapp', 'email', 'site_visit', 'note'].map((a) => (
            <option key={a} value={a}>{t(`enum.activity_type.${a}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={f('outcome')} htmlFor="outcome">
        <select id="outcome" name="outcome" className={inputClass} defaultValue="">
          <option value="">{t('lead_form.no_outcome')}</option>
          {CALL_OUTCOMES.map((o) => (
            <option key={o} value={o}>{t(`enum.call_outcome.${o}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={f('summary')} htmlFor="summary" required>
        <textarea id="summary" name="summary" rows={2} className={inputClass} />
      </Field>
      <Field label={f('occurred_at')} htmlFor="occurred_at" required>
        <input id="occurred_at" name="occurred_at" type="datetime-local" defaultValue={nowLocal} max={nowLocal} className={inputClass} />
      </Field>
      <Field label={f('next_follow_up_at')} htmlFor="next_follow_up_at" hint={t('lead_form.next_follow_up_hint')}>
        <input id="next_follow_up_at" name="next_follow_up_at" type="datetime-local" min={nowLocal} className={inputClass} />
      </Field>
      <Field label={f('no_action_reason')} htmlFor="no_action_reason">
        <input id="no_action_reason" name="no_action_reason" className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>{t('lead.record_activity')}</SubmitButton></div>
      </div>
    </form>
  );
}

export function QualifyForm({ leadId, version, current }: Base & { current: Record<string, string> | null }) {
  const [state, action] = useActionState(qualifyAction, IDLE);
  const { t, field: f } = useT();
  useRefreshOnSuccess(state);
  const [override, setOverride] = useState(false);
  const c = current ?? {};
  const sel = (name: string, options: string[], required = false) => (
    <Field label={f(name)} htmlFor={name} required={required}>
      <select id={name} name={name} defaultValue={c[name] ?? ''} className={inputClass}>
        <option value="">{t('common.unknown')}</option>
        {options.map((o) => (
          <option key={o} value={o}>{t(`enum.qualification.${o}`)}</option>
        ))}
      </select>
    </Field>
  );
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="version" value={version} />
      <Field label={f('need')} htmlFor="need" required>
        <input id="need" name="need" defaultValue={c.need ?? ''} className={inputClass} />
      </Field>
      {sel('decision_authority', ['confirmed', 'influencer', 'unknown_yet'], true)}
      {sel('budget_readiness', ['ready', 'approval_pending', 'exploring'])}
      {sel('timeline', ['within_3_months', 'within_6_months', 'later'], true)}
      {sel('site_readiness', ['ready', 'under_construction', 'not_started'])}
      <Field label={f('number_of_lifts')} htmlFor="number_of_lifts">
        <input id="number_of_lifts" name="number_of_lifts" inputMode="numeric" defaultValue={c.number_of_lifts ?? ''} className={inputClass} />
      </Field>
      <Field label={f('competitor_situation')} htmlFor="competitor_situation">
        <input id="competitor_situation" name="competitor_situation" defaultValue={c.competitor_situation ?? ''} className={inputClass} />
      </Field>
      <Field label={f('technical_complexity')} htmlFor="technical_complexity">
        <input id="technical_complexity" name="technical_complexity" defaultValue={c.technical_complexity ?? ''} className={inputClass} />
      </Field>
      <Field label={f('next_action')} htmlFor="next_action" required>
        <input id="next_action" name="next_action" defaultValue={c.next_action ?? ''} className={inputClass} />
      </Field>
      <div className="md:col-span-2">
        <button type="button" className={secondaryButtonClass} onClick={() => setOverride((o) => !o)} aria-expanded={override}>
          {override ? t('lead_form.override_close') : t('lead_form.override_open')}
        </button>
      </div>
      {override ? (
        <>
          <Field label={f('score_override')} htmlFor="score_override">
            <input id="score_override" name="score_override" inputMode="numeric" className={inputClass} />
          </Field>
          <Field label={f('override_reason')} htmlFor="override_reason" required>
            <input id="override_reason" name="override_reason" className={inputClass} />
          </Field>
        </>
      ) : null}
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>{t('lead_form.save_qualification')}</SubmitButton></div>
      </div>
    </form>
  );
}

export function ScheduleSurveyForm({ leadId, operationId, surveyors, defaultContact, minLocal }: {
  leadId: string;
  operationId: string;
  surveyors: { id: string; full_name: string }[];
  defaultContact: string;
  minLocal: string;
}) {
  const [state, action] = useActionState(scheduleSurveyAction, IDLE);
  const { t, field: f } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="operation_id" value={operationId} />
      <Field label={f('surveyor_id')} htmlFor="surveyor_id" required>
        <select id="surveyor_id" name="surveyor_id" className={inputClass} defaultValue="">
          <option value="" disabled>{t('common.select')}</option>
          {surveyors.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>
      </Field>
      <Field label={f('scheduled_start')} htmlFor="scheduled_start" required>
        <input id="scheduled_start" name="scheduled_start" type="datetime-local" min={minLocal} className={inputClass} />
      </Field>
      <Field label={f('duration_hours')} htmlFor="duration_hours" required>
        <input id="duration_hours" name="duration_hours" inputMode="decimal" defaultValue="2" className={inputClass} />
      </Field>
      <Field label={f('scope')} htmlFor="scope" required>
        <input id="scope" name="scope" defaultValue={t('lead_form.default_scope')} className={inputClass} />
      </Field>
      <Field label={f('site_contact_name')} htmlFor="site_contact_name">
        <input id="site_contact_name" name="site_contact_name" defaultValue={defaultContact} className={inputClass} />
      </Field>
      <Field label={f('site_contact_phone')} htmlFor="site_contact_phone" hint={t('lead_form.site_contact_phone_hint')}>
        <input id="site_contact_phone" name="site_contact_phone" inputMode="tel" className={inputClass} />
      </Field>
      <Field label={f('special_instructions')} htmlFor="special_instructions">
        <textarea id="special_instructions" name="special_instructions" rows={2} className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>{t('lead_form.book_survey')}</SubmitButton></div>
      </div>
    </form>
  );
}

export function CloseLeadForm({ leadId, version }: Base) {
  const [state, action] = useActionState(closeLeadAction, IDLE);
  const { t, field: f } = useT();
  useRefreshOnSuccess(state);
  const [outcome, setOutcome] = useState('lost');
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="version" value={version} />
      <Field label={f('close_outcome')} htmlFor="outcome" required>
        <select id="outcome" name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputClass}>
          <option value="lost">{t('enum.close_outcome.lost')}</option>
          <option value="invalid">{t('enum.close_outcome.invalid')}</option>
        </select>
      </Field>
      {outcome === 'lost' ? (
        <Field label={f('lost_reason')} htmlFor="lost_reason" required>
          <select id="lost_reason" name="lost_reason" className={inputClass} defaultValue="">
            <option value="" disabled>{t('common.select')}</option>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>{t(`enum.lost_reason.${r}`)}</option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label={f('close_reason')} htmlFor="reason" required>
        <textarea id="reason" name="reason" rows={2} className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>{t('lead_form.close_lead')}</SubmitButton></div>
      </div>
    </form>
  );
}

export function AssignForm({ leadId, version, owners, mode }: Base & { owners: { id: string; full_name: string }[]; mode: 'assign' | 'reassign' | 'reopen' }) {
  const [state, action] = useActionState(mode === 'reopen' ? reopenLeadAction : assignLeadAction, IDLE);
  const { t, field: f } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="version" value={version} />
      <Field label={f('assignee_id')} htmlFor="assignee_id" required>
        <select id="assignee_id" name="assignee_id" className={inputClass} defaultValue="">
          <option value="" disabled>{t('common.select')}</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.full_name}</option>
          ))}
        </select>
      </Field>
      <Field label={f('reason')} htmlFor="reason" required={mode !== 'assign'}>
        <input id="reason" name="reason" className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>{mode === 'reopen' ? t('lead_form.reopen') : mode === 'reassign' ? t('lead_form.reassign') : t('lead_form.assign')}</SubmitButton></div>
      </div>
    </form>
  );
}

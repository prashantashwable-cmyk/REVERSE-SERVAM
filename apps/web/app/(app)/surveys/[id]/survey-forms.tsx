'use client';

import { useActionState } from 'react';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { inputClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import { cancelAction, requestRevisionAction, rescheduleAction, reviewGpsAction } from './actions';

export function RequestRevisionForm({ surveyId, version }: { surveyId: string; version: number }) {
  const [state, action] = useActionState(requestRevisionAction, IDLE);
  const { t } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="version" value={version} />
      <Field label={t('survey_form.return_reason')} htmlFor="reason" required>
        <textarea id="reason" name="reason" rows={3} className={inputClass} />
      </Field>
      <FormStatus state={state} />
      <div><SubmitButton>{t('survey_form.return')}</SubmitButton></div>
    </form>
  );
}

export function GpsReviewForm({ surveyId }: { surveyId: string }) {
  const [state, action] = useActionState(reviewGpsAction, IDLE);
  const { t } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="survey_id" value={surveyId} />
      <Field label={t('survey_form.decision')} htmlFor="decision" required>
        <select id="decision" name="decision" className={inputClass} defaultValue="">
          <option value="" disabled>{t('common.select')}</option>
          <option value="accepted">{t('survey_form.accept')}</option>
          <option value="rejected">{t('survey_form.reject')}</option>
        </select>
      </Field>
      <Field label={t('survey_form.basis')} htmlFor="note" required>
        <input id="note" name="note" className={inputClass} />
      </Field>
      <FormStatus state={state} />
      <div><SubmitButton>{t('survey_form.record_decision')}</SubmitButton></div>
    </form>
  );
}

export function RescheduleForm({ surveyId, version, surveyors, minLocal }: { surveyId: string; version: number; surveyors: { id: string; full_name: string }[]; minLocal: string }) {
  const [state, action] = useActionState(rescheduleAction, IDLE);
  const { t, field: f } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="version" value={version} />
      <Field label={t('survey_form.new_start')} htmlFor="scheduled_start" required>
        <input id="scheduled_start" name="scheduled_start" type="datetime-local" min={minLocal} className={inputClass} />
      </Field>
      <Field label={f('duration_hours')} htmlFor="duration_hours" required>
        <input id="duration_hours" name="duration_hours" inputMode="decimal" defaultValue="2" className={inputClass} />
      </Field>
      <Field label={f('surveyor_id')} htmlFor="surveyor_id" hint={t('survey_form.surveyor_hint')}>
        <select id="surveyor_id" name="surveyor_id" className={inputClass} defaultValue="">
          <option value="">{t('survey_form.keep_current')}</option>
          {surveyors.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>
      </Field>
      <Field label={f('reason')} htmlFor="reason">
        <input id="reason" name="reason" className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>{t('survey_form.reschedule')}</SubmitButton></div>
      </div>
    </form>
  );
}

export function CancelSurveyForm({ surveyId, version }: { surveyId: string; version: number }) {
  const [state, action] = useActionState(cancelAction, IDLE);
  const { t } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="version" value={version} />
      <Field label={t('survey_form.cancel_reason')} htmlFor="cancel_reason" required>
        <input id="cancel_reason" name="reason" className={inputClass} />
      </Field>
      <FormStatus state={state} />
      <div><SubmitButton>{t('survey_form.cancel')}</SubmitButton></div>
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from '@/components/forms';
import { Field, inputClass } from '@/components/ui';
import { IDLE } from '@/lib/actions';
import { cancelAction, requestRevisionAction, rescheduleAction, reviewGpsAction } from './actions';

export function RequestRevisionForm({ surveyId, version }: { surveyId: string; version: number }) {
  const [state, action] = useActionState(requestRevisionAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="version" value={version} />
      <Field label="What must be corrected or re-measured?" htmlFor="reason" required>
        <textarea id="reason" name="reason" rows={3} className={inputClass} />
      </Field>
      <FormStatus state={state} />
      <div><SubmitButton>Return for revision</SubmitButton></div>
    </form>
  );
}

export function GpsReviewForm({ surveyId }: { surveyId: string }) {
  const [state, action] = useActionState(reviewGpsAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="survey_id" value={surveyId} />
      <Field label="Decision" htmlFor="decision" required>
        <select id="decision" name="decision" className={inputClass} defaultValue="">
          <option value="" disabled>Select…</option>
          <option value="accepted">Accept exception</option>
          <option value="rejected">Reject (revisit needed)</option>
        </select>
      </Field>
      <Field label="Basis for the decision" htmlFor="note" required>
        <input id="note" name="note" className={inputClass} />
      </Field>
      <FormStatus state={state} />
      <div><SubmitButton>Record decision</SubmitButton></div>
    </form>
  );
}

export function RescheduleForm({ surveyId, version, surveyors, minLocal }: { surveyId: string; version: number; surveyors: { id: string; full_name: string }[]; minLocal: string }) {
  const [state, action] = useActionState(rescheduleAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="version" value={version} />
      <Field label="New start (IST)" htmlFor="scheduled_start" required>
        <input id="scheduled_start" name="scheduled_start" type="datetime-local" min={minLocal} className={inputClass} />
      </Field>
      <Field label="Duration (hours)" htmlFor="duration_hours" required>
        <input id="duration_hours" name="duration_hours" inputMode="decimal" defaultValue="2" className={inputClass} />
      </Field>
      <Field label="Surveyor" htmlFor="surveyor_id" hint="Leave unchanged to keep the current surveyor.">
        <select id="surveyor_id" name="surveyor_id" className={inputClass} defaultValue="">
          <option value="">Keep current</option>
          {surveyors.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>
      </Field>
      <Field label="Reason" htmlFor="reason">
        <input id="reason" name="reason" className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>Reschedule</SubmitButton></div>
      </div>
    </form>
  );
}

export function CancelSurveyForm({ surveyId, version }: { surveyId: string; version: number }) {
  const [state, action] = useActionState(cancelAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="version" value={version} />
      <Field label="Cancellation reason" htmlFor="cancel_reason" required>
        <input id="cancel_reason" name="reason" className={inputClass} />
      </Field>
      <FormStatus state={state} />
      <div><SubmitButton>Cancel survey</SubmitButton></div>
    </form>
  );
}

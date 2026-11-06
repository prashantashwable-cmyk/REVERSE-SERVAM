'use client';

import { useActionState, useState } from 'react';
import { CALL_OUTCOMES, LOST_REASONS } from '@aiec/domain';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from '@/components/forms';
import { Field, inputClass, secondaryButtonClass } from '@/components/ui';
import { IDLE } from '@/lib/actions';
import { assignLeadAction, closeLeadAction, qualifyAction, recordActivityAction, reopenLeadAction, scheduleSurveyAction } from './actions';

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

interface Base {
  leadId: string;
  version: number;
}

export function ActivityForm({ leadId, operationId, nowLocal }: { leadId: string; operationId: string; nowLocal: string }) {
  const [state, action] = useActionState(recordActivityAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="operation_id" value={operationId} />
      <Field label="Channel" htmlFor="activity_type" required>
        <select id="activity_type" name="activity_type" className={inputClass} defaultValue="call">
          {['call', 'meeting', 'whatsapp', 'email', 'site_visit', 'note'].map((t) => (
            <option key={t} value={t}>{pretty(t)}</option>
          ))}
        </select>
      </Field>
      <Field label="Outcome" htmlFor="outcome">
        <select id="outcome" name="outcome" className={inputClass} defaultValue="">
          <option value="">No outcome (note)</option>
          {CALL_OUTCOMES.map((o) => (
            <option key={o} value={o}>{pretty(o)}</option>
          ))}
        </select>
      </Field>
      <Field label="Summary" htmlFor="summary" required>
        <textarea id="summary" name="summary" rows={2} className={inputClass} />
      </Field>
      <Field label="When (IST)" htmlFor="occurred_at" required>
        <input id="occurred_at" name="occurred_at" type="datetime-local" defaultValue={nowLocal} max={nowLocal} className={inputClass} />
      </Field>
      <Field label="Next follow-up (IST)" htmlFor="next_follow_up_at" hint="Required unless you record why no action is needed.">
        <input id="next_follow_up_at" name="next_follow_up_at" type="datetime-local" min={nowLocal} className={inputClass} />
      </Field>
      <Field label="No next action because…" htmlFor="no_action_reason">
        <input id="no_action_reason" name="no_action_reason" className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>Record activity</SubmitButton></div>
      </div>
    </form>
  );
}

export function QualifyForm({ leadId, version, current }: Base & { current: Record<string, string> | null }) {
  const [state, action] = useActionState(qualifyAction, IDLE);
  useRefreshOnSuccess(state);
  const [override, setOverride] = useState(false);
  const c = current ?? {};
  const sel = (name: string, label: string, options: string[], required = false) => (
    <Field label={label} htmlFor={name} required={required}>
      <select id={name} name={name} defaultValue={c[name] ?? ''} className={inputClass}>
        <option value="">Unknown</option>
        {options.map((o) => (
          <option key={o} value={o}>{pretty(o)}</option>
        ))}
      </select>
    </Field>
  );
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="version" value={version} />
      <Field label="Need" htmlFor="need" required>
        <input id="need" name="need" defaultValue={c.need ?? ''} className={inputClass} />
      </Field>
      {sel('decision_authority', 'Decision authority', ['confirmed', 'influencer', 'unknown_yet'], true)}
      {sel('budget_readiness', 'Budget readiness', ['ready', 'approval_pending', 'exploring'])}
      {sel('timeline', 'Timeline', ['within_3_months', 'within_6_months', 'later'], true)}
      {sel('site_readiness', 'Site readiness', ['ready', 'under_construction', 'not_started'])}
      <Field label="Number of lifts" htmlFor="number_of_lifts">
        <input id="number_of_lifts" name="number_of_lifts" inputMode="numeric" defaultValue={c.number_of_lifts ?? ''} className={inputClass} />
      </Field>
      <Field label="Competitor situation" htmlFor="competitor_situation">
        <input id="competitor_situation" name="competitor_situation" defaultValue={c.competitor_situation ?? ''} className={inputClass} />
      </Field>
      <Field label="Technical complexity" htmlFor="technical_complexity">
        <input id="technical_complexity" name="technical_complexity" defaultValue={c.technical_complexity ?? ''} className={inputClass} />
      </Field>
      <Field label="Next action" htmlFor="next_action" required>
        <input id="next_action" name="next_action" defaultValue={c.next_action ?? ''} className={inputClass} />
      </Field>
      <div className="md:col-span-2">
        <button type="button" className={secondaryButtonClass} onClick={() => setOverride((o) => !o)} aria-expanded={override}>
          {override ? 'Use computed score' : 'Override score (reason required)'}
        </button>
      </div>
      {override ? (
        <>
          <Field label="Score override (0–100)" htmlFor="score_override">
            <input id="score_override" name="score_override" inputMode="numeric" className={inputClass} />
          </Field>
          <Field label="Override reason" htmlFor="override_reason" required>
            <input id="override_reason" name="override_reason" className={inputClass} />
          </Field>
        </>
      ) : null}
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>Save qualification</SubmitButton></div>
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
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="operation_id" value={operationId} />
      <Field label="Surveyor" htmlFor="surveyor_id" required>
        <select id="surveyor_id" name="surveyor_id" className={inputClass} defaultValue="">
          <option value="" disabled>Select…</option>
          {surveyors.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>
      </Field>
      <Field label="Start (IST)" htmlFor="scheduled_start" required>
        <input id="scheduled_start" name="scheduled_start" type="datetime-local" min={minLocal} className={inputClass} />
      </Field>
      <Field label="Duration (hours)" htmlFor="duration_hours" required>
        <input id="duration_hours" name="duration_hours" inputMode="decimal" defaultValue="2" className={inputClass} />
      </Field>
      <Field label="Scope" htmlFor="scope" required>
        <input id="scope" name="scope" defaultValue="New lift site survey (shaft, pit, overhead, electrical, logistics)" className={inputClass} />
      </Field>
      <Field label="Site contact name" htmlFor="site_contact_name">
        <input id="site_contact_name" name="site_contact_name" defaultValue={defaultContact} className={inputClass} />
      </Field>
      <Field label="Site contact phone" htmlFor="site_contact_phone" hint="Defaults to the lead's phone.">
        <input id="site_contact_phone" name="site_contact_phone" inputMode="tel" className={inputClass} />
      </Field>
      <Field label="Special instructions" htmlFor="special_instructions">
        <textarea id="special_instructions" name="special_instructions" rows={2} className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>Book survey</SubmitButton></div>
      </div>
    </form>
  );
}

export function CloseLeadForm({ leadId, version }: Base) {
  const [state, action] = useActionState(closeLeadAction, IDLE);
  useRefreshOnSuccess(state);
  const [outcome, setOutcome] = useState('lost');
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="version" value={version} />
      <Field label="Close as" htmlFor="outcome" required>
        <select id="outcome" name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputClass}>
          <option value="lost">Lost</option>
          <option value="invalid">Invalid enquiry</option>
        </select>
      </Field>
      {outcome === 'lost' ? (
        <Field label="Lost reason" htmlFor="lost_reason" required>
          <select id="lost_reason" name="lost_reason" className={inputClass} defaultValue="">
            <option value="" disabled>Select…</option>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>{pretty(r)}</option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Explanation" htmlFor="reason" required>
        <textarea id="reason" name="reason" rows={2} className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>Close lead</SubmitButton></div>
      </div>
    </form>
  );
}

export function AssignForm({ leadId, version, owners, mode }: Base & { owners: { id: string; full_name: string }[]; mode: 'assign' | 'reassign' | 'reopen' }) {
  const [state, action] = useActionState(mode === 'reopen' ? reopenLeadAction : assignLeadAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="version" value={version} />
      <Field label="Sales owner" htmlFor="assignee_id" required>
        <select id="assignee_id" name="assignee_id" className={inputClass} defaultValue="">
          <option value="" disabled>Select…</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.full_name}</option>
          ))}
        </select>
      </Field>
      <Field label="Reason" htmlFor="reason" required={mode !== 'assign'}>
        <input id="reason" name="reason" className={inputClass} />
      </Field>
      <div className="md:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} />
        <div><SubmitButton>{mode === 'reopen' ? 'Reopen lead' : mode === 'reassign' ? 'Reassign' : 'Assign'}</SubmitButton></div>
      </div>
    </form>
  );
}

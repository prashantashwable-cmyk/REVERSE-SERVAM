'use client';

import { useActionState, useState } from 'react';
import { CHECKLIST_RESULTS, SITE_READINESS_ITEMS } from '@aiec/domain';
import { ActionForm } from '@/components/action-form';
import { FormStatus, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import {
  assignmentAdminAction,
  commentReportAction,
  invitePartnerAction,
  partnerDecisionAction,
  projectExecutionAction,
  resolveIncidentAction,
  siteReadinessAction,
  verifyDocumentAction,
} from './actions';

/** LP03 verification: explicit verify / reject (reason required to reject). */
export function DocumentDecisionForm({ documentId }: { documentId: string }) {
  const [state, run] = useActionState(verifyDocumentAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={run} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="document_id" value={documentId} />
      <Field label={f('reason')} htmlFor={`dr_${documentId}`} hint={t('partners.reject_hint')}>
        <input id={`dr_${documentId}`} name="reason" className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="verify" className={buttonClass}>{t('partners.verify')}</button>
        <button type="submit" name="decision" value="reject" className={secondaryButtonClass}>{t('partners.reject')}</button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

/** Partner lifecycle action chosen from the transitions allowed now; a reason where the rule needs one. */
export function PartnerDecisionForm({ orgId, version, actions }: { orgId: string; version: number; actions: { action: string; requiresReason: boolean }[] }) {
  const { t, field: f } = useT();
  const [action, setAction] = useState(actions[0]?.action ?? '');
  const needsReason = actions.find((a) => a.action === action)?.requiresReason ?? false;
  return (
    <ActionForm action={partnerDecisionAction} hidden={{ org_id: orgId, version }} submitLabel={t('partners.record_decision')} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={f('action')} htmlFor="partner_action" required>
        <select id="partner_action" name="action" value={action} onChange={(e) => setAction(e.target.value)} className={inputClass}>
          {actions.map((a) => <option key={a.action} value={a.action}>{t(`action.${a.action}`)}</option>)}
        </select>
      </Field>
      <Field label={f('reason')} htmlFor="partner_reason" required={needsReason}>
        <input id="partner_reason" name="reason" className={inputClass} />
      </Field>
    </ActionForm>
  );
}

/** OM03: every item Pass / Fail / Not applicable (reason) / Awaiting evidence. */
export function SiteReadinessForm({ projectId, previous }: { projectId: string; previous: Record<string, { result: string; note?: string | null }> }) {
  const { t } = useT();
  const groups = [...new Set(SITE_READINESS_ITEMS.map((i) => i.group))];
  return (
    <ActionForm action={siteReadinessAction} hidden={{ project_id: projectId }} submitLabel={t('execution.record_site')} className="flex flex-col gap-3">
      {groups.map((g) => (
        <fieldset key={g} className="rounded-md border border-silver-200 p-3">
          <legend className="px-1 text-sm font-semibold">{t(`execution.site_group.${g}`)}</legend>
          <div className="flex flex-col gap-2">
            {SITE_READINESS_ITEMS.filter((i) => i.group === g).map((i) => (
              <div key={i.key} className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_12rem_1fr]">
                <label htmlFor={`result_${i.key}`} className="text-sm">{t(`execution.site_item.${i.key}`)}</label>
                <select id={`result_${i.key}`} name={`result_${i.key}`} defaultValue={previous[i.key]?.result ?? ''} className={inputClass}>
                  <option value="">{t('execution.not_answered')}</option>
                  {CHECKLIST_RESULTS.map((r) => <option key={r} value={r}>{t(`enum.checklist_result.${r}`)}</option>)}
                </select>
                <input aria-label={t('execution.note_for', { item: t(`execution.site_item.${i.key}`) })} name={`note_${i.key}`} defaultValue={previous[i.key]?.note ?? ''} placeholder={t('execution.note_placeholder')} className={inputClass} />
              </div>
            ))}
          </div>
        </fieldset>
      ))}
    </ActionForm>
  );
}

type PartnerOption = { id: string; label: string; eligible: boolean; reasons: string };

/** OM04: eligible partners are selectable; ineligible ones are listed with the reason (not selectable). */
export function InvitePartnerForm({ projectId, partners, minDate }: { projectId: string; partners: PartnerOption[]; minDate: string }) {
  const { t, field: f } = useT();
  const eligible = partners.filter((p) => p.eligible);
  return (
    <ActionForm action={invitePartnerAction} hidden={{ project_id: projectId }} submitLabel={t('execution.invite')} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <Field label={f('partner_org_id')} htmlFor="partner_org_id" required hint={t('execution.only_eligible')}>
          <select id="partner_org_id" name="partner_org_id" defaultValue={eligible[0]?.id ?? ''} className={inputClass}>
            {partners.map((p) => <option key={p.id} value={p.id} disabled={!p.eligible}>{p.eligible ? p.label : `${p.label} — ${p.reasons}`}</option>)}
          </select>
        </Field>
      </div>
      <div className="md:col-span-2"><Field label={f('scope_summary')} htmlFor="scope_summary" required><textarea id="scope_summary" name="scope_summary" rows={2} className={inputClass} /></Field></div>
      <Field label={f('schedule_from')} htmlFor="schedule_from" required><input id="schedule_from" name="schedule_from" type="date" min={minDate} className={inputClass} /></Field>
      <Field label={f('schedule_to')} htmlFor="schedule_to" required><input id="schedule_to" name="schedule_to" type="date" min={minDate} className={inputClass} /></Field>
      <Field label={f('contract_value')} htmlFor="contract_value" required hint={t('quotation.rupees_hint')}><input id="contract_value" name="contract_value" inputMode="decimal" className={inputClass} /></Field>
      <Field label={f('payment_terms')} htmlFor="inv_payment_terms" required><input id="inv_payment_terms" name="payment_terms" className={inputClass} /></Field>
      <div className="md:col-span-2"><Field label={f('material_responsibility')} htmlFor="material_responsibility" required><input id="material_responsibility" name="material_responsibility" className={inputClass} /></Field></div>
      <div className="md:col-span-2"><Field label={f('safety_requirements')} htmlFor="safety_requirements" required><input id="safety_requirements" name="safety_requirements" className={inputClass} /></Field></div>
      <div className="md:col-span-2"><Field label={f('exclusions')} htmlFor="inv_exclusions"><input id="inv_exclusions" name="exclusions" className={inputClass} /></Field></div>
    </ActionForm>
  );
}

export function AssignmentAdminForm({ assignmentId, version, actions }: { assignmentId: string; version: number; actions: string[] }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={assignmentAdminAction} hidden={{ assignment_id: assignmentId, version }} submitLabel={t('execution.record_assignment_action')} secondary className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={f('action')} htmlFor={`aa_${assignmentId}`} required>
        <select id={`aa_${assignmentId}`} name="action" className={inputClass}>{actions.map((a) => <option key={a} value={a}>{t(`action.${a}`)}</option>)}</select>
      </Field>
      <Field label={f('reason')} htmlFor={`ar_${assignmentId}`} required><input id={`ar_${assignmentId}`} name="reason" className={inputClass} /></Field>
    </ActionForm>
  );
}

export function ProjectExecutionButton({ projectId, version, action }: { projectId: string; version: number; action: 'mark_installation_ready' | 'start_installation' }) {
  const { t } = useT();
  return <ActionForm action={projectExecutionAction} hidden={{ project_id: projectId, version, action }} submitLabel={t(`action.${action}`)} />;
}

export function ResolveIncidentForm({ incidentId, safetyStop }: { incidentId: string; safetyStop: boolean }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={resolveIncidentAction} hidden={{ incident_id: incidentId }} submitLabel={safetyStop ? t('execution.lift_safety_stop') : t('execution.resolve')} secondary>
      <Field label={f('resolution')} htmlFor={`res_${incidentId}`} required hint={safetyStop ? t('execution.lift_hint') : undefined}>
        <input id={`res_${incidentId}`} name="resolution" className={inputClass} />
      </Field>
    </ActionForm>
  );
}

export function CommentReportForm({ reportId }: { reportId: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={commentReportAction} hidden={{ report_id: reportId }} submitLabel={t('execution.add_comment')} secondary>
      <Field label={f('comment')} htmlFor={`cm_${reportId}`} required><input id={`cm_${reportId}`} name="comment" className={inputClass} /></Field>
    </ActionForm>
  );
}

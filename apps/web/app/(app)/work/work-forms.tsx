'use client';

import { BLOCKER_CATEGORIES, DEFAULT_SAFETY_CHECKS } from '@aiec/domain';
import { ActionForm } from '@/components/action-form';
import { useT } from '@/components/locale';
import { inputClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { acceptTaskAction, reportIncidentAction, safetyCheckAction, saveProgressAction, startTaskAction, submitTaskAction, uploadEvidenceAction } from './actions';

export function AcceptTaskButton({ taskId, version }: { taskId: string; version: number }) {
  const { t } = useT();
  return <ActionForm action={acceptTaskAction} hidden={{ task_id: taskId, version }} submitLabel={t('work.accept')} />;
}

/** WT03: each control confirmed, not applicable, or not yet confirmed. Critical controls must be confirmed. */
export function SafetyCheckForm({ taskId, operationId }: { taskId: string; operationId: string }) {
  const { t } = useT();
  return (
    <ActionForm action={safetyCheckAction} hidden={{ task_id: taskId, operation_id: operationId }} formKey={operationId} submitLabel={t('work.record_safety')} className="flex flex-col gap-2">
      {DEFAULT_SAFETY_CHECKS.map((c) => (
        <div key={c.key} className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_14rem]">
          <label htmlFor={`safety_${c.key}`} className="text-sm">
            {t(`work.safety.${c.key}`)} {c.critical ? <span className="text-xs font-semibold text-crit-700">({t('work.critical')})</span> : null}
          </label>
          <select id={`safety_${c.key}`} name={`safety_${c.key}`} defaultValue="" className={inputClass}>
            <option value="">{t('work.not_confirmed')}</option>
            <option value="confirmed">{t('work.confirmed')}</option>
            <option value="not_applicable">{t('work.not_applicable')}</option>
          </select>
        </div>
      ))}
    </ActionForm>
  );
}

export function StartTaskButton({ taskId, version }: { taskId: string; version: number }) {
  const { t } = useT();
  return <ActionForm action={startTaskAction} hidden={{ task_id: taskId, version }} submitLabel={t('work.start')} />;
}

export function ChecklistForm({ taskId, version, items, answers, notes }: { taskId: string; version: number; items: string[]; answers: Record<string, { done?: boolean; not_applicable_reason?: string | null }>; notes: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={saveProgressAction} hidden={{ task_id: taskId, version }} submitLabel={t('work.save_progress')} secondary className="flex flex-col gap-2">
      {items.map((k) => (
        <div key={k} className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_16rem]">
          <input type="hidden" name="item" value={k} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`done_${k}`} defaultChecked={!!answers[k]?.done} className="h-5 w-5" /> {t(`work.check.${k}`)}</label>
          <input aria-label={t('work.na_reason_for', { item: t(`work.check.${k}`) })} name={`na_${k}`} defaultValue={answers[k]?.not_applicable_reason ?? ''} placeholder={t('work.na_placeholder')} className={inputClass} />
        </div>
      ))}
      <Field label={f('notes')} htmlFor={`notes_${taskId}`}><input id={`notes_${taskId}`} name="notes" defaultValue={notes} className={inputClass} /></Field>
    </ActionForm>
  );
}

export function EvidenceForm({ taskId, partnerOrgId, operationId, categories }: { taskId: string; partnerOrgId: string; operationId: string; categories: string[] }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={uploadEvidenceAction} hidden={{ task_id: taskId, partner_org_id: partnerOrgId, operation_id: operationId }} formKey={operationId} submitLabel={t('work.add_photo')} secondary className="grid grid-cols-1 gap-2 md:grid-cols-3">
      <Field label={f('category')} htmlFor="ev_category" required>
        <select id="ev_category" name="category" className={inputClass}>{categories.map((c) => <option key={c} value={c}>{t(`enum.task_evidence.${c}`)}</option>)}</select>
      </Field>
      <Field label={f('photo')} htmlFor="ev_file" required><input id="ev_file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" className={inputClass} /></Field>
      <Field label={f('remarks')} htmlFor="ev_remarks"><input id="ev_remarks" name="remarks" className={inputClass} /></Field>
    </ActionForm>
  );
}

export function SubmitTaskButton({ taskId, version }: { taskId: string; version: number }) {
  const { t } = useT();
  return <ActionForm action={submitTaskAction} hidden={{ task_id: taskId, version }} submitLabel={t('work.submit')} />;
}

/** WT05: blocker or incident; safety categories stop the work and alert AIEC immediately. */
export function IncidentForm({ taskId, operationId }: { taskId: string; operationId: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={reportIncidentAction} hidden={{ task_id: taskId, operation_id: operationId }} formKey={operationId} submitLabel={t('work.report')} secondary className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <Field label={f('category')} htmlFor="inc_category" required hint={t('work.safety_categories_hint')}>
        <select id="inc_category" name="category" className={inputClass}>{BLOCKER_CATEGORIES.map((c) => <option key={c} value={c}>{t(`enum.blocker.${c}`)}</option>)}</select>
      </Field>
      <Field label={f('description')} htmlFor="inc_description" required><input id="inc_description" name="description" className={inputClass} /></Field>
    </ActionForm>
  );
}

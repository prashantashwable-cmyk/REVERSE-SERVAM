'use client';

import { useState } from 'react';
import { DEFECT_CATEGORIES, DEFECT_SEVERITIES, QA_RESULTS } from '@aiec/domain';
import { ActionForm } from '@/components/action-form';
import { useT } from '@/components/locale';
import { inputClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { qaDefectAction, recordInspectionAction } from './actions';

type Criterion = { key: string; critical: boolean };
type Pending = { id: string; number: string; label: string };

/**
 * QA03: every criterion pass / fail / hold / not applicable (critical criteria cannot be N/A).
 * A failed criterion opens its defect fields (QA04). Corrections waiting for reinspection get a decision (QA05).
 */
export function InspectionForm({ taskId, projectId, operationId, criteria, pending, minDate, labelPrefix }: {
  taskId?: string; projectId?: string; operationId: string; criteria: Criterion[]; pending: Pending[]; minDate: string; labelPrefix: string;
}) {
  const { t, field: f } = useT();
  const [results, setResults] = useState<Record<string, string>>({});
  return (
    <ActionForm action={recordInspectionAction} hidden={{ task_id: taskId, project_id: projectId, operation_id: operationId }} formKey={operationId} submitLabel={t('qa.record_inspection')} className="flex flex-col gap-3">
      {pending.length > 0 ? (
        <fieldset className="rounded-md border border-warn-700/30 bg-warn-50 p-3">
          <legend className="px-1 text-sm font-semibold">{t('qa.reinspection')}</legend>
          {pending.map((d) => (
            <div key={d.id} className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_12rem_1fr]">
              <input type="hidden" name="pending_defect" value={d.id} />
              <span className="text-sm"><span className="font-mono text-xs">{d.number}</span> · {d.label}</span>
              <select aria-label={t('qa.decision_for', { defect: d.number })} name={`decision_${d.id}`} defaultValue="" className={inputClass}>
                <option value="">{t('common.choose')}</option>
                <option value="verify">{t('qa.correction_verified')}</option>
                <option value="reject">{t('qa.correction_rejected')}</option>
              </select>
              <input aria-label={t('qa.reason_for', { defect: d.number })} name={`reason_${d.id}`} placeholder={t('qa.reject_reason_placeholder')} className={inputClass} />
            </div>
          ))}
        </fieldset>
      ) : null}
      {criteria.map((c) => (
        <div key={c.key} className="rounded-md border border-silver-200 p-3">
          <input type="hidden" name="criterion" value={c.key} />
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_12rem_1fr]">
            <label htmlFor={`result_${c.key}`} className="text-sm">
              {t(`${labelPrefix}.${c.key}`)} {c.critical ? <span className="text-xs font-semibold text-crit-700">({t('work.critical')})</span> : null}
            </label>
            <select id={`result_${c.key}`} name={`result_${c.key}`} value={results[c.key] ?? ''} onChange={(e) => setResults((r) => ({ ...r, [c.key]: e.target.value }))} className={inputClass}>
              <option value="">{t('execution.not_answered')}</option>
              {QA_RESULTS.filter((r) => !(c.critical && r === 'not_applicable')).map((r) => <option key={r} value={r}>{t(`enum.qa_result.${r}`)}</option>)}
            </select>
            <input aria-label={t('execution.note_for', { item: t(`${labelPrefix}.${c.key}`) })} name={`note_${c.key}`} placeholder={t('qa.note_placeholder')} className={inputClass} />
          </div>
          {results[c.key] === 'fail' && taskId ? (
            <div className="mt-3 grid grid-cols-1 gap-2 border-t border-silver-200 pt-3 md:grid-cols-3">
              <p className="text-sm font-semibold text-crit-700 md:col-span-3">{t('qa.defect_for', { item: t(`${labelPrefix}.${c.key}`) })}</p>
              <Field label={f('category')} htmlFor={`defect_${c.key}_category`} required>
                <select id={`defect_${c.key}_category`} name={`defect_${c.key}_category`} className={inputClass}>{DEFECT_CATEGORIES.map((x) => <option key={x} value={x}>{t(`enum.defect_category.${x}`)}</option>)}</select>
              </Field>
              <Field label={f('severity')} htmlFor={`defect_${c.key}_severity`} required hint={t('qa.critical_hint')}>
                <select id={`defect_${c.key}_severity`} name={`defect_${c.key}_severity`} defaultValue="major" className={inputClass}>{DEFECT_SEVERITIES.map((x) => <option key={x} value={x}>{t(`enum.defect_severity.${x}`)}</option>)}</select>
              </Field>
              <Field label={f('correction_due_date')} htmlFor={`defect_${c.key}_due`} required><input id={`defect_${c.key}_due`} name={`defect_${c.key}_due`} type="date" min={minDate} className={inputClass} /></Field>
              <Field label={f('location')} htmlFor={`defect_${c.key}_location`} required><input id={`defect_${c.key}_location`} name={`defect_${c.key}_location`} className={inputClass} /></Field>
              <div className="md:col-span-2"><Field label={f('description')} htmlFor={`defect_${c.key}_description`} required><input id={`defect_${c.key}_description`} name={`defect_${c.key}_description`} className={inputClass} /></Field></div>
            </div>
          ) : null}
        </div>
      ))}
      <Field label={f('notes')} htmlFor={`qa_notes_${operationId}`} hint={projectId ? t('qa.final_notes_hint') : undefined}><input id={`qa_notes_${operationId}`} name="notes" className={inputClass} /></Field>
    </ActionForm>
  );
}

export function ResolveDisputeForm({ defectId, version }: { defectId: string; version: number }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={qaDefectAction} hidden={{ defect_id: defectId, version, action: 'resolve_dispute' }} submitLabel={t('action.resolve_dispute')} secondary>
      <Field label={f('reason')} htmlFor={`rd_${defectId}`} required><input id={`rd_${defectId}`} name="reason" className={inputClass} /></Field>
    </ActionForm>
  );
}

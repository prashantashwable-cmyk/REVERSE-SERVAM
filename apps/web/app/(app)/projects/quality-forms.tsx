'use client';

import { useActionState, useState } from 'react';
import { DEFAULT_HANDOVER_DOCUMENTS, STATUTORY_EVIDENCE_TYPES } from '@aiec/domain';
import { ActionForm } from '@/components/action-form';
import { FormStatus, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import { handoverAction, linkCustomerAction, projectQualityAction, uploadHandoverDocumentAction, uploadStatutoryAction, verifyStatutoryAction } from './quality-actions';

export function QualityActionButton({ projectId, version, action }: { projectId: string; version: number; action: 'submit_final_qa' | 'record_statutory_clearance' | 'close' }) {
  const { t } = useT();
  return <ActionForm action={projectQualityAction} hidden={{ project_id: projectId, version, action }} submitLabel={t(`action.${action}`)} />;
}

export function StatutoryUploadForm({ projectId, organizationId, operationId, today }: { projectId: string; organizationId: string; operationId: string; today: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={uploadStatutoryAction} hidden={{ project_id: projectId, organization_id: organizationId, operation_id: operationId }} formKey={operationId} submitLabel={t('handover.record_statutory')} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Field label={f('evidence_type')} htmlFor="evidence_type" required>
        <select id="evidence_type" name="evidence_type" className={inputClass}>{STATUTORY_EVIDENCE_TYPES.map((x) => <option key={x} value={x}>{t(`enum.statutory.${x}`)}</option>)}</select>
      </Field>
      <Field label={f('authority')} htmlFor="authority" required><input id="authority" name="authority" className={inputClass} /></Field>
      <Field label={f('reference_number')} htmlFor="reference_number" required><input id="reference_number" name="reference_number" className={inputClass} /></Field>
      <Field label={f('issued_on')} htmlFor="st_issued_on" required><input id="st_issued_on" name="issued_on" type="date" max={today} className={inputClass} /></Field>
      <Field label={f('valid_until')} htmlFor="st_valid_until"><input id="st_valid_until" name="valid_until" type="date" min={today} className={inputClass} /></Field>
      <Field label={f('file')} htmlFor="st_file" required hint={t('handover.file_hint')}><input id="st_file" name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={inputClass} /></Field>
    </ActionForm>
  );
}

export function StatutoryDecisionForm({ evidenceId }: { evidenceId: string }) {
  const [state, run] = useActionState(verifyStatutoryAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={run} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="evidence_id" value={evidenceId} />
      <Field label={f('reason')} htmlFor={`sr_${evidenceId}`} hint={t('partners.reject_hint')}><input id={`sr_${evidenceId}`} name="reason" className={inputClass} /></Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="verify" className={buttonClass}>{t('handover.verify_statutory')}</button>
        <button type="submit" name="decision" value="reject" className={secondaryButtonClass}>{t('partners.reject')}</button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

export function HandoverDocumentForm({ projectId, organizationId, operationId }: { projectId: string; organizationId: string; operationId: string }) {
  const { t, field: f } = useT();
  const [type, setType] = useState<string>(DEFAULT_HANDOVER_DOCUMENTS[0]);
  return (
    <ActionForm action={uploadHandoverDocumentAction} hidden={{ project_id: projectId, organization_id: organizationId, operation_id: operationId }} formKey={operationId} submitLabel={t('handover.add_document')} secondary className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Field label={f('doc_type')} htmlFor="ho_doc_type" required>
        <select id="ho_doc_type" name="doc_type" value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>{DEFAULT_HANDOVER_DOCUMENTS.map((x) => <option key={x} value={x}>{t(`enum.handover_document.${x}`)}</option>)}</select>
      </Field>
      <Field label={f('title')} htmlFor="ho_title" required><input id="ho_title" name="title" className={inputClass} /></Field>
      <Field label={f('file')} htmlFor="ho_file" required hint={t('handover.file_hint')}><input id="ho_file" name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={inputClass} /></Field>
    </ActionForm>
  );
}

export function LinkCustomerForm({ projectId, version, customers }: { projectId: string; version: number; customers: { id: string; label: string }[] }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={linkCustomerAction} hidden={{ project_id: projectId, version }} submitLabel={t('handover.link_customer')} secondary className="flex flex-col gap-2">
      <Field label={f('customer_org_id')} htmlFor="customer_org_id" required hint={t('handover.customer_hint')}>
        <select id="customer_org_id" name="customer_org_id" className={inputClass}>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      </Field>
    </ActionForm>
  );
}

export function HandoverActionButton({ projectId, action }: { projectId: string; action: 'confirm_ready' | 'recheck' }) {
  const { t } = useT();
  return <ActionForm action={handoverAction} hidden={{ project_id: projectId, action }} submitLabel={t(`action.${action}`)} secondary={action === 'recheck'} />;
}

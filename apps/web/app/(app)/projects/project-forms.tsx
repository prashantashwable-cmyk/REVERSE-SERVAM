'use client';

import { useState } from 'react';
import { GATED_ACTIONS, ORDER_HANDOVER_ITEMS, PAYMENT_MODES } from '@aiec/domain';
import { ActionForm } from '@/components/action-form';
import { useT } from '@/components/locale';
import { inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import {
  acknowledgeHandoverAction,
  approveBomAction,
  convertToOrderAction,
  decideClaimAction,
  recordClaimAction,
  requestExceptionAction,
  resubmitClaimAction,
  saveBomAction,
} from './actions';

/** SE11: Sales confirms every handover item before the order (Gate 4) is created. */
export function ConvertOrderForm({ revisionId, operationId, templates, today }: { revisionId: string; operationId: string; templates: string[]; today: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={convertToOrderAction} hidden={{ revision_id: revisionId, operation_id: operationId }} submitLabel={t('order.convert')} navigate={{ key: 'project_id', prefix: '/projects/' }} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={f('contract_reference')} htmlFor="contract_reference" required hint={t('order.contract_hint')}>
        <input id="contract_reference" name="contract_reference" className={inputClass} />
      </Field>
      <Field label={f('contract_date')} htmlFor="contract_date" required>
        <input id="contract_date" name="contract_date" type="date" max={today} defaultValue={today} className={inputClass} />
      </Field>
      <Field label={f('milestone_template')} htmlFor="milestone_template" required hint={t('order.template_hint')}>
        <select id="milestone_template" name="milestone_template" defaultValue={templates[0] ?? ''} className={inputClass}>
          {templates.map((c) => <option key={c} value={c}>{t(`enum.milestone_template.${c}`)}</option>)}
        </select>
      </Field>
      <Field label={f('notes')} htmlFor="order_notes">
        <input id="order_notes" name="notes" className={inputClass} />
      </Field>
      <fieldset className="md:col-span-2 rounded-md border border-silver-200 p-3">
        <legend className="px-1 text-sm font-semibold">{t('order.checklist_title')}</legend>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {ORDER_HANDOVER_ITEMS.map((k) => (
            <label key={k} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name={`check_${k}`} className="mt-1 h-5 w-5" /> {t(`order.check.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>
    </ActionForm>
  );
}

export function AcknowledgeHandoverForm({ projectId, version }: { projectId: string; version: number }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={acknowledgeHandoverAction} hidden={{ project_id: projectId, version }} submitLabel={t('project.acknowledge')}>
      <Field label={f('notes')} htmlFor="handover_notes" hint={t('project.acknowledge_hint')}>
        <input id="handover_notes" name="notes" className={inputClass} />
      </Field>
    </ActionForm>
  );
}

export function RecordClaimForm({ projectId, operationId, milestones, today }: { projectId: string; operationId: string; milestones: string[]; today: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={recordClaimAction} hidden={{ project_id: projectId, operation_id: operationId }} formKey={operationId} submitLabel={t('payment.record_claim')} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Field label={f('milestone_code')} htmlFor="milestone_code" required>
        <select id="milestone_code" name="milestone_code" className={inputClass}>
          {milestones.map((m) => <option key={m} value={m}>{t(`enum.milestone.${m}`)}</option>)}
        </select>
      </Field>
      <Field label={f('payer_name')} htmlFor="payer_name" required>
        <input id="payer_name" name="payer_name" className={inputClass} />
      </Field>
      <Field label={f('amount')} htmlFor="claim_amount" required hint={t('quotation.rupees_hint')}>
        <input id="claim_amount" name="amount" inputMode="decimal" className={inputClass} />
      </Field>
      <Field label={f('payment_mode')} htmlFor="payment_mode" required>
        <select id="payment_mode" name="payment_mode" defaultValue="neft" className={inputClass}>
          {PAYMENT_MODES.map((m) => <option key={m} value={m}>{t(`enum.payment_mode.${m}`)}</option>)}
        </select>
      </Field>
      <Field label={f('payment_reference')} htmlFor="payment_reference" required hint={t('payment.reference_hint')}>
        <input id="payment_reference" name="payment_reference" className={inputClass} />
      </Field>
      <Field label={f('payment_date')} htmlFor="payment_date" required>
        <input id="payment_date" name="payment_date" type="date" max={today} defaultValue={today} className={inputClass} />
      </Field>
      <div className="md:col-span-3">
        <Field label={f('evidence_note')} htmlFor="evidence_note" hint={t('payment.evidence_hint')}>
          <input id="evidence_note" name="evidence_note" className={inputClass} />
        </Field>
      </div>
    </ActionForm>
  );
}

/** FN02: outcome, statement reference and amount; the server refuses the recorder and unmatched claims. */
export function DecideClaimForm({ claimId, version, claimedRupees }: { claimId: string; version: number; claimedRupees: string }) {
  const { t, field: f } = useT();
  const [decision, setDecision] = useState('verify');
  const verifying = decision === 'verify' || decision === 'verify_partially';
  return (
    <ActionForm action={decideClaimAction} hidden={{ claim_id: claimId, version }} submitLabel={t('payment.record_decision')} className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <Field label={f('decision')} htmlFor={`decision_${claimId}`} required>
        <select id={`decision_${claimId}`} name="decision" value={decision} onChange={(e) => setDecision(e.target.value)} className={inputClass}>
          {['verify', 'verify_partially', 'request_clarification', 'reject'].map((d) => <option key={d} value={d}>{t(`payment.decision.${d}`)}</option>)}
        </select>
      </Field>
      {verifying ? (
        <>
          <Field label={f('matched_statement_reference')} htmlFor={`stmt_${claimId}`} required hint={t('payment.statement_hint')}>
            <input id={`stmt_${claimId}`} name="matched_statement_reference" className={inputClass} />
          </Field>
          <Field label={f('verified_amount')} htmlFor={`va_${claimId}`} required>
            <input id={`va_${claimId}`} name="verified_amount" inputMode="decimal" defaultValue={decision === 'verify' ? claimedRupees : ''} className={inputClass} />
          </Field>
        </>
      ) : null}
      <Field label={f('reason')} htmlFor={`reason_${claimId}`} required={decision !== 'verify'}>
        <input id={`reason_${claimId}`} name="reason" className={inputClass} />
      </Field>
    </ActionForm>
  );
}

export function ResubmitClaimForm({ claimId, version }: { claimId: string; version: number }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={resubmitClaimAction} hidden={{ claim_id: claimId, version }} submitLabel={t('payment.resubmit')} secondary className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <Field label={f('payment_reference')} htmlFor={`ref_${claimId}`} required>
        <input id={`ref_${claimId}`} name="payment_reference" className={inputClass} />
      </Field>
      <Field label={f('evidence_note')} htmlFor={`ev_${claimId}`}>
        <input id={`ev_${claimId}`} name="evidence_note" className={inputClass} />
      </Field>
    </ActionForm>
  );
}

export function RequestExceptionForm({ projectId }: { projectId: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={requestExceptionAction} hidden={{ project_id: projectId }} submitLabel={t('payment.request_exception')} secondary className="grid grid-cols-1 gap-2 md:grid-cols-3">
      <Field label={f('gated_action')} htmlFor="exc_action" required>
        <select id="exc_action" name="action" className={inputClass}>
          {GATED_ACTIONS.map((a) => <option key={a} value={a}>{t(`enum.gated_action.${a}`)}</option>)}
        </select>
      </Field>
      <Field label={f('valid_days')} htmlFor="exc_days" required>
        <input id="exc_days" name="valid_days" inputMode="numeric" defaultValue="7" className={inputClass} />
      </Field>
      <div className="md:col-span-3">
        <Field label={f('exception_justification')} htmlFor="exc_reason" required hint={t('payment.exception_hint')}>
          <textarea id="exc_reason" name="reason" rows={2} className={inputClass} />
        </Field>
      </div>
    </ActionForm>
  );
}

type BomRow = { item_code: string; description: string; make_model: string; specification: string; quantity: string; unit: string; source: string; technical_notes: string };
const EMPTY_ROW: BomRow = { item_code: '', description: '', make_model: '', specification: '', quantity: '1', unit: 'nos', source: '', technical_notes: '' };

/** TE05 BOM editor (draft revision). */
export function BomEditor({ projectId, version, initial, changeSummary }: { projectId: string; version: number | null; initial: BomRow[]; changeSummary: string }) {
  const { t, field: f } = useT();
  const [rows, setRows] = useState<BomRow[]>(initial.length ? initial : [EMPTY_ROW]);
  const set = (i: number, k: keyof BomRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <ActionForm action={saveBomAction} hidden={{ project_id: projectId, version: version ?? undefined, lines_json: JSON.stringify(rows) }} submitLabel={t('bom.save')}>
      {rows.map((r, i) => (
        <fieldset key={i} className="rounded-md border border-silver-200 p-3">
          <legend className="px-1 text-xs font-semibold text-silver-700">{t('quotation.line_no', { no: i + 1 })}</legend>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Field label={f('item_code')} htmlFor={`bi_${i}`} required><input id={`bi_${i}`} value={r.item_code} onChange={(e) => set(i, 'item_code', e.target.value)} className={inputClass} /></Field>
            <div className="md:col-span-3"><Field label={f('description')} htmlFor={`bd_${i}`} required><input id={`bd_${i}`} value={r.description} onChange={(e) => set(i, 'description', e.target.value)} className={inputClass} /></Field></div>
            <Field label={f('make_model')} htmlFor={`bm_${i}`}><input id={`bm_${i}`} value={r.make_model} onChange={(e) => set(i, 'make_model', e.target.value)} className={inputClass} /></Field>
            <Field label={f('quantity')} htmlFor={`bq_${i}`} required><input id={`bq_${i}`} inputMode="decimal" value={r.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} className={inputClass} /></Field>
            <Field label={f('unit')} htmlFor={`bu_${i}`} required><input id={`bu_${i}`} value={r.unit} onChange={(e) => set(i, 'unit', e.target.value)} className={inputClass} /></Field>
            <Field label={f('source')} htmlFor={`bs_${i}`}><input id={`bs_${i}`} value={r.source} onChange={(e) => set(i, 'source', e.target.value)} className={inputClass} /></Field>
            <div className="md:col-span-2"><Field label={f('specification')} htmlFor={`bp_${i}`}><input id={`bp_${i}`} value={r.specification} onChange={(e) => set(i, 'specification', e.target.value)} className={inputClass} /></Field></div>
            <div className="md:col-span-2"><Field label={f('technical_notes')} htmlFor={`bn_${i}`}><input id={`bn_${i}`} value={r.technical_notes} onChange={(e) => set(i, 'technical_notes', e.target.value)} className={inputClass} /></Field></div>
          </div>
          <button type="button" className="mt-2 text-xs underline" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>{t('quotation.remove_line')}</button>
        </fieldset>
      ))}
      <div><button type="button" className={secondaryButtonClass} onClick={() => setRows((rs) => [...rs, EMPTY_ROW])}>{t('quotation.add_line')}</button></div>
      <Field label={f('change_summary')} htmlFor="bom_change"><input id="bom_change" name="change_summary" defaultValue={changeSummary} className={inputClass} /></Field>
    </ActionForm>
  );
}

export function ApproveBomButton({ bomRevisionId, version }: { bomRevisionId: string; version: number }) {
  const { t } = useT();
  return <ActionForm action={approveBomAction} hidden={{ bom_revision_id: bomRevisionId, version }} submitLabel={t('bom.approve')} />;
}

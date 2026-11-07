'use client';

import { useActionState } from 'react';
import { ActionForm } from '@/components/action-form';
import { FormStatus, useRefreshOnSuccess } from '@/components/forms';
import { IDLE } from '@/lib/actions';
import { useT } from '@/components/locale';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import {
  addQuoteAction,
  cancelRequestAction,
  createOrderAction,
  createRequestAction,
  decideRequestAction,
  issueOrderAction,
  materialStatusAction,
  receiveGoodsAction,
  selectSupplierAction,
  submitOrderAction,
} from './actions';

type Option = { id: string; label: string };

/** PR01: quantities against approved BOM lines only (empty = not in this request). */
export function CreateRequestForm({ projectId, operationId, bomLines, suppliers, minDate }: {
  projectId: string;
  operationId: string;
  bomLines: { id: string; label: string; remaining: string; unit: string }[];
  suppliers: Option[];
  minDate: string;
}) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={createRequestAction} hidden={{ project_id: projectId, operation_id: operationId }} submitLabel={t('procurement.create_request')} navigate={{ key: 'request_id', prefix: '/procurement/requests/' }} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="md:col-span-3 flex flex-col gap-2">
        {bomLines.map((l) => (
          <label key={l.id} htmlFor={`qty_${l.id}`} className="grid grid-cols-1 items-center gap-2 text-sm md:grid-cols-[1fr_10rem]">
            <span>{l.label} <span className="text-silver-700">({t('procurement.remaining', { qty: l.remaining, unit: l.unit })})</span></span>
            <input id={`qty_${l.id}`} name={`qty_${l.id}`} inputMode="decimal" placeholder={l.remaining} className={inputClass} />
          </label>
        ))}
      </div>
      <Field label={f('required_by')} htmlFor="required_by" required>
        <input id="required_by" name="required_by" type="date" min={minDate} className={inputClass} />
      </Field>
      <Field label={f('preferred_supplier_id')} htmlFor="preferred_supplier_id">
        <select id="preferred_supplier_id" name="preferred_supplier_id" defaultValue="" className={inputClass}>
          <option value="">{t('common.none')}</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <Field label={f('budget')} htmlFor="budget" hint={t('quotation.rupees_hint')}>
        <input id="budget" name="budget" inputMode="decimal" className={inputClass} />
      </Field>
      <div className="md:col-span-3"><Field label={f('notes')} htmlFor="pr_notes"><input id="pr_notes" name="notes" className={inputClass} /></Field></div>
    </ActionForm>
  );
}

export function AddQuoteForm({ requestId, suppliers }: { requestId: string; suppliers: Option[] }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={addQuoteAction} hidden={{ request_id: requestId }} submitLabel={t('procurement.add_quote')} secondary className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <Field label={f('supplier_id')} htmlFor="q_supplier" required>
        <select id="q_supplier" name="supplier_id" className={inputClass}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
      </Field>
      <Field label={f('net_amount')} htmlFor="q_net" required><input id="q_net" name="net" inputMode="decimal" className={inputClass} /></Field>
      <Field label={f('tax_amount')} htmlFor="q_tax"><input id="q_tax" name="tax" inputMode="decimal" className={inputClass} /></Field>
      <Field label={f('freight')} htmlFor="q_freight"><input id="q_freight" name="freight" inputMode="decimal" className={inputClass} /></Field>
      <Field label={f('lead_time_days')} htmlFor="q_lead" required><input id="q_lead" name="lead_time_days" inputMode="numeric" className={inputClass} /></Field>
      <Field label={f('warranty_months')} htmlFor="q_warranty"><input id="q_warranty" name="warranty_months" inputMode="numeric" className={inputClass} /></Field>
      <Field label={f('technical_match')} htmlFor="q_match" required hint={t('procurement.match_hint')}>
        <select id="q_match" name="technical_match" defaultValue="yes" className={inputClass}>
          <option value="yes">{t('procurement.match_yes')}</option>
          <option value="no">{t('procurement.match_no')}</option>
        </select>
      </Field>
      <Field label={f('payment_terms')} htmlFor="q_terms"><input id="q_terms" name="payment_terms" className={inputClass} /></Field>
    </ActionForm>
  );
}

export function SelectSupplierForm({ requestId, version, quotes }: { requestId: string; version: number; quotes: Option[] }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={selectSupplierAction} hidden={{ request_id: requestId, version }} submitLabel={t('procurement.select_supplier')} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={f('quote_id')} htmlFor="quote_id" required>
        <select id="quote_id" name="quote_id" className={inputClass}>{quotes.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}</select>
      </Field>
      <Field label={f('rationale')} htmlFor="rationale" required hint={t('procurement.rationale_hint')}>
        <input id="rationale" name="rationale" className={inputClass} />
      </Field>
    </ActionForm>
  );
}

export function CancelRequestForm({ requestId, version }: { requestId: string; version: number }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={cancelRequestAction} hidden={{ request_id: requestId, version }} submitLabel={t('procurement.cancel_request')} secondary>
      <Field label={f('reason')} htmlFor="cancel_reason" required><input id="cancel_reason" name="reason" className={inputClass} /></Field>
    </ActionForm>
  );
}

/** PR03: one rate and tax per request line; delivery and terms. */
export function CreateOrderForm({ requestId, operationId, lines, deliveryLocation, minDate }: {
  requestId: string;
  operationId: string;
  lines: { id: string; label: string }[];
  deliveryLocation: string;
  minDate: string;
}) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={createOrderAction} hidden={{ request_id: requestId, operation_id: operationId }} submitLabel={t('procurement.create_po')} navigate={{ key: 'po_id', prefix: '/procurement/orders/' }} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {lines.map((l) => (
        <div key={l.id} className="md:col-span-3 grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_10rem_8rem]">
          <span className="text-sm">{l.label}</span>
          <Field label={f('rate')} htmlFor={`rate_${l.id}`} required><input id={`rate_${l.id}`} name={`rate_${l.id}`} inputMode="decimal" className={inputClass} /></Field>
          <Field label={f('tax_percent')} htmlFor={`tax_${l.id}`} required><input id={`tax_${l.id}`} name={`tax_${l.id}`} inputMode="decimal" defaultValue="18" className={inputClass} /></Field>
        </div>
      ))}
      <Field label={f('freight')} htmlFor="po_freight"><input id="po_freight" name="freight" inputMode="decimal" className={inputClass} /></Field>
      <Field label={f('delivery_from')} htmlFor="delivery_from" required><input id="delivery_from" name="delivery_from" type="date" min={minDate} className={inputClass} /></Field>
      <Field label={f('delivery_to')} htmlFor="delivery_to" required><input id="delivery_to" name="delivery_to" type="date" min={minDate} className={inputClass} /></Field>
      <div className="md:col-span-3"><Field label={f('delivery_location')} htmlFor="delivery_location" required><input id="delivery_location" name="delivery_location" defaultValue={deliveryLocation} className={inputClass} /></Field></div>
      <Field label={f('payment_terms')} htmlFor="po_payment_terms" required><input id="po_payment_terms" name="payment_terms" className={inputClass} /></Field>
      <div className="md:col-span-2"><Field label={f('terms')} htmlFor="po_terms"><input id="po_terms" name="terms" className={inputClass} /></Field></div>
    </ActionForm>
  );
}

export function SubmitOrderButton({ poId, version }: { poId: string; version: number }) {
  const { t } = useT();
  return <ActionForm action={submitOrderAction} hidden={{ po_id: poId, version }} submitLabel={t('procurement.submit_po')} />;
}

export function IssueOrderButton({ poId, version }: { poId: string; version: number }) {
  const { t } = useT();
  return <ActionForm action={issueOrderAction} hidden={{ po_id: poId, version }} submitLabel={t('procurement.issue_po')} />;
}

const NEXT: Record<string, string> = { ordered: 'confirm', confirmed: 'mark_ready', manufacturing: 'mark_ready', ready: 'dispatch', dispatched: 'mark_delivered', in_transit: 'mark_delivered' };

/** PR04: advance one line to its next tracked stage. */
export function MaterialStatusButton({ lineId, version, status }: { lineId: string; version: number; status: string }) {
  const { t } = useT();
  const next = NEXT[status];
  if (!next) return null;
  return <ActionForm action={materialStatusAction} hidden={{ po_line_id: lineId, version, action: next }} submitLabel={t(`action.material.${next}`)} secondary />;
}

/** PR05: per line received / damaged quantities, inspection result, serial or batch and remarks. */
export function ReceiveGoodsForm({ poId, operationId, lines }: { poId: string; operationId: string; lines: { id: string; label: string; outstanding: string }[] }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={receiveGoodsAction} hidden={{ po_id: poId, operation_id: operationId }} formKey={operationId} submitLabel={t('procurement.record_grn')} className="flex flex-col gap-3">
      {lines.map((l) => (
        <fieldset key={l.id} className="rounded-md border border-silver-200 p-3">
          <legend className="px-1 text-xs font-semibold">{l.label} · {t('procurement.outstanding', { qty: l.outstanding })}</legend>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
            <Field label={f('received_qty')} htmlFor={`received_${l.id}`}><input id={`received_${l.id}`} name={`received_${l.id}`} inputMode="decimal" className={inputClass} /></Field>
            <Field label={f('damaged_qty')} htmlFor={`damaged_${l.id}`}><input id={`damaged_${l.id}`} name={`damaged_${l.id}`} inputMode="decimal" className={inputClass} /></Field>
            <Field label={f('inspection_result')} htmlFor={`result_${l.id}`}>
              <select id={`result_${l.id}`} name={`result_${l.id}`} defaultValue="accepted" className={inputClass}>
                {['accepted', 'quarantined', 'rejected'].map((r) => <option key={r} value={r}>{t(`enum.inspection.${r}`)}</option>)}
              </select>
            </Field>
            <Field label={f('serial_batch')} htmlFor={`serial_${l.id}`}><input id={`serial_${l.id}`} name={`serial_${l.id}`} className={inputClass} /></Field>
            <Field label={f('remarks')} htmlFor={`remarks_${l.id}`} hint={t('procurement.remarks_hint')}><input id={`remarks_${l.id}`} name={`remarks_${l.id}`} className={inputClass} /></Field>
          </div>
        </fieldset>
      ))}
    </ActionForm>
  );
}

/** O04 for PO and payment-exception requests: explicit approve / reject; the server refuses the requester. */
export function DecideRequestForm({ requestId }: { requestId: string }) {
  const [state, run] = useActionState(decideRequestAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={run} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="request_id" value={requestId} />
      <Field label={f('reason')} htmlFor={`dr_${requestId}`} hint={t('approvals.reason_hint')}>
        <input id={`dr_${requestId}`} name="reason" className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approve" className={buttonClass}>{t('approvals.approve')}</button>
        <button type="submit" name="decision" value="reject" className={secondaryButtonClass}>{t('approvals.reject')}</button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

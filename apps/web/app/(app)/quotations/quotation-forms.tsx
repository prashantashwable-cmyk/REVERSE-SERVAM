'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  QUOTATION_LINE_CATEGORIES,
  QUOTATION_TERM_KEYS,
  computeQuotation,
  formatBps,
  formatInr,
  parseInr,
  parsePercentBps,
  parseQuantityMilli,
  type QuotationLineInput,
} from '@aiec/domain';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import {
  addNegotiationAction,
  createQuotationAction,
  decideApprovalAction,
  issueQuotationAction,
  recordResponseAction,
  reviseQuotationAction,
  saveQuotationAction,
  submitQuotationAction,
} from './actions';
import type { LineDraft } from './quotation-types';

export function CreateQuotationButton({ leadId, operationId }: { leadId: string; operationId: string }) {
  const [state, action] = useActionState(createQuotationAction, IDLE);
  const { t } = useT();
  useEffect(() => {
    if (state.status === 'success' && state.data?.quotation_id) window.location.assign(`/quotations/${state.data.quotation_id}`);
  }, [state]);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="operation_id" value={operationId} />
      <SubmitButton>{t('quotation.create')}</SubmitButton>
      {state.status === 'error' ? <FormStatus state={state} /> : null}
    </form>
  );
}

const EMPTY: LineDraft = { category: 'lift_equipment', description: '', quantity: '1', unit: 'nos', rate: '', discountPercent: '', taxCode: '', estimatedUnitCost: '', costSource: '' };

function toInput(d: LineDraft, rates: Record<string, number>): QuotationLineInput | null {
  try {
    return {
      category: d.category as QuotationLineInput['category'],
      description: d.description,
      quantityMilli: parseQuantityMilli(d.quantity),
      unit: d.unit,
      ratePaise: parseInr(d.rate),
      discountBps: parsePercentBps(d.discountPercent),
      taxCode: { code: d.taxCode, rateBps: rates[d.taxCode] ?? 0 },
      estimatedUnitCostPaise: d.estimatedUnitCost.trim() ? parseInr(d.estimatedUnitCost) : undefined,
    };
  } catch {
    return null;
  }
}

/** SE08: lines, terms and validity of a DRAFT revision. Totals preview uses the same engine as the server. */
export function QuotationEditor({ revisionId, version, initialLines, terms, validUntil, taxCodes, minDate, maxDate }: {
  revisionId: string;
  version: number;
  initialLines: LineDraft[];
  terms: Record<string, string>;
  validUntil: string;
  taxCodes: { code: string; rateBps: number }[];
  minDate: string;
  maxDate: string;
}) {
  const [state, action] = useActionState(saveQuotationAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  const defaultTax = taxCodes[0]?.code ?? '';
  const [rows, setRows] = useState<LineDraft[]>(initialLines.length ? initialLines : [{ ...EMPTY, taxCode: defaultTax }]);
  const rates = useMemo(() => Object.fromEntries(taxCodes.map((c) => [c.code, c.rateBps])), [taxCodes]);
  const parsed = rows.map((r) => toInput(r, rates));
  const preview = parsed.every(Boolean) && parsed.length > 0 ? computeQuotation(parsed as QuotationLineInput[]) : null;
  const set = (i: number, k: keyof LineDraft, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="revision_id" value={revisionId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="lines_json" value={JSON.stringify(rows)} />
      <div className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <fieldset key={i} className="rounded-md border border-silver-200 p-3">
            <legend className="px-1 text-xs font-semibold text-silver-700">{t('quotation.line_no', { no: i + 1 })}</legend>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <Field label={f('category')} htmlFor={`cat_${i}`} required>
                <select id={`cat_${i}`} value={r.category} onChange={(e) => set(i, 'category', e.target.value)} className={inputClass}>
                  {QUOTATION_LINE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`enum.line_category.${c}`)}</option>)}
                </select>
              </Field>
              <div className="md:col-span-3">
                <Field label={f('description')} htmlFor={`desc_${i}`} required>
                  <input id={`desc_${i}`} value={r.description} onChange={(e) => set(i, 'description', e.target.value)} className={inputClass} />
                </Field>
              </div>
              <Field label={f('quantity')} htmlFor={`qty_${i}`} required>
                <input id={`qty_${i}`} inputMode="decimal" value={r.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} className={inputClass} />
              </Field>
              <Field label={f('unit')} htmlFor={`unit_${i}`} required>
                <input id={`unit_${i}`} value={r.unit} onChange={(e) => set(i, 'unit', e.target.value)} className={inputClass} />
              </Field>
              <Field label={f('rate')} htmlFor={`rate_${i}`} required hint={t('quotation.rupees_hint')}>
                <input id={`rate_${i}`} inputMode="decimal" value={r.rate} onChange={(e) => set(i, 'rate', e.target.value)} className={inputClass} />
              </Field>
              <Field label={f('discount_percent')} htmlFor={`disc_${i}`}>
                <input id={`disc_${i}`} inputMode="decimal" value={r.discountPercent} onChange={(e) => set(i, 'discountPercent', e.target.value)} className={inputClass} />
              </Field>
              <Field label={f('tax_code')} htmlFor={`tax_${i}`} required>
                <select id={`tax_${i}`} value={r.taxCode} onChange={(e) => set(i, 'taxCode', e.target.value)} className={inputClass}>
                  <option value="" disabled>{t('common.select')}</option>
                  {taxCodes.map((c) => <option key={c.code} value={c.code}>{t('quotation.tax_option', { code: c.code, rate: formatBps(c.rateBps) })}</option>)}
                </select>
              </Field>
              <Field label={f('estimated_unit_cost')} htmlFor={`cost_${i}`} hint={t('quotation.internal_hint')}>
                <input id={`cost_${i}`} inputMode="decimal" value={r.estimatedUnitCost} onChange={(e) => set(i, 'estimatedUnitCost', e.target.value)} className={inputClass} />
              </Field>
              <div className="md:col-span-2">
                <Field label={f('cost_source')} htmlFor={`src_${i}`} hint={t('quotation.internal_hint')}>
                  <input id={`src_${i}`} value={r.costSource} onChange={(e) => set(i, 'costSource', e.target.value)} className={inputClass} />
                </Field>
              </div>
            </div>
            <button type="button" className="mt-2 text-xs underline" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              {t('quotation.remove_line')}
            </button>
          </fieldset>
        ))}
        <div>
          <button type="button" className={secondaryButtonClass} onClick={() => setRows((rs) => [...rs, { ...EMPTY, taxCode: defaultTax }])}>
            {t('quotation.add_line')}
          </button>
        </div>
      </div>

      <div className="rounded-md bg-silver-100 p-3 text-sm" aria-live="polite">
        {preview ? (
          <p>
            {t('quotation.preview', {
              taxable: formatInr(preview.taxablePaise),
              tax: formatInr(preview.taxPaise),
              total: formatInr(preview.grandTotalPaise),
              margin: preview.contributionMarginBps === null ? '—' : formatBps(preview.contributionMarginBps),
              discount: preview.overallDiscountBps === null ? '—' : formatBps(preview.overallDiscountBps),
            })}
          </p>
        ) : (
          <p className="text-silver-700">{t('quotation.preview_incomplete')}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={f('valid_until')} htmlFor="valid_until" required>
          <input id="valid_until" name="valid_until" type="date" min={minDate} max={maxDate} defaultValue={validUntil} className={inputClass} />
        </Field>
        <div />
        {QUOTATION_TERM_KEYS.map((k) => (
          <Field key={k} label={f(`terms.${k}`)} htmlFor={`terms_${k}`} required>
            <textarea id={`terms_${k}`} name={`terms_${k}`} rows={2} defaultValue={terms[k] ?? ''} className={inputClass} />
          </Field>
        ))}
      </div>
      <FormStatus state={state} />
      <div><SubmitButton>{t('quotation.save_draft')}</SubmitButton></div>
    </form>
  );
}

function SimpleAction({ action: serverAction, hidden, label, secondary }: {
  action: typeof submitQuotationAction;
  hidden: Record<string, string | number>;
  label: string;
  secondary?: boolean;
}) {
  const [state, action] = useActionState(serverAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-col gap-2">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div><SubmitButton className={secondary ? secondaryButtonClass : buttonClass}>{label}</SubmitButton></div>
      <FormStatus state={state} />
    </form>
  );
}

export function SubmitQuotationButton({ revisionId, version }: { revisionId: string; version: number }) {
  const { t } = useT();
  return <SimpleAction action={submitQuotationAction} hidden={{ revision_id: revisionId, version }} label={t('quotation.submit')} />;
}

export function IssueQuotationButton({ revisionId, version }: { revisionId: string; version: number }) {
  const { t } = useT();
  return <SimpleAction action={issueQuotationAction} hidden={{ revision_id: revisionId, version }} label={t('quotation.issue')} />;
}

/** §16.4: who accepted, their authority and the evidence, bound to the issued content hash. */
export function ResponseForm({ revisionId, version, contentSha256 }: { revisionId: string; version: number; contentSha256: string }) {
  const [state, action] = useActionState(recordResponseAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  const [response, setResponse] = useState('accept');
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="revision_id" value={revisionId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="content_sha256" value={contentSha256} />
      <Field label={f('response')} htmlFor="response" required>
        <select id="response" name="response" value={response} onChange={(e) => setResponse(e.target.value)} className={inputClass}>
          <option value="accept">{t('quotation.response_accept')}</option>
          <option value="reject">{t('quotation.response_reject')}</option>
        </select>
      </Field>
      {response === 'accept' ? (
        <>
          <Field label={f('accepted_by_name')} htmlFor="accepted_by_name" required>
            <input id="accepted_by_name" name="accepted_by_name" className={inputClass} />
          </Field>
          <Field label={f('acceptor_authority')} htmlFor="acceptor_authority" required hint={t('quotation.authority_hint')}>
            <input id="acceptor_authority" name="acceptor_authority" className={inputClass} />
          </Field>
          <Field label={f('channel')} htmlFor="channel" required>
            <select id="channel" name="channel" defaultValue="signed_copy" className={inputClass}>
              {['signed_copy', 'email', 'in_person', 'other'].map((c) => <option key={c} value={c}>{t(`enum.acceptance_channel.${c}`)}</option>)}
            </select>
          </Field>
          <Field label={f('evidence')} htmlFor="evidence" required hint={t('quotation.evidence_hint')}>
            <input id="evidence" name="evidence" className={inputClass} />
          </Field>
          <Field label={f('comments')} htmlFor="comments">
            <input id="comments" name="comments" className={inputClass} />
          </Field>
        </>
      ) : (
        <Field label={f('reason')} htmlFor="response_reason" required>
          <input id="response_reason" name="reason" className={inputClass} />
        </Field>
      )}
      <div className="flex flex-col gap-2 md:col-span-2">
        <p className="font-mono text-xs text-silver-700">{t('quotation.binds_to', { sha: contentSha256 })}</p>
        <FormStatus state={state} />
        <div><SubmitButton>{t('quotation.record_response')}</SubmitButton></div>
      </div>
    </form>
  );
}

export function ReviseForm({ quotationId }: { quotationId: string }) {
  const [state, action] = useActionState(reviseQuotationAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="quotation_id" value={quotationId} />
      <Field label={f('reason')} htmlFor="revise_reason" required hint={t('quotation.revise_hint')}>
        <input id="revise_reason" name="reason" className={inputClass} />
      </Field>
      <FormStatus state={state} />
      <div><SubmitButton className={secondaryButtonClass}>{t('quotation.revise')}</SubmitButton></div>
    </form>
  );
}

export function NegotiationForm({ quotationId, nowLocal }: { quotationId: string; nowLocal: string }) {
  const [state, action] = useActionState(addNegotiationAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="quotation_id" value={quotationId} />
      <Field label={f('occurred_at')} htmlFor="neg_at" required>
        <input id="neg_at" name="occurred_at" type="datetime-local" defaultValue={nowLocal} className={inputClass} />
      </Field>
      <Field label={f('negotiation_contact')} htmlFor="neg_contact" required>
        <input id="neg_contact" name="contact" className={inputClass} />
      </Field>
      <Field label={f('topic')} htmlFor="neg_topic" required>
        <input id="neg_topic" name="topic" className={inputClass} />
      </Field>
      <Field label={f('requested_discount_bps')} htmlFor="neg_disc">
        <input id="neg_disc" name="requested_discount" inputMode="decimal" className={inputClass} />
      </Field>
      <Field label={f('requested_change')} htmlFor="neg_change">
        <input id="neg_change" name="requested_change" className={inputClass} />
      </Field>
      <Field label={f('expected_impact')} htmlFor="neg_impact">
        <input id="neg_impact" name="expected_impact" className={inputClass} />
      </Field>
      <Field label={f('decision')} htmlFor="neg_decision">
        <input id="neg_decision" name="decision" className={inputClass} />
      </Field>
      <div className="flex flex-col gap-2 md:col-span-2">
        <FormStatus state={state} />
        <div><SubmitButton className={secondaryButtonClass}>{t('quotation.add_negotiation')}</SubmitButton></div>
      </div>
    </form>
  );
}

/** O04: approve, reject or ask for more information (reason required for the last two). */
export function ApprovalDecisionForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState(decideApprovalAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="request_id" value={requestId} />
      <Field label={f('reason')} htmlFor={`reason_${requestId}`} hint={t('approvals.reason_hint')}>
        <input id={`reason_${requestId}`} name="reason" className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approve" className={buttonClass}>{t('approvals.approve')}</button>
        <button type="submit" name="decision" value="reject" className={secondaryButtonClass}>{t('approvals.reject')}</button>
        <button type="submit" name="decision" value="more_info" className={secondaryButtonClass}>{t('approvals.more_info')}</button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

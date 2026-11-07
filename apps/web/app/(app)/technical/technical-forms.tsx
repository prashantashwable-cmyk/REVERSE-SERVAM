'use client';

import { useActionState, useEffect, useState } from 'react';
import { DEFAULT_CONFIGURATION_CATALOGUE, DOCUMENT_KINDS, LIFT_CATEGORIES } from '@aiec/domain';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import {
  approveConfigurationAction,
  clarifyAction,
  decideAction,
  decideDocumentAction,
  saveConfigurationAction,
  startReviewAction,
  submitDocumentAction,
  uploadDocumentAction,
} from './actions';

/** TE01: open the review, then go to its workspace (full navigation, see new-lead-form). */
export function StartReviewButton({ surveyId }: { surveyId: string }) {
  const [state, action] = useActionState(startReviewAction, IDLE);
  const { t } = useT();
  useEffect(() => {
    if (state.status === 'success' && state.data?.review_id) window.location.assign(`/technical/reviews/${state.data.review_id}`);
  }, [state]);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="survey_id" value={surveyId} />
      <SubmitButton>{t('technical.start_review')}</SubmitButton>
      {state.status === 'error' ? <FormStatus state={state} /> : null}
    </form>
  );
}

export function ClarifyForm({ reviewId, version }: { reviewId: string; version: number }) {
  const [state, action] = useActionState(clarifyAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="review_id" value={reviewId} />
      <input type="hidden" name="version" value={version} />
      <Field label={f('reason')} htmlFor="clarify_reason" required hint={t('technical.clarify_hint')}>
        <textarea id="clarify_reason" name="reason" rows={2} className={inputClass} />
      </Field>
      <FormStatus state={state} />
      <div><SubmitButton>{t('technical.request_clarification')}</SubmitButton></div>
    </form>
  );
}

export function DecisionForm({ reviewId, version }: { reviewId: string; version: number }) {
  const [state, action] = useActionState(decideAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  const [decision, setDecision] = useState('feasible');
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="review_id" value={reviewId} />
      <input type="hidden" name="version" value={version} />
      <Field label={f('decision')} htmlFor="decision" required>
        <select id="decision" name="decision" value={decision} onChange={(e) => setDecision(e.target.value)} className={inputClass}>
          {['feasible', 'conditionally_feasible', 'not_feasible', 'insufficient_information'].map((d) => (
            <option key={d} value={d}>{t(`technical.state.${d}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={f('technical_basis')} htmlFor="technical_basis" required hint={t('technical.basis_hint')}>
        <textarea id="technical_basis" name="technical_basis" rows={3} className={inputClass} />
      </Field>
      <Field label={f('assumptions')} htmlFor="assumptions">
        <textarea id="assumptions" name="assumptions" rows={2} className={inputClass} />
      </Field>
      <Field label={f('references')} htmlFor="references" hint={t('technical.references_hint')}>
        <textarea id="references" name="references" rows={2} className={inputClass} />
      </Field>
      <Field label={f('constraints')} htmlFor="constraints" required={decision === 'conditionally_feasible'} hint={t('technical.one_per_line')}>
        <textarea id="constraints" name="constraints" rows={3} className={inputClass} />
      </Field>
      <Field label={f('corrective_actions')} htmlFor="corrective_actions" required={decision === 'conditionally_feasible'} hint={t('technical.one_per_line')}>
        <textarea id="corrective_actions" name="corrective_actions" rows={3} className={inputClass} />
      </Field>
      <Field label={f('reason')} htmlFor="decision_reason" required={decision === 'not_feasible' || decision === 'insufficient_information'} hint={t('technical.reason_hint')}>
        <textarea id="decision_reason" name="reason" rows={2} className={inputClass} />
      </Field>
      <div className="flex flex-col gap-2 md:col-span-2">
        <FormStatus state={state} />
        <div><SubmitButton>{t('technical.record_decision')}</SubmitButton></div>
      </div>
    </form>
  );
}

type Params = Record<string, { value: string | number | null; status: string }>;

/** TE03: only catalogue parameters, each marked proposed or reviewed until approval. */
export function ConfigurationForm({ leadId, version, category, parameters, changeSummary }: {
  leadId: string;
  version: number | null;
  category: string | null;
  parameters: Params;
  changeSummary: string | null;
}) {
  const [state, action] = useActionState(saveConfigurationAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  const [cat, setCat] = useState(category ?? '');
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      {version !== null ? <input type="hidden" name="version" value={version} /> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={f('lift_category')} htmlFor="lift_category" required>
          <select id="lift_category" name="lift_category" value={cat} onChange={(e) => setCat(e.target.value)} className={inputClass}>
            <option value="" disabled>{t('common.select')}</option>
            {LIFT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(`enum.lift_category.${c}`)}</option>
            ))}
          </select>
        </Field>
        <Field label={f('change_summary')} htmlFor="change_summary">
          <input id="change_summary" name="change_summary" defaultValue={changeSummary ?? ''} className={inputClass} />
        </Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('technical.configuration')}</caption>
          <thead className="text-xs uppercase text-silver-700">
            <tr>
              <th className="py-1 pr-3">{t('technical.col_parameter')}</th>
              <th className="py-1 pr-3">{t('technical.col_value')}</th>
              <th className="py-1 pr-3">{t('technical.col_status')}</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_CONFIGURATION_CATALOGUE.parameters.map((p) => {
              const cur = parameters[p.key];
              const required = cat !== '' && p.requiredFor.includes(cat as never);
              const id = `value_${p.key}`;
              return (
                <tr key={p.key} className="border-t border-silver-200">
                  <td className="py-1 pr-3">
                    <label htmlFor={id}>
                      {f(`config.${p.key}`)}
                      {p.unit ? <span className="text-silver-700"> ({p.unit})</span> : null}
                      {required ? <span className="text-crit-700" aria-hidden="true"> *</span> : null}
                      {required ? <span className="sr-only"> ({t('common.required')})</span> : null}
                    </label>
                  </td>
                  <td className="py-1 pr-3">
                    {p.kind === 'choice' ? (
                      <select id={id} name={id} defaultValue={cur?.value === null || cur?.value === undefined ? '' : String(cur.value)} className={inputClass}>
                        <option value="">{t('common.unknown')}</option>
                        {p.choices!.map((c) => (
                          <option key={c} value={c}>{t(`enum.config.${c}`)}</option>
                        ))}
                      </select>
                    ) : (
                      <input id={id} name={id} inputMode={p.kind === 'number' ? 'decimal' : undefined} defaultValue={cur?.value === null || cur?.value === undefined ? '' : String(cur.value)} className={inputClass} />
                    )}
                  </td>
                  <td className="py-1 pr-3">
                    <select name={`status_${p.key}`} aria-label={t('technical.status_of', { parameter: f(`config.${p.key}`) })} defaultValue={cur?.status === 'reviewed' ? 'reviewed' : 'proposed'} className={inputClass}>
                      <option value="proposed">{t('enum.parameter_status.proposed')}</option>
                      <option value="reviewed">{t('enum.parameter_status.reviewed')}</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FormStatus state={state} />
      <div><SubmitButton>{t('technical.save_configuration')}</SubmitButton></div>
    </form>
  );
}

export function ApproveConfigurationButton({ revisionId, version }: { revisionId: string; version: number }) {
  const [state, action] = useActionState(approveConfigurationAction, IDLE);
  useRefreshOnSuccess(state);
  const { t } = useT();
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="revision_id" value={revisionId} />
      <input type="hidden" name="version" value={version} />
      <FormStatus state={state} />
      <div><SubmitButton>{t('technical.approve_configuration')}</SubmitButton></div>
    </form>
  );
}

export function UploadDocumentForm({ leadId, organizationId, operationId, documents, configurationRevisionId }: {
  leadId: string;
  organizationId: string;
  operationId: string;
  documents: { id: string; label: string }[];
  configurationRevisionId: string | null;
}) {
  const [state, action] = useActionState(uploadDocumentAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  const [docId, setDocId] = useState('');
  return (
    // Remount after each success so the next upload gets a fresh operation id from the refreshed page.
    <form key={operationId} action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="operation_id" value={operationId} />
      {configurationRevisionId ? <input type="hidden" name="configuration_revision_id" value={configurationRevisionId} /> : null}
      <Field label={f('document_id')} htmlFor="document_id">
        <select id="document_id" name="document_id" value={docId} onChange={(e) => setDocId(e.target.value)} className={inputClass}>
          <option value="">{t('technical.new_document')}</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </Field>
      {docId === '' ? (
        <>
          <Field label={f('kind')} htmlFor="doc_kind" required>
            <select id="doc_kind" name="kind" defaultValue="" className={inputClass}>
              <option value="" disabled>{t('common.select')}</option>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>{t(`enum.document_kind.${k}`)}</option>
              ))}
            </select>
          </Field>
          <Field label={f('title')} htmlFor="doc_title" required>
            <input id="doc_title" name="title" className={inputClass} />
          </Field>
        </>
      ) : null}
      <Field label={f('change_summary')} htmlFor="doc_change" required>
        <input id="doc_change" name="change_summary" className={inputClass} />
      </Field>
      <Field label={f('file')} htmlFor="doc_file" required hint={t('technical.file_hint')}>
        <input id="doc_file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx" className={inputClass} />
      </Field>
      <div className="flex flex-col gap-2 md:col-span-2">
        <FormStatus state={state} />
        <div><SubmitButton>{t('technical.upload_document')}</SubmitButton></div>
      </div>
    </form>
  );
}

export function SubmitDocumentButton({ revisionId, version }: { revisionId: string; version: number }) {
  const [state, action] = useActionState(submitDocumentAction, IDLE);
  useRefreshOnSuccess(state);
  const { t } = useT();
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="revision_id" value={revisionId} />
      <input type="hidden" name="version" value={version} />
      <div><SubmitButton className={secondaryButtonClass}>{t('technical.submit_document')}</SubmitButton></div>
      <FormStatus state={state} />
    </form>
  );
}

/** Approval names the checksum shown to the reviewer (hidden field), never "whatever is stored now". */
export function DecideDocumentForm({ revisionId, version, sha256 }: { revisionId: string; version: number; sha256: string }) {
  const [state, action] = useActionState(decideDocumentAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="revision_id" value={revisionId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="sha256" value={sha256} />
      <Field label={f('comment')} htmlFor={`comment_${revisionId}`} hint={t('technical.comment_hint')}>
        <input id={`comment_${revisionId}`} name="comment" className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approve" className={buttonClass}>
          {t('technical.approve_document')}
        </button>
        <button type="submit" name="decision" value="reject" className={secondaryButtonClass}>
          {t('technical.reject_document')}
        </button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

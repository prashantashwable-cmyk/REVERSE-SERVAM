import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkConfiguration, fromServerError, hasMessage } from '@aiec/domain';
import { Observations } from '@/components/observations';
import { Card, EmptyState, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import {
  ApproveConfigurationButton,
  ClarifyForm,
  ConfigurationForm,
  DecideDocumentForm,
  DecisionForm,
  SubmitDocumentButton,
  UploadDocumentForm,
} from '../../technical-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('technical.review_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIDED = ['feasible', 'conditionally_feasible', 'not_feasible'];

/** TE02 Feasibility workspace + TE03 configuration + TE04 documents for one review. */
export default async function ReviewWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const d = (iso: string | null | undefined) => dt(iso, locale);
  const label = (key: string, raw: string) => (hasMessage(key) ? t(key) : raw);
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'technical.review') && !can(ctx, 'survey.read_all')) return <PermissionDenied whatKey="technical.what" />;
  const supabase = await supabaseServer();

  const { data: review, error } = await supabase.from('technical_reviews').select('*').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!review) notFound();

  const [{ data: surveyRow }, { data: revision }, { data: measurements }, { data: configs }, { data: documents }] = await Promise.all([
    supabase.from('surveys').select('id, survey_number, status, sites(name, city, locality)').eq('id', review.survey_id).maybeSingle(),
    supabase.from('survey_revisions').select('revision_no, data, submitted_at').eq('id', review.survey_revision_id).maybeSingle(),
    supabase.from('survey_measurements').select('key, value_mm, entered_value, entered_unit, level_label').eq('revision_id', review.survey_revision_id),
    supabase.from('configuration_revisions').select('*').eq('lead_id', review.lead_id).order('revision_no', { ascending: false }),
    supabase.from('technical_documents').select('id, document_number, kind, title, current_approved_revision_id').eq('lead_id', review.lead_id).order('created_at'),
  ]);
  const docIds = (documents ?? []).map((x) => x.id);
  const { data: docRevs } = docIds.length
    ? await supabase.from('document_revisions').select('*').in('document_id', docIds).order('revision_no', { ascending: false })
    : { data: [] as any[] };
  const signed = new Map<string, string>();
  if (docRevs?.length) {
    const { data: urls } = await supabase.storage.from('technical-documents').createSignedUrls(docRevs.map((r: any) => r.storage_path), 300);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  const survey = surveyRow as any;
  const surveyMm = Object.fromEntries((measurements ?? []).map((m: any) => [m.key, Number(m.value_mm)]));
  const draft = (configs ?? []).find((c: any) => c.status === 'draft');
  const approved = (configs ?? []).find((c: any) => c.status === 'approved');
  const base = draft ?? approved;
  const decided = DECIDED.includes(review.status);
  const feasibleDecision = review.status === 'feasible' || review.status === 'conditionally_feasible';
  const openConstraints = review.status === 'conditionally_feasible' ? (review.constraints ?? []).length : 0;
  const values = (p: Record<string, { value: string | number | null }>) => Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, v.value]));
  const check = draft ? checkConfiguration(draft.lift_category, values(draft.parameters), { surveyMm, openConstraints }) : null;
  const canEditConfig = can(ctx, 'technical.review') && (review.status === 'in_review' || feasibleDecision);
  const canApproveConfig = can(ctx, 'technical.configuration.approve') && feasibleDecision && !!draft;
  const site = [survey?.sites?.name, survey?.sites?.locality, survey?.sites?.city].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader
        title={`${review.review_number} · ${survey?.sites?.name ?? ''}`}
        subtitle={t('technical.review_subtitle', { survey: survey?.survey_number ?? '', revision: revision?.revision_no ?? 1 })}
        actions={<StateBadge state={review.status} labelText={t(`technical.state.${review.status}`)} />}
      />
      <p className="mb-4 text-sm">
        <Link prefetch={false} href={`/surveys/${review.survey_id}`} className="underline">{t('technical.open_survey')}</Link>
        <span className="text-silver-700"> · {site}</span>
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('technical.survey_values', { no: revision?.revision_no ?? 1 })}>
          <p className="mb-2 text-xs text-silver-700">{t('technical.submitted_on', { date: d(revision?.submitted_at) })}</p>
          {measurements && measurements.length > 0 ? (
            <table className="mb-3 w-full text-left text-sm">
              <caption className="sr-only">{t('survey.measurements_heading')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr><th className="py-1 pr-3">{t('survey.col_measurement')}</th><th className="py-1 pr-3">{t('survey.col_value_mm')}</th><th className="py-1 pr-3">{t('survey.col_as_entered')}</th></tr>
              </thead>
              <tbody>
                {measurements.map((m: any) => (
                  <tr key={`${m.key}-${m.level_label}`} className="border-t border-silver-200">
                    <td className="py-1 pr-3">{label(`measure.${m.key}`, m.key)}</td>
                    <td className="py-1 pr-3 font-mono">{m.value_mm}</td>
                    <td className="py-1 pr-3 font-mono">{m.entered_value} {m.entered_unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-silver-700">{t('survey.no_measurements')}</p>
          )}
          <Observations data={(revision?.data ?? {}) as Record<string, unknown>} t={t} />
        </Card>

        <Card title={t('technical.decision')}>
          {review.status === 'in_review' && can(ctx, 'technical.review') ? (
            <>
              <DecisionForm reviewId={review.id} version={review.version} />
              <div className="mt-6 border-t border-silver-200 pt-4">
                <h3 className="mb-2 text-sm font-semibold">{t('technical.clarification_title')}</h3>
                <ClarifyForm reviewId={review.id} version={review.version} />
              </div>
            </>
          ) : review.decided_at ? (
            <KeyValue
              items={[
                [t('field.decision'), t(`technical.state.${review.status}`)],
                [t('technical.decided_on'), d(review.decided_at)],
                [t('field.technical_basis'), review.technical_basis ?? '—'],
                [t('field.assumptions'), review.assumptions ?? '—'],
                [t('field.references'), review.references_text ?? '—'],
                [t('field.constraints'), (review.constraints ?? []).join('; ') || '—'],
                [t('field.corrective_actions'), (review.corrective_actions ?? []).join('; ') || '—'],
                [t('field.reason'), review.decision_reason ?? '—'],
              ]}
            />
          ) : (
            <p className="text-sm text-silver-700">
              {review.status === 'clarification_requested' ? t('technical.waiting_for_surveyor', { reason: review.decision_reason ?? '' }) : t('technical.not_in_review')}
            </p>
          )}
          {decided ? <p className="mt-3 text-xs text-silver-700">{t('technical.decision_locked')}</p> : null}
        </Card>
      </div>

      <Card title={t('technical.configuration')} className="mt-4">
        {approved ? (
          <p className="mb-3 text-sm">
            {t('technical.approved_revision', { no: approved.revision_no, date: d(approved.approved_at) })}{' '}
            <span className="font-mono text-xs text-silver-700">{approved.checksum?.slice(0, 12)}</span>
          </p>
        ) : (
          <p className="mb-3 text-sm text-silver-700">{t('technical.no_approved_configuration')}</p>
        )}
        {check ? (
          <div className="mb-3 flex flex-col gap-2">
            {check.failures.map((f) => (
              <p key={f.messageKey} role="alert" className="rounded-md bg-crit-50 px-3 py-2 text-sm text-crit-700">
                {t(f.messageKey ?? `error.${f.code}.title`)}: {(f.fields ?? []).map((x) => label(`field.${x}`, x)).join(', ')}
              </p>
            ))}
            {check.warnings.map((w) => (
              <p key={w.key} className="rounded-md bg-warn-50 px-3 py-2 text-sm text-warn-700">
                {t(w.messageKey, { ...w.params, parameter: typeof w.params.parameter === 'string' ? label(`field.config.${w.params.parameter}`, w.params.parameter) : '' })}
              </p>
            ))}
            {check.failures.length === 0 ? <p className="text-sm text-ok-700">{t('technical.configuration_complete')}</p> : null}
          </div>
        ) : null}
        {canEditConfig ? (
          <ConfigurationForm
            leadId={review.lead_id}
            version={draft ? draft.version : null}
            category={base?.lift_category ?? null}
            parameters={base?.parameters ?? {}}
            changeSummary={draft?.change_summary ?? null}
          />
        ) : !base ? (
          <EmptyState title={t('technical.configuration_after_review')} />
        ) : null}
        {canApproveConfig ? (
          <div className="mt-4 border-t border-silver-200 pt-4">
            <p className="mb-2 text-sm text-silver-700">{t('technical.approve_hint', { no: draft.revision_no })}</p>
            <ApproveConfigurationButton revisionId={draft.id} version={draft.version} />
          </div>
        ) : null}
        {(configs ?? []).length > 0 ? (
          <ul className="mt-4 text-xs text-silver-700">
            {(configs ?? []).map((c: any) => (
              <li key={c.id}>
                {t('technical.revision_no', { no: c.revision_no })} · {t(`technical.config_state.${c.status}`)}
                {c.change_summary ? ` · ${c.change_summary}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title={t('technical.documents')} className="mt-4">
        <div id="documents" />
        {(documents ?? []).length === 0 ? <p className="mb-3 text-sm text-silver-700">{t('technical.no_documents')}</p> : null}
        <ul className="mb-4 flex flex-col gap-3">
          {(documents ?? []).map((doc: any) => (
            <li key={doc.id} className="rounded-md border border-silver-200 p-3 text-sm">
              <p className="font-semibold">
                <span className="font-mono">{doc.document_number}</span> · {doc.title} · {t(`enum.document_kind.${doc.kind}`)}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {(docRevs ?? []).filter((r: any) => r.document_id === doc.id).map((r: any) => (
                  <li key={r.id} className="border-t border-silver-200 pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{t('technical.revision_no', { no: r.revision_no })}</span>
                      <StateBadge state={r.status} labelText={t(`technical.document_state.${r.status}`)} />
                      <span className="text-xs text-silver-700">{r.change_summary}</span>
                      {signed.get(r.storage_path) ? (
                        <a className="text-xs font-semibold underline" href={signed.get(r.storage_path)} target="_blank" rel="noreferrer">{t('survey.open_file')}</a>
                      ) : null}
                    </div>
                    <p className="font-mono text-xs text-silver-700">{t('technical.checksum', { sha: r.sha256 })}</p>
                    {r.review_comment ? <p className="text-xs">{t('audit.reason', { reason: r.review_comment })}</p> : null}
                    {r.status === 'draft' && can(ctx, 'technical.review') ? <SubmitDocumentButton revisionId={r.id} version={r.version} /> : null}
                    {r.status === 'in_review' && can(ctx, 'technical.drawing.approve') ? <DecideDocumentForm revisionId={r.id} version={r.version} sha256={r.sha256} /> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {can(ctx, 'technical.review') ? (
          <UploadDocumentForm
            leadId={review.lead_id}
            organizationId={review.organization_id}
            operationId={randomUUID()}
            documents={(documents ?? []).map((x: any) => ({ id: x.id, label: `${x.document_number} · ${x.title}` }))}
            configurationRevisionId={approved?.id ?? null}
          />
        ) : null}
      </Card>
    </>
  );
}

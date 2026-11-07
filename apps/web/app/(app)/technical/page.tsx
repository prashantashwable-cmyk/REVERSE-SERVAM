import Link from 'next/link';
import { fromServerError } from '@aiec/domain';
import { Card, EmptyState, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { StartReviewButton } from './technical-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('technical.queue_title') };
}

const days = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : 0);

/** TE01 Review queue: oldest waiting first; nothing opens a decision form before the review starts. */
export default async function TechnicalQueue() {
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  if (!can(result.ctx, 'technical.review')) return <PermissionDenied whatKey="technical.what" />;
  const supabase = await supabaseServer();

  const [surveys, reviews, docs] = await Promise.all([
    supabase.from('surveys').select('id, survey_number, status, current_revision_id, sites(name, city)').eq('status', 'submitted').limit(200),
    supabase
      .from('technical_reviews')
      .select('id, review_number, status, survey_id, lead_id, updated_at, decided_at')
      .in('status', ['in_review', 'clarification_requested', 'insufficient_information', 'feasible', 'conditionally_feasible'])
      .order('updated_at', { ascending: true })
      .limit(300),
    // Two queries: documents and revisions are linked by two foreign keys, so no embedding.
    supabase.from('document_revisions').select('id, revision_no, submitted_at, document_id').eq('status', 'in_review').limit(100),
  ]);
  const err = surveys.error ?? reviews.error ?? docs.error;
  if (err) return <ErrorPanel code={fromServerError(err).code} />;

  const revIds = (surveys.data ?? []).map((s) => s.current_revision_id).filter(Boolean) as string[];
  const reviewSurveyIds = [...new Set((reviews.data ?? []).map((r) => r.survey_id))];
  const leadIds = [...new Set((reviews.data ?? []).map((r) => r.lead_id))];
  const docIds = [...new Set((docs.data ?? []).map((d) => d.document_id))];
  const [revs, reviewSurveys, approvedConfigs, docHeads] = await Promise.all([
    revIds.length ? supabase.from('survey_revisions').select('id, revision_no, submitted_at').in('id', revIds) : Promise.resolve({ data: [] as any[] }),
    reviewSurveyIds.length ? supabase.from('surveys').select('id, survey_number, sites(name, city)').in('id', reviewSurveyIds) : Promise.resolve({ data: [] as any[] }),
    leadIds.length ? supabase.from('configuration_revisions').select('lead_id').eq('status', 'approved').in('lead_id', leadIds) : Promise.resolve({ data: [] as any[] }),
    docIds.length ? supabase.from('technical_documents').select('id, document_number, title, lead_id').in('id', docIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const docById = new Map((docHeads.data ?? []).map((d: any) => [d.id, d]));
  const revById = new Map((revs.data ?? []).map((r: any) => [r.id, r]));
  const surveyById = new Map((reviewSurveys.data ?? []).map((s: any) => [s.id, s]));
  const configured = new Set((approvedConfigs.data ?? []).map((c: any) => c.lead_id));
  const reviewByLead = new Map((reviews.data ?? []).map((r) => [r.lead_id, r.id]));

  const waiting = (surveys.data ?? [])
    .map((s: any) => ({ ...s, rev: revById.get(s.current_revision_id) }))
    .sort((a, b) => Date.parse(a.rev?.submitted_at ?? 0) - Date.parse(b.rev?.submitted_at ?? 0));
  const open = (reviews.data ?? []).filter((r) => ['in_review', 'clarification_requested', 'insufficient_information'].includes(r.status));
  const needsConfig = (reviews.data ?? []).filter((r) => ['feasible', 'conditionally_feasible'].includes(r.status) && !configured.has(r.lead_id));
  const site = (s: any) => [s?.sites?.name, s?.sites?.city].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader title={t('technical.queue_title')} subtitle={t('technical.queue_subtitle')} />
      <div className="flex flex-col gap-4">
        <Card title={t('technical.awaiting_review', { count: waiting.length })}>
          {waiting.length === 0 ? (
            <EmptyState title={t('technical.nothing_waiting')} />
          ) : (
            <ul className="text-sm">
              {waiting.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-silver-200 py-3 first:border-0">
                  <div>
                    <Link prefetch={false} href={`/surveys/${s.id}`} className="font-mono font-semibold underline">{s.survey_number}</Link>
                    <span className="ml-2">{site(s)}</span>
                    <p className="text-xs text-silver-700">
                      {t('technical.submitted_ago', { days: days(s.rev?.submitted_at ?? null), date: dt(s.rev?.submitted_at, locale) })} · {t('technical.revision_no', { no: s.rev?.revision_no ?? 1 })} · {t('technical.gate1_passed')}
                    </p>
                  </div>
                  <StartReviewButton surveyId={s.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('technical.open_reviews', { count: open.length })}>
          {open.length === 0 ? (
            <EmptyState title={t('technical.no_open_reviews')} />
          ) : (
            <ul className="text-sm">
              {open.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                  <Link prefetch={false} href={`/technical/reviews/${r.id}`} className="font-mono font-semibold underline">{r.review_number}</Link>
                  <span>{site(surveyById.get(r.survey_id))}</span>
                  <StateBadge state={r.status} labelText={t(`technical.state.${r.status}`)} />
                  <span className="text-xs text-silver-700">{t('technical.waiting_days', { days: days(r.updated_at) })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('technical.needs_configuration', { count: needsConfig.length })}>
          {needsConfig.length === 0 ? (
            <EmptyState title={t('technical.no_configuration_pending')} />
          ) : (
            <ul className="text-sm">
              {needsConfig.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                  <Link prefetch={false} href={`/technical/reviews/${r.id}`} className="font-mono font-semibold underline">{r.review_number}</Link>
                  <span>{site(surveyById.get(r.survey_id))}</span>
                  <StateBadge state={r.status} labelText={t(`technical.state.${r.status}`)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('technical.documents_in_review', { count: (docs.data ?? []).length })}>
          {(docs.data ?? []).length === 0 ? (
            <EmptyState title={t('technical.no_documents_in_review')} />
          ) : (
            <ul className="text-sm">
              {(docs.data ?? []).map((d: any) => {
                const head = docById.get(d.document_id);
                const reviewId = reviewByLead.get(head?.lead_id);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                    <span className="font-mono">{head?.document_number}</span>
                    <span>{head?.title}</span>
                    <span className="text-xs text-silver-700">{t('technical.revision_no', { no: d.revision_no })} · {dt(d.submitted_at, locale)}</span>
                    {reviewId ? <Link prefetch={false} href={`/technical/reviews/${reviewId}#documents`} className="underline">{t('common.open')}</Link> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

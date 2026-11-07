import { notFound } from 'next/navigation';
import { allowedActions, fromServerError, surveyMachine } from '@aiec/domain';
import { Card, EmptyState, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { getT } from '@/lib/i18n';
import { Observations } from '@/components/observations';
import { can, getContext } from '@/lib/context';
import { dt, istNowLocal, phone } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { CancelSurveyForm, GpsReviewForm, RequestRevisionForm, RescheduleForm } from './survey-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('survey.title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SurveyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const d = (iso: string | null | undefined) => dt(iso, locale);
  const revStatus = (st: string) => t(`enum.revision_status.${st}`);
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const supabase = await supabaseServer();

  const { data: survey, error } = await supabase.from('surveys').select('*, sites(*)').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!survey) notFound();

  const [{ data: revisions }, { data: evidence }, { data: lead }] = await Promise.all([
    supabase.from('survey_revisions').select('id, revision_no, status, data, submitted_at, revision_reason, survey_measurements(key, value_mm, entered_value, entered_unit, level_label)').eq('survey_id', id).order('revision_no', { ascending: false }),
    supabase.from('evidence_files').select('id, category, storage_path, mime_type, captured_at, server_received_at, source, source_exception_reason, status').eq('survey_id', id).order('captured_at'),
    supabase.from('leads').select('id, lead_number, owner_user_id').eq('id', survey.lead_id).maybeSingle(),
  ]);

  // Short-lived signed URLs for private evidence (§51.2); never public links.
  const signed = new Map<string, string>();
  const live = (evidence ?? []).filter((e) => e.status === 'active');
  if (live.length > 0) {
    const { data: urls } = await supabase.storage.from('evidence').createSignedUrls(live.map((e) => e.storage_path), 300);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  const perms = new Set(ctx.permissions);
  const actions = new Set(allowedActions(surveyMachine, survey.status, perms));
  const isScheduler = !!lead && lead.owner_user_id === ctx.user_id && can(ctx, 'survey.schedule');
  const canReview = actions.has('request_revision');
  const canReschedule = isScheduler && actions.has('reschedule');
  const canCancel = isScheduler && actions.has('cancel');
  const gpsPending = survey.gps_status && survey.gps_status !== 'verified' && !survey.gps_exception_decision && can(ctx, 'survey.gps_exception.review') && survey.surveyor_id !== ctx.user_id;
  const { data: surveyors } = canReschedule ? await supabase.rpc('list_assignable_users', { p_purpose: 'surveyor' }) : { data: [] };
  const current = revisions?.find((r) => r.id === survey.current_revision_id) ?? revisions?.[0];

  return (
    <>
      <PageHeader
        title={`${survey.survey_number} · ${survey.sites?.name ?? ''}`}
        subtitle={lead ? t('survey.lead_ref', { number: lead.lead_number }) : undefined}
        actions={<StateBadge state={survey.status} labelText={t(`survey.state.${survey.status}`)} />}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('survey.appointment')}>
          <KeyValue
            items={[
              [t('survey.scheduled'), `${d(survey.scheduled_start)} → ${d(survey.scheduled_end)}`],
              [t('field.scope'), survey.scope],
              [t('survey.site_contact'), `${survey.site_contact_name} · ${phone(survey.site_contact_phone)}`],
              [t('survey.instructions'), survey.special_instructions ?? '—'],
              [t('survey.status_note'), survey.status_reason ?? '—'],
            ]}
          />
        </Card>
        <Card title={t('survey.checkin')}>
          <KeyValue
            items={[
              [t('survey.checked_in_server'), d(survey.checked_in_at)],
              [t('survey.device_time'), d(survey.check_in_client_time)],
              [t('survey.gps'), survey.gps_status ? (survey.gps_status === 'verified' ? t('survey.gps_verified_acc', { metres: survey.check_in_accuracy_m }) : t(`enum.gps.${survey.gps_status}`)) : t('survey.not_checked_in')],
              [t('survey.exception_reason'), survey.gps_exception_reason ?? '—'],
              [t('survey.exception_review'), survey.gps_exception_decision ? `${t(`enum.gps_decision.${survey.gps_exception_decision}`)} · ${d(survey.gps_exception_reviewed_at)}` : '—'],
            ]}
          />
        </Card>
      </div>

      <Card title={current ? t('survey.revision_title', { no: current.revision_no, status: revStatus(current.status) }) : t('survey.data')} className="mt-4">
        {current ? (
          <>
            {current.revision_reason ? <p className="mb-2 text-sm text-warn-700">{t('survey.revision_reason', { reason: current.revision_reason })}</p> : null}
            <h3 className="text-sm font-semibold">{t('survey.measurements_heading')}</h3>
            {current.survey_measurements?.length ? (
              <table className="mt-2 w-full text-left text-sm">
                <thead className="text-xs uppercase text-silver-700">
                  <tr><th className="py-1 pr-3">{t('survey.col_measurement')}</th><th className="py-1 pr-3">{t('survey.col_level')}</th><th className="py-1 pr-3">{t('survey.col_value_mm')}</th><th className="py-1 pr-3">{t('survey.col_as_entered')}</th></tr>
                </thead>
                <tbody>
                  {current.survey_measurements.map((m: any) => (
                    <tr key={`${m.key}-${m.level_label}`} className="border-t border-silver-200">
                      <td className="py-1 pr-3">{t(`measure.${m.key}`)}</td>
                      <td className="py-1 pr-3">{m.level_label || '—'}</td>
                      <td className="py-1 pr-3 font-mono">{m.value_mm}</td>
                      <td className="py-1 pr-3 font-mono">{m.entered_value} {m.entered_unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-silver-700">{t('survey.no_measurements')}</p>
            )}
            <h3 className="mt-4 text-sm font-semibold">{t('survey.observations')}</h3>
            <Observations data={(current.data ?? {}) as Record<string, unknown>} t={t} />
          </>
        ) : (
          <EmptyState title={t('survey.no_data')} />
        )}
        {revisions && revisions.length > 1 ? (
          <p className="mt-3 text-xs text-silver-700">
            {t('survey.earlier_revisions', { list: revisions.filter((r) => r.id !== current?.id).map((r) => t('survey.rev_short', { no: r.revision_no, status: revStatus(r.status) })).join(', ') })}
          </p>
        ) : null}
      </Card>

      <Card title={t('survey.evidence')} className="mt-4">
        {evidence && evidence.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {evidence.map((e) => (
              <li key={e.id} className="rounded-md border border-silver-200 p-3 text-sm">
                <p className="font-semibold">{t(`enum.evidence.${e.category}`)}</p>
                <p className="text-xs text-silver-700">{t('survey.evidence_times', { captured: d(e.captured_at), received: d(e.server_received_at) })}</p>
                <p className="text-xs text-silver-700">
                  {t('survey.evidence_source', { source: t(`enum.evidence_source.${e.source}`) })}
                  {e.source_exception_reason ? ` — ${e.source_exception_reason}` : ''}
                </p>
                {e.status === 'superseded' ? (
                  <p className="text-xs font-semibold text-warn-700">{t('survey.superseded')}</p>
                ) : signed.get(e.storage_path) ? (
                  <a className="text-xs font-semibold underline" href={signed.get(e.storage_path)} target="_blank" rel="noreferrer">
                    {t('survey.open_file')}
                  </a>
                ) : (
                  <p className="text-xs text-silver-700">{t('survey.file_unavailable')}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('survey.no_evidence')} body={t('survey.no_evidence_body')} />
        )}
      </Card>

      {canReview ? (
        <Card title={t('survey.review_title')} className="mt-4">
          <RequestRevisionForm surveyId={id} version={survey.version} />
          <p className="mt-2 text-xs text-silver-700">{t('survey.review_note')}</p>
        </Card>
      ) : null}
      {gpsPending ? (
        <Card title={t('survey.gps_review_title')} className="mt-4">
          <GpsReviewForm surveyId={id} />
        </Card>
      ) : null}
      {canReschedule ? (
        <Card title={t('survey.reschedule')} className="mt-4">
          <RescheduleForm surveyId={id} version={survey.version} surveyors={(surveyors as { id: string; full_name: string }[] | null) ?? []} minLocal={istNowLocal()} />
        </Card>
      ) : null}
      {canCancel ? (
        <Card title={t('survey.cancel')} className="mt-4">
          <CancelSurveyForm surveyId={id} version={survey.version} />
        </Card>
      ) : null}
    </>
  );
}

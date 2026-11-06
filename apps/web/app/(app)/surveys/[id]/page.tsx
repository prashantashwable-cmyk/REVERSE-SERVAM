import { notFound } from 'next/navigation';
import { allowedActions, fromServerError, surveyMachine, t } from '@aiec/domain';
import { Card, EmptyState, ErrorPanel, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { can, getContext } from '@/lib/context';
import { dt, istNowLocal, phone } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { CancelSurveyForm, GpsReviewForm, RequestRevisionForm, RescheduleForm } from './survey-forms';

export const metadata = { title: 'Survey' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SurveyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel error={result.error} />;
  const { ctx } = result;
  const supabase = await supabaseServer();

  const { data: survey, error } = await supabase.from('surveys').select('*, sites(*)').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel error={fromServerError(error)} />;
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
        subtitle={lead ? `Lead ${lead.lead_number}` : undefined}
        actions={<StateBadge state={survey.status} labelText={t(`survey.state.${survey.status}`)} />}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Appointment">
          <KeyValue
            items={[
              ['Scheduled', `${dt(survey.scheduled_start)} → ${dt(survey.scheduled_end)}`],
              ['Scope', survey.scope],
              ['Site contact', `${survey.site_contact_name} · ${phone(survey.site_contact_phone)}`],
              ['Instructions', survey.special_instructions ?? '—'],
              ['Status note', survey.status_reason ?? '—'],
            ]}
          />
        </Card>
        <Card title="Check-in">
          <KeyValue
            items={[
              ['Checked in (server time)', dt(survey.checked_in_at)],
              ['Device time', dt(survey.check_in_client_time)],
              ['GPS', survey.gps_status ? (survey.gps_status === 'verified' ? `Verified (±${survey.check_in_accuracy_m} m)` : survey.gps_status.replace(/_/g, ' ')) : 'Not checked in'],
              ['Exception reason', survey.gps_exception_reason ?? '—'],
              ['Exception review', survey.gps_exception_decision ? `${survey.gps_exception_decision} · ${dt(survey.gps_exception_reviewed_at)}` : '—'],
            ]}
          />
        </Card>
      </div>

      <Card title={current ? `Revision ${current.revision_no} (${current.status})` : 'Survey data'} className="mt-4">
        {current ? (
          <>
            {current.revision_reason ? <p className="mb-2 text-sm text-warn-700">Revision requested: {current.revision_reason}</p> : null}
            <h3 className="text-sm font-semibold">Measurements (normalized to mm; entered value preserved)</h3>
            {current.survey_measurements?.length ? (
              <table className="mt-2 w-full text-left text-sm">
                <thead className="text-xs uppercase text-silver-700">
                  <tr><th className="py-1 pr-3">Measurement</th><th className="py-1 pr-3">Level</th><th className="py-1 pr-3">Value (mm)</th><th className="py-1 pr-3">As entered</th></tr>
                </thead>
                <tbody>
                  {current.survey_measurements.map((m: any) => (
                    <tr key={`${m.key}-${m.level_label}`} className="border-t border-silver-200">
                      <td className="py-1 pr-3">{m.key.replace(/_/g, ' ')}</td>
                      <td className="py-1 pr-3">{m.level_label || '—'}</td>
                      <td className="py-1 pr-3 font-mono">{m.value_mm}</td>
                      <td className="py-1 pr-3 font-mono">{m.entered_value} {m.entered_unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-silver-700">No measurements yet.</p>
            )}
            <h3 className="mt-4 text-sm font-semibold">Observations</h3>
            <pre className="mt-1 max-h-80 overflow-auto rounded bg-silver-100 p-3 text-xs">{JSON.stringify(current.data, null, 2)}</pre>
          </>
        ) : (
          <EmptyState title="No data captured yet" />
        )}
        {revisions && revisions.length > 1 ? (
          <p className="mt-3 text-xs text-silver-700">Earlier revisions are preserved: {revisions.filter((r) => r.id !== current?.id).map((r) => `rev ${r.revision_no} (${r.status})`).join(', ')}.</p>
        ) : null}
      </Card>

      <Card title="Evidence" className="mt-4">
        {evidence && evidence.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {evidence.map((e) => (
              <li key={e.id} className="rounded-md border border-silver-200 p-3 text-sm">
                <p className="font-semibold">{e.category.replace(/^doc_/, 'document: ').replace(/_/g, ' ')}</p>
                <p className="text-xs text-silver-700">Captured {dt(e.captured_at)} · received {dt(e.server_received_at)}</p>
                <p className="text-xs text-silver-700">Source: {e.source.replace(/_/g, ' ')}{e.source_exception_reason ? ` — ${e.source_exception_reason}` : ''}</p>
                {e.status === 'superseded' ? (
                  <p className="text-xs font-semibold text-warn-700">Superseded by a retake (kept for audit)</p>
                ) : signed.get(e.storage_path) ? (
                  <a className="text-xs font-semibold underline" href={signed.get(e.storage_path)} target="_blank" rel="noreferrer">
                    Open file (link expires in 5 minutes)
                  </a>
                ) : (
                  <p className="text-xs text-silver-700">File link unavailable</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No evidence yet" body="Surveyors capture photos and documents in the mobile app." />
        )}
      </Card>

      {canReview ? (
        <Card title="Technical review: return for revision" className="mt-4">
          <RequestRevisionForm surveyId={id} version={survey.version} />
          <p className="mt-2 text-xs text-silver-700">Feasibility decisions and configuration approval are delivered in Slice 3.</p>
        </Card>
      ) : null}
      {gpsPending ? (
        <Card title="Review GPS / check-in exception" className="mt-4">
          <GpsReviewForm surveyId={id} />
        </Card>
      ) : null}
      {canReschedule ? (
        <Card title="Reschedule" className="mt-4">
          <RescheduleForm surveyId={id} version={survey.version} surveyors={(surveyors as { id: string; full_name: string }[] | null) ?? []} minLocal={istNowLocal()} />
        </Card>
      ) : null}
      {canCancel ? (
        <Card title="Cancel survey" className="mt-4">
          <CancelSurveyForm surveyId={id} version={survey.version} />
        </Card>
      ) : null}
    </>
  );
}

import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { allowedActions, fromServerError, leadMachine } from '@aiec/domain';
import { Card, EmptyState, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { getT } from '@/lib/i18n';
import { can, getContext } from '@/lib/context';
import { dt, istNowLocal, phone } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { ActivityForm, AssignForm, CloseLeadForm, QualifyForm, ScheduleSurveyForm } from './lead-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('lead.title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const d = (iso: string | null | undefined) => dt(iso, locale);
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const supabase = await supabaseServer();

  const { data: lead, error } = await supabase.from('leads').select('*, sites(*)').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!lead) notFound(); // Not visible under RLS looks identical to non-existent (no existence leak).

  const [{ data: activities }, { data: surveys }, { data: decisions }] = await Promise.all([
    supabase.from('lead_activities').select('id, activity_type, outcome, summary, occurred_at, next_follow_up_at, no_action_reason').eq('lead_id', id).order('occurred_at', { ascending: false }).limit(50),
    supabase.from('surveys').select('id, survey_number, status, scheduled_start, scheduled_end').eq('lead_id', id).order('created_at', { ascending: false }),
    supabase.from('lead_duplicate_decisions').select('id, decision, match_reasons, reason, decided_at').eq('lead_id', id),
  ]);

  const perms = new Set(ctx.permissions);
  const isOwner = lead.owner_user_id === ctx.user_id;
  const allowed = new Set(allowedActions(leadMachine, lead.status, perms));
  const open = ['assigned', 'contacted', 'qualified'].includes(lead.status);
  const canRecord = isOwner && open && can(ctx, 'lead.activity.record');
  const canQualify = isOwner && allowed.has('qualify');
  const canClose = isOwner && (allowed.has('close_lost') || allowed.has('mark_invalid'));
  const canSchedule = isOwner && lead.status === 'qualified' && can(ctx, 'survey.schedule');
  const assignMode = allowed.has('assign') ? 'assign' : allowed.has('reassign') ? 'reassign' : allowed.has('reopen') ? 'reopen' : null;

  const [surveyors, owners] = await Promise.all([
    canSchedule ? supabase.rpc('list_assignable_users', { p_purpose: 'surveyor' }) : Promise.resolve({ data: [] }),
    assignMode ? supabase.rpc('list_assignable_users', { p_purpose: 'lead_owner' }) : Promise.resolve({ data: [] }),
  ]);

  return (
    <>
      <PageHeader
        title={`${lead.lead_number} · ${lead.project_name}`}
        subtitle={t('lead.created_on', { date: d(lead.created_at) })}
        actions={<StateBadge state={lead.status} labelText={t(`lead.state.${lead.status}`)} />}
      />
      {created ? (
        <p role="status" className="mb-4 rounded-md bg-ok-50 px-3 py-2 text-sm text-ok-700">
          {t('lead.created_banner')}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('lead.overview')}>
          <KeyValue
            items={[
              [t('field.contact_name'), lead.contact_name],
              [t('field.phone'), phone(lead.phone_e164)],
              [t('field.alternate_phone'), phone(lead.alternate_phone_e164)],
              [t('field.email'), lead.email ?? '—'],
              [t('field.customer_type'), t(`enum.customer_type.${lead.customer_type}`)],
              [t('field.builder_name'), lead.builder_name ?? '—'],
              [t('field.lift_requirement'), lead.lift_requirement],
              [t('lead.floors_stops'), `${lead.floors_count ?? t('lead.tbc')} / ${lead.stops_count ?? t('lead.tbc')}`],
              [t('field.source'), t(`enum.source.${lead.source}`)],
              [t('field.next_action_at'), `${d(lead.next_action_at)}${lead.no_action_reason ? ` — ${lead.no_action_reason}` : ''}`],
              [t('lead.score'), lead.score === null ? '—' : lead.score_override_reason ? t('lead.score_override_note', { score: lead.score, computed: lead.score_computed }) : String(lead.score)],
              [t('lead.lost_reason'), lead.lost_reason ? `${t(`enum.lost_reason.${lead.lost_reason}`)} — ${lead.closed_reason}` : '—'],
            ]}
          />
        </Card>
        <Card title={t('lead.site')}>
          <KeyValue
            items={[
              [t('field.site_name'), lead.sites?.name ?? '—'],
              [t('lead.address'), [lead.sites?.address_line, lead.sites?.locality].filter(Boolean).join(', ') || '—'],
              [t('lead.city_zone'), [lead.sites?.city, lead.sites?.zone].filter(Boolean).join(' / ')],
              [t('field.pincode'), lead.sites?.pincode ?? '—'],
              [t('lead.map_pin'), !lead.sites || lead.sites.location_source === 'unknown' ? t('lead.map_not_captured') : t('lead.map_captured', { source: t(`enum.location_source.${lead.sites.location_source}`) })],
            ]}
          />
        </Card>
      </div>

      {lead.score_explanation ? (
        <Card title={t('lead.score_explanation')} className="mt-4">
          <ul className="text-sm">
            {(lead.score_explanation as { key: string; points: number; matched: boolean }[]).map((e) => (
              <li key={e.key}>
                {e.matched ? '✓' : '—'} {t(`field.${e.key}`)}: {t('lead.score_points', { points: e.points })}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-silver-700">{t('lead.score_disclaimer')}</p>
        </Card>
      ) : null}

      <Card title={t('lead.surveys')} className="mt-4">
        {surveys && surveys.length > 0 ? (
          <ul className="text-sm">
            {surveys.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                <Link prefetch={false} className="font-mono font-semibold underline" href={`/surveys/${s.id}`}>{s.survey_number}</Link>
                <StateBadge state={s.status} labelText={t(`survey.state.${s.status}`)} />
                <span className="text-silver-700">{d(s.scheduled_start)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('lead.no_survey')} body={lead.status === 'qualified' ? t('lead.no_survey_book') : t('lead.no_survey_wait')} />
        )}
      </Card>

      {canSchedule ? (
        <Card title={t('lead.book_survey')} className="mt-4">
          {(surveyors.data as { id: string; full_name: string }[] | null)?.length ? (
            <ScheduleSurveyForm leadId={id} operationId={randomUUID()} surveyors={surveyors.data as { id: string; full_name: string }[]} defaultContact={lead.contact_name} minLocal={istNowLocal()} />
          ) : (
            <EmptyState title={t('lead.no_surveyors')} body={t('lead.no_surveyors_body')} />
          )}
        </Card>
      ) : null}

      {canRecord ? (
        <Card title={t('lead.record_activity')} className="mt-4">
          <ActivityForm leadId={id} operationId={randomUUID()} nowLocal={istNowLocal()} />
        </Card>
      ) : null}

      {canQualify ? (
        <Card title={lead.status === 'qualified' ? t('lead.update_qualification') : t('lead.qualify')} className="mt-4">
          <QualifyForm leadId={id} version={lead.version} current={lead.qualification} />
        </Card>
      ) : null}

      {assignMode ? (
        <Card title={assignMode === 'reopen' ? t('lead.reopen') : assignMode === 'reassign' ? t('lead.reassign') : t('lead.assign')} className="mt-4">
          <AssignForm leadId={id} version={lead.version} owners={(owners.data as { id: string; full_name: string }[] | null) ?? []} mode={assignMode} />
        </Card>
      ) : null}

      {canClose ? (
        <Card title={t('lead.close')} className="mt-4">
          <CloseLeadForm leadId={id} version={lead.version} />
        </Card>
      ) : null}

      <Card title={t('lead.history')} className="mt-4">
        {activities && activities.length > 0 ? (
          <ol className="text-sm">
            {activities.map((a) => (
              <li key={a.id} className="border-t border-silver-200 py-2 first:border-0">
                <p>
                  <span className="font-semibold">{t(`enum.activity_type.${a.activity_type}`)}</span>
                  {a.outcome ? ` · ${t(`enum.call_outcome.${a.outcome}`)}` : ''} · {d(a.occurred_at)}
                </p>
                <p className="text-silver-700">{a.summary}</p>
                <p className="text-xs text-silver-700">{t('lead.history_next', { when: a.next_follow_up_at ? d(a.next_follow_up_at) : t('lead.history_none', { reason: a.no_action_reason ?? '' }) })}</p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title={t('lead.no_activities')} />
        )}
      </Card>

      {decisions && decisions.length > 0 ? (
        <Card title={t('lead.dup_decisions')} className="mt-4">
          <ul className="text-sm">
            {decisions.map((x) => (
              <li key={x.id}>
                {t('lead.dup_decision_line', { decision: t(`enum.dup_decision.${x.decision}`), reasons: x.match_reasons.map((r: string) => t(`dup.reason.${r}`)).join(', '), reason: x.reason, date: d(x.decided_at) })}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

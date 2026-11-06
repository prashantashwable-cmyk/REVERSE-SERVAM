import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { allowedActions, fromServerError, leadMachine, t } from '@aiec/domain';
import { Card, EmptyState, ErrorPanel, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { can, getContext } from '@/lib/context';
import { dt, istNowLocal, phone } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { ActivityForm, AssignForm, CloseLeadForm, QualifyForm, ScheduleSurveyForm } from './lead-forms';

export const metadata = { title: 'Lead' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel error={result.error} />;
  const { ctx } = result;
  const supabase = await supabaseServer();

  const { data: lead, error } = await supabase.from('leads').select('*, sites(*)').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel error={fromServerError(error)} />;
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
        subtitle={`Created ${dt(lead.created_at)}`}
        actions={<StateBadge state={lead.status} labelText={t(`lead.state.${lead.status}`)} />}
      />
      {created ? (
        <p role="status" className="mb-4 rounded-md bg-ok-50 px-3 py-2 text-sm text-ok-700">
          Lead created.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Overview">
          <KeyValue
            items={[
              ['Contact', lead.contact_name],
              ['Phone', phone(lead.phone_e164)],
              ['Alternate phone', phone(lead.alternate_phone_e164)],
              ['Email', lead.email ?? '—'],
              ['Customer type', lead.customer_type.replace(/_/g, ' ')],
              ['Builder', lead.builder_name ?? '—'],
              ['Requirement', lead.lift_requirement],
              ['Floors / stops', `${lead.floors_count ?? 'TBC'} / ${lead.stops_count ?? 'TBC'}`],
              ['Source', lead.source.replace(/_/g, ' ')],
              ['Next action', `${dt(lead.next_action_at)}${lead.no_action_reason ? ` — ${lead.no_action_reason}` : ''}`],
              ['Score', lead.score === null ? '—' : `${lead.score}${lead.score_override_reason ? ` (override; computed ${lead.score_computed})` : ''}`],
              ['Lost reason', lead.lost_reason ? `${lead.lost_reason.replace(/_/g, ' ')} — ${lead.closed_reason}` : '—'],
            ]}
          />
        </Card>
        <Card title="Site">
          <KeyValue
            items={[
              ['Site', lead.sites?.name ?? '—'],
              ['Address', [lead.sites?.address_line, lead.sites?.locality].filter(Boolean).join(', ') || '—'],
              ['City / zone', [lead.sites?.city, lead.sites?.zone].filter(Boolean).join(' / ')],
              ['PIN', lead.sites?.pincode ?? '—'],
              ['Map pin', lead.sites?.location_source === 'unknown' ? 'Not captured' : `Captured (${lead.sites?.location_source})`],
            ]}
          />
        </Card>
      </div>

      {lead.score_explanation ? (
        <Card title="Score explanation" className="mt-4">
          <ul className="text-sm">
            {(lead.score_explanation as { key: string; points: number; matched: boolean }[]).map((e) => (
              <li key={e.key}>
                {e.matched ? '✓' : '—'} {e.key.replace(/_/g, ' ')}: {e.points} points
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-silver-700">The score prioritizes sales follow-up only; it is not a credit or legal decision.</p>
        </Card>
      ) : null}

      <Card title="Surveys" className="mt-4">
        {surveys && surveys.length > 0 ? (
          <ul className="text-sm">
            {surveys.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                <Link className="font-mono font-semibold underline" href={`/surveys/${s.id}`}>{s.survey_number}</Link>
                <StateBadge state={s.status} labelText={t(`survey.state.${s.status}`)} />
                <span className="text-silver-700">{dt(s.scheduled_start)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No survey yet" body={lead.status === 'qualified' ? 'Book a survey below.' : 'A survey can be booked once the lead is qualified.'} />
        )}
      </Card>

      {canSchedule ? (
        <Card title="Book a survey" className="mt-4">
          {(surveyors.data as { id: string; full_name: string }[] | null)?.length ? (
            <ScheduleSurveyForm leadId={id} operationId={randomUUID()} surveyors={surveyors.data as { id: string; full_name: string }[]} defaultContact={lead.contact_name} minLocal={istNowLocal()} />
          ) : (
            <EmptyState title="No active surveyors" body="Ask an administrator to activate a surveyor account." />
          )}
        </Card>
      ) : null}

      {canRecord ? (
        <Card title="Record activity" className="mt-4">
          <ActivityForm leadId={id} operationId={randomUUID()} nowLocal={istNowLocal()} />
        </Card>
      ) : null}

      {canQualify ? (
        <Card title={lead.status === 'qualified' ? 'Update qualification' : 'Qualify'} className="mt-4">
          <QualifyForm leadId={id} version={lead.version} current={lead.qualification} />
        </Card>
      ) : null}

      {assignMode ? (
        <Card title={assignMode === 'reopen' ? 'Reopen lead' : assignMode === 'reassign' ? 'Reassign lead' : 'Assign lead'} className="mt-4">
          <AssignForm leadId={id} version={lead.version} owners={(owners.data as { id: string; full_name: string }[] | null) ?? []} mode={assignMode} />
        </Card>
      ) : null}

      {canClose ? (
        <Card title="Close lead" className="mt-4">
          <CloseLeadForm leadId={id} version={lead.version} />
        </Card>
      ) : null}

      <Card title="Communication history" className="mt-4">
        {activities && activities.length > 0 ? (
          <ol className="text-sm">
            {activities.map((a) => (
              <li key={a.id} className="border-t border-silver-200 py-2 first:border-0">
                <p>
                  <span className="font-semibold">{a.activity_type.replace(/_/g, ' ')}</span>
                  {a.outcome ? ` · ${a.outcome.replace(/_/g, ' ')}` : ''} · {dt(a.occurred_at)}
                </p>
                <p className="text-silver-700">{a.summary}</p>
                <p className="text-xs text-silver-700">Next: {a.next_follow_up_at ? dt(a.next_follow_up_at) : `none — ${a.no_action_reason}`}</p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No activities recorded" />
        )}
      </Card>

      {decisions && decisions.length > 0 ? (
        <Card title="Duplicate review decisions" className="mt-4">
          <ul className="text-sm">
            {decisions.map((d) => (
              <li key={d.id}>
                {d.decision.replace(/_/g, ' ')} (matched on {d.match_reasons.join(', ')}) — {d.reason} · {dt(d.decided_at)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

import { READINESS_DIMENSIONS, SITE_READINESS_ITEMS, formatInr } from '@aiec/domain';
import { Badge, Card, KeyValue, StateBadge } from '@/components/ui';
import { can, type UserContext } from '@/lib/context';
import { dt } from '@/lib/format';
import type { Locale } from '@aiec/domain';
import { staffNames } from '@/lib/people';
import { supabaseServer } from '@/lib/supabase/server';
import {
  AssignmentAdminForm,
  CommentReportForm,
  InvitePartnerForm,
  ProjectExecutionButton,
  ResolveIncidentForm,
  SiteReadinessForm,
} from '../../partners/partner-admin-forms';

type T = (key: string, params?: Record<string, string | number>) => string;
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));
const isoDate = (offsetDays: number) => new Date(Date.now() + 330 * 60000 + offsetDays * 864e5).toISOString().slice(0, 10);

/** OM02–OM06 for one project: readiness, site checklist, partner, tasks, incidents and daily reports. */
export async function ExecutionSection({ project, ctx, t, locale }: { project: any; ctx: UserContext; t: T; locale: Locale }) {
  const supabase = await supabaseServer();
  const pid = project.id as string;
  const planning = ['planning', 'installation_ready'].includes(project.status);
  const [{ data: readiness }, { data: site }, { data: assignments }, { data: tasks }, { data: incidents }, { data: reports }, { data: config }] = await Promise.all([
    supabase.rpc('project_readiness', { p_project_id: pid }),
    supabase.from('site_readiness_checks').select('*').eq('project_id', pid).order('revision_no', { ascending: false }).limit(1),
    supabase.from('project_partner_assignments').select('*').eq('project_id', pid).order('invited_at', { ascending: false }),
    supabase.from('project_tasks').select('id, code, sequence, status, assignee_user_id, due_date, safety_stop, block_category').eq('project_id', pid).order('sequence'),
    supabase.from('execution_incidents').select('*').eq('project_id', pid).order('reported_at', { ascending: false }),
    supabase.from('daily_reports').select('*').eq('project_id', pid).order('report_date', { ascending: false }).limit(14),
    supabase.from('configuration_revisions').select('lift_category').eq('id', project.configuration_revision_id).maybeSingle(),
  ]);
  const open = (assignments ?? []).find((a: any) => ['invited', 'clarification_requested', 'accepted'].includes(a.status));
  const reportIds = (reports ?? []).map((r: any) => r.id);
  const [{ data: comments }, { data: orgs }] = await Promise.all([
    reportIds.length ? supabase.from('daily_report_comments').select('*').in('report_id', reportIds).order('created_at') : Promise.resolve({ data: [] as any[] }),
    supabase.from('organizations').select('id, name').eq('kind', 'partner').eq('status', 'active').order('name'),
  ]);
  const orgName = new Map((orgs ?? []).map((o: any) => [o.id, o.name]));
  const people = await staffNames([
    ...(tasks ?? []).map((x: any) => x.assignee_user_id),
    ...(incidents ?? []).map((x: any) => x.reported_by),
    ...(reports ?? []).flatMap((r: any) => [r.submitted_by, ...(r.present_user_ids ?? [])]),
    ...(comments ?? []).map((c: any) => c.author_id),
  ]);
  const name = (id: string | null) => (id ? people.get(id) ?? t('common.unnamed_user') : '—');
  let partnerOptions: { id: string; label: string; eligible: boolean; reasons: string }[] = [];
  if (!open && planning && can(ctx, 'partner.assign')) {
    const elig = await Promise.all((orgs ?? []).map((o: any) => supabase.rpc('partner_eligibility', { p_org_id: o.id, p_lift_category: config?.lift_category ?? null })));
    partnerOptions = (orgs ?? []).map((o: any, i: number) => {
      const e = elig[i]?.data as { status: string; eligible: boolean; failures: { type: string; reason: string }[] } | null;
      const reasons = e ? [...(['approved', 'conditional_approval'].includes(e.status) ? [] : [t(`partner.state.${e.status}`)]),
        ...e.failures.map((x) => t('partners.failure', { document: t(`enum.partner_document.${x.type}`), reason: t(`partners.reason.${x.reason}`) }))].join('; ') : '—';
      return { id: o.id, label: o.name, eligible: !!e?.eligible, reasons };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible));
  }
  const lastSite = site?.[0];
  const previous = Object.fromEntries(((lastSite?.items ?? []) as { key: string; result: string; note?: string | null }[]).map((i) => [i.key, i]));
  const r = (readiness ?? {}) as Record<string, boolean>;
  const allReady = READINESS_DIMENSIONS.every((d) => r[d]);

  return (
    <>
      <Card title={t('execution.readiness_title')} className="mt-4">
        <p className="mb-3 text-sm text-silver-700">{t('execution.readiness_intro')}</p>
        <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
          {READINESS_DIMENSIONS.map((d) => (
            <li key={d} className="flex items-center gap-2">
              {r[d] ? <Badge tone="ok">{t('execution.ready')}</Badge> : <Badge tone="warn">{t('execution.not_ready')}</Badge>}
              <span>{t(`execution.dimension.${d}`)}</span>
            </li>
          ))}
        </ul>
        {can(ctx, 'project.plan') && project.status === 'planning' ? (
          <div className="mt-4 border-t border-silver-200 pt-4">
            <p className="mb-2 text-sm text-silver-700">{allReady ? t('execution.all_ready') : t('execution.not_all_ready')}</p>
            <ProjectExecutionButton projectId={pid} version={project.version} action="mark_installation_ready" />
          </div>
        ) : null}
        {can(ctx, 'project.plan') && project.status === 'installation_ready' ? (
          <div className="mt-4 border-t border-silver-200 pt-4">
            <p className="mb-2 text-sm text-silver-700">{t('execution.start_hint')}</p>
            <ProjectExecutionButton projectId={pid} version={project.version} action="start_installation" />
          </div>
        ) : null}
      </Card>

      <Card title={t('execution.site_title')} className="mt-4">
        {lastSite ? (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {lastSite.passed ? <Badge tone="ok">{t('execution.site_passed')}</Badge> : <Badge tone="warn">{t('execution.site_failed')}</Badge>}
            <span className="text-silver-700">{t('execution.site_revision', { no: lastSite.revision_no, date: dt(lastSite.recorded_at, locale) })}</span>
          </p>
        ) : (
          <p className="mb-3 text-sm text-silver-700">{t('execution.site_none')}</p>
        )}
        {lastSite && !lastSite.passed ? (
          <ul className="mb-3 list-inside list-disc text-sm text-warn-700">
            {(lastSite.failures as { code: string; key: string }[]).map((x) => <li key={x.key}>{t(`execution.site_item.${x.key}`)}: {t(`execution.site_failure.${x.code}`)}</li>)}
          </ul>
        ) : null}
        {can(ctx, 'project.plan') && planning ? (
          <details open={!lastSite}>
            <summary className="cursor-pointer text-sm font-semibold">{lastSite ? t('execution.site_update') : t('execution.site_record')}</summary>
            <div className="mt-3"><SiteReadinessForm projectId={pid} previous={previous} /></div>
          </details>
        ) : null}
        <p className="mt-2 text-xs text-silver-700">{t('execution.site_items_count', { n: SITE_READINESS_ITEMS.length })}</p>
      </Card>

      <Card title={t('execution.partner_title')} className="mt-4">
        {(assignments ?? []).length === 0 ? <p className="mb-3 text-sm text-silver-700">{t('execution.no_partner')}</p> : null}
        {(assignments ?? []).map((a: any) => (
          <div key={a.id} className="mb-3 rounded-md border border-silver-200 p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{orgName.get(a.partner_org_id) ?? '—'}</span>
              <StateBadge state={a.status} labelText={t(`execution.assignment_state.${a.status}`)} />
            </p>
            <KeyValue
              items={[
                [t('field.scope_summary'), a.scope_summary],
                [t('execution.schedule'), t('procurement.delivery_range', { from: a.schedule_from, to: a.schedule_to })],
                [t('field.contract_value'), inr(a.contract_value_paise)],
                [t('field.payment_terms'), a.payment_terms],
                ...(a.response_reason ? [[t('field.reason'), a.response_reason] as [string, string]] : []),
              ]}
            />
            {can(ctx, 'partner.assign') && a.status === 'clarification_requested' ? (
              <div className="mt-2 border-t border-silver-200 pt-2"><AssignmentAdminForm assignmentId={a.id} version={a.version} actions={['reissue', 'withdraw']} /></div>
            ) : null}
            {can(ctx, 'partner.assign') && a.status === 'invited' ? (
              <div className="mt-2 border-t border-silver-200 pt-2"><AssignmentAdminForm assignmentId={a.id} version={a.version} actions={['withdraw']} /></div>
            ) : null}
          </div>
        ))}
        {!open && planning && can(ctx, 'partner.assign') ? (
          <div className="border-t border-silver-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold">{t('execution.invite_title')}</h3>
            {partnerOptions.some((p) => p.eligible) ? (
              <InvitePartnerForm projectId={pid} partners={partnerOptions} minDate={isoDate(0)} />
            ) : (
              <p className="text-sm text-warn-700">{t('execution.no_eligible_partner')}</p>
            )}
          </div>
        ) : null}
      </Card>

      {(tasks ?? []).length > 0 ? (
        <Card title={t('execution.tasks_title')} className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('execution.tasks_title')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-1 pr-3">{t('execution.col_task')}</th>
                  <th className="py-1 pr-3">{t('common.status')}</th>
                  <th className="py-1 pr-3">{t('field.assignee_id')}</th>
                  <th className="py-1 pr-3">{t('field.due_date')}</th>
                </tr>
              </thead>
              <tbody>
                {(tasks ?? []).map((x: any) => (
                  <tr key={x.id} className="border-t border-silver-200">
                    <td className="py-1 pr-3">{t(`work.task.${x.code}`)}</td>
                    <td className="py-1 pr-3">
                      <StateBadge state={x.status} labelText={t(`work.state.${x.status}`)} />
                      {x.safety_stop ? <span className="ml-2"><Badge tone="crit">{t('execution.safety_stop')}</Badge></span> : null}
                    </td>
                    <td className="py-1 pr-3">{name(x.assignee_user_id)}</td>
                    <td className="py-1 pr-3">{x.due_date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-silver-700">{t('execution.tasks_note')}</p>
        </Card>
      ) : null}

      {(incidents ?? []).length > 0 ? (
        <Card title={t('execution.incidents_title')} className="mt-4">
          <ul className="flex flex-col gap-3 text-sm">
            {(incidents ?? []).map((i: any) => (
              <li key={i.id} className="rounded-md border border-silver-200 p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t(`enum.blocker.${i.category}`)}</span>
                  {i.safety_stop ? <Badge tone="crit">{t('execution.safety_stop')}</Badge> : null}
                  <StateBadge state={i.status} labelText={t(`execution.incident_state.${i.status}`)} />
                </p>
                <p className="text-silver-700">{i.description} · {name(i.reported_by)} · {dt(i.reported_at, locale)}</p>
                {i.resolution ? <p className="text-silver-700">{t('execution.resolution_line', { resolution: i.resolution, date: dt(i.resolved_at, locale) })}</p> : null}
                {i.status === 'open' && can(ctx, 'project.plan') ? <div className="mt-2 border-t border-silver-200 pt-2"><ResolveIncidentForm incidentId={i.id} safetyStop={i.safety_stop} /></div> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {open?.status === 'accepted' ? (
        <Card title={t('execution.reports_title')} className="mt-4">
          {(reports ?? []).length === 0 ? (
            <p className="text-sm text-silver-700">{t('execution.no_reports')}</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {(reports ?? []).map((rep: any) => (
                <li key={rep.id} className="rounded-md border border-silver-200 p-3">
                  <p className="font-semibold">{rep.report_date} · {t('execution.present', { names: (rep.present_user_ids ?? []).map((u: string) => name(u)).join(', ') })}</p>
                  <p>{rep.work_completed}</p>
                  {rep.work_not_completed ? <p className="text-silver-700">{t('field.work_not_completed')}: {rep.work_not_completed}</p> : null}
                  {rep.blockers ? <p className="text-silver-700">{t('field.blockers')}: {rep.blockers}</p> : null}
                  {rep.material_shortage ? <p className="text-silver-700">{t('field.material_shortage')}: {rep.material_shortage}</p> : null}
                  <p className={rep.incident_declared ? 'text-crit-700' : 'text-silver-700'}>{rep.incident_declared ? t('execution.incident_declared', { notes: rep.safety_observations ?? '' }) : t('execution.no_incident')}</p>
                  <p className="text-silver-700">{t('field.next_day_plan')}: {rep.next_day_plan}</p>
                  {(comments ?? []).filter((c: any) => c.report_id === rep.id).map((c: any) => (
                    <p key={c.id} className="mt-1 rounded bg-navy-50 px-2 py-1 text-navy-700">{t('execution.comment_line', { name: name(c.author_id), comment: c.comment })}</p>
                  ))}
                  {can(ctx, 'project.plan') ? <div className="mt-2"><CommentReportForm reportId={rep.id} /></div> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}

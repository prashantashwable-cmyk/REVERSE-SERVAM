import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatInr, fromServerError } from '@aiec/domain';
import { Badge, Card, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { partnerMembership } from '@/lib/partner';
import { staffNames } from '@/lib/people';
import { supabaseServer } from '@/lib/supabase/server';
import { AddTeamMemberForm, AssignTaskForm, DailyReportForm, InvitationResponseForm, RemoveTeamMemberForm, UnblockTaskForm } from '../../partner-forms';
import { DefectActionForm } from '../../../work/work-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('partner.assignment_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));

/** LP04 invitation and LP05 project workspace: team, tasks, daily reports, incidents. */
export default async function PartnerAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const m = partnerMembership(ctx);
  if (!m || !can(ctx, 'partner.project.read')) return <PermissionDenied whatKey="partner.what" />;
  const supabase = await supabaseServer();
  const { data: a, error } = await supabase.from('project_partner_assignments').select('*').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!a) notFound();
  const accepted = a.status === 'accepted';
  const [{ data: project }, { data: team }, { data: tasks }, { data: reports }, { data: incidents }, { data: roles }, { data: workers }] = await Promise.all([
    supabase.from('projects').select('id, project_number, title, site_label, status').eq('id', a.project_id).maybeSingle(),
    accepted ? supabase.from('project_team_members').select('*').eq('assignment_id', id).order('added_at') : Promise.resolve({ data: [] as any[] }),
    accepted ? supabase.from('project_tasks').select('*').eq('assignment_id', id).order('sequence') : Promise.resolve({ data: [] as any[] }),
    accepted ? supabase.from('daily_reports').select('*').eq('assignment_id', id).order('report_date', { ascending: false }).limit(14) : Promise.resolve({ data: [] as any[] }),
    accepted ? supabase.from('execution_incidents').select('*').eq('project_id', a.project_id).eq('partner_org_id', m.organization_id).order('reported_at', { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    accepted && can(ctx, 'partner.team.manage') ? supabase.from('user_roles').select('user_id, role_code').eq('organization_id', m.organization_id).is('revoked_at', null).in('role_code', ['technician', 'partner_supervisor']) : Promise.resolve({ data: [] as any[] }),
    accepted ? supabase.from('partner_workers').select('user_id, skills').eq('organization_id', m.organization_id) : Promise.resolve({ data: [] as any[] }),
  ]);
  const taskIds = (tasks ?? []).map((x: any) => x.id);
  const { data: defects } = taskIds.length ? await supabase.from('defects').select('*').in('task_id', taskIds).order('raised_at') : { data: [] as any[] };
  const taskCode = new Map((tasks ?? []).map((x: any) => [x.id, x.code]));
  const reportIds = (reports ?? []).map((r: any) => r.id);
  const { data: comments } = reportIds.length ? await supabase.from('daily_report_comments').select('*').in('report_id', reportIds).order('created_at') : { data: [] as any[] };
  const activeTeam = (team ?? []).filter((x: any) => !x.removed_at);
  const names = await staffNames([...(team ?? []).map((x: any) => x.user_id), ...(roles ?? []).map((r: any) => r.user_id), ...(tasks ?? []).map((x: any) => x.assignee_user_id)]);
  const name = (u: string | null) => (u ? names.get(u) ?? t('common.unnamed_user') : '—');
  const skills = new Map((workers ?? []).map((w: any) => [w.user_id, w.skills as string[]]));
  const candidates = [...new Set((roles ?? []).map((r: any) => r.user_id))].filter((u) => !activeTeam.some((x: any) => x.user_id === u)).map((u) => ({ id: u, label: name(u) }));
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={project ? `${project.project_number} · ${project.title}` : t('partner.assignment_title')}
        subtitle={project?.site_label}
        actions={<StateBadge state={a.status} labelText={t(`execution.assignment_state.${a.status}`)} />}
      />
      <p className="mb-4 text-sm"><Link prefetch={false} href="/partner" className="underline">{t('partner.back_home')}</Link></p>

      <Card title={t('partner.offer')}>
        <KeyValue
          items={[
            [t('field.scope_summary'), a.scope_summary],
            [t('execution.schedule'), t('procurement.delivery_range', { from: a.schedule_from, to: a.schedule_to })],
            [t('field.contract_value'), inr(a.contract_value_paise)],
            [t('field.payment_terms'), a.payment_terms],
            [t('field.material_responsibility'), a.material_responsibility],
            [t('field.safety_requirements'), a.safety_requirements],
            [t('field.exclusions'), a.exclusions ?? '—'],
            [t('partner.offer_revision'), <span key="h" className="font-mono text-xs">{a.offer_sha256}</span>],
            ...(a.response_reason ? [[t('field.reason'), a.response_reason] as [string, string]] : []),
          ]}
        />
        {project && accepted ? <p className="mt-2 text-sm">{t('partner.project_status', { status: t(`project.state.${project.status}`) })}</p> : null}
        {can(ctx, 'partner.org.manage') && (a.status === 'invited' || a.status === 'clarification_requested') ? (
          <div className="mt-4 border-t border-silver-200 pt-4">
            <p className="mb-2 text-sm text-silver-700">{a.status === 'invited' ? t('partner.accept_hint') : t('partner.clarification_pending')}</p>
            <InvitationResponseForm assignmentId={a.id} version={a.version} offerSha256={a.offer_sha256} canAccept={a.status === 'invited'} />
          </div>
        ) : null}
      </Card>

      {accepted ? (
        <>
          <Card title={t('partner.team')} className="mt-4">
            {activeTeam.length === 0 ? <p className="mb-3 text-sm text-silver-700">{t('partner.team_empty')}</p> : (
              <ul className="mb-3 flex flex-col gap-2 text-sm">
                {activeTeam.map((x: any) => (
                  <li key={x.id} className="rounded-md border border-silver-200 p-2">
                    <p className="font-semibold">{name(x.user_id)} <span className="font-normal text-silver-700">· {(skills.get(x.user_id) ?? []).map((s) => t(`enum.skill.${s}`)).join(', ') || t('partner.no_skills')}</span></p>
                    {can(ctx, 'partner.team.manage') ? <RemoveTeamMemberForm assignmentId={a.id} userId={x.user_id} /> : null}
                  </li>
                ))}
              </ul>
            )}
            {can(ctx, 'partner.team.manage') && candidates.length > 0 ? <AddTeamMemberForm assignmentId={a.id} people={candidates} /> : null}
          </Card>

          <Card title={t('partner.tasks')} className="mt-4">
            <p className="mb-3 text-sm text-silver-700">{t('partner.tasks_intro')}</p>
            <ul className="flex flex-col gap-3 text-sm">
              {(tasks ?? []).map((x: any) => {
                const eligible = activeTeam.filter((tm: any) => (skills.get(tm.user_id) ?? []).includes(x.skill)).map((tm: any) => ({ id: tm.user_id, label: name(tm.user_id) }));
                return (
                  <li key={x.id} className="rounded-md border border-silver-200 p-3">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{x.sequence}. {t(`work.task.${x.code}`)}</span>
                      <StateBadge state={x.status} labelText={t(`work.state.${x.status}`)} />
                      {x.safety_stop ? <Badge tone="crit">{t('execution.safety_stop')}</Badge> : null}
                      <span className="text-silver-700">{t('partner.task_line', { skill: t(`enum.skill.${x.skill}`), assignee: name(x.assignee_user_id), due: x.due_date ?? '—' })}</span>
                    </p>
                    {x.prerequisites?.length ? <p className="text-xs text-silver-700">{t('work.after', { tasks: x.prerequisites.map((c: string) => t(`work.task.${c}`)).join(', ') })}</p> : null}
                    {x.block_reason ? <p className="text-warn-700">{t(`enum.blocker.${x.block_category}`)}: {x.block_reason}</p> : null}
                    {can(ctx, 'partner.task.assign') && (x.status === 'draft' || x.status === 'assigned') ? (
                      eligible.length ? <div className="mt-2"><AssignTaskForm taskId={x.id} version={x.version} people={eligible} minDate={today} /></div>
                        : <p className="mt-1 text-xs text-warn-700">{t('partner.no_skilled_member', { skill: t(`enum.skill.${x.skill}`) })}</p>
                    ) : null}
                    {can(ctx, 'partner.task.assign') && x.status === 'blocked' ? (
                      x.safety_stop ? <p className="mt-1 text-xs text-crit-700">{t('partner.safety_stop_note')}</p> : <div className="mt-2"><UnblockTaskForm taskId={x.id} version={x.version} /></div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-silver-700">{t('partner.qa_note')}</p>
          </Card>

          {(defects ?? []).length > 0 ? (
            <Card title={t('partner.defects')} className="mt-4">
              <p className="mb-2 text-sm text-silver-700">{t('partner.defects_intro')}</p>
              <ul className="flex flex-col gap-2 text-sm">
                {(defects ?? []).map((d: any) => (
                  <li key={d.id} className="rounded-md border border-silver-200 p-2">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{d.defect_number}</span>
                      <StateBadge state={d.status} labelText={t(`qa.defect_state.${d.status}`)} />
                      <Badge tone={d.severity === 'critical' ? 'crit' : 'warn'}>{t(`enum.defect_severity.${d.severity}`)}</Badge>
                      <span>{t(`work.task.${taskCode.get(d.task_id)}`)} · {t(`qa.criterion.${d.criterion_key}`)}</span>
                    </p>
                    <p className="text-silver-700">{d.location} · {d.description} · {t('qa.due', { date: d.correction_due_date })}{d.status_reason ? ` · ${d.status_reason}` : ''}</p>
                    {can(ctx, 'partner.task.assign') && d.status === 'assigned' ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <DefectActionForm defectId={d.id} version={d.version} action="acknowledge" />
                        <DefectActionForm defectId={d.id} version={d.version} action="dispute" withReason />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {(incidents ?? []).length > 0 ? (
            <Card title={t('execution.incidents_title')} className="mt-4">
              <ul className="text-sm">
                {(incidents ?? []).map((i: any) => (
                  <li key={i.id} className="border-t border-silver-200 py-2 first:border-0">
                    <span className="font-semibold">{t(`enum.blocker.${i.category}`)}</span> · <StateBadge state={i.status} labelText={t(`execution.incident_state.${i.status}`)} /> · {i.description} · {dt(i.reported_at, locale)}
                    {i.resolution ? ` · ${t('execution.resolution_line', { resolution: i.resolution, date: dt(i.resolved_at, locale) })}` : ''}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title={t('partner.daily_reports')} className="mt-4">
            {(reports ?? []).length > 0 ? (
              <ul className="mb-4 flex flex-col gap-2 text-sm">
                {(reports ?? []).map((r: any) => (
                  <li key={r.id} className="rounded-md border border-silver-200 p-2">
                    <p className="font-semibold">{r.report_date} · {r.work_completed}</p>
                    <p className="text-silver-700">{t('field.next_day_plan')}: {r.next_day_plan}</p>
                    {(comments ?? []).filter((c: any) => c.report_id === r.id).map((c: any) => <p key={c.id} className="mt-1 rounded bg-navy-50 px-2 py-1 text-navy-700">{t('partner.aiec_comment', { comment: c.comment })}</p>)}
                  </li>
                ))}
              </ul>
            ) : <p className="mb-4 text-sm text-silver-700">{t('execution.no_reports')}</p>}
            {can(ctx, 'partner.daily_report.submit') && activeTeam.length > 0 ? (
              <DailyReportForm assignmentId={a.id} operationId={randomUUID()} team={activeTeam.map((x: any) => ({ id: x.user_id, label: name(x.user_id) }))} today={today} />
            ) : null}
          </Card>
        </>
      ) : null}
    </>
  );
}

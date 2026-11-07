import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_SAFETY_CHECKS, TASK_EVIDENCE_CATEGORIES, fromServerError } from '@aiec/domain';
import { Badge, Card, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { AcceptTaskButton, ChecklistForm, CorrectionEvidenceForm, DefectActionForm, EvidenceForm, IncidentForm, ResubmitTaskButton, SafetyCheckForm, StartTaskButton, SubmitTaskButton } from '../work-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('work.task_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** WT02 task detail, WT03 safety pre-start, WT04 checklist and evidence, WT05 blocker / incident. */
export default async function WorkTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const supabase = await supabaseServer();
  const { data: task, error } = await supabase.from('project_tasks').select('*').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!task) notFound();
  const mine = task.assignee_user_id === ctx.user_id;
  const [{ data: project }, { data: checks }, { data: evidence }, { data: prereqs }, { data: stops }, { data: defects }] = await Promise.all([
    supabase.from('projects').select('id, project_number, title, site_label, status').eq('id', task.project_id).maybeSingle(),
    supabase.from('task_safety_checks').select('*').eq('task_id', id).order('recorded_at', { ascending: false }).limit(1),
    supabase.from('task_evidence').select('id, category, captured_at, server_received_at, remarks, source, defect_id').eq('task_id', id).order('server_received_at'),
    task.prerequisites?.length ? supabase.from('project_tasks').select('code, status').eq('project_id', task.project_id).in('code', task.prerequisites) : Promise.resolve({ data: [] as any[] }),
    supabase.from('execution_incidents').select('reported_at, resolved_at').eq('task_id', id).eq('safety_stop', true),
    supabase.from('defects').select('*').eq('task_id', id).order('raised_at'),
  ]);
  // The partner org owns the evidence folder; it is the organization in the assignee's partner membership.
  const partnerOrg = ctx.memberships.find((m) => m.organization_kind === 'partner')?.organization_id ?? '';
  // A pre-start recorded before the latest safety stop (or its lifting) no longer counts (Gate 11).
  const resetAt = Math.max(0, ...(stops ?? []).map((x: any) => Date.parse(x.resolved_at ?? x.reported_at)));
  const lastCheck = checks?.[0] && Date.parse(checks[0].recorded_at) > resetAt ? checks[0] : undefined;
  const todayIst = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const checkToday = lastCheck && new Date(new Date(lastCheck.recorded_at).getTime() + 330 * 60000).toISOString().slice(0, 10) === todayIst;
  const evidenceCats = (evidence ?? []).map((e: any) => e.category);
  const missingEvidence = (task.evidence_required ?? []).filter((c: string) => !evidenceCats.includes(c));
  const prereqDone = (prereqs ?? []).every((p: any) => ['submitted', 'approved', 'closed'].includes(p.status)) && (prereqs ?? []).length === (task.prerequisites ?? []).length;
  const installing = project?.status === 'installation';

  return (
    <>
      <PageHeader title={t(`work.task.${task.code}`)} subtitle={project ? `${project.project_number} · ${project.title} · ${project.site_label}` : undefined}
        actions={<StateBadge state={task.status} labelText={t(`work.state.${task.status}`)} />} />
      <p className="mb-4 text-sm"><Link prefetch={false} href="/work" className="underline">{t('work.back')}</Link></p>
      {task.safety_stop ? (
        <p role="alert" className="mb-4 rounded-md border border-crit-700/30 bg-crit-50 px-3 py-2 text-sm font-semibold text-crit-700">{t('work.safety_stop_banner')}</p>
      ) : null}

      <Card title={t('work.instructions')}>
        <ul className="mb-3 list-inside list-disc text-sm">{(task.checklist ?? []).map((k: string) => <li key={k}>{t(`work.check.${k}`)}</li>)}</ul>
        <p className="text-sm text-silver-700">{t('work.evidence_needed', { list: (task.evidence_required ?? []).map((c: string) => t(`enum.task_evidence.${c}`)).join(', ') || t('common.none') })}</p>
        {task.prerequisites?.length ? <p className="text-sm text-silver-700">{t('work.after', { tasks: task.prerequisites.map((c: string) => t(`work.task.${c}`)).join(', ') })} {prereqDone ? '' : `· ${t('work.prereq_waiting')}`}</p> : null}
        {task.due_date ? <p className="text-sm text-silver-700">{t('work.due', { date: task.due_date })}</p> : null}
        {task.block_reason ? <p className="mt-2 text-sm text-warn-700">{t(`enum.blocker.${task.block_category}`)}: {task.block_reason}</p> : null}
      </Card>

      {mine && task.status === 'assigned' ? (
        <Card title={t('work.accept_title')} className="mt-4">
          <p className="mb-2 text-sm text-silver-700">{t('work.accept_hint')}</p>
          <AcceptTaskButton taskId={task.id} version={task.version} />
        </Card>
      ) : null}

      {mine && ['accepted', 'blocked'].includes(task.status) ? (
        <Card title={t('work.safety_title')} className="mt-4">
          {lastCheck ? (
            <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              {lastCheck.can_start ? <Badge tone="ok">{t('work.safety_ok')}</Badge> : <Badge tone="crit">{t('work.safety_blocked')}</Badge>}
              <span className="text-silver-700">{dt(lastCheck.recorded_at, locale)}</span>
              {!lastCheck.can_start ? <span className="text-crit-700">{t('work.critical_missing', { list: (lastCheck.critical_failures ?? []).map((k: string) => t(`work.safety.${k}`)).join(', ') })}</span> : null}
            </p>
          ) : null}
          {task.safety_stop ? (
            <p className="text-sm text-crit-700">{t('work.safety_after_stop')}</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-silver-700">{t('work.safety_intro', { n: DEFAULT_SAFETY_CHECKS.filter((c) => c.critical).length })}</p>
              <SafetyCheckForm taskId={task.id} operationId={randomUUID()} />
            </>
          )}
          {task.status === 'accepted' ? (
            <div className="mt-4 border-t border-silver-200 pt-4">
              {!installing ? <p className="text-sm text-warn-700">{t('work.wait_installation')}</p>
                : task.safety_stop ? <p className="text-sm text-crit-700">{t('work.safety_stop_banner')}</p>
                : !(lastCheck?.can_start && checkToday) ? <p className="text-sm text-warn-700">{t('work.need_safety')}</p>
                : !prereqDone ? <p className="text-sm text-warn-700">{t('work.prereq_waiting')}</p>
                : <StartTaskButton taskId={task.id} version={task.version} />}
            </div>
          ) : null}
        </Card>
      ) : null}

      {mine && task.status === 'in_progress' ? (
        <>
          <Card title={t('work.checklist_title')} className="mt-4">
            <ChecklistForm taskId={task.id} version={task.version} items={task.checklist ?? []} answers={task.checklist_answers ?? {}} notes={task.notes ?? ''} />
          </Card>
          <Card title={t('work.evidence_title')} className="mt-4">
            {(evidence ?? []).length > 0 ? (
              <ul className="mb-3 text-sm">
                {(evidence ?? []).map((e: any) => (
                  <li key={e.id} className="border-t border-silver-200 py-1 first:border-0">
                    {t(`enum.task_evidence.${e.category}`)} · {t('work.received_at', { date: dt(e.server_received_at, locale) })}{e.remarks ? ` · ${e.remarks}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            {missingEvidence.length ? <p className="mb-2 text-sm text-warn-700">{t('work.evidence_missing', { list: missingEvidence.map((c: string) => t(`enum.task_evidence.${c}`)).join(', ') })}</p> : null}
            <EvidenceForm taskId={task.id} partnerOrgId={partnerOrg} operationId={randomUUID()} categories={[...TASK_EVIDENCE_CATEGORIES.filter((c) => c !== 'correction')]} />
          </Card>
          <Card title={t('work.submit_title')} className="mt-4">
            <p className="mb-2 text-sm text-silver-700">{t('work.submit_hint')}</p>
            <SubmitTaskButton taskId={task.id} version={task.version} />
          </Card>
        </>
      ) : null}

      {mine && task.status === 'rework' ? (
        <Card title={t('work.rework_title')} className="mt-4">
          <p className="mb-3 text-sm text-silver-700">{t('work.rework_intro')}</p>
          <ul className="flex flex-col gap-3 text-sm">
            {(defects ?? []).filter((d: any) => d.status !== 'closed').map((d: any) => {
              const photos = (evidence ?? []).filter((e: any) => e.defect_id === d.id).length;
              return (
                <li key={d.id} className="rounded-md border border-silver-200 p-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{d.defect_number}</span>
                    <StateBadge state={d.status} labelText={t(`qa.defect_state.${d.status}`)} />
                    <span className="font-semibold">{t(`qa.criterion.${d.criterion_key}`)}</span>
                  </p>
                  <p>{d.location} · {d.description}</p>
                  <p className="text-silver-700">{t('qa.due', { date: d.correction_due_date })} · {t('work.correction_photos', { n: photos })}{d.status_reason ? ` · ${t('work.qa_says', { reason: d.status_reason })}` : ''}</p>
                  {d.status === 'assigned' ? <p className="mt-1 text-warn-700">{t('work.wait_acknowledge')}</p> : null}
                  {d.status === 'disputed' ? <p className="mt-1 text-warn-700">{t('work.disputed_wait')}</p> : null}
                  {d.status === 'acknowledged' ? <div className="mt-2"><DefectActionForm defectId={d.id} version={d.version} action="start_correction" /></div> : null}
                  {d.status === 'correction_in_progress' ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <CorrectionEvidenceForm taskId={task.id} partnerOrgId={partnerOrg} defectId={d.id} operationId={randomUUID()} />
                      {photos > 0 ? <DefectActionForm defectId={d.id} version={d.version} action="submit_correction" /> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {(defects ?? []).every((d: any) => ['submitted_for_reinspection', 'verified', 'closed'].includes(d.status)) ? (
            <div className="mt-4 border-t border-silver-200 pt-4">
              <p className="mb-2 text-sm text-silver-700">{t('work.resubmit_hint')}</p>
              <ResubmitTaskButton taskId={task.id} version={task.version} />
            </div>
          ) : null}
        </Card>
      ) : null}

      {mine && task.status === 'submitted' ? (
        <p role="status" className="mt-4 rounded-md bg-ok-50 px-3 py-2 text-sm text-ok-700">{t('work.submitted_note')}</p>
      ) : null}

      {mine && ['accepted', 'in_progress', 'blocked'].includes(task.status) ? (
        <Card title={t('work.incident_title')} className="mt-4">
          <p className="mb-2 text-sm text-silver-700">{t('work.incident_intro')}</p>
          <IncidentForm taskId={task.id} operationId={randomUUID()} />
        </Card>
      ) : null}
    </>
  );
}

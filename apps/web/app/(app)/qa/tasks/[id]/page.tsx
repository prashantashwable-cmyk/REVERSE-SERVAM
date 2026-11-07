import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_QA_CHECKLISTS, fromServerError } from '@aiec/domain';
import { Badge, Card, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { staffNames } from '@/lib/people';
import { supabaseServer } from '@/lib/supabase/server';
import { InspectionForm, ResolveDisputeForm } from '../../qa-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('qa.workspace_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** QA02 inspection workspace: the submission, its evidence, previous inspections and defects, then the checklist. */
export default async function QaTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'qa.inspection.decide')) return <PermissionDenied whatKey="qa.what" />;
  const supabase = await supabaseServer();
  const { data: task, error } = await supabase.from('project_tasks').select('*').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!task) notFound();
  const [{ data: project }, { data: evidence }, { data: inspections }, { data: defects }] = await Promise.all([
    supabase.from('projects').select('id, project_number, title, site_label').eq('id', task.project_id).maybeSingle(),
    supabase.from('task_evidence').select('*').eq('task_id', id).order('server_received_at'),
    supabase.from('qa_inspections').select('id, outcome, notes, inspector_id, inspected_at').eq('task_id', id).order('inspected_at', { ascending: false }),
    supabase.from('defects').select('*').eq('task_id', id).order('raised_at'),
  ]);
  const { data: urls } = (evidence ?? []).length ? await supabase.storage.from('execution-evidence').createSignedUrls((evidence ?? []).map((e: any) => e.storage_path), 300) : { data: [] as any[] };
  const url = new Map((urls ?? []).map((u: any) => [u.path, u.signedUrl]));
  const names = await staffNames([task.submitted_by, ...(inspections ?? []).map((i: any) => i.inspector_id)]);
  const pending = (defects ?? []).filter((d: any) => d.status === 'submitted_for_reinspection');
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={t(`work.task.${task.code}`)} subtitle={project ? `${project.project_number} · ${project.title} · ${project.site_label}` : undefined}
        actions={<StateBadge state={task.status} labelText={t(`work.state.${task.status}`)} />} />
      <p className="mb-4 text-sm"><Link prefetch={false} href="/qa" className="underline">{t('qa.back')}</Link></p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('qa.submission')}>
          <p className="text-sm">{t('qa.submitted_by', { name: names.get(task.submitted_by) ?? '—', date: dt(task.submitted_at, locale) })}</p>
          <ul className="mt-2 list-inside list-disc text-sm">
            {(task.checklist ?? []).map((k: string) => {
              const a = task.checklist_answers?.[k];
              return <li key={k}>{t(`work.check.${k}`)}: {a?.done ? t('qa.done') : a?.not_applicable_reason ? t('qa.na_with_reason', { reason: a.not_applicable_reason }) : '—'}</li>;
            })}
          </ul>
          {task.notes ? <p className="mt-2 text-sm text-silver-700">{task.notes}</p> : null}
        </Card>
        <Card title={t('qa.evidence')}>
          {(evidence ?? []).length === 0 ? <p className="text-sm text-silver-700">{t('qa.no_evidence')}</p> : (
            <ul className="text-sm">
              {(evidence ?? []).map((e: any) => (
                <li key={e.id} className="border-t border-silver-200 py-1 first:border-0">
                  {url.get(e.storage_path) ? <a href={url.get(e.storage_path)} target="_blank" rel="noreferrer" className="underline">{t(`enum.task_evidence.${e.category}`)}</a> : t(`enum.task_evidence.${e.category}`)}
                  {' · '}{t('qa.evidence_times', { captured: dt(e.captured_at, locale), received: dt(e.server_received_at, locale) })}
                  {e.source === 'document_import' ? ` · ${t('qa.imported')}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {(defects ?? []).length > 0 ? (
        <Card title={t('qa.defects')} className="mt-4">
          <ul className="flex flex-col gap-2 text-sm">
            {(defects ?? []).map((d: any) => (
              <li key={d.id} className="rounded-md border border-silver-200 p-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{d.defect_number}</span>
                  <StateBadge state={d.status} labelText={t(`qa.defect_state.${d.status}`)} />
                  <Badge tone={d.severity === 'critical' ? 'crit' : 'warn'}>{t(`enum.defect_severity.${d.severity}`)}</Badge>
                  <span>{t(`qa.criterion.${d.criterion_key}`)}</span>
                </p>
                <p className="text-silver-700">{d.location} · {d.description}{d.status_reason ? ` · ${d.status_reason}` : ''}</p>
                {d.status === 'disputed' ? <ResolveDisputeForm defectId={d.id} version={d.version} /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {(inspections ?? []).length > 0 ? (
        <Card title={t('qa.history')} className="mt-4">
          <ul className="text-sm">
            {(inspections ?? []).map((i: any) => (
              <li key={i.id} className="border-t border-silver-200 py-1 first:border-0">
                <StateBadge state={i.outcome} labelText={t(`qa.outcome.${i.outcome}`)} /> {names.get(i.inspector_id) ?? '—'} · {dt(i.inspected_at, locale)}{i.notes ? ` · ${i.notes}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {task.status === 'submitted' ? (
        <Card title={t('qa.inspect_title')} className="mt-4">
          <p className="mb-3 text-sm text-silver-700">{t('qa.inspect_hint')}</p>
          <InspectionForm taskId={task.id} operationId={randomUUID()} criteria={DEFAULT_QA_CHECKLISTS[task.code] ?? []} minDate={today} labelPrefix="qa.criterion"
            pending={pending.map((d: any) => ({ id: d.id, number: d.defect_number, label: `${t(`qa.criterion.${d.criterion_key}`)} · ${d.location}` }))} />
        </Card>
      ) : (
        <p className="mt-4 text-sm text-silver-700">{t('qa.not_inspectable', { status: t(`work.state.${task.status}`) })}</p>
      )}
    </>
  );
}

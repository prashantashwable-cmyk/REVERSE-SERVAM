import Link from 'next/link';
import { fromServerError } from '@aiec/domain';
import { Badge, Card, EmptyState, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('qa.title') };
}

/** QA01: submitted work and corrections to inspect, final QA requests and open defects. */
export default async function QaQueuePage() {
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'qa.inspection.decide')) return <PermissionDenied whatKey="qa.what" />;
  const supabase = await supabaseServer();
  const [{ data: tasks, error }, { data: finals }, { data: defects }] = await Promise.all([
    supabase.from('project_tasks').select('id, project_id, code, submitted_at, safety_stop').eq('status', 'submitted').order('submitted_at', { ascending: true }),
    supabase.from('projects').select('id, project_number, title, site_label, updated_at').eq('status', 'final_qa').order('updated_at'),
    supabase.from('defects').select('id, defect_number, project_id, task_id, status, severity, correction_due_date').not('status', 'in', '(verified,closed)').order('correction_due_date'),
  ]);
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  const projectIds = [...new Set([...(tasks ?? []).map((x) => x.project_id), ...(defects ?? []).map((x) => x.project_id)])];
  const { data: projects } = projectIds.length ? await supabase.from('projects').select('id, project_number, title, site_label').in('id', projectIds) : { data: [] as any[] };
  const project = new Map((projects ?? []).map((p: any) => [p.id, p]));
  const recheck = new Set((defects ?? []).filter((d) => d.status === 'submitted_for_reinspection').map((d) => d.task_id));
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={t('qa.title')} subtitle={t('qa.subtitle')} />
      <Card title={t('qa.to_inspect')}>
        {(tasks ?? []).length === 0 ? <EmptyState title={t('qa.nothing_to_inspect')} /> : (
          <ul className="text-sm">
            {(tasks ?? []).map((x) => {
              const p = project.get(x.project_id);
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                  <Link prefetch={false} href={`/qa/tasks/${x.id}`} className="font-semibold text-navy-700 underline">{t(`work.task.${x.code}`)}</Link>
                  {recheck.has(x.id) ? <Badge tone="warn">{t('qa.reinspection')}</Badge> : <Badge tone="info">{t('qa.first_inspection')}</Badge>}
                  <span className="text-silver-700">{p ? `${p.project_number} · ${p.title} · ${p.site_label}` : ''} · {t('qa.submitted_on', { date: dt(x.submitted_at, locale) })}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title={t('qa.final_requests')} className="mt-4">
        {(finals ?? []).length === 0 ? <p className="text-sm text-silver-700">{t('qa.no_final')}</p> : (
          <ul className="text-sm">
            {(finals ?? []).map((p) => (
              <li key={p.id} className="border-t border-silver-200 py-2 first:border-0">
                <Link prefetch={false} href={`/qa/projects/${p.id}`} className="font-semibold text-navy-700 underline">{p.project_number} · {p.title}</Link>
                <span className="text-silver-700"> · {p.site_label}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('qa.open_defects')} className="mt-4">
        {(defects ?? []).length === 0 ? <p className="text-sm text-silver-700">{t('qa.no_open_defects')}</p> : (
          <ul className="text-sm">
            {(defects ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                <span className="font-mono text-xs">{d.defect_number}</span>
                <StateBadge state={d.status} labelText={t(`qa.defect_state.${d.status}`)} />
                <Badge tone={d.severity === 'critical' ? 'crit' : d.severity === 'major' ? 'warn' : 'neutral'}>{t(`enum.defect_severity.${d.severity}`)}</Badge>
                <span className={d.correction_due_date < today ? 'text-crit-700' : 'text-silver-700'}>{t('qa.due', { date: d.correction_due_date })}</span>
                <span className="text-silver-700">{project.get(d.project_id)?.project_number ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

import Link from 'next/link';
import { fromServerError } from '@aiec/domain';
import { Badge, Card, EmptyState, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('work.title') };
}

/** WT01 technician home: the current task first, then what is next. No sales or money data. */
export default async function WorkPage() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'task.execute')) return <PermissionDenied whatKey="work.what" />;
  const supabase = await supabaseServer();
  const { data: tasks, error } = await supabase.from('project_tasks').select('id, project_id, code, sequence, status, due_date, safety_stop').eq('assignee_user_id', ctx.user_id).order('sequence');
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  const projectIds = [...new Set((tasks ?? []).map((x) => x.project_id))];
  const { data: projects } = projectIds.length ? await supabase.from('projects').select('id, project_number, title, site_label, status').in('id', projectIds) : { data: [] as any[] };
  const project = new Map((projects ?? []).map((p: any) => [p.id, p]));
  const current = (tasks ?? []).filter((x) => ['in_progress', 'blocked', 'rework'].includes(x.status));
  const next = (tasks ?? []).filter((x) => ['assigned', 'accepted'].includes(x.status));
  const done = (tasks ?? []).filter((x) => ['submitted', 'approved', 'closed'].includes(x.status));
  const row = (x: any) => {
    const p = project.get(x.project_id);
    return (
      <li key={x.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-3 first:border-0">
        <Link prefetch={false} href={`/work/${x.id}`} className="text-base font-semibold text-navy-700 underline">{t(`work.task.${x.code}`)}</Link>
        <StateBadge state={x.status} labelText={t(`work.state.${x.status}`)} />
        {x.safety_stop ? <Badge tone="crit">{t('execution.safety_stop')}</Badge> : null}
        <span className="text-sm text-silver-700">{p ? `${p.project_number} · ${p.site_label}` : ''}{x.due_date ? ` · ${t('work.due', { date: x.due_date })}` : ''}</span>
      </li>
    );
  };
  return (
    <>
      <PageHeader title={t('work.title')} subtitle={t('work.subtitle')} />
      {(tasks ?? []).length === 0 ? (
        <EmptyState title={t('work.empty')} body={t('work.empty_body')} />
      ) : (
        <>
          <Card title={t('work.current')}>{current.length ? <ul>{current.map(row)}</ul> : <p className="text-sm text-silver-700">{t('work.no_current')}</p>}</Card>
          <Card title={t('work.next')} className="mt-4">{next.length ? <ul>{next.map(row)}</ul> : <p className="text-sm text-silver-700">{t('work.no_next')}</p>}</Card>
          <Card title={t('work.done')} className="mt-4">{done.length ? <ul>{done.map(row)}</ul> : <p className="text-sm text-silver-700">{t('work.no_done')}</p>}</Card>
        </>
      )}
    </>
  );
}

import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_QA_CHECKLISTS, fromServerError } from '@aiec/domain';
import { Card, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { InspectionForm } from '../../qa-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('qa.final_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** QA06 final QA: every stage inspection, no open defect, the final checklist. It never grants statutory permission. */
export default async function QaFinalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'qa.inspection.decide')) return <PermissionDenied whatKey="qa.what" />;
  const supabase = await supabaseServer();
  const { data: p, error } = await supabase.from('projects').select('id, project_number, title, site_label, status').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!p) notFound();
  const [{ data: tasks }, { data: openDefects }] = await Promise.all([
    supabase.from('project_tasks').select('code, sequence, status').eq('project_id', id).order('sequence'),
    supabase.from('defects').select('id').eq('project_id', id).not('status', 'in', '(verified,closed)'),
  ]);
  return (
    <>
      <PageHeader title={t('qa.final_heading', { project: p.project_number })} subtitle={`${p.title} · ${p.site_label}`} actions={<StateBadge state={p.status} labelText={t(`project.state.${p.status}`)} />} />
      <p className="mb-4 text-sm"><Link prefetch={false} href="/qa" className="underline">{t('qa.back')}</Link></p>
      <Card title={t('qa.stage_results')}>
        <ul className="grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
          {(tasks ?? []).map((x: any) => <li key={x.code}>{t(`work.task.${x.code}`)}: <StateBadge state={x.status} labelText={t(`work.state.${x.status}`)} /></li>)}
        </ul>
        <p className="mt-2 text-sm">{t('qa.open_defects_count', { n: (openDefects ?? []).length })}</p>
      </Card>
      {p.status === 'final_qa' ? (
        <Card title={t('qa.final_checklist')} className="mt-4">
          <p className="mb-3 text-sm text-silver-700">{t('qa.final_hint')}</p>
          <InspectionForm projectId={p.id} operationId={randomUUID()} criteria={DEFAULT_QA_CHECKLISTS.final ?? []} pending={[]} minDate="" labelPrefix="qa.criterion" />
        </Card>
      ) : (
        <p className="mt-4 text-sm text-silver-700">{t('qa.final_not_requested')}</p>
      )}
    </>
  );
}

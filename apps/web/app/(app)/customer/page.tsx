import Link from 'next/link';
import { fromServerError } from '@aiec/domain';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('customer.title') };
}

/** CU01: the customer's own projects in plain language, and what needs their action. */
export default async function CustomerHomePage() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'customer.project.read')) return <PermissionDenied whatKey="customer.what" />;
  const supabase = await supabaseServer();
  const { data: projects, error } = await supabase.from('projects').select('id, project_number, title, site_label, status').order('created_at', { ascending: false });
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  const ids = (projects ?? []).map((p) => p.id);
  const { data: handovers } = ids.length ? await supabase.from('handovers').select('project_id, status').in('project_id', ids) : { data: [] as any[] };
  const ho = new Map((handovers ?? []).map((h: any) => [h.project_id, h.status]));
  return (
    <>
      <PageHeader title={t('customer.title')} subtitle={t('customer.subtitle')} />
      {(projects ?? []).length === 0 ? <EmptyState title={t('customer.empty')} body={t('customer.empty_body')} /> : (
        <div className="flex flex-col gap-4">
          {(projects ?? []).map((p) => (
            <Card key={p.id}>
              <p className="flex flex-wrap items-center gap-2">
                <Link prefetch={false} href={`/customer/projects/${p.id}`} className="text-lg font-semibold text-navy-700 underline">{p.title}</Link>
                {ho.get(p.id) === 'ready' ? <Badge tone="warn">{t('customer.action_needed')}</Badge> : null}
              </p>
              <p className="text-sm text-silver-700">{p.project_number} · {p.site_label}</p>
              <p className="mt-1 text-sm">{t('customer.stage', { stage: t(`customer.stage.${p.status}`) })}</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

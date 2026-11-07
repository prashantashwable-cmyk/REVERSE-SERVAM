import Link from 'next/link';
import { PROJECT_STATES, fromServerError } from '@aiec/domain';
import { Card, EmptyState, PageHeader, StateBadge, buttonClass, inputClass } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('projects.title') };
}

/** O06 project list: every project the user may read (RLS decides), newest first. */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  // Partner people work in their own workspace (/partner); AIEC project pages are for AIEC staff.
  if (!ctx.memberships.some((m) => m.organization_kind === 'aiec')) return <PermissionDenied whatKey="projects.what" />;
  const allowed = ['project.read_all', 'project.plan', 'technical.review', 'finance.ledger.read', 'procurement.request.create', 'procurement.po.create', 'order.convert'] as const;
  if (!allowed.some((p) => can(ctx, p))) return <PermissionDenied whatKey="projects.what" />;
  const sp = await searchParams;
  const status = PROJECT_STATES.includes(sp.status as never) ? sp.status! : null;
  const supabase = await supabaseServer();
  let q = supabase.from('projects').select('id, project_number, title, site_label, status, created_at').order('created_at', { ascending: false }).limit(200);
  if (status) q = q.eq('status', status);
  const { data: rows, error } = await q;
  if (error) return <ErrorPanel code={fromServerError(error).code} />;

  return (
    <>
      <PageHeader title={t('projects.title')} subtitle={t('projects.subtitle')} />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('common.status')}
            <select name="status" defaultValue={status ?? ''} className={inputClass}>
              <option value="">{t('common.any')}</option>
              {PROJECT_STATES.map((s) => <option key={s} value={s}>{t(`project.state.${s}`)}</option>)}
            </select>
          </label>
          <button className={buttonClass}>{t('common.apply')}</button>
        </form>
      </Card>
      {(rows ?? []).length === 0 ? (
        <EmptyState title={t('projects.empty_title')} body={t('projects.empty_body')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('projects.title')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-2 pr-3">{t('projects.col_project')}</th>
                  <th className="py-2 pr-3">{t('projects.col_site')}</th>
                  <th className="py-2 pr-3">{t('common.status')}</th>
                  <th className="py-2 pr-3">{t('projects.col_created')}</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-silver-200">
                    <td className="py-2 pr-3">
                      <Link prefetch={false} href={`/projects/${r.id}`} className="font-semibold text-navy-700 underline">{r.title}</Link>
                      <span className="block font-mono text-xs text-silver-700">{r.project_number}</span>
                    </td>
                    <td className="py-2 pr-3">{r.site_label}</td>
                    <td className="py-2 pr-3"><StateBadge state={r.status} labelText={t(`project.state.${r.status}`)} /></td>
                    <td className="py-2 pr-3">{dt(r.created_at, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

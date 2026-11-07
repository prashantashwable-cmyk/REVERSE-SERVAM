import Link from 'next/link';
import { fromServerError } from '@aiec/domain';
import { Badge, Card, EmptyState, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('partners.title') };
}

/** O07 / OM04 partner portfolio: status, documents waiting for verification and Gate 7 eligibility. */
export default async function PartnersPage() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'partner.verify') && !can(ctx, 'partner.assign') && !can(ctx, 'project.read_all')) return <PermissionDenied whatKey="partners.what" />;
  const supabase = await supabaseServer();
  const { data: orgs, error } = await supabase.from('organizations').select('id, name, city, status').eq('kind', 'partner').order('name');
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  const ids = (orgs ?? []).map((o) => o.id);
  const [{ data: profiles }, { data: pending }, eligibility] = await Promise.all([
    ids.length ? supabase.from('partner_profiles').select('organization_id, status, lift_categories, service_areas').in('organization_id', ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? supabase.from('partner_documents').select('organization_id').eq('verification', 'pending').in('organization_id', ids) : Promise.resolve({ data: [] as any[] }),
    Promise.all(ids.map((id) => supabase.rpc('partner_eligibility', { p_org_id: id, p_lift_category: null }))),
  ]);
  const profile = new Map((profiles ?? []).map((p: any) => [p.organization_id, p]));
  const pendingCount = new Map<string, number>();
  for (const d of pending ?? []) pendingCount.set(d.organization_id, (pendingCount.get(d.organization_id) ?? 0) + 1);
  const eligible = new Map(ids.map((id, i) => [id, (eligibility[i]?.data as { eligible?: boolean } | null)?.eligible ?? false]));

  return (
    <>
      <PageHeader title={t('partners.title')} subtitle={t('partners.subtitle')} />
      {(orgs ?? []).length === 0 ? (
        <EmptyState title={t('partners.empty')} body={t('partners.empty_body')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('partners.title')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-2 pr-3">{t('partners.col_partner')}</th>
                  <th className="py-2 pr-3">{t('common.status')}</th>
                  <th className="py-2 pr-3">{t('partners.col_categories')}</th>
                  <th className="py-2 pr-3">{t('partners.col_pending_documents')}</th>
                  <th className="py-2 pr-3">{t('partners.col_eligibility')}</th>
                </tr>
              </thead>
              <tbody>
                {(orgs ?? []).map((o) => {
                  const p = profile.get(o.id);
                  const status = p?.status ?? 'draft';
                  return (
                    <tr key={o.id} className="border-t border-silver-200">
                      <td className="py-2 pr-3">
                        <Link prefetch={false} href={`/partners/${o.id}`} className="font-semibold text-navy-700 underline">{o.name}</Link>
                        <span className="block text-xs text-silver-700">{(p?.service_areas ?? []).join(', ') || o.city}</span>
                      </td>
                      <td className="py-2 pr-3"><StateBadge state={status} labelText={t(`partner.state.${status}`)} /></td>
                      <td className="py-2 pr-3">{(p?.lift_categories ?? []).map((c: string) => t(`enum.lift_category.${c}`)).join(', ') || '—'}</td>
                      <td className="py-2 pr-3">{pendingCount.get(o.id) ?? 0}</td>
                      <td className="py-2 pr-3">{eligible.get(o.id) ? <Badge tone="ok">{t('partners.eligible')}</Badge> : <Badge tone="warn">{t('partners.not_eligible')}</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-silver-700">{t('partners.eligibility_note')}</p>
        </Card>
      )}
    </>
  );
}

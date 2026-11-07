import Link from 'next/link';
import { formatInr, fromServerError } from '@aiec/domain';
import { Card, EmptyState, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('procurement.title') };
}
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));

/** PR01–PR05 queue: open purchase requests and purchase orders that still need work. */
export default async function ProcurementPage() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const allowed = ['procurement.request.create', 'procurement.po.create', 'procurement.grn.record', 'procurement.po.approve', 'project.read_all', 'finance.ledger.read'] as const;
  if (!allowed.some((p) => can(ctx, p))) return <PermissionDenied whatKey="procurement.what" />;
  const supabase = await supabaseServer();
  const [reqs, pos] = await Promise.all([
    supabase.from('purchase_requests').select('id, request_number, project_id, status, required_by, created_at').order('required_by', { ascending: true }).limit(200),
    supabase.from('purchase_orders').select('id, po_number, project_id, supplier_id, status, totals, delivery_to, created_at').order('created_at', { ascending: false }).limit(200),
  ]);
  const err = reqs.error ?? pos.error;
  if (err) return <ErrorPanel code={fromServerError(err).code} />;
  const projectIds = [...new Set([...(reqs.data ?? []), ...(pos.data ?? [])].map((r) => r.project_id))];
  const supplierIds = [...new Set((pos.data ?? []).map((o) => o.supplier_id))];
  const [{ data: projects }, { data: suppliers }] = await Promise.all([
    projectIds.length ? supabase.from('projects').select('id, project_number, title').in('id', projectIds) : Promise.resolve({ data: [] as any[] }),
    supplierIds.length ? supabase.from('organizations').select('id, name').in('id', supplierIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const project = new Map((projects ?? []).map((p: any) => [p.id, p]));
  const supplier = new Map((suppliers ?? []).map((s: any) => [s.id, s.name]));
  const openReqs = (reqs.data ?? []).filter((r) => r.status === 'open' || r.status === 'supplier_selected');
  const activePos = (pos.data ?? []).filter((o) => o.status !== 'closed' && o.status !== 'cancelled');
  const donePos = (pos.data ?? []).filter((o) => o.status === 'closed' || o.status === 'cancelled');

  const projectCell = (id: string) => {
    const p = project.get(id);
    return p ? <Link prefetch={false} href={`/projects/${p.id}`} className="underline">{p.title}<span className="block font-mono text-xs text-silver-700">{p.project_number}</span></Link> : '—';
  };

  return (
    <>
      <PageHeader title={t('procurement.title')} subtitle={t('procurement.subtitle')} />
      <Card title={t('procurement.open_requests')}>
        {openReqs.length === 0 ? (
          <EmptyState title={t('procurement.no_open_requests')} body={t('procurement.no_open_requests_body')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('procurement.open_requests')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-2 pr-3">{t('procurement.col_request')}</th>
                  <th className="py-2 pr-3">{t('projects.col_project')}</th>
                  <th className="py-2 pr-3">{t('common.status')}</th>
                  <th className="py-2 pr-3">{t('field.required_by')}</th>
                </tr>
              </thead>
              <tbody>
                {openReqs.map((r) => (
                  <tr key={r.id} className="border-t border-silver-200">
                    <td className="py-2 pr-3"><Link prefetch={false} href={`/procurement/requests/${r.id}`} className="font-mono text-xs font-semibold text-navy-700 underline">{r.request_number}</Link></td>
                    <td className="py-2 pr-3">{projectCell(r.project_id)}</td>
                    <td className="py-2 pr-3"><StateBadge state={r.status} labelText={t(`procurement.request_state.${r.status}`)} /></td>
                    <td className="py-2 pr-3">{r.required_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {[
        { key: 'active', title: t('procurement.active_orders'), rows: activePos, empty: t('procurement.no_active_orders') },
        { key: 'done', title: t('procurement.finished_orders'), rows: donePos, empty: t('procurement.no_finished_orders') },
      ].map((section) => (
        <Card key={section.key} title={section.title} className="mt-4">
          {section.rows.length === 0 ? (
            <p className="text-sm text-silver-700">{section.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{section.title}</caption>
                <thead className="text-xs uppercase text-silver-700">
                  <tr>
                    <th className="py-2 pr-3">{t('procurement.col_po')}</th>
                    <th className="py-2 pr-3">{t('projects.col_project')}</th>
                    <th className="py-2 pr-3">{t('field.supplier_id')}</th>
                    <th className="py-2 pr-3">{t('common.status')}</th>
                    <th className="py-2 pr-3">{t('procurement.po_total')}</th>
                    <th className="py-2 pr-3">{t('field.delivery_to')}</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((o) => (
                    <tr key={o.id} className="border-t border-silver-200">
                      <td className="py-2 pr-3"><Link prefetch={false} href={`/procurement/orders/${o.id}`} className="font-mono text-xs font-semibold text-navy-700 underline">{o.po_number}</Link></td>
                      <td className="py-2 pr-3">{projectCell(o.project_id)}</td>
                      <td className="py-2 pr-3">{supplier.get(o.supplier_id) ?? '—'}</td>
                      <td className="py-2 pr-3"><StateBadge state={o.status} labelText={t(`procurement.po_state.${o.status}`)} /></td>
                      <td className="py-2 pr-3">{inr((o.totals as { totalPaise?: string })?.totalPaise)}</td>
                      <td className="py-2 pr-3">{o.delivery_to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}

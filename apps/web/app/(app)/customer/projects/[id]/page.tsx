import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_HANDOVER_DOCUMENTS, fromServerError } from '@aiec/domain';
import { Badge, Card, KeyValue, PageHeader } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { CustomerDecisionForm } from '../../customer-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('customer.project_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CU02 tracker and CU07 handover centre: the package, warranty and the customer's sign-off. No internal data. */
export default async function CustomerProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'customer.project.read')) return <PermissionDenied whatKey="customer.what" />;
  const supabase = await supabaseServer();
  const { data: p, error } = await supabase.from('projects').select('id, project_number, title, site_label, status').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!p) notFound();
  const [{ data: handover }, { data: docs }, { data: asset }] = await Promise.all([
    supabase.from('handovers').select('*').eq('project_id', id).maybeSingle(),
    supabase.from('handover_documents').select('*').eq('project_id', id).order('uploaded_at'),
    supabase.from('lift_assets').select('*').eq('project_id', id).maybeSingle(),
  ]);
  const { data: urls } = (docs ?? []).length ? await supabase.storage.from('handover-documents').createSignedUrls((docs ?? []).map((d: any) => d.storage_path), 300) : { data: [] as any[] };
  const url = new Map((urls ?? []).map((u: any) => [u.path, u.signedUrl]));
  const status = handover?.status ?? 'not_ready';
  return (
    <>
      <PageHeader title={p.title} subtitle={`${p.project_number} · ${p.site_label}`} />
      <p className="mb-4 text-sm"><Link prefetch={false} href="/customer" className="underline">{t('customer.back')}</Link></p>
      <Card title={t('customer.progress')}>
        <p className="text-sm">{t('customer.stage', { stage: t(`customer.stage.${p.status}`) })}</p>
      </Card>
      <Card title={t('customer.handover_centre')} className="mt-4">
        {status === 'not_ready' ? <p className="text-sm text-silver-700">{t('customer.package_not_ready')}</p> : (
          <>
            <ul className="mb-3 flex flex-col gap-1 text-sm">
              {DEFAULT_HANDOVER_DOCUMENTS.map((x) => {
                const latest = [...(docs ?? [])].reverse().find((d: any) => d.doc_type === x);
                return (
                  <li key={x} className="flex flex-wrap items-center gap-2">
                    {latest ? <Badge tone="ok">{t('handover.present')}</Badge> : <Badge tone="warn">{t('handover.missing')}</Badge>}
                    {latest && url.get(latest.storage_path) ? <a href={url.get(latest.storage_path)} target="_blank" rel="noreferrer" className="underline">{t(`enum.handover_document.${x}`)}</a> : t(`enum.handover_document.${x}`)}
                  </li>
                );
              })}
            </ul>
            {status === 'ready' && can(ctx, 'customer.approval.decide') ? (
              <div className="border-t border-silver-200 pt-4">
                <p className="mb-2 text-sm text-silver-700">{t('customer.decide_hint')}</p>
                <CustomerDecisionForm projectId={p.id} />
              </div>
            ) : null}
            {status === 'issues_raised' ? <p className="text-sm text-warn-700">{t('customer.issues_sent', { issues: handover?.issues ?? '' })}</p> : null}
            {status === 'accepted' ? <p role="status" className="rounded-md bg-ok-50 px-3 py-2 text-sm text-ok-700">{t('customer.accepted_note', { name: handover?.acceptor_name ?? '', date: dt(handover?.decided_at, locale) })}</p> : null}
          </>
        )}
      </Card>
      {asset ? (
        <Card title={t('customer.warranty')} className="mt-4">
          <KeyValue
            items={[
              [t('handover.asset_number'), <span key="a" className="font-mono">{asset.asset_number}</span>],
              [t('handover.warranty_status'), t(`handover.warranty_state.${asset.warranty_status}`)],
              [t('handover.warranty_period'), asset.warranty_start ? t('procurement.delivery_range', { from: asset.warranty_start, to: asset.warranty_end }) : '—'],
            ]}
          />
          <p className="mt-2 text-xs text-silver-700">{t('customer.warranty_note')}</p>
        </Card>
      ) : null}
    </>
  );
}

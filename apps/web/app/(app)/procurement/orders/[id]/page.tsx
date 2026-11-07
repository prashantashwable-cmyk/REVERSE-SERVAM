import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatBps, formatInr, formatQuantityMilli, fromServerError } from '@aiec/domain';
import { Card, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { IssueOrderButton, MaterialStatusButton, ReceiveGoodsForm, SubmitOrderButton } from '../../procurement-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('procurement.po_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));

/** PR03 supplier PO, PR04 material tracking per line, PR05 goods receipt and inspection. */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const d = (iso: string | null | undefined) => dt(iso, locale);
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const supabase = await supabaseServer();
  const { data: po, error } = await supabase.from('purchase_orders').select('*').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!po) notFound();
  const [{ data: project }, { data: lines }, { data: supplier }, { data: request }, { data: receipts }] = await Promise.all([
    supabase.from('projects').select('id, project_number, title').eq('id', po.project_id).maybeSingle(),
    supabase.from('purchase_order_lines').select('*').eq('po_id', id).order('line_no'),
    supabase.from('organizations').select('id, name').eq('id', po.supplier_id).maybeSingle(),
    supabase.from('purchase_requests').select('id, request_number').eq('id', po.request_id).maybeSingle(),
    supabase.from('goods_receipts').select('*').eq('po_id', id).order('received_at', { ascending: false }),
  ]);
  const receiptIds = (receipts ?? []).map((g: any) => g.id);
  const { data: receiptLines } = receiptIds.length ? await supabase.from('goods_receipt_lines').select('*').in('receipt_id', receiptIds) : { data: [] as any[] };
  const lineById = new Map((lines ?? []).map((l: any) => [l.id, l]));
  const totals = (po.totals ?? {}) as Record<string, string>;
  const receivable = (lines ?? []).filter((l: any) => ['delivered', 'received'].includes(l.material_status) && l.received_milli < l.quantity_milli);

  return (
    <>
      <PageHeader
        title={t('procurement.po_heading', { number: po.po_number })}
        subtitle={project ? `${project.project_number} · ${project.title}` : undefined}
        actions={<StateBadge state={po.status} labelText={t(`procurement.po_state.${po.status}`)} />}
      />
      <p className="mb-4 flex flex-wrap gap-3 text-sm">
        {project ? <Link prefetch={false} href={`/projects/${project.id}`} className="underline">{t('procurement.open_project')}</Link> : null}
        {request ? <Link prefetch={false} href={`/procurement/requests/${request.id}`} className="underline">{t('procurement.open_request', { number: request.request_number })}</Link> : null}
        <Link prefetch={false} href="/procurement" className="underline">{t('procurement.back_to_queue')}</Link>
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('procurement.po_summary')}>
          <KeyValue
            items={[
              [t('field.supplier_id'), supplier?.name ?? '—'],
              [t('procurement.po_net'), inr(totals.netPaise)],
              [t('procurement.po_tax'), inr(totals.taxPaise)],
              [t('field.freight'), inr(totals.freightPaise)],
              [t('procurement.po_total'), <strong key="t">{inr(totals.totalPaise)}</strong>],
              [t('procurement.delivery_window'), t('procurement.delivery_range', { from: po.delivery_from, to: po.delivery_to })],
              [t('field.delivery_location'), po.delivery_location],
              [t('field.payment_terms'), po.payment_terms],
              ...(po.terms ? [[t('field.terms'), po.terms] as [string, string]] : []),
              [t('procurement.approval'), po.needs_approval ? (po.approved_at ? t('procurement.approved_on', { date: d(po.approved_at) }) : t('procurement.needs_approval')) : t('procurement.within_limit')],
              ...(po.issued_at ? [[t('procurement.issued_on'), d(po.issued_at)] as [string, string]] : []),
              ...(po.status_reason ? [[t('field.reason'), po.status_reason] as [string, string]] : []),
            ]}
          />
        </Card>
        <Card title={t('procurement.next_step')}>
          {po.status === 'draft' && can(ctx, 'procurement.po.create') ? (
            <>
              <p className="mb-2 text-sm text-silver-700">{po.needs_approval ? t('procurement.submit_needs_approval') : t('procurement.submit_within_limit')}</p>
              <SubmitOrderButton poId={po.id} version={po.version} />
            </>
          ) : po.status === 'pending_approval' ? (
            <p className="text-sm text-warn-700">
              {t('procurement.waiting_approval')}{' '}
              {can(ctx, 'procurement.po.approve') ? <Link prefetch={false} href="/approvals" className="underline">{t('nav.approvals')}</Link> : null}
            </p>
          ) : po.status === 'approved' && can(ctx, 'procurement.po.create') ? (
            <>
              <p className="mb-2 text-sm text-silver-700">{t('procurement.issue_hint')}</p>
              <IssueOrderButton poId={po.id} version={po.version} />
            </>
          ) : po.status === 'issued' ? (
            <p className="text-sm text-silver-700">{t('procurement.issued_hint')}</p>
          ) : (
            <p className="text-sm text-silver-700">{t(`procurement.po_state_note.${po.status === 'closed' ? 'closed' : 'other'}`)}</p>
          )}
        </Card>
      </div>

      <Card title={t('procurement.po_lines')} className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('procurement.po_lines')}</caption>
            <thead className="text-xs uppercase text-silver-700">
              <tr>
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">{t('field.description')}</th>
                <th className="py-1 pr-3">{t('field.quantity')}</th>
                <th className="py-1 pr-3">{t('field.rate')}</th>
                <th className="py-1 pr-3">{t('field.tax_percent')}</th>
                <th className="py-1 pr-3">{t('quotation.line_total')}</th>
                <th className="py-1 pr-3">{t('procurement.material_status')}</th>
                <th className="py-1 pr-3">{t('procurement.received_accepted')}</th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l: any) => (
                <tr key={l.id} className="border-t border-silver-200 align-top">
                  <td className="py-1 pr-3">{l.line_no}</td>
                  <td className="py-1 pr-3">{l.description}</td>
                  <td className="py-1 pr-3">{formatQuantityMilli(l.quantity_milli)} {l.unit}</td>
                  <td className="py-1 pr-3">{inr(l.rate_paise)}</td>
                  <td className="py-1 pr-3">{formatBps(l.tax_rate_bps)}%</td>
                  <td className="py-1 pr-3">{inr(l.total_paise)}</td>
                  <td className="py-1 pr-3">
                    <StateBadge state={l.material_status} labelText={t(`material.state.${l.material_status}`)} />
                    {po.status === 'issued' && can(ctx, 'procurement.po.create') ? (
                      <div className="mt-2"><MaterialStatusButton lineId={l.id} version={l.version} status={l.material_status} /></div>
                    ) : null}
                  </td>
                  <td className="py-1 pr-3">{t('procurement.received_of', { received: formatQuantityMilli(l.received_milli), accepted: formatQuantityMilli(l.accepted_milli), ordered: formatQuantityMilli(l.quantity_milli) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-silver-700">{t('procurement.partial_note')}</p>
      </Card>

      {po.status === 'issued' && can(ctx, 'procurement.grn.record') ? (
        <Card title={t('procurement.grn_title')} className="mt-4">
          {receivable.length === 0 ? (
            <p className="text-sm text-silver-700">{t('procurement.grn_wait')}</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-silver-700">{t('procurement.grn_hint')}</p>
              <ReceiveGoodsForm
                poId={po.id}
                operationId={randomUUID()}
                lines={receivable.map((l: any) => ({ id: l.id, label: `${l.line_no}. ${l.description}`, outstanding: `${formatQuantityMilli(l.quantity_milli - l.received_milli)} ${l.unit}` }))}
              />
            </>
          )}
        </Card>
      ) : null}

      <Card title={t('procurement.receipts')} className="mt-4">
        {(receipts ?? []).length === 0 ? (
          <p className="text-sm text-silver-700">{t('procurement.no_receipts')}</p>
        ) : (
          <ul className="text-sm">
            {(receipts ?? []).map((g: any) => (
              <li key={g.id} className="border-t border-silver-200 py-2 first:border-0">
                <p className="font-semibold"><span className="font-mono text-xs">{g.grn_number}</span> · {d(g.received_at)}</p>
                <ul className="ml-4 list-disc text-silver-700">
                  {(receiptLines ?? []).filter((x: any) => x.receipt_id === g.id).map((x: any) => (
                    <li key={x.id}>
                      {t('procurement.receipt_line', {
                        line: lineById.get(x.po_line_id)?.description ?? '—',
                        received: formatQuantityMilli(x.received_milli),
                        damaged: formatQuantityMilli(x.damaged_milli),
                        result: t(`enum.inspection.${x.result}`),
                      })}
                      {x.serial_batch ? ` · ${x.serial_batch}` : ''}
                      {x.remarks ? ` · ${x.remarks}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

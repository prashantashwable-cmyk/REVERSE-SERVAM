import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatInr, formatQuantityMilli, fromServerError } from '@aiec/domain';
import { Badge, Card, EmptyState, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { AddQuoteForm, CancelRequestForm, CreateOrderForm, SelectSupplierForm } from '../../procurement-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('procurement.request_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));
const isoDate = (offsetDays: number) => new Date(Date.now() + 330 * 60000 + offsetDays * 864e5).toISOString().slice(0, 10);

/** PR01–PR02: request lines from the approved BOM, supplier quotes compared side by side, recorded choice, then the PO. */
export default async function PurchaseRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const supabase = await supabaseServer();
  const { data: r, error } = await supabase.from('purchase_requests').select('*').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!r) notFound();
  const [{ data: project }, { data: lines }, { data: quotes }, { data: suppliers }, { data: po }] = await Promise.all([
    supabase.from('projects').select('id, project_number, title, site_label').eq('id', r.project_id).maybeSingle(),
    supabase.from('purchase_request_lines').select('*').eq('request_id', id).order('line_no'),
    supabase.from('supplier_quotes').select('*').eq('request_id', id).order('recorded_at'),
    supabase.from('organizations').select('id, name').eq('kind', 'supplier').order('name'),
    supabase.from('purchase_orders').select('id, po_number, status').eq('request_id', id).maybeSingle(),
  ]);
  const bomIds = (lines ?? []).map((l: any) => l.bom_line_id);
  const { data: bomLines } = bomIds.length ? await supabase.from('bom_lines').select('id, item_code, description, unit').in('id', bomIds) : { data: [] as any[] };
  const bom = new Map((bomLines ?? []).map((b: any) => [b.id, b]));
  const supplierName = new Map((suppliers ?? []).map((s: any) => [s.id, s.name]));
  const totalOf = (q: any) => BigInt(q.net_paise) + BigInt(q.tax_paise) + BigInt(q.freight_paise);
  const matching = (quotes ?? []).filter((q: any) => q.technical_match);
  const lowest = matching.length ? matching.reduce((a: any, b: any) => (totalOf(b) < totalOf(a) ? b : a)) : null;
  const active = r.status === 'open' || r.status === 'supplier_selected';
  const lineLabel = (l: any) => {
    const b = bom.get(l.bom_line_id);
    return b ? `${b.item_code} · ${b.description} · ${formatQuantityMilli(l.quantity_milli)} ${b.unit}` : formatQuantityMilli(l.quantity_milli);
  };

  return (
    <>
      <PageHeader
        title={t('procurement.request_heading', { number: r.request_number })}
        subtitle={project ? `${project.project_number} · ${project.title}` : undefined}
        actions={<StateBadge state={r.status} labelText={t(`procurement.request_state.${r.status}`)} />}
      />
      <p className="mb-4 flex flex-wrap gap-3 text-sm">
        {project ? <Link prefetch={false} href={`/projects/${project.id}`} className="underline">{t('procurement.open_project')}</Link> : null}
        <Link prefetch={false} href="/procurement" className="underline">{t('procurement.back_to_queue')}</Link>
        {po ? <Link prefetch={false} href={`/procurement/orders/${po.id}`} className="underline">{t('procurement.open_po', { number: po.po_number })}</Link> : null}
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('procurement.request_summary')}>
          <KeyValue
            items={[
              [t('field.required_by'), r.required_by],
              [t('field.preferred_supplier_id'), r.preferred_supplier_id ? supplierName.get(r.preferred_supplier_id) ?? '—' : t('common.none')],
              [t('field.budget'), inr(r.budget_estimate_paise)],
              [t('procurement.created_on'), dt(r.created_at, locale)],
              ...(r.notes ? [[t('field.notes'), r.notes] as [string, string]] : []),
              ...(r.selection_rationale ? [[t('field.rationale'), r.selection_rationale] as [string, string]] : []),
              ...(r.status_reason ? [[t('field.reason'), r.status_reason] as [string, string]] : []),
            ]}
          />
        </Card>
        <Card title={t('procurement.request_lines')}>
          <ol className="list-inside list-decimal text-sm">
            {(lines ?? []).map((l: any) => <li key={l.id} className="py-1">{lineLabel(l)}</li>)}
          </ol>
          <p className="mt-2 text-xs text-silver-700">{t('procurement.bom_only_note')}</p>
        </Card>
      </div>

      <Card title={t('procurement.quotes')} className="mt-4">
        {(quotes ?? []).length === 0 ? (
          <EmptyState title={t('procurement.no_quotes')} body={t('procurement.no_quotes_body')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('procurement.quotes')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-1 pr-3">{t('field.supplier_id')}</th>
                  <th className="py-1 pr-3">{t('field.net_amount')}</th>
                  <th className="py-1 pr-3">{t('field.tax_amount')}</th>
                  <th className="py-1 pr-3">{t('field.freight')}</th>
                  <th className="py-1 pr-3">{t('procurement.quote_total')}</th>
                  <th className="py-1 pr-3">{t('field.lead_time_days')}</th>
                  <th className="py-1 pr-3">{t('field.warranty_months')}</th>
                  <th className="py-1 pr-3">{t('field.technical_match')}</th>
                  <th className="py-1 pr-3">{t('field.payment_terms')}</th>
                </tr>
              </thead>
              <tbody>
                {(quotes ?? []).map((q: any) => (
                  <tr key={q.id} className="border-t border-silver-200">
                    <td className="py-1 pr-3">
                      {supplierName.get(q.supplier_id) ?? '—'}
                      {r.selected_quote_id === q.id ? <span className="ml-2"><Badge tone="ok">{t('procurement.selected')}</Badge></span> : null}
                      {lowest?.id === q.id ? <span className="ml-2"><Badge tone="info">{t('procurement.lowest')}</Badge></span> : null}
                    </td>
                    <td className="py-1 pr-3">{inr(q.net_paise)}</td>
                    <td className="py-1 pr-3">{inr(q.tax_paise)}</td>
                    <td className="py-1 pr-3">{inr(q.freight_paise)}</td>
                    <td className="py-1 pr-3 font-semibold">{formatInr(totalOf(q))}</td>
                    <td className="py-1 pr-3">{t('procurement.days', { n: q.lead_time_days })}</td>
                    <td className="py-1 pr-3">{q.warranty_months === null ? '—' : t('procurement.months', { n: q.warranty_months })}</td>
                    <td className="py-1 pr-3">{q.technical_match ? t('procurement.match_yes') : <Badge tone="warn">{t('procurement.match_no')}</Badge>}</td>
                    <td className="py-1 pr-3">{q.payment_terms ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {active && can(ctx, 'procurement.po.create') ? (
          <div className="mt-4 border-t border-silver-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold">{t('procurement.add_quote_title')}</h3>
            <AddQuoteForm requestId={r.id} suppliers={(suppliers ?? []).map((s: any) => ({ id: s.id, label: s.name }))} />
          </div>
        ) : null}
        {active && can(ctx, 'procurement.po.create') && (quotes ?? []).length > 0 ? (
          <div className="mt-4 border-t border-silver-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold">{t('procurement.select_title')}</h3>
            <p className="mb-2 text-sm text-silver-700">{t('procurement.select_hint')}</p>
            <SelectSupplierForm
              requestId={r.id}
              version={r.version}
              quotes={(quotes ?? []).map((q: any) => ({ id: q.id, label: `${supplierName.get(q.supplier_id) ?? '—'} · ${formatInr(totalOf(q))}${q.technical_match ? '' : ` · ${t('procurement.match_no')}`}` }))}
            />
          </div>
        ) : null}
      </Card>

      {r.status === 'supplier_selected' && can(ctx, 'procurement.po.create') ? (
        <Card title={t('procurement.create_po_title')} className="mt-4">
          <p className="mb-3 text-sm text-silver-700">{t('procurement.create_po_hint')}</p>
          <CreateOrderForm
            requestId={r.id}
            operationId={randomUUID()}
            lines={(lines ?? []).map((l: any) => ({ id: l.id, label: lineLabel(l) }))}
            deliveryLocation={project?.site_label ?? ''}
            minDate={isoDate(0)}
          />
        </Card>
      ) : null}

      {active && can(ctx, 'procurement.request.create') ? (
        <Card title={t('procurement.cancel_title')} className="mt-4">
          <CancelRequestForm requestId={r.id} version={r.version} />
        </Card>
      ) : null}
    </>
  );
}

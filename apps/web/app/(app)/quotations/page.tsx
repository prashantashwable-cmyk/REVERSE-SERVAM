import Link from 'next/link';
import { QUOTATION_STATES, formatInr, fromServerError } from '@aiec/domain';
import { Card, EmptyState, PageHeader, StateBadge, buttonClass, inputClass } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('quotations.title') };
}

/** SE09 list: each quotation with its current revision. */
export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  if (!can(result.ctx, 'lead.read_all') && !can(result.ctx, 'quotation.create')) return <PermissionDenied whatKey="quotations.what" />;
  const sp = await searchParams;
  const status = QUOTATION_STATES.includes(sp.status as never) ? sp.status! : null;
  const supabase = await supabaseServer();
  const { data: qs, error } = await supabase.from('quotations').select('id, quotation_number, lead_id, current_revision_id, created_at').order('created_at', { ascending: false }).limit(200);
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  const revIds = (qs ?? []).map((q) => q.current_revision_id).filter(Boolean) as string[];
  const leadIds = (qs ?? []).map((q) => q.lead_id);
  const [{ data: revs }, { data: leads }] = await Promise.all([
    revIds.length ? supabase.from('quotation_revisions').select('id, revision_no, status, valid_until, totals').in('id', revIds) : Promise.resolve({ data: [] as any[] }),
    leadIds.length ? supabase.from('leads').select('id, lead_number, project_name').in('id', leadIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const revById = new Map((revs ?? []).map((r: any) => [r.id, r]));
  const leadById = new Map((leads ?? []).map((l: any) => [l.id, l]));
  const rows = (qs ?? []).map((q) => ({ ...q, rev: revById.get(q.current_revision_id), lead: leadById.get(q.lead_id) })).filter((r) => !status || r.rev?.status === status);

  return (
    <>
      <PageHeader title={t('quotations.title')} subtitle={t('quotations.subtitle')} />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('common.status')}
            <select name="status" defaultValue={status ?? ''} className={inputClass}>
              <option value="">{t('common.any')}</option>
              {QUOTATION_STATES.map((s) => <option key={s} value={s}>{t(`quotation.state.${s}`)}</option>)}
            </select>
          </label>
          <button className={buttonClass}>{t('common.apply')}</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title={t('quotations.empty_title')} body={t('quotations.empty_body')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('quotations.title')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-2 pr-3">{t('quotations.col_quotation')}</th>
                  <th className="py-2 pr-3">{t('leads.col_project')}</th>
                  <th className="py-2 pr-3">{t('common.status')}</th>
                  <th className="py-2 pr-3">{t('quotation.valid_until')}</th>
                  <th className="py-2 pr-3">{t('quotation.grand_total')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-t border-silver-200">
                    <td className="py-2 pr-3 font-mono text-xs">
                      <Link prefetch={false} href={`/quotations/${r.id}`} className="font-semibold text-navy-700 underline">{r.quotation_number}</Link>
                      <span className="block text-silver-700">{t('quotation.revision_short', { no: r.rev?.revision_no ?? 1 })}</span>
                    </td>
                    <td className="py-2 pr-3">{r.lead?.project_name}<span className="block text-xs text-silver-700">{r.lead?.lead_number}</span></td>
                    <td className="py-2 pr-3">{r.rev ? <StateBadge state={r.rev.status} labelText={t(`quotation.state.${r.rev.status}`)} /> : '—'}</td>
                    <td className="py-2 pr-3">{r.rev?.valid_until ?? '—'}</td>
                    <td className="py-2 pr-3">{r.rev?.totals?.grandTotalPaise ? formatInr(BigInt(r.rev.totals.grandTotalPaise)) : '—'}</td>
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

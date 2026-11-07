import Link from 'next/link';
import { formatBps, formatInr, fromServerError } from '@aiec/domain';
import { Card, EmptyState, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { staffNames } from '@/lib/people';
import { supabaseServer } from '@/lib/supabase/server';
import { DecideRequestForm } from '../procurement/procurement-forms';
import { ApprovalDecisionForm } from '../quotations/quotation-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('approvals.title') };
}
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));
const pct = (v: unknown) => (v === null || v === undefined ? '—' : `${formatBps(Number(v))}%`);

/** O04 Approval Center: oldest first, with requester, reason, threshold and impact on every card. */
export default async function ApprovalsPage() {
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'quotation.discount.approve') && !can(ctx, 'procurement.po.approve') && !can(ctx, 'approval.exception.decide')) return <PermissionDenied whatKey="approvals.what" />;
  const supabase = await supabaseServer();
  const [pending, decided] = await Promise.all([
    supabase.from('approval_requests').select('*').eq('status', 'pending').order('requested_at', { ascending: true }).limit(100),
    supabase.from('approval_requests').select('*').neq('status', 'pending').order('decided_at', { ascending: false }).limit(30),
  ]);
  const err = pending.error ?? decided.error;
  if (err) return <ErrorPanel code={fromServerError(err).code} />;
  const all = [...(pending.data ?? []), ...(decided.data ?? [])];
  const revIds = [...new Set(all.filter((a) => a.kind === 'quotation_discount').map((a) => a.entity_id))];
  const supplierIds = [...new Set(all.filter((a) => a.kind === 'purchase_order').map((a) => a.impact?.supplier_id).filter(Boolean))] as string[];
  const people = [...new Set(all.flatMap((a) => [a.requested_by, a.decided_by]).filter(Boolean))] as string[];
  const [{ data: revs }, staff, { data: suppliers }] = await Promise.all([
    revIds.length ? supabase.from('quotation_revisions').select('id, quotation_id').in('id', revIds) : Promise.resolve({ data: [] as any[] }),
    staffNames(people),
    supplierIds.length ? supabase.from('organizations').select('id, name').in('id', supplierIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const supplierName = new Map((suppliers ?? []).map((x: any) => [x.id, x.name]));
  const title = (a: any) =>
    a.kind === 'purchase_order' ? t('approvals.po_card_title', { po: a.impact?.po_number ?? '' })
    : a.kind === 'payment_exception' ? t('approvals.exception_card_title', { project: a.impact?.project_number ?? '' })
    : t('approvals.card_title', { quotation: a.impact?.quotation_number ?? '', no: a.impact?.revision_no ?? '' });
  const quotationOf = new Map((revs ?? []).map((r: any) => [r.id, r.quotation_id]));
  const name = new Map([...staff].map(([id, n]) => [id, n ?? t('common.unnamed_user')]));
  const days = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));

  return (
    <>
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />
      {(pending.data ?? []).length === 0 ? (
        <EmptyState title={t('approvals.empty')} />
      ) : (
        <div className="flex flex-col gap-4">
          {(pending.data ?? []).map((a: any) => {
            const qid = quotationOf.get(a.entity_id);
            return (
              <Card key={a.id} title={title(a)}>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <KeyValue
                    items={[
                      [t('approvals.kind'), t(`approvals.kind.${a.kind}`)],
                      [t('approvals.requester'), name.get(a.requested_by) ?? '—'],
                      [t('approvals.requested'), `${dt(a.requested_at, locale)} · ${t('approvals.age_days', { days: days(a.requested_at) })}`],
                      [t('approvals.reasons'), (a.reasons ?? []).map((r: string) => t(`enum.approval_reason.${r}`)).join(', ')],
                      ...(a.kind === 'purchase_order'
                        ? ([
                            [t('approvals.threshold'), t('approvals.po_limit', { limit: inr(a.policy?.limitPaise) })],
                            [t('approvals.impact_total'), inr(a.impact?.totalPaise)],
                            [t('field.supplier_id'), supplierName.get(a.impact?.supplier_id) ?? '—'],
                          ] as [string, string][])
                        : a.kind === 'payment_exception'
                          ? ([
                              [t('field.gated_action'), t(`enum.gated_action.${a.impact?.action ?? 'procurement'}`)],
                              [t('approvals.blocking'), (a.policy?.blocking ?? []).map((c: string) => t(`enum.milestone.${c}`)).join(', ') || '—'],
                              [t('approvals.valid_until'), dt(a.impact?.expires_at, locale)],
                              [t('field.exception_justification'), a.impact?.justification ?? '—'],
                            ] as [string, string][])
                          : ([
                              [t('approvals.threshold'), t('approvals.threshold_value', { discount: pct(a.policy?.maxDiscountBpsWithoutApproval), margin: pct(a.policy?.marginFloorBps) })],
                              [t('approvals.impact_discount'), `${pct(a.impact?.overallDiscountBps)} (${inr(a.impact?.discountPaise)})`],
                              [t('approvals.impact_margin'), pct(a.impact?.contributionMarginBps)],
                              [t('approvals.impact_total'), inr(a.impact?.grandTotalPaise)],
                              [t('approvals.impact_cost'), inr(a.impact?.estimatedDirectCostPaise)],
                            ] as [string, string][])),
                    ]}
                  />
                  <div className="flex flex-col gap-3">
                    {qid ? <Link prefetch={false} href={`/quotations/${qid}`} className="text-sm underline">{t('approvals.open_quotation')}</Link> : null}
                    {a.kind === 'purchase_order' ? <Link prefetch={false} href={`/procurement/orders/${a.entity_id}`} className="text-sm underline">{t('approvals.open_po')}</Link> : null}
                    {a.kind === 'payment_exception' ? <Link prefetch={false} href={`/projects/${a.entity_id}`} className="text-sm underline">{t('approvals.open_project')}</Link> : null}
                    <p className="text-xs text-silver-700">{t(`approvals.consequence.${a.kind}`)}</p>
                    {a.requested_by === ctx.user_id ? (
                      <p role="note" className="rounded-md bg-warn-50 px-3 py-2 text-sm text-warn-700">{t('approvals.own_request')}</p>
                    ) : a.kind === 'quotation_discount' ? (
                      <ApprovalDecisionForm requestId={a.id} />
                    ) : (
                      <DecideRequestForm requestId={a.id} />
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Card title={t('approvals.history')} className="mt-6">
        {(decided.data ?? []).length === 0 ? (
          <p className="text-sm text-silver-700">{t('approvals.no_history')}</p>
        ) : (
          <ul className="text-sm">
            {(decided.data ?? []).map((a: any) => (
              <li key={a.id} className="border-t border-silver-200 py-2 first:border-0">
                <StateBadge state={a.status} labelText={t(`approvals.state.${a.status}`)} /> {t(`approvals.kind.${a.kind}`)} · {a.impact?.quotation_number ?? a.impact?.po_number ?? a.impact?.project_number} · {t('approvals.decided_by', { name: name.get(a.decided_by) ?? '—', date: dt(a.decided_at, locale) })}
                {a.decision_reason ? ` · ${a.decision_reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

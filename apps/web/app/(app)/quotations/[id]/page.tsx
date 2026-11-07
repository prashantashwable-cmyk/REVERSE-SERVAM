import Link from 'next/link';
import { notFound } from 'next/navigation';
import { QUOTATION_TERM_KEYS, formatBps, formatInr, formatQuantityMilli, fromServerError, paiseToInput } from '@aiec/domain';
import { Card, EmptyState, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt, istNowLocal } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { IssueQuotationButton, NegotiationForm, QuotationEditor, ResponseForm, ReviseForm, SubmitQuotationButton } from '../quotation-forms';
import type { LineDraft } from '../quotation-types';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('quotation.title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));
const isoDate = (offsetDays: number) => new Date(Date.now() + 330 * 60000 + offsetDays * 864e5).toISOString().slice(0, 10);

/** SE08 request / SE09 presentation / SE10 negotiation for one quotation. */
export default async function QuotationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rev?: string }> }) {
  const { id } = await params;
  const { rev } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const d = (iso: string | null | undefined) => dt(iso, locale);
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const supabase = await supabaseServer();

  const { data: q, error } = await supabase.from('quotations').select('*').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!q) notFound();
  const [{ data: lead }, { data: revisions }, { data: negotiations }, { data: approvals }, { data: taxRule }] = await Promise.all([
    supabase.from('leads').select('id, lead_number, project_name, contact_name, owner_user_id, status').eq('id', q.lead_id).maybeSingle(),
    supabase.from('quotation_revisions').select('*').eq('quotation_id', id).order('revision_no', { ascending: false }),
    supabase.from('quotation_negotiations').select('*').eq('quotation_id', id).order('occurred_at', { ascending: false }),
    supabase.from('approval_requests').select('id, entity_id, status, reasons, decision_reason, decided_at, requested_at').eq('lead_id', q.lead_id).order('requested_at', { ascending: false }),
    supabase.from('business_rules').select('value, version').eq('rule_key', 'commercial.tax_codes').order('version', { ascending: false }).limit(1),
  ]);
  const current = (revisions ?? []).find((r: any) => r.id === q.current_revision_id);
  const shown = (revisions ?? []).find((r: any) => r.id === rev) ?? current;
  if (!shown) notFound();
  const [{ data: lines }, { data: acceptance }, { data: config }] = await Promise.all([
    supabase.from('quotation_lines').select('*').eq('revision_id', shown.id).order('line_no'),
    supabase.from('customer_acceptances').select('*').eq('revision_id', shown.id).maybeSingle(),
    supabase.from('configuration_revisions').select('revision_no, status, lift_category, checksum').eq('id', shown.configuration_revision_id).maybeSingle(),
  ]);

  const isOwner = lead?.owner_user_id === ctx.user_id;
  const isCurrent = shown.id === q.current_revision_id;
  const today = isoDate(0);
  const expired = shown.status === 'issued' && shown.valid_until < today;
  const totals = shown.totals ?? {};
  const taxCodes = ((taxRule?.[0]?.value as { codes?: { code: string; rateBps: number }[] })?.codes ?? []).map((c) => ({ code: c.code, rateBps: c.rateBps }));
  const drafts: LineDraft[] = (lines ?? []).map((l: any) => ({
    category: l.category, description: l.description, quantity: formatQuantityMilli(l.quantity_milli), unit: l.unit,
    rate: paiseToInput(BigInt(l.rate_paise)), discountPercent: l.discount_bps ? formatBps(l.discount_bps) : '', taxCode: l.tax_code,
    estimatedUnitCost: l.estimated_unit_cost_paise === null ? '' : paiseToInput(BigInt(l.estimated_unit_cost_paise)), costSource: l.cost_source ?? '',
  }));
  const terms = (shown.terms ?? {}) as Record<string, string>;
  const pending = (approvals ?? []).find((a: any) => a.entity_id === shown.id && a.status === 'pending');

  return (
    <>
      <PageHeader
        title={`${q.quotation_number} · ${lead?.project_name ?? ''}`}
        subtitle={t('quotation.subtitle', { revision: shown.revision_no, lead: lead?.lead_number ?? '' })}
        actions={<StateBadge state={expired ? 'expired' : shown.status} labelText={t(`quotation.state.${expired ? 'expired' : shown.status}`)} />}
      />
      <p className="mb-4 flex flex-wrap gap-3 text-sm">
        {lead ? <Link prefetch={false} href={`/leads/${lead.id}`} className="underline">{t('quotation.open_lead')}</Link> : null}
        {(revisions ?? []).map((r: any) => (
          <Link prefetch={false} key={r.id} href={`/quotations/${id}?rev=${r.id}`} className={r.id === shown.id ? 'font-semibold' : 'underline'}>
            {t('quotation.rev_link', { no: r.revision_no, state: t(`quotation.state.${r.status}`) })}
          </Link>
        ))}
      </p>
      {!isCurrent ? <p role="note" className="mb-4 rounded-md bg-warn-50 px-3 py-2 text-sm text-warn-700">{t('quotation.old_revision')}</p> : null}
      {expired ? <p role="alert" className="mb-4 rounded-md bg-warn-50 px-3 py-2 text-sm text-warn-700">{t('quotation.expired_note')}</p> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('quotation.summary')}>
          <KeyValue
            items={[
              [t('quotation.valid_until'), shown.valid_until],
              [t('quotation.configuration'), config ? t('quotation.configuration_ref', { no: config.revision_no, state: t(`technical.config_state.${config.status}`), category: t(`enum.lift_category.${config.lift_category}`) }) : '—'],
              [t('quotation.taxable'), inr(totals.taxablePaise)],
              [t('quotation.tax'), inr(totals.taxPaise)],
              [t('quotation.grand_total'), <strong key="g">{inr(totals.grandTotalPaise)}</strong>],
              [t('quotation.discount'), totals.overallDiscountBps === null || totals.overallDiscountBps === undefined ? '—' : `${formatBps(totals.overallDiscountBps)}% (${inr(totals.discountPaise)})`],
              [t('quotation.estimated_cost'), inr(totals.estimatedDirectCostPaise)],
              [t('quotation.contribution'), totals.contributionMarginBps === null || totals.contributionMarginBps === undefined ? '—' : `${inr(totals.grossContributionPaise)} (${formatBps(totals.contributionMarginBps)}%)`],
              [t('quotation.approval'), shown.needs_approval ? (shown.approval_reasons ?? []).map((r: string) => t(`enum.approval_reason.${r}`)).join(', ') : t('quotation.within_authority')],
              [t('quotation.content_hash'), shown.content_sha256 ? <span key="h" className="font-mono text-xs">{shown.content_sha256}</span> : '—'],
            ]}
          />
          <p className="mt-2 text-xs text-silver-700">{t('quotation.internal_note')}</p>
        </Card>
        <Card title={t('quotation.terms')}>
          <KeyValue items={QUOTATION_TERM_KEYS.map((k) => [t(`field.terms.${k}`), terms[k] ?? '—'])} />
        </Card>
      </div>

      <Card title={t('quotation.lines')} className="mt-4">
        {lines && lines.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('quotation.lines')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">{t('field.description')}</th>
                  <th className="py-1 pr-3">{t('field.quantity')}</th>
                  <th className="py-1 pr-3">{t('field.rate')}</th>
                  <th className="py-1 pr-3">{t('field.discount_percent')}</th>
                  <th className="py-1 pr-3">{t('field.tax_code')}</th>
                  <th className="py-1 pr-3">{t('quotation.line_total')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l: any) => (
                  <tr key={l.id} className="border-t border-silver-200">
                    <td className="py-1 pr-3">{l.line_no}</td>
                    <td className="py-1 pr-3">
                      {l.description}
                      <span className="block text-xs text-silver-700">{t(`enum.line_category.${l.category}`)}</span>
                    </td>
                    <td className="py-1 pr-3">{formatQuantityMilli(l.quantity_milli)} {l.unit}</td>
                    <td className="py-1 pr-3">{inr(l.rate_paise)}</td>
                    <td className="py-1 pr-3">{l.discount_bps ? `${formatBps(l.discount_bps)}%` : '—'}</td>
                    <td className="py-1 pr-3">{l.tax_code}</td>
                    <td className="py-1 pr-3">{inr(l.total_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={t('quotation.no_lines')} />
        )}
      </Card>

      {isCurrent && isOwner && shown.status === 'draft' ? (
        <Card title={t('quotation.edit_draft')} className="mt-4">
          {shown.revision_reason ? <p className="mb-3 text-sm text-warn-700">{t('quotation.revision_reason', { reason: shown.revision_reason })}</p> : null}
          <QuotationEditor revisionId={shown.id} version={shown.version} initialLines={drafts} terms={terms} validUntil={shown.valid_until} taxCodes={taxCodes} minDate={today} maxDate={isoDate(365)} />
          <div className="mt-4 border-t border-silver-200 pt-4">
            <p className="mb-2 text-sm text-silver-700">{shown.needs_approval ? t('quotation.submit_needs_approval') : t('quotation.submit_within_authority')}</p>
            <SubmitQuotationButton revisionId={shown.id} version={shown.version} />
          </div>
        </Card>
      ) : null}

      {isCurrent && shown.status === 'pending_approval' ? (
        <p role="status" className="mt-4 rounded-md bg-warn-50 px-3 py-2 text-sm text-warn-700">
          {t('quotation.waiting_approval')} {can(ctx, 'quotation.discount.approve') && pending ? <Link prefetch={false} href="/approvals" className="underline">{t('nav.approvals')}</Link> : null}
        </p>
      ) : null}

      {isCurrent && isOwner && shown.status === 'approved' ? (
        <Card title={t('quotation.issue_title')} className="mt-4">
          <p className="mb-2 text-sm text-silver-700">{t('quotation.issue_hint')}</p>
          <IssueQuotationButton revisionId={shown.id} version={shown.version} />
        </Card>
      ) : null}

      {isCurrent && isOwner && shown.status === 'issued' && !expired ? (
        <Card title={t('quotation.response_title')} className="mt-4">
          <ResponseForm revisionId={shown.id} version={shown.version} contentSha256={shown.content_sha256} />
        </Card>
      ) : null}

      {acceptance ? (
        <Card title={t('quotation.acceptance')} className="mt-4">
          <KeyValue
            items={[
              [t('field.accepted_by_name'), acceptance.accepted_by_name],
              [t('field.acceptor_authority'), acceptance.acceptor_authority],
              [t('field.channel'), t(`enum.acceptance_channel.${acceptance.channel}`)],
              [t('field.evidence'), acceptance.evidence],
              [t('quotation.recorded_on'), d(acceptance.recorded_at)],
              [t('quotation.content_hash'), <span key="h" className="font-mono text-xs">{acceptance.content_sha256}</span>],
            ]}
          />
          <p className="mt-2 text-xs text-silver-700">{t('quotation.next_slice_order')}</p>
        </Card>
      ) : null}

      {isCurrent && isOwner && ['pending_approval', 'approved', 'issued', 'rejected_by_customer', 'expired'].includes(shown.status) ? (
        <Card title={t('quotation.revise_title')} className="mt-4">
          <ReviseForm quotationId={q.id} />
        </Card>
      ) : null}

      <Card title={t('quotation.negotiation')} className="mt-4">
        {negotiations && negotiations.length > 0 ? (
          <ol className="mb-4 text-sm">
            {negotiations.map((n: any) => (
              <li key={n.id} className="border-t border-silver-200 py-2 first:border-0">
                <p className="font-semibold">{n.topic} · {n.contact} · {d(n.occurred_at)}</p>
                <p className="text-silver-700">
                  {[n.requested_change, n.requested_discount_bps !== null ? t('quotation.requested_discount', { percent: formatBps(n.requested_discount_bps) }) : null, n.expected_impact, n.decision ? t('quotation.neg_decision', { decision: n.decision }) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mb-4 text-sm text-silver-700">{t('quotation.no_negotiation')}</p>
        )}
        {isOwner && shown.status !== 'accepted' ? <NegotiationForm quotationId={q.id} nowLocal={istNowLocal()} /> : null}
      </Card>

      {approvals && approvals.length > 0 ? (
        <Card title={t('quotation.approval_history')} className="mt-4">
          <ul className="text-sm">
            {approvals.map((a: any) => (
              <li key={a.id} className="border-t border-silver-200 py-2 first:border-0">
                <StateBadge state={a.status} labelText={t(`approvals.state.${a.status}`)} /> {d(a.requested_at)} · {(a.reasons ?? []).map((r: string) => t(`enum.approval_reason.${r}`)).join(', ')}
                {a.decision_reason ? ` · ${a.decision_reason}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

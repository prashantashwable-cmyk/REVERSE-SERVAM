import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GATED_ACTIONS, formatBps, formatInr, formatQuantityMilli, fromServerError, milestoneStatuses, paiseToInput } from '@aiec/domain';
import { Badge, Card, EmptyState, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { CreateRequestForm } from '../../procurement/procurement-forms';
import {
  AcknowledgeHandoverForm,
  ApproveBomButton,
  BomEditor,
  DecideClaimForm,
  RecordClaimForm,
  RequestExceptionForm,
  ResubmitClaimForm,
} from '../project-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('project.title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));
const isoDate = (offsetDays: number) => new Date(Date.now() + 330 * 60000 + offsetDays * 864e5).toISOString().slice(0, 10);
type Gate = { open: boolean; blocking: string[]; viaException: boolean };

/** O06 project workspace: order, Gate 5 milestones and claims, BOM (TE05) and purchasing (Gate 6). */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const d = (iso: string | null | undefined) => dt(iso, locale);
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const supabase = await supabaseServer();

  const { data: p, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!p) notFound();
  const [{ data: order }, { data: milestones }, { data: claims }, { data: lead }, { data: boms }, { data: requests }, { data: pos }, { data: exceptions }, ...gates] = await Promise.all([
    supabase.from('orders').select('*').eq('id', p.order_id).maybeSingle(),
    supabase.from('payment_milestones').select('*').eq('project_id', id).order('sequence'),
    supabase.from('payment_claims').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('leads').select('id, lead_number, owner_user_id').eq('id', p.lead_id).maybeSingle(),
    supabase.from('bom_revisions').select('*').eq('project_id', id).order('revision_no', { ascending: false }),
    supabase.from('purchase_requests').select('id, request_number, status, required_by, created_at').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('purchase_orders').select('id, po_number, status, totals, supplier_id, delivery_to').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('approval_requests').select('id, status, impact, decision_reason, requested_at').eq('kind', 'payment_exception').eq('entity_id', id).order('requested_at', { ascending: false }),
    ...GATED_ACTIONS.map((a) => supabase.rpc('project_payment_gate', { p_project_id: id, p_action: a })),
  ]);
  const gateOf = new Map(GATED_ACTIONS.map((a, i) => [a, (gates[i]?.data ?? null) as Gate | null]));
  const procurementGate = gateOf.get('procurement');

  const draft = (boms ?? []).find((b: any) => b.status === 'draft');
  const approved = (boms ?? []).find((b: any) => b.status === 'approved');
  const shownBom = draft ?? approved;
  const [{ data: bomLines }, { data: approvedLines }, { data: usedLines }, { data: suppliers }] = await Promise.all([
    shownBom ? supabase.from('bom_lines').select('*').eq('bom_revision_id', shownBom.id).order('line_no') : Promise.resolve({ data: [] as any[] }),
    approved ? supabase.from('bom_lines').select('*').eq('bom_revision_id', approved.id).order('line_no') : Promise.resolve({ data: [] as any[] }),
    (requests ?? []).length
      ? supabase.from('purchase_request_lines').select('bom_line_id, quantity_milli, request_id').in('request_id', (requests ?? []).filter((r: any) => r.status !== 'cancelled').map((r: any) => r.id))
      : Promise.resolve({ data: [] as any[] }),
    can(ctx, 'procurement.request.create') ? supabase.from('organizations').select('id, name').eq('kind', 'supplier').eq('status', 'active').order('name') : Promise.resolve({ data: [] as any[] }),
  ]);

  const isLeadOwner = !!lead && lead.owner_user_id === ctx.user_id;
  const canRecordClaim = (isLeadOwner && can(ctx, 'order.convert')) || can(ctx, 'finance.payment.verify');
  const statuses = milestoneStatuses(
    (milestones ?? []).map((m: any) => ({ code: m.code, label: m.code, shareBps: m.share_bps, trigger: m.trigger_event, dueDays: m.due_days, gates: m.gates, amountPaise: BigInt(m.amount_paise) })),
    (claims ?? []).map((c: any) => ({ milestoneCode: c.milestone_code, amountPaise: BigInt(c.amount_paise), status: c.status, verifiedAmountPaise: c.verified_amount_paise === null ? undefined : BigInt(c.verified_amount_paise) })),
  );
  const statusOf = new Map(statuses.map((s) => [s.code, s]));
  const used = new Map<string, number>();
  for (const l of usedLines ?? []) used.set(l.bom_line_id, (used.get(l.bom_line_id) ?? 0) + l.quantity_milli);
  const requestable = (approvedLines ?? [])
    .map((l: any) => ({ id: l.id, label: `${l.item_code} · ${l.description}`, remainingMilli: l.quantity_milli - (used.get(l.id) ?? 0), unit: l.unit }))
    .filter((l) => l.remainingMilli > 0)
    .map((l) => ({ id: l.id, label: l.label, remaining: formatQuantityMilli(l.remainingMilli), unit: l.unit }));
  const editorRows = ((draft ? bomLines : approvedLines) ?? []).map((l: any) => ({
    item_code: l.item_code, description: l.description, make_model: l.make_model ?? '', specification: l.specification ?? '',
    quantity: formatQuantityMilli(l.quantity_milli), unit: l.unit, source: l.source ?? '', technical_notes: l.technical_notes ?? '',
  }));
  const canSeePurchasing = (['project.read_all', 'finance.ledger.read', 'procurement.request.create', 'procurement.po.create', 'procurement.grn.record', 'procurement.po.approve'] as const).some((x) => can(ctx, x));
  const open = !['closed', 'cancelled'].includes(p.status);
  const procurementStage = ['planning', 'installation_ready', 'installation'].includes(p.status);

  return (
    <>
      <PageHeader
        title={`${p.project_number} · ${p.title}`}
        subtitle={p.site_label}
        actions={<StateBadge state={p.status} labelText={t(`project.state.${p.status}`)} />}
      />
      {lead ? (
        <p className="mb-4 text-sm"><Link prefetch={false} href={`/leads/${lead.id}`} className="underline">{t('project.open_lead', { lead: lead.lead_number })}</Link></p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('project.summary')}>
          <KeyValue
            items={[
              [t('common.status'), t(`project.state.${p.status}`)],
              [t('project.created_on'), d(p.created_at)],
              [t('project.handover'), p.handover_acknowledged_at ? t('project.handover_done', { date: d(p.handover_acknowledged_at) }) : t('project.handover_waiting')],
              ...(p.handover_notes ? [[t('field.notes'), p.handover_notes] as [string, string]] : []),
            ]}
          />
          {p.status === 'created' && can(ctx, 'project.plan') ? (
            <div className="mt-4 border-t border-silver-200 pt-4">
              <p className="mb-2 text-sm text-silver-700">{t('project.acknowledge_intro')}</p>
              <AcknowledgeHandoverForm projectId={p.id} version={p.version} />
            </div>
          ) : null}
        </Card>
        {order ? (
          <Card title={t('order.title')}>
            <KeyValue
              items={[
                [t('order.number'), <span key="n" className="font-mono">{order.order_number}</span>],
                [t('common.status'), t(`order.state.${order.status}`)],
                [t('field.contract_reference'), order.contract_reference],
                [t('field.contract_date'), order.contract_date],
                [t('order.contract_value'), <strong key="v">{inr(order.contract_value_paise)}</strong>],
                [t('order.taxable_value'), inr(order.taxable_value_paise)],
                [t('field.milestone_template'), t('order.template_ref', { template: t(`enum.milestone_template.${order.milestone_template_code}`), version: order.milestone_template_version })],
                ...(order.notes ? [[t('field.notes'), order.notes] as [string, string]] : []),
              ]}
            />
            {order.quotation_id ? <p className="mt-2 text-sm"><Link prefetch={false} href={`/quotations/${order.quotation_id}`} className="underline">{t('order.open_quotation')}</Link></p> : null}
          </Card>
        ) : null}
      </div>

      <Card title={t('gate5.title')} className="mt-4">
        <p className="mb-3 text-sm text-silver-700">{t('gate5.intro')}</p>
        <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          {GATED_ACTIONS.map((a) => {
            const g = gateOf.get(a);
            return (
              <li key={a} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t(`enum.gated_action.${a}`)}:</span>
                {!g ? '—' : g.open ? <Badge tone="ok">{g.viaException ? t('gate5.open_exception') : t('gate5.open')}</Badge> : <Badge tone="warn">{t('gate5.blocked')}</Badge>}
                {g && !g.open && g.blocking.length ? <span className="text-silver-700">{t('gate5.waiting_for', { items: g.blocking.map((c) => t(`enum.milestone.${c}`)).join(', ') })}</span> : null}
              </li>
            );
          })}
        </ul>
        {(exceptions ?? []).length > 0 ? (
          <ul className="mt-3 text-sm">
            {(exceptions ?? []).map((x: any) => (
              <li key={x.id} className="border-t border-silver-200 py-2">
                <StateBadge state={x.status} labelText={t(`approvals.state.${x.status}`)} />{' '}
                {t('payment.exception_line', { action: t(`enum.gated_action.${x.impact?.action ?? 'procurement'}`), until: d(x.impact?.expires_at), reason: x.impact?.justification ?? '' })}
                {x.decision_reason ? ` · ${x.decision_reason}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        {open && can(ctx, 'project.plan') && procurementGate && !procurementGate.open ? (
          <div className="mt-4 border-t border-silver-200 pt-4">
            <p className="mb-2 text-sm text-silver-700">{t('payment.exception_intro')}</p>
            <RequestExceptionForm projectId={p.id} />
          </div>
        ) : null}
      </Card>

      {milestones && milestones.length > 0 ? (
        <Card title={t('payment.milestones')} className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('payment.milestones')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-1 pr-3">{t('payment.col_milestone')}</th>
                  <th className="py-1 pr-3">{t('payment.col_share')}</th>
                  <th className="py-1 pr-3">{t('payment.col_due')}</th>
                  <th className="py-1 pr-3">{t('payment.col_verified')}</th>
                  <th className="py-1 pr-3">{t('payment.col_outstanding')}</th>
                  <th className="py-1 pr-3">{t('payment.col_unlocks')}</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m: any) => {
                  const s = statusOf.get(m.code);
                  return (
                    <tr key={m.id} className="border-t border-silver-200">
                      <td className="py-1 pr-3">
                        {t(`enum.milestone.${m.code}`)}
                        <span className="block text-xs text-silver-700">{t('payment.trigger', { trigger: t(`enum.milestone_trigger.${m.trigger_event}`), days: m.due_days })}</span>
                      </td>
                      <td className="py-1 pr-3">{formatBps(m.share_bps)}%</td>
                      <td className="py-1 pr-3">{inr(m.amount_paise)}</td>
                      <td className="py-1 pr-3">
                        {s ? formatInr(s.verifiedPaise) : '—'}
                        {s && s.claimedUnverifiedPaise > 0n ? <span className="block text-xs text-warn-700">{t('payment.claimed_unverified', { amount: formatInr(s.claimedUnverifiedPaise) })}</span> : null}
                      </td>
                      <td className="py-1 pr-3">{s ? (s.satisfied ? <Badge tone="ok">{t('payment.satisfied')}</Badge> : formatInr(s.outstandingPaise)) : '—'}</td>
                      <td className="py-1 pr-3">{(m.gates ?? []).map((g: string) => t(`enum.gated_action.${g}`)).join(', ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-silver-700">{t('payment.verified_only_note')}</p>
        </Card>
      ) : null}

      {order ? (
        <Card title={t('payment.claims')} className="mt-4">
          {claims && claims.length > 0 ? (
            <ul className="mb-4 flex flex-col gap-3 text-sm">
              {claims.map((c: any) => (
                <li key={c.id} className="rounded-md border border-silver-200 p-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{c.claim_number}</span>
                    <StateBadge state={c.status} labelText={t(`payment.state.${c.status}`)} />
                    <span>{t(`enum.milestone.${c.milestone_code}`)} · {inr(c.amount_paise)}</span>
                  </p>
                  <p className="text-silver-700">
                    {t('payment.claim_line', { payer: c.payer_name, mode: t(`enum.payment_mode.${c.payment_mode}`), reference: c.payment_reference, date: c.payment_date })}
                  </p>
                  {c.verified_amount_paise !== null ? <p className="text-silver-700">{t('payment.verified_line', { amount: inr(c.verified_amount_paise), statement: c.matched_statement_reference ?? '—' })}</p> : null}
                  {c.decision_reason ? <p className="text-silver-700">{t('payment.decision_reason', { reason: c.decision_reason })}</p> : null}
                  {can(ctx, 'finance.payment.verify') && ['claimed', 'pending_clarification'].includes(c.status) && c.submitted_by !== ctx.user_id ? (
                    <div className="mt-2 border-t border-silver-200 pt-2">
                      <DecideClaimForm claimId={c.id} version={c.version} claimedRupees={paiseToInput(BigInt(c.amount_paise))} />
                    </div>
                  ) : null}
                  {c.status === 'pending_clarification' && c.submitted_by === ctx.user_id ? (
                    <div className="mt-2 border-t border-silver-200 pt-2"><ResubmitClaimForm claimId={c.id} version={c.version} /></div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-silver-700">{t('payment.no_claims')}</p>
          )}
          {open && canRecordClaim && milestones && milestones.length > 0 ? (
            <div className="border-t border-silver-200 pt-4">
              <p className="mb-2 text-sm text-silver-700">{t('payment.record_intro')}</p>
              <RecordClaimForm projectId={p.id} operationId={randomUUID()} milestones={milestones.map((m: any) => m.code)} today={isoDate(0)} />
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title={t('bom.title')} className="mt-4">
        {shownBom ? (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{t('bom.revision', { no: shownBom.revision_no })}</span>
            <StateBadge state={shownBom.status} labelText={t(`bom.state.${shownBom.status}`)} />
            {approved && draft ? <span className="text-silver-700">{t('bom.approved_exists', { no: approved.revision_no })}</span> : null}
            {shownBom.change_summary ? <span className="text-silver-700">· {shownBom.change_summary}</span> : null}
          </p>
        ) : (
          <p className="mb-3 text-sm text-silver-700">{t('bom.none')}</p>
        )}
        {bomLines && bomLines.length > 0 ? (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('bom.title')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">{t('field.item_code')}</th>
                  <th className="py-1 pr-3">{t('field.description')}</th>
                  <th className="py-1 pr-3">{t('field.make_model')}</th>
                  <th className="py-1 pr-3">{t('field.quantity')}</th>
                  <th className="py-1 pr-3">{t('field.source')}</th>
                </tr>
              </thead>
              <tbody>
                {bomLines.map((l: any) => (
                  <tr key={l.id} className="border-t border-silver-200">
                    <td className="py-1 pr-3">{l.line_no}</td>
                    <td className="py-1 pr-3 font-mono text-xs">{l.item_code}</td>
                    <td className="py-1 pr-3">{l.description}{l.specification ? <span className="block text-xs text-silver-700">{l.specification}</span> : null}</td>
                    <td className="py-1 pr-3">{l.make_model ?? '—'}</td>
                    <td className="py-1 pr-3">{formatQuantityMilli(l.quantity_milli)} {l.unit}</td>
                    <td className="py-1 pr-3">{l.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {draft && can(ctx, 'technical.drawing.approve') && (bomLines ?? []).length > 0 ? (
          <div className="mb-4">
            <p className="mb-2 text-sm text-silver-700">{t('bom.approve_hint')}</p>
            <ApproveBomButton bomRevisionId={draft.id} version={draft.version} />
          </div>
        ) : null}
        {open && can(ctx, 'technical.review') ? (
          <details className="border-t border-silver-200 pt-4" open={!shownBom}>
            <summary className="cursor-pointer text-sm font-semibold">{draft ? t('bom.edit_draft') : approved ? t('bom.start_revision') : t('bom.start')}</summary>
            <div className="mt-3">
              <BomEditor projectId={p.id} version={draft ? draft.version : null} initial={editorRows} changeSummary={draft?.change_summary ?? ''} />
            </div>
          </details>
        ) : null}
      </Card>

      {canSeePurchasing ? (
        <Card title={t('procurement.title')} className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('procurement.requests')}</h3>
              {(requests ?? []).length === 0 ? (
                <p className="text-sm text-silver-700">{t('procurement.no_requests')}</p>
              ) : (
                <ul className="text-sm">
                  {(requests ?? []).map((r: any) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                      <Link prefetch={false} href={`/procurement/requests/${r.id}`} className="font-mono text-xs underline">{r.request_number}</Link>
                      <StateBadge state={r.status} labelText={t(`procurement.request_state.${r.status}`)} />
                      <span className="text-silver-700">{t('procurement.required_by_date', { date: r.required_by })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('procurement.orders')}</h3>
              {(pos ?? []).length === 0 ? (
                <p className="text-sm text-silver-700">{t('procurement.no_orders')}</p>
              ) : (
                <ul className="text-sm">
                  {(pos ?? []).map((o: any) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                      <Link prefetch={false} href={`/procurement/orders/${o.id}`} className="font-mono text-xs underline">{o.po_number}</Link>
                      <StateBadge state={o.status} labelText={t(`procurement.po_state.${o.status}`)} />
                      <span>{inr(o.totals?.totalPaise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {can(ctx, 'procurement.request.create') && open ? (
            <div className="mt-4 border-t border-silver-200 pt-4">
              <h3 className="mb-2 text-sm font-semibold">{t('procurement.new_request')}</h3>
              {!procurementStage ? (
                <p className="text-sm text-warn-700">{t('procurement.wait_handover')}</p>
              ) : !procurementGate?.open ? (
                <p className="text-sm text-warn-700">{t('procurement.wait_payment')}</p>
              ) : !approved ? (
                <p className="text-sm text-warn-700">{t('procurement.wait_bom')}</p>
              ) : requestable.length === 0 ? (
                <p className="text-sm text-silver-700">{t('procurement.all_requested')}</p>
              ) : (
                <CreateRequestForm projectId={p.id} operationId={randomUUID()} bomLines={requestable} suppliers={(suppliers ?? []).map((s: any) => ({ id: s.id, label: s.name }))} minDate={isoDate(0)} />
              )}
            </div>
          ) : null}
        </Card>
      ) : null}

      {!milestones?.length && !order && !shownBom ? <EmptyState title={t('project.limited_view')} /> : null}
    </>
  );
}

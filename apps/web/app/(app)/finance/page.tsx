import Link from 'next/link';
import { formatInr, fromServerError, paiseToInput } from '@aiec/domain';
import { Card, EmptyState, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { DecideClaimForm } from '../projects/project-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('finance.title') };
}
const inr = (v: unknown) => (v === null || v === undefined ? '—' : formatInr(BigInt(String(v))));

/** FN02: payment claims waiting for verification against the bank statement, oldest first. */
export default async function FinancePage() {
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'finance.payment.verify') && !can(ctx, 'finance.ledger.read')) return <PermissionDenied whatKey="finance.what" />;
  const supabase = await supabaseServer();
  const [waiting, decided] = await Promise.all([
    supabase.from('payment_claims').select('*').in('status', ['claimed', 'pending_clarification']).order('created_at', { ascending: true }).limit(200),
    supabase.from('payment_claims').select('*').in('status', ['verified', 'partially_verified', 'rejected']).order('updated_at', { ascending: false }).limit(30),
  ]);
  const err = waiting.error ?? decided.error;
  if (err) return <ErrorPanel code={fromServerError(err).code} />;
  const all = [...(waiting.data ?? []), ...(decided.data ?? [])];
  const projectIds = [...new Set(all.map((c) => c.project_id))];
  const people = [...new Set(all.flatMap((c) => [c.submitted_by, c.verified_by]).filter(Boolean))] as string[];
  const [{ data: projects }, { data: profiles }] = await Promise.all([
    projectIds.length ? supabase.from('projects').select('id, project_number, title').in('id', projectIds) : Promise.resolve({ data: [] as any[] }),
    people.length ? supabase.from('user_profiles').select('id, full_name').in('id', people) : Promise.resolve({ data: [] as any[] }),
  ]);
  const project = new Map((projects ?? []).map((p: any) => [p.id, p]));
  const name = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name ?? t('common.unnamed_user')]));

  return (
    <>
      <PageHeader title={t('finance.title')} subtitle={t('finance.subtitle')} />
      {(waiting.data ?? []).length === 0 ? (
        <EmptyState title={t('finance.empty')} />
      ) : (
        <div className="flex flex-col gap-4">
          {(waiting.data ?? []).map((c) => {
            const p = project.get(c.project_id);
            return (
              <Card key={c.id} title={t('finance.claim_title', { claim: c.claim_number, milestone: t(`enum.milestone.${c.milestone_code}`) })}>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <KeyValue
                      items={[
                        [t('projects.col_project'), p ? <Link key="p" prefetch={false} href={`/projects/${p.id}`} className="underline">{p.project_number} · {p.title}</Link> : '—'],
                        [t('common.status'), <StateBadge key="s" state={c.status} labelText={t(`payment.state.${c.status}`)} />],
                        [t('field.amount'), <strong key="a">{inr(c.amount_paise)}</strong>],
                        [t('field.payer_name'), c.payer_name],
                        [t('field.payment_mode'), t(`enum.payment_mode.${c.payment_mode}`)],
                        [t('field.payment_reference'), <span key="r" className="font-mono">{c.payment_reference}</span>],
                        [t('field.payment_date'), c.payment_date],
                        [t('field.evidence_note'), c.evidence_note ?? '—'],
                        [t('finance.recorded_by'), `${name.get(c.submitted_by) ?? '—'} · ${dt(c.created_at, locale)}`],
                        ...(c.decision_reason ? [[t('field.reason'), c.decision_reason] as [string, string]] : []),
                      ]}
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-silver-700">{t('finance.verify_rule')}</p>
                    {!can(ctx, 'finance.payment.verify') ? null : c.submitted_by === ctx.user_id ? (
                      <p role="note" className="rounded-md bg-warn-50 px-3 py-2 text-sm text-warn-700">{t('finance.own_claim')}</p>
                    ) : (
                      <DecideClaimForm claimId={c.id} version={c.version} claimedRupees={paiseToInput(BigInt(c.amount_paise))} />
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Card title={t('finance.history')} className="mt-6">
        {(decided.data ?? []).length === 0 ? (
          <p className="text-sm text-silver-700">{t('finance.no_history')}</p>
        ) : (
          <ul className="text-sm">
            {(decided.data ?? []).map((c) => (
              <li key={c.id} className="border-t border-silver-200 py-2 first:border-0">
                <StateBadge state={c.status} labelText={t(`payment.state.${c.status}`)} /> <span className="font-mono text-xs">{c.claim_number}</span> · {project.get(c.project_id)?.project_number ?? ''} ·{' '}
                {c.status === 'rejected'
                  ? t('finance.rejected_line', { claimed: inr(c.amount_paise), date: dt(c.updated_at, locale) })
                  : t('finance.verified_line', { amount: inr(c.verified_amount_paise ?? 0), claimed: inr(c.amount_paise), name: name.get(c.verified_by) ?? '—', date: dt(c.verified_at, locale) })}
                {c.decision_reason ? ` · ${c.decision_reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

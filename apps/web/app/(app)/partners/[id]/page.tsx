import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LIFT_CATEGORY_SCOPES, fromServerError, partnerMachine } from '@aiec/domain';
import { Badge, Card, KeyValue, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { staffNames } from '@/lib/people';
import { supabaseServer } from '@/lib/supabase/server';
import { DocumentDecisionForm, PartnerDecisionForm } from '../partner-admin-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('partners.detail_title') };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Eligibility = { status: string; eligible: boolean; failures: { type: string; reason: string }[] };

/** Partner verification workspace (§12.2, LP03 from AIEC's side, Gate 7). */
export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'partner.verify') && !can(ctx, 'partner.assign') && !can(ctx, 'project.read_all')) return <PermissionDenied whatKey="partners.what" />;
  const supabase = await supabaseServer();
  const { data: org, error } = await supabase.from('organizations').select('id, name, city, kind').eq('id', id).eq('kind', 'partner').maybeSingle();
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  if (!org) notFound();
  const [{ data: profile }, { data: docs }, ...elig] = await Promise.all([
    supabase.from('partner_profiles').select('*').eq('organization_id', id).maybeSingle(),
    supabase.from('partner_documents').select('*').eq('organization_id', id).order('uploaded_at', { ascending: false }),
    ...LIFT_CATEGORY_SCOPES.map((c) => supabase.rpc('partner_eligibility', { p_org_id: id, p_lift_category: c })),
  ]);
  const names = await staffNames((docs ?? []).map((d: any) => d.verified_by));
  const status = (profile?.status ?? 'draft') as string;
  const allowed = partnerMachine.transitions
    .filter((tr) => tr.from.includes(status as never) && tr.action !== 'submit' && can(ctx, tr.permission))
    .map((tr) => ({ action: tr.action, requiresReason: !!tr.requiresReason }));
  const eligibility = LIFT_CATEGORY_SCOPES.map((c, i) => ({ category: c, e: elig[i]?.data as Eligibility | null }));
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={org.name} subtitle={t('partners.detail_subtitle')} actions={<StateBadge state={status} labelText={t(`partner.state.${status}`)} />} />
      <p className="mb-4 text-sm"><Link prefetch={false} href="/partners" className="underline">{t('partners.back')}</Link></p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('partners.profile')}>
          {profile ? (
            <KeyValue
              items={[
                [t('field.legal_name'), profile.legal_name ?? '—'],
                [t('field.entity_type'), profile.entity_type ? t(`enum.entity_type.${profile.entity_type}`) : '—'],
                [t('field.registered_address'), profile.registered_address ?? '—'],
                [t('field.authorized_representative'), profile.authorized_representative ?? '—'],
                [t('field.contact_phone'), profile.contact_phone ?? '—'],
                [t('field.gst_number'), profile.gst_number ?? '—'],
                [t('field.service_areas'), (profile.service_areas ?? []).join(', ') || '—'],
                [t('field.lift_categories'), (profile.lift_categories ?? []).map((c: string) => t(`enum.lift_category.${c}`)).join(', ') || '—'],
                [t('field.team_size'), profile.team_size ?? '—'],
                [t('partners.declarations'), profile.safety_policy_accepted && profile.compliance_declaration ? t('partners.declarations_given') : t('partners.declarations_missing')],
                ...(profile.status_reason ? [[t('field.reason'), profile.status_reason] as [string, string]] : []),
              ]}
            />
          ) : (
            <p className="text-sm text-silver-700">{t('partners.no_profile')}</p>
          )}
        </Card>
        <Card title={t('partners.eligibility')}>
          <ul className="flex flex-col gap-2 text-sm">
            {eligibility.map(({ category, e }) => (
              <li key={category} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t(`enum.lift_category.${category}`)}:</span>
                {e?.eligible ? <Badge tone="ok">{t('partners.eligible')}</Badge> : <Badge tone="warn">{t('partners.not_eligible')}</Badge>}
                {e && !e.eligible ? (
                  <span className="text-silver-700">
                    {[...(['approved', 'conditional_approval'].includes(e.status) ? [] : [t('partners.status_blocks', { status: t(`partner.state.${e.status}`) })]),
                      ...e.failures.map((x) => t('partners.failure', { document: t(`enum.partner_document.${x.type}`), reason: t(`partners.reason.${x.reason}`) }))].join('; ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {allowed.length > 0 ? (
            <div className="mt-4 border-t border-silver-200 pt-4">
              <PartnerDecisionForm orgId={org.id} version={profile?.version ?? 1} actions={allowed} />
            </div>
          ) : null}
        </Card>
      </div>
      <Card title={t('partners.documents')} className="mt-4">
        {(docs ?? []).length === 0 ? (
          <p className="text-sm text-silver-700">{t('partners.no_documents')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(docs ?? []).map((d: any) => {
              const expired = d.expires_on && d.expires_on < today;
              return (
                <li key={d.id} className="rounded-md border border-silver-200 p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t(`enum.partner_document.${d.doc_type}`)}</span>
                    <StateBadge state={d.verification} labelText={t(`partners.verification.${d.verification}`)} />
                    {expired ? <Badge tone="crit">{t('partners.expired')}</Badge> : null}
                  </p>
                  <p className="text-silver-700">
                    {t('partners.document_line', { number: d.doc_number, issuer: d.issuer, issued: d.issued_on ?? '—', expires: d.expires_on ?? t('partners.no_expiry') })}
                    {d.scope?.length ? ` · ${t('partners.scope', { scope: d.scope.map((c: string) => t(`enum.lift_category.${c}`)).join(', ') })}` : ''}
                  </p>
                  <p className="font-mono text-xs text-silver-700">{t('technical.checksum', { sha: d.sha256 })}</p>
                  {d.verification !== 'pending' ? (
                    <p className="text-xs text-silver-700">{t('partners.decided_by', { name: names.get(d.verified_by) ?? '—', date: dt(d.verified_at, locale) })}{d.rejection_reason ? ` · ${d.rejection_reason}` : ''}</p>
                  ) : can(ctx, 'partner.verify') ? (
                    <div className="mt-2 border-t border-silver-200 pt-2"><DocumentDecisionForm documentId={d.id} /></div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

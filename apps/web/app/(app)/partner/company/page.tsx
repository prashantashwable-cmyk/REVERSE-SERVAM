import { randomUUID } from 'node:crypto';
import { Badge, Card, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { partnerMembership } from '@/lib/partner';
import { supabaseServer } from '@/lib/supabase/server';
import { DocumentUploadForm, ProfileForm, SubmitProfileButton } from '../partner-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('partner.company_title') };
}

/** LP02 company profile and LP03 compliance documents. */
export default async function PartnerCompanyPage() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const m = partnerMembership(ctx);
  if (!m || !can(ctx, 'partner.org.manage')) return <PermissionDenied whatKey="partner.company_what" />;
  const supabase = await supabaseServer();
  const [{ data: p }, { data: docs }] = await Promise.all([
    supabase.from('partner_profiles').select('*').eq('organization_id', m.organization_id).maybeSingle(),
    supabase.from('partner_documents').select('*').eq('organization_id', m.organization_id).order('uploaded_at', { ascending: false }),
  ]);
  const status = (p?.status ?? 'draft') as string;
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const values = {
    legal_name: p?.legal_name ?? '', entity_type: p?.entity_type ?? '', registered_address: p?.registered_address ?? '', operating_address: p?.operating_address ?? '',
    authorized_representative: p?.authorized_representative ?? '', contact_phone: p?.contact_phone ?? '', contact_email: p?.contact_email ?? '', gst_number: p?.gst_number ?? '',
    service_areas: p?.service_areas ?? [], lift_categories: p?.lift_categories ?? [], team_size: p?.team_size ? String(p.team_size) : '',
    experience_years: p?.experience_years !== null && p?.experience_years !== undefined ? String(p.experience_years) : '',
    safety_policy_accepted: !!p?.safety_policy_accepted, compliance_declaration: !!p?.compliance_declaration,
  };

  return (
    <>
      <PageHeader title={t('partner.company_title')} subtitle={m.organization_name} actions={<StateBadge state={status} labelText={t(`partner.state.${status}`)} />} />
      {p?.status_reason ? <p role="note" className="mb-4 rounded-md bg-warn-50 px-3 py-2 text-sm text-warn-700">{t('partner.aiec_note', { reason: p.status_reason })}</p> : null}
      <Card title={t('partner.profile')}>
        {status === 'draft' ? (
          <>
            <ProfileForm orgId={m.organization_id} version={p?.version ?? null} values={values} />
            {p ? (
              <div className="mt-4 border-t border-silver-200 pt-4">
                <p className="mb-2 text-sm text-silver-700">{t('partner.submit_hint')}</p>
                <SubmitProfileButton orgId={m.organization_id} version={p.version} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-silver-700">{t('partner.profile_locked')}</p>
        )}
      </Card>
      <Card title={t('partner.documents')} className="mt-4">
        <p className="mb-3 text-sm text-silver-700">{t('partner.documents_intro')}</p>
        {(docs ?? []).length > 0 ? (
          <ul className="mb-4 flex flex-col gap-2 text-sm">
            {(docs ?? []).map((d: any) => (
              <li key={d.id} className="rounded-md border border-silver-200 p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t(`enum.partner_document.${d.doc_type}`)}</span>
                  <StateBadge state={d.verification} labelText={t(`partners.verification.${d.verification}`)} />
                  {d.expires_on && d.expires_on < today ? <Badge tone="crit">{t('partners.expired')}</Badge> : null}
                </p>
                <p className="text-silver-700">{t('partners.document_line', { number: d.doc_number, issuer: d.issuer, issued: d.issued_on ?? '—', expires: d.expires_on ?? t('partners.no_expiry') })}</p>
                {d.rejection_reason ? <p className="text-crit-700">{t('partner.rejected_because', { reason: d.rejection_reason })}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <DocumentUploadForm orgId={m.organization_id} operationId={randomUUID()} />
      </Card>
    </>
  );
}

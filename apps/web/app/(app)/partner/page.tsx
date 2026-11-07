import Link from 'next/link';
import { fromServerError } from '@aiec/domain';
import { Badge, Card, EmptyState, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { partnerMembership } from '@/lib/partner';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('partner.home_title') };
}

/** LP01 partner dashboard: company status, compliance, invitations and active projects (AIEC states shown as AIEC's). */
export default async function PartnerHomePage() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const m = partnerMembership(ctx);
  if (!m || (!can(ctx, 'partner.project.read') && !can(ctx, 'partner.org.manage'))) return <PermissionDenied whatKey="partner.what" />;
  const supabase = await supabaseServer();
  const [{ data: profile }, { data: assignments, error }, { data: elig }] = await Promise.all([
    supabase.from('partner_profiles').select('status, status_reason').eq('organization_id', m.organization_id).maybeSingle(),
    supabase.from('project_partner_assignments').select('id, project_id, status, schedule_from, schedule_to, invited_at').eq('partner_org_id', m.organization_id).order('invited_at', { ascending: false }),
    supabase.rpc('partner_eligibility', { p_org_id: m.organization_id, p_lift_category: null }),
  ]);
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  const projectIds = [...new Set((assignments ?? []).map((a) => a.project_id))];
  const { data: projects } = projectIds.length ? await supabase.from('projects').select('id, project_number, title, site_label, status').in('id', projectIds) : { data: [] as any[] };
  const project = new Map((projects ?? []).map((p: any) => [p.id, p]));
  const status = profile?.status ?? 'draft';
  const e = elig as { eligible: boolean; failures: { type: string; reason: string }[] } | null;
  const groups = [
    { key: 'invitations', title: t('partner.invitations'), rows: (assignments ?? []).filter((a) => a.status === 'invited' || a.status === 'clarification_requested'), empty: t('partner.no_invitations') },
    { key: 'active', title: t('partner.active_projects'), rows: (assignments ?? []).filter((a) => a.status === 'accepted'), empty: t('partner.no_active_projects') },
    { key: 'past', title: t('partner.past'), rows: (assignments ?? []).filter((a) => ['declined', 'withdrawn', 'ended'].includes(a.status)), empty: t('partner.none') },
  ];

  return (
    <>
      <PageHeader title={m.organization_name} subtitle={t('partner.home_subtitle')} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('partner.company_status')}>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t('partner.aiec_status')}</span>
            <StateBadge state={status} labelText={t(`partner.state.${status}`)} />
          </p>
          {profile?.status_reason ? <p className="mt-1 text-sm text-silver-700">{profile.status_reason}</p> : null}
          {can(ctx, 'partner.org.manage') ? <p className="mt-3 text-sm"><Link prefetch={false} href="/partner/company" className="underline">{t('partner.open_company')}</Link></p> : null}
        </Card>
        <Card title={t('partner.compliance')}>
          {e?.eligible ? <Badge tone="ok">{t('partner.eligible_now')}</Badge> : <Badge tone="warn">{t('partner.not_eligible_now')}</Badge>}
          {e && e.failures.length ? (
            <ul className="mt-2 list-inside list-disc text-sm text-silver-700">
              {e.failures.map((x) => <li key={x.type}>{t('partners.failure', { document: t(`enum.partner_document.${x.type}`), reason: t(`partners.reason.${x.reason}`) })}</li>)}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-silver-700">{t('partner.compliance_note')}</p>
        </Card>
      </div>
      {groups.map((g) => (
        <Card key={g.key} title={g.title} className="mt-4">
          {g.rows.length === 0 ? (
            g.key === 'invitations' ? <EmptyState title={g.empty} /> : <p className="text-sm text-silver-700">{g.empty}</p>
          ) : (
            <ul className="text-sm">
              {g.rows.map((a) => {
                const p = project.get(a.project_id);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-2 first:border-0">
                    <Link prefetch={false} href={`/partner/assignments/${a.id}`} className="font-semibold text-navy-700 underline">{p ? `${p.project_number} · ${p.title}` : a.id}</Link>
                    <StateBadge state={a.status} labelText={t(`execution.assignment_state.${a.status}`)} />
                    <span className="text-silver-700">{p?.site_label ?? ''} · {t('procurement.delivery_range', { from: a.schedule_from, to: a.schedule_to })}</span>
                    {p && a.status === 'accepted' ? <span className="text-silver-700">· {t('partner.project_status', { status: t(`project.state.${p.status}`) })}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ))}
      {can(ctx, 'partner.team.manage') ? <p className="mt-4 text-sm"><Link prefetch={false} href="/partner/team" className="underline">{t('partner.open_team')}</Link></p> : null}
    </>
  );
}

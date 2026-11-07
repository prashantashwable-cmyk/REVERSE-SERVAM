import { Card, EmptyState, PageHeader } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { can, getContext } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { partnerMembership } from '@/lib/partner';
import { staffNames } from '@/lib/people';
import { supabaseServer } from '@/lib/supabase/server';
import { WorkerForm } from '../partner-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('partner.team_title') };
}

/** LP06 team directory: field people, roles, skills and training (people are added in Users & roles). */
export default async function PartnerTeamPage() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const m = partnerMembership(ctx);
  if (!m || !can(ctx, 'partner.team.manage')) return <PermissionDenied whatKey="partner.team_what" />;
  const supabase = await supabaseServer();
  const [{ data: roles }, { data: workers }] = await Promise.all([
    supabase.from('user_roles').select('user_id, role_code').eq('organization_id', m.organization_id).is('revoked_at', null).in('role_code', ['technician', 'partner_supervisor']),
    supabase.from('partner_workers').select('*').eq('organization_id', m.organization_id),
  ]);
  const ids = [...new Set((roles ?? []).map((r) => r.user_id))];
  const names = await staffNames(ids);
  const worker = new Map((workers ?? []).map((w: any) => [w.user_id, w]));
  return (
    <>
      <PageHeader title={t('partner.team_title')} subtitle={t('partner.team_subtitle')} />
      {ids.length === 0 ? (
        <EmptyState title={t('partner.no_team')} body={t('partner.no_team_body')} />
      ) : (
        <div className="flex flex-col gap-4">
          {ids.map((id) => (
            <Card key={id} title={names.get(id) ?? t('common.unnamed_user')}>
              <p className="mb-2 text-sm text-silver-700">{(roles ?? []).filter((r) => r.user_id === id).map((r) => t(`role.${r.role_code}`)).join(', ')}</p>
              <WorkerForm orgId={m.organization_id} userId={id} skills={worker.get(id)?.skills ?? []} trainingNote={worker.get(id)?.training_note ?? ''} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

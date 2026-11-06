import { fromServerError } from '@aiec/domain';
import { Card, EmptyState, PageHeader, StateBadge } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { getT } from '@/lib/i18n';
import { can, getContext } from '@/lib/context';
import { phone } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { CreateOrganizationForm, GrantRoleForm, RevokeRoleForm, StatusForm, type OrgOption } from './admin-forms';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('admin.title') };
}

export default async function AdminUsers() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  if (!can(ctx, 'user.read')) return <PermissionDenied whatKey="admin.what" />;
  const supabase = await supabaseServer();

  const [profiles, userRoles, orgs] = await Promise.all([
    supabase.from('user_profiles').select('id, full_name, phone_e164, email, status, status_reason').order('created_at', { ascending: false }).limit(200),
    supabase.from('user_roles').select('id, user_id, organization_id, role_code, granted_at').is('revoked_at', null),
    supabase.from('organizations').select('id, name, kind').order('kind'),
  ]);
  const err = profiles.error ?? userRoles.error ?? orgs.error;
  if (err) return <ErrorPanel code={fromServerError(err).code} />;

  const orgList = (orgs.data ?? []) as OrgOption[];
  const orgName = new Map(orgList.map((o) => [o.id, o.name]));
  const canAssign = can(ctx, 'role.assign') || can(ctx, 'partner.team.manage');
  const canManage = can(ctx, 'user.manage') || can(ctx, 'partner.team.manage');

  return (
    <>
      <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} />
      {can(ctx, 'org.manage') ? (
        <Card title={t('admin.create_org')} className="mb-4">
          <CreateOrganizationForm />
        </Card>
      ) : null}
      {!profiles.data || profiles.data.length === 0 ? (
        <EmptyState title={t('admin.no_users')} />
      ) : (
        <div className="flex flex-col gap-3">
          {profiles.data.map((p) => {
            const mine = (userRoles.data ?? []).filter((r) => r.user_id === p.id);
            return (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{p.full_name ?? t('common.unnamed_user')}</p>
                    <p className="text-xs text-silver-700">{[phone(p.phone_e164), p.email].filter((x) => x && x !== '—').join(' · ') || t('admin.no_contact')}</p>
                    {p.status_reason ? <p className="text-xs text-silver-700">{t('admin.status_note', { note: p.status_reason })}</p> : null}
                  </div>
                  <StateBadge state={p.status} labelText={t(`enum.user_status.${p.status}`)} />
                </div>
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {mine.length === 0 ? <li className="text-silver-700">{t('admin.no_roles')}</li> : null}
                  {mine.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-silver-100 px-2 py-1">
                      <span>
                        {t(`role.${r.role_code}`)} · {orgName.get(r.organization_id) ?? t('admin.organization')}
                      </span>
                      {canAssign && p.id !== ctx.user_id ? <RevokeRoleForm userRoleId={r.id} label={t(`role.${r.role_code}`)} /> : null}
                    </li>
                  ))}
                </ul>
                {canManage && p.id !== ctx.user_id ? (
                  <div className="mt-3">
                    <StatusForm userId={p.id} current={p.status} />
                  </div>
                ) : null}
                {canAssign ? (
                  <div className="mt-3 border-t border-silver-200 pt-3">
                    <GrantRoleForm userId={p.id} orgs={orgList} />
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

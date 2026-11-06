import { fromServerError, t } from '@aiec/domain';
import { Card, EmptyState, ErrorPanel, PageHeader, PermissionDenied, StateBadge } from '@/components/ui';
import { can, getContext } from '@/lib/context';
import { phone } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { CreateOrganizationForm, GrantRoleForm, RevokeRoleForm, StatusForm, type OrgOption } from './admin-forms';

export const metadata = { title: 'Users & roles' };

export default async function AdminUsers() {
  const result = await getContext();
  if (!result.ok) return <ErrorPanel error={result.error} />;
  const { ctx } = result;
  if (!can(ctx, 'user.read')) return <PermissionDenied what="user administration" />;
  const supabase = await supabaseServer();

  const [profiles, userRoles, orgs] = await Promise.all([
    supabase.from('user_profiles').select('id, full_name, phone_e164, email, status, status_reason').order('created_at', { ascending: false }).limit(200),
    supabase.from('user_roles').select('id, user_id, organization_id, role_code, granted_at').is('revoked_at', null),
    supabase.from('organizations').select('id, name, kind').order('kind'),
  ]);
  const err = profiles.error ?? userRoles.error ?? orgs.error;
  if (err) return <ErrorPanel error={fromServerError(err)} />;

  const orgList = (orgs.data ?? []) as OrgOption[];
  const orgName = new Map(orgList.map((o) => [o.id, o.name]));
  const canAssign = can(ctx, 'role.assign') || can(ctx, 'partner.team.manage');
  const canManage = can(ctx, 'user.manage') || can(ctx, 'partner.team.manage');

  return (
    <>
      <PageHeader title="Users & roles" subtitle="Every change requires a reason and is written to the audit log." />
      {can(ctx, 'org.manage') ? (
        <Card title="Create organization" className="mb-4">
          <CreateOrganizationForm />
        </Card>
      ) : null}
      {!profiles.data || profiles.data.length === 0 ? (
        <EmptyState title="No users visible" />
      ) : (
        <div className="flex flex-col gap-3">
          {profiles.data.map((p) => {
            const mine = (userRoles.data ?? []).filter((r) => r.user_id === p.id);
            return (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{p.full_name ?? 'Unnamed user'}</p>
                    <p className="text-xs text-silver-700">{[phone(p.phone_e164), p.email].filter((x) => x && x !== '—').join(' · ') || 'No contact'}</p>
                    {p.status_reason ? <p className="text-xs text-silver-700">Status note: {p.status_reason}</p> : null}
                  </div>
                  <StateBadge state={p.status} labelText={p.status.replace(/_/g, ' ')} />
                </div>
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {mine.length === 0 ? <li className="text-silver-700">No active roles</li> : null}
                  {mine.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-silver-100 px-2 py-1">
                      <span>
                        {t(`role.${r.role_code}`)} · {orgName.get(r.organization_id) ?? 'organization'}
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

import { fromServerError, hasMessage } from '@aiec/domain';
import { Card, EmptyState, PageHeader, buttonClass, inputClass } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { getT } from '@/lib/i18n';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('audit.title') };
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { t, locale } = await getT();
  // Known actions/entities are translated; anything newer shows its technical name.
  const label = (key: string, raw: string) => (hasMessage(key) ? t(key) : raw);
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  if (!can(result.ctx, 'audit.read')) return <PermissionDenied whatKey="audit.what" />;
  const sp = await searchParams;
  const entity = (sp.entity ?? '').replace(/[^a-z_]/g, '').slice(0, 40);
  const action = (sp.action ?? '').replace(/[^a-z_.]/g, '').slice(0, 60);
  const entityId = /^[0-9a-f-]{36}$/i.test(sp.entity_id ?? '') ? sp.entity_id! : null;

  const supabase = await supabaseServer();
  let q = supabase
    .from('audit_logs')
    .select('id, occurred_at, actor_id, actor_roles, permission_used, entity_type, entity_id, action, old_values, new_values, reason, operation_id')
    .order('id', { ascending: false })
    .limit(200);
  if (entity) q = q.eq('entity_type', entity);
  if (action) q = q.eq('action', action);
  if (entityId) q = q.eq('entity_id', entityId);
  const { data, error } = await q;
  if (error) return <ErrorPanel code={fromServerError(error).code} />;

  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await supabase.from('user_profiles').select('id, full_name').in('id', actorIds) : { data: [] };
  const name = new Map((actors ?? []).map((a) => [a.id, a.full_name ?? t('common.unnamed_user')]));

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('audit.entity_type')}
            <input name="entity" defaultValue={entity} className={inputClass} placeholder={t('audit.entity_placeholder')} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('audit.action')}
            <input name="action" defaultValue={action} className={inputClass} placeholder="lead.assigned" /> {/* i18n-ignore: technical action name */}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('audit.entity_id')}
            <input name="entity_id" defaultValue={entityId ?? ''} className={inputClass} />
          </label>
          <button className={buttonClass}>{t('audit.filter')}</button>
        </form>
      </Card>
      {!data || data.length === 0 ? (
        <EmptyState title={t('audit.empty')} />
      ) : (
        <Card>
          <ol className="text-sm">
            {data.map((r) => (
              <li key={r.id} className="border-t border-silver-200 py-2 first:border-0">
                <p>
                  <span className="font-mono text-xs text-silver-700">#{r.id}</span> <span className="font-semibold">{label(`audit.action.${r.action}`, r.action)}</span>{' '}
                  {t('audit.on', { entity: label(`audit.entity.${r.entity_type}`, r.entity_type) })}
                  {r.entity_id ? <span className="font-mono text-xs"> {r.entity_id}</span> : null}
                </p>
                <p className="text-xs text-silver-700">
                  {dt(r.occurred_at, locale)} · {r.actor_id ? name.get(r.actor_id) ?? r.actor_id : t('audit.system')}
                  {r.actor_roles?.length ? ` ${t('audit.as_roles', { roles: r.actor_roles.map((x: string) => label(`role.${x}`, x)).join(', ') })}` : ''}
                  {r.permission_used ? ` (${t('audit.permission', { permission: label(`permission.${r.permission_used}`, r.permission_used) })})` : ''}
                  {r.operation_id ? ` · ${t('audit.op', { id: r.operation_id.slice(0, 8) })}` : ''}
                </p>
                {r.reason ? <p className="text-xs">{t('audit.reason', { reason: r.reason })}</p> : null}
                {r.old_values || r.new_values ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer">{t('audit.before_after')}</summary>
                    <pre className="mt-1 overflow-auto rounded bg-silver-100 p-2">{JSON.stringify({ before: r.old_values, after: r.new_values }, null, 2)}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}

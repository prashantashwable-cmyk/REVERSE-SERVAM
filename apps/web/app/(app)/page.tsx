import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { can, getContext, roles } from '@/lib/context';
import { getT } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.home') };
}

interface Kpi {
  key: string;
  href: string;
  count: number | null;
}

export default async function Home() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  const { ctx } = result;
  const supabase = await supabaseServer();
  const nowIso = new Date().toISOString();

  // Each count uses exactly the filter of the list it links to, so the drill-down reconciles.
  const count = async (build: (q: any) => any): Promise<number | null> => {
    const { count: c, error } = await build(supabase.from('leads').select('id', { count: 'exact', head: true }));
    return error ? null : (c ?? 0);
  };
  const surveyCount = async (status: string): Promise<number | null> => {
    const { count: c, error } = await supabase.from('surveys').select('id', { count: 'exact', head: true }).eq('status', status);
    return error ? null : (c ?? 0);
  };

  // Every KPI states its basis and definition (§5.2, §57): kpi.<key>.label / kpi.<key>.definition.
  const kpis: Kpi[] = [];
  if (can(ctx, 'lead.read_all')) {
    kpis.push(
      { key: 'unassigned_leads', href: '/leads?status=new', count: await count((q) => q.eq('status', 'new')) },
      { key: 'qualified_leads', href: '/leads?status=qualified', count: await count((q) => q.eq('status', 'qualified')) },
    );
  }
  if (can(ctx, 'lead.read_assigned')) {
    kpis.push(
      { key: 'my_uncontacted', href: '/leads?status=assigned&mine=1', count: await count((q) => q.eq('owner_user_id', ctx.user_id).eq('status', 'assigned')) },
      {
        key: 'my_overdue',
        href: '/leads?due=overdue&mine=1',
        count: await count((q) => q.eq('owner_user_id', ctx.user_id).in('status', ['assigned', 'contacted', 'qualified']).lt('next_action_at', nowIso)),
      },
    );
  }
  if (can(ctx, 'survey.review') || can(ctx, 'survey.read_all')) {
    kpis.push({ key: 'surveys_awaiting_review', href: '/surveys?status=submitted', count: await surveyCount('submitted') });
    kpis.push({ key: 'surveys_returned', href: '/surveys?status=revision_requested', count: await surveyCount('revision_requested') });
  }
  if (can(ctx, 'survey.schedule')) {
    kpis.push({ key: 'reschedule_requests', href: '/surveys?status=reschedule_requested', count: await surveyCount('reschedule_requested') });
  }

  return (
    <>
      <PageHeader
        title={ctx.profile.full_name ? t('home.welcome_name', { name: ctx.profile.full_name }) : t('home.welcome')}
        subtitle={roles(ctx).map((r) => t(`role.${r}`)).join(' · ') || undefined}
      />
      {kpis.length === 0 ? (
        <Card>
          <p className="text-sm text-silver-700">{t('home.nothing')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map((k) => (
            <Link prefetch={false} key={k.key} href={k.href} className="group rounded-lg border border-silver-200 bg-white p-4 shadow-sm hover:border-navy-600">
              <p className="text-sm text-silver-700">{t(`kpi.${k.key}.label`)}</p>
              <p className="mt-1 text-3xl font-semibold text-navy-900">{k.count === null ? '—' : k.count}</p>
              <p className="mt-2 text-xs text-silver-700">
                <span className="font-semibold">{t('kpi.basis_count')}</span> {t(`kpi.${k.key}.definition`)}
              </p>
            </Link>
          ))}
        </div>
      )}
      {can(ctx, 'lead.create') ? (
        <p className="mt-6">
          <Link prefetch={false} href="/leads/new" className="text-sm font-semibold text-navy-700 underline">
            {t('home.create_lead')}
          </Link>
        </p>
      ) : null}
    </>
  );
}

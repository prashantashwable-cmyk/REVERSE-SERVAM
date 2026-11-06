import Link from 'next/link';
import { Card, ErrorPanel, PageHeader } from '@/components/ui';
import { can, getContext, roles } from '@/lib/context';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@aiec/domain';

export const metadata = { title: 'Home' };

interface Kpi {
  label: string;
  /** Every KPI states its basis and definition (§5.2, §57). */
  definition: string;
  href: string;
  count: number | null;
}

export default async function Home() {
  const result = await getContext();
  if (!result.ok) return <ErrorPanel error={result.error} />;
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

  const kpis: Kpi[] = [];
  if (can(ctx, 'lead.read_all')) {
    kpis.push(
      { label: 'Unassigned leads', definition: 'Count of leads in state New (no owner).', href: '/leads?status=new', count: await count((q) => q.eq('status', 'new')) },
      { label: 'Qualified leads', definition: 'Count of leads currently in state Qualified.', href: '/leads?status=qualified', count: await count((q) => q.eq('status', 'qualified')) },
    );
  }
  if (can(ctx, 'lead.read_assigned')) {
    kpis.push(
      { label: 'My uncontacted leads', definition: 'Count of my leads in state Assigned (no two-way contact yet).', href: '/leads?status=assigned&mine=1', count: await count((q) => q.eq('owner_user_id', ctx.user_id).eq('status', 'assigned')) },
      {
        label: 'My overdue follow-ups',
        definition: 'Count of my open leads whose next action time is in the past.',
        href: '/leads?due=overdue&mine=1',
        count: await count((q) => q.eq('owner_user_id', ctx.user_id).in('status', ['assigned', 'contacted', 'qualified']).lt('next_action_at', nowIso)),
      },
    );
  }
  if (can(ctx, 'survey.review') || can(ctx, 'survey.read_all')) {
    kpis.push({ label: 'Surveys awaiting technical review', definition: 'Count of surveys in state Submitted.', href: '/surveys?status=submitted', count: await surveyCount('submitted') });
    kpis.push({ label: 'Surveys returned for revision', definition: 'Count of surveys in state Revision requested.', href: '/surveys?status=revision_requested', count: await surveyCount('revision_requested') });
  }
  if (can(ctx, 'survey.schedule')) {
    kpis.push({ label: 'Reschedule requests', definition: 'Count of visible surveys in state Reschedule requested.', href: '/surveys?status=reschedule_requested', count: await surveyCount('reschedule_requested') });
  }

  return (
    <>
      <PageHeader title={`Welcome${ctx.profile.full_name ? `, ${ctx.profile.full_name}` : ''}`} subtitle={roles(ctx).map((r) => t(`role.${r}`)).join(' · ') || undefined} />
      {kpis.length === 0 ? (
        <Card>
          <p className="text-sm text-silver-700">
            Nothing needs your attention in this workspace yet. Field roles (surveyors, technicians) work in the AIEC mobile app; partner and customer portals arrive in later releases.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="group rounded-lg border border-silver-200 bg-white p-4 shadow-sm hover:border-navy-600">
              <p className="text-sm text-silver-700">{k.label}</p>
              <p className="mt-1 text-3xl font-semibold text-navy-900">{k.count === null ? '—' : k.count}</p>
              <p className="mt-2 text-xs text-silver-700">
                <span className="font-semibold">Basis: count.</span> {k.definition}
              </p>
            </Link>
          ))}
        </div>
      )}
      {can(ctx, 'lead.create') ? (
        <p className="mt-6">
          <Link href="/leads/new" className="text-sm font-semibold text-navy-700 underline">
            + Create a lead
          </Link>
        </p>
      ) : null}
    </>
  );
}

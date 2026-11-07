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
  const tableCount = async (table: string, build: (q: any) => any): Promise<number | null> => {
    const { count: c, error } = await build(supabase.from(table).select('id', { count: 'exact', head: true }));
    return error ? null : (c ?? 0);
  };
  if (can(ctx, 'technical.review')) {
    kpis.push({ key: 'reviews_open', href: '/technical', count: await tableCount('technical_reviews', (q) => q.in('status', ['in_review', 'clarification_requested', 'insufficient_information'])) });
  }
  if (can(ctx, 'quotation.discount.approve') || can(ctx, 'procurement.po.approve') || can(ctx, 'approval.exception.decide')) {
    kpis.push({ key: 'approvals_pending', href: '/approvals', count: await tableCount('approval_requests', (q) => q.eq('status', 'pending')) });
  }
  if (can(ctx, 'quotation.create')) {
    kpis.push({ key: 'quotations_issued', href: '/quotations?status=issued', count: await tableCount('quotation_revisions', (q) => q.eq('status', 'issued')) });
  }
  if (can(ctx, 'project.plan')) {
    kpis.push({ key: 'projects_awaiting_planning', href: '/projects?status=created', count: await tableCount('projects', (q) => q.eq('status', 'created')) });
  }
  if (can(ctx, 'finance.payment.verify')) {
    kpis.push({ key: 'claims_to_verify', href: '/finance', count: await tableCount('payment_claims', (q) => q.in('status', ['claimed', 'pending_clarification'])) });
  }
  if (can(ctx, 'procurement.po.create')) {
    kpis.push({ key: 'open_purchase_requests', href: '/procurement', count: await tableCount('purchase_requests', (q) => q.in('status', ['open', 'supplier_selected'])) });
  }
  if (can(ctx, 'procurement.grn.record')) {
    kpis.push({ key: 'pos_awaiting_receipt', href: '/procurement', count: await tableCount('purchase_orders', (q) => q.eq('status', 'issued')) });
  }
  if (can(ctx, 'partner.verify')) {
    kpis.push({ key: 'partner_documents_pending', href: '/partners', count: await tableCount('partner_documents', (q) => q.eq('verification', 'pending')) });
  }
  if (can(ctx, 'project.plan')) {
    kpis.push({ key: 'safety_stops_open', href: '/projects?status=installation', count: await tableCount('execution_incidents', (q) => q.eq('status', 'open').eq('safety_stop', true)) });
  }
  if (can(ctx, 'partner.org.manage')) {
    kpis.push({ key: 'partner_invitations', href: '/partner', count: await tableCount('project_partner_assignments', (q) => q.in('status', ['invited', 'clarification_requested'])) });
  }
  if (can(ctx, 'partner.task.assign')) {
    kpis.push({ key: 'tasks_to_assign', href: '/partner', count: await tableCount('project_tasks', (q) => q.eq('status', 'draft')) });
  }
  if (can(ctx, 'task.execute')) {
    kpis.push({ key: 'my_open_tasks', href: '/work', count: await tableCount('project_tasks', (q) => q.eq('assignee_user_id', ctx.user_id).in('status', ['assigned', 'accepted', 'in_progress', 'blocked', 'rework'])) });
  }
  if (can(ctx, 'qa.inspection.decide')) {
    kpis.push({ key: 'qa_to_inspect', href: '/qa', count: await tableCount('project_tasks', (q) => q.eq('status', 'submitted')) });
    kpis.push({ key: 'final_qa_requests', href: '/qa', count: await tableCount('projects', (q) => q.eq('status', 'final_qa')) });
  }
  if (can(ctx, 'project.plan')) {
    kpis.push({ key: 'open_defects', href: '/projects?status=installation', count: await tableCount('defects', (q) => q.not('status', 'in', '(verified,closed)')) });
  }
  if (can(ctx, 'approval.exception.decide')) {
    kpis.push({ key: 'statutory_to_verify', href: '/projects?status=statutory_pending', count: await tableCount('statutory_evidence', (q) => q.eq('verification', 'pending')) });
  }
  if (can(ctx, 'customer.project.read')) {
    kpis.push({ key: 'handover_to_accept', href: '/customer', count: await tableCount('handovers', (q) => q.eq('status', 'ready')) });
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

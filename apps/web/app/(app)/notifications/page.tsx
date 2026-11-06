import Link from 'next/link';
import { fromServerError } from '@aiec/domain';
import { Badge, Card, EmptyState, ErrorPanel, PageHeader } from '@/components/ui';
import { dt } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { MarkReadButton } from './mark-read';

export const metadata = { title: 'Notifications' };

const LINK: Record<string, (id: string) => string> = {
  lead: (id) => `/leads/${id}`,
  survey: (id) => `/surveys/${id}`,
};

const TITLES: Record<string, string> = {
  'lead.assigned': 'Lead assigned to you',
  'lead.unassigned': 'New unassigned lead',
  'lead.ownership_transfer_requested': 'Lead ownership transfer requested',
  'lead.merge_requested': 'Lead merge review requested',
  'survey.scheduled': 'Survey scheduled',
  'survey.cancelled': 'Survey cancelled',
  'survey.submitted': 'Survey submitted for technical review',
  'survey.revision_requested': 'Survey returned for revision',
  'survey.reschedule_requested': 'Surveyor requested a reschedule',
  'survey.revisit_requested': 'Surveyor requested a revisit',
  'survey.site_inaccessible': 'Site reported inaccessible',
  'survey.gps_exception': 'Check-in GPS exception to review',
};

export default async function NotificationsPage() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, event_type, entity_type, entity_id, payload, severity, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return <ErrorPanel error={fromServerError(error)} />;
  return (
    <>
      <PageHeader title="Notifications" />
      {!data || data.length === 0 ? (
        <EmptyState title="You are all caught up" />
      ) : (
        <Card>
          <ul className="text-sm">
            {data.map((n) => {
              const href = n.entity_type && n.entity_id && LINK[n.entity_type] ? LINK[n.entity_type]!(n.entity_id) : null;
              const ref = (n.payload as Record<string, string>)?.lead_number ?? (n.payload as Record<string, string>)?.survey_number;
              return (
                <li key={n.id} className={`flex flex-wrap items-center justify-between gap-2 border-t border-silver-200 py-2 first:border-0 ${n.read_at ? 'text-silver-700' : ''}`}>
                  <span>
                    {n.severity !== 'info' ? <Badge tone={n.severity === 'critical' ? 'crit' : 'warn'}>{n.severity}</Badge> : null}{' '}
                    {!n.read_at ? <span className="sr-only">Unread: </span> : null}
                    <span className={n.read_at ? '' : 'font-semibold'}>{TITLES[n.event_type] ?? n.event_type}</span>
                    {ref ? ` · ${ref}` : ''} · {dt(n.created_at)}
                    {href ? (
                      <>
                        {' · '}
                        <Link prefetch={false} href={href} className="underline">Open</Link>
                      </>
                    ) : null}
                  </span>
                  {!n.read_at ? <MarkReadButton id={n.id} /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

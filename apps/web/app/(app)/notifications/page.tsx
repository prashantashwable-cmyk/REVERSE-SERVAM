import Link from 'next/link';
import { fromServerError, hasMessage } from '@aiec/domain';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { getT } from '@/lib/i18n';
import { dt } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { MarkReadButton } from './mark-read';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('notifications.title') };
}

const LINK: Record<string, (id: string) => string> = {
  lead: (id) => `/leads/${id}`,
  survey: (id) => `/surveys/${id}`,
  quotation: (id) => `/quotations/${id}`,
  approval_request: () => '/approvals',
  technical_document: () => '/technical',
  project: (id) => `/projects/${id}`,
  payment_claim: () => '/finance',
};


export default async function NotificationsPage() {
  const { t, locale } = await getT();
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, event_type, entity_type, entity_id, payload, severity, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return <ErrorPanel code={fromServerError(error).code} />;
  return (
    <>
      <PageHeader title={t('notifications.title')} />
      {!data || data.length === 0 ? (
        <EmptyState title={t('notifications.empty')} />
      ) : (
        <Card>
          <ul className="text-sm">
            {data.map((n) => {
              const href = n.event_type === 'approval.decided' && (n.payload as { kind?: string } | null)?.kind === 'purchase_order'
                ? '/procurement'
                : n.entity_type && n.entity_id && LINK[n.entity_type] ? LINK[n.entity_type]!(n.entity_id) : null;
              const ref = (n.payload as Record<string, string>)?.lead_number ?? (n.payload as Record<string, string>)?.survey_number ?? (n.payload as Record<string, string>)?.quotation_number ?? (n.payload as Record<string, string>)?.document_number ?? (n.payload as Record<string, string>)?.project_number ?? (n.payload as Record<string, string>)?.claim_number ?? (n.payload as Record<string, string>)?.po_number;
              return (
                <li key={n.id} className={`flex flex-wrap items-center justify-between gap-2 border-t border-silver-200 py-2 first:border-0 ${n.read_at ? 'text-silver-700' : ''}`}>
                  <span>
                    {n.severity !== 'info' ? <Badge tone={n.severity === 'critical' ? 'crit' : 'warn'}>{t(`enum.severity.${n.severity}`)}</Badge> : null}{' '}
                    {!n.read_at ? <span className="sr-only">{t('notifications.unread')}</span> : null}
                    <span className={n.read_at ? '' : 'font-semibold'}>{hasMessage(`notify.${n.event_type}`) ? t(`notify.${n.event_type}`) : t('notify.other')}</span>
                    {ref ? ` · ${ref}` : ''} · {dt(n.created_at, locale)}
                    {href ? (
                      <>
                        {' · '}
                        <Link prefetch={false} href={href} className="underline">{t('common.open')}</Link>
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

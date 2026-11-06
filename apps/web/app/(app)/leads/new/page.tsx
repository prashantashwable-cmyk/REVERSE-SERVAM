import { randomUUID } from 'node:crypto';
import { PageHeader } from '@/components/ui';
import { ErrorPanel, PermissionDenied } from '@/components/ui-client';
import { getT } from '@/lib/i18n';
import { can, getContext } from '@/lib/context';
import { NewLeadForm } from './new-lead-form';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('leads.new') };
}

export default async function NewLeadPage() {
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
  if (!can(result.ctx, 'lead.create')) return <PermissionDenied whatKey="leads.creation" />;
  // One operation id per form instance: double-submits and retries are idempotent on the server.
  return (
    <>
      <PageHeader title={t('leads.new')} subtitle={t('leads.new_subtitle')} />
      <NewLeadForm operationId={randomUUID()} />
    </>
  );
}

import { randomUUID } from 'node:crypto';
import { ErrorPanel, PageHeader, PermissionDenied } from '@/components/ui';
import { can, getContext } from '@/lib/context';
import { NewLeadForm } from './new-lead-form';

export const metadata = { title: 'New lead' };

export default async function NewLeadPage() {
  const result = await getContext();
  if (!result.ok) return <ErrorPanel error={result.error} />;
  if (!can(result.ctx, 'lead.create')) return <PermissionDenied what="lead creation" />;
  // One operation id per form instance: double-submits and retries are idempotent on the server.
  return (
    <>
      <PageHeader title="New lead" subtitle="Capture what is known. Unknown technical details can stay “to be confirmed”." />
      <NewLeadForm operationId={randomUUID()} />
    </>
  );
}

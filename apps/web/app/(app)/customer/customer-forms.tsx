'use client';

import { useActionState } from 'react';
import { FormStatus, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import { customerDecisionAction } from './actions';

/** CU07 sign-off: who accepts, and accept or raise issues (issues need a description). */
export function CustomerDecisionForm({ projectId }: { projectId: string }) {
  const [state, run] = useActionState(customerDecisionAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={run} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="project_id" value={projectId} />
      <Field label={f('acceptor_name')} htmlFor="acceptor_name" required hint={t('customer.acceptor_hint')}><input id="acceptor_name" name="acceptor_name" className={inputClass} /></Field>
      <Field label={f('comment')} htmlFor="customer_comment" hint={t('customer.comment_hint')}><textarea id="customer_comment" name="comment" rows={2} className={inputClass} /></Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="accept" className={buttonClass}>{t('customer.accept_handover')}</button>
        <button type="submit" name="decision" value="raise_issue" className={secondaryButtonClass}>{t('customer.raise_issue')}</button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

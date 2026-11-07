'use client';

import { useActionState } from 'react';
import { useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { IDLE } from '@/lib/actions';
import { markReadAction } from './actions';

export function MarkReadButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(markReadAction, IDLE);
  useRefreshOnSuccess(state);
  const { t } = useT();
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="text-xs underline" disabled={pending} aria-busy={pending}>
        {pending ? t('notifications.marking') : t('notifications.mark_read')}
      </button>
      {state.status === 'error' ? <span role="alert" className="ml-2 text-xs text-crit-700">{t(`error.${state.code}.title`)}</span> : null}
    </form>
  );
}

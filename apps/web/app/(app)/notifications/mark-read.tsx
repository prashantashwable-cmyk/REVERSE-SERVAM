'use client';

import { useActionState } from 'react';
import { useRefreshOnSuccess } from '@/components/forms';
import { IDLE } from '@/lib/actions';
import { markReadAction } from './actions';

export function MarkReadButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(markReadAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="text-xs underline" disabled={pending} aria-busy={pending}>
        {pending ? 'Marking…' : 'Mark read'}
      </button>
      {state.status === 'error' ? <span role="alert" className="ml-2 text-xs text-crit-700">{state.title}</span> : null}
    </form>
  );
}

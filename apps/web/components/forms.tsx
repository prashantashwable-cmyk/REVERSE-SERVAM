'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/actions';
import { useT } from './locale';
import { buttonClass } from './ui';

/**
 * Refresh server-rendered data after a successful action. Done on the client,
 * outside the action transition: calling revalidatePath() inside the action was
 * observed (Next 15.5, E2E) to leave the form stuck in its pending state.
 */
export function useRefreshOnSuccess(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state, router]);
}

/** Disabled while submitting: prevents duplicate submissions (§34 loading state). */
export function SubmitButton({ children, className = buttonClass }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  const { t } = useT();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? t('common.working') : children}
    </button>
  );
}

export function FormStatus({ state }: { state: ActionState }) {
  const { t, field } = useT();
  if (state.status === 'idle') return null;
  if (state.status === 'success') {
    return (
      <p role="status" className="rounded-md bg-ok-50 px-3 py-2 text-sm text-ok-700">
        {t(state.messageKey)}
      </p>
    );
  }
  const list = [...new Set([...state.fields, ...state.missing])];
  return (
    <div role="alert" className="rounded-md border border-crit-700/30 bg-crit-50 px-3 py-2 text-sm text-crit-700">
      <p className="font-semibold">{t(`error.${state.code}.title`)}</p>
      <p>{t(`error.${state.code}.next`)}</p>
      {list.length > 0 ? (
        <ul className="mt-1 list-inside list-disc">
          {list.map((f) => (
            <li key={f}>{field(f)}</li>
          ))}
        </ul>
      ) : null}
      {state.code === 'INVALID_STATE_TRANSITION' && Array.isArray(state.details.allowedActions) ? (
        <p className="mt-1">
          {t('common.allowed_now', {
            actions: (state.details.allowedActions as string[]).map((a) => field(a)).join(', ') || t('common.none'),
          })}
        </p>
      ) : null}
    </div>
  );
}

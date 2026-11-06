'use client';

import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/actions';
import { buttonClass } from './ui';

/** Disabled while submitting: prevents duplicate submissions (§34 loading state). */
export function SubmitButton({ children, className = buttonClass }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? 'Working…' : children}
    </button>
  );
}

export function FormStatus({ state }: { state: ActionState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'success') {
    return (
      <p role="status" className="rounded-md bg-ok-50 px-3 py-2 text-sm text-ok-700">
        {state.message}
      </p>
    );
  }
  const list = [...state.fields, ...state.missing];
  return (
    <div role="alert" className="rounded-md border border-crit-700/30 bg-crit-50 px-3 py-2 text-sm text-crit-700">
      <p className="font-semibold">{state.title}</p>
      <p>{state.nextAction}</p>
      {list.length > 0 ? (
        <ul className="mt-1 list-inside list-disc">
          {list.map((f) => (
            <li key={f}>{f.replace(/_/g, ' ')}</li>
          ))}
        </ul>
      ) : null}
      {state.code === 'INVALID_STATE_TRANSITION' && Array.isArray(state.details.allowedActions) ? (
        <p className="mt-1">
          Allowed now: {(state.details.allowedActions as string[]).map((a) => a.replace(/_/g, ' ')).join(', ') || 'none'}
        </p>
      ) : null}
    </div>
  );
}

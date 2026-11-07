'use client';

import { useActionState, useEffect, type ReactNode } from 'react';
import type { ActionState } from '@/lib/actions';
import { IDLE } from '@/lib/actions';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from './forms';
import { secondaryButtonClass } from './ui';

/**
 * A server-action form with status, refresh-on-success and an optional full
 * navigation to a returned record (the reliable pattern after creating records).
 */
export function ActionForm({ action, hidden = {}, children, submitLabel, secondary, navigate, className = 'flex flex-col gap-3', formKey }: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  hidden?: Record<string, string | number | null | undefined>;
  children?: ReactNode;
  submitLabel: string;
  secondary?: boolean;
  /** Build a URL from the action's returned data to navigate to after success. */
  navigate?: { key: string; prefix: string };
  className?: string;
  formKey?: string;
}) {
  const [state, run] = useActionState(action, IDLE);
  useRefreshOnSuccess(state);
  useEffect(() => {
    if (navigate && state.status === 'success' && state.data?.[navigate.key]) window.location.assign(`${navigate.prefix}${String(state.data[navigate.key])}`);
  }, [state, navigate]);
  return (
    <form key={formKey} action={run} className={className} noValidate>
      {Object.entries(hidden).map(([k, v]) => (v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
      {children}
      <div className="flex flex-col gap-2 md:col-span-full">
        <FormStatus state={state} />
        <div><SubmitButton className={secondary ? secondaryButtonClass : undefined}>{submitLabel}</SubmitButton></div>
      </div>
    </form>
  );
}

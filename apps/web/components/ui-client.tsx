'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ErrorCode } from '@aiec/domain';
import { useT } from './locale';

/** Explained error (title + next action) in the user's language. Pass the code, not a message. */
export function ErrorPanel({ code }: { code: ErrorCode }) {
  const { t } = useT();
  return (
    <div role="alert" className="rounded-lg border border-crit-700/30 bg-crit-50 p-4 text-crit-700">
      <p className="font-semibold">{t(`error.${code}.title`)}</p>
      <p className="mt-1 text-sm">{t(`error.${code}.next`)}</p>
    </div>
  );
}

/** `whatKey` is a translation key naming the area, e.g. "nav.leads". */
export function PermissionDenied({ whatKey }: { whatKey: string }) {
  const { t } = useT();
  return (
    <div role="alert" className="rounded-lg border border-warn-700/30 bg-warn-50 p-6 text-warn-700">
      <p className="font-semibold">{t('common.no_access', { what: t(whatKey) })}</p>
      <p className="mt-1 text-sm">{t('common.no_access_next')}</p>
      <Link prefetch={false} href="/" className="mt-3 inline-block text-sm font-medium underline">
        {t('common.back_home')}
      </Link>
    </div>
  );
}

export function Field({ label, htmlFor, required, hint, children }: { label: string; htmlFor: string; required?: boolean; hint?: string; children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-navy-800">
        {label}
        {required ? (
          <span className="text-crit-700" aria-hidden="true">
            {' '}*
          </span>
        ) : null}
        {required ? <span className="sr-only"> ({t('common.required')})</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-silver-700">{hint}</p> : null}
    </div>
  );
}

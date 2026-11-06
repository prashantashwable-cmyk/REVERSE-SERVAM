'use client';

import { useT } from '@/components/locale';

/** Route error boundary: never shows stack traces or server internals to users. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  return (
    <div role="alert" className="rounded-lg border border-crit-700/30 bg-crit-50 p-6 text-crit-700">
      <p className="font-semibold">{t('page_error.title')}</p>
      <p className="mt-1 text-sm">{t('page_error.body')}</p>
      <button type="button" onClick={reset} className="mt-3 text-sm font-semibold underline">
        {t('page_error.retry')}
      </button>
    </div>
  );
}

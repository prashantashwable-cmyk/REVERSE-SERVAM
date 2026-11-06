'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { LOCALE_OPTIONS, fieldLabel, formatDateTimeIST, translator, type Locale, type Translate } from '@aiec/domain';
import { setLocaleAction } from '@/app/locale-actions';

interface LocaleValue {
  locale: Locale;
  t: Translate;
  field: (key: string) => string;
  dt: (iso: string | null | undefined) => string;
}

const LocaleContext = createContext<LocaleValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<LocaleValue>(
    () => ({
      locale,
      t: translator(locale),
      field: (key) => fieldLabel(key, locale),
      dt: (iso) => (iso ? formatDateTimeIST(iso, locale) : '—'),
    }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): LocaleValue {
  const v = useContext(LocaleContext);
  if (!v) throw new Error('useT() used outside <LocaleProvider>');
  return v;
}

/**
 * मराठी / English switch. Saves the choice in a cookie (works before sign-in)
 * and, when signed in, in the user's profile; then reloads the page so every
 * server-rendered label switches together.
 */
export function LanguageSwitch({ signedIn, tone = 'dark' }: { signedIn: boolean; tone?: 'dark' | 'light' }) {
  const { locale, t } = useT();
  const [busy, setBusy] = useState(false);
  const choose = async (code: Locale) => {
    if (code === locale || busy) return;
    setBusy(true);
    document.cookie = `aiec_locale=${code}; path=/; max-age=31536000; samesite=lax`;
    if (signedIn) {
      try {
        await setLocaleAction(code);
      } catch {
        // The cookie alone still switches the language on this device.
      }
    }
    window.location.reload();
  };
  const base = tone === 'dark' ? 'border-navy-600 text-silver-200' : 'border-silver-300 text-navy-800';
  return (
    <div role="group" aria-label={t('common.language')} className="flex gap-1">
      {LOCALE_OPTIONS.map((o) => (
        <button
          key={o.code}
          type="button"
          lang={o.code}
          onClick={() => void choose(o.code)}
          aria-pressed={locale === o.code}
          disabled={busy}
          className={`min-h-9 rounded-md border px-3 text-sm font-semibold ${locale === o.code ? 'border-gold-500 bg-gold-500 text-navy-900' : base}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALE_OPTIONS, fieldLabel, formatDateTimeIST, isLocale, translator, type Locale, type Translate } from '@aiec/domain';

const STORAGE_KEY = 'aiec-demo-locale';

/** Language chosen on this device (default Marathi). Storage may be unavailable: then the default is used. */
export function initialLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && isLocale(v)) return v;
  } catch {
    /* private mode etc. */
  }
  return DEFAULT_LOCALE;
}

interface LocaleValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translate;
  field: (key: string) => string;
  dt: (iso: string | null | undefined) => string;
}

const LocaleContext = createContext<LocaleValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = locale === 'mr' ? 'mr-IN' : 'en-IN';
  }, [locale]);
  const value = useMemo<LocaleValue>(
    () => ({
      locale,
      setLocale,
      t: translator(locale),
      field: (key) => fieldLabel(key, locale),
      dt: (iso) => (iso ? formatDateTimeIST(iso, locale) : '—'),
    }),
    [locale],
  );
  useEffect(() => {
    document.title = `AIEC — ${value.t('app.description')}`;
  }, [value]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): LocaleValue {
  const v = useContext(LocaleContext);
  if (!v) throw new Error('useT() used outside <LocaleProvider>');
  return v;
}

export function LanguageSwitch() {
  const { locale, setLocale, t } = useT();
  return (
    <div className="lang" role="group" aria-label={t('common.language')}>
      {LOCALE_OPTIONS.map((o) => (
        <button key={o.code} type="button" className={o.code === locale ? 'lang-btn on' : 'lang-btn'} aria-pressed={o.code === locale} onClick={() => setLocale(o.code)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Render a translated sentence that marks emphasis with <b>…</b> (no HTML injection: only <b> is recognised). */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/<\/?b>/);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</>;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DEFAULT_LOCALE, LOCALE_OPTIONS, fieldLabel, formatDateTimeIST, isLocale, translator, type Locale, type Translate } from '@aiec/domain';
import { kvGet, kvSet } from './db';

/** Device-level language choice (kept across sign-out; it is not user work data). */
export const LOCALE_KV_KEY = 'locale';

interface LocaleValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translate;
  field: (key: string) => string;
  dt: (iso: string | null | undefined) => string;
}

const LocaleContext = createContext<LocaleValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    kvGet<string>(LOCALE_KV_KEY)
      .then((v) => {
        if (v && isLocale(v)) setLocaleState(v);
      })
      .catch(() => undefined);
  }, []);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    void kvSet(LOCALE_KV_KEY, l).catch(() => undefined);
  }, []);
  const value = useMemo<LocaleValue>(
    () => ({
      locale,
      setLocale,
      t: translator(locale),
      field: (key) => fieldLabel(key, locale),
      dt: (iso) => (iso ? formatDateTimeIST(iso, locale) : '—'),
    }),
    [locale, setLocale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): LocaleValue {
  const v = useContext(LocaleContext);
  if (!v) throw new Error('useT() used outside <LocaleProvider>');
  return v;
}

/** मराठी / English switch (large touch targets, state announced to screen readers). */
export function LanguageSwitch() {
  const { locale, setLocale, t } = useT();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('common.language')} style={{ flexDirection: 'row', gap: 8, alignSelf: 'flex-end' }}>
      {LOCALE_OPTIONS.map((o) => {
        const selected = o.code === locale;
        return (
          <Pressable
            key={o.code}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => setLocale(o.code)}
            style={{ minHeight: 44, minWidth: 72, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#0f223d', alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? '#0f223d' : '#ffffff' }}
          >
            <Text style={{ color: selected ? '#ffffff' : '#0f223d', fontWeight: '700' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

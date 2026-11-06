import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { DEFAULT_LOCALE, isLocale, translator, type Locale, type Translate } from '@aiec/domain';
import { getContext } from './context';

export const LOCALE_COOKIE = 'aiec_locale';

/**
 * Language for this request: the explicit choice in the `aiec_locale` cookie
 * (set by the language switch, also used before sign-in), otherwise the
 * signed-in user's saved preference, otherwise Marathi.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const hasSession = jar.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));
  if (hasSession) {
    const ctx = await getContext();
    if (ctx.ok && isLocale(ctx.ctx.profile.preferred_locale)) return ctx.ctx.profile.preferred_locale;
  }
  return DEFAULT_LOCALE;
});

export async function getT(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getLocale();
  return { locale, t: translator(locale) };
}

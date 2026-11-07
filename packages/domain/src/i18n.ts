import type { ErrorCode } from './errors';
import { en, type MessageKey } from './messages/en';
import { mr } from './messages/mr';

/**
 * Interface text is looked up by key (spec §58). Marathi is the default
 * language; English is available everywhere through a language switch.
 * `messages/mr.ts` is typed `Record<MessageKey, string>`, so a missing Marathi
 * translation fails the TypeScript build. Lookup falls back mr → en → key, so
 * a screen never crashes on a label. Numbers always use 0–9 digits.
 */
export type Locale = 'en' | 'mr' | 'hi';
export type { MessageKey };

export const DEFAULT_LOCALE: Locale = 'mr';

/** Languages offered in the switch, labelled in their own script. */
export const LOCALE_OPTIONS: readonly { code: Locale; label: string }[] = [
  { code: 'mr', label: 'मराठी' },
  { code: 'en', label: 'English' },
];

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'mr' || value === 'hi';
}

const DICTIONARIES: Record<Locale, Partial<Record<string, string>>> = { en, mr, hi: {} };

/** Translate `key`; `{name}` placeholders are replaced from `params`. */
export function t(key: string, locale: Locale = DEFAULT_LOCALE, params?: Record<string, string | number>): string {
  const raw = DICTIONARIES[locale][key] ?? (en as Record<string, string>)[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function hasMessage(key: string): boolean {
  return key in en;
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  return (key, params) => t(key, locale, params);
}

export function errorMessage(code: ErrorCode, locale: Locale = DEFAULT_LOCALE): { title: string; nextAction: string } {
  return { title: t(`error.${code}.title`, locale), nextAction: t(`error.${code}.next`, locale) };
}

/**
 * Human label for a technical field / evidence / action key returned by the
 * server (e.g. "site.city", "measurement.pit_depth", "doc_shaft_layout").
 */
export function fieldLabel(key: string, locale: Locale = DEFAULT_LOCALE): string {
  // Row-level errors from list editors, e.g. "lines.2.rate_paise" → "Line 2: Rate".
  const row = /^lines\.(\d+)(?:\.([a-z_]+))?$/.exec(key);
  if (row) return row[2] ? `${t('field.line_ref', locale, { no: row[1]! })}: ${fieldLabel(row[2], locale)}` : t('field.line_ref', locale, { no: row[1]! });
  const candidates = [
    `field.${key}`,
    key.startsWith('measurement.') ? `measure.${key.slice('measurement.'.length)}` : '',
    `enum.evidence.${key}`,
    `action.${key}`,
  ].filter(Boolean);
  for (const c of candidates) if (hasMessage(c)) return t(c, locale);
  return key.replace(/^measurement\./, '').replace(/[._]/g, ' ');
}

function intlLocale(locale: Locale): string {
  // Marathi words and month names with standard 0–9 digits (product decision).
  return locale === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN';
}

/** Local date/time display for India while storage stays timezone-aware (§58). */
export function formatDateTimeIST(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const date = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' } as const;
  // Marathi names the part of the day ("सकाळ 10:30", "संध्याकाळ 6:30") instead of AM/PM.
  const time = locale === 'mr' ? ({ hour: 'numeric', minute: '2-digit', dayPeriod: 'short' } as const) : ({ hour: '2-digit', minute: '2-digit', hour12: true } as const);
  return new Intl.DateTimeFormat(intlLocale(locale), { ...date, ...time }).format(new Date(iso));
}

export function formatDateIST(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

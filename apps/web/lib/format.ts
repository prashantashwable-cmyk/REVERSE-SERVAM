import { formatDateTimeIST, formatPhone, type Locale } from '@aiec/domain';

export function dt(iso: string | null | undefined, locale: Locale): string {
  return iso ? formatDateTimeIST(iso, locale) : '—';
}

export function phone(e164: string | null | undefined): string {
  return e164 ? formatPhone(e164) : '—';
}

/** Current IST wall-clock as a datetime-local value (for input defaults / min). */
export function istNowLocal(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000 + 330 * 60_000);
  return d.toISOString().slice(0, 16);
}

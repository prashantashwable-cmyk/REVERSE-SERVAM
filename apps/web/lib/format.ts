import { formatDateTimeIST, formatPhone, t } from '@aiec/domain';

export function dt(iso: string | null | undefined): string {
  return iso ? formatDateTimeIST(iso) : '—';
}

export function phone(e164: string | null | undefined): string {
  return e164 ? formatPhone(e164) : '—';
}

export function label(key: string): string {
  return t(key);
}

/** Current IST wall-clock as a datetime-local value (for input defaults / min). */
export function istNowLocal(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000 + 330 * 60_000);
  return d.toISOString().slice(0, 16);
}

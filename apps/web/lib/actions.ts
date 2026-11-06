import { errorMessage, fromServerError, type ErrorCode, type ServerErrorLike } from '@aiec/domain';

/** Uniform result shape for every server action (rendered by <FormError />). */
export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string; data?: Record<string, unknown> }
  | {
      status: 'error';
      code: ErrorCode;
      title: string;
      nextAction: string;
      fields: string[];
      missing: string[];
      details: Record<string, unknown>;
    };

export const IDLE: ActionState = { status: 'idle' };

/** Map a PostgREST / RPC error to a user-safe action state (no SQL, no stack traces). */
export function errorState(err: ServerErrorLike | null | undefined): ActionState {
  const d = fromServerError(err);
  const m = errorMessage(d.code);
  return {
    status: 'error',
    code: d.code,
    title: m.title,
    nextAction: m.nextAction,
    fields: Array.isArray(d.details.fields) ? (d.details.fields as string[]) : [],
    missing: Array.isArray(d.details.missing) ? (d.details.missing as string[]) : [],
    details: d.details,
  };
}

export function localError(code: ErrorCode, fields: string[] = []): ActionState {
  const m = errorMessage(code);
  return { status: 'error', code, title: m.title, nextAction: m.nextAction, fields, missing: [], details: {} };
}

/** FormData helpers: trimmed string or null. */
export function str(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export function int(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === null) return null;
  return /^-?\d+$/.test(v) ? Number(v) : Number.NaN;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v && UUID_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * <input type="datetime-local"> has no zone. AIEC operates in India, so the
 * value is interpreted as IST and sent to the server with an explicit offset.
 */
export function istLocalToIso(local: string | null): string | null {
  if (!local) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3] ?? '00'}+05:30`;
}

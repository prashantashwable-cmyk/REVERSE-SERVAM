/**
 * Standard error catalogue (spec §55).
 *
 * The same codes are raised by the database RPC layer as the exception
 * MESSAGE (see supabase/migrations), so clients can map any server error to a
 * helpful explanation and next action without ever showing SQL or stack traces.
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'ACCESS_DENIED',
  'TENANT_SCOPE_VIOLATION',
  'PROJECT_NOT_ASSIGNED',
  'INVALID_STATE_TRANSITION',
  'REQUIRED_FIELD_MISSING',
  'VALIDATION_FAILED',
  'EVIDENCE_REQUIRED',
  'APPROVAL_REQUIRED',
  'APPROVAL_EXPIRED',
  'SELF_APPROVAL_FORBIDDEN',
  'PAYMENT_NOT_VERIFIED',
  'PARTNER_COMPLIANCE_BLOCK',
  'SITE_NOT_READY',
  'MATERIAL_NOT_READY',
  'SAFETY_STOP_ACTIVE',
  'REVISION_CONFLICT',
  'DUPLICATE_OPERATION',
  'SCHEDULE_CONFLICT',
  'DUPLICATE_REVIEW_REQUIRED',
  'NOT_FOUND',
  'OFFLINE_SYNC_REQUIRED',
  'FILE_UPLOAD_FAILED',
  'ACCOUNT_NOT_ACTIVE',
  'LAST_OWNER_PROTECTED',
  'UNKNOWN_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export interface ErrorDetails {
  /** Field keys that failed validation, when relevant. */
  fields?: string[];
  /** Current state of the record for INVALID_STATE_TRANSITION. */
  currentState?: string;
  /** Actions that are allowed from the current state. */
  allowedActions?: string[];
  /** Missing evidence categories / documents. */
  missing?: string[];
  [key: string]: unknown;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message?: string, details: ErrorDetails = {}) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

/** User-facing explanation + next action for every code (translation keys resolve in i18n). */
export const ERROR_GUIDANCE: Record<ErrorCode, { titleKey: string; nextActionKey: string }> = Object.fromEntries(
  ERROR_CODES.map((code) => [
    code,
    { titleKey: `error.${code}.title`, nextActionKey: `error.${code}.next` },
  ]),
) as Record<ErrorCode, { titleKey: string; nextActionKey: string }>;

/**
 * Shape of an error returned by PostgREST / supabase-js for a failed RPC.
 * Our database functions raise `message = <ERROR_CODE>` and put a JSON object
 * into `detail`.
 */
export interface ServerErrorLike {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

/**
 * Convert any server error into a DomainError. Unknown messages are NOT echoed
 * back to the user (they could contain SQL / infrastructure detail).
 */
export function fromServerError(err: ServerErrorLike | null | undefined): DomainError {
  if (!err) return new DomainError('UNKNOWN_ERROR');
  const message = (err.message ?? '').trim();
  let details: ErrorDetails = {};
  if (err.details) {
    try {
      const parsed: unknown = JSON.parse(err.details);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) details = parsed as ErrorDetails;
    } catch {
      // Non-JSON detail from the platform: deliberately dropped.
    }
  }
  if (isErrorCode(message)) return new DomainError(message, message, details);
  // PostgREST JWT / auth failures.
  if (err.code === 'PGRST301' || err.code === '401' || /jwt/i.test(message)) {
    return new DomainError('AUTH_REQUIRED');
  }
  // Postgres insufficient_privilege (RLS / grants).
  if (err.code === '42501') return new DomainError('ACCESS_DENIED');
  return new DomainError('UNKNOWN_ERROR');
}

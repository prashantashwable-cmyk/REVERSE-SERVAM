import { ERROR_CODES, type ErrorCode } from './errors';

/**
 * Labels are translation keys (spec §58). English ships first; Marathi / Hindi
 * dictionaries can be added with the same keys. Missing keys fall back to
 * English, then to the key itself (never crash a field screen on a label).
 */
export type Locale = 'en' | 'mr' | 'hi';

const ERROR_EN: Record<ErrorCode, [string, string]> = {
  AUTH_REQUIRED: ['Please sign in again', 'Your session has ended. Sign in to continue; unsynced work is kept on this device.'],
  ACCESS_DENIED: ['You do not have permission for this action', 'Ask your administrator if you need this access.'],
  TENANT_SCOPE_VIOLATION: ['This record belongs to another organization', 'Open records from your own organization only.'],
  PROJECT_NOT_ASSIGNED: ['This project is not assigned to you', 'Contact your supervisor to be assigned.'],
  INVALID_STATE_TRANSITION: ['This action is not available at the current stage', 'Refresh to see the current stage and the actions allowed.'],
  REQUIRED_FIELD_MISSING: ['Some required information is missing', 'Complete the highlighted fields and try again.'],
  VALIDATION_FAILED: ['Some information is not valid', 'Correct the highlighted fields and try again.'],
  EVIDENCE_REQUIRED: ['Required evidence is missing', 'Capture the listed photos / documents, or record why they are unavailable.'],
  APPROVAL_REQUIRED: ['Approval is required first', 'Request approval from the authorized approver.'],
  APPROVAL_EXPIRED: ['The approval or validity has expired', 'Request a new approval or issue a new revision.'],
  SELF_APPROVAL_FORBIDDEN: ['You cannot approve your own request', 'A different authorized person must decide.'],
  PAYMENT_NOT_VERIFIED: ['Payment is not verified yet', 'Finance must verify the payment against bank / gateway records.'],
  PARTNER_COMPLIANCE_BLOCK: ['Partner is not eligible', 'Mandatory partner documents are missing, unverified or expired.'],
  SITE_NOT_READY: ['Site is not ready', 'Complete the site readiness checklist.'],
  MATERIAL_NOT_READY: ['Material is not ready', 'Wait for material receipt and verification.'],
  SAFETY_STOP_ACTIVE: ['Safety stop is active', 'Work cannot continue until the safety issue is resolved. Contact your supervisor.'],
  REVISION_CONFLICT: ['Someone else changed this record', 'Review both versions and choose how to resolve the conflict.'],
  DUPLICATE_OPERATION: ['This action was already received', 'No further action is needed.'],
  SCHEDULE_CONFLICT: ['Time slot not available', 'Choose another time; the person is already booked.'],
  DUPLICATE_REVIEW_REQUIRED: ['Possible duplicate found', 'Review the matching records: open the existing one, or confirm this is a separate opportunity with a reason.'],
  NOT_FOUND: ['Record not found', 'It may have been removed from your access. Refresh your list.'],
  OFFLINE_SYNC_REQUIRED: ['You are offline', 'This will be sent automatically when you are back online.'],
  FILE_UPLOAD_FAILED: ['File upload failed', 'It will retry automatically; keep the app open on a network.'],
  ACCOUNT_NOT_ACTIVE: ['Your account is not active', 'Your account is pending verification or suspended. Contact AIEC support.'],
  LAST_OWNER_PROTECTED: ['At least one active Owner is required', 'Assign another Owner before removing this one.'],
  UNKNOWN_ERROR: ['Something went wrong', 'Try again. If it keeps happening, contact support.'],
};

const EN: Record<string, string> = {
  ...Object.fromEntries(ERROR_CODES.flatMap((c) => [[`error.${c}.title`, ERROR_EN[c][0]], [`error.${c}.next`, ERROR_EN[c][1]]])),
  'sync.saved_on_device': 'Saved on device',
  'sync.waiting': 'Waiting to sync',
  'sync.uploading': 'Uploading',
  'sync.synced': 'Synced',
  'sync.failed': 'Failed — retry available',
  'sync.conflict': 'Conflict — action required',
  'sync.rejected': 'Not accepted — action required',
  'sync.discarded': 'Discarded',
  'lead.state.new': 'New',
  'lead.state.assigned': 'Assigned',
  'lead.state.contacted': 'Contacted',
  'lead.state.qualified': 'Qualified',
  'lead.state.won': 'Won',
  'lead.state.lost': 'Lost',
  'lead.state.invalid': 'Invalid',
  'survey.state.scheduled': 'Scheduled',
  'survey.state.accepted': 'Accepted',
  'survey.state.reschedule_requested': 'Reschedule requested',
  'survey.state.in_progress': 'In progress',
  'survey.state.revisit_requested': 'Revisit requested',
  'survey.state.site_inaccessible': 'Site inaccessible',
  'survey.state.submitted': 'Submitted',
  'survey.state.revision_requested': 'Revision requested',
  'survey.state.under_review': 'Under technical review',
  'survey.state.reviewed': 'Reviewed',
  'survey.state.cancelled': 'Cancelled',
  'role.owner': 'Owner / Super Admin',
  'role.operations_manager': 'Operations Manager',
  'role.sales_executive': 'Sales Executive',
  'role.surveyor': 'Surveyor',
  'role.technical_manager': 'Technical Manager',
  'role.accounts_finance': 'Accounts & Finance',
  'role.procurement_manager': 'Procurement Manager',
  'role.partner_admin': 'Partner Company Admin',
  'role.partner_supervisor': 'Partner Team Leader',
  'role.technician': 'Technician',
  'role.qa_inspector': 'QA Inspector',
  'role.customer': 'Customer / Builder',
  'common.demo_banner': 'DEMO — synthetic data only',
};

const DICTIONARIES: Record<Locale, Record<string, string>> = { en: EN, mr: {}, hi: {} };

export function t(key: string, locale: Locale = 'en'): string {
  return DICTIONARIES[locale][key] ?? EN[key] ?? key;
}

export function errorMessage(code: ErrorCode, locale: Locale = 'en'): { title: string; nextAction: string } {
  return { title: t(`error.${code}.title`, locale), nextAction: t(`error.${code}.next`, locale) };
}

/** Local date/time display for India while storage stays timezone-aware (§58). */
export function formatDateTimeIST(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

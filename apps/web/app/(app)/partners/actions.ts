'use server';

import { parseInr } from '@aiec/domain';
import { errorState, int, localError, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function rpc(fn: string, args: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  return success(messageKey, (data ?? {}) as Record<string, unknown>);
}

/** LP03 verification by AIEC (Owner): verify or reject one compliance document. */
export async function verifyDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const decision = str(form, 'decision');
  return rpc('verify_partner_document', { p_document_id: uuid(form, 'document_id'), p_decision: decision, p_reason: str(form, 'reason') },
    decision === 'verify' ? 'partners.document_verified' : 'partners.document_rejected');
}

/** Partner lifecycle decisions by AIEC (start verification, approve, hold, suspend …). */
export async function partnerDecisionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('partner_action', { p_org_id: uuid(form, 'org_id'), p_expected_version: int(form, 'version'), p_action: str(form, 'action'), p_reason: str(form, 'reason') }, 'partners.status_updated');
}

/** OM03 site readiness: one result (and note) per catalogue item. */
export async function siteReadinessAction(_: ActionState, form: FormData): Promise<ActionState> {
  const items: { key: string; result: string; note: string | null }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('result_') || typeof v !== 'string' || v === '') continue;
    const key = k.slice(7);
    items.push({ key, result: v, note: str(form, `note_${key}`) });
  }
  return rpc('record_site_readiness', { p_project_id: uuid(form, 'project_id'), p_items: items }, 'execution.site_recorded');
}

/** OM04 invitation of an eligible partner with the offer the partner will see and accept. */
export async function invitePartnerAction(_: ActionState, form: FormData): Promise<ActionState> {
  let value: string | null = null;
  try {
    const v = str(form, 'contract_value');
    if (v !== null) value = parseInr(v).toString();
  } catch {
    return localError('VALIDATION_FAILED', ['contract_value_paise']);
  }
  if (value === null) return localError('REQUIRED_FIELD_MISSING', ['contract_value_paise']);
  return rpc('invite_partner', {
    p_project_id: uuid(form, 'project_id'),
    p_partner_org_id: uuid(form, 'partner_org_id'),
    p_payload: {
      scope_summary: str(form, 'scope_summary'), schedule_from: str(form, 'schedule_from'), schedule_to: str(form, 'schedule_to'), contract_value_paise: value,
      payment_terms: str(form, 'payment_terms'), material_responsibility: str(form, 'material_responsibility'), safety_requirements: str(form, 'safety_requirements'),
      exclusions: str(form, 'exclusions'),
    },
  }, 'execution.partner_invited');
}

/** AIEC side of an assignment: re-issue after clarification, withdraw, or end. */
export async function assignmentAdminAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('assignment_action', { p_assignment_id: uuid(form, 'assignment_id'), p_expected_version: int(form, 'version'), p_action: str(form, 'action'), p_reason: str(form, 'reason') }, 'execution.assignment_updated');
}

export async function projectExecutionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const action = str(form, 'action');
  return rpc('project_execution_action', { p_project_id: uuid(form, 'project_id'), p_expected_version: int(form, 'version'), p_action: action }, `execution.${action ?? 'mark_installation_ready'}_done`);
}

export async function resolveIncidentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('resolve_incident', { p_incident_id: uuid(form, 'incident_id'), p_resolution: str(form, 'resolution') }, 'execution.incident_resolved');
}

export async function commentReportAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('comment_daily_report', { p_report_id: uuid(form, 'report_id'), p_comment: str(form, 'comment') }, 'execution.comment_added');
}

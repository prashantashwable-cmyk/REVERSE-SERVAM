'use server';

import { createHash, randomUUID } from 'node:crypto';
import { errorState, int, lines, localError, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function rpc(fn: string, args: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  return success(messageKey, (data ?? {}) as Record<string, unknown>);
}

const list = (form: FormData, key: string) => form.getAll(key).map(String).filter((v) => v.trim() !== '');

/** LP02: company profile (draft only; locked during and after verification). */
export async function saveProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('save_partner_profile', {
    p_org_id: uuid(form, 'org_id'),
    p_expected_version: int(form, 'version'),
    p_payload: {
      legal_name: str(form, 'legal_name'), entity_type: str(form, 'entity_type'), registered_address: str(form, 'registered_address'),
      operating_address: str(form, 'operating_address'), authorized_representative: str(form, 'authorized_representative'),
      contact_phone: str(form, 'contact_phone'), contact_email: str(form, 'contact_email'), gst_number: str(form, 'gst_number'),
      service_areas: lines(form, 'service_areas'), lift_categories: list(form, 'lift_categories'),
      team_size: str(form, 'team_size'), experience_years: str(form, 'experience_years'),
      safety_policy_accepted: form.get('safety_policy_accepted') === 'on', compliance_declaration: form.get('compliance_declaration') === 'on',
    },
  }, 'partner.profile_saved');
}

export async function submitProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('partner_action', { p_org_id: uuid(form, 'org_id'), p_expected_version: int(form, 'version'), p_action: 'submit' }, 'partner.profile_submitted');
}

const DOC_EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** LP03: the server computes the checksum, stores the file privately as the partner admin, then registers it. */
export async function uploadPartnerDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = uuid(form, 'org_id');
  const file = form.get('file');
  if (!orgId) return localError('NOT_FOUND');
  if (!(file instanceof File) || file.size === 0) return localError('REQUIRED_FIELD_MISSING', ['file']);
  const ext = DOC_EXT[file.type];
  if (!ext) return localError('VALIDATION_FAILED', ['mime_type']);
  if (file.size > 15_728_640) return localError('VALIDATION_FAILED', ['size_bytes']);
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const operationId = uuid(form, 'operation_id') ?? randomUUID();
  const path = `${orgId}/documents/${operationId}.${ext}`;
  const supabase = await supabaseServer();
  const up = await supabase.storage.from('partner-documents').upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error && !/exist|duplicate/i.test(up.error.message)) return localError('FILE_UPLOAD_FAILED');
  const { data, error } = await supabase.rpc('register_partner_document', {
    p_operation_id: operationId,
    p_org_id: orgId,
    p_payload: {
      doc_type: str(form, 'doc_type'), doc_number: str(form, 'doc_number'), issuer: str(form, 'issuer'), issued_on: str(form, 'issued_on'),
      expires_on: str(form, 'expires_on'), scope: list(form, 'scope'), storage_path: path, sha256, mime_type: file.type, size_bytes: file.size,
    },
  });
  if (error) return errorState(error);
  return success('partner.document_uploaded', data as Record<string, unknown>);
}

/** LP04: accept exactly the displayed revision (hash), decline or ask for clarification. */
export async function respondInvitationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const action = str(form, 'action');
  return rpc('assignment_action', {
    p_assignment_id: uuid(form, 'assignment_id'), p_expected_version: int(form, 'version'), p_action: action, p_reason: str(form, 'reason'),
    p_offer_sha256: str(form, 'offer_sha256'),
  }, `partner.invitation_${action ?? 'accept'}_done`);
}

export async function setWorkerAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('set_worker_profile', { p_org_id: uuid(form, 'org_id'), p_user_id: uuid(form, 'user_id'), p_skills: list(form, 'skills'), p_training_note: str(form, 'training_note') }, 'partner.worker_saved');
}

export async function teamMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const action = str(form, 'action');
  return rpc('set_project_team_member', { p_assignment_id: uuid(form, 'assignment_id'), p_user_id: uuid(form, 'user_id'), p_action: action, p_reason: str(form, 'reason') },
    action === 'remove' ? 'partner.member_removed' : 'partner.member_added');
}

export async function assignTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('assign_task', { p_task_id: uuid(form, 'task_id'), p_expected_version: int(form, 'version'), p_assignee_id: uuid(form, 'assignee_id'), p_due_date: str(form, 'due_date') }, 'partner.task_assigned');
}

export async function unblockTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('unblock_task', { p_task_id: uuid(form, 'task_id'), p_expected_version: int(form, 'version'), p_reason: str(form, 'reason') }, 'partner.task_unblocked');
}

/** LP08: daily work report (present people are the ticked project-team members). */
export async function dailyReportAction(_: ActionState, form: FormData): Promise<ActionState> {
  const incident = str(form, 'incident_declared');
  return rpc('submit_daily_report', {
    p_operation_id: uuid(form, 'operation_id'),
    p_assignment_id: uuid(form, 'assignment_id'),
    p_payload: {
      report_date: str(form, 'report_date'), present_user_ids: list(form, 'present'), work_completed: str(form, 'work_completed'),
      work_not_completed: str(form, 'work_not_completed'), material_used: str(form, 'material_used'), material_shortage: str(form, 'material_shortage'),
      blockers: str(form, 'blockers'), incident_declared: incident === 'yes' ? true : incident === 'no' ? false : null,
      safety_observations: str(form, 'safety_observations'), next_day_plan: str(form, 'next_day_plan'),
    },
  }, 'partner.report_submitted');
}

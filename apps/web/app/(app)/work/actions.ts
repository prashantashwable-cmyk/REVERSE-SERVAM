'use server';

import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_SAFETY_CHECKS } from '@aiec/domain';
import { errorState, int, localError, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function rpc(fn: string, args: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  return success(messageKey, (data ?? {}) as Record<string, unknown>);
}

export async function acceptTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('accept_task', { p_task_id: uuid(form, 'task_id'), p_expected_version: int(form, 'version') }, 'work.accepted');
}

/** WT03: each control is confirmed, not applicable, or left unconfirmed (critical ones then block Start). */
export async function safetyCheckAction(_: ActionState, form: FormData): Promise<ActionState> {
  const answers = Object.fromEntries(DEFAULT_SAFETY_CHECKS.map((c) => {
    const v = str(form, `safety_${c.key}`);
    return [c.key, { applicable: v !== 'not_applicable', confirmed: v === 'confirmed' }];
  }));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('record_safety_check', { p_operation_id: uuid(form, 'operation_id'), p_task_id: uuid(form, 'task_id'), p_answers: answers });
  if (error) return errorState(error);
  const r = data as { can_start: boolean };
  return success(r.can_start ? 'work.safety_passed' : 'work.safety_failed', data as Record<string, unknown>);
}

export async function startTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('start_task', { p_task_id: uuid(form, 'task_id'), p_expected_version: int(form, 'version') }, 'work.started');
}

/** WT04: each checklist item is done, or not applicable with a reason. */
export async function saveProgressAction(_: ActionState, form: FormData): Promise<ActionState> {
  const keys = form.getAll('item').map(String);
  const answers = Object.fromEntries(keys.map((k) => [k, { done: form.get(`done_${k}`) === 'on', not_applicable_reason: str(form, `na_${k}`) }]));
  return rpc('save_task_progress', { p_task_id: uuid(form, 'task_id'), p_expected_version: int(form, 'version'), p_answers: answers, p_notes: str(form, 'notes') }, 'work.progress_saved');
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

/**
 * Photo evidence from the browser. The server records its own checksum and receipt time; a browser
 * upload is labelled `document_import` (the Android app records `in_app_camera` with GPS metadata).
 */
export async function uploadEvidenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const taskId = uuid(form, 'task_id');
  const orgId = uuid(form, 'partner_org_id');
  const file = form.get('file');
  if (!taskId || !orgId) return localError('NOT_FOUND');
  if (!(file instanceof File) || file.size === 0) return localError('REQUIRED_FIELD_MISSING', ['file']);
  const ext = EXT[file.type];
  if (!ext) return localError('VALIDATION_FAILED', ['mime_type']);
  if (file.size > 15_728_640) return localError('VALIDATION_FAILED', ['size_bytes']);
  const bytes = Buffer.from(await file.arrayBuffer());
  const operationId = uuid(form, 'operation_id') ?? randomUUID();
  const path = `${orgId}/tasks/${taskId}/${operationId}.${ext}`;
  const supabase = await supabaseServer();
  const up = await supabase.storage.from('execution-evidence').upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error && !/exist|duplicate/i.test(up.error.message)) return localError('FILE_UPLOAD_FAILED');
  const { data, error } = await supabase.rpc('register_task_evidence', {
    p_operation_id: operationId,
    p_task_id: taskId,
    p_payload: {
      category: str(form, 'category'), storage_path: path, sha256: createHash('sha256').update(bytes).digest('hex'), mime_type: file.type,
      // The file's own time (never later than now); the server keeps its receipt time separately.
      size_bytes: file.size, captured_at: new Date(Math.min(file.lastModified || Date.now(), Date.now())).toISOString(),
      source: 'document_import', remarks: str(form, 'remarks'), defect_id: uuid(form, 'defect_id'),
    },
  });
  if (error) return errorState(error);
  return success('work.evidence_added', data as Record<string, unknown>);
}

export async function submitTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('submit_task', { p_task_id: uuid(form, 'task_id'), p_expected_version: int(form, 'version') }, 'work.submitted');
}

/** WT05: safety categories stop the task at once and escalate to AIEC. */
export async function reportIncidentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('report_incident', {
    p_operation_id: uuid(form, 'operation_id'), p_task_id: uuid(form, 'task_id'), p_category: str(form, 'category'), p_description: str(form, 'description'),
    p_client_reported_at: new Date().toISOString(),
  });
  if (error) return errorState(error);
  return success((data as { safety_stop: boolean }).safety_stop ? 'work.safety_stop_reported' : 'work.blocker_reported', data as Record<string, unknown>);
}

/** WT06 / LP12: defect steps (acknowledge / dispute by the partner, start / submit correction by the technician). */
export async function defectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const action = str(form, 'action');
  return rpc('defect_action', { p_defect_id: uuid(form, 'defect_id'), p_expected_version: int(form, 'version'), p_action: action, p_reason: str(form, 'reason') }, `work.defect_${action ?? 'acknowledge'}_done`);
}

export async function resubmitTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('resubmit_task', { p_task_id: uuid(form, 'task_id'), p_expected_version: int(form, 'version') }, 'work.resubmitted');
}

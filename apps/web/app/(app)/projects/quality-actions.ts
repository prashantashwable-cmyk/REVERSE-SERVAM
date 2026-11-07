'use server';

import { createHash, randomUUID } from 'node:crypto';
import { errorState, int, localError, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function rpc(fn: string, args: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  return success(messageKey, (data ?? {}) as Record<string, unknown>);
}

export async function projectQualityAction(_: ActionState, form: FormData): Promise<ActionState> {
  const action = str(form, 'action');
  return rpc('project_quality_action', { p_project_id: uuid(form, 'project_id'), p_expected_version: int(form, 'version'), p_action: action, p_reason: str(form, 'reason') }, `handover.${action ?? 'close'}_done`);
}

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Upload into the project's private folder (server checksum), then register as statutory evidence or a handover document. */
async function upload(form: FormData, fn: 'register_statutory_evidence' | 'register_handover_document', payload: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const projectId = uuid(form, 'project_id');
  const orgId = uuid(form, 'organization_id');
  const file = form.get('file');
  if (!projectId || !orgId) return localError('NOT_FOUND');
  if (!(file instanceof File) || file.size === 0) return localError('REQUIRED_FIELD_MISSING', ['file']);
  const ext = EXT[file.type];
  if (!ext) return localError('VALIDATION_FAILED', ['mime_type']);
  if (file.size > 26_214_400) return localError('VALIDATION_FAILED', ['size_bytes']);
  const bytes = Buffer.from(await file.arrayBuffer());
  const operationId = uuid(form, 'operation_id') ?? randomUUID();
  const path = `${orgId}/projects/${projectId}/${operationId}.${ext}`;
  const supabase = await supabaseServer();
  const up = await supabase.storage.from('handover-documents').upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error && !/exist|duplicate/i.test(up.error.message)) return localError('FILE_UPLOAD_FAILED');
  const { data, error } = await supabase.rpc(fn, { p_operation_id: operationId, p_project_id: projectId, p_payload: {
    ...payload, storage_path: path, sha256: createHash('sha256').update(bytes).digest('hex'), mime_type: file.type, size_bytes: file.size } });
  if (error) return errorState(error);
  return success(messageKey, data as Record<string, unknown>);
}

export async function uploadStatutoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  return upload(form, 'register_statutory_evidence', {
    evidence_type: str(form, 'evidence_type'), authority: str(form, 'authority'), reference_number: str(form, 'reference_number'),
    issued_on: str(form, 'issued_on'), valid_until: str(form, 'valid_until'),
  }, 'handover.statutory_recorded');
}

export async function verifyStatutoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const decision = str(form, 'decision');
  return rpc('verify_statutory_evidence', { p_evidence_id: uuid(form, 'evidence_id'), p_decision: decision, p_reason: str(form, 'reason') },
    decision === 'verify' ? 'handover.statutory_verified' : 'handover.statutory_rejected');
}

export async function uploadHandoverDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return upload(form, 'register_handover_document', { doc_type: str(form, 'doc_type'), title: str(form, 'title') }, 'handover.document_added');
}

export async function linkCustomerAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('link_project_customer', { p_project_id: uuid(form, 'project_id'), p_expected_version: int(form, 'version'), p_customer_org_id: uuid(form, 'customer_org_id') }, 'handover.customer_linked');
}

export async function handoverAction(_: ActionState, form: FormData): Promise<ActionState> {
  const action = str(form, 'action');
  return rpc('handover_action', { p_project_id: uuid(form, 'project_id'), p_action: action }, `handover.${action ?? 'confirm_ready'}_done`);
}

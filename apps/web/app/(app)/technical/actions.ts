'use server';

import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_CONFIGURATION_CATALOGUE } from '@aiec/domain';
import { errorState, int, lines, localError, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function rpc(fn: string, args: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  return success(messageKey, (data ?? {}) as Record<string, unknown>);
}

/** TE01 → TE02. The page navigates to the returned review. */
export async function startReviewAction(_: ActionState, form: FormData): Promise<ActionState> {
  const surveyId = uuid(form, 'survey_id');
  if (!surveyId) return localError('NOT_FOUND');
  return rpc('start_technical_review', { p_survey_id: surveyId }, 'technical.review_started');
}

export async function clarifyAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('request_technical_clarification', { p_review_id: uuid(form, 'review_id'), p_expected_version: int(form, 'version'), p_reason: str(form, 'reason') }, 'technical.clarification_sent');
}

export async function decideAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc(
    'decide_technical_review',
    {
      p_review_id: uuid(form, 'review_id'),
      p_expected_version: int(form, 'version'),
      p_decision: str(form, 'decision'),
      p_payload: {
        technical_basis: str(form, 'technical_basis'),
        assumptions: str(form, 'assumptions'),
        references: str(form, 'references'),
        constraints: lines(form, 'constraints'),
        corrective_actions: lines(form, 'corrective_actions'),
        reason: str(form, 'reason'),
      },
    },
    'technical.decision_recorded',
  );
}

/** TE03: every catalogue parameter is posted as value_<key> / status_<key>. */
export async function saveConfigurationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parameters: Record<string, { value: string | number; status: string }> = {};
  for (const p of DEFAULT_CONFIGURATION_CATALOGUE.parameters) {
    const v = str(form, `value_${p.key}`);
    if (v === null) continue;
    const n = p.kind === 'number' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    parameters[p.key] = { value: n, status: str(form, `status_${p.key}`) === 'reviewed' ? 'reviewed' : 'proposed' };
  }
  const version = int(form, 'version');
  return rpc(
    'save_configuration_draft',
    { p_lead_id: uuid(form, 'lead_id'), p_expected_version: version, p_lift_category: str(form, 'lift_category'), p_parameters: parameters, p_change_summary: str(form, 'change_summary') },
    'technical.configuration_saved',
  );
}

export async function approveConfigurationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('approve_configuration', { p_revision_id: uuid(form, 'revision_id'), p_expected_version: int(form, 'version') }, 'technical.configuration_approved');
}

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * TE04 upload: the server computes the SHA-256 of the received bytes (the checksum
 * an approval binds to), stores the file privately as the signed-in user (storage
 * RLS applies), then registers the revision.
 */
export async function uploadDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const file = form.get('file');
  const leadId = uuid(form, 'lead_id');
  const orgId = uuid(form, 'organization_id');
  if (!leadId || !orgId) return localError('NOT_FOUND');
  if (!(file instanceof File) || file.size === 0) return localError('REQUIRED_FIELD_MISSING', ['file']);
  const ext = EXT[file.type];
  if (!ext) return localError('VALIDATION_FAILED', ['mime_type']);
  if (file.size > 26_214_400) return localError('VALIDATION_FAILED', ['size_bytes']);
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const operationId = uuid(form, 'operation_id') ?? randomUUID();
  const path = `${orgId}/leads/${leadId}/${operationId}.${ext}`;
  const supabase = await supabaseServer();
  const up = await supabase.storage.from('technical-documents').upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error && !/exist|duplicate/i.test(up.error.message)) return localError('FILE_UPLOAD_FAILED');
  const { data, error } = await supabase.rpc('register_document_revision', {
    p_operation_id: operationId,
    p_lead_id: leadId,
    p_document_id: uuid(form, 'document_id'),
    p_payload: {
      kind: str(form, 'kind'),
      title: str(form, 'title'),
      change_summary: str(form, 'change_summary'),
      configuration_revision_id: uuid(form, 'configuration_revision_id'),
      storage_path: path,
      sha256,
      mime_type: file.type,
      size_bytes: file.size,
    },
  });
  if (error) return errorState(error);
  return success('technical.document_uploaded', data as Record<string, unknown>);
}

export async function submitDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('submit_document_revision', { p_revision_id: uuid(form, 'revision_id'), p_expected_version: int(form, 'version') }, 'technical.document_submitted');
}

export async function decideDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc(
    'decide_document_revision',
    { p_revision_id: uuid(form, 'revision_id'), p_expected_version: int(form, 'version'), p_decision: str(form, 'decision'), p_reviewed_sha256: str(form, 'sha256'), p_comment: str(form, 'comment') },
    str(form, 'decision') === 'approve' ? 'technical.document_approved' : 'technical.document_rejected',
  );
}

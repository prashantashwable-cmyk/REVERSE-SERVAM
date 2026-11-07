'use server';

import { QUOTATION_TERM_KEYS, parseInr, parsePercentBps, parseQuantityMilli } from '@aiec/domain';
import { errorState, int, istLocalToIso, localError, str, success, uuid, type ActionState } from '@/lib/actions';
import type { LineDraft } from './quotation-types';
import { supabaseServer } from '@/lib/supabase/server';

async function rpc(fn: string, args: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  return success(messageKey, (data ?? {}) as Record<string, unknown>);
}

/** SE08: the page then navigates to the quotation. */
export async function createQuotationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('create_quotation', { p_operation_id: uuid(form, 'operation_id'), p_lead_id: uuid(form, 'lead_id') }, 'quotation.created');
}


export async function saveQuotationAction(_: ActionState, form: FormData): Promise<ActionState> {
  let drafts: LineDraft[];
  try {
    drafts = JSON.parse(String(form.get('lines_json') ?? '[]')) as LineDraft[];
    if (!Array.isArray(drafts)) throw new Error('lines');
  } catch {
    return localError('VALIDATION_FAILED', ['lines']);
  }
  const lines: Record<string, unknown>[] = [];
  const bad: string[] = [];
  drafts.forEach((d, i) => {
    const n = i + 1;
    const line: Record<string, unknown> = { category: d.category, description: d.description, unit: d.unit, tax_code: d.taxCode, cost_source: d.costSource || null };
    try { line.quantity_milli = parseQuantityMilli(d.quantity ?? ''); } catch { bad.push(`lines.${n}.quantity_milli`); }
    try { line.rate_paise = parseInr(d.rate ?? '').toString(); if (BigInt(line.rate_paise as string) < 0n) throw new Error(); } catch { bad.push(`lines.${n}.rate_paise`); }
    try { line.discount_bps = parsePercentBps(d.discountPercent ?? ''); } catch { bad.push(`lines.${n}.discount_bps`); }
    if ((d.estimatedUnitCost ?? '').trim() !== '') {
      try { line.estimated_unit_cost_paise = parseInr(d.estimatedUnitCost).toString(); if (BigInt(line.estimated_unit_cost_paise as string) < 0n) throw new Error(); } catch { bad.push(`lines.${n}.estimated_unit_cost_paise`); }
    }
    lines.push(line);
  });
  if (bad.length) return localError('VALIDATION_FAILED', bad);
  const terms = Object.fromEntries(QUOTATION_TERM_KEYS.map((k) => [k, str(form, `terms_${k}`)]));
  return rpc(
    'save_quotation_draft',
    { p_revision_id: uuid(form, 'revision_id'), p_expected_version: int(form, 'version'), p_lines: lines, p_terms: terms, p_valid_until: str(form, 'valid_until') },
    'quotation.saved',
  );
}

export async function submitQuotationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('submit_quotation', { p_revision_id: uuid(form, 'revision_id'), p_expected_version: int(form, 'version') }, 'quotation.submitted');
}

export async function issueQuotationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('issue_quotation', { p_revision_id: uuid(form, 'revision_id'), p_expected_version: int(form, 'version') }, 'quotation.issued_done');
}

export async function recordResponseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const response = str(form, 'response');
  return rpc(
    'record_customer_response',
    {
      p_revision_id: uuid(form, 'revision_id'),
      p_expected_version: int(form, 'version'),
      p_response: response,
      p_payload: {
        accepted_by_name: str(form, 'accepted_by_name'),
        acceptor_authority: str(form, 'acceptor_authority'),
        channel: str(form, 'channel'),
        evidence: str(form, 'evidence'),
        comments: str(form, 'comments'),
        reason: str(form, 'reason'),
        content_sha256: str(form, 'content_sha256'),
      },
    },
    response === 'accept' ? 'quotation.accepted_done' : 'quotation.rejected_done',
  );
}

export async function reviseQuotationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('revise_quotation', { p_quotation_id: uuid(form, 'quotation_id'), p_reason: str(form, 'reason') }, 'quotation.revised_done');
}

export async function addNegotiationAction(_: ActionState, form: FormData): Promise<ActionState> {
  let bps: number | null = null;
  const pct = str(form, 'requested_discount');
  if (pct !== null) {
    try { bps = parsePercentBps(pct); } catch { return localError('VALIDATION_FAILED', ['requested_discount_bps']); }
  }
  return rpc(
    'add_quotation_negotiation',
    {
      p_quotation_id: uuid(form, 'quotation_id'),
      p_payload: {
        occurred_at: istLocalToIso(str(form, 'occurred_at')),
        contact: str(form, 'contact'),
        topic: str(form, 'topic'),
        requested_change: str(form, 'requested_change'),
        requested_discount_bps: bps,
        expected_impact: str(form, 'expected_impact'),
        decision: str(form, 'decision'),
      },
    },
    'quotation.negotiation_recorded',
  );
}

/** O04 Approval center. */
export async function decideApprovalAction(_: ActionState, form: FormData): Promise<ActionState> {
  const decision = str(form, 'decision');
  return rpc(
    'decide_quotation_approval',
    { p_request_id: uuid(form, 'request_id'), p_decision: decision, p_reason: str(form, 'reason') },
    decision === 'approve' ? 'approvals.approved_done' : decision === 'reject' ? 'approvals.rejected_done' : 'approvals.more_info_done',
  );
}

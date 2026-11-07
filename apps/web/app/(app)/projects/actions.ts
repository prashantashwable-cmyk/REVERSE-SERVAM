'use server';

import { ORDER_HANDOVER_ITEMS, parseInr, parseQuantityMilli } from '@aiec/domain';
import { errorState, int, localError, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function rpc(fn: string, args: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  return success(messageKey, (data ?? {}) as Record<string, unknown>);
}

/** SE11 / Gate 4: the page navigates to the new project. */
export async function convertToOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const checklist = Object.fromEntries(ORDER_HANDOVER_ITEMS.map((k) => [k, form.get(`check_${k}`) === 'on']));
  return rpc(
    'convert_quotation_to_order',
    {
      p_operation_id: uuid(form, 'operation_id'),
      p_revision_id: uuid(form, 'revision_id'),
      p_payload: {
        contract_reference: str(form, 'contract_reference'),
        contract_date: str(form, 'contract_date'),
        milestone_template: str(form, 'milestone_template'),
        handover_checklist: checklist,
        notes: str(form, 'notes'),
      },
    },
    'project.created_done',
  );
}

export async function acknowledgeHandoverAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('acknowledge_project_handover', { p_project_id: uuid(form, 'project_id'), p_expected_version: int(form, 'version'), p_notes: str(form, 'notes') }, 'project.handover_acknowledged');
}

function paise(form: FormData, key: string, field: string): string | ActionState {
  const v = str(form, key);
  if (v === null) return localError('REQUIRED_FIELD_MISSING', [field]);
  try {
    const p = parseInr(v);
    if (p <= 0n) throw new Error('not positive');
    return p.toString();
  } catch {
    return localError('VALIDATION_FAILED', [field]);
  }
}

export async function recordClaimAction(_: ActionState, form: FormData): Promise<ActionState> {
  const amount = paise(form, 'amount', 'amount_paise');
  if (typeof amount !== 'string') return amount;
  return rpc(
    'record_payment_claim',
    {
      p_operation_id: uuid(form, 'operation_id'),
      p_project_id: uuid(form, 'project_id'),
      p_payload: {
        milestone_code: str(form, 'milestone_code'),
        payer_name: str(form, 'payer_name'),
        amount_paise: amount,
        payment_mode: str(form, 'payment_mode'),
        payment_reference: str(form, 'payment_reference'),
        payment_date: str(form, 'payment_date'),
        evidence_note: str(form, 'evidence_note'),
      },
    },
    'payment.claim_recorded',
  );
}

export async function decideClaimAction(_: ActionState, form: FormData): Promise<ActionState> {
  const decision = str(form, 'decision');
  let verified: string | null = null;
  if (decision === 'verify' || decision === 'verify_partially') {
    const v = paise(form, 'verified_amount', 'verified_amount_paise');
    if (typeof v !== 'string') return v;
    verified = v;
  }
  return rpc(
    'decide_payment_claim',
    {
      p_claim_id: uuid(form, 'claim_id'),
      p_expected_version: int(form, 'version'),
      p_decision: decision,
      p_payload: { verified_amount_paise: verified, matched_statement_reference: str(form, 'matched_statement_reference'), reason: str(form, 'reason') },
    },
    `payment.decided_${decision ?? 'verify'}`,
  );
}

export async function resubmitClaimAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('resubmit_payment_claim', { p_claim_id: uuid(form, 'claim_id'), p_expected_version: int(form, 'version'),
    p_payload: { payment_reference: str(form, 'payment_reference'), evidence_note: str(form, 'evidence_note') } }, 'payment.resubmitted_done');
}

export async function requestExceptionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const days = int(form, 'valid_days');
  if (days === null || Number.isNaN(days) || days < 1 || days > 30) return localError('VALIDATION_FAILED', ['expires_at']);
  return rpc('request_payment_exception', {
    p_project_id: uuid(form, 'project_id'), p_action: str(form, 'action'), p_reason: str(form, 'reason'),
    p_expires_at: new Date(Date.now() + days * 864e5).toISOString(),
  }, 'payment.exception_requested');
}

/** BOM lines arrive as JSON from the editor; quantities are typed as decimals. */
export async function saveBomAction(_: ActionState, form: FormData): Promise<ActionState> {
  let rows: { item_code: string; description: string; make_model: string; specification: string; quantity: string; unit: string; source: string; technical_notes: string }[];
  try {
    rows = JSON.parse(String(form.get('lines_json') ?? '[]'));
    if (!Array.isArray(rows)) throw new Error('lines');
  } catch {
    return localError('VALIDATION_FAILED', ['lines']);
  }
  const bad: string[] = [];
  const lines = rows.map((r, i) => {
    let q: number | null = null;
    try { q = parseQuantityMilli(r.quantity ?? ''); } catch { bad.push(`lines.${i + 1}.quantity_milli`); }
    return { ...r, quantity_milli: q };
  });
  if (bad.length) return localError('VALIDATION_FAILED', bad);
  return rpc('save_bom_draft', { p_project_id: uuid(form, 'project_id'), p_expected_version: int(form, 'version'), p_lines: lines, p_change_summary: str(form, 'change_summary') }, 'bom.saved_done');
}

export async function approveBomAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('approve_bom', { p_bom_revision_id: uuid(form, 'bom_revision_id'), p_expected_version: int(form, 'version') }, 'bom.approved_done');
}

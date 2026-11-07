'use server';

import { parseInr, parsePercentBps, parseQuantityMilli } from '@aiec/domain';
import { errorState, int, localError, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function rpc(fn: string, args: Record<string, unknown>, messageKey: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  return success(messageKey, (data ?? {}) as Record<string, unknown>);
}

const money = (v: string | null, field: string, bad: string[], required = true): string | null => {
  if (v === null) {
    if (required) bad.push(field);
    return null;
  }
  try {
    const p = parseInr(v);
    if (p < 0n) throw new Error('negative');
    return p.toString();
  } catch {
    bad.push(field);
    return null;
  }
};

/** PR01: quantity typed per BOM line (empty = not requested). The page navigates to the new request. */
export async function createRequestAction(_: ActionState, form: FormData): Promise<ActionState> {
  const bad: string[] = [];
  const lines: { bom_line_id: string; quantity_milli: number }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('qty_') || typeof v !== 'string' || v.trim() === '') continue;
    try {
      lines.push({ bom_line_id: k.slice(4), quantity_milli: parseQuantityMilli(v) });
    } catch {
      bad.push(`lines.${lines.length + 1}.quantity_milli`);
    }
  }
  const budget = money(str(form, 'budget'), 'budget_estimate_paise', bad, false);
  if (bad.length) return localError('VALIDATION_FAILED', bad);
  return rpc('create_purchase_request', {
    p_operation_id: uuid(form, 'operation_id'),
    p_project_id: uuid(form, 'project_id'),
    p_payload: { required_by: str(form, 'required_by'), preferred_supplier_id: uuid(form, 'preferred_supplier_id'), budget_estimate_paise: budget, notes: str(form, 'notes'), lines },
  }, 'procurement.request_created');
}

export async function addQuoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const bad: string[] = [];
  const net = money(str(form, 'net'), 'net_paise', bad);
  const tax = money(str(form, 'tax') ?? '0', 'tax_paise', bad);
  const freight = money(str(form, 'freight') ?? '0', 'freight_paise', bad);
  if (bad.length) return localError('VALIDATION_FAILED', bad);
  return rpc('add_supplier_quote', {
    p_request_id: uuid(form, 'request_id'),
    p_payload: {
      supplier_id: uuid(form, 'supplier_id'), net_paise: net, tax_paise: tax, freight_paise: freight,
      lead_time_days: int(form, 'lead_time_days'), warranty_months: int(form, 'warranty_months'),
      technical_match: str(form, 'technical_match') === 'yes', payment_terms: str(form, 'payment_terms'), notes: str(form, 'notes'),
    },
  }, 'procurement.quote_added');
}

export async function selectSupplierAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('select_supplier', { p_request_id: uuid(form, 'request_id'), p_expected_version: int(form, 'version'), p_quote_id: uuid(form, 'quote_id'), p_rationale: str(form, 'rationale') }, 'procurement.supplier_selected');
}

export async function cancelRequestAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('cancel_purchase_request', { p_request_id: uuid(form, 'request_id'), p_expected_version: int(form, 'version'), p_reason: str(form, 'reason') }, 'procurement.request_cancelled');
}

/** PR03: rate (₹) and tax (%) per request line; the page navigates to the new PO. */
export async function createOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const bad: string[] = [];
  const lines: { request_line_id: string; rate_paise: string | null; tax_rate_bps: number | null }[] = [];
  let n = 0;
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('rate_') || typeof v !== 'string') continue;
    n++;
    const id = k.slice(5);
    const rate = money(v.trim() || null, `lines.${n}.rate_paise`, bad);
    let tax: number | null = null;
    try { tax = parsePercentBps(String(form.get(`tax_${id}`) ?? '')); } catch { bad.push(`lines.${n}.tax_rate_bps`); }
    lines.push({ request_line_id: id, rate_paise: rate, tax_rate_bps: tax });
  }
  const freight = money(str(form, 'freight') ?? '0', 'freight_paise', bad);
  if (bad.length) return localError('VALIDATION_FAILED', bad);
  return rpc('create_purchase_order', {
    p_operation_id: uuid(form, 'operation_id'),
    p_request_id: uuid(form, 'request_id'),
    p_payload: {
      lines, freight_paise: freight, delivery_location: str(form, 'delivery_location'), delivery_from: str(form, 'delivery_from'),
      delivery_to: str(form, 'delivery_to'), payment_terms: str(form, 'payment_terms'), terms: str(form, 'terms'),
    },
  }, 'procurement.po_created');
}

export async function submitOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('submit_purchase_order', { p_po_id: uuid(form, 'po_id'), p_expected_version: int(form, 'version') }, 'procurement.po_submitted');
}

export async function issueOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('issue_purchase_order', { p_po_id: uuid(form, 'po_id'), p_expected_version: int(form, 'version') }, 'procurement.po_issued');
}

export async function materialStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  return rpc('update_material_status', { p_po_line_id: uuid(form, 'po_line_id'), p_expected_version: int(form, 'version'), p_action: str(form, 'action') }, 'procurement.material_updated');
}

/** PR05: received / damaged per line (decimal quantities), result and remarks. */
export async function receiveGoodsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const bad: string[] = [];
  const lines: Record<string, unknown>[] = [];
  let n = 0;
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('received_') || typeof v !== 'string' || v.trim() === '') continue;
    n++;
    const id = k.slice(9);
    let rec: number | null = null;
    let dmg = 0;
    try { rec = parseQuantityMilli(v); } catch { bad.push(`lines.${n}.received_milli`); }
    const d = String(form.get(`damaged_${id}`) ?? '').trim();
    if (d !== '' && d !== '0') {
      try { dmg = parseQuantityMilli(d); } catch { bad.push(`lines.${n}.damaged_milli`); }
    }
    lines.push({ po_line_id: id, received_milli: rec, damaged_milli: dmg, result: String(form.get(`result_${id}`) ?? 'accepted'),
      serial_batch: String(form.get(`serial_${id}`) ?? '') || null, remarks: String(form.get(`remarks_${id}`) ?? '') || null });
  }
  if (bad.length) return localError('VALIDATION_FAILED', bad);
  return rpc('record_goods_receipt', { p_operation_id: uuid(form, 'operation_id'), p_po_id: uuid(form, 'po_id'), p_payload: { lines, notes: str(form, 'notes') } }, 'procurement.goods_received');
}

/** O04 for purchase orders and payment exceptions. */
export async function decideRequestAction(_: ActionState, form: FormData): Promise<ActionState> {
  const decision = str(form, 'decision');
  return rpc('decide_approval_request', { p_request_id: uuid(form, 'request_id'), p_decision: decision, p_reason: str(form, 'reason') },
    decision === 'approve' ? 'approvals.request_approved' : 'approvals.request_rejected');
}

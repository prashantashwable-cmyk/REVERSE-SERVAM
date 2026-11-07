'use server';

import { errorState, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

/** CU07: accept the handover (records who accepted) or raise issues (a description is required). */
export async function customerDecisionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const decision = str(form, 'decision');
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('customer_handover_decision', {
    p_project_id: uuid(form, 'project_id'), p_decision: decision, p_acceptor_name: str(form, 'acceptor_name'), p_comment: str(form, 'comment'),
  });
  if (error) return errorState(error);
  return success(decision === 'accept' ? 'customer.accepted_done' : 'customer.issue_done', data as Record<string, unknown>);
}

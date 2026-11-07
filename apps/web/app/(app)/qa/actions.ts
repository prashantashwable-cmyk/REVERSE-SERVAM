'use server';

import { errorState, int, str, success, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * QA03 / QA05 / QA06: answers per criterion (result_<key>, note_<key>), a defect for each failed criterion
 * (defect_<key>_category, _severity, _location, _description, _due) and a decision per correction waiting
 * for reinspection (decision_<defectId>, reason_<defectId>).
 */
export async function recordInspectionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const keys = form.getAll('criterion').map(String);
  const answers = Object.fromEntries(keys.filter((k) => str(form, `result_${k}`)).map((k) => [k, { result: str(form, `result_${k}`), note: str(form, `note_${k}`) }]));
  const defects = keys
    .filter((k) => str(form, `result_${k}`) === 'fail')
    .map((k) => ({
      criterion_key: k, category: str(form, `defect_${k}_category`), severity: str(form, `defect_${k}_severity`), location: str(form, `defect_${k}_location`),
      description: str(form, `defect_${k}_description`), correction_due_date: str(form, `defect_${k}_due`),
    }));
  const decisions = form.getAll('pending_defect').map(String).map((id) => ({ defect_id: id, decision: str(form, `decision_${id}`), reason: str(form, `reason_${id}`) }));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('record_inspection', {
    p_operation_id: uuid(form, 'operation_id'),
    p_payload: { task_id: uuid(form, 'task_id'), project_id: uuid(form, 'project_id'), answers, notes: str(form, 'notes'), defects, defect_decisions: decisions },
  });
  if (error) return errorState(error);
  return success(`qa.inspection_${(data as { outcome: string }).outcome}`, data as Record<string, unknown>);
}

export async function qaDefectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('defect_action', { p_defect_id: uuid(form, 'defect_id'), p_expected_version: int(form, 'version'), p_action: str(form, 'action'), p_reason: str(form, 'reason') });
  if (error) return errorState(error);
  return success('qa.dispute_resolved', data as Record<string, unknown>);
}

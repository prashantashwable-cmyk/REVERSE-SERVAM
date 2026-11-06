'use server';

import { errorState, int, istLocalToIso, localError, str, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

type Rpc = { fn: string; args: Record<string, unknown>; success: string };

async function run(leadId: string | null, rpc: Rpc): Promise<ActionState> {
  if (!leadId) return localError('NOT_FOUND');
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(rpc.fn, rpc.args);
  if (error) return errorState(error);
  return { status: 'success', message: rpc.success };
}

export async function recordActivityAction(_: ActionState, form: FormData): Promise<ActionState> {
  const occurred = istLocalToIso(str(form, 'occurred_at'));
  const next = istLocalToIso(str(form, 'next_follow_up_at'));
  if (!occurred) return localError('REQUIRED_FIELD_MISSING', ['occurred_at']);
  return run(uuid(form, 'lead_id'), {
    fn: 'record_lead_activity',
    args: {
      p_operation_id: uuid(form, 'operation_id'),
      p_lead_id: uuid(form, 'lead_id'),
      p_activity_type: str(form, 'activity_type'),
      p_outcome: str(form, 'outcome'),
      p_summary: str(form, 'summary'),
      p_occurred_at: occurred,
      p_next_follow_up_at: next,
      p_no_action_reason: str(form, 'no_action_reason'),
    },
    success: 'Activity recorded.',
  });
}

export async function qualifyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const qualification: Record<string, string> = {};
  for (const k of ['need', 'decision_authority', 'budget_readiness', 'timeline', 'site_readiness', 'number_of_lifts', 'competitor_situation', 'technical_complexity', 'next_action']) {
    const v = str(form, k);
    if (v) qualification[k] = v;
  }
  const override = int(form, 'score_override');
  if (Number.isNaN(override)) return localError('VALIDATION_FAILED', ['score_override']);
  return run(uuid(form, 'lead_id'), {
    fn: 'qualify_lead',
    args: {
      p_lead_id: uuid(form, 'lead_id'),
      p_expected_version: int(form, 'version'),
      p_qualification: qualification,
      p_score_override: override,
      p_override_reason: str(form, 'override_reason'),
    },
    success: 'Lead qualified.',
  });
}

export async function scheduleSurveyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const start = istLocalToIso(str(form, 'scheduled_start'));
  const hours = Number(str(form, 'duration_hours') ?? '2');
  if (!start) return localError('REQUIRED_FIELD_MISSING', ['scheduled_start']);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 12) return localError('VALIDATION_FAILED', ['duration_hours']);
  const end = new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  return run(uuid(form, 'lead_id'), {
    fn: 'schedule_survey',
    args: {
      p_operation_id: uuid(form, 'operation_id'),
      p_lead_id: uuid(form, 'lead_id'),
      p_surveyor_id: uuid(form, 'surveyor_id'),
      p_scheduled_start: start,
      p_scheduled_end: end,
      p_scope: str(form, 'scope'),
      p_special_instructions: str(form, 'special_instructions'),
      p_site_contact_name: str(form, 'site_contact_name'),
      p_site_contact_phone: str(form, 'site_contact_phone'),
    },
    success: 'Survey booked and the surveyor notified.',
  });
}

export async function closeLeadAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(uuid(form, 'lead_id'), {
    fn: 'close_lead',
    args: {
      p_lead_id: uuid(form, 'lead_id'),
      p_expected_version: int(form, 'version'),
      p_outcome: str(form, 'outcome'),
      p_reason: str(form, 'reason'),
      p_lost_reason: str(form, 'lost_reason'),
    },
    success: 'Lead closed.',
  });
}

export async function assignLeadAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(uuid(form, 'lead_id'), {
    fn: 'assign_lead',
    args: { p_lead_id: uuid(form, 'lead_id'), p_assignee_id: uuid(form, 'assignee_id'), p_expected_version: int(form, 'version'), p_reason: str(form, 'reason') },
    success: 'Lead assigned.',
  });
}

export async function reopenLeadAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(uuid(form, 'lead_id'), {
    fn: 'reopen_lead',
    args: { p_lead_id: uuid(form, 'lead_id'), p_expected_version: int(form, 'version'), p_assignee_id: uuid(form, 'assignee_id'), p_reason: str(form, 'reason') },
    success: 'Lead reopened.',
  });
}

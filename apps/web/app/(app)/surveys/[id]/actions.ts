'use server';

import { revalidatePath } from 'next/cache';
import { errorState, int, istLocalToIso, localError, str, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function call(surveyId: string | null, fn: string, args: Record<string, unknown>, success: string): Promise<ActionState> {
  if (!surveyId) return localError('NOT_FOUND');
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  revalidatePath(`/surveys/${surveyId}`);
  return { status: 'success', message: success };
}

export async function requestRevisionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = uuid(form, 'survey_id');
  return call(id, 'request_survey_revision', { p_survey_id: id, p_expected_version: int(form, 'version'), p_reason: str(form, 'reason') }, 'Returned to the surveyor for revision.');
}

export async function reviewGpsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = uuid(form, 'survey_id');
  return call(id, 'review_gps_exception', { p_survey_id: id, p_decision: str(form, 'decision'), p_note: str(form, 'note') }, 'GPS exception reviewed.');
}

export async function rescheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = uuid(form, 'survey_id');
  const start = istLocalToIso(str(form, 'scheduled_start'));
  const hours = Number(str(form, 'duration_hours') ?? '2');
  if (!start) return localError('REQUIRED_FIELD_MISSING', ['scheduled_start']);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 12) return localError('VALIDATION_FAILED', ['duration_hours']);
  return call(
    id,
    'reschedule_survey',
    {
      p_survey_id: id,
      p_expected_version: int(form, 'version'),
      p_scheduled_start: start,
      p_scheduled_end: new Date(Date.parse(start) + hours * 3_600_000).toISOString(),
      p_surveyor_id: uuid(form, 'surveyor_id'),
      p_reason: str(form, 'reason'),
    },
    'Survey rescheduled and the surveyor notified.',
  );
}

export async function cancelAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = uuid(form, 'survey_id');
  return call(id, 'cancel_survey', { p_survey_id: id, p_expected_version: int(form, 'version'), p_reason: str(form, 'reason') }, 'Survey cancelled.');
}

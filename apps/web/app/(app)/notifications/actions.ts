'use server';

import { errorState, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

export async function markReadAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = uuid(form, 'id');
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: id });
  if (error) return errorState(error);
  return { status: 'success', message: 'Marked as read.' };
}

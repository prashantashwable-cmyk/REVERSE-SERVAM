'use server';

import { isLocale } from '@aiec/domain';
import { supabaseServer } from '@/lib/supabase/server';

/** Save the signed-in user's language preference (audited server-side). */
export async function setLocaleAction(locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('set_my_locale', { p_locale: locale });
  return { ok: !error };
}

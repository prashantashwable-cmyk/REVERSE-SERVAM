import 'server-only';
import { supabaseServer } from './supabase/server';

/** Display names of AIEC staff by id (names only, via the staff_display_names RPC). */
export async function staffNames(ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map();
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc('staff_display_names', { p_ids: unique });
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
}

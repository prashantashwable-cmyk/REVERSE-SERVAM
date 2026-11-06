'use server';

import { revalidatePath } from 'next/cache';
import { errorState, str, uuid, type ActionState } from '@/lib/actions';
import { supabaseServer } from '@/lib/supabase/server';

async function call(fn: string, args: Record<string, unknown>, success: string): Promise<ActionState> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(fn, args);
  if (error) return errorState(error);
  revalidatePath('/admin/users');
  return { status: 'success', message: success };
}

export async function grantRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = uuid(form, 'user_id');
  const org = uuid(form, 'organization_id');
  const reason = str(form, 'reason');
  // Membership first (idempotent), then the role grant (validated against the org kind server-side).
  const supabase = await supabaseServer();
  const m = await supabase.rpc('admin_add_member', { p_user_id: user, p_org_id: org, p_reason: reason });
  if (m.error) return errorState(m.error);
  return call('admin_grant_role', { p_user_id: user, p_org_id: org, p_role_code: str(form, 'role_code'), p_reason: reason }, 'Role granted.');
}

export async function revokeRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return call('admin_revoke_role', { p_user_role_id: uuid(form, 'user_role_id'), p_reason: str(form, 'reason') }, 'Role revoked.');
}

export async function setStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  return call('admin_set_user_status', { p_user_id: uuid(form, 'user_id'), p_status: str(form, 'status'), p_reason: str(form, 'reason') }, 'Account status updated.');
}

export async function createOrganizationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return call(
    'admin_create_organization',
    { p_kind: str(form, 'kind'), p_name: str(form, 'name'), p_legal_name: str(form, 'legal_name'), p_city: str(form, 'city'), p_reason: str(form, 'reason') },
    'Organization created.',
  );
}

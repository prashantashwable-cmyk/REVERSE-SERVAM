import 'server-only';
import { cache } from 'react';
import { fromServerError, type DomainError, type PermissionCode, type RoleCode, type OrganizationKind } from '@aiec/domain';
import { supabaseServer } from './supabase/server';

export interface Membership {
  organization_id: string;
  organization_name: string;
  organization_kind: OrganizationKind;
  is_demo: boolean;
  roles: RoleCode[];
}

export interface UserContext {
  user_id: string;
  profile: {
    full_name: string | null;
    phone_e164: string | null;
    email: string | null;
    status: 'pending_verification' | 'active' | 'suspended';
    preferred_locale: string;
    version: number;
  };
  memberships: Membership[];
  permissions: PermissionCode[];
  aiec_organization_id: string | null;
  onboarding_missing: string[];
}

export type ContextResult = { ok: true; ctx: UserContext } | { ok: false; error: DomainError };

/** One get_my_context() round-trip per request (deduplicated by React cache). */
export const getContext = cache(async (): Promise<ContextResult> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('get_my_context');
  if (error) return { ok: false, error: fromServerError(error) };
  return { ok: true, ctx: data as UserContext };
});

export function can(ctx: UserContext, permission: PermissionCode): boolean {
  return ctx.profile.status === 'active' && ctx.permissions.includes(permission);
}

export function roles(ctx: UserContext): RoleCode[] {
  return [...new Set(ctx.memberships.flatMap((m) => m.roles))];
}

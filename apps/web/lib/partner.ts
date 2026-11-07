import 'server-only';
import type { UserContext } from './context';

/** The partner company the signed-in person works for (partner people belong to exactly one in practice). */
export function partnerMembership(ctx: UserContext) {
  return ctx.memberships.find((m) => m.organization_kind === 'partner') ?? null;
}

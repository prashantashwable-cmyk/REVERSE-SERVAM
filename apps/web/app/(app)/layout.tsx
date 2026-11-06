import Link from 'next/link';
import type { ReactNode } from 'react';
import { t, type PermissionCode } from '@aiec/domain';
import { ErrorPanel } from '@/components/ui';
import { can, getContext, roles } from '@/lib/context';
import { readPublicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

const NAV: { href: string; label: string; anyOf: PermissionCode[] }[] = [
  { href: '/', label: 'Home', anyOf: [] },
  { href: '/leads', label: 'Leads', anyOf: ['lead.read_all', 'lead.read_assigned'] },
  { href: '/surveys', label: 'Surveys', anyOf: ['survey.read_all', 'survey.read_assigned', 'lead.read_assigned'] },
  { href: '/admin/users', label: 'Users & roles', anyOf: ['user.read'] },
  { href: '/audit', label: 'Audit log', anyOf: ['audit.read'] },
  { href: '/notifications', label: 'Notifications', anyOf: [] },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const env = readPublicEnv();
  const result = await getContext();
  if (!result.ok) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <ErrorPanel error={result.error} />
        <form action="/auth/signout" method="post" className="mt-4">
          <button className="text-sm underline">Sign out</button>
        </form>
      </main>
    );
  }
  const { ctx } = result;
  const isDemo = env?.environment === 'demo' || ctx.memberships.some((m) => m.is_demo);
  const items = NAV.filter((n) => n.anyOf.length === 0 || n.anyOf.some((p) => can(ctx, p)));

  return (
    <div className="min-h-screen">
      {isDemo ? (
        <div className="bg-warn-700 px-4 py-1 text-center text-xs font-semibold uppercase tracking-wide text-white" role="note">
          {t('common.demo_banner')}
        </div>
      ) : null}
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="bg-navy-900 text-white md:w-60 md:shrink-0">
          <div className="px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gold-400">AIEC</p>
            <p className="text-sm font-semibold">Elevator Installation OS</p>
          </div>
          <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
            {items.map((n) => (
              <Link prefetch={false} key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-silver-200 hover:bg-navy-700 hover:text-white">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden border-t border-navy-700 px-4 py-4 text-xs text-silver-300 md:block">
            <p className="font-semibold text-white">{ctx.profile.full_name ?? 'Unnamed user'}</p>
            <p>{roles(ctx).map((r) => t(`role.${r}`)).join(', ') || 'No role assigned'}</p>
            <form action="/auth/signout" method="post" className="mt-3">
              <button className="underline">Sign out</button>
            </form>
          </div>
        </aside>
        <main className="flex-1 p-4 md:p-8">
          {ctx.profile.status !== 'active' ? (
            <div role="alert" className="mb-6 rounded-lg border border-warn-700/30 bg-warn-50 p-4 text-sm text-warn-700">
              <p className="font-semibold">{ctx.profile.status === 'suspended' ? 'Your account is suspended.' : 'Your account is pending verification.'}</p>
              <p>
                {ctx.profile.status === 'suspended'
                  ? 'All actions are blocked. Contact AIEC support if you believe this is a mistake.'
                  : 'An administrator must verify your identity and assign your role before you can work in the system.'}
              </p>
            </div>
          ) : null}
          {ctx.onboarding_missing.length > 0 ? (
            <div className="mb-6 rounded-lg border border-silver-300 bg-white p-4 text-sm">
              <p className="font-semibold">Complete your profile</p>
              <p className="text-silver-700">Missing: {ctx.onboarding_missing.join(', ').replace(/_/g, ' ')}</p>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

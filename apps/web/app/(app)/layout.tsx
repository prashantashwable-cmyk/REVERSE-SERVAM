import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PermissionCode } from '@aiec/domain';
import { LanguageSwitch } from '@/components/locale';
import { ErrorPanel } from '@/components/ui-client';
import { can, getContext, roles } from '@/lib/context';
import { readPublicEnv } from '@/lib/env';
import { getT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

const NAV: { href: string; labelKey: string; anyOf: PermissionCode[] }[] = [
  { href: '/', labelKey: 'nav.home', anyOf: [] },
  { href: '/leads', labelKey: 'nav.leads', anyOf: ['lead.read_all', 'lead.read_assigned'] },
  { href: '/surveys', labelKey: 'nav.surveys', anyOf: ['survey.read_all', 'survey.read_assigned', 'lead.read_assigned'] },
  { href: '/technical', labelKey: 'nav.technical', anyOf: ['technical.review'] },
  { href: '/quotations', labelKey: 'nav.quotations', anyOf: ['quotation.create', 'lead.read_all'] },
  { href: '/projects', labelKey: 'nav.projects', anyOf: ['project.read_all', 'project.plan', 'technical.review', 'finance.ledger.read', 'procurement.request.create', 'procurement.po.create', 'order.convert'] },
  { href: '/procurement', labelKey: 'nav.procurement', anyOf: ['procurement.request.create', 'procurement.po.create', 'procurement.grn.record', 'procurement.po.approve'] },
  { href: '/finance', labelKey: 'nav.finance', anyOf: ['finance.payment.verify', 'finance.ledger.read'] },
  { href: '/approvals', labelKey: 'nav.approvals', anyOf: ['quotation.discount.approve', 'procurement.po.approve', 'approval.exception.decide'] },
  { href: '/admin/users', labelKey: 'nav.users', anyOf: ['user.read'] },
  { href: '/audit', labelKey: 'nav.audit', anyOf: ['audit.read'] },
  { href: '/notifications', labelKey: 'nav.notifications', anyOf: [] },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const env = readPublicEnv();
  const { t } = await getT();
  const result = await getContext();
  if (!result.ok) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <ErrorPanel code={result.error.code} />
        <form action="/auth/signout" method="post" className="mt-4">
          <button className="text-sm underline">{t('nav.sign_out')}</button>
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
          <div className="flex items-start justify-between gap-2 px-4 py-4 md:block">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gold-400">AIEC</p>
              <p className="text-sm font-semibold">{t('app.subtitle')}</p>
            </div>
            <div className="md:mt-3">
              <LanguageSwitch signedIn />
            </div>
          </div>
          <nav aria-label={t('nav.main')} className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
            {items.map((n) => (
              <Link prefetch={false} key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-silver-200 hover:bg-navy-700 hover:text-white">
                {t(n.labelKey)}
              </Link>
            ))}
          </nav>
          <div className="hidden border-t border-navy-700 px-4 py-4 text-xs text-silver-300 md:block">
            <p className="font-semibold text-white">{ctx.profile.full_name ?? t('common.unnamed_user')}</p>
            <p>{roles(ctx).map((r) => t(`role.${r}`)).join(', ') || t('nav.no_role')}</p>
            <form action="/auth/signout" method="post" className="mt-3">
              <button className="underline">{t('nav.sign_out')}</button>
            </form>
          </div>
        </aside>
        <main className="flex-1 p-4 md:p-8">
          {ctx.profile.status !== 'active' ? (
            <div role="alert" className="mb-6 rounded-lg border border-warn-700/30 bg-warn-50 p-4 text-sm text-warn-700">
              <p className="font-semibold">{ctx.profile.status === 'suspended' ? t('account.suspended_title') : t('account.pending_title')}</p>
              <p>{ctx.profile.status === 'suspended' ? t('account.suspended_body') : t('account.pending_body')}</p>
            </div>
          ) : null}
          {ctx.onboarding_missing.length > 0 ? (
            <div className="mb-6 rounded-lg border border-silver-300 bg-white p-4 text-sm">
              <p className="font-semibold">{t('account.complete_profile')}</p>
              <p className="text-silver-700">
                {t('account.missing', { items: ctx.onboarding_missing.map((m) => t(`field.${m}`)).join(', ') })}
              </p>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

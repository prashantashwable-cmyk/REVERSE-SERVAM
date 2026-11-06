import { LanguageSwitch } from '@/components/locale';
import { readPublicEnv } from '@/lib/env';
import { getT } from '@/lib/i18n';
import { LoginForm } from './login-form';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('login.title') };
}
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const env = readPublicEnv();
  const { t } = await getT();
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold-600">{t('app.company')}</p>
          <LanguageSwitch signedIn={false} tone="light" />
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-navy-900">{t('login.title')}</h1>
        {env?.environment === 'demo' ? (
          <p className="mt-3 rounded-md bg-warn-50 px-3 py-2 text-sm font-semibold text-warn-700">{t('login.demo_env')}</p>
        ) : null}
        {error === 'link' ? (
          <p role="alert" className="mt-3 rounded-md bg-crit-50 px-3 py-2 text-sm text-crit-700">
            {t('login.link_invalid')}
          </p>
        ) : null}
        {env ? (
          <LoginForm supabaseUrl={env.supabaseUrl} supabaseAnonKey={env.supabaseAnonKey} next={safeNext} />
        ) : (
          <p className="mt-4 text-sm text-crit-700">{t('login.not_configured')}</p>
        )}
        <p className="mt-6 text-xs text-silver-700">{t('login.new_users_note')}</p>
      </div>
    </main>
  );
}

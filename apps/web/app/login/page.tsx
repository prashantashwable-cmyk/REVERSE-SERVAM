import { readPublicEnv } from '@/lib/env';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const env = readPublicEnv();
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-gold-600">All India Elevators Company</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy-900">Sign in</h1>
        {env?.environment === 'demo' ? (
          <p className="mt-3 rounded-md bg-warn-50 px-3 py-2 text-sm font-semibold text-warn-700">DEMO environment — synthetic data only</p>
        ) : null}
        {error === 'link' ? (
          <p role="alert" className="mt-3 rounded-md bg-crit-50 px-3 py-2 text-sm text-crit-700">
            That sign-in link is invalid or has expired. Request a new one.
          </p>
        ) : null}
        {env ? (
          <LoginForm supabaseUrl={env.supabaseUrl} supabaseAnonKey={env.supabaseAnonKey} next={safeNext} />
        ) : (
          <p className="mt-4 text-sm text-crit-700">Sign-in is unavailable: this deployment is not configured.</p>
        )}
        <p className="mt-6 text-xs text-silver-700">
          New field users sign in with their mobile number and stay in “pending verification” until AIEC or their partner company verifies them.
        </p>
      </div>
    </main>
  );
}

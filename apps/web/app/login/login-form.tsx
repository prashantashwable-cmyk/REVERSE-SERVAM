'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useMemo, useState } from 'react';
import { normalizePhone } from '@aiec/domain';
import { useT } from '@/components/locale';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';

type Mode = 'phone' | 'email';
type Step = 'enter' | 'verify' | 'email_sent';

export function LoginForm({ supabaseUrl, supabaseAnonKey, next }: { supabaseUrl: string; supabaseAnonKey: string; next: string }) {
  const supabase = useMemo(() => createBrowserClient(supabaseUrl, supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);
  const [mode, setMode] = useState<Mode>('phone');
  const [step, setStep] = useState<Step>('enter');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { t } = useT();

  const e164 = normalizePhone(phone);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (mode === 'phone') {
      if (!e164) return setMessage(t('login.err_mobile'));
      setBusy(true);
      // New mobile users are created in "pending verification" (no permissions).
      const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
      setBusy(false);
      if (error) return setMessage(t('login.err_send_code'));
      setStep('verify');
    } else {
      setBusy(true);
      // Email sign-in is for approved internal users only: never creates accounts.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      setBusy(false);
      if (error) return setMessage(t('login.err_send_link'));
      setStep('email_sent');
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!e164 || !/^\d{6}$/.test(code)) return setMessage(t('login.err_code_format'));
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
    setBusy(false);
    if (error) return setMessage(t('login.err_code_wrong'));
    // Full page load after an auth change: the server (middleware + RSC) must see the
    // new session cookie, and overlapping client transitions are avoided.
    window.location.assign(next);
  }

  return (
    <div className="mt-5">
      <div role="tablist" aria-label={t('login.method')} className="mb-4 grid grid-cols-2 gap-2">
        {(['phone', 'email'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setStep('enter');
              setMessage(null);
            }}
            className={mode === m ? buttonClass : secondaryButtonClass}
          >
            {m === 'phone' ? t('login.tab_mobile') : t('login.tab_email')}
          </button>
        ))}
      </div>

      {step === 'enter' ? (
        <form onSubmit={sendCode} className="flex flex-col gap-3" noValidate>
          {mode === 'phone' ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('login.mobile')}
              <input className={inputClass} inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" required />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('login.work_email')}
              <input className={inputClass} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
          )}
          <button className={buttonClass} disabled={busy} aria-busy={busy}>
            {busy ? t('login.sending') : mode === 'phone' ? t('login.send_code') : t('login.send_link')}
          </button>
        </form>
      ) : null}

      {step === 'verify' ? (
        <form onSubmit={verify} className="flex flex-col gap-3" noValidate>
          <p className="text-sm text-silver-700">{t('login.code_sent', { phone: e164 ?? '' })}</p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('login.code')}
            <input className={inputClass} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <button className={buttonClass} disabled={busy} aria-busy={busy}>
            {busy ? t('login.verifying') : t('login.verify')}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => setStep('enter')}>
            {t('login.different_number')}
          </button>
        </form>
      ) : null}

      {step === 'email_sent' ? <p role="status" className="rounded-md bg-ok-50 px-3 py-2 text-sm text-ok-700">{t('login.link_sent')}</p> : null}

      {message ? (
        <p role="alert" className="mt-3 rounded-md bg-crit-50 px-3 py-2 text-sm text-crit-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}

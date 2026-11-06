'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useMemo, useState } from 'react';
import { normalizePhone } from '@aiec/domain';
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

  const e164 = normalizePhone(phone);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (mode === 'phone') {
      if (!e164) return setMessage('Enter a valid mobile number, e.g. 98765 43210.');
      setBusy(true);
      // New mobile users are created in "pending verification" (no permissions).
      const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
      setBusy(false);
      if (error) return setMessage('Could not send the code. Wait a minute and try again.');
      setStep('verify');
    } else {
      setBusy(true);
      // Email sign-in is for approved internal users only: never creates accounts.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      setBusy(false);
      if (error) return setMessage('Could not send the sign-in link. Check the address or contact your administrator.');
      setStep('email_sent');
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!e164 || !/^\d{6}$/.test(code)) return setMessage('Enter the 6-digit code.');
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
    setBusy(false);
    if (error) return setMessage('That code is incorrect or expired.');
    // Full page load after an auth change: the server (middleware + RSC) must see the
    // new session cookie, and overlapping client transitions are avoided.
    window.location.assign(next);
  }

  return (
    <div className="mt-5">
      <div role="tablist" aria-label="Sign-in method" className="mb-4 grid grid-cols-2 gap-2">
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
            {m === 'phone' ? 'Mobile OTP' : 'Staff email'}
          </button>
        ))}
      </div>

      {step === 'enter' ? (
        <form onSubmit={sendCode} className="flex flex-col gap-3" noValidate>
          {mode === 'phone' ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Mobile number
              <input className={inputClass} inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" required />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Work email
              <input className={inputClass} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
          )}
          <button className={buttonClass} disabled={busy} aria-busy={busy}>
            {busy ? 'Sending…' : mode === 'phone' ? 'Send code' : 'Email me a sign-in link'}
          </button>
        </form>
      ) : null}

      {step === 'verify' ? (
        <form onSubmit={verify} className="flex flex-col gap-3" noValidate>
          <p className="text-sm text-silver-700">Code sent to {e164}.</p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            6-digit code
            <input className={inputClass} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <button className={buttonClass} disabled={busy} aria-busy={busy}>
            {busy ? 'Verifying…' : 'Verify and sign in'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => setStep('enter')}>
            Use a different number
          </button>
        </form>
      ) : null}

      {step === 'email_sent' ? <p role="status" className="rounded-md bg-ok-50 px-3 py-2 text-sm text-ok-700">If this address belongs to an approved user, a sign-in link is on its way.</p> : null}

      {message ? (
        <p role="alert" className="mt-3 rounded-md bg-crit-50 px-3 py-2 text-sm text-crit-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}

import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { normalizePhone } from '@aiec/domain';
import { supabase } from '../lib/supabase';
import { Banner, Button, Card, LabeledInput, styles } from '../ui';

export function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const e164 = normalizePhone(phone);

  async function send() {
    setMessage(null);
    if (!e164) return setMessage('Enter a valid mobile number.');
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (error) return setMessage('Could not send the code. Check your network and try again.');
    setSent(true);
  }

  async function verify() {
    if (!e164 || !/^\d{6}$/.test(code)) return setMessage('Enter the 6-digit code.');
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
    setBusy(false);
    if (error) setMessage('That code is incorrect or expired.');
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>AIEC Field</Text>
      <Text style={styles.muted}>Sign in with your registered mobile number.</Text>
      <Card>
        {!sent ? (
          <>
            <LabeledInput label="Mobile number" required value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="98765 43210" />
            <Button title="Send code" onPress={send} busy={busy} />
          </>
        ) : (
          <>
            <Text style={styles.muted}>Code sent to {e164}</Text>
            <LabeledInput label="6-digit code" required value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" />
            <Button title="Verify and sign in" onPress={verify} busy={busy} />
            <Button title="Use a different number" kind="secondary" onPress={() => setSent(false)} />
          </>
        )}
      </Card>
      {message ? <Banner tone="crit">{message}</Banner> : null}
    </ScrollView>
  );
}

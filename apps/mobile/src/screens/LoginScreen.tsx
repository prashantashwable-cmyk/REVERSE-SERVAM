import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { normalizePhone } from '@aiec/domain';
import { LanguageSwitch, useT } from '../lib/locale';
import { supabase } from '../lib/supabase';
import { Banner, Button, Card, LabeledInput, styles } from '../ui';

export function LoginScreen() {
  const { t } = useT();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const e164 = normalizePhone(phone);

  async function send() {
    setMessage(null);
    if (!e164) return setMessage(t('mobile.invalid_phone'));
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (error) return setMessage(t('mobile.send_failed'));
    setSent(true);
  }

  async function verify() {
    if (!e164 || !/^\d{6}$/.test(code)) return setMessage(t('mobile.enter_code'));
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
    setBusy(false);
    if (error) setMessage(t('mobile.code_wrong'));
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <LanguageSwitch />
      <Text style={styles.h1}>{t('mobile.app_name')}</Text>
      <Text style={styles.muted}>{t('mobile.login_intro')}</Text>
      <Card>
        {!sent ? (
          <>
            <LabeledInput label={t('mobile.mobile_number')} required value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="98765 43210" />
            <Button title={t('mobile.send_code')} onPress={send} busy={busy} />
          </>
        ) : (
          <>
            <Text style={styles.muted}>{t('mobile.code_sent', { phone: e164 ?? '' })}</Text>
            <LabeledInput label={t('mobile.code')} required value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" />
            <Button title={t('mobile.verify')} onPress={verify} busy={busy} />
            <Button title={t('mobile.different_number')} kind="secondary" onPress={() => setSent(false)} />
          </>
        )}
      </Card>
      {message ? <Banner tone="crit">{message}</Banner> : null}
    </ScrollView>
  );
}

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useT } from './lib/locale';

/** Field-first tokens: high outdoor contrast, large (glove-friendly) targets (§23, §58). */
export const colors = {
  navy: '#0f223d',
  navyLight: '#1d3a63',
  silver: '#e3e7ed',
  silverText: '#4b5563',
  gold: '#b38f3e',
  ok: '#067647',
  okBg: '#ecfdf3',
  warn: '#b54708',
  warnBg: '#fffaeb',
  crit: '#b42318',
  critBg: '#fef3f2',
  bg: '#f3f5f8',
  white: '#ffffff',
};

export function Button({ title, onPress, kind = 'primary', disabled, busy, accessibilityHint }: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  const bg = kind === 'primary' ? colors.navy : kind === 'danger' ? colors.crit : colors.white;
  const fg = kind === 'secondary' ? colors.navy : colors.white;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, kind === 'secondary' && styles.secondary]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Banner({ tone, children }: { tone: 'ok' | 'warn' | 'crit' | 'info'; children: ReactNode }) {
  const map = { ok: [colors.okBg, colors.ok], warn: [colors.warnBg, colors.warn], crit: [colors.critBg, colors.crit], info: [colors.silver, colors.navy] } as const;
  const [bg, fg] = map[tone];
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? (
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function LabeledInput({ label, required, unit, ...props }: TextInputProps & { label: string; required?: boolean; unit?: string }) {
  const { t } = useT();
  let a11y = unit ? t('mobile.input_a11y_unit', { label, unit }) : label;
  if (required) a11y = t('mobile.input_a11y_required', { label: a11y });
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: colors.crit }}>{t('mobile.required_mark')}</Text> : null}
        {unit ? <Text style={{ color: colors.silverText }}> ({unit})</Text> : null}
      </Text>
      <TextInput accessibilityLabel={a11y} style={styles.input} placeholderTextColor={colors.silverText} {...props} />
    </View>
  );
}

/** Status chip with text — never colour alone. */
export function Chip({ text, tone = 'info' }: { text: string; tone?: 'ok' | 'warn' | 'crit' | 'info' }) {
  const map = { ok: [colors.okBg, colors.ok], warn: [colors.warnBg, colors.warn], crit: [colors.critBg, colors.crit], info: [colors.silver, colors.navy] } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  h1: { fontSize: 22, fontWeight: '700', color: colors.navy },
  muted: { color: colors.silverText },
  button: { minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginVertical: 4 },
  secondary: { borderWidth: 1, borderColor: colors.navy },
  buttonText: { fontSize: 17, fontWeight: '700' },
  banner: { borderRadius: 8, padding: 12, marginBottom: 8 },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.silver },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.navy, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: '600', color: colors.navy, marginBottom: 4 },
  input: { minHeight: 52, borderWidth: 1, borderColor: '#c9d0da', borderRadius: 8, paddingHorizontal: 12, fontSize: 17, backgroundColor: colors.white, color: colors.navy },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

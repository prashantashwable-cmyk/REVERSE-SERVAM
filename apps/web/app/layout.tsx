import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { LocaleProvider } from '@/components/locale';
import { getT } from '@/lib/i18n';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
    description: t('app.description'),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f223d' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getT();
  return (
    <html lang={locale === 'mr' ? 'mr-IN' : 'en-IN'}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}

import Link from 'next/link';
import { getT } from '@/lib/i18n';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="rounded-lg border border-silver-300 bg-white p-6">
      <p className="font-semibold">{t('error.NOT_FOUND.title')}</p>
      <p className="mt-1 text-sm text-silver-700">{t('common.not_shared')}</p>
      <Link prefetch={false} href="/" className="mt-3 inline-block text-sm underline">
        {t('common.back_home')}
      </Link>
    </div>
  );
}

import { getT } from '@/lib/i18n';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('setup.title') };
}

export default async function SetupRequired() {
  const { t } = await getT();
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">{t('setup.title')}</h1>
      <p className="mt-2 text-sm text-silver-700">
        {t('setup.body')} <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (<code>apps/web/.env.example</code>)
      </p>
    </main>
  );
}

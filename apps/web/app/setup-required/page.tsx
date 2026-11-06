export const metadata = { title: 'Configuration required' };

export default function SetupRequired() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">Configuration required</h1>
      <p className="mt-2 text-sm text-silver-700">
        This deployment has no Supabase project configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see <code>apps/web/.env.example</code>) and redeploy.
      </p>
    </main>
  );
}

'use client';

/** Route error boundary: never shows stack traces or server internals to users. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-crit-700/30 bg-crit-50 p-6 text-crit-700">
      <p className="font-semibold">Something went wrong while loading this page.</p>
      <p className="mt-1 text-sm">Your saved work is safe. Try again; if it keeps happening, contact support.</p>
      <button type="button" onClick={reset} className="mt-3 text-sm font-semibold underline">
        Try again
      </button>
    </div>
  );
}

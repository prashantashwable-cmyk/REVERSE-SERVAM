export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse">
      <div className="mb-4 h-7 w-56 rounded bg-silver-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-28 rounded-lg bg-silver-200" />
        <div className="h-28 rounded-lg bg-silver-200" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

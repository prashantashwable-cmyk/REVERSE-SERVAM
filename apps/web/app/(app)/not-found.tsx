import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rounded-lg border border-silver-300 bg-white p-6">
      <p className="font-semibold">Record not found</p>
      <p className="mt-1 text-sm text-silver-700">It does not exist or is not shared with you.</p>
      <Link prefetch={false} href="/" className="mt-3 inline-block text-sm underline">Back to home</Link>
    </div>
  );
}

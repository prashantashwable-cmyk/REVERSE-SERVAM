import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-silver-700">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-silver-200 bg-white p-4 shadow-sm ${className}`}>
      {title ? <h2 className="mb-3 text-base font-semibold text-navy-800">{title}</h2> : null}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'crit' | 'gold';
const TONES: Record<Tone, string> = {
  neutral: 'bg-silver-100 text-silver-700 ring-silver-300',
  info: 'bg-navy-50 text-navy-700 ring-navy-100',
  ok: 'bg-ok-50 text-ok-700 ring-ok-700/30',
  warn: 'bg-warn-50 text-warn-700 ring-warn-700/30',
  crit: 'bg-crit-50 text-crit-700 ring-crit-700/30',
  gold: 'bg-gold-400/10 text-gold-600 ring-gold-500/40',
};

/** Status badge: always carries text, never colour alone (§23.1, §58). */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

const STATE_TONES: Record<string, Tone> = {
  new: 'info',
  assigned: 'info',
  contacted: 'info',
  qualified: 'gold',
  won: 'ok',
  lost: 'neutral',
  invalid: 'neutral',
  scheduled: 'info',
  accepted: 'info',
  in_progress: 'info',
  submitted: 'gold',
  under_review: 'gold',
  reviewed: 'ok',
  reschedule_requested: 'warn',
  revisit_requested: 'warn',
  revision_requested: 'warn',
  site_inaccessible: 'crit',
  cancelled: 'neutral',
  active: 'ok',
  pending_verification: 'warn',
  suspended: 'crit',
  // Technical review / documents / quotations (Slice 3)
  open: 'info',
  in_review: 'gold',
  clarification_requested: 'warn',
  insufficient_information: 'warn',
  feasible: 'ok',
  conditionally_feasible: 'warn',
  not_feasible: 'crit',
  draft: 'neutral',
  approved: 'ok',
  rejected: 'crit',
  superseded: 'neutral',
  pending_approval: 'warn',
  issued: 'gold',
  rejected_by_customer: 'neutral',
  expired: 'neutral',
  pending: 'warn',
  more_info: 'warn',
  withdrawn: 'neutral',
};

export function StateBadge({ state, labelText }: { state: string; labelText: string }) {
  return <Badge tone={STATE_TONES[state] ?? 'neutral'}>{labelText}</Badge>;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-silver-300 bg-silver-100/50 p-8 text-center">
      <p className="font-medium text-navy-800">{title}</p>
      {body ? <p className="mt-1 text-sm text-silver-700">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}




export const inputClass =
  'w-full rounded-md border border-silver-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/30 disabled:bg-silver-100';

export const buttonClass =
  'inline-flex min-h-10 items-center justify-center rounded-md bg-navy-800 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-navy-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center rounded-md border border-silver-300 bg-white px-4 py-2 text-sm font-semibold text-navy-800 hover:bg-silver-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500';

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-silver-700">{k}</dt>
          <dd className="font-medium text-navy-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

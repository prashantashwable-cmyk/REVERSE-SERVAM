import Link from 'next/link';
import { LEAD_STATES, fromServerError, t } from '@aiec/domain';
import { Card, EmptyState, ErrorPanel, PageHeader, PermissionDenied, StateBadge, buttonClass, inputClass } from '@/components/ui';
import { can, getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Leads' };
const PAGE_SIZE = 25;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const result = await getContext();
  if (!result.ok) return <ErrorPanel error={result.error} />;
  const { ctx } = result;
  if (!can(ctx, 'lead.read_all') && !can(ctx, 'lead.read_assigned')) return <PermissionDenied what="leads" />;

  const sp = await searchParams;
  const status = LEAD_STATES.includes(sp.status as never) ? sp.status! : null;
  const mine = sp.mine === '1';
  const overdue = sp.due === 'overdue';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const supabase = await supabaseServer();
  let query = supabase
    .from('leads')
    .select('id, lead_number, status, contact_name, project_name, builder_name, next_action_at, score, created_at, owner_user_id, sites(city, locality)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq('status', status);
  if (mine || overdue) query = query.eq('owner_user_id', ctx.user_id);
  if (overdue) query = query.in('status', ['assigned', 'contacted', 'qualified']).lt('next_action_at', new Date().toISOString());
  if (q) {
    // PostgREST `or` filter values are escaped by quoting; strip characters that would break the expression.
    const safe = q.replace(/[(),"\\]/g, ' ');
    query = query.or(`lead_number.ilike."%${safe}%",project_name.ilike."%${safe}%",contact_name.ilike."%${safe}%"`);
  }
  const { data, count, error } = await query;

  const params = (over: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const merged = { status, q: q || null, mine: mine ? '1' : null, due: overdue ? 'overdue' : null, page: null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return `/leads?${u.toString()}`;
  };
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={can(ctx, 'lead.read_all') ? 'All leads in AIEC' : 'Leads assigned to you'}
        actions={can(ctx, 'lead.create') ? <Link prefetch={false} className={buttonClass} href="/leads/new">New lead</Link> : null}
      />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" role="search">
          <label className="flex flex-col gap-1 text-sm">
            Search
            <input className={inputClass} name="q" defaultValue={q} placeholder="Lead no., project, contact" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select className={inputClass} name="status" defaultValue={status ?? ''}>
              <option value="">Any</option>
              {LEAD_STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`lead.state.${s}`)}
                </option>
              ))}
            </select>
          </label>
          {mine ? <input type="hidden" name="mine" value="1" /> : null}
          {overdue ? <input type="hidden" name="due" value="overdue" /> : null}
          <button className={buttonClass}>Apply</button>
          {overdue ? <span className="text-sm text-warn-700">Showing my overdue follow-ups</span> : null}
        </form>
      </Card>

      {error ? (
        <ErrorPanel error={fromServerError(error)} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No leads match" body="Change the filters, or create a new lead." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Leads</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Project / contact</th>
                  <th className="py-2 pr-3">Location</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Next action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((l: any) => {
                  const late = l.next_action_at && Date.parse(l.next_action_at) < Date.now() && ['assigned', 'contacted', 'qualified'].includes(l.status);
                  return (
                    <tr key={l.id} className="border-t border-silver-200">
                      <td className="py-2 pr-3 font-mono text-xs">
                        <Link prefetch={false} className="font-semibold text-navy-700 underline" href={`/leads/${l.id}`}>
                          {l.lead_number}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-medium">{l.project_name}</p>
                        <p className="text-xs text-silver-700">{l.contact_name}</p>
                      </td>
                      <td className="py-2 pr-3">{[l.sites?.locality, l.sites?.city].filter(Boolean).join(', ') || '—'}</td>
                      <td className="py-2 pr-3">
                        <StateBadge state={l.status} labelText={t(`lead.state.${l.status}`)} />
                      </td>
                      <td className="py-2 pr-3">{l.score ?? '—'}</td>
                      <td className={`py-2 pr-3 ${late ? 'font-semibold text-crit-700' : ''}`}>
                        {dt(l.next_action_at)}
                        {late ? ' (overdue)' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
            <span className="text-silver-700">
              {count ?? 0} lead{count === 1 ? '' : 's'} · page {page} of {totalPages}
            </span>
            <span className="flex gap-3">
              {page > 1 ? <Link prefetch={false} className="underline" href={params({ page: String(page - 1) })}>Previous</Link> : null}
              {page < totalPages ? <Link prefetch={false} className="underline" href={params({ page: String(page + 1) })}>Next</Link> : null}
            </span>
          </nav>
        </Card>
      )}
    </>
  );
}

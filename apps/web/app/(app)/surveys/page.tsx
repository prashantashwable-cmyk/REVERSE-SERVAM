import Link from 'next/link';
import { SURVEY_STATES, fromServerError, t } from '@aiec/domain';
import { Card, EmptyState, ErrorPanel, PageHeader, StateBadge, buttonClass, inputClass } from '@/components/ui';
import { getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Surveys' };

export default async function SurveysPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const result = await getContext();
  if (!result.ok) return <ErrorPanel error={result.error} />;
  const sp = await searchParams;
  const status = SURVEY_STATES.includes(sp.status as never) ? sp.status! : null;

  const supabase = await supabaseServer();
  let q = supabase
    .from('surveys')
    .select('id, survey_number, status, scheduled_start, gps_status, gps_exception_decision, sites(name, city, locality)')
    .order('scheduled_start', { ascending: false })
    .limit(100);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;

  return (
    <>
      <PageHeader title="Surveys" subtitle="Surveys visible to you (assigned, booked by you, or all for reviewers)." />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select name="status" defaultValue={status ?? ''} className={inputClass}>
              <option value="">Any</option>
              {SURVEY_STATES.map((s) => (
                <option key={s} value={s}>{t(`survey.state.${s}`)}</option>
              ))}
            </select>
          </label>
          <button className={buttonClass}>Apply</button>
        </form>
      </Card>
      {error ? (
        <ErrorPanel error={fromServerError(error)} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No surveys" body="Surveys appear here once booked from a qualified lead." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-2 pr-3">Survey</th>
                  <th className="py-2 pr-3">Site</th>
                  <th className="py-2 pr-3">Appointment</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Check-in</th>
                </tr>
              </thead>
              <tbody>
                {data.map((s: any) => (
                  <tr key={s.id} className="border-t border-silver-200">
                    <td className="py-2 pr-3 font-mono text-xs">
                      <Link prefetch={false} className="font-semibold text-navy-700 underline" href={`/surveys/${s.id}`}>{s.survey_number}</Link>
                    </td>
                    <td className="py-2 pr-3">{s.sites?.name} · {[s.sites?.locality, s.sites?.city].filter(Boolean).join(', ')}</td>
                    <td className="py-2 pr-3">{dt(s.scheduled_start)}</td>
                    <td className="py-2 pr-3"><StateBadge state={s.status} labelText={t(`survey.state.${s.status}`)} /></td>
                    <td className="py-2 pr-3">
                      {s.gps_status === null ? '—' : s.gps_status === 'verified' ? 'GPS verified' : `Exception: ${s.gps_status.replace(/_/g, ' ')}${s.gps_exception_decision ? ` (${s.gps_exception_decision})` : ' (review pending)'}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

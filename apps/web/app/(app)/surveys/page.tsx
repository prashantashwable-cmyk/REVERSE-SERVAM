import Link from 'next/link';
import { SURVEY_STATES, fromServerError } from '@aiec/domain';
import { Card, EmptyState, PageHeader, StateBadge, buttonClass, inputClass } from '@/components/ui';
import { ErrorPanel } from '@/components/ui-client';
import { getT } from '@/lib/i18n';
import { getContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('surveys.title') };
}

export default async function SurveysPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { t, locale } = await getT();
  const result = await getContext();
  if (!result.ok) return <ErrorPanel code={result.error.code} />;
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
      <PageHeader title={t('surveys.title')} subtitle={t('surveys.subtitle')} />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('common.status')}
            <select name="status" defaultValue={status ?? ''} className={inputClass}>
              <option value="">{t('common.any')}</option>
              {SURVEY_STATES.map((s) => (
                <option key={s} value={s}>{t(`survey.state.${s}`)}</option>
              ))}
            </select>
          </label>
          <button className={buttonClass}>{t('common.apply')}</button>
        </form>
      </Card>
      {error ? (
        <ErrorPanel code={fromServerError(error).code} />
      ) : !data || data.length === 0 ? (
        <EmptyState title={t('surveys.empty_title')} body={t('surveys.empty_body')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('surveys.title')}</caption>
              <thead className="text-xs uppercase text-silver-700">
                <tr>
                  <th className="py-2 pr-3">{t('surveys.col_survey')}</th>
                  <th className="py-2 pr-3">{t('surveys.col_site')}</th>
                  <th className="py-2 pr-3">{t('surveys.col_appointment')}</th>
                  <th className="py-2 pr-3">{t('common.status')}</th>
                  <th className="py-2 pr-3">{t('surveys.col_checkin')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((s: any) => (
                  <tr key={s.id} className="border-t border-silver-200">
                    <td className="py-2 pr-3 font-mono text-xs">
                      <Link prefetch={false} className="font-semibold text-navy-700 underline" href={`/surveys/${s.id}`}>{s.survey_number}</Link>
                    </td>
                    <td className="py-2 pr-3">{s.sites?.name} · {[s.sites?.locality, s.sites?.city].filter(Boolean).join(', ')}</td>
                    <td className="py-2 pr-3">{dt(s.scheduled_start, locale)}</td>
                    <td className="py-2 pr-3"><StateBadge state={s.status} labelText={t(`survey.state.${s.status}`)} /></td>
                    <td className="py-2 pr-3">
                      {s.gps_status === null
                        ? '—'
                        : s.gps_status === 'verified'
                          ? t('surveys.gps_verified')
                          : `${t('surveys.gps_exception', { status: t(`enum.gps.${s.gps_status}`) })} (${s.gps_exception_decision ? t(`enum.gps_decision.${s.gps_exception_decision}`) : t('surveys.review_pending')})`}
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

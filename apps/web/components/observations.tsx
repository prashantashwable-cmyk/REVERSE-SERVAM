import { hasMessage } from '@aiec/domain';

/** Survey observations as labelled sections (never raw JSON), in the viewer's language. */
export function Observations({ data, t }: { data: Record<string, unknown>; t: (key: string, params?: Record<string, string | number>) => string }) {
  const label = (key: string, fallback: string) => (hasMessage(key) ? t(key) : fallback.replace(/_/g, ' '));
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const sections = Object.entries(data).filter(([k]) => k !== 'documents_unavailable' && k !== 'critical_unknowns');
  const docs = Object.entries((data.documents_unavailable as Record<string, string> | undefined) ?? {});
  const unknowns = (data.critical_unknowns as string[] | undefined) ?? [];
  if (sections.length === 0 && docs.length === 0 && unknowns.length === 0) return <p className="text-sm text-silver-700">{t('survey.no_observations')}</p>;
  return (
    <div className="mt-1 grid grid-cols-1 gap-3 md:grid-cols-2">
      {sections.map(([section, fields]) => (
        <div key={section} className="rounded bg-silver-100 p-3 text-sm">
          <p className="font-semibold">{label(`survey.section.${section}`, section)}</p>
          {fields && typeof fields === 'object' && !Array.isArray(fields) ? (
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {Object.entries(fields as Record<string, unknown>).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-silver-700">{label(`field.${section}.${k}`, k)}</dt>
                  <dd>{show(v)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{show(fields)}</p>
          )}
        </div>
      ))}
      {docs.length > 0 ? (
        <div className="rounded bg-silver-100 p-3 text-sm">
          <p className="font-semibold">{t('survey.documents_unavailable')}</p>
          <ul className="mt-1">
            {docs.map(([doc, reason]) => (
              <li key={doc}>
                {label(`enum.evidence.${doc}`, doc)}: {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unknowns.length > 0 ? (
        <div className="rounded bg-silver-100 p-3 text-sm">
          <p className="font-semibold">{t('survey.critical_unknowns')}</p>
          <p>{unknowns.join(', ')}</p>
        </div>
      ) : null}
    </div>
  );
}

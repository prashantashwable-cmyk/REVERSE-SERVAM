import { randomUUID } from 'node:crypto';
import { DEFAULT_HANDOVER_DOCUMENTS, DEFAULT_STATUTORY_REQUIRED } from '@aiec/domain';
import type { Locale } from '@aiec/domain';
import { Badge, Card, KeyValue, StateBadge } from '@/components/ui';
import { can, type UserContext } from '@/lib/context';
import { dt } from '@/lib/format';
import { staffNames } from '@/lib/people';
import { supabaseServer } from '@/lib/supabase/server';
import { HandoverActionButton, HandoverDocumentForm, LinkCustomerForm, QualityActionButton, StatutoryDecisionForm, StatutoryUploadForm } from '../quality-forms';

type T = (key: string, params?: Record<string, string | number>) => string;
const QA_STAGES = ['installation', 'final_qa', 'statutory_pending', 'handover_ready', 'handed_over', 'closed'];

/** QA results, statutory evidence (Gate 12), handover package and customer (Gate 13), lift asset and warranty (Gate 14), close. */
export async function QualitySection({ project, ctx, t, locale }: { project: any; ctx: UserContext; t: T; locale: Locale }) {
  if (!QA_STAGES.includes(project.status)) return null;
  const supabase = await supabaseServer();
  const pid = project.id as string;
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [{ data: tasks }, { data: defects }, { data: evidence }, { data: docs }, { data: handover }, { data: asset }, { data: customers }, { data: inspections }] = await Promise.all([
    supabase.from('project_tasks').select('code, status').eq('project_id', pid),
    supabase.from('defects').select('id, defect_number, status, severity, location, criterion_key').eq('project_id', pid).order('raised_at'),
    supabase.from('statutory_evidence').select('*').eq('project_id', pid).order('recorded_at'),
    supabase.from('handover_documents').select('*').eq('project_id', pid).order('uploaded_at'),
    supabase.from('handovers').select('*').eq('project_id', pid).maybeSingle(),
    supabase.from('lift_assets').select('*').eq('project_id', pid).maybeSingle(),
    supabase.from('organizations').select('id, name').eq('kind', 'customer').eq('status', 'active').order('name'),
    supabase.from('qa_inspections').select('id, kind, outcome, inspected_at').eq('project_id', pid).order('inspected_at', { ascending: false }),
  ]);
  const files = [...(evidence ?? []).map((e: any) => e.storage_path), ...(docs ?? []).map((d: any) => d.storage_path)];
  const { data: urls } = files.length ? await supabase.storage.from('handover-documents').createSignedUrls(files, 300) : { data: [] as any[] };
  const url = new Map((urls ?? []).map((u: any) => [u.path, u.signedUrl]));
  const names = await staffNames((evidence ?? []).flatMap((e: any) => [e.recorded_by, e.verified_by]));
  const notApproved = (tasks ?? []).filter((x: any) => !['approved', 'closed'].includes(x.status));
  const openDefects = (defects ?? []).filter((d: any) => !['verified', 'closed'].includes(d.status));
  const verifiedTypes = (evidence ?? []).filter((e: any) => e.verification === 'verified').map((e: any) => e.evidence_type);
  const missingStatutory = DEFAULT_STATUTORY_REQUIRED.filter((x) => !verifiedTypes.includes(x));
  const docTypes = new Set((docs ?? []).map((d: any) => d.doc_type));
  const missingDocs = DEFAULT_HANDOVER_DOCUMENTS.filter((x) => !docTypes.has(x));
  const finalQa = (inspections ?? []).find((i: any) => i.kind === 'final');
  const customerName = (customers ?? []).find((c: any) => c.id === project.customer_org_id)?.name;
  const hoStatus = handover?.status ?? 'not_ready';
  const plan = can(ctx, 'project.plan');

  return (
    <>
      <Card title={t('handover.quality_title')} className="mt-4">
        <KeyValue
          items={[
            [t('handover.tasks_approved'), t('handover.tasks_approved_value', { done: (tasks ?? []).length - notApproved.length, total: (tasks ?? []).length })],
            [t('handover.open_defects'), String(openDefects.length)],
            [t('handover.final_qa'), finalQa ? t(`qa.outcome.${finalQa.outcome}`) : t('handover.not_done')],
          ]}
        />
        {openDefects.length > 0 ? (
          <ul className="mt-2 text-sm">
            {openDefects.map((d: any) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 border-t border-silver-200 py-1">
                <span className="font-mono text-xs">{d.defect_number}</span>
                <StateBadge state={d.status} labelText={t(`qa.defect_state.${d.status}`)} />
                <Badge tone={d.severity === 'critical' ? 'crit' : 'warn'}>{t(`enum.defect_severity.${d.severity}`)}</Badge>
                <span className="text-silver-700">{t(`qa.criterion.${d.criterion_key}`)} · {d.location}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {plan && project.status === 'installation' ? (
          <div className="mt-4 border-t border-silver-200 pt-4">
            <p className="mb-2 text-sm text-silver-700">{notApproved.length ? t('handover.final_qa_wait', { list: notApproved.map((x: any) => t(`work.task.${x.code}`)).join(', ') }) : t('handover.final_qa_ready')}</p>
            <QualityActionButton projectId={pid} version={project.version} action="submit_final_qa" />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-silver-700">{t('handover.qa_not_statutory')}</p>
      </Card>

      {['final_qa', 'statutory_pending', 'handover_ready', 'handed_over', 'closed'].includes(project.status) ? (
        <Card title={t('handover.statutory_title')} className="mt-4">
          <p className="mb-3 text-sm text-silver-700">{t('handover.statutory_intro', { list: DEFAULT_STATUTORY_REQUIRED.map((x) => t(`enum.statutory.${x}`)).join(', ') })}</p>
          {(evidence ?? []).length > 0 ? (
            <ul className="mb-3 flex flex-col gap-2 text-sm">
              {(evidence ?? []).map((e: any) => (
                <li key={e.id} className="rounded-md border border-silver-200 p-2">
                  <p className="flex flex-wrap items-center gap-2">
                    {url.get(e.storage_path) ? <a href={url.get(e.storage_path)} target="_blank" rel="noreferrer" className="font-semibold underline">{t(`enum.statutory.${e.evidence_type}`)}</a> : <span className="font-semibold">{t(`enum.statutory.${e.evidence_type}`)}</span>}
                    <StateBadge state={e.verification} labelText={t(`partners.verification.${e.verification}`)} />
                  </p>
                  <p className="text-silver-700">{t('handover.statutory_line', { authority: e.authority, reference: e.reference_number, issued: e.issued_on, until: e.valid_until ?? t('partners.no_expiry') })}</p>
                  <p className="text-xs text-silver-700">{t('handover.recorded_verified', { recorder: names.get(e.recorded_by) ?? '—', verifier: e.verified_by ? names.get(e.verified_by) ?? '—' : '—' })}{e.rejection_reason ? ` · ${e.rejection_reason}` : ''}</p>
                  {e.verification === 'pending' && can(ctx, 'approval.exception.decide') && e.recorded_by !== ctx.user_id ? <div className="mt-2"><StatutoryDecisionForm evidenceId={e.id} /></div> : null}
                  {e.verification === 'pending' && e.recorded_by === ctx.user_id ? <p className="text-xs text-warn-700">{t('handover.second_person')}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {plan && ['final_qa', 'statutory_pending'].includes(project.status) ? (
            <details open={(evidence ?? []).length === 0}>
              <summary className="cursor-pointer text-sm font-semibold">{t('handover.record_statutory')}</summary>
              <div className="mt-3"><StatutoryUploadForm projectId={pid} organizationId={project.organization_id} operationId={randomUUID()} today={today} /></div>
            </details>
          ) : null}
          {plan && project.status === 'statutory_pending' ? (
            <div className="mt-4 border-t border-silver-200 pt-4">
              <p className="mb-2 text-sm text-silver-700">{missingStatutory.length ? t('handover.statutory_missing', { list: missingStatutory.map((x) => t(`enum.statutory.${x}`)).join(', ') }) : t('handover.statutory_complete')}</p>
              <QualityActionButton projectId={pid} version={project.version} action="record_statutory_clearance" />
            </div>
          ) : null}
        </Card>
      ) : null}

      {['final_qa', 'statutory_pending', 'handover_ready', 'handed_over', 'closed'].includes(project.status) ? (
        <Card title={t('handover.package_title')} className="mt-4">
          <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span>{t('handover.handover_status')}</span>
            <StateBadge state={hoStatus} labelText={t(`handover.state.${hoStatus}`)} />
            {handover?.acceptor_name ? <span className="text-silver-700">{t('handover.decided_by', { name: handover.acceptor_name, date: dt(handover.decided_at, locale) })}</span> : null}
          </p>
          {handover?.status === 'issues_raised' && handover.issues ? <p className="mb-2 text-sm text-warn-700">{t('handover.customer_issues', { issues: handover.issues })}</p> : null}
          <ul className="mb-3 grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
            {DEFAULT_HANDOVER_DOCUMENTS.map((x) => {
              const latest = [...(docs ?? [])].reverse().find((d: any) => d.doc_type === x);
              return (
                <li key={x} className="flex flex-wrap items-center gap-2">
                  {latest ? <Badge tone="ok">{t('handover.present')}</Badge> : <Badge tone="warn">{t('handover.missing')}</Badge>}
                  {latest && url.get(latest.storage_path) ? <a href={url.get(latest.storage_path)} target="_blank" rel="noreferrer" className="underline">{t(`enum.handover_document.${x}`)}</a> : <span>{t(`enum.handover_document.${x}`)}</span>}
                </li>
              );
            })}
          </ul>
          {plan && ['final_qa', 'statutory_pending', 'handover_ready'].includes(project.status) && !['ready', 'accepted'].includes(hoStatus) ? (
            <details open={missingDocs.length > 0}>
              <summary className="cursor-pointer text-sm font-semibold">{t('handover.add_document')}</summary>
              <div className="mt-3"><HandoverDocumentForm projectId={pid} organizationId={project.organization_id} operationId={randomUUID()} /></div>
            </details>
          ) : null}
          <p className="mt-3 text-sm">{t('handover.customer')}: {customerName ?? t('handover.no_customer')}</p>
          {plan && !project.customer_org_id && (customers ?? []).length > 0 ? (
            <div className="mt-2"><LinkCustomerForm projectId={pid} version={project.version} customers={(customers ?? []).map((c: any) => ({ id: c.id, label: c.name }))} /></div>
          ) : null}
          {plan && project.status === 'handover_ready' && hoStatus === 'not_ready' ? (
            <div className="mt-4 border-t border-silver-200 pt-4">
              <p className="mb-2 text-sm text-silver-700">{missingDocs.length ? t('handover.docs_missing', { list: missingDocs.map((x) => t(`enum.handover_document.${x}`)).join(', ') }) : t('handover.send_hint')}</p>
              <HandoverActionButton projectId={pid} action="confirm_ready" />
            </div>
          ) : null}
          {plan && hoStatus === 'issues_raised' ? <div className="mt-4 border-t border-silver-200 pt-4"><HandoverActionButton projectId={pid} action="recheck" /></div> : null}
        </Card>
      ) : null}

      {asset ? (
        <Card title={t('handover.asset_title')} className="mt-4">
          <KeyValue
            items={[
              [t('handover.asset_number'), <span key="a" className="font-mono">{asset.asset_number}</span>],
              [t('handover.equipment'), [asset.manufacturer, asset.model].filter(Boolean).join(' ') || '—'],
              [t('handover.warranty_status'), t(`handover.warranty_state.${asset.warranty_status}`)],
              [t('handover.warranty_period'), asset.warranty_start ? t('procurement.delivery_range', { from: asset.warranty_start, to: asset.warranty_end }) : '—'],
              [t('handover.warranty_source'), t('handover.warranty_source_value', { event: t(`enum.warranty_event.${asset.warranty_start_event}`), date: asset.warranty_source_date ?? '—' })],
            ]}
          />
          {plan && project.status === 'handed_over' ? <div className="mt-4 border-t border-silver-200 pt-4"><QualityActionButton projectId={pid} version={project.version} action="close" /></div> : null}
        </Card>
      ) : null}
    </>
  );
}

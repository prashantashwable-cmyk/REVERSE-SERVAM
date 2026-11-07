'use client';

import { useActionState, useState } from 'react';
import { LIFT_CATEGORY_SCOPES, PARTNER_DOCUMENT_TYPES, PARTNER_ENTITY_TYPES, WORKER_SKILLS } from '@aiec/domain';
import { ActionForm } from '@/components/action-form';
import { FormStatus, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import {
  assignTaskAction,
  dailyReportAction,
  respondInvitationAction,
  saveProfileAction,
  setWorkerAction,
  submitProfileAction,
  teamMemberAction,
  unblockTaskAction,
  uploadPartnerDocumentAction,
} from './actions';

export type ProfileValues = {
  legal_name: string; entity_type: string; registered_address: string; operating_address: string; authorized_representative: string;
  contact_phone: string; contact_email: string; gst_number: string; service_areas: string[]; lift_categories: string[];
  team_size: string; experience_years: string; safety_policy_accepted: boolean; compliance_declaration: boolean;
};

/** LP02 company profile (editable while draft). */
export function ProfileForm({ orgId, version, values }: { orgId: string; version: number | null; values: ProfileValues }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={saveProfileAction} hidden={{ org_id: orgId, version: version ?? undefined }} submitLabel={t('partner.save_profile')} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={f('legal_name')} htmlFor="legal_name" required><input id="legal_name" name="legal_name" defaultValue={values.legal_name} className={inputClass} /></Field>
      <Field label={f('entity_type')} htmlFor="entity_type" required>
        <select id="entity_type" name="entity_type" defaultValue={values.entity_type} className={inputClass}>
          <option value="">{t('common.choose')}</option>
          {PARTNER_ENTITY_TYPES.map((e) => <option key={e} value={e}>{t(`enum.entity_type.${e}`)}</option>)}
        </select>
      </Field>
      <div className="md:col-span-2"><Field label={f('registered_address')} htmlFor="registered_address" required><input id="registered_address" name="registered_address" defaultValue={values.registered_address} className={inputClass} /></Field></div>
      <div className="md:col-span-2"><Field label={f('operating_address')} htmlFor="operating_address"><input id="operating_address" name="operating_address" defaultValue={values.operating_address} className={inputClass} /></Field></div>
      <Field label={f('authorized_representative')} htmlFor="authorized_representative" required><input id="authorized_representative" name="authorized_representative" defaultValue={values.authorized_representative} className={inputClass} /></Field>
      <Field label={f('contact_phone')} htmlFor="contact_phone" required><input id="contact_phone" name="contact_phone" inputMode="tel" defaultValue={values.contact_phone} className={inputClass} /></Field>
      <Field label={f('contact_email')} htmlFor="contact_email"><input id="contact_email" name="contact_email" type="email" defaultValue={values.contact_email} className={inputClass} /></Field>
      <Field label={f('gst_number')} htmlFor="gst_number"><input id="gst_number" name="gst_number" defaultValue={values.gst_number} className={inputClass} /></Field>
      <Field label={f('service_areas')} htmlFor="service_areas" required hint={t('partner.one_per_line')}><textarea id="service_areas" name="service_areas" rows={2} defaultValue={values.service_areas.join('\n')} className={inputClass} /></Field>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="font-medium">{f('lift_categories')} <span className="text-crit-700">*</span></legend>
        {LIFT_CATEGORY_SCOPES.map((c) => (
          <label key={c} className="flex items-center gap-2"><input type="checkbox" name="lift_categories" value={c} defaultChecked={values.lift_categories.includes(c)} className="h-5 w-5" /> {t(`enum.lift_category.${c}`)}</label>
        ))}
      </fieldset>
      <Field label={f('team_size')} htmlFor="team_size" required><input id="team_size" name="team_size" inputMode="numeric" defaultValue={values.team_size} className={inputClass} /></Field>
      <Field label={f('experience_years')} htmlFor="experience_years"><input id="experience_years" name="experience_years" inputMode="numeric" defaultValue={values.experience_years} className={inputClass} /></Field>
      <label className="flex items-start gap-2 text-sm md:col-span-2"><input type="checkbox" name="safety_policy_accepted" defaultChecked={values.safety_policy_accepted} className="mt-1 h-5 w-5" /> {t('partner.safety_policy_text')}</label>
      <label className="flex items-start gap-2 text-sm md:col-span-2"><input type="checkbox" name="compliance_declaration" defaultChecked={values.compliance_declaration} className="mt-1 h-5 w-5" /> {t('partner.compliance_declaration_text')}</label>
    </ActionForm>
  );
}

export function SubmitProfileButton({ orgId, version }: { orgId: string; version: number }) {
  const { t } = useT();
  return <ActionForm action={submitProfileAction} hidden={{ org_id: orgId, version }} submitLabel={t('partner.submit_profile')} />;
}

/** LP03: upload one compliance document with its number, issuer, dates and scope. */
export function DocumentUploadForm({ orgId, operationId }: { orgId: string; operationId: string }) {
  const { t, field: f } = useT();
  const [type, setType] = useState<string>(PARTNER_DOCUMENT_TYPES[0]);
  return (
    <ActionForm action={uploadPartnerDocumentAction} hidden={{ org_id: orgId, operation_id: operationId }} formKey={operationId} submitLabel={t('partner.upload_document')} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Field label={f('doc_type')} htmlFor="doc_type" required>
        <select id="doc_type" name="doc_type" value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
          {PARTNER_DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{t(`enum.partner_document.${d}`)}</option>)}
        </select>
      </Field>
      <Field label={f('doc_number')} htmlFor="doc_number" required><input id="doc_number" name="doc_number" className={inputClass} /></Field>
      <Field label={f('issuer')} htmlFor="issuer" required><input id="issuer" name="issuer" className={inputClass} /></Field>
      <Field label={f('issued_on')} htmlFor="issued_on"><input id="issued_on" name="issued_on" type="date" className={inputClass} /></Field>
      <Field label={f('expires_on')} htmlFor="expires_on" required={type === 'contractor_licence' || type === 'insurance'}><input id="expires_on" name="expires_on" type="date" className={inputClass} /></Field>
      <Field label={f('file')} htmlFor="doc_file" required hint={t('partner.file_hint')}><input id="doc_file" name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={inputClass} /></Field>
      {type === 'contractor_licence' ? (
        <fieldset className="flex flex-wrap gap-3 text-sm md:col-span-3">
          <legend className="font-medium">{f('scope')} <span className="text-crit-700">*</span></legend>
          {LIFT_CATEGORY_SCOPES.map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" name="scope" value={c} className="h-5 w-5" /> {t(`enum.lift_category.${c}`)}</label>)}
        </fieldset>
      ) : null}
    </ActionForm>
  );
}

/** LP04: accept the exact displayed revision, or decline / ask (reason required). */
export function InvitationResponseForm({ assignmentId, version, offerSha256, canAccept }: { assignmentId: string; version: number; offerSha256: string; canAccept: boolean }) {
  const [state, run] = useActionState(respondInvitationAction, IDLE);
  useRefreshOnSuccess(state);
  const { t, field: f } = useT();
  return (
    <form action={run} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="offer_sha256" value={offerSha256} />
      <Field label={f('reason')} htmlFor="inv_reason" hint={t('partner.reason_hint')}><input id="inv_reason" name="reason" className={inputClass} /></Field>
      <div className="flex flex-wrap gap-2">
        {canAccept ? <button type="submit" name="action" value="accept" className={buttonClass}>{t('partner.accept_invitation')}</button> : null}
        {canAccept ? <button type="submit" name="action" value="request_clarification" className={secondaryButtonClass}>{t('action.request_clarification')}</button> : null}
        <button type="submit" name="action" value="decline" className={secondaryButtonClass}>{t('action.decline')}</button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

export function WorkerForm({ orgId, userId, skills, trainingNote }: { orgId: string; userId: string; skills: string[]; trainingNote: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={setWorkerAction} hidden={{ org_id: orgId, user_id: userId }} submitLabel={t('partner.save_worker')} secondary className="flex flex-col gap-2">
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="font-medium">{f('skills')}</legend>
        {WORKER_SKILLS.map((s) => <label key={s} className="flex items-center gap-2"><input type="checkbox" name="skills" value={s} defaultChecked={skills.includes(s)} className="h-5 w-5" /> {t(`enum.skill.${s}`)}</label>)}
      </fieldset>
      <Field label={f('training_note')} htmlFor={`tn_${userId}`}><input id={`tn_${userId}`} name="training_note" defaultValue={trainingNote} className={inputClass} /></Field>
    </ActionForm>
  );
}

export function AddTeamMemberForm({ assignmentId, people }: { assignmentId: string; people: { id: string; label: string }[] }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={teamMemberAction} hidden={{ assignment_id: assignmentId, action: 'add' }} submitLabel={t('partner.add_member')} secondary className="flex flex-col gap-2">
      <Field label={f('user_id')} htmlFor="team_user" required>
        <select id="team_user" name="user_id" className={inputClass}>{people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </Field>
    </ActionForm>
  );
}

export function RemoveTeamMemberForm({ assignmentId, userId }: { assignmentId: string; userId: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={teamMemberAction} hidden={{ assignment_id: assignmentId, action: 'remove', user_id: userId }} submitLabel={t('partner.remove_member')} secondary className="flex flex-col gap-2">
      <Field label={f('reason')} htmlFor={`rm_${userId}`} required><input id={`rm_${userId}`} name="reason" className={inputClass} /></Field>
    </ActionForm>
  );
}

export function AssignTaskForm({ taskId, version, people, minDate }: { taskId: string; version: number; people: { id: string; label: string }[]; minDate: string }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={assignTaskAction} hidden={{ task_id: taskId, version }} submitLabel={t('partner.assign_task')} secondary className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <Field label={f('task_assignee_id')} htmlFor={`as_${taskId}`} required>
        <select id={`as_${taskId}`} name="assignee_id" className={inputClass}>{people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </Field>
      <Field label={f('due_date')} htmlFor={`due_${taskId}`}><input id={`due_${taskId}`} name="due_date" type="date" min={minDate} className={inputClass} /></Field>
    </ActionForm>
  );
}

export function UnblockTaskForm({ taskId, version }: { taskId: string; version: number }) {
  const { t, field: f } = useT();
  return (
    <ActionForm action={unblockTaskAction} hidden={{ task_id: taskId, version }} submitLabel={t('action.unblock')} secondary className="flex flex-col gap-2">
      <Field label={f('reason')} htmlFor={`ub_${taskId}`} required><input id={`ub_${taskId}`} name="reason" className={inputClass} /></Field>
    </ActionForm>
  );
}

/** LP08 daily work report. */
export function DailyReportForm({ assignmentId, operationId, team, today }: { assignmentId: string; operationId: string; team: { id: string; label: string }[]; today: string }) {
  const { t, field: f } = useT();
  const [incident, setIncident] = useState('');
  return (
    <ActionForm action={dailyReportAction} hidden={{ assignment_id: assignmentId, operation_id: operationId }} formKey={operationId} submitLabel={t('partner.submit_report')} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={f('report_date')} htmlFor="report_date" required><input id="report_date" name="report_date" type="date" max={today} defaultValue={today} className={inputClass} /></Field>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="font-medium">{f('present_user_ids')} <span className="text-crit-700">*</span></legend>
        {team.map((m) => <label key={m.id} className="flex items-center gap-2"><input type="checkbox" name="present" value={m.id} className="h-5 w-5" /> {m.label}</label>)}
      </fieldset>
      <div className="md:col-span-2"><Field label={f('work_completed')} htmlFor="work_completed" required><textarea id="work_completed" name="work_completed" rows={2} className={inputClass} /></Field></div>
      <Field label={f('work_not_completed')} htmlFor="work_not_completed"><input id="work_not_completed" name="work_not_completed" className={inputClass} /></Field>
      <Field label={f('blockers')} htmlFor="dr_blockers"><input id="dr_blockers" name="blockers" className={inputClass} /></Field>
      <Field label={f('material_used')} htmlFor="material_used"><input id="material_used" name="material_used" className={inputClass} /></Field>
      <Field label={f('material_shortage')} htmlFor="material_shortage"><input id="material_shortage" name="material_shortage" className={inputClass} /></Field>
      <Field label={f('incident_declared')} htmlFor="incident_declared" required hint={t('partner.incident_hint')}>
        <select id="incident_declared" name="incident_declared" value={incident} onChange={(e) => setIncident(e.target.value)} className={inputClass}>
          <option value="">{t('common.choose')}</option>
          <option value="no">{t('partner.no_incident')}</option>
          <option value="yes">{t('partner.incident_yes')}</option>
        </select>
      </Field>
      <Field label={f('safety_observations')} htmlFor="safety_observations" required={incident === 'yes'}><input id="safety_observations" name="safety_observations" className={inputClass} /></Field>
      <div className="md:col-span-2"><Field label={f('next_day_plan')} htmlFor="next_day_plan" required><input id="next_day_plan" name="next_day_plan" className={inputClass} /></Field></div>
    </ActionForm>
  );
}

'use client';

import { useActionState } from 'react';
import { ROLE_CODES, ROLE_ORG_KINDS } from '@aiec/domain';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from '@/components/forms';
import { useT } from '@/components/locale';
import { inputClass, secondaryButtonClass } from '@/components/ui';
import { Field } from '@/components/ui-client';
import { IDLE } from '@/lib/actions';
import { createOrganizationAction, grantRoleAction, revokeRoleAction, setStatusAction } from './actions';

export interface OrgOption {
  id: string;
  name: string;
  kind: string;
}

export function GrantRoleForm({ userId, orgs }: { userId: string; orgs: OrgOption[] }) {
  const [state, action] = useActionState(grantRoleAction, IDLE);
  const { t } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-2 md:grid-cols-4" noValidate>
      <input type="hidden" name="user_id" value={userId} />
      <Field label={t('field.organization_id')} htmlFor={`org-${userId}`} required>
        <select id={`org-${userId}`} name="organization_id" className={inputClass} defaultValue="">
          <option value="" disabled>{t('common.select')}</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{t('admin.org_option', { name: o.name, kind: t(`enum.org_kind.${o.kind}`) })}</option>
          ))}
        </select>
      </Field>
      <Field label={t('field.role_code')} htmlFor={`role-${userId}`} required hint={t('admin.role_hint')}>
        <select id={`role-${userId}`} name="role_code" className={inputClass} defaultValue="">
          <option value="" disabled>{t('common.select')}</option>
          {ROLE_CODES.map((r) => (
            <option key={r} value={r}>{t(`role.${r}`)} — {ROLE_ORG_KINDS[r].map((k) => t(`enum.org_kind.${k}`)).join(' / ')}</option>
          ))}
        </select>
      </Field>
      <Field label={t('field.reason')} htmlFor={`reason-${userId}`} required>
        <input id={`reason-${userId}`} name="reason" className={inputClass} />
      </Field>
      <div className="flex flex-col justify-end gap-2">
        <SubmitButton>{t('admin.grant')}</SubmitButton>
      </div>
      <div className="md:col-span-4"><FormStatus state={state} /></div>
    </form>
  );
}

export function RevokeRoleForm({ userRoleId, label }: { userRoleId: string; label: string }) {
  const [state, action] = useActionState(revokeRoleAction, IDLE);
  const { t } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="user_role_id" value={userRoleId} />
      <label className="flex flex-col text-xs">
        <span className="sr-only">{t('admin.revoke_reason', { role: label })}</span>
        <input name="reason" placeholder={t('admin.revoke_reason', { role: label })} className={`${inputClass} text-xs`} />
      </label>
      <SubmitButton className={secondaryButtonClass}>{t('admin.revoke')}</SubmitButton>
      <FormStatus state={state} />
    </form>
  );
}

export function StatusForm({ userId, current }: { userId: string; current: string }) {
  const [state, action] = useActionState(setStatusAction, IDLE);
  const { t } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="user_id" value={userId} />
      <label className="flex flex-col gap-1 text-xs">
        {t('field.status')}
        <select name="status" defaultValue={current} className={`${inputClass} text-xs`}>
          <option value="active">{t('enum.user_status.active')}</option>
          <option value="pending_verification">{t('enum.user_status.pending_verification')}</option>
          <option value="suspended">{t('enum.user_status.suspended')}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {t('field.reason')}
        <input name="reason" className={`${inputClass} text-xs`} />
      </label>
      <SubmitButton className={secondaryButtonClass}>{t('admin.update')}</SubmitButton>
      <FormStatus state={state} />
    </form>
  );
}

export function CreateOrganizationForm() {
  const [state, action] = useActionState(createOrganizationAction, IDLE);
  const { t } = useT();
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-3" noValidate>
      <Field label={t('field.kind')} htmlFor="org_kind" required>
        <select id="org_kind" name="kind" className={inputClass} defaultValue="partner">
          {['partner', 'customer', 'supplier', 'qa_agency'].map((k) => (
            <option key={k} value={k}>{t(`enum.org_kind.${k}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('field.name')} htmlFor="org_name" required>
        <input id="org_name" name="name" className={inputClass} />
      </Field>
      <Field label={t('field.legal_name')} htmlFor="org_legal_name">
        <input id="org_legal_name" name="legal_name" className={inputClass} />
      </Field>
      <Field label={t('field.city')} htmlFor="org_city">
        <input id="org_city" name="city" className={inputClass} />
      </Field>
      <Field label={t('field.reason')} htmlFor="org_reason" required>
        <input id="org_reason" name="reason" className={inputClass} />
      </Field>
      <div className="flex items-end"><SubmitButton>{t('admin.create_org')}</SubmitButton></div>
      <div className="md:col-span-3"><FormStatus state={state} /></div>
    </form>
  );
}

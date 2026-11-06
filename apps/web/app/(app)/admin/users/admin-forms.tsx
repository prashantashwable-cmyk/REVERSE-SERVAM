'use client';

import { useActionState } from 'react';
import { ROLE_CODES, ROLE_ORG_KINDS, t } from '@aiec/domain';
import { FormStatus, SubmitButton, useRefreshOnSuccess } from '@/components/forms';
import { Field, inputClass, secondaryButtonClass } from '@/components/ui';
import { IDLE } from '@/lib/actions';
import { createOrganizationAction, grantRoleAction, revokeRoleAction, setStatusAction } from './actions';

export interface OrgOption {
  id: string;
  name: string;
  kind: string;
}

export function GrantRoleForm({ userId, orgs }: { userId: string; orgs: OrgOption[] }) {
  const [state, action] = useActionState(grantRoleAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-2 md:grid-cols-4" noValidate>
      <input type="hidden" name="user_id" value={userId} />
      <Field label="Organization" htmlFor={`org-${userId}`} required>
        <select id={`org-${userId}`} name="organization_id" className={inputClass} defaultValue="">
          <option value="" disabled>Select…</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name} ({o.kind})</option>
          ))}
        </select>
      </Field>
      <Field label="Role" htmlFor={`role-${userId}`} required hint="Must suit the organization type.">
        <select id={`role-${userId}`} name="role_code" className={inputClass} defaultValue="">
          <option value="" disabled>Select…</option>
          {ROLE_CODES.map((r) => (
            <option key={r} value={r}>{t(`role.${r}`)} — {ROLE_ORG_KINDS[r].join('/')}</option>
          ))}
        </select>
      </Field>
      <Field label="Reason" htmlFor={`reason-${userId}`} required>
        <input id={`reason-${userId}`} name="reason" className={inputClass} />
      </Field>
      <div className="flex flex-col justify-end gap-2">
        <SubmitButton>Grant role</SubmitButton>
      </div>
      <div className="md:col-span-4"><FormStatus state={state} /></div>
    </form>
  );
}

export function RevokeRoleForm({ userRoleId, label }: { userRoleId: string; label: string }) {
  const [state, action] = useActionState(revokeRoleAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="user_role_id" value={userRoleId} />
      <label className="flex flex-col text-xs">
        <span className="sr-only">Reason to revoke {label}</span>
        <input name="reason" placeholder={`Reason to revoke ${label}`} className={`${inputClass} text-xs`} />
      </label>
      <SubmitButton className={secondaryButtonClass}>Revoke</SubmitButton>
      <FormStatus state={state} />
    </form>
  );
}

export function StatusForm({ userId, current }: { userId: string; current: string }) {
  const [state, action] = useActionState(setStatusAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="user_id" value={userId} />
      <label className="flex flex-col gap-1 text-xs">
        Status
        <select name="status" defaultValue={current} className={`${inputClass} text-xs`}>
          <option value="active">Active (verified)</option>
          <option value="pending_verification">Pending verification</option>
          <option value="suspended">Suspended</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Reason
        <input name="reason" className={`${inputClass} text-xs`} />
      </label>
      <SubmitButton className={secondaryButtonClass}>Update</SubmitButton>
      <FormStatus state={state} />
    </form>
  );
}

export function CreateOrganizationForm() {
  const [state, action] = useActionState(createOrganizationAction, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-3" noValidate>
      <Field label="Type" htmlFor="org_kind" required>
        <select id="org_kind" name="kind" className={inputClass} defaultValue="partner">
          <option value="partner">Licensed partner company</option>
          <option value="customer">Customer / builder</option>
          <option value="supplier">Supplier / manufacturer</option>
          <option value="qa_agency">Independent QA agency</option>
        </select>
      </Field>
      <Field label="Name" htmlFor="org_name" required>
        <input id="org_name" name="name" className={inputClass} />
      </Field>
      <Field label="Legal name" htmlFor="org_legal_name">
        <input id="org_legal_name" name="legal_name" className={inputClass} />
      </Field>
      <Field label="City" htmlFor="org_city">
        <input id="org_city" name="city" className={inputClass} />
      </Field>
      <Field label="Reason" htmlFor="org_reason" required>
        <input id="org_reason" name="reason" className={inputClass} />
      </Field>
      <div className="flex items-end"><SubmitButton>Create organization</SubmitButton></div>
      <div className="md:col-span-3"><FormStatus state={state} /></div>
    </form>
  );
}

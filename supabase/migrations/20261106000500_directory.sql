-- =============================================================================
-- Minimal people directory for assignment pickers. Sales cannot read other
-- user profiles under RLS, yet must pick a surveyor; owners pick lead owners.
-- Returns only id + display name of ACTIVE users who can do the job.
-- =============================================================================

create function public.list_assignable_users(p_purpose text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_actor();
  v_org uuid := app.aiec_org_id();
  v_target_permission text;
begin
  case p_purpose
    when 'surveyor' then
      if not (app.user_has_permission(v_uid, 'survey.schedule', v_org) or app.user_has_permission(v_uid, 'survey.review', v_org)) then
        perform app.raise_error('ACCESS_DENIED', jsonb_build_object('permission', 'survey.schedule'));
      end if;
      v_target_permission := 'survey.capture';
    when 'lead_owner' then
      perform app.require_permission('lead.assign', v_org);
      v_target_permission := 'lead.read_assigned';
    else
      perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('purpose')));
  end case;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', up.id, 'full_name', coalesce(up.full_name, 'Unnamed user')) order by up.full_name nulls last)
    from public.user_profiles up
    where up.status = 'active' and app.user_has_permission(up.id, v_target_permission, v_org)
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.list_assignable_users(text) from public, anon;
grant execute on function public.list_assignable_users(text) to authenticated;

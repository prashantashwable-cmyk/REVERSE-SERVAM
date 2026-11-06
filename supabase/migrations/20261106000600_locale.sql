-- =============================================================================
-- Interface language: Marathi is the default; English is a per-user choice.
-- =============================================================================

alter table public.user_profiles alter column preferred_locale set default 'mr';

-- Change only the interface language. Works for pending accounts too (they
-- still need to read the onboarding screens). update_my_profile is not used
-- because it requires a full name, which a new user may not have yet.
create function public.set_my_locale(p_locale text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_version integer;
begin
  if v_uid is null then
    perform app.raise_error('AUTH_REQUIRED');
  end if;
  if p_locale is null or p_locale not in ('en', 'mr', 'hi') then
    perform app.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array('preferred_locale')));
  end if;
  select preferred_locale into v_old from public.user_profiles where id = v_uid for update;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'user_profile'));
  end if;
  if v_old = p_locale then
    return jsonb_build_object('preferred_locale', p_locale, 'changed', false);
  end if;
  update public.user_profiles set preferred_locale = p_locale where id = v_uid returning version into v_version;
  perform app.audit(null, 'user_profile', v_uid, 'profile.locale_changed',
    jsonb_build_object('preferred_locale', v_old), jsonb_build_object('preferred_locale', p_locale));
  return jsonb_build_object('preferred_locale', p_locale, 'changed', true, 'version', v_version);
end;
$$;

revoke execute on function public.set_my_locale(text) from public, anon;
grant execute on function public.set_my_locale(text) to authenticated;

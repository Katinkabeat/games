-- Register the two newest hype types in the admin-toggle whitelist (review 2026-07-16, M1).
--
-- snibble_mouthful and oublex_deathless were added to config.js / hype.js / the
-- player-side sq_set_hype_pref whitelist, but never to rook_set_setting — so
-- /rook-config could not toggle them at runtime (the whole point of c224).
-- Same function, whitelist extended; everything else unchanged.

create or replace function public.rook_set_setting(
  p_category text,
  p_key      text,
  p_enabled  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base     jsonb;
  v_settings jsonb;
begin
  -- The allow-list. Add new (category, key) pairs here as more runtime toggles
  -- are introduced; never accept an un-listed key.
  if not (
    p_category = 'hype' and p_key in (
      'wordy_bingo', 'yahdle_clean', 'rungles_gold',
      'snibble_mouthful', 'oublex_deathless',
      'personal_best', 'bounty', 'rivalry', 'board_movement'
    )
  ) then
    raise exception 'unknown setting: %.%', p_category, p_key
      using errcode = 'check_violation';
  end if;

  -- Make sure the category object exists before setting the nested key
  -- (jsonb_set does not create intermediate objects).
  select coalesce(settings, '{}'::jsonb) into v_base from public.rook_settings where id = 1;
  if not (v_base ? p_category) then
    v_base := v_base || jsonb_build_object(p_category, '{}'::jsonb);
  end if;

  update public.rook_settings
     set settings   = jsonb_set(v_base, array[p_category, p_key], to_jsonb(p_enabled), true),
         updated_at = now()
   where id = 1
   returning settings into v_settings;

  return v_settings;
end;
$$;

-- Grants unchanged, re-stated for hygiene (create or replace preserves them,
-- but every migration in this repo leaves the function's grants explicit).
revoke all on function public.rook_set_setting(text, text, boolean) from public, anon, authenticated;
grant execute on function public.rook_set_setting(text, text, boolean) to service_role;

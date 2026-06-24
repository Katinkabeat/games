-- Rook runtime admin settings (card c224).
--
-- Lets admins toggle Rook features live (v1: the per-type hype on/off switches)
-- without editing config.js + restarting. This is Rook's FIRST DB WRITE PATH —
-- everything else it does is read-only. The write is deliberately narrow:
--
--   * Only the service-role edge function `rook-config` can reach these functions
--     (RLS-locked table, no anon/authenticated grants).
--   * `rook_set_setting` WHITELISTS the exact (category, key) pairs that may be
--     written and only accepts booleans — it can never write an arbitrary key or
--     arbitrary value, even if the bot token leaks. This is the property the
--     security review should check.
--
-- Storage is one JSONB blob keyed by category, e.g.
--   { "hype": { "wordy_bingo": false, "rivalry": true } }
-- A missing key means "use the bot's config.js default", so the table starts empty
-- and nothing breaks before an admin ever touches a toggle.

create table if not exists public.rook_settings (
  id         smallint primary key default 1,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint rook_settings_singleton check (id = 1)
);

insert into public.rook_settings (id, settings) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

-- RLS on, no policies: only the service role (the rook-config edge fn) can touch
-- this. No anon/authenticated read or write path exists.
alter table public.rook_settings enable row level security;

-- Read the whole settings blob (the bot caches it and reads per-tick).
create or replace function public.rook_get_settings()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(settings, '{}'::jsonb) from public.rook_settings where id = 1;
$$;

-- Whitelist-only setter. Rejects any (category, key) not in the allow-list below,
-- and only stores booleans. Returns the full updated blob.
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

-- Bot-only: reachable solely through the service-role edge fn. No authenticated grant.
revoke all on function public.rook_get_settings() from public;
revoke all on function public.rook_set_setting(text, text, boolean) from public;
grant execute on function public.rook_get_settings() to service_role;
grant execute on function public.rook_set_setting(text, text, boolean) to service_role;

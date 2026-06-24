-- Rook account-linking + activity roles (card c203, feature 4).
-- Links a Discord user to a SideQuest account via a short one-time code, and
-- exposes per-linked-user activity (daily streak + weekly-champion flag) for the
-- bot to grant Discord roles. The bot never touches these tables directly; it
-- goes through service_role-only edge functions. The hub calls the authenticated
-- RPCs (mint / unlink / status) with the player's own session.

-- ── Tables ───────────────────────────────────────────────────────────
create table if not exists public.discord_links (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  discord_id       text not null unique,
  discord_username text,
  linked_at        timestamptz not null default now()
);

create table if not exists public.discord_link_codes (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists discord_link_codes_user_idx on public.discord_link_codes(user_id);

-- RLS on, no policies: direct client access denied. Only the SECURITY DEFINER
-- functions below and the service_role key can read/write these.
alter table public.discord_links enable row level security;
alter table public.discord_link_codes enable row level security;

-- ── Shared streak helper (matches get_sq_stats exactly) ──────────────
-- Consecutive days, ending today or yesterday, the user played any SQ game
-- (Wordy move OR Rungles rung OR Rungles solo). UTC dates, same as the app.
create or replace function public.daily_streak_for(p_user uuid)
returns int
language sql stable security definer set search_path = public
as $$
  with play_dates as (
    select distinct (created_at at time zone 'UTC')::date as d
      from game_moves where user_id = p_user
    union
    select distinct (created_at at time zone 'UTC')::date
      from rg_rungs where player_user_id = p_user
    union
    select distinct (played_at at time zone 'UTC')::date
      from rg_solo_games where user_id = p_user
  ),
  ranked as (select d, d - (row_number() over (order by d))::int as grp from play_dates),
  groups as (select grp, max(d) as end_d, count(*)::int as len from ranked group by grp)
  select coalesce(max(len), 0) from groups where end_d >= current_date - 1;
$$;

-- ── Hub-facing RPCs (called with the player's own session) ───────────

-- Mint a one-time link code for the calling user (invalidates their prior codes).
create or replace function public.rook_mint_link_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_try  int := 0;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  update discord_link_codes set used_at = now() where user_id = v_user and used_at is null;
  loop
    v_try := v_try + 1;
    -- 6 chars from an unambiguous alphabet (no 0/O/1/I)
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 31) + 1)::int, 1), '')
      into v_code from generate_series(1, 6);
    begin
      insert into discord_link_codes(code, user_id, expires_at)
        values (v_code, v_user, now() + interval '10 minutes');
      return v_code;
    exception when unique_violation then
      if v_try >= 5 then raise; end if; -- astronomically unlikely; retry a few times
    end;
  end loop;
end;
$$;
grant execute on function public.rook_mint_link_code() to authenticated;

-- Current link status for the hub UI.
create or replace function public.rook_my_discord_link()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('linked', true, 'discord_username', discord_username)
       from discord_links where user_id = auth.uid()),
    jsonb_build_object('linked', false)
  );
$$;
grant execute on function public.rook_my_discord_link() to authenticated;

-- Remove the caller's link.
create or replace function public.rook_unlink_discord()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from discord_links where user_id = auth.uid();
end;
$$;
grant execute on function public.rook_unlink_discord() to authenticated;

-- ── Bot-facing RPCs (service_role only, via edge functions) ──────────

-- Redeem a code: verify it, write the mapping, return the SQ username.
create or replace function public.rook_redeem_link_code(
  p_code text, p_discord_id text, p_discord_username text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_username text;
begin
  select user_id into v_user from discord_link_codes
    where code = upper(p_code) and used_at is null and expires_at > now()
    for update;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  end if;

  update discord_link_codes set used_at = now() where code = upper(p_code);
  -- one Discord account maps to one SQ account: move it if it was elsewhere
  delete from discord_links where discord_id = p_discord_id and user_id <> v_user;
  insert into discord_links(user_id, discord_id, discord_username, linked_at)
    values (v_user, p_discord_id, p_discord_username, now())
    on conflict (user_id) do update
      set discord_id = excluded.discord_id,
          discord_username = excluded.discord_username,
          linked_at = now();

  select username into v_username from profiles where id = v_user;
  return jsonb_build_object('ok', true, 'username', v_username);
end;
$$;
revoke all on function public.rook_redeem_link_code(text, text, text) from public, anon, authenticated;
grant execute on function public.rook_redeem_link_code(text, text, text) to service_role;

-- Per-linked-user activity for role sync: daily streak + weekly-champion flag.
create or replace function public.rook_activity()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_lb         jsonb := public.rook_weekly_leaderboards(1); -- last completed week
  v_champions  text[];
begin
  select array_agg(distinct (v_lb -> 'games' -> g -> 0 ->> 'username'))
    into v_champions
    from unnest(array['wordy', 'rungles', 'snibble', 'yahdle']) as g
    where (v_lb -> 'games' -> g -> 0 ->> 'username') is not null;

  return (
    select jsonb_build_object('users', coalesce(jsonb_agg(u), '[]'::jsonb))
    from (
      select dl.discord_id,
             p.username,
             public.daily_streak_for(dl.user_id) as daily_streak,
             (p.username = any(coalesce(v_champions, array[]::text[]))) as is_champion
      from discord_links dl
      join profiles p on p.id = dl.user_id
      where p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
    ) u
  );
end;
$$;
revoke all on function public.rook_activity() from public, anon, authenticated;
grant execute on function public.rook_activity() to service_role;

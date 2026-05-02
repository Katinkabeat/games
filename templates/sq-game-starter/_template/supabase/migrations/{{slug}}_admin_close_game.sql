-- ============================================================
-- {{name}} — Admin close-game support
--
-- Run in Supabase → SQL Editor → New Query, ONCE the {{slug}}_games
-- table exists. Reuses the shared `public.admins` table (managed
-- from the SQ hub) for the permission check — no per-game admins
-- table needed.
--
-- This adds three pieces:
--   1. closed_by_admin BOOLEAN column on {{slug}}_games
--   2. {{slug}}_admin_close_game(uuid) RPC — soft-closes a game
--      with no winner attribution
--   3. {{slug}}_admin_list_open_games() RPC — lists open + active
--      games for the admin panel UI
--
-- If your game's table is named differently (e.g. {{slug}}_matches),
-- find/replace `{{slug}}_games` below before running.
-- ============================================================

-- ── 1. closed_by_admin column ─────────────────────────────────
alter table public.{{slug}}_games
  add column if not exists closed_by_admin boolean not null default false;

-- ── 2. {{slug}}_admin_close_game ──────────────────────────────
-- SECURITY DEFINER bypasses RLS so the admin can close games they
-- aren't a player in. Permission check enforced inside.
--
-- IMPORTANT: adjust the status values in the WHERE / SET clauses
-- below to match your game's status enum. The defaults assume
-- 'waiting' / 'active' / 'finished' (matches Wordy). Common
-- variants:
--   * Rungles uses 'complete' instead of 'finished'
--   * Snibble uses 'open' / 'in_progress' / 'completed'
create or replace function public.{{slug}}_admin_close_game(p_game_id uuid)
returns void language plpgsql security definer as $$
begin
  if not exists (
    select 1 from public.admins
    where user_id = auth.uid()
      and 'close_games' = any(permissions)
  ) then
    raise exception 'Unauthorized: you do not have the close_games permission';
  end if;

  update public.{{slug}}_games
  set status          = 'finished',
      finished_at     = now(),
      closed_by_admin = true
  where id = p_game_id
    and status in ('waiting', 'active');

  if not found then
    raise exception 'Game not found or is already closed';
  end if;
end;
$$;

grant execute on function public.{{slug}}_admin_close_game(uuid) to authenticated;

-- ── 3. {{slug}}_admin_list_open_games ─────────────────────────
-- Returns waiting/active games for the admin Close Games panel.
-- Joins through your players table to surface usernames; rename
-- {{slug}}_players + the join column if your schema differs.
create or replace function public.{{slug}}_admin_list_open_games()
returns table (
  id           uuid,
  status       text,
  created_at   timestamptz,
  player_names text[]
) language sql security definer stable as $$
  select
    g.id,
    g.status,
    g.created_at,
    coalesce(
      array_agg(p.username order by gp.player_index)
        filter (where p.username is not null),
      array[]::text[]
    ) as player_names
  from public.{{slug}}_games g
  left join public.{{slug}}_players gp on gp.game_id = g.id
  left join public.profiles        p  on p.id = gp.user_id
  where g.status in ('waiting', 'active')
  group by g.id
  order by g.created_at desc
$$;

grant execute on function public.{{slug}}_admin_list_open_games() to authenticated;

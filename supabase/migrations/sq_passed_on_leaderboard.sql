-- ============================================================
-- SQ "passed on the leaderboard" — rank snapshot + candidate selector
-- (card c225)
--
-- Rook detects *positive* board movement (took #1 / entered top-N) by
-- diffing successive leaderboard polls IN MEMORY (long-running bot).
-- There is no server-side "you fell from rank X" signal to reuse. A
-- cron/edge path has no in-memory state, so we PERSIST each player's
-- prior rank and diff against it on the next tick.
--
-- Source of truth for ranks: rook_weekly_points(0, ...) — the current
-- week to date, same scoring the board shows (already excludes
-- forfeits, admin-closed games, bots, deactivated/anonymized accounts).
-- Points are cumulative within a Mon-Sun week, so a ranked player never
-- drops OFF the board mid-week — they can only be pushed down by others
-- rising, which keeps the diff clean (no "disappeared" edge case).
--
-- "Notable" drop (what we notify on):
--   * lost #1   : old rank = 1 and new rank > 1
--   * out of 5  : old rank <= 5 and new rank > 5
-- A pure intra-top-5 slip (4 -> 5) is intentionally NOT notified.
-- ============================================================

-- ── 1. Snapshot table ────────────────────────────────────────
-- One row per ranked player for the current week. week_start scopes it
-- so a new week starts from a clean baseline (last week's rows are
-- stale and get cleared on the first tick of the new week, producing
-- no notifications — exactly the desired "fresh start" behaviour).
create table if not exists public.sq_leaderboard_rank_snapshot (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  week_start date        not null,
  rank       int         not null,
  updated_at timestamptz not null default now()
);

alter table public.sq_leaderboard_rank_snapshot enable row level security;
-- No policies: service-role only (the edge function). RLS-on + no policy
-- denies anon/authenticated, matching the other cron-fed tables.

-- ── 2. Candidate selector ────────────────────────────────────
-- Returns users who just took a NOTABLE drop AND have the topic opted
-- in (sq_notification_enabled also honours the app `_master` toggle),
-- THEN refreshes the snapshot to the current ranks so the next tick
-- diffs against fresh state. Reads the old snapshot BEFORE overwriting.
-- Service-role only; the edge function is a pure dispatcher.
create or replace function public.sq_passed_on_leaderboard_candidates()
returns table(user_id uuid, old_rank int, new_rank int)
language plpgsql
security definer
set search_path = public
as $$
-- OUT params (user_id/old_rank/new_rank) share names with the snapshot
-- table's columns; resolve unqualified refs (e.g. the `on conflict`
-- target below) to the COLUMN, not the variable.
#variable_conflict use_column
declare
  v_week_start date;
begin
  -- Current-week ranks, derived from the board's own scoring function.
  -- Ordinality over the points-desc/username-asc array == displayed rank.
  -- Limit 200 is far beyond the real player base; every ranked user is
  -- captured, so a snapshotted user is always still present here.
  drop table if exists _cur_ranks;
  create temporary table _cur_ranks on commit drop as
  select pr.id                              as user_id,
         (lead.ord)::int                    as rank,
         (board.j ->> 'week_start')::date   as week_start
  from (select public.rook_weekly_points(0, 200) as j) board,
       lateral jsonb_array_elements(board.j -> 'leaders')
         with ordinality as lead(elem, ord)
  join public.profiles pr on pr.username = (lead.elem ->> 'username');

  select c.week_start into v_week_start from _cur_ranks c limit 1;

  -- Empty board (start of week, nobody has points yet): clear any stale
  -- rows and bail — nothing to diff or notify.
  if v_week_start is null then
    delete from public.sq_leaderboard_rank_snapshot;
    return;
  end if;

  -- Notable drops vs the prior snapshot for the SAME week.
  return query
  select c.user_id, s.rank as old_rank, c.rank as new_rank
  from _cur_ranks c
  join public.sq_leaderboard_rank_snapshot s
    on s.user_id = c.user_id
   and s.week_start = c.week_start
  where c.rank > s.rank                          -- actually got passed
    and (
         (s.rank = 1  and c.rank > 1)            -- lost #1
      or (s.rank <= 5 and c.rank > 5)            -- fell out of the top 5
    )
    and public.sq_notification_enabled(c.user_id, 'sidequest', 'passed_on_leaderboard');

  -- Refresh snapshot: drop stale (prior weeks), upsert current ranks.
  delete from public.sq_leaderboard_rank_snapshot where week_start <> v_week_start;
  insert into public.sq_leaderboard_rank_snapshot (user_id, week_start, rank, updated_at)
  select c.user_id, c.week_start, c.rank, now() from _cur_ranks c
  on conflict (user_id) do update
    set rank       = excluded.rank,
        week_start = excluded.week_start,
        updated_at = now();
end;
$$;

revoke all on function public.sq_passed_on_leaderboard_candidates() from public, anon, authenticated;
grant execute on function public.sq_passed_on_leaderboard_candidates() to service_role;

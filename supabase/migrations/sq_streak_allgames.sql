-- Streak = "any game played that day" across all 4 SQ games (card c231,
-- decided by Rae 2026-06-20). Previously the daily streak counted only Wordy
-- moves + Rungles rungs + Rungles solo, ignoring Yahdle and Snibble — so a
-- player who did the Yahdle/Snibble dailies every day still showed a tiny streak.
--
-- Two changes, kept consistent BY CONSTRUCTION:
--   1. daily_streak_for(uuid) — Rook's helper (feeds /profile + the streak badges)
--      — now unions every game's per-play signal.
--   2. get_sq_stats() — the in-app streak — now CALLS daily_streak_for instead of
--      duplicating the query, so the app and Discord can never disagree.
--
-- Day boundaries use America/Halifax (matches the daily-puzzle reset — verified
-- play_date/feed_date align to Halifax, not UTC; this also fixes a UTC off-by-one
-- that split late-evening plays into the next day).

create or replace function public.daily_streak_for(p_user uuid)
returns int
language sql stable security definer set search_path = public
as $$
  with play_dates as (
    -- Wordy (multiplayer + vs-bot): a move you made
    select distinct (m.created_at at time zone 'America/Halifax')::date as d
      from game_moves m where m.user_id = p_user
    union
    -- Rungles multiplayer: a rung you played
    select distinct (rr.created_at at time zone 'America/Halifax')::date
      from rg_rungs rr where rr.player_user_id = p_user
    union
    -- Rungles solo / daily
    select distinct (s.played_at at time zone 'America/Halifax')::date
      from rg_solo_games s where s.user_id = p_user
    union
    -- Yahdle solo / daily
    select distinct (y.completed_at at time zone 'America/Halifax')::date
      from yahdle_solo_results y where y.user_id = p_user and y.completed_at is not null
    union
    -- Yahdle multiplayer: your turn in a game (best available signal; turn_state
    -- keeps only your latest turn per game, so a multi-day MP game marks its last
    -- day — fine, the daily games are the reliable streak drivers)
    select distinct (yt.updated_at at time zone 'America/Halifax')::date
      from yahdle_turn_state yt where yt.user_id = p_user
    union
    -- Snibble daily feed (completed)
    select distinct (f.played_at at time zone 'America/Halifax')::date
      from sn_daily_feeds f where f.user_id = p_user and f.is_complete = true
    union
    -- Snibble 1v1: a round you submitted
    select distinct (rp.submitted_at at time zone 'America/Halifax')::date
      from sn_match_round_plays rp where rp.user_id = p_user and rp.submitted_at is not null
  ),
  ranked as (
    select d, d - (row_number() over (order by d))::int as grp from play_dates
  ),
  groups as (
    select grp, max(d) as end_d, count(*)::int as len from ranked group by grp
  )
  select coalesce(max(len), 0) from groups
   where end_d >= (now() at time zone 'America/Halifax')::date - 1;
$$;
-- preserve the L1 grant hygiene (service_role only; called internally by
-- rook_activity / rook_profile, and by get_sq_stats which is SECURITY DEFINER)
revoke all on function public.daily_streak_for(uuid) from public, anon, authenticated;
grant execute on function public.daily_streak_for(uuid) to service_role;

-- App stats: same fields as before, but the streak now delegates to the single
-- source of truth above so the in-app number always matches Rook.
create or replace function public.get_sq_stats()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id      uuid := auth.uid();
  v_member_since timestamptz;
  v_wordy_multi  int;
  v_rg_multi     int;
  v_rg_solo      int;
  v_streak       int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select created_at into v_member_since from public.profiles where id = v_user_id;
  select count(*) into v_wordy_multi from public.game_players where user_id = v_user_id;
  select count(*) into v_rg_multi from public.rg_players where user_id = v_user_id;
  select count(*) into v_rg_solo from public.rg_solo_games where user_id = v_user_id;

  -- single source of truth for the streak (all games, Halifax days)
  v_streak := public.daily_streak_for(v_user_id);

  return jsonb_build_object(
    'member_since',  v_member_since,
    'wordy_multi',   v_wordy_multi,
    'rungles_multi', v_rg_multi,
    'rungles_solo',  v_rg_solo,
    'daily_streak',  v_streak
  );
end;
$function$;

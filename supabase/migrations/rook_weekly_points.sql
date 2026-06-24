-- Rook weekly points board (card c214) — the competitive "resets every Monday" lane.
--
-- The badge ladder (c203) is retrospective: vets earn the whole wall on link-day
-- and have nothing left to chase. This adds a weekly points race that wipes clean
-- each Monday so everyone, vets included, gets a fresh goal every week.
--
-- Scoring (all values are parameters so the bot's config.js owns the knobs):
--   * Versus (a multiplayer game vs a non-bot HUMAN opponent):
--       win = p_win (100) · tie = p_tie (50) · loss = 0.
--   * Solo / daily completion (Rungles solo, Yahdle solo, Snibble daily feed):
--       p_solo (25), capped to the first completion per game per day.
--   * Wordy vs a bot routes to the SOLO lane, NOT versus: a bot WIN = p_bot_win (25),
--       capped p_bot_wins_per_day (3) per day. Beating Robin/Jay/Merlin/Claudette
--       isn't competitive, and capping value + count stops bot-farming (Rae c214).
--
-- Win/tie/loss is read from per-player SCORE comparison (Su>So win, Su=So tie,
-- Su<So loss) rather than each game's idiosyncratic winner marker. Every game
-- stores a per-player score, so this is uniform AND it's exactly the card's
-- "tie = equal top score" rule — it also sidesteps Rungles' arbitrary
-- equal-score tiebreak (it picks one winner on a draw; score-compare calls it a tie).
--
-- Excluded: forfeited / admin-closed games where detectable (Wordy forfeit_user_id
-- + closed_by_admin; Rungles closed_by_admin; Snibble closed_by_admin; Yahdle
-- forfeit_user_id), and deactivated / anonymized / bot accounts (standard).
-- DEFERRED (c214): per-opponent weekly cap to blunt win-trading — not built until
-- abuse appears; needless complexity for a tiny trusted base.
--
-- Window: Mon-Sun America/Halifax, same logic as rook_weekly_leaderboards.
--   p_week = 1 -> previous completed week (the Monday post + the Top crow crown)
--   p_week = 0 -> current week to date (the /points command)
-- Service-role only; reached through the read-only rook-weekly-points edge function.

create or replace function public.rook_weekly_points(
  p_week             int default 1,
  p_limit            int default 10,
  p_win              int default 100,
  p_tie              int default 50,
  p_solo             int default 25,
  p_bot_win          int default 25,
  p_bot_wins_per_day int default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Halifax')::date;
  v_this_mon   date := date_trunc('week', v_today)::date;  -- Postgres weeks start Monday
  v_start_date date;
  v_end_date   date;          -- inclusive last day of the window
  v_start_ts   timestamptz;
  v_end_ts     timestamptz;   -- exclusive upper bound for timestamp columns
begin
  if p_week <= 0 then
    v_start_date := v_this_mon;       -- current week to date
    v_end_date   := v_today;
  else
    v_start_date := v_this_mon - 7;   -- previous completed week
    v_end_date   := v_this_mon - 1;
  end if;

  v_start_ts := (v_start_date::timestamp at time zone 'America/Halifax');
  v_end_ts   := ((v_end_date + 1)::timestamp at time zone 'America/Halifax');

  return (
  with
  -- Re-usable predicate for "this scoring user is an eligible human player".
  -- (Applied per source below; a CTE can't carry it, so it's repeated inline.)

  -- ── VERSUS lane: win/tie/loss from score comparison, human opponent only ──
  versus(user_id, pts) as (
    -- Wordy
    select me.user_id,
           case when me.score > opp.score then p_win
                when me.score = opp.score then p_tie
                else 0 end
    from games g
    join game_players me  on me.game_id = g.id
    join game_players opp on opp.game_id = g.id and opp.user_id <> me.user_id
    join profiles pme  on pme.id  = me.user_id
    join profiles popp on popp.id = opp.user_id
    where g.status = 'finished'
      and g.finished_at >= v_start_ts and g.finished_at < v_end_ts
      and coalesce(g.closed_by_admin, false) = false
      and g.forfeit_user_id is null
      and (select count(*) from game_players x where x.game_id = g.id) = 2
      and coalesce(popp.is_bot, false) = false      -- human opponent only
      and pme.username is not null
      and pme.deactivated_at is null and coalesce(pme.is_anonymized, false) = false
      and coalesce(pme.is_bot, false) = false

    union all
    -- Rungles
    select me.user_id,
           case when me.score > opp.score then p_win
                when me.score = opp.score then p_tie
                else 0 end
    from rg_games g
    join rg_players me  on me.game_id = g.id
    join rg_players opp on opp.game_id = g.id and opp.user_id <> me.user_id
    join profiles pme  on pme.id  = me.user_id
    join profiles popp on popp.id = opp.user_id
    where g.status = 'complete'
      and g.finished_at >= v_start_ts and g.finished_at < v_end_ts
      and coalesce(g.closed_by_admin, false) = false
      and (select count(*) from rg_players x where x.game_id = g.id) = 2
      and coalesce(popp.is_bot, false) = false
      and pme.username is not null
      and pme.deactivated_at is null and coalesce(pme.is_anonymized, false) = false
      and coalesce(pme.is_bot, false) = false

    union all
    -- Snibble (per-player total = sum of round scores; winner_id NULL = tie)
    select s.user_id,
           case when s.mine > s.theirs then p_win
                when s.mine = s.theirs then p_tie
                else 0 end
    from (
      select m.creator_id  as user_id,
             (select coalesce(sum(score), 0) from sn_match_round_plays r where r.match_id = m.id and r.user_id = m.creator_id)  as mine,
             (select coalesce(sum(score), 0) from sn_match_round_plays r where r.match_id = m.id and r.user_id = m.opponent_id) as theirs,
             m.opponent_id as opp_id
      from sn_matches m
      where m.status = 'completed'
        and coalesce(m.closed_by_admin, false) = false
        and m.completed_at >= v_start_ts and m.completed_at < v_end_ts
      union all
      select m.opponent_id as user_id,
             (select coalesce(sum(score), 0) from sn_match_round_plays r where r.match_id = m.id and r.user_id = m.opponent_id) as mine,
             (select coalesce(sum(score), 0) from sn_match_round_plays r where r.match_id = m.id and r.user_id = m.creator_id)  as theirs,
             m.creator_id  as opp_id
      from sn_matches m
      where m.status = 'completed'
        and coalesce(m.closed_by_admin, false) = false
        and m.completed_at >= v_start_ts and m.completed_at < v_end_ts
    ) s
    join profiles pme  on pme.id  = s.user_id
    join profiles popp on popp.id = s.opp_id
    where coalesce(popp.is_bot, false) = false
      and pme.username is not null
      and pme.deactivated_at is null and coalesce(pme.is_anonymized, false) = false
      and coalesce(pme.is_bot, false) = false

    union all
    -- Yahdle
    select me.user_id,
           case when me.total_score > opp.total_score then p_win
                when me.total_score = opp.total_score then p_tie
                else 0 end
    from yahdle_games g
    join yahdle_players me  on me.game_id = g.id
    join yahdle_players opp on opp.game_id = g.id and opp.user_id <> me.user_id
    join profiles pme  on pme.id  = me.user_id
    join profiles popp on popp.id = opp.user_id
    where g.status = 'finished'
      and g.finished_at >= v_start_ts and g.finished_at < v_end_ts
      and g.forfeit_user_id is null
      and (select count(*) from yahdle_players x where x.game_id = g.id) = 2
      and coalesce(popp.is_bot, false) = false
      and pme.username is not null
      and pme.deactivated_at is null and coalesce(pme.is_anonymized, false) = false
      and coalesce(pme.is_bot, false) = false
  ),

  -- ── SOLO lane: daily completions (capped one/game/day) + Wordy bot wins ──
  solo(user_id, pts) as (
    -- Rungles solo (now a daily; distinct-day guards pre-c215 multi-play history)
    select g.user_id,
           count(distinct (g.played_at at time zone 'America/Halifax')::date) * p_solo
    from rg_solo_games g
    join profiles p on p.id = g.user_id
    where g.played_at >= v_start_ts and g.played_at < v_end_ts
      and p.username is not null
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
    group by g.user_id

    union all
    -- Yahdle solo (one row per play_date)
    select r.user_id, count(distinct r.play_date) * p_solo
    from yahdle_solo_results r
    join profiles p on p.id = r.user_id
    where r.play_date >= v_start_date and r.play_date <= v_end_date
      and p.username is not null
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
    group by r.user_id

    union all
    -- Snibble daily feed (completed)
    select f.user_id, count(distinct f.feed_date) * p_solo
    from sn_daily_feeds f
    join profiles p on p.id = f.user_id
    where f.is_complete = true
      and f.feed_date >= v_start_date and f.feed_date <= v_end_date
      and p.username is not null
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
    group by f.user_id

    union all
    -- Wordy vs a bot: bot WINS only, value p_bot_win, capped p_bot_wins_per_day/day
    select z.user_id, sum(least(z.cnt, p_bot_wins_per_day) * p_bot_win)
    from (
      select me.user_id,
             (g.finished_at at time zone 'America/Halifax')::date as d,
             count(*) as cnt
      from games g
      join game_players me  on me.game_id = g.id and me.is_winner = true
      join game_players opp on opp.game_id = g.id and opp.user_id <> me.user_id
      join profiles pme  on pme.id  = me.user_id
      join profiles popp on popp.id = opp.user_id
      where g.status = 'finished'
        and g.finished_at >= v_start_ts and g.finished_at < v_end_ts
        and coalesce(g.closed_by_admin, false) = false
        and g.forfeit_user_id is null
        and (select count(*) from game_players x where x.game_id = g.id) = 2
        and coalesce(popp.is_bot, false) = true       -- bot opponent
        and pme.username is not null
        and pme.deactivated_at is null and coalesce(pme.is_anonymized, false) = false
        and coalesce(pme.is_bot, false) = false
      group by me.user_id, d
    ) z
    group by z.user_id
  ),

  scored(user_id, lane, pts) as (
    select user_id, 'versus', pts from versus
    union all
    select user_id, 'solo',   pts from solo
  ),

  totals as (
    select s.user_id,
           sum(s.pts)::int                                              as points,
           (sum(s.pts) filter (where s.lane = 'versus'))::int           as versus_points,
           (sum(s.pts) filter (where s.lane = 'solo'))::int             as solo_points
    from scored s
    group by s.user_id
  )

  select jsonb_build_object(
    'week_start', v_start_date,
    'week_end',   v_end_date,
    'leaders', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select p.username,
               t.points,
               coalesce(t.versus_points, 0) as versus_points,
               coalesce(t.solo_points, 0)   as solo_points
        from totals t
        join profiles p on p.id = t.user_id
        where t.points > 0
        order by t.points desc, p.username asc
        limit greatest(p_limit, 1)
      ) t
    ), '[]'::jsonb)
  )
  );
end;
$$;

-- ── Re-point Top crow: the weekly crown is now the weekly-POINTS #1 (c214) ──
-- Absorbs the old "top of any per-game leaderboard" champion into a single
-- rotating crown. Ties at the top all wear it. rook_activity + rook_profile are
-- redefined here (later migration wins) to read champion from rook_weekly_points.

create or replace function public.rook_activity()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_pts       jsonb := public.rook_weekly_points(1); -- last completed week
  v_max       int;
  v_champions text[];
begin
  select max((l ->> 'points')::int) into v_max
    from jsonb_array_elements(v_pts -> 'leaders') l;

  if v_max is not null then
    select array_agg(l ->> 'username') into v_champions
      from jsonb_array_elements(v_pts -> 'leaders') l
      where (l ->> 'points')::int = v_max;
  end if;

  return (
    select jsonb_build_object('users', coalesce(jsonb_agg(
      jsonb_build_object(
        'discord_id',  dl.discord_id,
        'username',    p.username,
        'is_champion', (p.username = any(coalesce(v_champions, array[]::text[]))),
        'signals',     public.rook_user_signals(dl.user_id)
      )
    ), '[]'::jsonb))
    from discord_links dl
    join profiles p on p.id = dl.user_id
    where p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
  );
end;
$$;

create or replace function public.rook_profile(p_discord_id text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user         uuid;
  v_username     text;
  v_member_since timestamptz;
  v_pts          jsonb := public.rook_weekly_points(1);
  v_max          int;
  v_champion     boolean;
begin
  select dl.user_id into v_user from discord_links dl where dl.discord_id = p_discord_id;
  if v_user is null then
    return jsonb_build_object('linked', false);
  end if;

  select username, created_at into v_username, v_member_since
    from profiles where id = v_user;

  select max((l ->> 'points')::int) into v_max
    from jsonb_array_elements(v_pts -> 'leaders') l;

  v_champion := v_max is not null and exists (
    select 1 from jsonb_array_elements(v_pts -> 'leaders') l
    where (l ->> 'points')::int = v_max and (l ->> 'username') = v_username
  );

  return jsonb_build_object(
    'linked',       true,
    'username',     v_username,
    'member_since', v_member_since,
    'is_champion',  coalesce(v_champion, false),
    'signals',      public.rook_user_signals(v_user)
  );
end;
$$;

-- ── Grants: service_role only (bot reaches these via edge functions) ──
revoke all on function public.rook_weekly_points(int, int, int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.rook_weekly_points(int, int, int, int, int, int, int) to service_role;
-- rook_activity() / rook_profile(text) grants unchanged (service_role, from earlier migrations).

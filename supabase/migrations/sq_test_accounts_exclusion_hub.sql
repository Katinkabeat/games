-- c332: exclude "Test Accounts" user-group members from every
-- leaderboard / stat / win-loss / hype aggregate.
--
-- public.sq_is_test_account(uid uuid) returns boolean (SECURITY DEFINER,
-- STABLE) is TRUE for members of the Test Accounts group. It already
-- exists; this migration only adds exclusion predicates around it.
--
-- Rules applied throughout this file:
--   - Solo/scorer rows: skip rows whose player is a test account.
--   - Multiplayer: skip the WHOLE game for BOTH players if ANY seated
--     player is a test account (mirrors the pre-existing any-bot-in-game
--     NOT EXISTS pattern already used for bot exclusion, e.g. the Wordy
--     block of rook_weekly_leaderboards).
--   - Hype detection: test accounts never generate hype events, never set
--     personal-best/bounty global maxima used for comparison, and never
--     form rivalry pairs.
--
-- Functions changed (CREATE OR REPLACE, identical signature / language /
-- volatility / security / search_path to the live definitions fetched via
-- pg_get_functiondef; only the exclusion predicates below are new):
--   - rook_weekly_leaderboards(p_week integer)
--   - rook_weekly_points(p_week, p_limit, p_win, p_tie, p_solo, p_bot_win, p_bot_wins_per_day)
--   - rook_games_total(p_user uuid)
--   - rook_wins_by_game(p_user uuid)
--   - rook_has_night_owl(p_user uuid)
--   - rook_has_landslide(p_user uuid)
--   - rook_has_comeback(p_user uuid)
--   - rook_hype_detect(p_lookback interval)
--   - rook_hype_events(p_since timestamptz, p_limit integer)
--   - get_sq_stats()
--
-- Functions NOT changed (left as-is on purpose, see notes at each call site):
--   - rook_activity(...) / rook_profile(...): both call rook_weekly_points
--     (fixed below) and rook_user_signals (out of scope for c332 — not in
--     the function list, not touched); they have no game/player queries of
--     their own to patch.
--   - daily_streak_for(p_user uuid): unchanged. It's the user's own
--     play-date streak, not a comparison against other players, so a test
--     account being seated in one of the user's MP games doesn't taint it
--     the way win/loss/points aggregates would be tainted.
--   - sq_passed_on_leaderboard_candidates(): inherits its ranking entirely
--     from rook_weekly_points(0, 200), which is fixed below; nothing else
--     in that function reads game/player rows directly.

-- ============================================================================
-- rook_weekly_leaderboards
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_weekly_leaderboards(p_week integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  return jsonb_build_object(
    'week_start', v_start_date,
    'week_end',   v_end_date,
    'games', jsonb_build_object(
      -- Wordy: best single-game score among games finished in the window.
      -- Exclusion parity with the points/hype lanes (review round 2, item 2).
      'wordy', coalesce((
        select jsonb_agg(row_to_json(t)) from (
          select p.username, max(gp.score)::int as score
          from game_players gp
          join games g    on g.id = gp.game_id
          join profiles p on p.id = gp.user_id
          where g.status = 'finished'
            and g.finished_at >= v_start_ts and g.finished_at < v_end_ts
            and coalesce(g.closed_by_admin, false) = false
            and g.forfeit_user_id is null
            and not exists (
              select 1 from game_players gx join profiles px on px.id = gx.user_id
              where gx.game_id = g.id and coalesce(px.is_bot, false) = true
            )
            -- c332: no test account seated in the game (either side)
            and not exists (
              select 1 from game_players gx2
              where gx2.game_id = g.id and public.sq_is_test_account(gx2.user_id)
            )
            and p.username is not null
            and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
            and coalesce(p.is_bot, false) = false
          group by p.id, p.username
          order by max(gp.score) desc
          limit 5
        ) t
      ), '[]'::jsonb),
      -- Rungles: each player's best solo run in the window.
      'rungles', coalesce((
        select jsonb_agg(row_to_json(t)) from (
          select p.username, b.total_score::int as score
          from (
            select distinct on (g.user_id) g.user_id, g.total_score, g.played_at
            from rg_solo_games g
            where g.played_at >= v_start_ts and g.played_at < v_end_ts
            order by g.user_id, g.total_score desc, g.played_at asc
          ) b
          join profiles p on p.id = b.user_id
          where p.username is not null
            and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
            and coalesce(p.is_bot, false) = false
            and not public.sq_is_test_account(p.id)  -- c332
          order by b.total_score desc, b.played_at asc
          limit 5
        ) t
      ), '[]'::jsonb),
      -- Snibble: sum of completed daily feed scores across the window.
      'snibble', coalesce((
        select jsonb_agg(row_to_json(t)) from (
          select p.username, sum(f.score)::int as score
          from sn_daily_feeds f
          join profiles p on p.id = f.user_id
          where f.is_complete = true
            and f.feed_date >= v_start_date and f.feed_date <= v_end_date
            and p.username is not null
            and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
            and coalesce(p.is_bot, false) = false
            and not public.sq_is_test_account(p.id)  -- c332
          group by f.user_id, p.username
          order by sum(f.score) desc
          limit 5
        ) t
      ), '[]'::jsonb),
      -- Yahdle: sum of daily solo scores across the window.
      'yahdle', coalesce((
        select jsonb_agg(row_to_json(t)) from (
          select p.username, sum(r.score)::int as score
          from yahdle_solo_results r
          join profiles p on p.id = r.user_id
          where r.play_date >= v_start_date and r.play_date <= v_end_date
            and p.username is not null
            and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
            and coalesce(p.is_bot, false) = false
            and not public.sq_is_test_account(p.id)  -- c332
          group by r.user_id, p.username
          order by sum(r.score) desc
          limit 5
        ) t
      ), '[]'::jsonb),
      -- Oublex: sum of daily solo damage across the window.
      'oublex', coalesce((
        select jsonb_agg(row_to_json(t)) from (
          select p.username, sum(r.score)::int as score
          from oublex_solo_results r
          join profiles p on p.id = r.user_id
          where r.play_date >= v_start_date and r.play_date <= v_end_date
            and p.username is not null
            and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
            and coalesce(p.is_bot, false) = false
            and not public.sq_is_test_account(p.id)  -- c332
          group by r.user_id, p.username
          order by sum(r.score) desc
          limit 5
        ) t
      ), '[]'::jsonb)
    )
  );
end;
$function$;

-- ============================================================================
-- rook_weekly_points
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_weekly_points(p_week integer DEFAULT 1, p_limit integer DEFAULT 10, p_win integer DEFAULT 100, p_tie integer DEFAULT 50, p_solo integer DEFAULT 25, p_bot_win integer DEFAULT 25, p_bot_wins_per_day integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- c332: whole game skipped if any seated player is a test account
      and not exists (
        select 1 from game_players x
        where x.game_id = g.id and public.sq_is_test_account(x.user_id)
      )

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
      -- c332: whole game skipped if any seated player is a test account
      and not exists (
        select 1 from rg_players x
        where x.game_id = g.id and public.sq_is_test_account(x.user_id)
      )

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
      -- c332: whole match skipped if either side is a test account
      and not public.sq_is_test_account(pme.id)
      and not public.sq_is_test_account(popp.id)

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
      -- c332: whole game skipped if any seated player is a test account
      and not exists (
        select 1 from yahdle_players x
        where x.game_id = g.id and public.sq_is_test_account(x.user_id)
      )
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
      and not public.sq_is_test_account(p.id)  -- c332
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
      and not public.sq_is_test_account(p.id)  -- c332
    group by r.user_id

    union all
    -- Oublex solo (one row per play_date)
    select r.user_id, count(distinct r.play_date) * p_solo
    from oublex_solo_results r
    join profiles p on p.id = r.user_id
    where r.play_date >= v_start_date and r.play_date <= v_end_date
      and p.username is not null
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
      and not public.sq_is_test_account(p.id)  -- c332
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
      and not public.sq_is_test_account(p.id)  -- c332
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
        and not public.sq_is_test_account(pme.id)  -- c332
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
$function$;

-- ============================================================================
-- rook_games_total
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_games_total(p_user uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce((select count(*) from game_players gp join games g on g.id = gp.game_id
                where gp.user_id = p_user and g.status = 'finished'
                  and not exists (  -- c332
                    select 1 from game_players x
                    where x.game_id = g.id and public.sq_is_test_account(x.user_id)
                  )), 0)
  + coalesce((select count(*) from rg_players rp join rg_games g on g.id = rp.game_id
                where rp.user_id = p_user and g.status = 'complete'
                  and not exists (  -- c332
                    select 1 from rg_players x
                    where x.game_id = g.id and public.sq_is_test_account(x.user_id)
                  )), 0)
  + coalesce((select count(*) from rg_solo_games where user_id = p_user), 0)
  + coalesce((select count(*) from sn_daily_feeds where user_id = p_user and is_complete = true), 0)
  + coalesce((select count(distinct rp.match_id) from sn_match_round_plays rp
                join sn_matches m on m.id = rp.match_id
                where rp.user_id = p_user and m.status = 'completed'
                  and not public.sq_is_test_account(m.creator_id)  -- c332
                  and (m.opponent_id is null or not public.sq_is_test_account(m.opponent_id))), 0)
  + coalesce((select count(*) from yahdle_players yp join yahdle_games g on g.id = yp.game_id
                where yp.user_id = p_user and g.status = 'finished'
                  and not exists (  -- c332
                    select 1 from yahdle_players x
                    where x.game_id = g.id and public.sq_is_test_account(x.user_id)
                  )), 0)
  + coalesce((select count(*) from yahdle_solo_results where user_id = p_user), 0);
$function$;

-- ============================================================================
-- rook_wins_by_game
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_wins_by_game(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'wordy', coalesce((select count(*) from game_players gp join games g on g.id = gp.game_id
                where gp.user_id = p_user and g.status = 'finished' and gp.is_winner = true
                  and exists (select 1 from game_players o join profiles po on po.id = o.user_id
                              where o.game_id = g.id and o.user_id <> p_user
                                and coalesce(po.is_bot, false) = false
                                and not public.sq_is_test_account(po.id))), 0),  -- c332
    'rungles', coalesce((select count(*) from rg_players rp join rg_games g on g.id = rp.game_id
                where rp.user_id = p_user and g.status = 'complete'
                  and g.winner_player_idx = rp.player_idx
                  and exists (select 1 from rg_players o join profiles po on po.id = o.user_id
                              where o.game_id = g.id and o.user_id <> p_user
                                and coalesce(po.is_bot, false) = false
                                and not public.sq_is_test_account(po.id))), 0),  -- c332
    'snibble', coalesce((select count(*) from sn_matches m
                where m.status = 'completed' and m.winner_id = p_user
                  and exists (select 1 from sn_match_round_plays o join profiles po on po.id = o.user_id
                              where o.match_id = m.id and o.user_id <> p_user
                                and coalesce(po.is_bot, false) = false
                                and not public.sq_is_test_account(po.id))), 0),  -- c332
    'yahdle', coalesce((select count(*) from yahdle_players yp join yahdle_games g on g.id = yp.game_id
                where yp.user_id = p_user and g.status = 'finished' and yp.is_winner = true
                  and exists (select 1 from yahdle_players o join profiles po on po.id = o.user_id
                              where o.game_id = g.id and o.user_id <> p_user
                                and coalesce(po.is_bot, false) = false
                                and not public.sq_is_test_account(po.id))), 0)  -- c332
  );
$function$;

-- ============================================================================
-- rook_has_night_owl
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_has_night_owl(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from games g join game_players gp on gp.game_id = g.id
      where gp.user_id = p_user and g.status = 'finished' and g.finished_at is not null
        and extract(hour from g.finished_at at time zone 'America/Halifax') between 2 and 4
        and not exists (  -- c332
          select 1 from game_players x
          where x.game_id = g.id and public.sq_is_test_account(x.user_id)
        )
    union all
    select 1 from rg_games g join rg_players rp on rp.game_id = g.id
      where rp.user_id = p_user and g.status = 'complete' and g.finished_at is not null
        and extract(hour from g.finished_at at time zone 'America/Halifax') between 2 and 4
        and not exists (  -- c332
          select 1 from rg_players x
          where x.game_id = g.id and public.sq_is_test_account(x.user_id)
        )
    union all
    select 1 from rg_solo_games
      where user_id = p_user and played_at is not null
        and extract(hour from played_at at time zone 'America/Halifax') between 2 and 4
    union all
    select 1 from sn_matches m join sn_match_round_plays rp on rp.match_id = m.id
      where rp.user_id = p_user and m.status = 'completed' and m.completed_at is not null
        and extract(hour from m.completed_at at time zone 'America/Halifax') between 2 and 4
        and not public.sq_is_test_account(m.creator_id)  -- c332
        and (m.opponent_id is null or not public.sq_is_test_account(m.opponent_id))
    union all
    select 1 from sn_daily_feeds
      where user_id = p_user and is_complete = true and played_at is not null
        and extract(hour from played_at at time zone 'America/Halifax') between 2 and 4
    union all
    select 1 from yahdle_games g join yahdle_players yp on yp.game_id = g.id
      where yp.user_id = p_user and g.status = 'finished' and g.finished_at is not null
        and extract(hour from g.finished_at at time zone 'America/Halifax') between 2 and 4
        and not exists (  -- c332
          select 1 from yahdle_players x
          where x.game_id = g.id and public.sq_is_test_account(x.user_id)
        )
  );
$function$;

-- ============================================================================
-- rook_has_landslide
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_has_landslide(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    -- Wordy
    select 1
    from games g
    join game_players me  on me.game_id = g.id and me.user_id = p_user and me.is_winner = true
    join game_players opp on opp.game_id = g.id and opp.user_id <> p_user
    join profiles po on po.id = opp.user_id and coalesce(po.is_bot, false) = false
    where g.status = 'finished'
      and (select count(*) from game_players x where x.game_id = g.id) = 2
      and opp.score >= 1 and me.score >= 2 * opp.score
      and not public.sq_is_test_account(po.id)  -- c332
    union all
    -- Rungles
    select 1
    from rg_games g
    join rg_players me  on me.game_id = g.id and me.user_id = p_user and me.player_idx = g.winner_player_idx
    join rg_players opp on opp.game_id = g.id and opp.user_id <> p_user
    join profiles po on po.id = opp.user_id and coalesce(po.is_bot, false) = false
    where g.status = 'complete'
      and (select count(*) from rg_players x where x.game_id = g.id) = 2
      and opp.score >= 1 and me.score >= 2 * opp.score
      and not public.sq_is_test_account(po.id)  -- c332
    union all
    -- Yahdle
    select 1
    from yahdle_games g
    join yahdle_players me  on me.game_id = g.id and me.user_id = p_user and me.is_winner = true
    join yahdle_players opp on opp.game_id = g.id and opp.user_id <> p_user
    join profiles po on po.id = opp.user_id and coalesce(po.is_bot, false) = false
    where g.status = 'finished'
      and (select count(*) from yahdle_players x where x.game_id = g.id) = 2
      and opp.total_score >= 1 and me.total_score >= 2 * opp.total_score
      and not public.sq_is_test_account(po.id)  -- c332
  );
$function$;

-- ============================================================================
-- rook_has_comeback
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_has_comeback(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with wordy_games as (
    select g.id as game_id,
           (select x.user_id from game_players x
              where x.game_id = g.id and x.user_id <> p_user limit 1) as opp
    from games g
    join game_players me on me.game_id = g.id and me.user_id = p_user and me.is_winner = true
    where g.status = 'finished'
      and (select count(*) from game_players x where x.game_id = g.id) = 2
      and exists (select 1 from game_players o join profiles po on po.id = o.user_id
                  where o.game_id = g.id and o.user_id <> p_user and coalesce(po.is_bot, false) = false
                    and not public.sq_is_test_account(o.user_id))  -- c332
  ),
  wordy_tl as (
    select cg.game_id,
           sum(case when m.user_id = p_user  then m.score else 0 end)
             over (partition by m.game_id order by m.created_at, m.id) as w_cum,
           sum(case when m.user_id = cg.opp then m.score else 0 end)
             over (partition by m.game_id order by m.created_at, m.id) as l_cum
    from wordy_games cg
    join game_moves m on m.game_id = cg.game_id
  ),
  rg_games_won as (
    select g.id as game_id,
           (select x.user_id from rg_players x
              where x.game_id = g.id and x.user_id <> p_user limit 1) as opp
    from rg_games g
    join rg_players me on me.game_id = g.id and me.user_id = p_user and me.player_idx = g.winner_player_idx
    where g.status = 'complete'
      and (select count(*) from rg_players x where x.game_id = g.id) = 2
      and exists (select 1 from rg_players o join profiles po on po.id = o.user_id
                  where o.game_id = g.id and o.user_id <> p_user and coalesce(po.is_bot, false) = false
                    and not public.sq_is_test_account(o.user_id))  -- c332
  ),
  rg_tl as (
    select cg.game_id,
           sum(case when r.player_user_id = p_user  then r.rung_score else 0 end)
             over (partition by r.game_id order by r.created_at, r.id) as w_cum,
           sum(case when r.player_user_id = cg.opp then r.rung_score else 0 end)
             over (partition by r.game_id order by r.created_at, r.id) as l_cum
    from rg_games_won cg
    join rg_rungs r on r.game_id = cg.game_id
  )
  select exists (select 1 from wordy_tl where l_cum > w_cum)
      or exists (select 1 from rg_tl    where l_cum > w_cum);
$function$;

-- ============================================================================
-- rook_hype_detect
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_hype_detect(p_lookback interval DEFAULT '02:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_since timestamptz := now() - p_lookback;
  v_inserted int := 0;
  v_n int;
begin
  -- 3a. WORDY BINGO — all 7 tiles in one move. No bot games. No test accounts (c332).
  insert into rook_hype_outbox (event_key, type, game, user_id, username, discord_id, detail, occurred_at)
  select 'wordy_bingo:wordy:' || m.user_id || ':' || extract(epoch from m.created_at),
         'wordy_bingo', 'wordy', m.user_id, p.username, dl.discord_id,
         jsonb_build_object('words', to_jsonb(m.words_formed), 'score', m.score),
         m.created_at
  from game_moves m
  join profiles p       on p.id = m.user_id
  join discord_links dl on dl.user_id = m.user_id
  where m.move_type = 'place'
    and m.tiles_placed is not null
    and jsonb_array_length(m.tiles_placed) = 7
    and m.created_at > v_since and m.created_at <= now()
    and coalesce((p.hype_prefs ->> 'wordy_bingo')::boolean, true)
    and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
    and coalesce(p.is_bot, false) = false
    and not public.sq_is_test_account(p.id)  -- c332
    and not exists (
      select 1 from game_players gp join profiles bp on bp.id = gp.user_id
      where gp.game_id = m.game_id and coalesce(bp.is_bot, false) = true
    )
    and not exists (  -- c332: no test account seated
      select 1 from game_players gx2
      where gx2.game_id = m.game_id and public.sq_is_test_account(gx2.user_id)
    )
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 3b. YAHDLE CLEAN SCORECARD — all 12 categories, no zero anywhere.
  insert into rook_hype_outbox (event_key, type, game, user_id, username, discord_id, detail, occurred_at)
  select 'yahdle_clean:yahdle:' || yp.user_id || ':' || extract(epoch from g.finished_at),
         'yahdle_clean', 'yahdle', yp.user_id, p.username, dl.discord_id,
         jsonb_build_object('total', yp.total_score),
         g.finished_at
  from yahdle_games g
  join yahdle_players yp on yp.game_id = g.id
  join profiles p        on p.id = yp.user_id
  join discord_links dl  on dl.user_id = yp.user_id
  where g.status = 'finished'
    and g.finished_at > v_since and g.finished_at <= now()
    and yp.scores is not null
    and (select count(*) from jsonb_each(yp.scores)) = 12
    and (select bool_and((v.value ->> 'score')::int > 0) from jsonb_each(yp.scores) v)
    and coalesce((p.hype_prefs ->> 'yahdle_clean')::boolean, true)
    and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
    and not public.sq_is_test_account(p.id)  -- c332
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 3c. RUNGLES GOLD-PERFECT — gold position on every rung of a finished MP game.
  insert into rook_hype_outbox (event_key, type, game, user_id, username, discord_id, detail, occurred_at)
  select 'rungles_gold:rungles:' || rp.user_id || ':' || extract(epoch from g.finished_at),
         'rungles_gold', 'rungles', rp.user_id, p.username, dl.discord_id,
         jsonb_build_object('rungs', x.total),
         g.finished_at
  from rg_games g
  join rg_players rp on rp.game_id = g.id
  join profiles p    on p.id = rp.user_id
  join discord_links dl on dl.user_id = rp.user_id
  join lateral (
    select count(*) as total,
           count(*) filter (
             where r.word_sources is not null
               and r.word_sources[r.premium_pos] is not null
               and r.word_sources[r.premium_pos] <> 0
               and not (r.premium_pos = any(coalesce(r.blank_positions, array[]::int[])))
           ) as gold,
           bool_and(r.word_sources is not null) as all_sourced
    from rg_rungs r
    where r.game_id = g.id and r.player_idx = rp.player_idx
  ) x on true
  where g.status = 'complete'
    and coalesce(g.closed_by_admin, false) = false
    and g.finished_at > v_since and g.finished_at <= now()
    and x.total > 0 and x.all_sourced and x.gold = x.total
    and coalesce((p.hype_prefs ->> 'rungles_gold')::boolean, true)
    and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
    and not public.sq_is_test_account(p.id)  -- c332
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 3d. SNIBBLE MOUTHFUL — daily feed finished with a 7+ letter word in it.
  -- Length only, never the word: dailies share letters, the word is a spoiler
  -- for players who haven't fed yet (c293).
  insert into rook_hype_outbox (event_key, type, game, user_id, username, discord_id, detail, occurred_at)
  select 'snibble_mouthful:snibble:' || f.user_id || ':' || extract(epoch from f.completed_at),
         'snibble_mouthful', 'snibble', f.user_id, p.username, dl.discord_id,
         jsonb_build_object(
           'len', (select max(length(w)) from unnest(f.words_fed) w),
           'score', f.score
         ),
         f.completed_at
  from sn_daily_feeds f
  join profiles p       on p.id = f.user_id
  join discord_links dl on dl.user_id = f.user_id
  where f.completed_at > v_since and f.completed_at <= now()
    and f.is_complete = true
    and array_length(f.words_fed, 1) is not null
    and (select max(length(w)) from unnest(f.words_fed) w) >= 7
    and coalesce((p.hype_prefs ->> 'snibble_mouthful')::boolean, true)
    and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
    and coalesce(p.is_bot, false) = false
    and not public.sq_is_test_account(p.id)  -- c332
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 6. OUBLEX DEATHLESS — daily dungeon cleared at the top rank (285+, v3 curve).
  insert into rook_hype_outbox (event_key, type, game, user_id, username, discord_id, detail, occurred_at)
  select 'oublex_deathless:oublex:' || r.user_id || ':' || extract(epoch from r.completed_at),
         'oublex_deathless', 'oublex', r.user_id, p.username, dl.discord_id,
         jsonb_build_object('score', r.score),
         r.completed_at
  from oublex_solo_results r
  join profiles p       on p.id = r.user_id
  join discord_links dl on dl.user_id = r.user_id
  where r.completed_at > v_since and r.completed_at <= now()
    and r.score >= 285
    and coalesce((p.hype_prefs ->> 'oublex_deathless')::boolean, true)
    and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
    and coalesce(p.is_bot, false) = false
    and not public.sq_is_test_account(p.id)  -- c332
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 4 + 2. PERSONAL BEST / BOUNTY. Candidates are plays INSIDE the window (near
  -- zero per tick); prior bests are computed per candidate against strictly
  -- earlier plays — the cost lands per new play, not per poll (review P1-4).
  -- A global-record break posts as bounty and suppresses the personal-best echo,
  -- same as the original window-function version.
  -- c332: test-account plays never enter `cand` (so they can't generate an
  -- event) and are excluded from the `prior_global_max` scans (so a test
  -- account's score can never set the bar a real player has to beat).
  with cand as (
    -- Wordy: single-game score in a finished human game.
    select 'wordy'::text as game, gp.user_id, gp.score::int as score, g.finished_at as occurred_at
    from game_players gp
    join games g on g.id = gp.game_id
    where g.status = 'finished' and g.finished_at is not null
      and g.finished_at > v_since and g.finished_at <= now()
      and coalesce(g.closed_by_admin, false) = false and g.forfeit_user_id is null
      and not public.sq_is_test_account(gp.user_id)  -- c332
      and not exists (
        select 1 from game_players gp2 join profiles bp on bp.id = gp2.user_id
        where gp2.game_id = g.id and coalesce(bp.is_bot, false) = true
      )
    union all
    select 'rungles', user_id, total_score::int, played_at
    from rg_solo_games
    where played_at is not null and played_at > v_since and played_at <= now()
      and not public.sq_is_test_account(user_id)  -- c332
    union all
    select 'snibble', user_id, score::int, played_at
    from sn_daily_feeds
    where is_complete = true and played_at is not null and played_at > v_since and played_at <= now()
      and not public.sq_is_test_account(user_id)  -- c332
    union all
    select 'yahdle', user_id, score::int, completed_at
    from yahdle_solo_results
    where completed_at is not null and completed_at > v_since and completed_at <= now()
      and not public.sq_is_test_account(user_id)  -- c332
  ),
  enriched as (
    select c.*,
      case c.game
        when 'wordy' then (
          select max(gp.score)::int from game_players gp
          join games g on g.id = gp.game_id
          where gp.user_id = c.user_id
            and g.status = 'finished' and g.finished_at is not null and g.finished_at < c.occurred_at
            and coalesce(g.closed_by_admin, false) = false and g.forfeit_user_id is null
            and not exists (select 1 from game_players gp2 join profiles bp on bp.id = gp2.user_id
                            where gp2.game_id = g.id and coalesce(bp.is_bot, false) = true))
        when 'rungles' then (
          select max(total_score)::int from rg_solo_games
          where user_id = c.user_id and played_at is not null and played_at < c.occurred_at)
        when 'snibble' then (
          select max(score)::int from sn_daily_feeds
          where user_id = c.user_id and is_complete = true and played_at is not null and played_at < c.occurred_at)
        when 'yahdle' then (
          select max(score)::int from yahdle_solo_results
          where user_id = c.user_id and completed_at is not null and completed_at < c.occurred_at)
      end as prior_user_max,
      case c.game
        when 'wordy' then (
          select max(gp.score)::int from game_players gp
          join games g on g.id = gp.game_id
          where g.status = 'finished' and g.finished_at is not null and g.finished_at < c.occurred_at
            and coalesce(g.closed_by_admin, false) = false and g.forfeit_user_id is null
            and not public.sq_is_test_account(gp.user_id)  -- c332
            and not exists (select 1 from game_players gp2 join profiles bp on bp.id = gp2.user_id
                            where gp2.game_id = g.id and coalesce(bp.is_bot, false) = true))
        when 'rungles' then (
          select max(total_score)::int from rg_solo_games
          where played_at is not null and played_at < c.occurred_at
            and not public.sq_is_test_account(user_id))  -- c332
        when 'snibble' then (
          select max(score)::int from sn_daily_feeds
          where is_complete = true and played_at is not null and played_at < c.occurred_at
            and not public.sq_is_test_account(user_id))  -- c332
        when 'yahdle' then (
          select max(score)::int from yahdle_solo_results
          where completed_at is not null and completed_at < c.occurred_at
            and not public.sq_is_test_account(user_id))  -- c332
      end as prior_global_max
    from cand c
  )
  insert into rook_hype_outbox (event_key, type, game, user_id, username, discord_id, detail, occurred_at)
  select case when e.prior_global_max is not null and e.score > e.prior_global_max
              then 'bounty' else 'personal_best' end
           || ':' || e.game || ':' || e.user_id || ':' || extract(epoch from e.occurred_at),
         case when e.prior_global_max is not null and e.score > e.prior_global_max
              then 'bounty' else 'personal_best' end,
         e.game, e.user_id, p.username, dl.discord_id,
         jsonb_build_object('score', e.score,
                            'prev', case when e.prior_global_max is not null and e.score > e.prior_global_max
                                         then e.prior_global_max else e.prior_user_max end),
         e.occurred_at
  from enriched e
  join profiles p       on p.id = e.user_id
  join discord_links dl on dl.user_id = e.user_id
  where (
          (e.prior_global_max is not null and e.score > e.prior_global_max
           and coalesce((p.hype_prefs ->> 'bounty')::boolean, true))
          or
          (not (e.prior_global_max is not null and e.score > e.prior_global_max)
           and e.prior_user_max is not null and e.score > e.prior_user_max
           and coalesce((p.hype_prefs ->> 'personal_best')::boolean, true))
        )
    and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
    and coalesce(p.is_bot, false) = false
    and not public.sq_is_test_account(p.id)  -- c332
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 5. RIVALRY — pair has met >=4 times, close record (win gap <= 1). Candidates
  -- are meetings inside the window; the pair record is one aggregate over that
  -- pair's earlier meetings.
  -- `not materialized`: meet is referenced twice (candidate discovery + the pair
  -- record). Materialized it would rebuild all-history head-to-head every run;
  -- inlined, cand's window predicate and the lateral's pair filter push down.
  -- c332: a game with any test account seated never becomes a `meet` row, so
  -- test accounts can never form or feed a rivalry pair.
  with meet as not materialized (
    select 'wordy'::text as game, g.finished_at,
           a.user_id as p1, b.user_id as p2,
           case when a.is_winner and not b.is_winner then a.user_id
                when b.is_winner and not a.is_winner then b.user_id end as winner
    from games g
    join game_players a on a.game_id = g.id
    join game_players b on b.game_id = g.id and b.user_id > a.user_id
    where g.status = 'finished' and g.finished_at is not null
      and coalesce(g.closed_by_admin, false) = false and g.forfeit_user_id is null
      and (select count(*) from game_players x where x.game_id = g.id) = 2
      and not exists (select 1 from game_players gp join profiles bp on bp.id = gp.user_id
                      where gp.game_id = g.id and coalesce(bp.is_bot, false) = true)
      and not exists (select 1 from game_players gx2  -- c332
                      where gx2.game_id = g.id and public.sq_is_test_account(gx2.user_id))
    union all
    select 'rungles', g.finished_at, a.user_id, b.user_id,
           case when g.winner_player_idx = a.player_idx then a.user_id
                when g.winner_player_idx = b.player_idx then b.user_id end
    from rg_games g
    join rg_players a on a.game_id = g.id
    join rg_players b on b.game_id = g.id and b.user_id > a.user_id
    where g.status = 'complete' and g.finished_at is not null
      and coalesce(g.closed_by_admin, false) = false
      and (select count(*) from rg_players x where x.game_id = g.id) = 2
      and not exists (select 1 from rg_players x  -- c332
                      where x.game_id = g.id and public.sq_is_test_account(x.user_id))
    union all
    select 'snibble', m.completed_at,
           least(m.creator_id, m.opponent_id), greatest(m.creator_id, m.opponent_id),
           m.winner_id
    from sn_matches m
    where m.status = 'completed' and coalesce(m.closed_by_admin, false) = false
      and m.opponent_id is not null and m.completed_at is not null
      and not public.sq_is_test_account(m.creator_id)   -- c332
      and not public.sq_is_test_account(m.opponent_id)  -- c332
    union all
    select 'yahdle', g.finished_at, a.user_id, b.user_id, g.winner_user_id
    from yahdle_games g
    join yahdle_players a on a.game_id = g.id
    join yahdle_players b on b.game_id = g.id and b.user_id > a.user_id
    where g.status = 'finished' and g.finished_at is not null
      and g.forfeit_user_id is null and g.max_players = 2
      and not exists (select 1 from yahdle_players x  -- c332
                      where x.game_id = g.id and public.sq_is_test_account(x.user_id))
  ),
  cand as (
    select * from meet where finished_at > v_since and finished_at <= now()
  ),
  scored as (
    select c.*, h.meetings, h.wins1, h.wins2
    from cand c
    join lateral (
      select count(*) as meetings,
             count(*) filter (where m.winner = c.p1) as wins1,
             count(*) filter (where m.winner = c.p2) as wins2
      from meet m
      where m.game = c.game and m.p1 = c.p1 and m.p2 = c.p2
        and m.finished_at <= c.finished_at
    ) h on true
  )
  insert into rook_hype_outbox (event_key, type, game, user_id, username, discord_id, detail, occurred_at)
  select 'rivalry:' || s.game || ':' || s.p1 || ':' || s.p2 || ':' || extract(epoch from s.finished_at),
         'rivalry', s.game, null, null, null,
         jsonb_build_object('a', pa.username, 'b', pb.username,
                            'wins_a', s.wins1, 'wins_b', s.wins2, 'meetings', s.meetings),
         s.finished_at
  from scored s
  join profiles pa on pa.id = s.p1
  join profiles pb on pb.id = s.p2
  join discord_links da on da.user_id = s.p1
  join discord_links db on db.user_id = s.p2
  where s.meetings >= 4
    and abs(s.wins1 - s.wins2) <= 1
    and coalesce((pa.hype_prefs ->> 'rivalry')::boolean, true)
    and coalesce((pb.hype_prefs ->> 'rivalry')::boolean, true)
    and pa.deactivated_at is null and coalesce(pa.is_anonymized, false) = false
    and pb.deactivated_at is null and coalesce(pb.is_anonymized, false) = false
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  return v_inserted;
end;
$function$;

-- ============================================================================
-- rook_hype_events (legacy, pull-based)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rook_hype_events(p_since timestamp with time zone, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
  -- Every scored single performance, all history (needed to compute prior maxes).
  -- c332: test-account plays are excluded here entirely, so they can never
  -- be the acting player of an event AND can never set prior_global_max /
  -- prior_user_max for anyone (the window functions below run over this
  -- already-filtered set).
  plays as (
    -- Wordy: a single game score in a finished human (non-bot) game.
    select 'wordy'::text as game, gp.user_id, gp.score::int as score, g.finished_at as occurred_at
    from game_players gp
    join games g on g.id = gp.game_id
    where g.status = 'finished' and g.finished_at is not null
      and coalesce(g.closed_by_admin, false) = false and g.forfeit_user_id is null
      and not public.sq_is_test_account(gp.user_id)  -- c332
      and not exists (
        select 1 from game_players gp2 join profiles bp on bp.id = gp2.user_id
        where gp2.game_id = g.id and coalesce(bp.is_bot, false) = true
      )
    union all
    select 'rungles', user_id, total_score::int, played_at
    from rg_solo_games where played_at is not null
      and not public.sq_is_test_account(user_id)  -- c332
    union all
    select 'snibble', user_id, score::int, played_at
    from sn_daily_feeds where is_complete = true and played_at is not null
      and not public.sq_is_test_account(user_id)  -- c332
    union all
    select 'yahdle', user_id, score::int, completed_at
    from yahdle_solo_results where completed_at is not null
      and not public.sq_is_test_account(user_id)  -- c332
  ),
  ranked as (
    select p.*,
      max(score) over (partition by game           order by occurred_at, user_id
                       rows between unbounded preceding and 1 preceding) as prior_global_max,
      max(score) over (partition by game, user_id  order by occurred_at
                       rows between unbounded preceding and 1 preceding) as prior_user_max
    from plays p
  ),

  -- Head-to-head history for rivalries: one row per finished 2-player human game,
  -- pair normalized as (p1 < p2), with the winning user_id (null = tie). Per game.
  -- c332: a game with any test account seated never becomes an h2h row, so
  -- test accounts can never form or feed a rivalry pair.
  h2h as (
    select 'wordy'::text as game, g.finished_at,
           a.user_id as p1, b.user_id as p2,
           case when a.is_winner and not b.is_winner then a.user_id
                when b.is_winner and not a.is_winner then b.user_id end as winner
    from games g
    join game_players a on a.game_id = g.id
    join game_players b on b.game_id = g.id and b.user_id > a.user_id   -- one row/pair
    where g.status = 'finished' and g.finished_at is not null
      and coalesce(g.closed_by_admin, false) = false and g.forfeit_user_id is null
      and (select count(*) from game_players x where x.game_id = g.id) = 2
      and not exists (select 1 from game_players gp join profiles bp on bp.id = gp.user_id
                      where gp.game_id = g.id and coalesce(bp.is_bot, false) = true)
      and not exists (select 1 from game_players gx2  -- c332
                      where gx2.game_id = g.id and public.sq_is_test_account(gx2.user_id))
    union all
    select 'rungles', g.finished_at, a.user_id, b.user_id,
           case when g.winner_player_idx = a.player_idx then a.user_id
                when g.winner_player_idx = b.player_idx then b.user_id end
    from rg_games g
    join rg_players a on a.game_id = g.id
    join rg_players b on b.game_id = g.id and b.user_id > a.user_id
    where g.status = 'complete' and g.finished_at is not null
      and coalesce(g.closed_by_admin, false) = false
      and (select count(*) from rg_players x where x.game_id = g.id) = 2
      and not exists (select 1 from rg_players x  -- c332
                      where x.game_id = g.id and public.sq_is_test_account(x.user_id))
    union all
    select 'snibble', m.completed_at,
           least(m.creator_id, m.opponent_id), greatest(m.creator_id, m.opponent_id),
           m.winner_id
    from sn_matches m
    where m.status = 'completed' and coalesce(m.closed_by_admin, false) = false
      and m.opponent_id is not null and m.completed_at is not null
      and not public.sq_is_test_account(m.creator_id)   -- c332
      and not public.sq_is_test_account(m.opponent_id)  -- c332
    union all
    select 'yahdle', g.finished_at, a.user_id, b.user_id, g.winner_user_id
    from yahdle_games g
    join yahdle_players a on a.game_id = g.id
    join yahdle_players b on b.game_id = g.id and b.user_id > a.user_id
    where g.status = 'finished' and g.finished_at is not null
      and g.forfeit_user_id is null and g.max_players = 2
      and not exists (select 1 from yahdle_players x  -- c332
                      where x.game_id = g.id and public.sq_is_test_account(x.user_id))
  ),
  h2h_ranked as (
    select h.*,
           count(*)                          over w as meetings,
           count(*) filter (where winner = p1) over w as wins1,
           count(*) filter (where winner = p2) over w as wins2
    from h2h h
    window w as (partition by game, p1, p2 order by finished_at
                 rows between unbounded preceding and current row)
  ),

  events as (
    -- 3a. WORDY BINGO — all 7 tiles placed in one move (fires on the move). No bot games.
    select 'wordy_bingo'::text as type, 'wordy'::text as game,
           m.user_id, p.username, dl.discord_id,
           jsonb_build_object('words', to_jsonb(m.words_formed), 'score', m.score) as detail,
           m.created_at as occurred_at
    from game_moves m
    join profiles p       on p.id = m.user_id
    join discord_links dl  on dl.user_id = m.user_id
    where m.move_type = 'place'
      and m.tiles_placed is not null
      and jsonb_array_length(m.tiles_placed) = 7
      and m.created_at > p_since
      and coalesce((p.hype_prefs ->> 'wordy_bingo')::boolean, true)
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
      and not public.sq_is_test_account(p.id)  -- c332
      and not exists (
        select 1 from game_players gp join profiles bp on bp.id = gp.user_id
        where gp.game_id = m.game_id and coalesce(bp.is_bot, false) = true
      )
      and not exists (  -- c332
        select 1 from game_players gx2
        where gx2.game_id = m.game_id and public.sq_is_test_account(gx2.user_id)
      )

    union all
    -- 3b. YAHDLE CLEAN SCORECARD — all 12 categories completed with NO zero anywhere.
    select 'yahdle_clean', 'yahdle',
           yp.user_id, p.username, dl.discord_id,
           jsonb_build_object('total', yp.total_score),
           g.finished_at
    from yahdle_games g
    join yahdle_players yp on yp.game_id = g.id
    join profiles p       on p.id = yp.user_id
    join discord_links dl  on dl.user_id = yp.user_id
    where g.status = 'finished'
      and g.finished_at > p_since
      and yp.scores is not null
      and (select count(*) from jsonb_each(yp.scores)) = 12
      and (select bool_and((v.value ->> 'score')::int > 0) from jsonb_each(yp.scores) v)
      and coalesce((p.hype_prefs ->> 'yahdle_clean')::boolean, true)
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and not public.sq_is_test_account(p.id)  -- c332

    union all
    -- 3c. RUNGLES GOLD-PERFECT — hit the 2x gold (premium) position on EVERY rung of a
    -- finished game (fresh non-blank tile on premium_pos, same rule as scoring). MP only.
    select 'rungles_gold', 'rungles',
           rp.user_id, p.username, dl.discord_id,
           jsonb_build_object('rungs', x.total), g.finished_at
    from rg_games g
    join rg_players rp on rp.game_id = g.id
    join profiles p    on p.id = rp.user_id
    join discord_links dl on dl.user_id = rp.user_id
    join lateral (
      select count(*) as total,
             count(*) filter (
               where r.word_sources is not null
                 and r.word_sources[r.premium_pos] is not null
                 and r.word_sources[r.premium_pos] <> 0
                 and not (r.premium_pos = any(coalesce(r.blank_positions, array[]::int[])))
             ) as gold,
             bool_and(r.word_sources is not null) as all_sourced
      from rg_rungs r
      where r.game_id = g.id and r.player_idx = rp.player_idx
    ) x on true
    where g.status = 'complete'
      and coalesce(g.closed_by_admin, false) = false
      and g.finished_at > p_since
      and x.total > 0 and x.all_sourced and x.gold = x.total
      and coalesce((p.hype_prefs ->> 'rungles_gold')::boolean, true)
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and not public.sq_is_test_account(p.id)  -- c332

    union all
    -- 3d. SNIBBLE MOUTHFUL — finished the daily feed with a long word (7+ letters)
    -- in it. sn_daily_feeds is one mutable row/day and played_at freezes at the
    -- first feed, so completed_at (set once, at completion) is the clean per-day
    -- cursor. {word} = the longest word fed that day. words_fed is a text[].
    select 'snibble_mouthful', 'snibble',
           f.user_id, p.username, dl.discord_id,
           jsonb_build_object(
             'word', initcap((select w from unnest(f.words_fed) w order by length(w) desc, w limit 1)),
             'score', f.score
           ) as detail,
           f.completed_at
    from sn_daily_feeds f
    join profiles p       on p.id = f.user_id
    join discord_links dl  on dl.user_id = f.user_id
    where f.completed_at > p_since
      and f.is_complete = true
      and array_length(f.words_fed, 1) is not null
      and (select max(length(w)) from unnest(f.words_fed) w) >= 7
      and coalesce((p.hype_prefs ->> 'snibble_mouthful')::boolean, true)
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
      and not public.sq_is_test_account(p.id)  -- c332

    union all
    -- 4. PERSONAL BEST — beat your own prior best in a game. First game excluded
    -- (needs a prior play). Suppressed when the same play is also a global record
    -- (that posts as a bounty instead).
    select 'personal_best', r.game, r.user_id, p.username, dl.discord_id,
           jsonb_build_object('score', r.score, 'prev', r.prior_user_max), r.occurred_at
    from ranked r
    join profiles p      on p.id = r.user_id
    join discord_links dl on dl.user_id = r.user_id
    where r.occurred_at > p_since
      and r.prior_user_max is not null
      and r.score > r.prior_user_max
      and not (r.prior_global_max is not null and r.score > r.prior_global_max)  -- a record posts as bounty
      and coalesce((p.hype_prefs ->> 'personal_best')::boolean, true)
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
      and not public.sq_is_test_account(p.id)  -- c332

    union all
    -- 2. BOUNTY — broke the game's all-time high-score record (not the first ever play).
    select 'bounty', r.game, r.user_id, p.username, dl.discord_id,
           jsonb_build_object('score', r.score, 'prev', r.prior_global_max), r.occurred_at
    from ranked r
    join profiles p      on p.id = r.user_id
    join discord_links dl on dl.user_id = r.user_id
    where r.occurred_at > p_since
      and r.prior_global_max is not null
      and r.score > r.prior_global_max
      and coalesce((p.hype_prefs ->> 'bounty')::boolean, true)
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
      and not public.sq_is_test_account(p.id)  -- c332

    union all
    -- 5. RIVALRY — a per-game pairing that has now met >=4 times with a close record
    -- (win gap <= 1). A pair event: both players named, no single user_id. Fires on the
    -- meeting that lands in the window; keeps firing as the rivalry continues (the
    -- bot's per-pair cap keeps it sane). Both players must be linked + not opted out.
    select 'rivalry'::text, hr.game, null::uuid, null::text, null::text,
           jsonb_build_object('a', pa.username, 'b', pb.username,
                              'wins_a', hr.wins1, 'wins_b', hr.wins2,
                              'meetings', hr.meetings),
           hr.finished_at
    from h2h_ranked hr
    join profiles pa on pa.id = hr.p1
    join profiles pb on pb.id = hr.p2
    join discord_links da on da.user_id = hr.p1
    join discord_links db on db.user_id = hr.p2
    where hr.finished_at > p_since
      and hr.meetings >= 4
      and abs(hr.wins1 - hr.wins2) <= 1
      and coalesce((pa.hype_prefs ->> 'rivalry')::boolean, true)
      and coalesce((pb.hype_prefs ->> 'rivalry')::boolean, true)
      and pa.deactivated_at is null and coalesce(pa.is_anonymized, false) = false
      and pb.deactivated_at is null and coalesce(pb.is_anonymized, false) = false

    union all
    -- 6. OUBLEX DEATHLESS — cleared the daily dungeon at the top rank (170+ damage,
    -- the "Deathless" clear-rank). Solo results are written once at game-over, so
    -- completed_at is a clean per-run cursor; fires once per qualifying run.
    select 'oublex_deathless', 'oublex',
           r.user_id, p.username, dl.discord_id,
           jsonb_build_object('score', r.score),
           r.completed_at
    from oublex_solo_results r
    join profiles p       on p.id = r.user_id
    join discord_links dl  on dl.user_id = r.user_id
    where r.completed_at > p_since
      and r.score >= 170
      and coalesce((p.hype_prefs ->> 'oublex_deathless')::boolean, true)
      and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
      and coalesce(p.is_bot, false) = false
      and not public.sq_is_test_account(p.id)  -- c332
  )

  select coalesce(
    (select jsonb_agg(row_to_json(e) order by e.occurred_at)
     from (select * from events order by occurred_at
           limit least(greatest(p_limit, 1), 500)) e),
    '[]'::jsonb
  );
$function$;

-- ============================================================================
-- get_sq_stats
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_sq_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id      uuid := auth.uid();
  v_member_since timestamptz;
  v_wordy_multi  int;
  v_rg_multi     int;
  v_rg_solo      int;
  v_sn_solo      int;
  v_sn_multi     int;
  v_yh_solo      int;
  v_yh_multi     int;
  v_ob_solo      int;
  v_streak       int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT created_at INTO v_member_since
    FROM public.profiles WHERE id = v_user_id;

  -- c332: MP counts exclude games where any seated player (including the
  -- caller's opponent) is a test account. Solo counts are left unchanged
  -- (no other seated player to taint them).
  SELECT COUNT(*) INTO v_wordy_multi
    FROM public.game_players gp
    WHERE gp.user_id = v_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.game_players x
        WHERE x.game_id = gp.game_id AND public.sq_is_test_account(x.user_id)
      );

  SELECT COUNT(*) INTO v_rg_multi
    FROM public.rg_players rp
    WHERE rp.user_id = v_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.rg_players x
        WHERE x.game_id = rp.game_id AND public.sq_is_test_account(x.user_id)
      );

  SELECT COUNT(*) INTO v_rg_solo
    FROM public.rg_solo_games WHERE user_id = v_user_id;

  SELECT COUNT(*) INTO v_sn_solo
    FROM public.sn_daily_feeds
    WHERE user_id = v_user_id AND is_complete;

  SELECT COUNT(*) INTO v_sn_multi
    FROM public.sn_matches m
    WHERE (m.creator_id = v_user_id OR m.opponent_id = v_user_id)
      AND NOT public.sq_is_test_account(m.creator_id)
      AND (m.opponent_id IS NULL OR NOT public.sq_is_test_account(m.opponent_id));

  SELECT COUNT(*) INTO v_yh_solo
    FROM public.yahdle_solo_results WHERE user_id = v_user_id;

  SELECT COUNT(*) INTO v_yh_multi
    FROM public.yahdle_games g
    WHERE (g.created_by = v_user_id OR g.invited_user_id = v_user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.yahdle_players x
        WHERE x.game_id = g.id AND public.sq_is_test_account(x.user_id)
      );

  SELECT COUNT(*) INTO v_ob_solo
    FROM public.oublex_solo_results WHERE user_id = v_user_id;

  -- Daily streak: gather distinct play dates across every SQ game, group
  -- consecutive runs by (date - row_number) trick, and pick the run whose
  -- last day is today or yesterday. If the most recent play is older than
  -- yesterday, the streak is 0. All dates are Atlantic (America/Halifax);
  -- "today"/"yesterday" are measured against the Atlantic current date too.
  -- (Left unchanged for c332 — this is the caller's own activity, same
  -- reasoning as daily_streak_for.)
  WITH play_dates AS (
    SELECT DISTINCT (created_at AT TIME ZONE 'America/Halifax')::date AS d
      FROM public.game_moves WHERE user_id = v_user_id
    UNION
    SELECT DISTINCT (created_at AT TIME ZONE 'America/Halifax')::date
      FROM public.rg_rungs WHERE player_user_id = v_user_id
    UNION
    SELECT DISTINCT (played_at AT TIME ZONE 'America/Halifax')::date
      FROM public.rg_solo_games WHERE user_id = v_user_id
    UNION
    SELECT DISTINCT feed_date
      FROM public.sn_daily_feeds WHERE user_id = v_user_id AND is_complete
    UNION
    SELECT DISTINCT play_date
      FROM public.yahdle_solo_results WHERE user_id = v_user_id
    UNION
    SELECT DISTINCT play_date
      FROM public.oublex_solo_results WHERE user_id = v_user_id
  ),
  ranked AS (
    SELECT d,
           d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
      FROM play_dates
  ),
  groups AS (
    SELECT grp, MAX(d) AS end_d, COUNT(*)::int AS len
      FROM ranked
      GROUP BY grp
  )
  SELECT COALESCE(MAX(len), 0) INTO v_streak
    FROM groups
    WHERE end_d >= (now() AT TIME ZONE 'America/Halifax')::date - 1;

  RETURN jsonb_build_object(
    'member_since',  v_member_since,
    'wordy_multi',   v_wordy_multi,
    'rungles_multi', v_rg_multi,
    'rungles_solo',  v_rg_solo,
    'snibble_solo',  v_sn_solo,
    'snibble_multi', v_sn_multi,
    'yahdle_solo',   v_yh_solo,
    'yahdle_multi',  v_yh_multi,
    'oublex_solo',   v_ob_solo,
    'daily_streak',  v_streak
  );
END;
$function$;

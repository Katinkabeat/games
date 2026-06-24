-- Rook badge ladder (card c203) — per-player signals for the achievement system.
--
-- Extends the activity-role sync from a 3-role placeholder set to a real ladder:
--   * streak tiers + volume tiers (progression spine)
--   * a welcome badge (played first game)
--   * the weekly champion crown (rotating)
--   * one-time "feats" (first win, night owl, landslide, four feathers, comeback)
--
-- All signals are deterministic from existing game tables. The bot owns the
-- thresholds + which signal maps to which role (config.js ACTIVITY_ROLES); these
-- functions only return the raw numbers/booleans. Service-role only, called via
-- the rook-activity / rook-profile edge functions.
--
-- Design notes:
--   * Wins only count in games with a HUMAN opponent (a non-bot other player) —
--     otherwise players could farm the easy bots for win-feats (Rae, 2026-06-14).
--     This applies to first-win, four-feathers, landslide and comeback. Volume /
--     streak / first-game stay as participation (they count solo + bot games;
--     a participation count isn't exploitable the way a win is, and the solo-only
--     games have no opponent at all).
--   * Landslide = won a 2-player game by >=2x a real (>=1) HUMAN opponent score. The
--     2x rule is scale-free so it works across games with different point ranges.
--     Snibble is excluded (per-round scoring, no single per-player game score).
--   * Comeback = won a 2-player Wordy or Rungles game after trailing at some
--     point (only those two log move-by-move scores; Snibble/Yahdle store finals
--     only, so a comeback is invisible there).

-- ── Volume: total finished games across every SQ game ────────────────
create or replace function public.rook_games_total(p_user uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select count(*) from game_players gp join games g on g.id = gp.game_id
                where gp.user_id = p_user and g.status = 'finished'), 0)
  + coalesce((select count(*) from rg_players rp join rg_games g on g.id = rp.game_id
                where rp.user_id = p_user and g.status = 'complete'), 0)
  + coalesce((select count(*) from rg_solo_games where user_id = p_user), 0)
  + coalesce((select count(*) from sn_daily_feeds where user_id = p_user and is_complete = true), 0)
  + coalesce((select count(distinct rp.match_id) from sn_match_round_plays rp
                join sn_matches m on m.id = rp.match_id
                where rp.user_id = p_user and m.status = 'completed'), 0)
  + coalesce((select count(*) from yahdle_players yp join yahdle_games g on g.id = yp.game_id
                where yp.user_id = p_user and g.status = 'finished'), 0)
  + coalesce((select count(*) from yahdle_solo_results where user_id = p_user), 0);
$$;

-- ── Wins per game (for first-win + four-feathers + the /profile card) ─
create or replace function public.rook_wins_by_game(p_user uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'wordy', coalesce((select count(*) from game_players gp join games g on g.id = gp.game_id
                where gp.user_id = p_user and g.status = 'finished' and gp.is_winner = true
                  and exists (select 1 from game_players o join profiles po on po.id = o.user_id
                              where o.game_id = g.id and o.user_id <> p_user
                                and coalesce(po.is_bot, false) = false)), 0),
    'rungles', coalesce((select count(*) from rg_players rp join rg_games g on g.id = rp.game_id
                where rp.user_id = p_user and g.status = 'complete'
                  and g.winner_player_idx = rp.player_idx
                  and exists (select 1 from rg_players o join profiles po on po.id = o.user_id
                              where o.game_id = g.id and o.user_id <> p_user
                                and coalesce(po.is_bot, false) = false)), 0),
    'snibble', coalesce((select count(*) from sn_matches m
                where m.status = 'completed' and m.winner_id = p_user
                  and exists (select 1 from sn_match_round_plays o join profiles po on po.id = o.user_id
                              where o.match_id = m.id and o.user_id <> p_user
                                and coalesce(po.is_bot, false) = false)), 0),
    'yahdle', coalesce((select count(*) from yahdle_players yp join yahdle_games g on g.id = yp.game_id
                where yp.user_id = p_user and g.status = 'finished' and yp.is_winner = true
                  and exists (select 1 from yahdle_players o join profiles po on po.id = o.user_id
                              where o.game_id = g.id and o.user_id <> p_user
                                and coalesce(po.is_bot, false) = false)), 0)
  );
$$;

-- ── Night owl: finished a game between 2:00 and 4:59 local (Halifax) ──
create or replace function public.rook_has_night_owl(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from games g join game_players gp on gp.game_id = g.id
      where gp.user_id = p_user and g.status = 'finished' and g.finished_at is not null
        and extract(hour from g.finished_at at time zone 'America/Halifax') between 2 and 4
    union all
    select 1 from rg_games g join rg_players rp on rp.game_id = g.id
      where rp.user_id = p_user and g.status = 'complete' and g.finished_at is not null
        and extract(hour from g.finished_at at time zone 'America/Halifax') between 2 and 4
    union all
    select 1 from rg_solo_games
      where user_id = p_user and played_at is not null
        and extract(hour from played_at at time zone 'America/Halifax') between 2 and 4
    union all
    select 1 from sn_matches m join sn_match_round_plays rp on rp.match_id = m.id
      where rp.user_id = p_user and m.status = 'completed' and m.completed_at is not null
        and extract(hour from m.completed_at at time zone 'America/Halifax') between 2 and 4
    union all
    select 1 from sn_daily_feeds
      where user_id = p_user and is_complete = true and played_at is not null
        and extract(hour from played_at at time zone 'America/Halifax') between 2 and 4
    union all
    select 1 from yahdle_games g join yahdle_players yp on yp.game_id = g.id
      where yp.user_id = p_user and g.status = 'finished' and g.finished_at is not null
        and extract(hour from g.finished_at at time zone 'America/Halifax') between 2 and 4
  );
$$;

-- ── Landslide: won a 2-player game by >=2x a real opponent score ──────
create or replace function public.rook_has_landslide(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
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
  );
$$;

-- ── Comeback: won a 2-player Wordy/Rungles game after trailing ────────
-- A single ordered timeline over the game's moves carries each player's running
-- total; if the eventual winner's running total was ever below the opponent's,
-- it was a comeback.
create or replace function public.rook_has_comeback(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with wordy_games as (
    select g.id as game_id,
           (select x.user_id from game_players x
              where x.game_id = g.id and x.user_id <> p_user limit 1) as opp
    from games g
    join game_players me on me.game_id = g.id and me.user_id = p_user and me.is_winner = true
    where g.status = 'finished'
      and (select count(*) from game_players x where x.game_id = g.id) = 2
      and exists (select 1 from game_players o join profiles po on po.id = o.user_id
                  where o.game_id = g.id and o.user_id <> p_user and coalesce(po.is_bot, false) = false)
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
                  where o.game_id = g.id and o.user_id <> p_user and coalesce(po.is_bot, false) = false)
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
$$;

-- ── Bundle every signal for one user (shared by activity sync + profile) ──
create or replace function public.rook_user_signals(p_user uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'daily_streak', public.daily_streak_for(p_user),
    'games_total',  public.rook_games_total(p_user),
    'wins',         public.rook_wins_by_game(p_user),
    'night_owl',    public.rook_has_night_owl(p_user),
    'landslide',    public.rook_has_landslide(p_user),
    'comeback',     public.rook_has_comeback(p_user)
  );
$$;

-- ── Activity sync feed (replaces the v1 streak+champion-only version) ─
create or replace function public.rook_activity()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_lb        jsonb := public.rook_weekly_leaderboards(1); -- last completed week
  v_champions text[];
begin
  select array_agg(distinct (v_lb -> 'games' -> g -> 0 ->> 'username'))
    into v_champions
    from unnest(array['wordy', 'rungles', 'snibble', 'yahdle']) as g
    where (v_lb -> 'games' -> g -> 0 ->> 'username') is not null;

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

-- ── Profile card feed (one player, by Discord id) ────────────────────
create or replace function public.rook_profile(p_discord_id text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user         uuid;
  v_username     text;
  v_member_since timestamptz;
  v_lb           jsonb := public.rook_weekly_leaderboards(1);
  v_champion     boolean;
begin
  select dl.user_id into v_user from discord_links dl where dl.discord_id = p_discord_id;
  if v_user is null then
    return jsonb_build_object('linked', false);
  end if;

  select username, created_at into v_username, v_member_since
    from profiles where id = v_user;

  select bool_or(v_username = (v_lb -> 'games' -> g -> 0 ->> 'username'))
    into v_champion
    from unnest(array['wordy', 'rungles', 'snibble', 'yahdle']) as g;

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
revoke all on function public.rook_games_total(uuid)    from public, anon, authenticated;
revoke all on function public.rook_wins_by_game(uuid)   from public, anon, authenticated;
revoke all on function public.rook_has_night_owl(uuid)  from public, anon, authenticated;
revoke all on function public.rook_has_landslide(uuid)  from public, anon, authenticated;
revoke all on function public.rook_has_comeback(uuid)   from public, anon, authenticated;
revoke all on function public.rook_user_signals(uuid)   from public, anon, authenticated;
revoke all on function public.rook_profile(text)        from public, anon, authenticated;

grant execute on function public.rook_games_total(uuid)    to service_role;
grant execute on function public.rook_wins_by_game(uuid)   to service_role;
grant execute on function public.rook_has_night_owl(uuid)  to service_role;
grant execute on function public.rook_has_landslide(uuid)  to service_role;
grant execute on function public.rook_has_comeback(uuid)   to service_role;
grant execute on function public.rook_user_signals(uuid)   to service_role;
grant execute on function public.rook_profile(text)        to service_role;
-- rook_activity() grant unchanged from rook_account_link.sql (service_role).

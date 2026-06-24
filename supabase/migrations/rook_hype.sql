-- Rook hype auto-posts — detection layer (card c222).
--
-- Deterministic, NO-LLM "highlights reel" events for the Rook Discord bot. The bot
-- polls rook_hype_events(p_since) every ~60s with its last-seen cursor and posts the
-- new events into a dedicated #highlights channel (mutable), with a per-player daily
-- cap. Rook stays READ-ONLY: this is reached through a shared-secret edge function.
--
-- The lean SIX cheer families (Rae-approved 2026-06-16):
--   1. Board movement (unified points board, notable moves only)   [TODO: increment 3]
--   2. Bounties (all-time per-game high-score record broken)        ← increment 2
--   3. Signature plays                                              ← increment 1
--        - wordy_bingo    : all 7 tiles in one play
--        - yahdle_clean   : completed all 12 categories with no zero anywhere
--        - rungles_gold   : hit the 2x gold position on EVERY rung of a finished game
--   4. Personal bests (a new all-time best, first game excluded)    ← increment 2
--   5. Rivalries (per game, >=4 close meetings)                     [TODO: increment 3]
--   6. Milestones — ride existing badge announces, NOT here.
--
-- Personal best vs bounty: a "play" is one scored performance in a game's natural
-- single-performance metric (Wordy = a human-vs-human game score; Rungles/Snibble/
-- Yahdle = a solo/daily score). Window functions give each play the prior best for
-- that player (-> personal_best) and the prior record across everyone (-> bounty),
-- comparing only to strictly-earlier plays, so no separate record storage is needed.
-- A global-record break suppresses the (redundant) personal-best post for the same play.
--
-- Reach + opt-out (all cheers except board movement are linked-only + per-type opt-out):
--   * linked-only  -> inner join discord_links.
--   * per-type opt -> profiles.hype_prefs JSONB; ON unless the player set it false.
--   * exclude deactivated / anonymized / bot players; exclude Wordy bot games.
--
-- Uniform row shape: { type, game, user_id, username, discord_id, detail jsonb, occurred_at }

-- ── Per-player hype opt-out preferences (default opted-in) ────────────
alter table public.profiles
  add column if not exists hype_prefs jsonb not null default '{}'::jsonb;

-- ── Detection RPC ────────────────────────────────────────────────────
create or replace function public.rook_hype_events(
  p_since timestamptz,
  p_limit int default 200
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
  -- Every scored single performance, all history (needed to compute prior maxes).
  plays as (
    -- Wordy: a single game score in a finished human (non-bot) game.
    select 'wordy'::text as game, gp.user_id, gp.score::int as score, g.finished_at as occurred_at
    from game_players gp
    join games g on g.id = gp.game_id
    where g.status = 'finished' and g.finished_at is not null
      and coalesce(g.closed_by_admin, false) = false and g.forfeit_user_id is null
      and not exists (
        select 1 from game_players gp2 join profiles bp on bp.id = gp2.user_id
        where gp2.game_id = g.id and coalesce(bp.is_bot, false) = true
      )
    union all
    select 'rungles', user_id, total_score::int, played_at
    from rg_solo_games where played_at is not null
    union all
    select 'snibble', user_id, score::int, played_at
    from sn_daily_feeds where is_complete = true and played_at is not null
    union all
    select 'yahdle', user_id, score::int, completed_at
    from yahdle_solo_results where completed_at is not null
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
    union all
    select 'snibble', m.completed_at,
           least(m.creator_id, m.opponent_id), greatest(m.creator_id, m.opponent_id),
           m.winner_id
    from sn_matches m
    where m.status = 'completed' and coalesce(m.closed_by_admin, false) = false
      and m.opponent_id is not null and m.completed_at is not null
    union all
    select 'yahdle', g.finished_at, a.user_id, b.user_id, g.winner_user_id
    from yahdle_games g
    join yahdle_players a on a.game_id = g.id
    join yahdle_players b on b.game_id = g.id and b.user_id > a.user_id
    where g.status = 'finished' and g.finished_at is not null
      and g.forfeit_user_id is null and g.max_players = 2
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
      and not exists (
        select 1 from game_players gp join profiles bp on bp.id = gp.user_id
        where gp.game_id = m.game_id and coalesce(bp.is_bot, false) = true
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
  )

  select coalesce(
    (select jsonb_agg(row_to_json(e) order by e.occurred_at)
     from (select * from events order by occurred_at limit greatest(p_limit, 1)) e),
    '[]'::jsonb
  );
$$;

revoke all on function public.rook_hype_events(timestamptz, int) from public, anon, authenticated;
grant execute on function public.rook_hype_events(timestamptz, int) to service_role;

-- ── Per-player opt-out setter (hub Settings → Discord panel) ──────────
-- Mirrors sq_set_invite_pref: SECURITY DEFINER jsonb merge into the caller's own
-- profiles.hype_prefs, so a concurrent write can't clobber. p_enabled=false opts
-- the player OUT of that cheer type. Board movement is mandatory, so not listed.
create or replace function public.sq_set_hype_pref(
  p_key     text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_key not in ('wordy_bingo', 'yahdle_clean', 'rungles_gold',
                   'personal_best', 'bounty', 'rivalry') then
    raise exception 'unknown hype type: %', p_key using errcode = 'check_violation';
  end if;

  update public.profiles
     set hype_prefs = coalesce(hype_prefs, '{}'::jsonb)
                      || jsonb_build_object(p_key, p_enabled)
   where id = auth.uid();
end;
$$;

grant execute on function public.sq_set_hype_pref(text, boolean) to authenticated;

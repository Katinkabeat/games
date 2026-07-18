-- Snibble mouthful: stop revealing the player's word (c293).
--
-- snibble_mouthful's detail carried the player's longest word, but Snibble
-- players share the same daily letters — printing the word in #highlights
-- spoils a top find for anyone who hasn't fed yet. The payload now carries
-- 'len' (the longest word's length) instead of 'word'; the bot renders
-- "a {len} letter word" style lines (messages.js hypeMouthful).
--
-- Same function otherwise: full recreate of rook_hype_detect from
-- rook_hype_outbox.sql with only block 3d's detail changed. Grants are
-- unchanged by CREATE OR REPLACE (same signature). The read-only replay RPC
-- rook_hype_events still emits 'word'; the renderer derives length from it
-- for old-shape payloads, and that path is service_role/diag only.

create or replace function public.rook_hype_detect(p_lookback interval default interval '2 hours')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - p_lookback;
  v_inserted int := 0;
  v_n int;
begin
  -- 3a. WORDY BINGO — all 7 tiles in one move. No bot games.
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
    and not exists (
      select 1 from game_players gp join profiles bp on bp.id = gp.user_id
      where gp.game_id = m.game_id and coalesce(bp.is_bot, false) = true
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
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 6. OUBLEX DEATHLESS — daily dungeon cleared at the top rank (170+).
  insert into rook_hype_outbox (event_key, type, game, user_id, username, discord_id, detail, occurred_at)
  select 'oublex_deathless:oublex:' || r.user_id || ':' || extract(epoch from r.completed_at),
         'oublex_deathless', 'oublex', r.user_id, p.username, dl.discord_id,
         jsonb_build_object('score', r.score),
         r.completed_at
  from oublex_solo_results r
  join profiles p       on p.id = r.user_id
  join discord_links dl on dl.user_id = r.user_id
  where r.completed_at > v_since and r.completed_at <= now()
    and r.score >= 170
    and coalesce((p.hype_prefs ->> 'oublex_deathless')::boolean, true)
    and p.deactivated_at is null and coalesce(p.is_anonymized, false) = false
    and coalesce(p.is_bot, false) = false
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 4 + 2. PERSONAL BEST / BOUNTY. Candidates are plays INSIDE the window (near
  -- zero per tick); prior bests are computed per candidate against strictly
  -- earlier plays — the cost lands per new play, not per poll (review P1-4).
  -- A global-record break posts as bounty and suppresses the personal-best echo,
  -- same as the original window-function version.
  with cand as (
    -- Wordy: single-game score in a finished human game.
    select 'wordy'::text as game, gp.user_id, gp.score::int as score, g.finished_at as occurred_at
    from game_players gp
    join games g on g.id = gp.game_id
    where g.status = 'finished' and g.finished_at is not null
      and g.finished_at > v_since and g.finished_at <= now()
      and coalesce(g.closed_by_admin, false) = false and g.forfeit_user_id is null
      and not exists (
        select 1 from game_players gp2 join profiles bp on bp.id = gp2.user_id
        where gp2.game_id = g.id and coalesce(bp.is_bot, false) = true
      )
    union all
    select 'rungles', user_id, total_score::int, played_at
    from rg_solo_games
    where played_at is not null and played_at > v_since and played_at <= now()
    union all
    select 'snibble', user_id, score::int, played_at
    from sn_daily_feeds
    where is_complete = true and played_at is not null and played_at > v_since and played_at <= now()
    union all
    select 'yahdle', user_id, score::int, completed_at
    from yahdle_solo_results
    where completed_at is not null and completed_at > v_since and completed_at <= now()
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
            and not exists (select 1 from game_players gp2 join profiles bp on bp.id = gp2.user_id
                            where gp2.game_id = g.id and coalesce(bp.is_bot, false) = true))
        when 'rungles' then (
          select max(total_score)::int from rg_solo_games
          where played_at is not null and played_at < c.occurred_at)
        when 'snibble' then (
          select max(score)::int from sn_daily_feeds
          where is_complete = true and played_at is not null and played_at < c.occurred_at)
        when 'yahdle' then (
          select max(score)::int from yahdle_solo_results
          where completed_at is not null and completed_at < c.occurred_at)
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
  on conflict (event_key) do nothing;
  get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;

  -- 5. RIVALRY — pair has met >=4 times, close record (win gap <= 1). Candidates
  -- are meetings inside the window; the pair record is one aggregate over that
  -- pair's earlier meetings.
  -- `not materialized`: meet is referenced twice (candidate discovery + the pair
  -- record). Materialized it would rebuild all-history head-to-head every run;
  -- inlined, cand's window predicate and the lateral's pair filter push down.
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
$$;

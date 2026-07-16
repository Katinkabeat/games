-- Rook review round 2 — DB-side fixes (compiled Lucy + Codex review, 2026-07-16).
-- Cogs c3985/c3986. All changes are create-or-replace / additive; no data dropped.
-- Mirrored into rae-side-quest (the deployed twin) per the source-of-truth note.
--
--   1. rook_profile: the weekly points board was computed BEFORE the link check
--      (declare-block initializer), so unlinked callers paid the most expensive
--      RPC for a { linked: false }. Moved after the check. (Codex P1-3)
--   2. rook_weekly_leaderboards: the Wordy block was missing the closed-by-admin /
--      forfeit / bot-opponent exclusions the points + hype lanes apply. (Codex P1-5)
--   3. Champion-crown knob divergence: rook_activity/rook_profile computed the
--      crown with DEFAULT scoring params while the posted board uses config.js
--      values. Both now take the knobs; the bot forwards its config (same
--      plumbing as rook-weekly-points). (Lucy L2)
--   4. rook_set_setting: select-then-update let two admins toggling in the same
--      read window lose one write. Now a single atomic UPDATE. (Codex P2-5)
--   5. rook_redeem_link_code: concurrent redeems could all pass the < 10 failure
--      check before inserting failures (TOCTOU). Per-discord-id advisory lock
--      serializes them. (Codex P2-3)
--   6. rook_mint_link_code: concurrent mints could leave two active codes for one
--      user. Advisory lock + partial unique index (active = used_at is null)
--      enforce one. (Codex P2-4)
--   7. rook_hype_events: p_limit is now clamped server-side. (Codex P1-4 part)

-- ── 1 + 3a: rook_profile — link check first, scoring knobs forwarded ──────────
-- Signature changes (adds knob params), so drop the old overload first: PostgREST
-- refuses ambiguous rpc() calls when two overloads could match.
drop function if exists public.rook_profile(text);

create or replace function public.rook_profile(
  p_discord_id       text,
  p_win              int default 100,
  p_tie              int default 50,
  p_solo             int default 25,
  p_bot_win          int default 25,
  p_bot_wins_per_day int default 3
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user         uuid;
  v_username     text;
  v_member_since timestamptz;
  v_pts          jsonb;
  v_max          int;
  v_champion     boolean;
begin
  select dl.user_id into v_user from discord_links dl where dl.discord_id = p_discord_id;
  if v_user is null then
    return jsonb_build_object('linked', false);
  end if;

  select username, created_at into v_username, v_member_since
    from profiles where id = v_user;

  -- Only linked callers pay for the points board (review item 1).
  v_pts := public.rook_weekly_points(1, 10, p_win, p_tie, p_solo, p_bot_win, p_bot_wins_per_day);

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

revoke all on function public.rook_profile(text, int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.rook_profile(text, int, int, int, int, int) to service_role;

-- ── 3b: rook_activity — same knob forwarding for the daily role sync ─────────
drop function if exists public.rook_activity();

create or replace function public.rook_activity(
  p_win              int default 100,
  p_tie              int default 50,
  p_solo             int default 25,
  p_bot_win          int default 25,
  p_bot_wins_per_day int default 3
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_pts       jsonb := public.rook_weekly_points(1, 10, p_win, p_tie, p_solo, p_bot_win, p_bot_wins_per_day);
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

revoke all on function public.rook_activity(int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.rook_activity(int, int, int, int, int) to service_role;

-- ── 2: rook_weekly_leaderboards — Wordy exclusion parity ─────────────────────
-- Only the Wordy block changes: closed-by-admin, forfeited, and bot-opponent
-- games no longer count toward the weekly best-score board (they were already
-- excluded from the points + hype lanes).
create or replace function public.rook_weekly_leaderboards(p_week int default 1)
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
          group by r.user_id, p.username
          order by sum(r.score) desc
          limit 5
        ) t
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.rook_weekly_leaderboards(int) from public, anon, authenticated;
grant execute on function public.rook_weekly_leaderboards(int) to service_role;

-- ── 4: rook_set_setting — atomic read-modify-write ───────────────────────────
-- Whitelist carried forward from rook_settings_oublex_snibble.sql (review M1).
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
  v_settings jsonb;
begin
  -- The allow-list. Add new (category, key) pairs here as more runtime toggles
  -- are introduced; never accept an un-listed key.
  if not (
    p_category = 'hype' and p_key in (
      'wordy_bingo', 'yahdle_clean', 'rungles_gold',
      'snibble_mouthful', 'oublex_deathless',
      'personal_best', 'bounty', 'rivalry', 'board_movement'
    )
  ) then
    raise exception 'unknown setting: %.%', p_category, p_key
      using errcode = 'check_violation';
  end if;

  -- Single-statement UPDATE: the row is read under its own lock, so two admins
  -- toggling in the same window can't lose a write (review round 2, item 4).
  -- The CASE creates the category object first (jsonb_set does not create
  -- intermediate objects).
  update public.rook_settings
     set settings = jsonb_set(
           case when coalesce(settings, '{}'::jsonb) ? p_category
                then coalesce(settings, '{}'::jsonb)
                else coalesce(settings, '{}'::jsonb) || jsonb_build_object(p_category, '{}'::jsonb)
           end,
           array[p_category, p_key], to_jsonb(p_enabled), true),
         updated_at = now()
   where id = 1
   returning settings into v_settings;

  return v_settings;
end;
$$;

revoke all on function public.rook_set_setting(text, text, boolean) from public, anon, authenticated;
grant execute on function public.rook_set_setting(text, text, boolean) to service_role;

-- ── 5: rook_redeem_link_code — close the brute-force TOCTOU ──────────────────
-- Concurrent redeems for one Discord id are serialized by a transaction-scoped
-- advisory lock, so N parallel requests can't all pass the < 10 check before any
-- failure row lands. Body otherwise identical to rook_security_hardening.sql.
create or replace function public.rook_redeem_link_code(
  p_code text, p_discord_id text, p_discord_username text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_username text;
  v_fails int;
begin
  -- Serialize per Discord id (review round 2, item 5).
  perform pg_advisory_xact_lock(hashtext(p_discord_id));

  -- Brute-force guard (review M2): cap failed attempts per Discord id in a 1h
  -- window. Returns the SAME generic error as a bad code, so throttling leaks
  -- no signal about which codes were valid.
  select count(*) into v_fails from discord_link_attempts
    where discord_id = p_discord_id
      and attempted_at > now() - interval '1 hour';
  if v_fails >= 10 then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  end if;

  select user_id into v_user from discord_link_codes
    where code = upper(p_code) and used_at is null and expires_at > now()
    for update;
  if v_user is null then
    delete from discord_link_attempts where attempted_at < now() - interval '1 day';
    insert into discord_link_attempts(discord_id) values (p_discord_id);
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

  -- success clears the user's failed-attempt tally
  delete from discord_link_attempts where discord_id = p_discord_id;

  select username into v_username from profiles where id = v_user;
  return jsonb_build_object('ok', true, 'username', v_username);
end;
$$;
revoke all on function public.rook_redeem_link_code(text, text, text) from public, anon, authenticated;
grant execute on function public.rook_redeem_link_code(text, text, text) to service_role;

-- ── 6: one active link code per user ─────────────────────────────────────────
-- Advisory lock serializes concurrent mints; the partial unique index makes the
-- "one active code per user" invariant a database guarantee. Both codes in the
-- race linked the caller's own account, so this is hygiene, not urgency.
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
  -- Serialize per user (review round 2, item 6).
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  update discord_link_codes set used_at = now() where user_id = v_user and used_at is null;
  loop
    v_try := v_try + 1;
    -- 8 chars from an unambiguous alphabet (no 0/O/1/I), CSPRNG-sourced.
    select string_agg(
             substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                    (get_byte(r.rnd, g) % 32) + 1, 1), '')
      into v_code
      from (select extensions.gen_random_bytes(8) as rnd) r,
           generate_series(0, 7) as g;
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
revoke all on function public.rook_mint_link_code() from public, anon, authenticated;
grant execute on function public.rook_mint_link_code() to authenticated;

-- Retire any duplicate active codes before the index lands (keep the newest per
-- user; ties broken by code so the sweep is deterministic).
update public.discord_link_codes c
   set used_at = now()
 where c.used_at is null
   and exists (
     select 1 from public.discord_link_codes d
     where d.user_id = c.user_id and d.used_at is null
       and (d.created_at > c.created_at
            or (d.created_at = c.created_at and d.code > c.code))
   );

create unique index if not exists discord_link_codes_active_user_uidx
  on public.discord_link_codes(user_id)
  where used_at is null;

-- ── 7: rook_hype_events — clamp p_limit server-side ──────────────────────────
-- Body identical to rook_hype.sql (+ snibble/oublex types) except the final
-- LIMIT, now least(greatest(p_limit, 1), 500).
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
  )

  select coalesce(
    (select jsonb_agg(row_to_json(e) order by e.occurred_at)
     from (select * from events order by occurred_at
           limit least(greatest(p_limit, 1), 500)) e),
    '[]'::jsonb
  );
$$;

revoke all on function public.rook_hype_events(timestamptz, int) from public, anon, authenticated;
grant execute on function public.rook_hype_events(timestamptz, int) to service_role;

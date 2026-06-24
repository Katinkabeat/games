-- Read-only weekly leaderboard data for the Rook Discord bot (card c203).
-- Returns top-5 per game for a Mon-Sun week (America/Halifax).
--   p_week = 1 -> previous completed week (Mon..Sun)  [used by the Monday post]
--   p_week = 0 -> current week to date (this Mon..today) [used by /leaderboard]
-- Excludes deactivated and anonymized accounts. Granted to service_role only;
-- the bot calls it through a read-only edge function with the service key server-side.

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
      'wordy', coalesce((
        select jsonb_agg(row_to_json(t)) from (
          select p.username, max(gp.score)::int as score
          from game_players gp
          join games g    on g.id = gp.game_id
          join profiles p on p.id = gp.user_id
          where g.status = 'finished'
            and g.finished_at >= v_start_ts and g.finished_at < v_end_ts
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
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.rook_weekly_leaderboards(int) from public, anon, authenticated;
grant execute on function public.rook_weekly_leaderboards(int) to service_role;

-- ============================================================
-- SQ Daily Reminder — Phase 1
--
-- Hub-level opt-in daily ping. One reminder for ALL daily games
-- (Yahdle, Snibble, and any future daily). User picks a time;
-- the cron in Phase 2 fires once per day at that local time —
-- but ONLY if the user has unplayed dailies.
--
-- Convention: each daily game ships a SQL function
--   <game>_played_daily(uid uuid, ymd date) returns boolean
-- alongside its migrations. The hub registry sq_unplayed_dailies
-- iterates games_catalog where has_daily=true and dispatches by
-- naming convention. Adding a new daily game = ship the function +
-- flip has_daily=true in the catalog. Zero hub-side changes.
-- ============================================================

-- 1. games_catalog.has_daily flag
alter table public.games_catalog
  add column if not exists has_daily boolean not null default false;

update public.games_catalog set has_daily = true where id in ('yahdle', 'snibble');

-- 2. profiles.daily_reminder_time + tz
-- daily_reminder_time NULL = no schedule set (opted out / never set).
-- tz defaults to America/Halifax (matches the daily-rollover the
-- games already use); UI auto-detects from browser on first set.
alter table public.profiles
  add column if not exists daily_reminder_time time;

alter table public.profiles
  add column if not exists daily_reminder_tz text not null default 'America/Halifax';

-- 3. Allow 'daily_reminder' topic in user_notification_prefs.
alter table public.user_notification_prefs
  drop constraint if exists user_notif_prefs_topic_check;

alter table public.user_notification_prefs
  add constraint user_notif_prefs_topic_check
  check (topic in (
    'your_turn', 'invite', 'nudge', 'opponent_joined',
    'friend_request', 'game_finished', 'daily_reminder',
    '_master'
  ));

-- 4. Default for daily_reminder is OFF (opt-in only — pinging
-- everyone by default would be unsolicited).
create or replace function public.sq_notification_default(p_topic text)
returns boolean
language sql
immutable
as $$
  select case p_topic
    when 'your_turn'        then true
    when 'invite'           then true
    when 'nudge'            then true
    when 'opponent_joined'  then false
    when 'friend_request'   then true
    when 'game_finished'    then true
    when 'daily_reminder'   then false
    else true
  end;
$$;

grant execute on function public.sq_notification_default(text)
  to anon, authenticated, service_role;

-- 5. Registry: which dailies has this user not played today?
-- Returns one row per daily-enabled game where the user has NOT
-- completed today's puzzle. ymd is computed in America/Halifax to
-- match the rollover convention all SQ daily games use.
create or replace function public.sq_unplayed_dailies(uid uuid)
returns table(game_id text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  r        record;
  v_ymd    date := (now() at time zone 'America/Halifax')::date;
  v_played boolean;
  v_fname  text;
begin
  for r in
    select id from public.games_catalog
    where has_daily = true and is_published = true
  loop
    v_fname := r.id || '_played_daily';
    -- Defensive: skip games that haven't shipped their check fn yet.
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fname
    ) then
      continue;
    end if;
    execute format('select public.%I($1, $2)', v_fname)
      into v_played using uid, v_ymd;
    if not v_played then
      game_id := r.id;
      return next;
    end if;
  end loop;
  return;
end;
$$;

grant execute on function public.sq_unplayed_dailies(uuid)
  to authenticated, service_role;

-- ============================================================
-- Wire up rate limiting at call sites (card c118).
--
-- check_and_bump_rate_limit(uid, action, limit_per_hour) and the
-- rate_limits table were built in an earlier phase but had NO callers.
-- This migration adds a thin log-only helper and attaches it to the
-- four abuse-prone actions via BEFORE triggers.
--
-- LOG-ONLY: nothing is blocked. When a user exceeds the hourly
-- threshold we record a 'rate_limit_exceeded' event in sq_events and
-- let the action proceed. After a couple weeks of real data we set
-- real enforce limits (which will be lower). Flipping a single action
-- to hard-enforce later = swap its trigger to a raising helper.
--
-- Thresholds (log-only signal lines, not hard caps):
--   friend_request   20/hr
--   submit_report    10/hr
--   create_game      20/hr   (all new games: wordy / rungles / snibble)
--   update_profile   30/hr
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Fix a latent bug in check_and_bump_rate_limit: the `action`
-- parameter shadowed the `action` column, so the INSERT (and the
-- ON CONFLICT inference clause) raised "column reference action is
-- ambiguous" on every call. It never surfaced because the function
-- had no callers. Rename the param to p_action so nothing shadows
-- the column. CREATE OR REPLACE can't rename a parameter, so drop
-- and recreate; a fresh function grants EXECUTE to PUBLIC, so
-- re-seal it (internal-only, called via note_rate_limit) to match
-- secdef_hardening. Semantics unchanged: hourly bucket, cleanup
-- >24h, true if still <= limit.
-- ─────────────────────────────────────────────────────────────
drop function if exists public.check_and_bump_rate_limit(uuid, text, integer);
create function public.check_and_bump_rate_limit(
  uid uuid,
  p_action text,
  limit_per_hour integer
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  hour_start timestamptz := date_trunc('hour', now());
  current_count int;
begin
  insert into public.rate_limits (user_id, action, window_start, count)
  values (uid, p_action, hour_start, 1)
  on conflict (user_id, action, window_start) do update
    set count = public.rate_limits.count + 1
  returning count into current_count;

  -- Cleanup: drop windows older than 24h on every call (cheap; small table).
  delete from public.rate_limits
   where window_start < now() - interval '24 hours';

  return current_count <= limit_per_hour;
end;
$$;

revoke execute on function public.check_and_bump_rate_limit(uuid, text, integer)
  from anon, authenticated, public;

-- ─────────────────────────────────────────────────────────────
-- Log-only helper. Bumps the counter via the existing sealed
-- check function; if over the threshold, logs to sq_events. Never
-- raises — a failure here must never break the underlying action.
-- Skips system/service writes where there is no authenticated user.
-- ─────────────────────────────────────────────────────────────
create or replace function public.note_rate_limit(
  p_action text,
  p_limit  integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return; -- system / service-role writes are not rate-limited
  end if;

  if not public.check_and_bump_rate_limit(uid, p_action, p_limit) then
    insert into public.sq_events (user_id, game, event, payload)
    values (
      uid, 'sidequest', 'rate_limit_exceeded',
      jsonb_build_object('action', p_action, 'limit_per_hour', p_limit)
    );
  end if;
exception
  when others then
    -- log-only: never let rate-limit bookkeeping abort a user action
    null;
end;
$$;

grant execute on function public.note_rate_limit(text, integer)
  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- Generic BEFORE trigger. Reads (action, limit) from TG_ARGV so a
-- single function serves every call site. Always returns NEW.
-- Not a privilege surface: trigger execution skips EXECUTE checks,
-- and note_rate_limit (SECURITY DEFINER) does the gated work.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sq_rate_limit_trigger()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.note_rate_limit(TG_ARGV[0], TG_ARGV[1]::integer);
  return NEW;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Friend requests — request_friendship() inserts a pending row
-- (ON CONFLICT DO NOTHING, so re-requests don't count). 20/hr.
-- ─────────────────────────────────────────────────────────────
drop trigger if exists sq_rl_friend_request on public.friendships;
create trigger sq_rl_friend_request
  before insert on public.friendships
  for each row
  execute function public.sq_rate_limit_trigger('friend_request', '20');

-- ─────────────────────────────────────────────────────────────
-- Report submission — submit_report() inserts a row. Already has a
-- 24h-per-pair cooldown; this catches bulk-reporting many targets. 10/hr.
-- ─────────────────────────────────────────────────────────────
drop trigger if exists sq_rl_submit_report on public.reports;
create trigger sq_rl_submit_report
  before insert on public.reports
  for each row
  execute function public.sq_rate_limit_trigger('submit_report', '10');

-- ─────────────────────────────────────────────────────────────
-- Game creation — all new games across the three game tables. 20/hr.
-- ─────────────────────────────────────────────────────────────
drop trigger if exists sq_rl_create_game on public.games;
create trigger sq_rl_create_game
  before insert on public.games
  for each row
  execute function public.sq_rate_limit_trigger('create_game', '20');

drop trigger if exists sq_rl_create_game on public.rg_games;
create trigger sq_rl_create_game
  before insert on public.rg_games
  for each row
  execute function public.sq_rate_limit_trigger('create_game', '20');

drop trigger if exists sq_rl_create_game on public.sn_matches;
create trigger sq_rl_create_game
  before insert on public.sn_matches
  for each row
  execute function public.sq_rate_limit_trigger('create_game', '20');

-- ─────────────────────────────────────────────────────────────
-- Profile edits — direct UPDATE on profiles (RLS "update own").
-- System lifecycle/anonymize writes run with no auth.uid() and are
-- skipped inside note_rate_limit. 30/hr.
-- ─────────────────────────────────────────────────────────────
drop trigger if exists sq_rl_update_profile on public.profiles;
create trigger sq_rl_update_profile
  before update on public.profiles
  for each row
  execute function public.sq_rate_limit_trigger('update_profile', '30');

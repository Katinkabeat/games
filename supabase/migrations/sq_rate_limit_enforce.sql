-- ============================================================
-- Flip SideQuest rate limiting from log-only to ENFORCE (card c139).
--
-- Follow-up to c118 (sq_rate_limit_wiring.sql, log-only since
-- 2026-05-26). After ~2 weeks of real traffic, sq_events shows ZERO
-- 'rate_limit_exceeded' rows — no user crossed any threshold once.
-- Real peak usage was create_game 2/hr against a 20/hr line; the
-- other three actions were effectively idle. The thresholds are
-- proven non-interfering, so we enforce at the SAME numbers rather
-- than guessing tighter caps on near-zero signal:
--   friend_request   20/hr
--   submit_report    10/hr
--   create_game      20/hr   (wordy / rungles / snibble / YAHDLE)
--   update_profile   30/hr
--
-- Also closes a coverage gap: yahdle_games shipped 2026-05-27 (the
-- day after the c118 wiring) and was never rate-limited. This adds
-- it to create_game so all four MP game tables are covered. Solo
-- tables (rg_solo_games, yahdle_solo_results) stay unlimited, matching
-- the original pattern.
--
-- Mechanism: a new enforcing helper bumps the counter via the existing
-- sealed check function and RAISEs when over the limit, aborting the
-- offending INSERT/UPDATE. The log-only note_rate_limit() and
-- sq_rate_limit_trigger() are left in place (harmless, available for
-- any future log-only action) but no triggers point at them anymore.
--
-- Telemetry note: because a BEFORE trigger that RAISEs rolls back the
-- whole statement, an enforced block does NOT leave a durable
-- sq_events row (the counter correctly stays pinned at the limit, so
-- enforcement is unaffected). Block-telemetry would need an async
-- channel (pg_net) and is deliberately out of scope here.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Enforcing helper. Bumps the hourly counter via the existing sealed
-- check_and_bump_rate_limit(); RAISEs when the limit is exceeded.
-- Bookkeeping failures are swallowed (never block a legit action),
-- but a real over-limit result DOES raise so the action aborts.
-- Skips system/service writes where there is no authenticated user.
-- ─────────────────────────────────────────────────────────────
create or replace function public.enforce_rate_limit(
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
  ok  boolean;
begin
  if uid is null then
    return; -- system / service-role writes are not rate-limited
  end if;

  begin
    ok := public.check_and_bump_rate_limit(uid, p_action, p_limit);
  exception
    when others then
      -- counter bookkeeping must never block a legitimate action
      return;
  end;

  if not ok then
    raise exception
      'Rate limit reached for % (max % per hour). Please wait a bit and try again.',
      p_action, p_limit
      using errcode = 'P0001', hint = p_action;
  end if;
end;
$$;

grant execute on function public.enforce_rate_limit(text, integer)
  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- Enforcing BEFORE trigger. Same TG_ARGV(action, limit) contract as
-- the log-only sq_rate_limit_trigger so call sites are identical.
-- Does NOT swallow the raise — that is the whole point.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sq_rate_limit_enforce_trigger()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.enforce_rate_limit(TG_ARGV[0], TG_ARGV[1]::integer);
  return NEW;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Repoint every call site from the log-only trigger fn to the
-- enforcing one. Same thresholds as the log-only phase.
-- ─────────────────────────────────────────────────────────────

-- Friend requests — 20/hr
drop trigger if exists sq_rl_friend_request on public.friendships;
create trigger sq_rl_friend_request
  before insert on public.friendships
  for each row
  execute function public.sq_rate_limit_enforce_trigger('friend_request', '20');

-- Report submission — 10/hr
drop trigger if exists sq_rl_submit_report on public.reports;
create trigger sq_rl_submit_report
  before insert on public.reports
  for each row
  execute function public.sq_rate_limit_enforce_trigger('submit_report', '10');

-- Game creation — 20/hr across all four MP game tables.
drop trigger if exists sq_rl_create_game on public.games;
create trigger sq_rl_create_game
  before insert on public.games
  for each row
  execute function public.sq_rate_limit_enforce_trigger('create_game', '20');

drop trigger if exists sq_rl_create_game on public.rg_games;
create trigger sq_rl_create_game
  before insert on public.rg_games
  for each row
  execute function public.sq_rate_limit_enforce_trigger('create_game', '20');

drop trigger if exists sq_rl_create_game on public.sn_matches;
create trigger sq_rl_create_game
  before insert on public.sn_matches
  for each row
  execute function public.sq_rate_limit_enforce_trigger('create_game', '20');

-- yahdle_games: previously UNWIRED (coverage gap). Add it now.
drop trigger if exists sq_rl_create_game on public.yahdle_games;
create trigger sq_rl_create_game
  before insert on public.yahdle_games
  for each row
  execute function public.sq_rate_limit_enforce_trigger('create_game', '20');

-- Profile edits — 30/hr
drop trigger if exists sq_rl_update_profile on public.profiles;
create trigger sq_rl_update_profile
  before update on public.profiles
  for each row
  execute function public.sq_rate_limit_enforce_trigger('update_profile', '30');

-- ============================================================
-- Exempt cosmetic / low-stakes profile writes from the 30/hr
-- update_profile rate limit (card c205).
--
-- Background: c139 (sq_rate_limit_enforce.sql) wired a BEFORE UPDATE
-- trigger on public.profiles that counts EVERY profile update against a
-- 30/hr budget. That budget was sized when username editing existed.
-- Username editing has since been removed, so the only client writes to
-- profiles are now cosmetic / low-stakes settings:
--   * avatar_hue            (the avatar colour picker)
--   * daily_reminder_time   (daily-reminder settings)
--   * daily_reminder_tz     (")
--   * welcomed_at           (fires once, ever, on first welcome dismiss)
--
-- None of these is an abuse vector, and a blocked avatar-colour write was
-- failing silently and snapping the user's colour back (the c205 bug).
-- These should NEVER be able to fail/revert on the user.
--
-- Fix: replace the generic enforce-trigger on profiles with a dedicated
-- trigger that enforces the limit ONLY when a NON-cosmetic column changes.
-- Implemented as a jsonb diff with the cosmetic keys stripped, so the
-- 30/hr brake is RETAINED for any field added to profiles in the future
-- (security posture is unchanged — RLS, not this limit, is what guards
-- which rows/columns a user may touch; this limit is only an anti-write-
-- spam brake, and it stays on for everything except these four fields).
-- ============================================================

create or replace function public.sq_profiles_rate_limit_trigger()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  -- Columns whose change alone does NOT count against the profile budget.
  cosmetic text[] := array[
    'avatar_hue',
    'daily_reminder_time',
    'daily_reminder_tz',
    'welcomed_at'
  ];
begin
  -- Enforce only when something OTHER than the cosmetic fields changed.
  -- Stripping the cosmetic keys from both row snapshots and comparing means
  -- a future column is rate-limited by default (it isn't in the exempt set).
  if (to_jsonb(NEW) - cosmetic) is distinct from (to_jsonb(OLD) - cosmetic) then
    perform public.enforce_rate_limit('update_profile', 30);
  end if;
  return NEW;
end;
$$;

-- Repoint the profiles trigger from the generic enforcer to the dedicated one.
drop trigger if exists sq_rl_update_profile on public.profiles;
create trigger sq_rl_update_profile
  before update on public.profiles
  for each row
  execute function public.sq_profiles_rate_limit_trigger();

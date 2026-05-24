-- ============================================================
-- SQ Daily Reminder — cron + candidate selector
--
-- Runs the sq-daily-reminder edge function every 30 minutes on the
-- hour and half-hour. The edge function calls
-- sq_daily_reminder_candidates() to find users whose chosen local-
-- time slot matches "now in their tz", and who have unplayed
-- dailies and the daily_reminder topic opted in.
-- ============================================================

-- ── 1. Candidate selector ────────────────────────────────────
-- Rounds "now in user's tz" down to the 30-min slot (00 or 30) and
-- compares to daily_reminder_time. Filters by topic opt-in + master
-- toggle + at-least-one-unplayed-daily so the edge function is a
-- pure dispatcher.
create or replace function public.sq_daily_reminder_candidates()
returns table(user_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  with current_slot as (
    select
      p.id as uid,
      to_char(
        date_trunc('hour', now() at time zone p.daily_reminder_tz) +
        ((extract(minute from now() at time zone p.daily_reminder_tz)::int / 30) * interval '30 minutes'),
        'HH24:MI'
      ) as slot_now,
      to_char(p.daily_reminder_time, 'HH24:MI') as slot_pref
    from public.profiles p
    where p.daily_reminder_time is not null
  )
  select cs.uid
  from current_slot cs
  where cs.slot_now = cs.slot_pref
    and public.sq_notification_enabled(cs.uid, 'sidequest', 'daily_reminder') = true
    and public.sq_notification_enabled(cs.uid, 'sidequest', '_master') = true
    and exists (select 1 from public.sq_unplayed_dailies(cs.uid));
$$;

grant execute on function public.sq_daily_reminder_candidates()
  to authenticated, service_role;

-- ── 2. pg_cron schedule ──────────────────────────────────────
-- Runs at HH:00 and HH:30 every hour. The edge function base URL comes
-- from public.sq_functions_base_url() (see sq_functions_base_url.sql) so
-- it's defined in one place. The anon JWT below is the project's public
-- anon key (safe to embed; it just prevents random unauthenticated
-- callers) — it still needs updating by hand if the project ref changes.
create extension if not exists pg_cron;

-- Idempotent: drop any existing schedule with this name first.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sq_daily_reminder_tick') then
    perform cron.unschedule('sq_daily_reminder_tick');
  end if;
end $$;

select cron.schedule(
  'sq_daily_reminder_tick',
  '0,30 * * * *',
  $cron$
    select net.http_post(
      url := public.sq_functions_base_url() || '/sq-daily-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object('source', 'pg_cron')
    );
  $cron$
);

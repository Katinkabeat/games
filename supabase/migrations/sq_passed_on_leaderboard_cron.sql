-- ============================================================
-- SQ "passed on the leaderboard" — cron tick (card c225)
--
-- Polls hourly for notable leaderboard drops. The edge function calls
-- sq_passed_on_leaderboard_candidates() (which diffs the current ranks
-- against the persisted snapshot, notifies notable drops, then refreshes
-- the snapshot). Hourly is deliberate: notable drops are rare, so the
-- interval mainly bounds latency, and a calm cadence keeps push volume
-- low. Offset to :20 so it doesn't pile onto the daily-reminder tick.
--
-- Base URL + gateway bearer come from the shared helpers in
-- sq_functions_base_url.sql (so a host move only touches those).
-- Idempotent.
-- ============================================================

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sq_passed_on_leaderboard_tick') then
    perform cron.unschedule('sq_passed_on_leaderboard_tick');
  end if;
end $$;

select cron.schedule(
  'sq_passed_on_leaderboard_tick',
  '20 * * * *',
  $cron$
    select net.http_post(
      url := public.sq_functions_base_url() || '/sq-passed-on-leaderboard',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.sq_anon_key()
      ),
      body := jsonb_build_object('source', 'pg_cron')
    );
  $cron$
);

-- sq_feedback_sweep_cron.sql — 2026-08-09 (c291)
--
-- Hourly reconciliation sweep for the feedback pipeline. Fires the
-- sq-feedback-sweep edge function, which reports any feedback row still
-- status 'new' with no discord_message_id after an hour to #error-log —
-- the misses that push-on-failure reporting can't see (function died
-- mid-flight, pg_net drop, the failure report itself failed).
--
-- :17 keeps it clear of the :00/:30 daily-reminder ticks and the :20
-- leaderboard job. timeout_milliseconds set explicitly per the c278 rule:
-- cron.job command text does not inherit the function-side timeout fixes.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sq_feedback_sweep_tick') then
    perform cron.unschedule('sq_feedback_sweep_tick');
  end if;
end $$;

select cron.schedule(
  'sq_feedback_sweep_tick',
  '17 * * * *',
  $cron$
    select net.http_post(
      url := public.sq_functions_base_url() || '/sq-feedback-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.sq_anon_key()
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 15000
    );
  $cron$
);

-- sq_pgnet_timeout_15s_cron.sql — 2026-07-14 (c278 follow-up)
--
-- The sq_pgnet_timeout_15s.sql migration raised the pg_net timeout on every
-- net.http_post call site in public FUNCTIONS (27/27) — but two more call
-- sites live outside pg_proc, in cron.job COMMAND text: job 7 (sq-daily-reminder,
-- every :00/:30) and job 8 (sq-passed-on-leaderboard, hourly at :20). Those kept
-- the 5000ms default, and the :00/:30 sweeps were STILL being severed after the
-- function migration shipped (net._http_response ids 9370 @ 19:00 and 9372 @
-- 19:30 on 2026-07-14, both "Timeout of 5000 ms reached").
--
-- Same rationale as the function migration: net.http_post is async, so the
-- longer timeout costs nothing; 5s just severs the sweep mid-fan-out and every
-- recipient after the slow one silently loses their push.
--
-- Rollback: rerun cron.alter_job with the timeout line removed.

begin;

select cron.alter_job(7, command := $job$
    select net.http_post(
      url := public.sq_functions_base_url() || '/sq-daily-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.sq_anon_key()
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 15000
    );
  $job$);

select cron.alter_job(8, command := $job$
    select net.http_post(
      url := public.sq_functions_base_url() || '/sq-passed-on-leaderboard',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.sq_anon_key()
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 15000
    );
  $job$);

commit;

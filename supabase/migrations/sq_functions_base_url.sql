-- Single source of truth for the Supabase Edge Functions base URL.
--
-- Every DB trigger / pg_cron job that POSTs to an edge function reads
-- the base URL from here instead of inlining the full project URL.
-- When the project moves to a new host or ref (e.g. Dean's infra),
-- update the return value below and re-apply this one file — the
-- friend-request trigger and daily-reminder cron pick it up
-- automatically. See SQ_PHASED_PLAN.md migration note #2.
--
-- Apply this BEFORE sq_friend_request_trigger.sql and
-- sq_daily_reminder_cron.sql, which both call this function.

create or replace function public.sq_functions_base_url()
returns text
language sql
stable
set search_path = public
as $$
  select 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1'::text;
$$;

grant execute on function public.sq_functions_base_url()
  to authenticated, service_role;

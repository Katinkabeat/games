-- Single source of truth for the per-project values that DB triggers /
-- pg_cron jobs need when they POST to an edge function: the Edge
-- Functions base URL and the project's public anon key (used as the
-- gateway Authorization bearer). Every such consumer reads from here
-- instead of inlining these values.
--
-- When the project moves to a new host or ref (e.g. Dean's infra),
-- update the two return values below and re-apply this one file — the
-- friend-request trigger and daily-reminder cron pick them up
-- automatically. See SQ_PHASED_PLAN.md migration note #2.
--
-- Apply this BEFORE sq_friend_request_trigger.sql and
-- sq_daily_reminder_cron.sql, which both call these functions.

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

-- Public anon key (safe to expose — it's bundled in every browser
-- client; RLS protects the data). Used by the daily-reminder cron as
-- its gateway bearer so unauthenticated callers can't hit the function.
create or replace function public.sq_anon_key()
returns text
language sql
stable
set search_path = public
as $$
  select 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'::text;
$$;

grant execute on function public.sq_anon_key()
  to service_role;

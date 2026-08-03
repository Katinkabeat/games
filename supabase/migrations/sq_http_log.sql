-- Durable log of every pg_net HTTP send (push notifications + the cron sweeps).
--
-- WHY THIS EXISTS
-- pg_net writes each response to net._http_response and vacuums it after ~6
-- hours. That table is the ONLY record of whether a trigger-driven push ever
-- fired (c278 Fix 2 made the push fns echo `tag` + `user` into the response
-- body precisely so the log could name the game). Six hours is shorter than the
-- feedback loop on a bug report: by the time Rae says "I got notified about one
-- game but not the other," the evidence is already gone.
--
-- c278's own follow-up instruction — "watch for any new timed_out = true row" —
-- was therefore unfollowable in practice. This makes it followable: a cron tick
-- copies each response into a logged table before pg_net can reclaim it, with a
-- 90-day retention matching the sq_events convention (cron job 2).
--
-- WHAT IT CANNOT DO (read this before trusting a gap in the log)
-- net._http_response carries no url and no request body — only the response.
-- The request row that DOES carry them (net.http_request_queue) is deleted by
-- pg_net's worker as soon as it's processed, normally well inside one drain
-- tick, so `url` is populated only for the rare row still queued at drain time.
--
-- Consequence: a SEVERED call (timed_out = true) has a null `content`, so it
-- cannot name its own game. What it still gives you is the id, the timestamp
-- and the error — enough to run the diagnostic that settled both c278 and c285:
-- line pushes-sent up against actual move timestamps. Closing that last gap
-- needs the request id captured at the call site (all 27 of them) or a trigger
-- on pg_net's queue table; both were judged too invasive for this slice. See
-- the residual note on the card.
--
-- Related: c278 / c281 (the pg_net sever bug and its audit), c276 (the re-drive
-- queue, still deferred — this is the cheap observability slice of it), c284.

-- ── The log ──────────────────────────────────────────────────────────────────
create table if not exists public.sq_http_log (
  -- net._http_response.id, which IS the request id net.http_post returns.
  request_id   bigint primary key,
  -- pg_net's own stamp on the response, NOT when we copied it. Correlating
  -- against move timestamps is the whole point, so the original stamp wins.
  created      timestamptz not null,
  status_code  integer,
  timed_out    boolean,
  error_msg    text,
  content_type text,
  content      text,
  -- Parsed out of `content` when it's a JSON object. The push fns return
  -- {sent, via, tag, user, reason} (c276/c278); the cron sweeps return
  -- {count, results}, which has none of these and leaves them null.
  tag          text,
  recipient    uuid,
  sent         boolean,
  reason       text,
  -- Populated only when the queue row outlived the response (rare). Null here
  -- means "not captured", never "no url".
  url          text,
  logged_at    timestamptz not null default now()
);

comment on table public.sq_http_log is
  'Durable copy of net._http_response (which pg_net vacuums after ~6h). Admin diagnostics only; no RLS policies, so only service_role/postgres can read it. See sq_push_failures for the failures-only view.';

create index if not exists sq_http_log_created_idx
  on public.sq_http_log (created desc);

-- The query that actually gets run during an incident: show me the failures.
create index if not exists sq_http_log_failed_idx
  on public.sq_http_log (created desc)
  where timed_out or status_code is null or status_code >= 300 or sent is false;

-- Admin-only data (it carries recipient user ids and function response bodies).
-- RLS on with zero policies = nothing but service_role/postgres gets a row.
alter table public.sq_http_log enable row level security;
revoke all on public.sq_http_log from anon, authenticated;

-- ── The drain ────────────────────────────────────────────────────────────────
create or replace function public.sq_http_log_drain()
returns integer
language plpgsql
-- Not SECURITY DEFINER: cron runs this as its owner (postgres), which already
-- reads net.*. No caller needs to borrow privileges, so don't hand any out.
security invoker
set search_path = public, net, pg_catalog
as $$
declare
  v_inserted integer;
begin
  insert into public.sq_http_log (
    request_id, created, status_code, timed_out, error_msg,
    content_type, content, tag, recipient, sent, reason, url
  )
  select
    r.id,
    r.created,
    r.status_code,
    r.timed_out,
    r.error_msg,
    r.content_type,
    -- Bodies are small ({sent,via,tag,user} or a count+results list); cap
    -- anyway so one pathological response can't bloat the table.
    left(r.content, 4000),
    j.payload->>'tag',
    -- Guarded cast: a malformed `user` must not abort the whole drain tick.
    case
      when pg_input_is_valid(coalesce(j.payload->>'user', ''), 'uuid')
        then (j.payload->>'user')::uuid
    end,
    case
      when pg_input_is_valid(coalesce(j.payload->>'sent', ''), 'boolean')
        then (j.payload->>'sent')::boolean
    end,
    j.payload->>'reason',
    q.url
  from net._http_response r
  -- Almost always a miss — the worker deletes the queue row on completion.
  -- Kept because when it DOES hit, it's the only way a row names its url.
  left join net.http_request_queue q on q.id = r.id
  left join lateral (
    select case
      when r.content is not null
       and pg_input_is_valid(r.content, 'jsonb')
       and jsonb_typeof(r.content::jsonb) = 'object'
      then r.content::jsonb
    end as payload
  ) j on true
  where not exists (
    select 1 from public.sq_http_log l where l.request_id = r.id
  )
  -- Belt to the NOT EXISTS brace: two overlapping ticks must not error out.
  on conflict (request_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- Same 90-day horizon as the sq_events prune (cron job 2).
  delete from public.sq_http_log where created < now() - interval '90 days';

  return v_inserted;
end;
$$;

comment on function public.sq_http_log_drain() is
  'Copies new net._http_response rows into sq_http_log before pg_net vacuums them (~6h TTL), then prunes past 90 days. Run every minute by cron.';

-- ── Failures-only view (the one to actually query) ───────────────────────────
-- security_invoker so the view does not become an RLS bypass on the table
-- underneath it (per the SECDEF audit rules in feedback_supabase_patterns).
create or replace view public.sq_push_failures
with (security_invoker = true) as
select
  request_id,
  created,
  status_code,
  timed_out,
  error_msg,
  tag,
  recipient,
  sent,
  reason,
  url,
  content
from public.sq_http_log
where timed_out
   or status_code is null
   or status_code >= 300
   or sent is false;

comment on view public.sq_push_failures is
  'Every logged pg_net send that did not cleanly succeed: severed calls (timed_out), non-2xx, and 200s where the push fn itself reported sent:false. A timed_out row has no tag — correlate it against move timestamps.';

-- ── Schedule ─────────────────────────────────────────────────────────────────
-- Every minute. pg_net's TTL is ~6h so this is far more often than retention
-- demands; the tight interval is what gives net.http_request_queue a chance of
-- still holding the url, and keeps the log near-live during an incident.
-- Idempotent: unschedule first so re-running the migration doesn't double up.
do $$
begin
  perform cron.unschedule('sq-http-log-drain');
exception when others then
  null;  -- not scheduled yet
end;
$$;

select cron.schedule(
  'sq-http-log-drain',
  '* * * * *',
  $$select public.sq_http_log_drain();$$
);

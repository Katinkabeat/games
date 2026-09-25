-- ============================================================
-- {{name}} — server-side write guard for solo daily results
--
-- Apply this together with {{slug}}_solo_results.sql. It makes this RPC the
-- ONLY writer of {{slug}}_solo_results, which closes two cheats that a plain
-- "insert/update your own rows" RLS policy leaves open:
--
--  1. Past-board padding. The daily leaderboard ungates past days, so after
--     local midnight yesterday's board is readable. If the client upserts with
--     a play_date it chose, a player who left yesterday's run open can submit
--     a padded score onto yesterday. This guard rejects any non-today date.
--
--  2. Seed re-roll farming. If your game persists an in-progress run so a
--     reload RESUMES instead of re-rolling (see the resume snapshot note
--     below), then granting delete-own on that snapshot lets a player delete
--     it via the API to force a fresh roll and retry the daily until it goes
--     well. So the snapshot cleanup happens HERE, server-side, and delete-own
--     is never granted.
--
-- Note on the honest cross-midnight finisher: a strict today-only guard means
-- a run finished after its day ended is refused. That is intentional (it is
-- what closes #1), but the CLIENT must tell that case apart from a transient
-- failure and NOT retry forever — show a "this day has ended" message instead.
-- See the recordResult() pattern in src/components/game/SoloGamePage.jsx.
--
-- c332 (SideQuest Test Accounts group): a public.sq_is_test_account() member
-- may replay today's daily as often as they like, and each finished replay
-- must OVERWRITE that day's row (latest run wins) instead of no-op'ing.
-- Everyone else keeps the unconditional "first result wins" behaviour below,
-- completely unchanged. Membership is re-checked here, server-side, on every
-- call — never trust a client-side cached flag.
--
-- Getting a member back to a FRESH run (rather than re-showing the day's now-
-- stale result / resuming an old snapshot) needs a second piece:
-- {{slug}}_test_reset_today() at the bottom of this file, a SECDEF RPC that
-- deletes the caller's own {{slug}}_solo_results row for today (and, if you
-- use a resume-snapshot table, that too) — but ONLY for a test-account
-- member; it raises for anyone else. Wire this to a small "Replay (test
-- account)" button on the already-played screen, gated cosmetically by
-- `await supabase.rpc('sq_is_test_account', { uid })` (see Rungles'
-- SoloGamePage.jsx / Snibble's GameView.jsx for the reference UX).
-- ============================================================

create or replace function public.{{slug}}_record_solo_result(
  p_play_date date,
  p_score     int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Use the timezone your daily rolls over in. SQ games use Atlantic.
  v_today   date := (timezone('America/Halifax', now()))::date;
  v_uid     uuid := auth.uid();
  v_is_test boolean;
begin
  if v_uid is null then
    raise exception '{{slug}}_record_solo_result: not authenticated';
  end if;

  -- The guard. A result may only be recorded for the current Atlantic day.
  if p_play_date <> v_today then
    raise exception '{{slug}}_record_solo_result: play_date % is not today (%); past/future writes are not allowed', p_play_date, v_today;
  end if;

  -- c332: test-account members may replay the daily as many times as they
  -- like; each finished run OVERWRITES that day's row.
  v_is_test := public.sq_is_test_account(v_uid);

  if v_is_test then
    insert into public.{{slug}}_solo_results (user_id, play_date, score, completed_at)
    values (v_uid, p_play_date, p_score, now())
    on conflict (user_id, play_date) do update set
      score        = excluded.score,
      completed_at = excluded.completed_at;
  else
    -- One attempt per day: first finished result wins. A later call for the
    -- same day is a silent no-op, so a retry after a flaky network is safe.
    insert into public.{{slug}}_solo_results (user_id, play_date, score, completed_at)
    values (v_uid, p_play_date, p_score, now())
    on conflict (user_id, play_date) do nothing;
  end if;

  -- If your game keeps an in-progress resume snapshot (e.g. a
  -- {{slug}}_daily_runs table), delete it HERE rather than client-side. Doing
  -- the cleanup inside this SECDEF function is what lets you withhold
  -- delete-own and close the re-roll farm. Uncomment once that table exists
  -- (do this unconditionally — both branches above finish the run):
  --
  -- delete from public.{{slug}}_daily_runs
  --  where user_id = v_uid and play_date = p_play_date;
end;
$$;

revoke all on function public.{{slug}}_record_solo_result(date, int) from public;
grant execute on function public.{{slug}}_record_solo_result(date, int) to authenticated;

-- ── c332: test-account daily reset ─────────────────────────────
-- Deletes the caller's OWN {{slug}}_solo_results row for today, but ONLY if
-- they're a test-account member — checked server-side on every call, never
-- trusting the client's cached membership flag. Backs the "Replay (test
-- account)" button on the already-played screen; the client then resets its
-- local state and starts a fresh run through the normal flow, which records
-- via {{slug}}_record_solo_result on finish (and so overwrites, per the
-- branch above).
--
-- If your game has a resume-snapshot table ({{slug}}_daily_runs or similar),
-- delete that row here too, uncommenting the line below — otherwise a member
-- hitting Replay would just resume their old (already-recorded) run instead
-- of starting fresh.
create or replace function public.{{slug}}_test_reset_today()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := (timezone('America/Halifax', now()))::date;
begin
  if v_uid is null then
    raise exception '{{slug}}_test_reset_today: not authenticated';
  end if;

  if not public.sq_is_test_account(v_uid) then
    raise exception '{{slug}}_test_reset_today: caller is not a test account';
  end if;

  delete from public.{{slug}}_solo_results
   where user_id = v_uid and play_date = v_today;

  -- Uncomment once a resume-snapshot table exists:
  -- delete from public.{{slug}}_daily_runs
  --  where user_id = v_uid and play_date = v_today;
end;
$$;

revoke all on function public.{{slug}}_test_reset_today() from public;
grant execute on function public.{{slug}}_test_reset_today() to authenticated;

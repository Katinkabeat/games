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
  v_today date := (timezone('America/Halifax', now()))::date;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then
    raise exception '{{slug}}_record_solo_result: not authenticated';
  end if;

  -- The guard. A result may only be recorded for the current Atlantic day.
  if p_play_date <> v_today then
    raise exception '{{slug}}_record_solo_result: play_date % is not today (%); past/future writes are not allowed', p_play_date, v_today;
  end if;

  -- One attempt per day: first finished result wins. A later call for the
  -- same day is a silent no-op, so a retry after a flaky network is safe.
  insert into public.{{slug}}_solo_results (user_id, play_date, score, completed_at)
  values (v_uid, p_play_date, p_score, now())
  on conflict (user_id, play_date) do nothing;

  -- If your game keeps an in-progress resume snapshot (e.g. a
  -- {{slug}}_daily_runs table), delete it HERE rather than client-side. Doing
  -- the cleanup inside this SECDEF function is what lets you withhold
  -- delete-own and close the re-roll farm. Uncomment once that table exists:
  --
  -- delete from public.{{slug}}_daily_runs
  --  where user_id = v_uid and play_date = p_play_date;
end;
$$;

revoke all on function public.{{slug}}_record_solo_result(date, int) from public;
grant execute on function public.{{slug}}_record_solo_result(date, int) to authenticated;

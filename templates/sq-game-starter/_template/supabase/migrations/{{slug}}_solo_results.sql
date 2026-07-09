-- ============================================================
-- {{name}} — Solo results table
--
-- One row per finished solo session. The c92 leaderboard RPCs
-- (see {{slug}}_solo_leaderboards.sql) read from this table; if
-- your game uses a different table shape (e.g. timestamptz-only
-- like Rungles, or per-day puzzle feed like Snibble), adapt the
-- columns AND update the RPCs to match before applying.
--
-- The default shape matches Yahdle/Snibble: one play per user per
-- day, with play_date for cheap day-bucketing and completed_at
-- for tie-break.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.{{slug}}_solo_results (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  play_date    date        NOT NULL,
  score        int         NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, play_date)
);

CREATE INDEX IF NOT EXISTS {{slug}}_solo_results_score_idx
  ON public.{{slug}}_solo_results (play_date, score DESC, completed_at ASC);

ALTER TABLE public.{{slug}}_solo_results ENABLE ROW LEVEL SECURITY;

-- NOTE: there is deliberately NO insert/update/delete policy here.
--
-- Results are written ONLY through the SECURITY DEFINER RPC in
-- {{slug}}_solo_results_write_guard.sql, which stamps user_id from auth.uid()
-- and refuses any play_date that isn't the current Atlantic day. Granting
-- insert/update-own (as this template used to) lets the client choose its own
-- play_date, which means a player with a stale tab can pad YESTERDAY's
-- leaderboard after midnight. Delete-own is likewise omitted: it would let a
-- player delete today's result and replay the daily.
--
-- Apply the write-guard migration too. Don't "temporarily" add insert_own.

-- All authenticated users can read (needed for the leaderboard).
-- The leaderboard RPCs are SECDEF anyway; this just enables direct
-- reads (e.g. for a "my history" view) and the "already played today" gate.
CREATE POLICY {{slug}}_solo_results_select_all ON public.{{slug}}_solo_results
  FOR SELECT TO authenticated
  USING (true);

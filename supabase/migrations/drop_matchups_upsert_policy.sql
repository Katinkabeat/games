-- Drop the always-true "matchups: upsert" RLS policy on player_matchups.
--
-- Original schema comment: "-- managed by function". record_game_result()
-- (SECDEF) does the upserts and bypasses RLS, so the FOR ALL USING(true)
-- policy was never doing real work — it just allowed clients to do anything
-- if they ever bypassed the function path.
--
-- Dropping it leaves "matchups: read own" as the only policy: clients can
-- still SELECT their own matchups (StatsPage.jsx), record_game_result()
-- still upserts via SECDEF, and direct client writes are now correctly
-- denied. Clears the rls_policy_always_true advisor warning.

BEGIN;

DROP POLICY IF EXISTS "matchups: upsert" ON public.player_matchups;

COMMIT;

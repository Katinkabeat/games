-- Combine the two sn_matches UPDATE policies into one with OR'd USING
-- and OR'd WITH CHECK. Clears the last 6 multiple_permissive_policies
-- advisor warnings (one per role × the same overlap).
--
-- Original policies:
--   "sn_matches join open"          USING(open + no opponent + not creator)
--                                   CHECK(set self as opponent + in_progress)
--   "sn_matches update participant" USING(creator OR opponent)
--                                   CHECK(default = USING)
--
-- Combined policy is semantically identical: postgres OR's permissive
-- policies for each (table, role, command) anyway, so two policies vs
-- one policy with OR'd clauses produces the same access decision per row.
--
-- Manual proof of equivalence walked through key cases (join, submit
-- round, complete match, claim stalled, attempt unauthorized update);
-- snibble's matchActions.js paths still pass either via the join branch
-- or the participant branch.

BEGIN;

DROP POLICY IF EXISTS "sn_matches join open"          ON public.sn_matches;
DROP POLICY IF EXISTS "sn_matches update participant" ON public.sn_matches;

CREATE POLICY "sn_matches: update"
  ON public.sn_matches
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (
    -- "join open" branch: anyone (not the creator) can become the opponent
    -- of a match still waiting for one.
    (status = 'open' AND opponent_id IS NULL AND creator_id <> (SELECT auth.uid()))
    OR
    -- "update participant" branch: existing players can update their match.
    ((SELECT auth.uid()) = creator_id OR (SELECT auth.uid()) = opponent_id)
  )
  WITH CHECK (
    -- The join must set the caller as opponent and flip status to in_progress.
    (opponent_id = (SELECT auth.uid()) AND status = 'in_progress')
    OR
    -- Participants can update freely as long as they remain participants.
    ((SELECT auth.uid()) = creator_id OR (SELECT auth.uid()) = opponent_id)
  );

COMMIT;

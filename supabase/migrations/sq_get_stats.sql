-- =====================================================================
-- SideQuest hub: get_sq_stats() RPC
--
-- Returns the platform-wide stats shown in the hub avatar dropdown:
--   * member_since   — profiles.created_at for the caller
--   * wordy_multi    — count of Wordy multiplayer games the caller is in
--   * rungles_multi  — count of Rungles multiplayer games the caller is in
--   * rungles_solo   — count of Rungles solo games the caller has played
--   * daily_streak   — consecutive days, ending today or yesterday, on
--                       which the caller played any SideQuest game
--                       (Wordy move OR Rungles rung OR Rungles solo)
--
-- SECURITY DEFINER so it can read across tables without depending on
-- per-table RLS for the calling user. Always scoped to auth.uid().
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_sq_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_member_since timestamptz;
  v_wordy_multi  int;
  v_rg_multi     int;
  v_rg_solo      int;
  v_streak       int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT created_at INTO v_member_since
    FROM public.profiles WHERE id = v_user_id;

  SELECT COUNT(*) INTO v_wordy_multi
    FROM public.game_players WHERE user_id = v_user_id;

  SELECT COUNT(*) INTO v_rg_multi
    FROM public.rg_players WHERE user_id = v_user_id;

  SELECT COUNT(*) INTO v_rg_solo
    FROM public.rg_solo_games WHERE user_id = v_user_id;

  -- Daily streak: gather distinct play dates across every SQ game, group
  -- consecutive runs by (date - row_number) trick, and pick the run whose
  -- last day is today or yesterday. If the most recent play is older than
  -- yesterday, the streak is 0.
  WITH play_dates AS (
    SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date AS d
      FROM public.game_moves WHERE user_id = v_user_id
    UNION
    SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date
      FROM public.rg_rungs WHERE player_user_id = v_user_id
    UNION
    SELECT DISTINCT (played_at AT TIME ZONE 'UTC')::date
      FROM public.rg_solo_games WHERE user_id = v_user_id
  ),
  ranked AS (
    SELECT d,
           d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
      FROM play_dates
  ),
  groups AS (
    SELECT grp, MAX(d) AS end_d, COUNT(*)::int AS len
      FROM ranked
      GROUP BY grp
  )
  SELECT COALESCE(MAX(len), 0) INTO v_streak
    FROM groups
    WHERE end_d >= CURRENT_DATE - 1;

  RETURN jsonb_build_object(
    'member_since',  v_member_since,
    'wordy_multi',   v_wordy_multi,
    'rungles_multi', v_rg_multi,
    'rungles_solo',  v_rg_solo,
    'daily_streak',  v_streak
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sq_stats() TO authenticated;

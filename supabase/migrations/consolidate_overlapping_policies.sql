-- Consolidate overlapping permissive RLS policies flagged by the
-- Supabase performance advisor (multiple_permissive_policies lint).
--
-- Postgres OR's all permissive policies for a (table, role, command), so
-- having two policies that both grant SELECT means each row gets evaluated
-- through both — wasted CPU. Combining them into one policy with OR'd
-- USING expressions preserves semantics exactly while clearing the lint.
--
-- Two patterns:
--   A) "self OR admin" SELECT overlap (7 tables) — combine into one
--      policy with USING (own_check OR admin_check).
--   B) FOR ALL bleeding into SELECT (2 tables) — split FOR ALL into
--      INSERT/UPDATE/DELETE so SELECT only matches the dedicated SELECT
--      policy.
--
-- This migration does NOT touch sn_matches UPDATE — that's Pattern C
-- (semantically distinct policies) and needs a separate review pass.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- Pattern A: "self OR admin" SELECT consolidation
-- ────────────────────────────────────────────────────────────────────────

-- admins: master_select + read_own → one combined SELECT policy
DROP POLICY IF EXISTS "admins: master select" ON public.admins;
DROP POLICY IF EXISTS "admins: read own"      ON public.admins;
CREATE POLICY "admins: select"
  ON public.admins
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    public.is_master_admin()
    OR (SELECT auth.uid()) = user_id
  );

-- announcements: select_active + select_all_master → one combined SELECT
DROP POLICY IF EXISTS "announcements_select_active"     ON public.announcements;
DROP POLICY IF EXISTS "announcements_select_all_master" ON public.announcements;
CREATE POLICY "announcements_select"
  ON public.announcements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (published_at <= now() AND expires_at > now())
    OR EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.user_id = (SELECT auth.uid())
        AND admins.is_master = true
    )
  );

-- games_catalog: select_published + select_all_master → one combined SELECT
DROP POLICY IF EXISTS "games_catalog_select_published"  ON public.games_catalog;
DROP POLICY IF EXISTS "games_catalog_select_all_master" ON public.games_catalog;
CREATE POLICY "games_catalog_select"
  ON public.games_catalog
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    is_published = true
    OR EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.user_id = (SELECT auth.uid())
        AND admins.is_master = true
    )
  );

-- reports: select_own + select_admin → one combined SELECT
-- (admin check here is is_master OR has 'manage_reports' permission)
DROP POLICY IF EXISTS "reports_select_own"   ON public.reports;
DROP POLICY IF EXISTS "reports_select_admin" ON public.reports;
CREATE POLICY "reports_select"
  ON public.reports
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    reporter = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.admins a
      WHERE a.user_id = (SELECT auth.uid())
        AND (a.is_master OR 'manage_reports' = ANY (a.permissions))
    )
  );

-- user_blocks: select_own + select_admin → one combined SELECT
DROP POLICY IF EXISTS "user_blocks_select_own"   ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_select_admin" ON public.user_blocks;
CREATE POLICY "user_blocks_select"
  ON public.user_blocks
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    blocker = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.user_id = (SELECT auth.uid())
    )
  );

-- user_game_access: select_self + select_admin → one combined SELECT
DROP POLICY IF EXISTS "user_game_access_select_self"  ON public.user_game_access;
DROP POLICY IF EXISTS "user_game_access_select_admin" ON public.user_game_access;
CREATE POLICY "user_game_access_select"
  ON public.user_game_access
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.user_id = (SELECT auth.uid())
    )
  );

-- user_group_members: select_self + select_admin → one combined SELECT
DROP POLICY IF EXISTS "user_group_members_select_self"  ON public.user_group_members;
DROP POLICY IF EXISTS "user_group_members_select_admin" ON public.user_group_members;
CREATE POLICY "user_group_members_select"
  ON public.user_group_members
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.user_id = (SELECT auth.uid())
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- Pattern B: split FOR ALL write policies into per-action policies so
-- they no longer overlap with the dedicated SELECT policy.
-- ────────────────────────────────────────────────────────────────────────

-- sn_app_settings: "write for admins" was FOR ALL → split into 3
DROP POLICY IF EXISTS "sn_app_settings write for admins" ON public.sn_app_settings;
CREATE POLICY "sn_app_settings insert for admins"
  ON public.sn_app_settings
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admins
    WHERE admins.user_id = (SELECT auth.uid())
  ));
CREATE POLICY "sn_app_settings update for admins"
  ON public.sn_app_settings
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admins
    WHERE admins.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admins
    WHERE admins.user_id = (SELECT auth.uid())
  ));
CREATE POLICY "sn_app_settings delete for admins"
  ON public.sn_app_settings
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admins
    WHERE admins.user_id = (SELECT auth.uid())
  ));

-- user_notification_prefs: "write own" was FOR ALL → split into 3
DROP POLICY IF EXISTS "user_notif_prefs write own" ON public.user_notification_prefs;
CREATE POLICY "user_notif_prefs insert own"
  ON public.user_notification_prefs
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "user_notif_prefs update own"
  ON public.user_notification_prefs
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "user_notif_prefs delete own"
  ON public.user_notification_prefs
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((SELECT auth.uid()) = user_id);

COMMIT;

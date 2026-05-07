-- Add covering indexes for all 22 unindexed foreign keys flagged by the
-- Supabase performance advisor (unindexed_foreign_keys lint).
--
-- Rationale: Postgres can't use a sequential scan to enforce FK
-- constraints during DELETE/UPDATE on the parent table — without an
-- index on the child's FK column, a delete on `auth.users` (or any
-- referenced row) has to scan the full child table. Indexing FK
-- columns is universally recommended.
--
-- Tables are small enough that the brief lock from a non-CONCURRENT
-- CREATE INDEX is fine. IF NOT EXISTS makes this re-runnable.

BEGIN;

-- Hot-path FKs (game state, joins on user-facing screens)
CREATE INDEX IF NOT EXISTS friendships_requested_by_idx       ON public.friendships       (requested_by);
CREATE INDEX IF NOT EXISTS game_moves_game_id_idx             ON public.game_moves        (game_id);
CREATE INDEX IF NOT EXISTS games_created_by_idx               ON public.games             (created_by);
CREATE INDEX IF NOT EXISTS player_matchups_opponent_id_idx    ON public.player_matchups   (opponent_id);
CREATE INDEX IF NOT EXISTS rg_games_created_by_idx            ON public.rg_games          (created_by);
CREATE INDEX IF NOT EXISTS rg_racks_user_id_idx               ON public.rg_racks          (user_id);
CREATE INDEX IF NOT EXISTS sn_daily_feeds_pet_id_idx          ON public.sn_daily_feeds    (pet_id);
CREATE INDEX IF NOT EXISTS sn_matches_winner_id_idx           ON public.sn_matches        (winner_id);
CREATE INDEX IF NOT EXISTS sn_progress_pet_id_idx             ON public.sn_progress       (pet_id);

-- Admin / audit FKs (rarely queried, but DELETE-on-parent still benefits)
CREATE INDEX IF NOT EXISTS admins_added_by_idx                ON public.admins             (added_by);
CREATE INDEX IF NOT EXISTS announcements_created_by_idx       ON public.announcements      (created_by);
CREATE INDEX IF NOT EXISTS games_closed_by_idx                ON public.games              (closed_by);
CREATE INDEX IF NOT EXISTS games_forfeit_user_id_idx          ON public.games              (forfeit_user_id);
CREATE INDEX IF NOT EXISTS reports_reported_idx               ON public.reports            (reported);
CREATE INDEX IF NOT EXISTS reports_reporter_idx               ON public.reports            (reporter);
CREATE INDEX IF NOT EXISTS reports_reviewed_by_idx            ON public.reports            (reviewed_by);
CREATE INDEX IF NOT EXISTS rg_games_closed_by_idx             ON public.rg_games           (closed_by);
CREATE INDEX IF NOT EXISTS rg_games_forfeit_user_id_idx       ON public.rg_games           (forfeit_user_id);
CREATE INDEX IF NOT EXISTS sn_matches_closed_by_idx           ON public.sn_matches         (closed_by);
CREATE INDEX IF NOT EXISTS user_game_access_added_by_idx      ON public.user_game_access   (added_by);
CREATE INDEX IF NOT EXISTS user_group_members_added_by_idx    ON public.user_group_members (added_by);
CREATE INDEX IF NOT EXISTS user_groups_created_by_idx         ON public.user_groups        (created_by);

COMMIT;

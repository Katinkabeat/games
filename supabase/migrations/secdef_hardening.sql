-- SECDEF hardening (2026-05-06).
--
-- Clears ~165 of 170 Supabase advisor security warnings in one pass:
--   * function_search_path_mutable                    (55) — locks search_path
--   * anon_security_definer_function_executable       (55) — revokes anon
--   * authenticated_security_definer_function_executable (55) — revokes auth
--                                                          where not needed
--
-- Categorization is from supabase/docs/advisor-triage.md after a callsite
-- audit across wordy/, rungles/, snibble/, rae-side-quest/. Three lints will
-- remain after this runs (RLS-helper functions that MUST stay grantable to
-- authenticated). That's expected and noted in the triage doc.
--
-- Safe to re-run: ALTER FUNCTION SET / GRANT / REVOKE are idempotent.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 1. Lock search_path on every SECDEF function in public.
--    public, pg_temp matches what the recursion-fix migration already
--    applied to is_player_in_game and can_join_game.
-- ────────────────────────────────────────────────────────────────────────

-- Tier 1 — JS-called via supabase.rpc()
ALTER FUNCTION public.accept_friendship(uuid)                                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_close_game(uuid, text)                                             SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_list_closed_games(integer)                                         SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_list_open_games()                                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.block_user(uuid)                                                         SET search_path = public, pg_temp;
ALTER FUNCTION public.finish_game(uuid, jsonb)                                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.forfeit_game(uuid, uuid)                                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.get_leaderboard()                                                        SET search_path = public, pg_temp;
ALTER FUNCTION public.get_sq_stats()                                                           SET search_path = public, pg_temp;
ALTER FUNCTION public.remove_friendship(uuid)                                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.request_friendship(uuid)                                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_admin_close_game(uuid, text)                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_admin_list_closed_games(integer)                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_admin_list_open_games()                                               SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_cancel_game(uuid)                                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_create_game(integer, uuid)                                            SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_expire_stale_games()                                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_give_up(uuid)                                                         SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_join_game(uuid)                                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_nudge(uuid)                                                           SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_skip_turn(uuid)                                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_submit_rung(uuid, text, integer[])                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_admin_close_match(uuid, text)                                         SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_admin_list_closed_matches(integer)                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_admin_list_open_matches()                                             SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_admin_reset_leaderboard()                                             SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_cancel_match(uuid)                                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_daily_leaderboard(date)                                               SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_expire_stale_matches()                                                SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_nudge(uuid)                                                           SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_recent_match_rule_ids(uuid[], integer)                                SET search_path = public, pg_temp;
ALTER FUNCTION public.sq_notification_enabled(uuid, text, text)                                SET search_path = public, pg_temp;
ALTER FUNCTION public.submit_report(uuid, text, text)                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.unblock_user(uuid)                                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.wordy_auto_start_or_cancel_stale()                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.wordy_cancel_game(uuid)                                                  SET search_path = public, pg_temp;

-- Tier 2 — RLS helpers
ALTER FUNCTION public.can_join_game(uuid, uuid, uuid[], integer)                               SET search_path = public, pg_temp;
ALTER FUNCTION public.is_master_admin()                                                        SET search_path = public, pg_temp;
ALTER FUNCTION public.is_player_in_game(uuid, uuid)                                            SET search_path = public, pg_temp;

-- Tier 3 — Trigger-only
ALTER FUNCTION public.auto_start_game()                                                        SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()                                                        SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_friend_request()                                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_turn_change()                                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_notify_game_invited()                                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_notify_opponent_joined()                                              SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_notify_turn_change()                                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_notify_match_invited()                                                SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_notify_opponent_joined()                                              SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_notify_round_submitted()                                              SET search_path = public, pg_temp;
ALTER FUNCTION public.wordy_notify_game_invited()                                              SET search_path = public, pg_temp;

-- Tier 4 — Internal helpers / orphans
ALTER FUNCTION public.admin_list_profiles()                                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.check_and_bump_rate_limit(uuid, text, integer)                           SET search_path = public, pg_temp;
ALTER FUNCTION public.record_game_result(uuid)                                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_dismiss_result(uuid)                                                  SET search_path = public, pg_temp;
ALTER FUNCTION public.sq_check_invitable(uuid, uuid)                                           SET search_path = public, pg_temp;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Tighten EXECUTE grants.
--    Strategy:
--    * Tier 1 + Tier 2: revoke from anon + public; keep authenticated.
--    * Tier 3 + Tier 4: revoke from anon + public + authenticated.
--      (Tier 3 are triggers — caller grants don't matter. Tier 4 are
--       only called from inside other SECDEF functions, which run as
--       postgres regardless.)
-- ────────────────────────────────────────────────────────────────────────

-- Tier 1 — keep authenticated, revoke anon + public
REVOKE EXECUTE ON FUNCTION public.accept_friendship(uuid)                                      FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_close_game(uuid, text)                                 FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_list_closed_games(integer)                             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_list_open_games()                                      FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.block_user(uuid)                                             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.finish_game(uuid, jsonb)                                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.forfeit_game(uuid, uuid)                                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard()                                            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_sq_stats()                                               FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.remove_friendship(uuid)                                      FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.request_friendship(uuid)                                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_admin_close_game(uuid, text)                              FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_admin_list_closed_games(integer)                          FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_admin_list_open_games()                                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_cancel_game(uuid)                                         FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_create_game(integer, uuid)                                FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_expire_stale_games()                                      FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_give_up(uuid)                                             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_join_game(uuid)                                           FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_nudge(uuid)                                               FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_skip_turn(uuid)                                           FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_submit_rung(uuid, text, integer[])                        FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_admin_close_match(uuid, text)                             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_admin_list_closed_matches(integer)                        FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_admin_list_open_matches()                                 FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_admin_reset_leaderboard()                                 FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_cancel_match(uuid)                                        FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_daily_leaderboard(date)                                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_expire_stale_matches()                                    FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_nudge(uuid)                                               FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sn_recent_match_rule_ids(uuid[], integer)                    FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sq_notification_enabled(uuid, text, text)                    FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.submit_report(uuid, text, text)                              FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.unblock_user(uuid)                                           FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.wordy_auto_start_or_cancel_stale()                           FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.wordy_cancel_game(uuid)                                      FROM anon, public;

GRANT EXECUTE ON FUNCTION public.accept_friendship(uuid)                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_close_game(uuid, text)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_closed_games(integer)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_open_games()                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(uuid)                                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_game(uuid, jsonb)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_game(uuid, uuid)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard()                                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sq_stats()                                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_friendship(uuid)                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_friendship(uuid)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_admin_close_game(uuid, text)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_admin_list_closed_games(integer)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_admin_list_open_games()                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_cancel_game(uuid)                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_create_game(integer, uuid)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_expire_stale_games()                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_give_up(uuid)                                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_join_game(uuid)                                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_nudge(uuid)                                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_skip_turn(uuid)                                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rg_submit_rung(uuid, text, integer[])                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_admin_close_match(uuid, text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_admin_list_closed_matches(integer)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_admin_list_open_matches()                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_admin_reset_leaderboard()                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_cancel_match(uuid)                                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_daily_leaderboard(date)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_expire_stale_matches()                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_nudge(uuid)                                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.sn_recent_match_rule_ids(uuid[], integer)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sq_notification_enabled(uuid, text, text)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_report(uuid, text, text)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid)                                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.wordy_auto_start_or_cancel_stale()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.wordy_cancel_game(uuid)                                       TO authenticated;

-- Tier 2 — RLS helpers (must stay grantable to authenticated for RLS evaluation)
REVOKE EXECUTE ON FUNCTION public.can_join_game(uuid, uuid, uuid[], integer)                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_master_admin()                                            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_player_in_game(uuid, uuid)                                FROM anon, public;

GRANT EXECUTE ON FUNCTION public.can_join_game(uuid, uuid, uuid[], integer)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_admin()                                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_player_in_game(uuid, uuid)                                 TO authenticated;

-- Tier 3 — Trigger-only (no caller grants needed)
REVOKE EXECUTE ON FUNCTION public.auto_start_game()                                            FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                                            FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_friend_request()                                      FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_turn_change()                                         FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rg_notify_game_invited()                                     FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rg_notify_opponent_joined()                                  FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rg_notify_turn_change()                                      FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sn_notify_match_invited()                                    FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sn_notify_opponent_joined()                                  FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sn_notify_round_submitted()                                  FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.wordy_notify_game_invited()                                  FROM anon, authenticated, public;

-- Tier 4 — Internal/orphan (callers are other SECDEF functions or nobody)
REVOKE EXECUTE ON FUNCTION public.admin_list_profiles()                                        FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.check_and_bump_rate_limit(uuid, text, integer)               FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_game_result(uuid)                                     FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rg_dismiss_result(uuid)                                      FROM anon, authenticated, public;
-- sq_check_invitable: called from SECURITY INVOKER triggers (sq_invite_check_trigger,
-- sq_wordy_invite_check_trigger) which run as the calling user — so authenticated needs
-- the grant. Discovered during smoke test 2026-05-06.
REVOKE EXECUTE ON FUNCTION public.sq_check_invitable(uuid, uuid)                               FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.sq_check_invitable(uuid, uuid)                               TO authenticated;

COMMIT;

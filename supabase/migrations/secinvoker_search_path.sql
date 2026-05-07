-- SECURITY INVOKER search_path lock-down (2026-05-06).
--
-- Companion to secdef_hardening.sql. Locks search_path on the 18 SECURITY
-- INVOKER functions still flagged by `function_search_path_mutable` after
-- the SECDEF pass. Lower risk than SECDEF (no privilege elevation possible)
-- but still good hygiene — prevents schema-shadowing attacks via temp
-- objects in pg_temp.

BEGIN;

ALTER FUNCTION public.are_friends(uuid, uuid)                          SET search_path = public, pg_temp;
ALTER FUNCTION public.is_blocked(uuid, uuid)                           SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_letter_value(text)                            SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_make_bag()                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_premium_pos(uuid, integer)                    SET search_path = public, pg_temp;
ALTER FUNCTION public.rg_set_game_expiry()                             SET search_path = public, pg_temp;
ALTER FUNCTION public.rungles_pending_for(uuid)                        SET search_path = public, pg_temp;
ALTER FUNCTION public.set_turn_started_at()                            SET search_path = public, pg_temp;
ALTER FUNCTION public.sn_set_match_expiry()                            SET search_path = public, pg_temp;
ALTER FUNCTION public.snibble_pending_for(uuid)                        SET search_path = public, pg_temp;
ALTER FUNCTION public.sq_invite_check_trigger()                        SET search_path = public, pg_temp;
ALTER FUNCTION public.sq_notification_default(text)                    SET search_path = public, pg_temp;
ALTER FUNCTION public.sq_pending_for(uuid)                             SET search_path = public, pg_temp;
ALTER FUNCTION public.sq_wordy_invite_check_trigger()                  SET search_path = public, pg_temp;
ALTER FUNCTION public.user_in_group(uuid, text)                        SET search_path = public, pg_temp;
ALTER FUNCTION public.user_notif_prefs_set_updated_at()                SET search_path = public, pg_temp;
ALTER FUNCTION public.wordy_pending_for(uuid)                          SET search_path = public, pg_temp;
ALTER FUNCTION public.wordy_set_game_expiry()                          SET search_path = public, pg_temp;

COMMIT;

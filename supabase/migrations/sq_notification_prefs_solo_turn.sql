-- ============================================================
--  SQ notification prefs — add the `solo_turn` topic (Wordy c166)
--
--  Turn pushes for Solo / bot games. Default OFF (opt-in only) —
--  Solo games are quick downtime games, not something to nag about.
--  Same opt-in pattern as `daily_reminder`.
-- ============================================================

-- 1. Allow the new topic in the prefs table.
ALTER TABLE public.user_notification_prefs
  DROP CONSTRAINT IF EXISTS user_notif_prefs_topic_check;

ALTER TABLE public.user_notification_prefs
  ADD CONSTRAINT user_notif_prefs_topic_check
  CHECK (topic IN (
    'your_turn', 'invite', 'nudge', 'opponent_joined',
    'friend_request', 'game_finished', 'daily_reminder',
    'solo_turn',
    '_master'
  ));

-- 2. Default for solo_turn = OFF (opt-in only).
CREATE OR REPLACE FUNCTION public.sq_notification_default(p_topic text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_topic
    WHEN 'your_turn'        THEN true
    WHEN 'invite'           THEN true
    WHEN 'nudge'            THEN true
    WHEN 'opponent_joined'  THEN false
    WHEN 'friend_request'   THEN true
    WHEN 'game_finished'    THEN true
    WHEN 'daily_reminder'   THEN false
    WHEN 'solo_turn'        THEN false   -- opt-in only; solo games are quick downtime
    ELSE true
  END;
$$;

GRANT EXECUTE ON FUNCTION public.sq_notification_default(text) TO anon, authenticated, service_role;

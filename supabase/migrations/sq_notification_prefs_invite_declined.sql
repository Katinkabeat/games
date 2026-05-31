-- ============================================================
-- SQ notification prefs — add the `invite_declined` topic
-- (decline-invite Phase 2, card c167/c172)
--
-- Notifies the inviter when their game invite is declined AND that
-- decline closes/short-circuits the game (1v1 dies, or the last open
-- seat in a multi-seat game declines). Per-game opt-in, default OFF —
-- it's a social nicety, not gameplay-critical, so users opt in per game.
--
-- Mirrors the solo_turn / daily_reminder opt-in pattern. Rebuilds the
-- full topic CHECK + sq_notification_default from the CURRENT live set
-- (which already includes game_finished, daily_reminder, solo_turn,
-- _master) so nothing is dropped.
-- Idempotent.
-- ============================================================

-- 1. Allow the new topic.
alter table public.user_notification_prefs
  drop constraint if exists user_notif_prefs_topic_check;

alter table public.user_notification_prefs
  add constraint user_notif_prefs_topic_check
  check (topic in (
    'your_turn', 'invite', 'nudge', 'opponent_joined',
    'friend_request', 'game_finished', 'daily_reminder',
    'solo_turn', 'invite_declined',
    '_master'
  ));

-- 2. Default for invite_declined = OFF (opt-in per game).
create or replace function public.sq_notification_default(p_topic text)
returns boolean
language sql
immutable
as $$
  select case p_topic
    when 'your_turn'        then true
    when 'invite'           then true
    when 'nudge'            then true
    when 'opponent_joined'  then false
    when 'friend_request'   then true
    when 'game_finished'    then true
    when 'daily_reminder'   then false
    when 'solo_turn'        then false
    when 'invite_declined'  then false   -- opt-in per game; social nicety, not critical
    else true
  end;
$$;

grant execute on function public.sq_notification_default(text)
  to anon, authenticated, service_role;

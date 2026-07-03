-- ============================================================
-- SQ notification prefs — add the `passed_on_leaderboard` topic
-- (hub leaderboard-drop notification, card c225)
--
-- Reaches NON-Discord players when they lose a notable standing on the
-- weekly points board (Rook's #highlights only celebrates positive
-- moves, and only to Discord). Delivered as a hub web-push via the
-- existing per-user/topic system. Off by default — opt-in, since it's
-- competitive colour, not gameplay-critical.
--
-- "Notable" = you lost a top-5 standing (lost #1, or fell out of the
-- top 5). Pure intra-top-5 shuffles (a 4->5 slip) are deliberately NOT
-- notified — mid-week ranks churn constantly and that's the noise we're
-- avoiding. Detection + threshold live in sq_passed_on_leaderboard.sql.
--
-- Rebuilds the full topic CHECK + sq_notification_default from the
-- CURRENT live set (invite_declined migration) so nothing is dropped.
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
    'solo_turn', 'invite_declined', 'passed_on_leaderboard',
    '_master'
  ));

-- 2. Default for passed_on_leaderboard = OFF (opt-in).
create or replace function public.sq_notification_default(p_topic text)
returns boolean
language sql
immutable
as $$
  select case p_topic
    when 'your_turn'             then true
    when 'invite'                then true
    when 'nudge'                 then true
    when 'opponent_joined'       then false
    when 'friend_request'        then true
    when 'game_finished'         then true
    when 'daily_reminder'        then false
    when 'solo_turn'             then false
    when 'invite_declined'       then false
    when 'passed_on_leaderboard' then false  -- opt-in; competitive colour, not critical
    else true
  end;
$$;

grant execute on function public.sq_notification_default(text)
  to anon, authenticated, service_role;

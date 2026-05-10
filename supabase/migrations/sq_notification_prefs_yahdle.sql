-- ============================================================
-- SQ notification prefs — add Yahdle
--
-- Extends user_notification_prefs to recognize:
--   • app   = 'yahdle'
--   • topic = 'game_finished' (Yahdle's match-end notification)
--
-- Yahdle reuses the existing topic vocabulary for invite /
-- opponent_joined / your_turn — only game_finished is new and
-- needs a default added to sq_notification_default.
-- ============================================================

-- 1. Replace the app CHECK to include 'yahdle'.
alter table public.user_notification_prefs
  drop constraint if exists user_notif_prefs_app_check;

alter table public.user_notification_prefs
  add constraint user_notif_prefs_app_check
  check (app in ('wordy', 'rungles', 'snibble', 'sidequest', 'yahdle'));

-- 2. Replace the topic CHECK to include 'game_finished'.
alter table public.user_notification_prefs
  drop constraint if exists user_notif_prefs_topic_check;

alter table public.user_notification_prefs
  add constraint user_notif_prefs_topic_check
  check (topic in (
    'your_turn', 'invite', 'nudge', 'opponent_joined',
    'friend_request', 'game_finished',
    '_master'  -- per-app master toggle (sq_notification_prefs_master.sql)
  ));

-- 3. Default for the new topic. End-of-game wrap-up is gameplay-
-- relevant (review, rematch); default opt-in.
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
    else true
  end;
$$;

grant execute on function public.sq_notification_default(text)
  to anon, authenticated, service_role;

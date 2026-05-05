-- ============================================================
-- Notification prefs: add per-game master switch
-- ============================================================
-- Adds a special `_master` topic that, when set to false for a
-- given app, overrides all per-topic prefs and silences that game
-- entirely. Lets users mute Wordy without losing their per-topic
-- choices for Rungles, Snibble, etc.
--
-- Default for `_master` is true (no implicit silencing).
-- ============================================================

-- 1. Allow `_master` in the topic check constraint.
alter table public.user_notification_prefs
  drop constraint if exists user_notif_prefs_topic_check;

alter table public.user_notification_prefs
  add constraint user_notif_prefs_topic_check
  check (topic in (
    'your_turn',
    'invite',
    'nudge',
    'opponent_joined',
    'friend_request',
    '_master'
  ));


-- 2. Extend sq_notification_default for the new topic.
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
    when '_master'          then true
    else true
  end;
$$;


-- 3. Replace sq_notification_enabled to honour `_master`.
create or replace function public.sq_notification_enabled(
  p_user_id uuid,
  p_app     text,
  p_topic   text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (
      select enabled
        from public.user_notification_prefs
       where user_id = p_user_id and app = p_app and topic = '_master'
    ) = false then
      false
    else
      coalesce(
        (select enabled
           from public.user_notification_prefs
          where user_id = p_user_id and app = p_app and topic = p_topic),
        public.sq_notification_default(p_topic)
      )
  end;
$$;

grant execute on function public.sq_notification_enabled(uuid, text, text)
  to anon, authenticated, service_role;

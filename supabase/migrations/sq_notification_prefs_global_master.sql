-- ============================================================
-- Account-wide master mute + subscription/preference split
-- ============================================================
-- Fixes the "notifications silently stopped" class of bug. Previously the
-- ONLY switch for "do I get pushed at all" was the existence of a browser
-- push subscription row. When that address lapsed (browser GC, token
-- rotation, storage clear) it silently meant "off" — with nothing to heal
-- it. The client now keeps the address alive automatically and the real
-- on/off intent lives here as a durable preference instead.
--
-- The account-wide master is stored as a sentinel row: app = '_all',
-- topic = '_master'. Absent row = master ON (default). enabled = false =
-- everything silenced, regardless of per-game / per-topic prefs.
-- ============================================================

-- 1. Allow the '_all' sentinel app for the account-wide master row.
alter table public.user_notification_prefs
  drop constraint if exists user_notif_prefs_app_check;

alter table public.user_notification_prefs
  add constraint user_notif_prefs_app_check
  check (app in ('wordy', 'rungles', 'snibble', 'sidequest', 'yahdle', '_all'));

-- 2. Check the account-wide master ('_all','_master') FIRST, then the
--    per-app master, then the per-topic pref (falling back to the default).
create or replace function public.sq_notification_enabled(
  p_user_id uuid,
  p_app     text,
  p_topic   text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (
      select enabled
        from public.user_notification_prefs
       where user_id = p_user_id and app = '_all' and topic = '_master'
    ) = false then
      false
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

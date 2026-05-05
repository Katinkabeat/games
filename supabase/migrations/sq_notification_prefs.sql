-- ============================================================
-- SQ notification preferences (Phase 1)
-- ============================================================
-- Adds:
--   1. invitability_policy enum + profiles.invitability column
--   2. user_notification_prefs table (per-user, per-game, per-topic)
--   3. sq_notification_default(topic) — central source of truth
--      for opt-in/opt-out defaults per topic
--   4. sq_notification_enabled(user, app, topic) — what Edge
--      Functions call before sending; falls back to defaults if
--      the user has not set an explicit pref
--
-- App-vs-topic vocabulary:
--   app   ∈ { 'wordy', 'rungles', 'snibble', 'sidequest' }   ← which game/hub
--   topic ∈ { 'your_turn', 'invite', 'nudge', 'opponent_joined', 'friend_request' }
--
-- Note: `app` here is the *game* the notification is for, NOT the
-- service worker that owns the push subscription (push_subscriptions.app
-- is a separate concept). A Wordy turn notification stored at
-- (user, 'wordy', 'your_turn') controls whether we send AT ALL; the
-- push_subscriptions table separately controls which device receives it.
-- ============================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. invitability_policy enum + profiles column
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'invitability_policy') then
    create type public.invitability_policy as enum ('everyone', 'friends_only', 'nobody');
  end if;
end $$;

alter table public.profiles
  add column if not exists invitability public.invitability_policy not null default 'friends_only';


-- ─────────────────────────────────────────────────────────────────────
-- 2. user_notification_prefs table
--
-- Sparse by design: we only store rows where the user has expressed
-- a non-default preference. Missing rows fall back to
-- sq_notification_default(topic). This makes adding a new game/topic
-- free (no backfill needed) and keeps the table small.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.user_notification_prefs (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  app        text        not null,
  topic      text        not null,
  enabled    boolean     not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, app, topic),
  constraint user_notif_prefs_app_check
    check (app in ('wordy', 'rungles', 'snibble', 'sidequest')),
  constraint user_notif_prefs_topic_check
    check (topic in ('your_turn', 'invite', 'nudge', 'opponent_joined', 'friend_request'))
);

create index if not exists user_notif_prefs_user_idx
  on public.user_notification_prefs(user_id);

-- updated_at touch trigger
create or replace function public.user_notif_prefs_set_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists user_notif_prefs_updated_at on public.user_notification_prefs;
create trigger user_notif_prefs_updated_at
  before update on public.user_notification_prefs
  for each row
  execute function public.user_notif_prefs_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS — users own their rows
-- ─────────────────────────────────────────────────────────────────────
alter table public.user_notification_prefs enable row level security;

drop policy if exists "user_notif_prefs read own" on public.user_notification_prefs;
create policy "user_notif_prefs read own"
  on public.user_notification_prefs
  for select
  using (auth.uid() = user_id);

drop policy if exists "user_notif_prefs write own" on public.user_notification_prefs;
create policy "user_notif_prefs write own"
  on public.user_notification_prefs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────
-- 4. Default-resolver function
--
-- Single source of truth for opt-in defaults. To change a default,
-- update this function — no client/Edge Function changes needed.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.sq_notification_default(p_topic text)
returns boolean
language sql
immutable
as $$
  select case p_topic
    when 'your_turn'        then true   -- gameplay-critical
    when 'invite'           then true   -- direct ask from a friend
    when 'nudge'            then true   -- explicit human poke, rate-limited
    when 'opponent_joined'  then false  -- informational; the inviter knew
    when 'friend_request'   then true   -- rare, requires response
    else true                            -- unknown topics default on (safer)
  end;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 5. Effective-pref function — Edge Functions call this before sending
--
-- Returns the user's stored pref if it exists, otherwise the topic's
-- default. SECURITY DEFINER so anon Edge Function callers can resolve
-- a recipient's pref without needing RLS exemptions.
-- ─────────────────────────────────────────────────────────────────────
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
  select coalesce(
    (select enabled
       from public.user_notification_prefs
      where user_id = p_user_id and app = p_app and topic = p_topic),
    public.sq_notification_default(p_topic)
  );
$$;

grant execute on function public.sq_notification_default(text)
  to anon, authenticated, service_role;

grant execute on function public.sq_notification_enabled(uuid, text, text)
  to anon, authenticated, service_role;

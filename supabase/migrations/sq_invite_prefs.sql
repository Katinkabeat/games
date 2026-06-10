-- ============================================================
-- Per-game invite preferences (c200)
-- ============================================================
-- Broadens the single global profiles.invitability setting into a
-- per-(user, game) preference: a player can say "Wordy = friends only,
-- Yahdle = nobody, Rungles = anyone" instead of one switch for all games.
--
-- Storage: a JSONB column on profiles (invite_prefs), keyed by app:
--   {"wordy":"friends_only","yahdle":"nobody"}
-- Sparse by design — a missing key falls back to the existing global
-- profiles.invitability, so nothing changes for a user until they set a
-- per-game override. Values reuse the invitability_policy enum vocabulary
-- ('everyone' | 'friends_only' | 'nobody').
--
-- Enforcement: sq_check_invitable() gains a p_app param. When the invitee
-- has a per-game pref for that app it wins; otherwise the global policy
-- applies. Each game's BEFORE INSERT trigger now passes its app key.
--
-- Also wires Yahdle's previously-missing invite-check trigger so the
-- per-game policy actually means something there.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. profiles.invite_prefs JSONB column
-- ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists invite_prefs jsonb not null default '{}'::jsonb;


-- ─────────────────────────────────────────────────────────────
-- 2. Setter RPC — validates app + policy, then merges one key into
-- the user's own blob. SECURITY DEFINER so it can do the jsonb merge
-- server-side (avoids a client read-modify-write that could clobber a
-- concurrent write) while still scoping the write to auth.uid().
-- ─────────────────────────────────────────────────────────────
create or replace function public.sq_set_invite_pref(
  p_app    text,
  p_policy text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  -- No hardcoded app allowlist: a newly-scaffolded game's slug shouldn't
  -- need adding here. The write only touches the caller's own row, and the
  -- UI only offers real games, so a junk key is inert (the check function
  -- only reads keys for slugs the game triggers actually pass). We still
  -- require a non-empty app and strictly validate the policy enum.
  if p_app is null or btrim(p_app) = '' then
    raise exception 'app is required' using errcode = 'check_violation';
  end if;
  if p_policy not in ('everyone', 'friends_only', 'nobody') then
    raise exception 'unknown policy: %', p_policy using errcode = 'check_violation';
  end if;

  update public.profiles
     set invite_prefs = coalesce(invite_prefs, '{}'::jsonb)
                        || jsonb_build_object(p_app, p_policy)
   where id = auth.uid();
end;
$$;

grant execute on function public.sq_set_invite_pref(text, text)
  to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. Per-game-aware check. Replaces the 2-arg version; p_app defaults
-- to null so any un-updated caller still gets the old global behaviour.
-- ─────────────────────────────────────────────────────────────
-- Drop the prior 2-arg version (from the original sq_check_invitable.sql)
-- if it's still around; the 3-arg form below supersedes it. Using
-- create-or-replace for the 3-arg form keeps this migration re-runnable.
drop function if exists public.sq_check_invitable(uuid, uuid);

create or replace function public.sq_check_invitable(
  p_inviter uuid,
  p_invitee uuid,
  p_app     text default null
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.invitability_policy;
  v_pref   text;
begin
  if p_inviter is null or p_invitee is null then
    return;
  end if;
  if p_inviter = p_invitee then
    return; -- self-invites caught by the per-RPC checks already
  end if;

  select invitability,
         case when p_app is null then null else invite_prefs ->> p_app end
    into v_policy, v_pref
    from public.profiles
   where id = p_invitee;

  -- Per-game override wins over the global default when present.
  if v_pref is not null then
    v_policy := v_pref::public.invitability_policy;
  end if;

  -- No profile row → fall through (signup race, etc.).
  if v_policy is null then
    return;
  end if;

  if v_policy = 'nobody' then
    raise exception 'this user is not accepting game invites'
      using errcode = 'check_violation';
  end if;

  if v_policy = 'friends_only' then
    if not public.are_friends(p_inviter, p_invitee) then
      raise exception 'you need to be friends to invite this user'
        using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

grant execute on function public.sq_check_invitable(uuid, uuid, text)
  to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. Trigger functions now forward an app key.
-- ─────────────────────────────────────────────────────────────

-- Single-invitee tables: (creator_col, invitee_col, app) via TG_ARGV.
create or replace function public.sq_invite_check_trigger()
returns trigger
language plpgsql
as $$
declare
  v_inviter uuid;
  v_invitee uuid;
begin
  v_inviter := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  v_invitee := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;

  if v_invitee is null then
    return NEW; -- open game / no invite
  end if;

  perform public.sq_check_invitable(v_inviter, v_invitee, TG_ARGV[2]);
  return NEW;
end;
$$;

-- Array-invitee tables (created_by uuid + invited_user_ids uuid[]):
-- shared by Wordy (public.games) and Yahdle (public.yahdle_games),
-- which use identical column names. App key in TG_ARGV[0].
create or replace function public.sq_invite_check_array_trigger()
returns trigger
language plpgsql
as $$
declare
  v_invitee uuid;
begin
  if NEW.invited_user_ids is null
     or array_length(NEW.invited_user_ids, 1) is null then
    return NEW;
  end if;
  foreach v_invitee in array NEW.invited_user_ids loop
    perform public.sq_check_invitable(NEW.created_by, v_invitee, TG_ARGV[0]);
  end loop;
  return NEW;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 5. Re-wire every game trigger to pass its app key.
-- ─────────────────────────────────────────────────────────────

-- Wordy: public.games(created_by, invited_user_ids uuid[])
drop trigger if exists wordy_check_invitable on public.games;
create trigger wordy_check_invitable
  before insert on public.games
  for each row
  execute function public.sq_invite_check_array_trigger('wordy');

-- Yahdle: public.yahdle_games(created_by, invited_user_ids uuid[])
-- Previously UNWIRED — adding enforcement so per-game policy applies.
drop trigger if exists yahdle_check_invitable on public.yahdle_games;
create trigger yahdle_check_invitable
  before insert on public.yahdle_games
  for each row
  execute function public.sq_invite_check_array_trigger('yahdle');

-- Rungles: public.rg_games(created_by, invited_user_id)
drop trigger if exists rg_check_invitable on public.rg_games;
create trigger rg_check_invitable
  before insert on public.rg_games
  for each row
  execute function public.sq_invite_check_trigger('created_by', 'invited_user_id', 'rungles');

-- Snibble: public.sn_matches(creator_id, invited_user_id)
drop trigger if exists sn_check_invitable on public.sn_matches;
create trigger sn_check_invitable
  before insert on public.sn_matches
  for each row
  execute function public.sq_invite_check_trigger('creator_id', 'invited_user_id', 'snibble');


-- ─────────────────────────────────────────────────────────────
-- 6. Drop the now-orphaned Wordy-specific trigger fn (replaced by
-- the generic array trigger above).
-- ─────────────────────────────────────────────────────────────
drop function if exists public.sq_wordy_invite_check_trigger();

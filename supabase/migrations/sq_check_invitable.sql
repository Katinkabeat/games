-- ============================================================
-- Enforce invitability policy at the database level.
--
-- profiles.invitability ∈ ('everyone', 'friends_only', 'nobody').
-- 'friends_only' is the default and was previously enforced only
-- in the client UI (the invite picker filtered to friends). This
-- migration adds backend enforcement, plus the new 'nobody' policy
-- which the client UI alone can't honour.
--
-- Centralized check function lives here; thin BEFORE INSERT
-- triggers on each game's invite table call it.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Central check — raises if the invite is not allowed.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sq_check_invitable(
  p_inviter uuid,
  p_invitee uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.invitability_policy;
begin
  if p_inviter is null or p_invitee is null then
    return;
  end if;
  if p_inviter = p_invitee then
    return; -- self-invites caught by the per-RPC checks already
  end if;

  select invitability into v_policy
    from public.profiles
   where id = p_invitee;

  -- No profile row → fall through (signup race, etc.). Trust the
  -- friends_only default once the row exists.
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

grant execute on function public.sq_check_invitable(uuid, uuid)
  to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- Trigger function shared by all three game tables.
-- Each game table has its own (creator_col, invitee_col) names,
-- so the trigger reads them via TG_ARGV.
-- ─────────────────────────────────────────────────────────────
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

  perform public.sq_check_invitable(v_inviter, v_invitee);
  return NEW;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- Wordy: invited_user_ids is uuid[] — needs per-element iteration.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sq_wordy_invite_check_trigger()
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
    perform public.sq_check_invitable(NEW.created_by, v_invitee);
  end loop;
  return NEW;
end;
$$;

drop trigger if exists wordy_check_invitable on public.games;
create trigger wordy_check_invitable
  before insert on public.games
  for each row
  execute function public.sq_wordy_invite_check_trigger();


-- ─────────────────────────────────────────────────────────────
-- Wire the trigger up on each game's invite table.
-- ─────────────────────────────────────────────────────────────

-- Rungles: rg_games(created_by, invited_user_id)
drop trigger if exists rg_check_invitable on public.rg_games;
create trigger rg_check_invitable
  before insert on public.rg_games
  for each row
  execute function public.sq_invite_check_trigger('created_by', 'invited_user_id');

-- Snibble: sn_matches(creator_id, invited_user_id)
drop trigger if exists sn_check_invitable on public.sn_matches;
create trigger sn_check_invitable
  before insert on public.sn_matches
  for each row
  execute function public.sq_invite_check_trigger('creator_id', 'invited_user_id');

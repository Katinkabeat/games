-- ============================================================
-- {{name}} — Nudge
--
-- Run in Supabase → SQL Editor → New Query, AFTER
-- {{slug}}_multiplayer.sql. Safe to re-run.
--
-- Lets a waiting player remind the current player that it's their turn
-- (mirrors Wordy / Yahdle). Cooldown is enforced server-side: a nudge
-- only fires when the current turn has been idle > 12h (last_activity_at,
-- the turn-start proxy) AND no nudge has gone out in the last 12h
-- (last_nudged_at). Stamping last_nudged_at on {{slug}}_games does NOT
-- bump last_activity_at (that trigger only fires on {{slug}}_players
-- writes), so the turn-age gate stays accurate.
--
-- Eligibility and stamping are TWO calls (c264): {{slug}}_nudge only
-- validates + returns who to notify, and the client calls
-- {{slug}}_mark_nudged ONLY after the push actually delivers. A failed
-- push (dead subscription / cold-start timeout) therefore never burns the
-- 12h cooldown and locks the game.
--
-- (last_nudged_at column lives in {{slug}}_multiplayer.sql.)
-- ============================================================

-- {{slug}}_nudge: validate eligibility + return the user_id to notify (the
-- current player). Does NOT stamp — see {{slug}}_mark_nudged below. Raises on
-- ineligibility so the client can surface the reason. SECDEF because there is
-- no direct UPDATE/SELECT policy path this needs; search_path pinned so the
-- definer body can't be shadowed by a caller-set search_path.
create or replace function public.{{slug}}_nudge(
  p_game_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_game     record;
  v_me       record;
  v_target   uuid;
  v_cooldown constant interval := interval '12 hours';
begin
  select * into v_game from public.{{slug}}_games where id = p_game_id;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_me from public.{{slug}}_players where game_id = p_game_id and user_id = v_uid;
  if not found then raise exception 'Not a participant'; end if;
  if v_me.forfeited then raise exception 'You have left this game'; end if;
  if v_me.player_index = v_game.current_player_idx then
    raise exception 'It is your turn — nothing to nudge';
  end if;

  if v_game.last_activity_at > now() - v_cooldown then
    raise exception 'Too soon — give them time to move';
  end if;
  if v_game.last_nudged_at is not null and v_game.last_nudged_at > now() - v_cooldown then
    raise exception 'Already nudged recently';
  end if;

  select user_id into v_target from public.{{slug}}_players
   where game_id = p_game_id and player_index = v_game.current_player_idx;
  return v_target;
end;
$$;

-- {{slug}}_mark_nudged: stamp the 12h cooldown. Called by the client ONLY after
-- the nudge push has been delivered, so a failed send never locks the game.
-- Re-checks the same eligibility gate (participant, not forfeited, not the
-- current player) so it can't be used to stamp a cooldown out of context.
create or replace function public.{{slug}}_mark_nudged(
  p_game_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1
      from public.{{slug}}_players p
      join public.{{slug}}_games   g on g.id = p.game_id
     where p.game_id = p_game_id
       and p.user_id = v_uid
       and not p.forfeited
       and g.status = 'active'
       and p.player_index <> g.current_player_idx
  ) then
    raise exception 'Not eligible to mark nudged';
  end if;
  update public.{{slug}}_games set last_nudged_at = now() where id = p_game_id;
end;
$$;

revoke all on function public.{{slug}}_nudge(uuid)       from public;
revoke all on function public.{{slug}}_mark_nudged(uuid) from public;
grant execute on function public.{{slug}}_nudge(uuid)       to authenticated;
grant execute on function public.{{slug}}_mark_nudged(uuid) to authenticated;

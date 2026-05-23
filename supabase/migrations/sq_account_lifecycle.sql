-- Account lifecycle: deactivate (reversible), scheduled delete (30-day grace),
-- and the destructive erase that runs when the grace window expires.
--
-- Model (c115):
--   * Deactivate  = reversible. Sets profiles.deactivated_at; data untouched.
--                   User can log back in -> reactivation gate -> clears the flag.
--   * Delete      = email-confirmed. Sets deactivated_at + delete_after = now()+30d.
--                   Reactivatable any time before delete_after.
--   * Erase       = sweep_account_deletions() (pg_cron, daily) calls _erase_account()
--                   once delete_after passes. Forfeits open games (opponent wins),
--                   purges personal/social/private data, ANONYMIZES the profile in
--                   place (so leaderboard scores + finished games stay attributed but
--                   de-identified), then SCRUBS + LOCKS the auth.users row (removes the
--                   email/identities, nulls the password, bans it) WITHOUT deleting it.
--
-- Why scrub instead of delete the auth row: profiles.id -> auth.users is ON DELETE
-- CASCADE (verified 2026-05-23 via pg_catalog; ~18 more tables cascade too). Deleting
-- the auth row would therefore erase the anonymized profile and every score that hangs
-- off it. Keeping the row (PII scrubbed, login disabled) is what lets de-identified
-- scores survive on the leaderboards while still honoring the deletion request.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists deactivated_at timestamptz,
  add column if not exists delete_after   timestamptz,
  add column if not exists is_anonymized  boolean not null default false;

create table if not exists public.account_deletion_tokens (
  token      text primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.account_deletion_tokens enable row level security;
-- No policies: only the service role (edge function) and SECURITY DEFINER code touch it.

-- ---------------------------------------------------------------------------
-- 2. Self-service deactivate / reactivate (authenticated, own account only)
-- ---------------------------------------------------------------------------
create or replace function public.deactivate_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.profiles
     set deactivated_at = now(),
         delete_after   = null
   where id = auth.uid()
     and is_anonymized = false;
end;
$$;

create or replace function public.reactivate_account()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.profiles
     set deactivated_at = null,
         delete_after   = null
   where id = auth.uid()
     and is_anonymized = false;   -- once anonymized it is too late to reactivate
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The destructive erase (privileged; runs as owner so it can touch auth.users)
-- ---------------------------------------------------------------------------
create or replace function public._erase_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- == Forfeit OPEN multiplayer games: the opponent automatically wins ==

  -- Wordy (terminal status 'finished'; winner via game_players.is_winner)
  update public.game_players gp
     set is_winner = true
   where gp.user_id <> p_user
     and gp.game_id in (
       select g.id from public.games g
       join public.game_players me on me.game_id = g.id and me.user_id = p_user
       where g.status in ('waiting','active'));
  update public.games g
     set status = 'finished', finished_at = now(), forfeit_user_id = p_user
   where g.status in ('waiting','active')
     and g.id in (select game_id from public.game_players where user_id = p_user);

  -- Rungles (terminal status 'complete'; winner via rg_games.winner_player_idx)
  update public.rg_games g
     set status = 'complete',
         current_player_idx = null,
         finished_at = now(),
         forfeit_user_id = p_user,
         winner_player_idx = (
           select rp.player_idx from public.rg_players rp
            where rp.game_id = g.id and rp.user_id <> p_user limit 1)
   where g.status in ('waiting','active')
     and g.id in (select game_id from public.rg_players where user_id = p_user);

  -- Snibble (terminal status 'completed'; winner via sn_matches.winner_id)
  update public.sn_matches m
     set status = 'completed',
         completed_at = now(),
         winner_id = case when m.creator_id = p_user then m.opponent_id else m.creator_id end
   where m.status in ('open','in_progress')
     and (m.creator_id = p_user or m.opponent_id = p_user);

  -- Yahdle (terminal status 'finished'; winner via yahdle_games.winner_user_id + players.is_winner)
  update public.yahdle_players yp
     set is_winner = (yp.user_id <> p_user)
   where yp.game_id in (
       select g.id from public.yahdle_games g
       join public.yahdle_players me on me.game_id = g.id and me.user_id = p_user
       where g.status in ('waiting','active'));
  update public.yahdle_games g
     set status = 'finished', finished_at = now(), forfeit_user_id = p_user,
         winner_user_id = (
           select yp.user_id from public.yahdle_players yp
            where yp.game_id = g.id and yp.user_id <> p_user limit 1)
   where g.status in ('waiting','active')
     and g.id in (select game_id from public.yahdle_players where user_id = p_user);

  -- == Purge personal / social / private data (NOT score history) ==
  delete from public.push_subscriptions       where user_id = p_user;
  delete from public.user_notification_prefs   where user_id = p_user;
  delete from public.friendships               where user_a = p_user or user_b = p_user or requested_by = p_user;
  delete from public.user_blocks               where blocker = p_user or blocked = p_user;
  delete from public.rate_limits               where user_id = p_user;
  delete from public.sq_events                  where user_id = p_user;
  delete from public.account_deletion_tokens   where user_id = p_user;
  delete from public.admins                     where user_id = p_user;
  delete from public.user_game_access           where user_id = p_user;
  delete from public.user_group_members         where user_id = p_user;

  -- == Anonymize the profile in place (kept for de-identified score attribution) ==
  update public.profiles
     set username       = 'Deleted player #' || left(replace(p_user::text,'-',''), 8),
         avatar_hue     = 270,
         tile_hue       = 270,
         daily_reminder_time = null,
         invitability   = 'nobody',
         is_anonymized  = true,
         deactivated_at = coalesce(deactivated_at, now()),
         delete_after   = null
   where id = p_user;

  -- == Disable login + scrub auth PII WITHOUT deleting the auth.users row. ==
  --    profiles.id -> auth.users is ON DELETE CASCADE (and ~18 other tables cascade
  --    too), so deleting the row would wipe the anonymized profile and every score
  --    that hangs off it. Instead we keep the row, remove its login identities and
  --    sessions, null the password, ban it permanently, and replace the email with a
  --    non-identifying placeholder. Net effect: the person can never log in again and
  --    no personal identifier remains, while their de-identified scores survive.
  delete from auth.identities where user_id = p_user;
  delete from auth.sessions   where user_id = p_user;
  update auth.users
     set email              = 'deleted+' || p_user::text || '@deleted.invalid',
         phone              = null,
         encrypted_password = null,
         email_change       = '',
         phone_change       = '',
         raw_user_meta_data = '{}'::jsonb,
         raw_app_meta_data  = '{}'::jsonb,
         banned_until       = timestamptz '2999-12-31',
         updated_at         = now()
   where id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Scheduled sweep (pg_cron) — erase accounts whose grace window has expired
-- ---------------------------------------------------------------------------
create or replace function public.sweep_account_deletions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id from public.profiles
     where delete_after is not null
       and delete_after < now()
       and is_anonymized = false
  loop
    perform public._erase_account(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants / hardening
-- ---------------------------------------------------------------------------
revoke execute on function public.deactivate_account()        from anon, public;
revoke execute on function public.reactivate_account()        from anon, public;
grant  execute on function public.deactivate_account()        to authenticated;
grant  execute on function public.reactivate_account()        to authenticated;

revoke execute on function public._erase_account(uuid)            from anon, public, authenticated;
revoke execute on function public.sweep_account_deletions()       from anon, public, authenticated;
grant  execute on function public.sweep_account_deletions()       to service_role;

-- ---------------------------------------------------------------------------
-- 6. Cron schedule (idempotent: drop any prior job of the same name first)
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('sweep-account-deletions');
exception when others then
  null;
end;
$$;
select cron.schedule('sweep-account-deletions', '17 4 * * *',
                     $$select public.sweep_account_deletions();$$);

-- ============================================================
-- Friend referral invites (card c135).
--
-- A member generates a single-use invite token (max 3 active at a
-- time). The link carries ?ref=TOKEN to the signup surface. After the
-- invitee confirms their email and lands logged-in for the first time,
-- the client calls sq_consume_referral_invite(token), which:
--   * validates the token (exists, unconsumed, unexpired, not self,
--     neither party has blocked the other, not already friends),
--   * marks it consumed, and
--   * inserts a *pending* friendships row whose requested_by is the
--     INVITER — so the new user lands with a normal incoming friend
--     request from the person who invited them.
--
-- Because the row is a standard pending friendship, the existing
-- machinery fires for free:
--   * friendships_notify_on_insert -> sq-friend-request-notification
--     push (notify_friend_request, sq_friend_request_trigger.sql)
--   * sq_rl_friend_request rate-limit log (sq_rate_limit_wiring.sql)
--
-- DORMANT AT SHIP: the client gates all of this behind
-- VITE_REFERRALS_ENABLED (default off), and the invite UI ships
-- greyed-out. The signup-gating half (invite-only registration
-- enforced server-side) is a separate, infra-blocked follow-up that
-- depends on the auth setup on Dean's servers — NOT in this migration.
--
-- Safe to re-run: idempotent table/index/function definitions.
-- ============================================================

begin;

-- ─────────────────────────────────────────────────────────────
-- Table: one row per generated invite token.
-- consumed_by / consumed_at stay null until claimed (single-use).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sq_referral_invites (
  token       text primary key,
  inviter_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  consumed_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz
);

-- Quota lookups count a member's active (unconsumed, unexpired) tokens.
create index if not exists sq_referral_invites_inviter_idx
  on public.sq_referral_invites (inviter_id);

alter table public.sq_referral_invites enable row level security;

-- A member may read their own invites (to render/copy active links).
-- Writes happen only through the SECURITY DEFINER RPCs below, so there
-- is intentionally no INSERT/UPDATE/DELETE policy for end users.
drop policy if exists "sq_referral_invites_select_own" on public.sq_referral_invites;
create policy "sq_referral_invites_select_own"
  on public.sq_referral_invites
  for select
  using (auth.uid() = inviter_id);

-- ─────────────────────────────────────────────────────────────
-- Generate one invite token for the caller. Enforces the 3-active
-- cap. Returns the new token (the client builds .../games/?ref=<token>).
-- ─────────────────────────────────────────────────────────────
create or replace function public.sq_generate_referral_invite()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me        uuid := auth.uid();
  active    int;
  new_token text;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  -- Cap: at most 3 active (unconsumed, unexpired) invites per member.
  select count(*) into active
    from public.sq_referral_invites
   where inviter_id = me
     and consumed_by is null
     and expires_at > now();

  if active >= 3 then
    raise exception 'you already have 3 active invites — wait for one to be used or to expire'
      using errcode = 'check_violation';
  end if;

  -- url-safe opaque token. Two random v4 UUIDs (gen_random_uuid is core
  -- Postgres, no pgcrypto needed) concatenated with hyphens stripped — 64
  -- url-safe hex chars, ~244 bits of entropy.
  new_token := replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', '');

  insert into public.sq_referral_invites (token, inviter_id)
  values (new_token, me);

  return new_token;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Consume a token as the newly-arrived user. Idempotent-ish: a token
-- already consumed by this same caller returns quietly; all real
-- failure modes raise so the client can surface/log them.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sq_consume_referral_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  inv     public.sq_referral_invites%rowtype;
  a       uuid;
  b       uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if p_token is null or p_token = '' then
    return;
  end if;

  select * into inv
    from public.sq_referral_invites
   where token = p_token
   for update;

  if not found then
    raise exception 'invalid invite';
  end if;

  -- Already consumed: succeed silently if it was this same user (e.g. a
  -- double-fire on first login); otherwise it's a spent single-use link.
  if inv.consumed_by is not null then
    if inv.consumed_by = me then
      return;
    end if;
    raise exception 'this invite has already been used';
  end if;

  if inv.expires_at <= now() then
    raise exception 'this invite has expired';
  end if;

  -- Can't befriend yourself via your own link.
  if inv.inviter_id = me then
    -- Still burn the token so a self-clicked link can't linger as active.
    update public.sq_referral_invites
       set consumed_by = me, consumed_at = now()
     where token = p_token;
    return;
  end if;

  -- Block check: either direction blocks the auto-request.
  if exists (
    select 1 from public.user_blocks
     where (blocker = me and blocked = inv.inviter_id)
        or (blocker = inv.inviter_id and blocked = me)
  ) then
    -- Burn the token; do not create a friendship.
    update public.sq_referral_invites
       set consumed_by = me, consumed_at = now()
     where token = p_token;
    return;
  end if;

  -- Mark consumed first so a concurrent second call sees it spent.
  update public.sq_referral_invites
     set consumed_by = me, consumed_at = now()
   where token = p_token;

  -- Insert the pending friendship FROM the inviter TO the new user.
  -- Mirrors request_friendship()'s canonical ordering (user_a < user_b).
  -- Bare ON CONFLICT DO NOTHING (no column list) so any existing
  -- friendship row — whatever the unique constraint is named — is left
  -- untouched rather than erroring.
  a := least(me, inv.inviter_id);
  b := greatest(me, inv.inviter_id);

  insert into public.friendships (user_a, user_b, status, requested_by)
  values (a, b, 'pending', inv.inviter_id)
  on conflict do nothing;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Grants — mirror secdef_hardening.sql: revoke anon/public, keep
-- authenticated. These are Tier-1 (JS-called via supabase.rpc()).
-- ─────────────────────────────────────────────────────────────
revoke execute on function public.sq_generate_referral_invite()      from anon, public;
revoke execute on function public.sq_consume_referral_invite(text)   from anon, public;
grant  execute on function public.sq_generate_referral_invite()      to authenticated;
grant  execute on function public.sq_consume_referral_invite(text)   to authenticated;

commit;

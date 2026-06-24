-- Rook security review hardening (card c203, review 2026-06-17).
-- Addresses M2 (link-code strength + brute-force accounting) and L1 (grant
-- hygiene) from the Lucy/Codex review. All changes are additive / create-or-
-- replace / revoke-grant — no data is dropped. Mirrored into rae-side-quest
-- (the deployed twin) and applied to the shared Supabase project.

-- pgcrypto provides the CSPRNG (gen_random_bytes). Supabase keeps extensions in
-- the `extensions` schema; we fully-qualify the call so the functions can keep
-- their pinned `search_path = public`.
create extension if not exists pgcrypto with schema extensions;

-- ── M2: stronger link codes ──────────────────────────────────────────
-- Was: 6 chars from `random()` (a PRNG, not a CSPRNG) with a `* 31` off-by-one
-- that never emitted the 32nd alphabet char, shrinking the keyspace to ~29.7
-- bits. Now: 8 chars from a CSPRNG over the full 32-char alphabet (~41 bits).
-- 256 is divisible by 32, so `byte % 32` is unbiased.
create or replace function public.rook_mint_link_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_try  int := 0;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  update discord_link_codes set used_at = now() where user_id = v_user and used_at is null;
  loop
    v_try := v_try + 1;
    -- 8 chars from an unambiguous alphabet (no 0/O/1/I), CSPRNG-sourced.
    select string_agg(
             substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                    (get_byte(r.rnd, g) % 32) + 1, 1), '')
      into v_code
      from (select extensions.gen_random_bytes(8) as rnd) r,
           generate_series(0, 7) as g;
    begin
      insert into discord_link_codes(code, user_id, expires_at)
        values (v_code, v_user, now() + interval '10 minutes');
      return v_code;
    exception when unique_violation then
      if v_try >= 5 then raise; end if; -- astronomically unlikely; retry a few times
    end;
  end loop;
end;
$$;

-- ── M2: redeem brute-force accounting ────────────────────────────────
-- Records failed redeem attempts per Discord id so a member can't script /link
-- (or, if the shared secret ever leaks, POST rook-link-redeem directly) with
-- random codes. RLS-locked, service_role-only (via the SECURITY DEFINER fn).
create table if not exists public.discord_link_attempts (
  id           bigserial primary key,
  discord_id   text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists discord_link_attempts_idx
  on public.discord_link_attempts(discord_id, attempted_at);
alter table public.discord_link_attempts enable row level security;

-- Redeem a code: throttle, verify, write the mapping, return the SQ username.
create or replace function public.rook_redeem_link_code(
  p_code text, p_discord_id text, p_discord_username text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_username text;
  v_fails int;
begin
  -- Brute-force guard (review M2): cap failed attempts per Discord id in a 1h
  -- window. Returns the SAME generic error as a bad code, so throttling leaks
  -- no signal about which codes were valid.
  select count(*) into v_fails from discord_link_attempts
    where discord_id = p_discord_id
      and attempted_at > now() - interval '1 hour';
  if v_fails >= 10 then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  end if;

  select user_id into v_user from discord_link_codes
    where code = upper(p_code) and used_at is null and expires_at > now()
    for update;
  if v_user is null then
    delete from discord_link_attempts where attempted_at < now() - interval '1 day';
    insert into discord_link_attempts(discord_id) values (p_discord_id);
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  end if;

  update discord_link_codes set used_at = now() where code = upper(p_code);
  -- one Discord account maps to one SQ account: move it if it was elsewhere
  delete from discord_links where discord_id = p_discord_id and user_id <> v_user;
  insert into discord_links(user_id, discord_id, discord_username, linked_at)
    values (v_user, p_discord_id, p_discord_username, now())
    on conflict (user_id) do update
      set discord_id = excluded.discord_id,
          discord_username = excluded.discord_username,
          linked_at = now();

  -- success clears the user's failed-attempt tally
  delete from discord_link_attempts where discord_id = p_discord_id;

  select username into v_username from profiles where id = v_user;
  return jsonb_build_object('ok', true, 'username', v_username);
end;
$$;
revoke all on function public.rook_redeem_link_code(text, text, text) from public, anon, authenticated;
grant execute on function public.rook_redeem_link_code(text, text, text) to service_role;

-- ── L1: grant hygiene ────────────────────────────────────────────────
-- daily_streak_for kept Postgres's default PUBLIC execute and takes an arbitrary
-- uuid, so an anon-key holder could read any user's streak via PostgREST. It's
-- only ever called internally by rook_activity (itself SECURITY DEFINER), so
-- locking it to service_role is safe.
revoke all on function public.daily_streak_for(uuid) from public, anon, authenticated;
grant execute on function public.daily_streak_for(uuid) to service_role;

-- Standardize the remaining helpers on `revoke … from public, anon, authenticated`
-- before granting the intended role, matching the badges/leaderboards migrations.
-- (These all gate on auth.uid() so the stray anon grant was useless, but tidy.)
revoke all on function public.rook_mint_link_code() from public, anon, authenticated;
grant execute on function public.rook_mint_link_code() to authenticated;
revoke all on function public.rook_my_discord_link() from public, anon, authenticated;
grant execute on function public.rook_my_discord_link() to authenticated;
revoke all on function public.rook_unlink_discord() from public, anon, authenticated;
grant execute on function public.rook_unlink_discord() to authenticated;
revoke all on function public.sq_set_hype_pref(text, boolean) from public, anon, authenticated;
grant execute on function public.sq_set_hype_pref(text, boolean) to authenticated;
revoke all on function public.rook_get_settings() from public, anon, authenticated;
grant execute on function public.rook_get_settings() to service_role;
revoke all on function public.rook_set_setting(text, text, boolean) from public, anon, authenticated;
grant execute on function public.rook_set_setting(text, text, boolean) to service_role;
